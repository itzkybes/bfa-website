// src/routes/records/+page.server.js
// Aggregates seasons into all-time Regular and Playoff standings.
// Also produces topTeamMatchups, topPlayerMatchups, closestMatches, largestMargins,
// ownersList and headToHeadByOwner shapes used by the UI.
//
// PATCHES included:
// - Load & apply static/early2023.json overrides for 2023 weeks 1..3
// - "Don't use current week" logic: if next week's matchups contain zero/missing scores, skip current week
//   except when current week === playoffEnd (final playoff week).
// - Debug lines that list matchups for certain teams

import fs from 'fs';
import path from 'path';
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';

let cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) cache = createKVCache(globalThis.KV);
  else cache = createMemoryCache();
} catch (e) {
  cache = createMemoryCache();
}

const SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
const sleeper = createSleeperClient({ cache, concurrency: SLEEPER_CONCURRENCY });

const BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID)
  ? process.env.BASE_LEAGUE_ID
  : '1219816671624048640';
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function computeStreaks(resultsArray) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  if (!resultsArray || !Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
  for (let i = 0; i < resultsArray.length; i++) {
    const r = resultsArray[i];
    if (r === 'W') { curW += 1; curL = 0; if (curW > maxW) maxW = curW; }
    else if (r === 'L') { curL += 1; curW = 0; if (curL > maxL) maxL = curL; }
    else { curW = 0; curL = 0; }
  }
  return { maxW, maxL };
}

// Hardcoded champions (if used)
const HARDCODED_CHAMPIONS = {
  '2022': 'riguy506',
  '2023': 'armyjunior',
  '2024': 'riguy506'
};

// Canonical owner mapping (merge old owner usernames -> target owner key)
const CANONICAL_OWNER_MAP = {
  'bellooshio': 'jakepratt',
  'cholybevv': 'jakepratt',
  // add more canonical mappings if needed
};

// Original owner keys we preserve separately (but exclude from final regular/playoff table if desired)
const PRESERVE_ORIGINAL_OWNERS = ['bellooshio', 'cholybevv'];
const EXCLUDE_OWNER_KEYS = PRESERVE_ORIGINAL_OWNERS.map(k => String(k).toLowerCase());

/**
 * Extract player points mapping from a participant object (best-effort)
 */
function extractPlayerPointsMap(participant) {
  const map = {};
  if (!participant || typeof participant !== 'object') return map;

  const pp = participant.player_points ?? participant.playerPoints ?? participant.player_points_for ?? participant.player_points_for;
  const playersList = participant.players ?? participant.player_ids ?? participant.playerIds ?? participant.player_ids_list;

  if (pp && typeof pp === 'object' && !Array.isArray(pp)) {
    for (const k in pp) {
      if (!Object.prototype.hasOwnProperty.call(pp, k)) continue;
      map[String(k)] = safeNum(pp[k]);
    }
    return map;
  }

  if (Array.isArray(pp)) {
    for (let i = 0; i < pp.length; i++) {
      const v = pp[i];
      if (playersList && Array.isArray(playersList) && playersList[i]) {
        const pid = String(playersList[i]);
        if (v && typeof v === 'object') {
          const vid = v.player_id ?? v.player ?? v.id ?? pid;
          const pts = safeNum(v.points ?? v.pts ?? v.p ?? 0);
          map[String(vid)] = pts;
        } else {
          map[pid] = safeNum(v);
        }
      } else {
        if (v && typeof v === 'object' && (v.player_id || v.player)) {
          const vid2 = v.player_id ?? v.player;
          const pts2 = safeNum(v.points ?? v.pts ?? 0);
          map[String(vid2)] = pts2;
        }
      }
    }
    return map;
  }

  const sp = participant.starters_points ?? participant.startersPoints ?? null;
  if (sp && typeof sp === 'object') {
    if (!Array.isArray(sp)) {
      for (const kk in sp) {
        if (!Object.prototype.hasOwnProperty.call(sp, kk)) continue;
        map[String(kk)] = safeNum(sp[kk]);
      }
      return map;
    } else {
      const starters = participant.starters ?? participant.starting_lineup ?? participant.starters_list ?? participant.starters_list ?? participant.players ?? participant.player_ids ?? participant.playerIds ?? [];
      for (let si = 0; si < sp.length; si++) {
        if (starters && starters[si]) map[String(starters[si])] = safeNum(sp[si]);
      }
      return map;
    }
  }

  return map;
}

// Helper to attempt to load early overrides JSON from various locations.
// Returns parsed object or null and records messages.
async function loadEarlyOverrides(event, messages) {
  // We expect a file at /early2023.json in the static folder (served from root),
  // or at filesystem path static/early2023.json (relative to project root).
  const candidates = [];

  try {
    // try a runtime fetch against site root using event.url origin (server-side load)
    if (event && event.url && typeof event.url.origin === 'string') {
      candidates.push({ type: 'fetch', ref: new URL('/early2023.json', event.url.origin).href });
    } else {
      // global fetch fallback
      candidates.push({ type: 'fetch', ref: '/early2023.json' });
    }
  } catch (e) {
    // ignore
  }

  // add likely filesystem paths (when running locally or in lambda with bundled static)
  const cwd = process.cwd ? process.cwd() : null;
  if (cwd) {
    candidates.push({ type: 'fs', ref: path.join(cwd, 'static', 'early2023.json') });
    candidates.push({ type: 'fs', ref: path.join(cwd, 'bfa-website', 'static', 'early2023.json') });
    candidates.push({ type: 'fs', ref: path.join(cwd, 'public', 'early2023.json') });
  } else {
    candidates.push({ type: 'fs', ref: '/var/task/static/early2023.json' });
  }

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      if (c.type === 'fetch') {
        // Prefer event.fetch if available (SvelteKit), otherwise global fetch
        let resp = null;
        try {
          if (event && typeof event.fetch === 'function') resp = await event.fetch(c.ref);
          else resp = await fetch(c.ref);
        } catch (ferr) {
          // try global fetch fallback for SSR environment
          try { resp = await fetch(c.ref); } catch (ff) { resp = null; }
        }
        if (resp && resp.ok) {
          try {
            const json = await resp.json();
            messages.push(`Loaded early overrides via fetch: ${c.ref}`);
            return json;
          } catch (je) {
            messages.push(`Failed parsing early overrides JSON from fetch ${c.ref} — ${je?.message ?? String(je)}`);
            continue;
          }
        } else {
          if (resp && resp.status) messages.push(`Fetch attempt for early overrides returned status ${resp.status} at ${c.ref}`);
          else messages.push(`Fetch attempt for early overrides failed for ${c.ref}`);
        }
      } else if (c.type === 'fs') {
        if (fs && fs.existsSync && fs.existsSync(c.ref)) {
          try {
            const raw = fs.readFileSync(c.ref, 'utf8');
            const json = JSON.parse(raw);
            messages.push(`Loaded early overrides from disk: ${c.ref}`);
            return json;
          } catch (fe) {
            messages.push(`Failed reading/parsing early overrides from ${c.ref} — ${fe?.message ?? String(fe)}`);
            continue;
          }
        } else {
          messages.push(`Early overrides file not found at: ${c.ref}`);
        }
      }
    } catch (outer) {
      messages.push(`Error attempting to load early overrides (${c.type} ${c.ref}) — ${outer?.message ?? String(outer)}`);
      continue;
    }
  }

  // nothing found
  messages.push('No valid early2023.json found (fetch + disk attempts failed or produced invalid JSON).');
  return null;
}

