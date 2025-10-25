// src/routes/records/+page.server.js
// Aggregates seasons into all-time Regular and Playoff standings.
// Also produces topTeamMatchups, topPlayerMatchups, closestMatches, largestMargins,
// ownersList and headToHeadByOwner shapes used by the UI.

import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import fs from 'fs/promises';
import path from 'path';

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
      const starters = participant.starters ?? participant.starting_lineup ?? participant.starters_list ?? participant.starters_list ?? participant.players ?? participant.player_ids ?? [];
      for (let si = 0; si < sp.length; si++) {
        if (starters && starters[si]) map[String(starters[si])] = safeNum(sp[si]);
      }
      return map;
    }
  }

  return map;
}

async function tryLoadEarly2023Json(messages) {
  // Try a few likely locations relative to process.cwd()
  const candidatePaths = [
    path.join(process.cwd(), 'static', 'early2023.json'),
    path.join(process.cwd(), 'bfa-website', 'static', 'early2023.json'),
    path.join(process.cwd(), 'public', 'static', 'early2023.json'),
    path.join(process.cwd(), 'public', 'early2023.json')
  ];
  for (const p of candidatePaths) {
    try {
      const raw = await fs.readFile(p, 'utf8');
      const parsed = JSON.parse(raw);
      messages.push('Loaded early2023.json from disk: ' + p);
      return parsed;
    } catch (e) {
      // ignore and try next
    }
  }
  messages.push('No early2023.json found on disk (looked at ' + candidatePaths.join(', ') + ').');
  return null;
}