// Utility: check if array of matchups is "finished" according to zero/missing rule.
// We treat an entry as "incomplete" when any participant's numeric points field is missing or exactly 0.
// When used to decide whether to include a week, we will check the *next* week's matchups.
function isMatchupsArrayComplete(matchupsArray) {
  if (!matchupsArray || !Array.isArray(matchupsArray)) return true;
  for (let i = 0; i < matchupsArray.length; i++) {
    const ent = matchupsArray[i];
    // Accept any of the common numeric fields
    const ptsRaw = ent.points ?? ent.points_for ?? ent.pts ?? ent.score ?? null;
    if (ptsRaw === null || ptsRaw === undefined) return false;
    const n = Number(ptsRaw);
    if (isNaN(n)) return false;
    if (Math.abs(n) < 1e-9) return false;
  }
  return true;
}

export async function load(event) {
  // caching for edge
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const messages = [];

  // load players dataset for names
  let playersMap = {};
  try {
    const rawPlayers = await sleeper.rawFetch(`/players/nba`);
    if (rawPlayers && typeof rawPlayers === 'object') {
      playersMap = rawPlayers;
      messages.push('Loaded players dataset (' + Object.keys(playersMap).length + ')');
    } else {
      playersMap = {};
      messages.push('Players dataset empty or unexpected shape');
    }
  } catch (e) {
    playersMap = {};
    messages.push('Failed to load players dataset: ' + (e?.message ?? String(e)));
  }

  // Attempt to load early overrides JSON (for 2023 weeks 1..3)
  let earlyOverridesRaw = null;
  try {
    earlyOverridesRaw = await loadEarlyOverrides(event, messages);
  } catch (e) {
    earlyOverridesRaw = null;
    messages.push('Error loading early overrides: ' + (e?.message ?? String(e)));
  }

  // Normalize earlyOverrides into a map: earlyOverridesBySeasonWeek[season][week] = array of override entries
  // Accept either the JSON structure the user provided (season -> week -> array) or a flat array.
  const earlyOverridesBySeasonWeek = {};
  try {
    if (earlyOverridesRaw && typeof earlyOverridesRaw === 'object') {
      // If it already contains top-level seasons
      for (const sk in earlyOverridesRaw) {
        if (!Object.prototype.hasOwnProperty.call(earlyOverridesRaw, sk)) continue;
        const entry = earlyOverridesRaw[sk];
        // ensure mapping of weeks under season
        earlyOverridesBySeasonWeek[String(sk)] = {};
        if (entry && typeof entry === 'object') {
          for (const wk in entry) {
            if (!Object.prototype.hasOwnProperty.call(entry, wk)) continue;
            earlyOverridesBySeasonWeek[String(sk)][String(wk)] = Array.isArray(entry[wk]) ? entry[wk] : [];
          }
        }
      }
      messages.push('earlyOverridesBySeasonWeek initialized from early2023.json');
    } else {
      messages.push('early2023.json is empty or not an object; skipping early overrides.');
    }
  } catch (e) {
    messages.push('Error parsing early overrides into map: ' + (e?.message ?? String(e)));
  }

  // Build seasons chain
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { messages.push('Failed fetching base league ' + BASE_LEAGUE_ID + ' — ' + (e?.message ?? String(e))); }

    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id || BASE_LEAGUE_ID), season: mainLeague.season ?? null, name: mainLeague.name ?? null });
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) { messages.push('Could not fetch league for previous_league_id ' + currPrev); break; }
          seasons.push({ league_id: String(prevLeague.league_id || currPrev), season: prevLeague.season ?? null, name: prevLeague.name ?? null });
          currPrev = prevLeague.previous_league_id ? String(prevLeague.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err?.message ?? String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error while building seasons chain: ' + (err?.message ?? String(err)));
  }

  // dedupe and sort seasons old -> new
  const byId = {};
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);
  seasons.sort(function (a, b) {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  // Aggregators
  const agg = {}; // canonical ownerKey -> aggregated stats
  const originalAgg = {}; // raw owner key -> preserved
  const rosterLatest = {}; // rosterId -> latest meta for team/owner display

  // candidate lists for other tables
  const topTeamCandidates = [];
  const topPlayerCandidates = [];
  const allMatchMarginCandidates = [];

  // head-to-head raw at roster level: headToHeadRaw[A][B] = { regWins, regLosses, regTies, regPF, regPA, playWins,... }
  const headToHeadRaw = {};

  // DEBUG: collect all matchups for certain teams
  const debugTrackTeamsLower = ['corey\'s shower', 'damn!!!!!!!!!!!!!!!!', 'kanto embers', 'coreys shower', 'damn!!!!!!!!!!!!!!!!!']; // include variants
  const debugMatchupsForTeams = {}; // teamLower -> array of { season, week, rosterId, points, opponentRosterId, opponentPoints }

  // process each season
  for (let si = 0; si < seasons.length; si++) {
    const seasonEntry = seasons[si];
    const leagueId = String(seasonEntry.league_id);
    try {
      let leagueMeta = null;
      try { leagueMeta = await sleeper.getLeague(leagueId, { ttl: 60 * 5 }); } catch (e) { leagueMeta = null; }

      let playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
      if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
      const playoffEnd = playoffStart + 2; // requested: +2

      // get roster map with owners and meta
      let rosterMap = {};
      try { rosterMap = await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 }); } catch (e) { rosterMap = {}; }

      // update rosterLatest (most recent wins out)
      if (rosterMap && Object.keys(rosterMap).length) {
        for (const rk in rosterMap) {
          if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
          const meta = rosterMap[rk] || {};
          const tname = meta.team_name || meta.owner_name || ('Roster ' + rk);
          const tav = meta.team_avatar || meta.owner_avatar || null;
          rosterLatest[String(rk)] = { team_name: tname, team_avatar: tav, owner_username: meta.owner_username ?? null, owner_name: meta.owner_name ?? null };
        }
      }

      // per-season trackers for reg and play
      const statsReg = {}; const resultsReg = {}; const paReg = {};
      const statsPlay = {}; const resultsPlay = {}; const paPlay = {};

      // seed from roster map
      if (rosterMap && Object.keys(rosterMap).length) {
        for (const rk in rosterMap) {
          if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
          statsReg[rk] = { wins:0, losses:0, ties:0, pf:0, pa:0 };
          resultsReg[rk] = [];
          paReg[rk] = 0;
          statsPlay[rk] = { wins:0, losses:0, ties:0, pf:0, pa:0 };
          resultsPlay[rk] = [];
          paPlay[rk] = 0;
        }
      }

      // loop weeks
      for (let week = 1; week <= MAX_WEEKS; week++) {
        // fetch current week's matchups
        let matchups = null;
        try { matchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 }); } catch (mwErr) { continue; }
        if (!matchups || !matchups.length) continue;

        // Apply early overrides BEFORE any "is finished" checks, for season 2023 weeks 1..3
        try {
          const seasonKey = seasonEntry.season != null ? String(seasonEntry.season) : null;
          if (seasonKey && earlyOverridesBySeasonWeek && earlyOverridesBySeasonWeek[seasonKey] && earlyOverridesBySeasonWeek[seasonKey][String(week)]) {
            const arr = earlyOverridesBySeasonWeek[seasonKey][String(week)] || [];
            // Build mapping of multiple key types to score for quick lookup:
            // We'll match by owner_username (if rosterMap has it), by owner_name, and by team_name lowercased.
            const overrideMap = {
              byOwnerUsername: {}, // owner_username_lower -> score
              byOwnerName: {},     // owner_name_lower -> score
              byTeamName: {}       // team_name_lower -> score
            };
            for (let oi = 0; oi < arr.length; oi++) {
              const it = arr[oi];
              if (!it) continue;
              // the JSON might supply structure with teamA/teamB etc; support a few shapes:
              // if it has teamA/teamB we add both; if it has ownerName or owner_username keys, use them
              if (it.teamA && it.teamAScore != null) {
                const tn = (it.teamA.name ?? it.teamA.team ?? '').toString().toLowerCase();
                const on = (it.teamA.ownerName ?? it.teamA.owner_name ?? it.teamA.owner_username ?? '').toString().toLowerCase();
                const score = Number(it.teamAScore);
                if (tn) overrideMap.byTeamName[tn] = score;
                if (on) { overrideMap.byOwnerName[on] = score; overrideMap.byOwnerUsername[on] = score; }
              }
              if (it.teamB && it.teamBScore != null) {
                const tn = (it.teamB.name ?? it.teamB.team ?? '').toString().toLowerCase();
                const on = (it.teamB.ownerName ?? it.teamB.owner_name ?? it.teamB.owner_username ?? '').toString().toLowerCase();
                const score = Number(it.teamBScore);
                if (tn) overrideMap.byTeamName[tn] = score;
                if (on) { overrideMap.byOwnerName[on] = score; overrideMap.byOwnerUsername[on] = score; }
              }
              // Also support flattened entries: { teamA: 'X', ownerName: 'foo', teamAScore: 123 }
              if (it.team && it.score != null) {
                const tn = String(it.team).toLowerCase();
                overrideMap.byTeamName[tn] = Number(it.score);
              }
            }

            // Apply overrides to each entry in this week's matchups
            if ((Object.keys(overrideMap.byTeamName).length > 0) ||
                (Object.keys(overrideMap.byOwnerName).length > 0) ||
                (Object.keys(overrideMap.byOwnerUsername).length > 0)) {
              for (let mi = 0; mi < matchups.length; mi++) {
                const ent = matchups[mi];
                const rid = ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId;
                const meta = rid && rosterMap && rosterMap[String(rid)] ? rosterMap[String(rid)] : null;
                const teamName = (meta && meta.team_name) ? String(meta.team_name).toLowerCase() : ((ent.team_name || ent.team) ? String(ent.team_name || ent.team).toLowerCase() : null);
                const ownerUser = (meta && meta.owner_username) ? String(meta.owner_username).toLowerCase() : null;
                const ownerName = (meta && meta.owner_name) ? String(meta.owner_name).toLowerCase() : null;

                let overridden = null;
                if (ownerUser && overrideMap.byOwnerUsername[ownerUser] !== undefined) overridden = overrideMap.byOwnerUsername[ownerUser];
                else if (ownerName && overrideMap.byOwnerName[ownerName] !== undefined) overridden = overrideMap.byOwnerName[ownerName];
                else if (teamName && overrideMap.byTeamName[teamName] !== undefined) overridden = overrideMap.byTeamName[teamName];

                if (overridden != null && !isNaN(overridden)) {
                  // override common score fields so downstream logic sees updated value
                  ent.points = Number(overridden);
                  ent.points_for = Number(overridden);
                  ent.pts = Number(overridden);
                  // also override starters_points if shape matches (defensive)
                  if (ent.starters_points) ent.starters_points = ent.starters_points; // leave as-is; main override is team total
                }
              }
              messages.push(`Applied early2023.json overrides for season ${seasonEntry.season} week ${week}`);
            }
          }
        } catch (ovErr) {
          messages.push('Error applying early overrides for season ' + (seasonEntry.season || '') + ' week ' + week + ' — ' + (ovErr?.message ?? String(ovErr)));
        }

        // Determine if we should skip this 'week' because the next week appears incomplete.
        // Rule: look at matchups for (week + 1). If those matchups exist and contain any zero/missing scores,
        // then treat the current week as still in progress and SKIP processing it — except if current week === playoffEnd.
        let skipDueToNextWeek = false;
        try {
          const nextWeek = week + 1;
          if (nextWeek <= MAX_WEEKS) {
            let nextMatchups = null;
            try { nextMatchups = await sleeper.getMatchupsForWeek(leagueId, nextWeek, { ttl: 60 * 5 }); } catch (nmErr) { nextMatchups = null; }
            if (Array.isArray(nextMatchups) && nextMatchups.length) {
              // Apply early overrides to nextMatchups if they are within 2023 weeks 1..3 (to ensure we see overridden scores)
              try {
                const seasonKey = seasonEntry.season != null ? String(seasonEntry.season) : null;
                if (seasonKey && earlyOverridesBySeasonWeek && earlyOverridesBySeasonWeek[seasonKey] && earlyOverridesBySeasonWeek[seasonKey][String(nextWeek)]) {
                  const arrN = earlyOverridesBySeasonWeek[seasonKey][String(nextWeek)] || [];
                  const ovMapN = {};
                  for (let xi = 0; xi < arrN.length; xi++) {
                    const it = arrN[xi];
                    if (!it) continue;
                    if (it.teamA && it.teamAScore != null) {
                      const tn = (it.teamA.name ?? it.teamA.team ?? '').toString().toLowerCase();
                      const on = (it.teamA.ownerName ?? it.teamA.owner_name ?? it.teamA.owner_username ?? '').toString().toLowerCase();
                      const score = Number(it.teamAScore);
                      if (tn) ovMapN[tn] = score;
                      if (on) ovMapN[on] = score;
                    }
                    if (it.teamB && it.teamBScore != null) {
                      const tn = (it.teamB.name ?? it.teamB.team ?? '').toString().toLowerCase();
                      const on = (it.teamB.ownerName ?? it.teamB.owner_name ?? it.teamB.owner_username ?? '').toString().toLowerCase();
                      const score = Number(it.teamBScore);
                      if (tn) ovMapN[tn] = score;
                      if (on) ovMapN[on] = score;
                    }
                  }
                  // apply
                  for (let mni = 0; mni < nextMatchups.length; mni++) {
                    const ent = nextMatchups[mni];
                    const rid = ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId;
                    const meta = rid && rosterMap && rosterMap[String(rid)] ? rosterMap[String(rid)] : null;
                    const tName = (meta && meta.team_name) ? String(meta.team_name).toLowerCase() : ((ent.team_name || ent.team) ? String(ent.team_name || ent.team).toLowerCase() : null);
                    const ownerUser = (meta && meta.owner_username) ? String(meta.owner_username).toLowerCase() : null;
                    const ownerName = (meta && meta.owner_name) ? String(meta.owner_name).toLowerCase() : null;
                    let overridden = null;
                    if (ownerUser && ovMapN[ownerUser] !== undefined) overridden = ovMapN[ownerUser];
                    else if (ownerName && ovMapN[ownerName] !== undefined) overridden = ovMapN[ownerName];
                    else if (tName && ovMapN[tName] !== undefined) overridden = ovMapN[tName];
                    if (overridden != null && !isNaN(overridden)) {
                      ent.points = Number(overridden);
                      ent.points_for = Number(overridden);
                      ent.pts = Number(overridden);
                    }
                  }
                }
              } catch (xerr) {
                // ignore
              }

              // If nextMatchups has any incomplete participant, and current week is not the final playoff week, skip current week.
              const nextComplete = isMatchupsArrayComplete(nextMatchups);
              if (!nextComplete && week !== playoffEnd) {
                skipDueToNextWeek = true;
                messages.push(`Skipping season ${seasonEntry.season} week ${week} because next week (${week + 1}) appears incomplete (contains zero/missing scores).`);
              }
            }
          }
        } catch (chkErr) {
          // don't block processing on this check failing
          messages.push('Error while checking next week completeness for league ' + leagueId + ' week ' + week + ' — ' + (chkErr?.message ?? String(chkErr)));
        }
        if (skipDueToNextWeek) continue;

        const isReg = (week >= 1 && week < playoffStart);
        const isPlay = (week >= playoffStart && week <= playoffEnd);
        if (!isReg && !isPlay) continue;

        const stats = isPlay ? statsPlay : statsReg;
        const results = isPlay ? resultsPlay : resultsReg;
        const pa = isPlay ? paPlay : paReg;

        // group by matchup id / week
        const byMatch = {};
        for (let mi = 0; mi < matchups.length; mi++) {
          const e = matchups[mi];
          const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
          const wk = e.week ?? e.w ?? week;
          const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(e);
        }

        const mids = Object.keys(byMatch);
        for (let m = 0; m < mids.length; m++) {
          const entries = byMatch[mids[m]];
          if (!entries || !entries.length) continue;

          if (entries.length === 1) {
            // single entry - record pf but cannot compute head-to-head
            const only = entries[0];
            const ridOnly = only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId;
            const ptsOnly = safeNum(only.points ?? only.points_for ?? only.pts ?? 0);
            pa[String(ridOnly)] = pa[String(ridOnly)] || 0;
            results[String(ridOnly)] = results[String(ridOnly)] || [];
            stats[String(ridOnly)] = stats[String(ridOnly)] || { wins:0, losses:0, ties:0, pf:0, pa:0 };
            stats[String(ridOnly)].pf += ptsOnly;
            continue;
          }

          // Build participants with rosterId, points, raw entry
          const participants = [];
          for (let p = 0; p < entries.length; p++) {
            const ent = entries[p];
            const pid = ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId;
            const ppts = safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0);
            participants.push({ rosterId: String(pid), points: ppts, raw: ent });
            pa[String(pid)] = pa[String(pid)] || 0;
            results[String(pid)] = results[String(pid)] || [];
            stats[String(pid)] = stats[String(pid)] || { wins:0, losses:0, ties:0, pf:0, pa:0 };
            stats[String(pid)].pf += ppts;
          }

          // For debug: record matchups for tracked teams
          try {
            for (let pi = 0; pi < participants.length; pi++) {
              const p = participants[pi];
              const metaP = rosterMap && rosterMap[p.rosterId] ? rosterMap[p.rosterId] : {};
              const tname = (metaP.team_name || metaP.owner_name || '').toString();
              const tnameLower = tname.toLowerCase();
              for (let d = 0; d < debugTrackTeamsLower.length; d++) {
                const target = debugTrackTeamsLower[d];
                if (tnameLower.indexOf(target) !== -1) {
                  debugMatchupsForTeams[target] = debugMatchupsForTeams[target] || [];
                  // find opponent in same match
                  const opponents = participants.filter(x => x.rosterId !== p.rosterId);
                  const opp = opponents.length ? opponents[0] : null;
                  debugMatchupsForTeams[target].push({
                    season: seasonEntry.season ?? null,
                    week: week,
                    rosterId: p.rosterId,
                    team: tname,
                    points: Math.round((p.points || 0) * 100)/100,
                    opponentRosterId: opp ? opp.rosterId : null,
                    opponentPoints: opp ? Math.round((opp.points || 0) * 100)/100 : null
                  });
                }
              }
            }
          } catch (dberr) {
            // ignore
          }

          // margins: winner vs 2nd best
          try {
            if (participants.length >= 2) {
              const sortedByPoints = participants.slice().sort((a,b) => (b.points || 0) - (a.points || 0));
              const winner = sortedByPoints[0];
              const runnerUp = sortedByPoints[1];
              const margin = Number(winner.points || 0) - Number(runnerUp.points || 0);
              if (Math.abs(margin) > 1e-9) {
                const winMeta = rosterLatest[winner.rosterId] || (rosterMap[winner.rosterId] || {});
                const runMeta = rosterLatest[runnerUp.rosterId] || (rosterMap[runnerUp.rosterId] || {});
                const matchObj = {
                  team_rosterId: winner.rosterId,
                  team_name: winMeta.team_name || ('Roster ' + winner.rosterId),
                  team_avatar: winMeta.team_avatar || null,
                  opponent_rosterId: runnerUp.rosterId,
                  opponent_name: runMeta.team_name || ('Roster ' + runnerUp.rosterId),
                  opponent_avatar: runMeta.team_avatar || null,
                  winning_score: Math.round((winner.points || 0) * 100) / 100,
                  losing_score: Math.round((runnerUp.points || 0) * 100) / 100,
                  margin: Math.round(margin * 100) / 100,
                  season: seasonEntry.season || null,
                  week: week
                };
                allMatchMarginCandidates.push(matchObj);
              }
            }
          } catch (errMargin) {
            // ignore
          }

          // topTeamCandidates
          try {
            for (let pi = 0; pi < participants.length; pi++) {
              const part = participants[pi];
              const other = participants.slice().filter(x => x.rosterId !== part.rosterId);
              let bestOpp = null;
              if (other && other.length) { other.sort((a,b) => (b.points || 0) - (a.points || 0)); bestOpp = other[0]; }
              const teamMeta = rosterLatest[part.rosterId] || rosterMap[part.rosterId] || {};
              const oppMeta = bestOpp ? (rosterLatest[bestOpp.rosterId] || rosterMap[bestOpp.rosterId] || {}) : {};
              topTeamCandidates.push({
                team_rosterId: part.rosterId,
                team_name: teamMeta.team_name || ('Roster ' + part.rosterId),
                team_avatar: teamMeta.team_avatar || null,
                opponent_rosterId: bestOpp ? bestOpp.rosterId : null,
                opponent_name: bestOpp ? (oppMeta.team_name || ('Roster ' + bestOpp.rosterId)) : null,
                opponent_avatar: oppMeta.team_avatar || null,
                team_score: Math.round((part.points || 0) * 100) / 100,
                opponent_score: bestOpp ? Math.round((bestOpp.points || 0) * 100) / 100 : 0,
                season: seasonEntry.season || null,
                week: week
              });
            }
          } catch (ttErr) { /* ignore */ }

          // topPlayerCandidates
          try {
            for (let pi2 = 0; pi2 < participants.length; pi2++) {
              const pPart = participants[pi2];
              const entRaw = pPart.raw || {};
              const playerPointsMap = extractPlayerPointsMap(entRaw);
              let starters = entRaw.starters ?? entRaw.starting_lineup ?? entRaw.starters_list ?? entRaw.players ?? entRaw.player_ids ?? [];
              if (!Array.isArray(starters)) starters = [];
              for (let si2 = 0; si2 < starters.length; si2++) {
                const pid = starters[si2];
                if (!pid) continue;
                const pidStr = String(pid);
                let pts = null;
                if (Object.prototype.hasOwnProperty.call(playerPointsMap, pidStr)) pts = Number(playerPointsMap[pidStr]);
                else if (Object.prototype.hasOwnProperty.call(playerPointsMap, pidStr.toUpperCase())) pts = Number(playerPointsMap[pidStr.toUpperCase()]);
                else pts = null;
                if (pts == null || isNaN(pts)) continue;
                const playerObj = playersMap[pidStr] || playersMap[pidStr.toUpperCase()] || null;
                const playerName = playerObj ? (playerObj.full_name || (playerObj.first_name ? ((playerObj.first_name || '') + ' ' + (playerObj.last_name || '')) : pidStr)) : pidStr;
                const teamMeta2 = rosterLatest[pPart.rosterId] || rosterMap[pPart.rosterId] || {};
                const otherArr = participants.slice().filter(x => x.rosterId !== pPart.rosterId);
                const bestOpp2 = otherArr.length ? otherArr.slice().sort((a,b)=> (b.points||0)-(a.points||0))[0] : null;
                const oppMeta2 = bestOpp2 ? (rosterLatest[bestOpp2.rosterId] || rosterMap[bestOpp2.rosterId] || {}) : {};
                topPlayerCandidates.push({
                  player_id: pidStr,
                  player_name: playerName,
                  points: Math.round(pts * 100) / 100,
                  team_rosterId: pPart.rosterId,
                  team_name: teamMeta2.team_name || ('Roster ' + pPart.rosterId),
                  team_avatar: teamMeta2.team_avatar || null,
                  opponent_rosterId: bestOpp2 ? bestOpp2.rosterId : null,
                  opponent_name: bestOpp2 ? (oppMeta2.team_name || ('Roster ' + bestOpp2.rosterId)) : null,
                  opponent_avatar: oppMeta2.team_avatar || null,
                  season: seasonEntry.season || null,
                  week: week
                });
              }
            }
          } catch (tpErr) { /* ignore */ }

          // existing logic: compute per-participant W/L/T vs opponent average AND collect head-to-head per-roster pair
          for (let pi3 = 0; pi3 < participants.length; pi3++) {
            const part3 = participants[pi3];
            const opps = [];
            for (let oi = 0; oi < participants.length; oi++) { if (oi === pi3) continue; opps.push(participants[oi]); }
            let oppAvg = 0;
            if (opps.length) {
              for (let oa = 0; oa < opps.length; oa++) oppAvg += opps[oa].points;
              oppAvg = oppAvg / opps.length;
            }
            pa[part3.rosterId] = pa[part3.rosterId] || 0;
            pa[part3.rosterId] += oppAvg;
            if (part3.points > oppAvg + 1e-9) { results[part3.rosterId].push('W'); stats[part3.rosterId].wins += 1; }
            else if (part3.points < oppAvg - 1e-9) { results[part3.rosterId].push('L'); stats[part3.rosterId].losses += 1; }
            else { results[part3.rosterId].push('T'); stats[part3.rosterId].ties += 1; }
          }

          // Update headToHeadRaw for each pair using direct points comparison (use B's points vs A)
          for (let aIndex = 0; aIndex < participants.length; aIndex++) {
            const A = participants[aIndex];
            for (let bIndex = 0; bIndex < participants.length; bIndex++) {
              if (aIndex === bIndex) continue;
              const B = participants[bIndex];
              // ensure structures
              headToHeadRaw[A.rosterId] = headToHeadRaw[A.rosterId] || {};
              headToHeadRaw[A.rosterId][B.rosterId] = headToHeadRaw[A.rosterId][B.rosterId] || {
                regWins:0, regLosses:0, regTies:0, regPF:0, regPA:0,
                playWins:0, playLosses:0, playTies:0, playPF:0, playPA:0
              };

              const rec = headToHeadRaw[A.rosterId][B.rosterId];
              const aPts = Number(A.points || 0);
              const bPts = Number(B.points || 0);

              if (isReg) {
                if (aPts > bPts + 1e-9) rec.regWins += 1;
                else if (aPts < bPts - 1e-9) rec.regLosses += 1;
                else rec.regTies += 1;
                rec.regPF += aPts;
                rec.regPA += bPts;
              } else if (isPlay) {
                if (aPts > bPts + 1e-9) rec.playWins += 1;
                else if (aPts < bPts - 1e-9) rec.playLosses += 1;
                else rec.playTies += 1;
                rec.playPF += aPts;
                rec.playPA += bPts;
              }
            }
          }
        } // end match keys
      } // end weeks

      // After season-weeks processed build per-season standings aggregated into agg (below)
      function buildStandingsAndAggregate(statsByRoster, resultsByRoster, paByRoster, isPlayoff) {
        let iterationKeys = Object.keys(resultsByRoster);
        if (iterationKeys.length === 0 && rosterMap && Object.keys(rosterMap).length) iterationKeys = Object.keys(rosterMap);

        for (let idx = 0; idx < iterationKeys.length; idx++) {
          const ridK = iterationKeys[idx];
          if (!Object.prototype.hasOwnProperty.call(statsByRoster, ridK)) {
            statsByRoster[ridK] = { wins:0, losses:0, ties:0, pf:0, pa:0 };
          }
          const s = statsByRoster[ridK];
          const wins = s.wins || 0;
          const losses = s.losses || 0;
          const pfVal = Math.round((s.pf || 0) * 100) / 100;
          const paVal = Math.round((paByRoster[ridK] || s.pa || 0) * 100) / 100;

          const meta = (rosterMap && rosterMap[ridK]) ? rosterMap[ridK] : {};
          const owner_username = meta.owner_username ? String(meta.owner_username) : null;
          const owner_name = meta.owner_name ? String(meta.owner_name) : null;
          const team_name = meta.team_name ? String(meta.team_name) : ('Roster ' + ridK);
          const avatar = meta.team_avatar || meta.owner_avatar || null;

          const rawOwnerKey = owner_username ? owner_username.toLowerCase() : (owner_name ? owner_name.toLowerCase() : ('roster:' + String(ridK)));
          const ownerNameLower = owner_name ? owner_name.toLowerCase() : null;

          // capture originalAgg (pre-merge)
          if (!originalAgg[rawOwnerKey]) {
            originalAgg[rawOwnerKey] = {
              ownerKey: rawOwnerKey,
              owner_username: owner_username,
              owner_name: owner_name,
              latest_team: team_name,
              latest_avatar: avatar,
              regWins: 0, regLosses: 0, regPF: 0, regPA: 0,
              playoffWins: 0, playoffLosses: 0, playoffPF: 0, playoffPA: 0,
              championships: 0,
              regResults: []
            };
          } else {
            originalAgg[rawOwnerKey].latest_team = team_name;
            if (avatar) originalAgg[rawOwnerKey].latest_avatar = avatar;
            if (!originalAgg[rawOwnerKey].owner_username && owner_username) originalAgg[rawOwnerKey].owner_username = owner_username;
            if (!originalAgg[rawOwnerKey].owner_name && owner_name) originalAgg[rawOwnerKey].owner_name = owner_name;
          }

          if (isPlayoff) {
            originalAgg[rawOwnerKey].playoffWins += wins;
            originalAgg[rawOwnerKey].playoffLosses += losses;
            originalAgg[rawOwnerKey].playoffPF += pfVal;
            originalAgg[rawOwnerKey].playoffPA += paVal;
          } else {
            originalAgg[rawOwnerKey].regWins += wins;
            originalAgg[rawOwnerKey].regLosses += losses;
            originalAgg[rawOwnerKey].regPF += pfVal;
            originalAgg[rawOwnerKey].regPA += paVal;
            const resArr = resultsByRoster[ridK] && Array.isArray(resultsByRoster[ridK]) ? resultsByRoster[ridK] : [];
            if (resArr.length) originalAgg[rawOwnerKey].regResults = originalAgg[rawOwnerKey].regResults.concat(resArr);
          }

          // canonicalize owner key
          const canonical = CANONICAL_OWNER_MAP[rawOwnerKey] || (ownerNameLower && CANONICAL_OWNER_MAP[ownerNameLower]) || rawOwnerKey;
          const ownerKey = canonical;

          if (!agg[ownerKey]) {
            let displayOwnerUsername = owner_username;
            let displayOwnerName = owner_name || null;
            if (ownerKey === 'jakepratt') {
              displayOwnerUsername = 'jakepratt';
              displayOwnerName = 'JakePratt';
            } else if (!displayOwnerName && ownerKey && ownerKey.indexOf('roster:') === 0) {
              displayOwnerName = null;
            }

            agg[ownerKey] = {
              ownerKey: ownerKey,
              owner_username: displayOwnerUsername,
              owner_name: displayOwnerName,
              latest_team: team_name,
              latest_avatar: avatar,
              regWins: 0, regLosses: 0, regPF: 0, regPA: 0,
              playoffWins: 0, playoffLosses: 0, playoffPF: 0, playoffPA: 0,
              championships: 0,
              regResults: []
            };
          } else {
            agg[ownerKey].latest_team = team_name;
            if (avatar) agg[ownerKey].latest_avatar = avatar;
            if (ownerKey === 'jakepratt') {
              agg[ownerKey].owner_username = agg[ownerKey].owner_username || 'jakepratt';
              agg[ownerKey].owner_name = 'JakePratt';
            } else {
              if (!agg[ownerKey].owner_username && owner_username) agg[ownerKey].owner_username = owner_username;
              if (!agg[ownerKey].owner_name && owner_name) agg[ownerKey].owner_name = owner_name;
            }
          }

          if (isPlayoff) {
            agg[ownerKey].playoffWins += wins;
            agg[ownerKey].playoffLosses += losses;
            agg[ownerKey].playoffPF += pfVal;
            agg[ownerKey].playoffPA += paVal;
          } else {
            agg[ownerKey].regWins += wins;
            agg[ownerKey].regLosses += losses;
            agg[ownerKey].regPF += pfVal;
            agg[ownerKey].regPA += paVal;
            const resArr2 = resultsByRoster[ridK] && Array.isArray(resultsByRoster[ridK]) ? resultsByRoster[ridK] : [];
            if (resArr2.length) agg[ownerKey].regResults = agg[ownerKey].regResults.concat(resArr2);
          }
        }
      }

      buildStandingsAndAggregate(statsReg, resultsReg, paReg, false);
      buildStandingsAndAggregate(statsPlay, resultsPlay, paPlay, true);

      // apply hardcoded champs
      try {
        const seasonKey = seasonEntry.season != null ? String(seasonEntry.season) : null;
        if (seasonKey && HARDCODED_CHAMPIONS.hasOwnProperty(seasonKey)) {
          const champOwner = String(HARDCODED_CHAMPIONS[seasonKey]);
          const champKey = champOwner.toLowerCase();
          const mappedChamp = CANONICAL_OWNER_MAP[champKey] || champKey;
          if (!agg[mappedChamp]) {
            // attempt resolution from rosterMeta
            let resolved = null;
            for (const rkk in rosterMap) {
              if (!Object.prototype.hasOwnProperty.call(rosterMap, rkk)) continue;
              const m = rosterMap[rkk] || {};
              if (m.owner_username && String(m.owner_username).toLowerCase() === champKey) {
                resolved = { owner_username: m.owner_username, owner_name: m.owner_name, team_name: m.team_name, avatar: (m.team_avatar || m.owner_avatar) };
                break;
              }
            }
            agg[mappedChamp] = {
              ownerKey: mappedChamp,
              owner_username: resolved ? resolved.owner_username : mappedChamp,
              owner_name: resolved ? resolved.owner_name : null,
              latest_team: resolved ? resolved.team_name : ('owner ' + mappedChamp),
              latest_avatar: resolved ? resolved.avatar : null,
              regWins: 0, regLosses: 0, regPF: 0, regPA: 0,
              playoffWins: 0, playoffLosses: 0, playoffPF: 0, playoffPA: 0,
              championships: 0,
              regResults: []
            };
            if (mappedChamp === 'jakepratt') { agg[mappedChamp].owner_username = 'jakepratt'; agg[mappedChamp].owner_name = 'JakePratt'; }
          }
          agg[mappedChamp].championships += 1;
        }
      } catch (hcErr) {
        messages.push('Error applying hardcoded champ for season ' + (seasonEntry.season || seasonEntry.league_id) + ' — ' + (hcErr?.message ?? String(hcErr)));
      }

    } catch (perr) {
      messages.push('Error processing league ' + leagueId + ' — ' + (perr?.message ?? String(perr)));
      continue;
    }
  } // end seasons

  // recompute championships counts for safety
  const champCounts = {};
  for (const sk in HARDCODED_CHAMPIONS) {
    if (!Object.prototype.hasOwnProperty.call(HARDCODED_CHAMPIONS, sk)) continue;
    const u = String(HARDCODED_CHAMPIONS[sk]).toLowerCase();
    const mapped = CANONICAL_OWNER_MAP[u] || u;
    champCounts[mapped] = (champCounts[mapped] || 0) + 1;
  }
  for (const ck in champCounts) {
    if (!Object.prototype.hasOwnProperty.call(champCounts, ck)) continue;
    if (!agg[ck]) {
      agg[ck] = {
        ownerKey: ck,
        owner_username: ck,
        owner_name: null,
        latest_team: 'owner ' + ck,
        latest_avatar: null,
        regWins: 0, regLosses: 0, regPF: 0, regPA: 0,
        playoffWins: 0, playoffLosses: 0, playoffPF: 0, playoffPA: 0,
        championships: champCounts[ck],
        regResults: []
      };
      if (ck === 'jakepratt') { agg[ck].owner_username = 'jakepratt'; agg[ck].owner_name = 'JakePratt'; }
    } else {
      agg[ck].championships = Math.max(agg[ck].championships || 0, champCounts[ck]);
    }
  }

  // compute streaks
  for (const key in agg) {
    if (!Object.prototype.hasOwnProperty.call(agg, key)) continue;
    const entry = agg[key];
    const streaks = computeStreaks(entry.regResults || []);
    entry.maxWinStreak = streaks.maxW;
    entry.maxLoseStreak = streaks.maxL;
  }

  // Build arrays for tables: regularAllTime & playoffAllTime
  const regularAllTime = [];
  const playoffAllTime = [];
  for (const k2 in agg) {
    if (!Object.prototype.hasOwnProperty.call(agg, k2)) continue;
    if (EXCLUDE_OWNER_KEYS.indexOf(String(k2).toLowerCase()) !== -1) continue;
    const a = agg[k2];
    regularAllTime.push({
      ownerKey: a.ownerKey,
      owner_username: a.owner_username,
      owner_name: a.owner_name,
      team: a.latest_team,
      avatar: a.latest_avatar,
      wins: a.regWins || 0,
      losses: a.regLosses || 0,
      pf: Math.round((a.regPF || 0) * 100) / 100,
      pa: Math.round((a.regPA || 0) * 100) / 100,
      maxWinStreak: a.maxWinStreak || 0,
      maxLoseStreak: a.maxLoseStreak || 0,
      championships: a.championships || 0
    });
    playoffAllTime.push({
      ownerKey: a.ownerKey,
      owner_username: a.owner_username,
      owner_name: a.owner_name,
      team: a.latest_team,
      avatar: a.latest_avatar,
      playoffWins: a.playoffWins || 0,
      playoffLosses: a.playoffLosses || 0,
      pf: Math.round((a.playoffPF || 0) * 100) / 100,
      pa: Math.round((a.playoffPA || 0) * 100) / 100,
      championships: a.championships || 0
    });
  }

  // Sort regular: wins desc then pf desc
  regularAllTime.sort((a,b) => {
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    return (b.pf || 0) - (a.pf || 0);
  });

  // sort playoff: championships desc, playoffWins desc, pf desc
  playoffAllTime.sort((a,b) => {
    if ((b.championships || 0) !== (a.championships || 0)) return (b.championships || 0) - (a.championships || 0);
    if ((b.playoffWins || 0) !== (a.playoffWins || 0)) return (b.playoffWins || 0) - (a.playoffWins || 0);
    return (b.pf || 0) - (a.pf || 0);
  });

  // originalRecords for preserved owners
  const originalRecords = {};
  PRESERVE_ORIGINAL_OWNERS.forEach(function(ownerName) {
    const key = String(ownerName).toLowerCase();
    if (originalAgg[key]) {
      const o = originalAgg[key];
      originalRecords[key] = {
        owner_username: o.owner_username || ownerName,
        owner_name: o.owner_name || null,
        team: o.latest_team || null,
        avatar: o.latest_avatar || null,
        regWins: o.regWins || 0,
        regLosses: o.regLosses || 0,
        regPF: Math.round((o.regPF || 0) * 100) / 100,
        regPA: Math.round((o.regPA || 0) * 100) / 100,
        playoffWins: o.playoffWins || 0,
        playoffLosses: o.playoffLosses || 0,
        playoffPF: Math.round((o.playoffPF || 0) * 100) / 100,
        playoffPA: Math.round((o.playoffPA || 0) * 100) / 100,
        championships: o.championships || 0
      };
    } else {
      originalRecords[key] = {
        owner_username: ownerName,
        owner_name: null,
        team: null,
        avatar: null,
        regWins: 0, regLosses: 0, regPF: 0, regPA: 0,
        playoffWins: 0, playoffLosses: 0, playoffPF: 0, playoffPA: 0,
        championships: 0
      };
    }
  });

  // largestMargins & closestMatches (top 10) - derived from allMatchMarginCandidates
  let largestMargins = [];
  let closestMatches = [];
  try {
    if (allMatchMarginCandidates && allMatchMarginCandidates.length) {
      const sortedDesc = allMatchMarginCandidates.slice().sort((a,b) => (b.margin || 0) - (a.margin || 0));
      for (let x = 0; x < Math.min(10, sortedDesc.length); x++) largestMargins.push(sortedDesc[x]);
      const sortedAsc = allMatchMarginCandidates.slice().sort((a,b) => (a.margin || 0) - (b.margin || 0));
      const filteredAsc = sortedAsc.filter(e => Math.abs(e.margin || 0) > 1e-9);
      for (let y = 0; y < Math.min(10, filteredAsc.length); y++) closestMatches.push(filteredAsc[y]);
    }
  } catch (cmErr) { messages.push('Error computing margins summaries: ' + (cmErr?.message ?? String(cmErr))); }

  // topTeamMatchups (top 10)
  const topTeamMatchups = [];
  try {
    if (topTeamCandidates && topTeamCandidates.length) {
      topTeamCandidates.sort((a,b) => (b.team_score || 0) - (a.team_score || 0));
      for (let tti = 0; tti < Math.min(10, topTeamCandidates.length); tti++) {
        const e = topTeamCandidates[tti];
        topTeamMatchups.push({
          team_rosterId: e.team_rosterId,
          team_name: e.team_name,
          team_avatar: e.team_avatar,
          opponent_rosterId: e.opponent_rosterId,
          opponent_name: e.opponent_name,
          opponent_avatar: e.opponent_avatar,
          winning_score: e.team_score != null ? e.team_score : 0,
          losing_score: e.opponent_score != null ? e.opponent_score : 0,
          season: e.season,
          week: e.week,
          margin: (e.team_score != null && e.opponent_score != null) ? (Math.round(((e.team_score - e.opponent_score) * 100)) / 100) : null
        });
      }
    }
  } catch (ttErr) { messages.push('Error assembling topTeamMatchups: ' + (ttErr?.message ?? String(ttErr))); }

  // topPlayerMatchups (top 10)
  const topPlayerMatchups = [];
  try {
    if (topPlayerCandidates && topPlayerCandidates.length) {
      topPlayerCandidates.sort((a,b) => (b.points || 0) - (a.points || 0));
      for (let pmi = 0; pmi < Math.min(10, topPlayerCandidates.length); pmi++) {
        const pe = topPlayerCandidates[pmi];
        topPlayerMatchups.push({
          player_id: pe.player_id,
          player_name: pe.player_name,
          player_avatar: null,
          team_rosterId: pe.team_rosterId,
          team_name: pe.team_name,
          team_avatar: pe.team_avatar,
          opponent_rosterId: pe.opponent_rosterId,
          opponent_name: pe.opponent_name,
          opponent_avatar: pe.opponent_avatar,
          points: pe.points != null ? pe.points : 0,
          season: pe.season,
          week: pe.week
        });
      }
    }
  } catch (tppErr) { messages.push('Error assembling topPlayerMatchups: ' + (tppErr?.message ?? String(tppErr))); }

  // ---------------------------
  // NORMALIZE the four lists so UI can rely on consistent fields
  // Prefer latest roster metadata when available (rosterLatest), fallback to existing values
  // ---------------------------

  function latestTeamForRoster(rid) {
    if (!rid) return { team_name: null, team_avatar: null };
    const m = (rosterLatest && rosterLatest[String(rid)]) || {};
    return {
      team_name: m.team_name || null,
      team_avatar: m.team_avatar || null
    };
  }

  function prefer(...vals) {
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v !== undefined && v !== null) return v;
    }
    return null;
  }

  // normalize topTeamMatchups
  try {
    for (let i = 0; i < topTeamMatchups.length; i++) {
      const e = topTeamMatchups[i];
      const tinfo = e.team_rosterId ? latestTeamForRoster(e.team_rosterId) : { team_name: null, team_avatar: null };
      const oinfo = e.opponent_rosterId ? latestTeamForRoster(e.opponent_rosterId) : { team_name: null, team_avatar: null };
      e.team_name = prefer(tinfo.team_name, e.team_name, e.team, e.latest_team) || null;
      e.team_avatar = prefer(tinfo.team_avatar, e.team_avatar, e.teamAvatar, e.latest_avatar, e.avatar) || null;
      e.opponent_name = prefer(oinfo.team_name, e.opponent_name, e.opponent, e.opponent_team) || null;
      e.opponent_avatar = prefer(oinfo.team_avatar, e.opponent_avatar, e.opponentAvatar, e.opponent_latest_avatar) || null;
      e.season = e.season ?? null; e.week = e.week ?? null;
    }
  } catch (err) { /* ignore */ }

  // normalize topPlayerMatchups
  try {
    for (let i = 0; i < topPlayerMatchups.length; i++) {
      const e = topPlayerMatchups[i];
      const tinfo = e.team_rosterId ? latestTeamForRoster(e.team_rosterId) : { team_name: null, team_avatar: null };
      const oinfo = e.opponent_rosterId ? latestTeamForRoster(e.opponent_rosterId) : { team_name: null, team_avatar: null };
      e.team_name = prefer(tinfo.team_name, e.team_name, e.team, e.latest_team) || null;
      e.team_avatar = prefer(tinfo.team_avatar, e.team_avatar, e.teamAvatar, e.latest_avatar, e.avatar) || null;
      e.opponent_name = prefer(oinfo.team_name, e.opponent_name, e.opponent, e.opponent_team) || null;
      e.opponent_avatar = prefer(oinfo.team_avatar, e.opponent_avatar, e.opponentAvatar, e.opponent_latest_avatar) || null;
      e.season = e.season ?? null; e.week = e.week ?? null;
    }
  } catch (err) { /* ignore */ }

  // normalize closestMatches
  try {
    for (let i = 0; i < closestMatches.length; i++) {
      const e = closestMatches[i];
      const tinfo = e.team_rosterId ? latestTeamForRoster(e.team_rosterId) : { team_name: null, team_avatar: null };
      const oinfo = e.opponent_rosterId ? latestTeamForRoster(e.opponent_rosterId) : { team_name: null, team_avatar: null };
      e.team_name = prefer(tinfo.team_name, e.team_name, e.team) || null;
      e.team_avatar = prefer(tinfo.team_avatar, e.team_avatar, e.teamAvatar, e.latest_avatar) || null;
      e.opponent_name = prefer(oinfo.team_name, e.opponent_name, e.opponent) || null;
      e.opponent_avatar = prefer(oinfo.team_avatar, e.opponent_avatar, e.opponentAvatar) || null;
      e.margin = e.margin ?? Math.abs((e.winning_score ?? e.team_score ?? 0) - (e.losing_score ?? e.opponent_score ?? 0));
      e.season = e.season ?? null; e.week = e.week ?? null;
    }
  } catch (err) { /* ignore */ }

  // normalize largestMargins
  try {
    for (let i = 0; i < largestMargins.length; i++) {
      const e = largestMargins[i];
      const tinfo = e.team_rosterId ? latestTeamForRoster(e.team_rosterId) : { team_name: null, team_avatar: null };
      const oinfo = e.opponent_rosterId ? latestTeamForRoster(e.opponent_rosterId) : { team_name: null, team_avatar: null };
      e.team_name = prefer(tinfo.team_name, e.team_name, e.team) || null;
      e.team_avatar = prefer(tinfo.team_avatar, e.team_avatar, e.teamAvatar, e.latest_avatar) || null;
      e.opponent_name = prefer(oinfo.team_name, e.opponent_name, e.opponent) || null;
      e.opponent_avatar = prefer(oinfo.team_avatar, e.opponent_avatar, e.opponentAvatar) || null;
      e.margin = e.margin ?? Math.abs((e.winning_score ?? e.team_score ?? 0) - (e.losing_score ?? e.opponent_score ?? 0));
      e.season = e.season ?? null; e.week = e.week ?? null;
    }
  } catch (err) { /* ignore */ }

  // ---------------------------
  // Convert headToHeadRaw (roster->roster) into headToHeadByOwner aggregated to canonical owners
  // ---------------------------
  const headToHeadByOwnerMap = {}; // ownerKey -> { oppOwnerKey -> aggregated record }
  function ensureOwnerOpp(ownerKey, oppKey) {
    headToHeadByOwnerMap[ownerKey] = headToHeadByOwnerMap[ownerKey] || {};
    if (!headToHeadByOwnerMap[ownerKey][oppKey]) {
      headToHeadByOwnerMap[ownerKey][oppKey] = {
        opponent_ownerKey: oppKey,
        opponent_name: null,
        opponent_avatar: null,
        regWins: 0, regLosses: 0, regPF: 0, regPA: 0,
        playWins: 0, playLosses: 0, playPF: 0, playPA: 0
      };
    }
    return headToHeadByOwnerMap[ownerKey][oppKey];
  }

  // Build roster => canonical owner map
  const rosterToOwnerKey = {};
  for (const rid in rosterLatest) {
    const meta = rosterLatest[rid] || {};
    const rawKey = meta.owner_username ? String(meta.owner_username).toLowerCase() : (meta.owner_name ? String(meta.owner_name).toLowerCase() : ('roster:' + rid));
    const canonical = CANONICAL_OWNER_MAP[rawKey] || rawKey;
    rosterToOwnerKey[rid] = canonical;
  }

  for (const aRid in headToHeadRaw) {
    for (const bRid in headToHeadRaw[aRid]) {
      const rec = headToHeadRaw[aRid][bRid];
      const aOwnerKey = rosterToOwnerKey[aRid] || (rosterLatest[aRid] && rosterLatest[aRid].owner_username ? String(rosterLatest[aRid].owner_username).toLowerCase() : ('roster:' + aRid));
      const bOwnerKey = rosterToOwnerKey[bRid] || (rosterLatest[bRid] && rosterLatest[bRid].owner_username ? String(rosterLatest[bRid].owner_username).toLowerCase() : ('roster:' + bRid));
      if (!aOwnerKey || !bOwnerKey) continue;
      if (aOwnerKey === bOwnerKey) continue; // skip self
      const outA = ensureOwnerOpp(aOwnerKey, bOwnerKey);
      outA.regWins += rec.regWins || 0;
      outA.regLosses += rec.regLosses || 0;
      outA.regPF += rec.regPF || 0;
      outA.regPA += rec.regPA || 0;
      outA.playWins += rec.playWins || 0;
      outA.playLosses += rec.playLosses || 0;
      outA.playPF += rec.playPF || 0;
      outA.playPA += rec.playPA || 0;
      // store a display name & avatar from rosterLatest (use latest roster of opponent if available)
      const oppMeta = rosterLatest[bRid] || {};
      outA.opponent_name = outA.opponent_name || oppMeta.team_name || (agg[bOwnerKey] && agg[bOwnerKey].latest_team) || bOwnerKey;
      outA.opponent_avatar = outA.opponent_avatar || oppMeta.team_avatar || (agg[bOwnerKey] && agg[bOwnerKey].latest_avatar) || null;
    }
  }

  // Convert headToHeadByOwnerMap to arrays sorted by regWins desc and compute GP = wins + losses (no ties)
  const headToHeadByOwner = {};
  for (const ownerKey in headToHeadByOwnerMap) {
    const inner = headToHeadByOwnerMap[ownerKey];
    const arr = Object.keys(inner).map(k => {
      const r = inner[k];
      const regWins = Number(r.regWins || 0);
      const regLosses = Number(r.regLosses || 0);
      const playWins = Number(r.playWins || 0);
      const playLosses = Number(r.playLosses || 0);
      return {
        opponent_ownerKey: r.opponent_ownerKey,
        opponent_name: r.opponent_name,
        opponent_avatar: r.opponent_avatar,
        regWins: regWins,
        regLosses: regLosses,
        regGP: regWins + regLosses, // GP no ties
        regPF: Math.round((r.regPF || 0) * 100) / 100,
        regPA: Math.round((r.regPA || 0) * 100) / 100,
        playWins: playWins,
        playLosses: playLosses,
        playGP: playWins + playLosses, // GP no ties
        playPF: Math.round((r.playPF || 0) * 100) / 100,
        playPA: Math.round((r.playPA || 0) * 100) / 100
      };
    });
    arr.sort((a,b) => (b.regWins || 0) - (a.regWins || 0));
    headToHeadByOwner[ownerKey] = arr;
  }

  // Build ownersList from agg (most recent team info)
  const ownersList = [];
  for (const k in agg) {
    if (!Object.prototype.hasOwnProperty.call(agg, k)) continue;
    ownersList.push({
      ownerKey: k,
      owner_username: agg[k].owner_username,
      owner_name: agg[k].owner_name,
      team: agg[k].latest_team,
      team_avatar: agg[k].latest_avatar
    });
  }
  // sort alphabetically by team
  ownersList.sort((a,b) => (a.team || '').localeCompare(b.team || ''));

  // Add debug matchups info for tracked teams to messages
  try {
    for (const targetLower in debugMatchupsForTeams) {
      if (!Object.prototype.hasOwnProperty.call(debugMatchupsForTeams, targetLower)) continue;
      const arr = debugMatchupsForTeams[targetLower] || [];
      messages.push(`Debug: matchups for team match "${targetLower}" (${arr.length} entries):`);
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        messages.push(`  season ${e.season} week ${e.week} roster ${e.rosterId} (${e.team}) scored ${e.points} vs opponent ${e.opponentRosterId} scored ${e.opponentPoints}`);
      }
    }
  } catch (derr) {
    messages.push('Error emitting debug matchups for tracked teams: ' + (derr?.message ?? String(derr)));
  }

  // Build output
  return {
    seasons,
    regularAllTime,
    playoffAllTime,
    messages,
    originalRecords,
    topTeamMatchups,
    topPlayerMatchups,
    closestMatches,
    largestMargins,
    headToHeadByOwner,
    ownersList,
    players: playersMap
  };
}