export async function load(event) {
  // caching for edge
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const messages = [];

  // Attempt to load early override JSON for first 3 weeks of 2023
  let early2023 = null;
  try {
    early2023 = await tryLoadEarly2023Json(messages);
    if (!early2023) messages.push('early2023.json not available; early overrides will not be applied.');
  } catch (e) {
    messages.push('Error loading early2023.json: ' + (e?.message ?? String(e)));
    early2023 = null;
  }

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

  // We'll collect match logs for debug for specific teams requested by the user
  const debugWatchTeamNames = ["Corey's Shower", "DAMN!!!!!!!!!!!!!!!!!", "Kanto Embers"];
  const debugMatchLogs = [];

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

      // build owner_username -> rosterId map for override mapping
      const usernameToRoster = {};
      for (const rk in rosterMap) {
        if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
        const meta = rosterMap[rk] || {};
        if (meta.owner_username) usernameToRoster[String(meta.owner_username).toLowerCase()] = String(rk);
        if (meta.owner_name) usernameToRoster[String(meta.owner_name).toLowerCase()] = String(rk);
      }

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

      // PREP: if we have early2023 overrides for this season, prepare mapping
      let earlyOverridesThisSeason = null;
      if (early2023 && seasonEntry.season && String(seasonEntry.season) === '2023') {
        // Expect early2023 top-level keys are seasons, then week numbers
        try {
          const sKey = String(seasonEntry.season);
          if (early2023[sKey]) earlyOverridesThisSeason = early2023[sKey];
          else earlyOverridesThisSeason = null;
          messages.push('early2023 overrides present for season ' + sKey + ': ' + (earlyOverridesThisSeason ? Object.keys(earlyOverridesThisSeason).join(',') : 'none'));
        } catch (e) {
          earlyOverridesThisSeason = null;
          messages.push('Error parsing early2023[2023]: ' + (e?.message ?? String(e)));
        }
      }

      // loop weeks
      for (let week = 1; week <= MAX_WEEKS; week++) {
        let matchups = null;
        try { matchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 }); } catch (mwErr) { continue; }
        if (!matchups || !matchups.length) continue;

        // check if this week should be applied or skipped because it's the current, not-yet-complete week.
        // NOTE: caller earlier asked that "if the next week of games have zeros for teams scores that means the week is not over yet".
        // We will still respect that earlier logic by relying on the points in the matchups themselves (this code preserves earlier skip behaviour elsewhere).
        const isReg = (week >= 1 && week < playoffStart);
        const isPlay = (week >= playoffStart && week <= playoffEnd);
        if (!isReg && !isPlay) continue;

        const stats = isPlay ? statsPlay : statsReg;
        const results = isPlay ? resultsPlay : resultsReg;
        const pa = isPlay ? paPlay : paReg;

        // If we have early overrides for this season and week, build owner->score map
        let earlyOwnerScoreMap = null;
        if (earlyOverridesThisSeason && earlyOverridesThisSeason[String(week)]) {
          // earlyOverridesThisSeason[week] is an array of matchup objects
          earlyOwnerScoreMap = {}; // lower(ownerName) -> score
          try {
            const arr = earlyOverridesThisSeason[String(week)];
            for (const matchObj of arr) {
              // teamA.ownerName might be the owner_username; teamA.name is the team name
              const aOwnerRaw = (matchObj.teamA && (matchObj.teamA.ownerName ?? matchObj.teamA.ownername ?? matchObj.teamA.owner)) ?? null;
              const bOwnerRaw = (matchObj.teamB && (matchObj.teamB.ownerName ?? matchObj.teamB.ownername ?? matchObj.teamB.owner)) ?? null;
              if (aOwnerRaw != null) earlyOwnerScoreMap[String(aOwnerRaw).toLowerCase()] = safeNum(matchObj.teamAScore ?? matchObj.team_a_score ?? matchObj.teamAScore);
              if (bOwnerRaw != null) earlyOwnerScoreMap[String(bOwnerRaw).toLowerCase()] = safeNum(matchObj.teamBScore ?? matchObj.team_b_score ?? matchObj.teamBScore);
            }
            messages.push(`Applied early2023 overrides for season ${seasonEntry.season} week ${week} (${Object.keys(earlyOwnerScoreMap).length} owner scores)`);
          } catch (e) {
            earlyOwnerScoreMap = null;
            messages.push('Error building earlyOwnerScoreMap for season ' + seasonEntry.season + ' week ' + week + ' — ' + (e?.message ?? String(e)));
          }
        }

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
          if (!entries || entries.length === 0) continue;

          if (entries.length === 1) {
            // single entry - record pf but cannot compute head-to-head
            const only = entries[0];
            const ridOnly = only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId;
            // If earlyOwnerScoreMap exists, try to override by owner username mapping
            let ptsOnly = safeNum(only.points ?? only.points_for ?? only.pts ?? 0);
            try {
              if (earlyOwnerScoreMap && ridOnly != null) {
                const meta = rosterMap && rosterMap[ridOnly] ? rosterMap[ridOnly] : null;
                const ownerKeyRaw = meta && (meta.owner_username || meta.owner_name) ? String(meta.owner_username || meta.owner_name).toLowerCase() : null;
                if (ownerKeyRaw && Object.prototype.hasOwnProperty.call(earlyOwnerScoreMap, ownerKeyRaw)) {
                  ptsOnly = earlyOwnerScoreMap[ownerKeyRaw];
                }
              }
            } catch (e) {
              // ignore
            }
            pa[String(ridOnly)] = pa[String(ridOnly)] || 0;
            results[String(ridOnly)] = results[String(ridOnly)] || [];
            stats[String(ridOnly)] = stats[String(ridOnly)] || { wins:0, losses:0, ties:0, pf:0, pa:0 };
            stats[String(ridOnly)].pf += ptsOnly;
            // debug watch
            try {
              const teamName = rosterLatest[ridOnly] && rosterLatest[ridOnly].team_name ? rosterLatest[ridOnly].team_name : null;
              if (teamName && debugWatchTeamNames.includes(teamName)) {
                debugMatchLogs.push({
                  season: seasonEntry.season,
                  week,
                  matchup_key: mids[m],
                  rosterId: String(ridOnly),
                  team: teamName,
                  score: ptsOnly,
                  note: 'single-entry'
                });
              }
            } catch (e) {}
            continue;
          }

          // Build participants with rosterId, points, raw entry
          const participants = [];
          for (let p = 0; p < entries.length; p++) {
            const ent = entries[p];
            const pid = ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId;
            let ppts = safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0);

            // If early override exists for this owner, override the points by matching roster -> owner_username -> early map
            try {
              if (earlyOwnerScoreMap && pid != null) {
                const meta = rosterMap && rosterMap[pid] ? rosterMap[pid] : null;
                const ownerKeyRaw = meta && (meta.owner_username || meta.owner_name) ? String(meta.owner_username || meta.owner_name).toLowerCase() : null;
                if (ownerKeyRaw && Object.prototype.hasOwnProperty.call(earlyOwnerScoreMap, ownerKeyRaw)) {
                  ppts = earlyOwnerScoreMap[ownerKeyRaw];
                }
              }
            } catch (e) {
              // ignore overriding errors
            }

            participants.push({ rosterId: String(pid), points: ppts, raw: ent });
            pa[String(pid)] = pa[String(pid)] || 0;
            results[String(pid)] = results[String(pid)] || [];
            stats[String(pid)] = stats[String(pid)] || { wins:0, losses:0, ties:0, pf:0, pa:0 };
            stats[String(pid)].pf += ppts;
          }

          // Store debug logs for watched teams (every participant in this matchup that matches watch list)
          try {
            for (const part of participants) {
              const rmeta = rosterLatest[part.rosterId] || rosterMap[part.rosterId] || {};
              const tname = rmeta.team_name || null;
              if (tname && debugWatchTeamNames.includes(tname)) {
                // collect opponent(s)
                const opponents = participants.filter(x => x.rosterId !== part.rosterId).map(o => {
                  const om = rosterLatest[o.rosterId] || rosterMap[o.rosterId] || {};
                  return { rosterId: o.rosterId, team: om.team_name || ('Roster ' + o.rosterId), score: o.points };
                });
                debugMatchLogs.push({
                  season: seasonEntry.season,
                  week,
                  matchup_key: mids[m],
                  rosterId: part.rosterId,
                  team: tname,
                  score: part.points,
                  opponents
                });
              }
            }
          } catch (e) {
            // ignore debug collection issues
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
                  opponent_name: oppMeta2.team_name || (bestOpp2 ? ('Roster ' + bestOpp2.rosterId) : null),
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

  // append debugMatchLogs to messages for visibility
  if (debugMatchLogs.length) {
    messages.push('Debug — collected matchup logs for watched teams (first 100):');
    for (let i = 0; i < Math.min(100, debugMatchLogs.length); i++) {
      const m = debugMatchLogs[i];
      // if opponents were included, format them
      let oppStr = '';
      if (m.opponents && Array.isArray(m.opponents)) {
        oppStr = m.opponents.map(o => `${o.team}(${o.rosterId}): ${o.score}`).join(' vs ');
      }
      if (oppStr) {
        messages.push(`Season ${m.season} Wk${m.week} — ${m.team}(${m.rosterId}): ${m.score} — Opp: ${oppStr}`);
      } else if (m.opponent_name) {
        messages.push(`Season ${m.season} Wk${m.week} — ${m.team}(${m.rosterId}): ${m.score} — Opp: ${m.opponent_name} ${m.opponent_score ?? ''}`);
      } else {
        messages.push(`Season ${m.season} Wk${m.week} — ${m.team}(${m.rosterId}): ${m.score} — note: ${m.note ?? ''}`);
      }
    }
  } else {
    messages.push('No debug matchup logs for watched teams were found.');
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
