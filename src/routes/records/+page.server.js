// src/routes/records/+page.server.js
/**
 * Build all-time regular / playoff tables + other derived tables.
 * 
 * This variant:
 * - Loads per-season override JSON files from static/season_matchups/<season>.json (if present).
 *   Those files should match the structure you provided in your example: an object keyed by week
 *   string -> array of matchups with teamAScore/teamBScore, rosterId, names, etc.
 * - When an override exists for a season, the override scores are used rather than trying to
 *   compute scores from Sleeper participants.
 * - When using Sleeper API results (no override), team scores are computed **only** from
 *   starters_points (or similarly named fields). If starters points are not available, falls
 *   back to participant.points.
 * - Week completeness check: a week is skipped if any participant in that week has a score === 0,
 *   unless the week is the final playoff week (we include final playoff week even if zeros are present).
 * - Emits debug messages listing every matchup (season/week/matchup_id/team/opp/score) for teams:
 *     "The Emperors", "DAMN!!!!!!!!!!!!!!!!!", "Corey" (to match Corey's Shower), "Kanto Embers".
 */

import fs from 'fs/promises';
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

// canonical owner mapping (merge older owner keys)
const CANONICAL_OWNER_MAP = {
  'bellooshio': 'jakepratt',
  'cholybevv': 'jakepratt',
  // add more mappings as needed
};

// owners we want to preserve original records for (but exclude from canonicalized table)
const PRESERVE_ORIGINAL_OWNERS = ['bellooshio', 'cholybevv'];
const EXCLUDE_OWNER_KEYS = PRESERVE_ORIGINAL_OWNERS.map(k => String(k).toLowerCase());

// team debug names to match (case-insensitive substring match)
const DEBUG_TEAM_PATTERNS = [
  'the emperors',
  'damn!!!!!!!!!!!!!!!!!',
  'corey', // covers Corey's Shower
  'kanto embers'
];

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function normalizeTeamString(s) {
  if (!s) return '';
  return String(s).replace(/’/g, "'").toLowerCase();
}

// Read season override files from static/season_matchups
async function loadSeasonOverrides(messages) {
  const overrides = {};
  const staticDir = path.join(process.cwd(), 'static', 'season_matchups');
  try {
    const dirExists = await fs.stat(staticDir).then(s => s.isDirectory()).catch(() => false);
    if (!dirExists) {
      messages.push(`No override dir at ${staticDir} (fine; continuing without overrides).`);
      return overrides;
    }
    const files = await fs.readdir(staticDir);
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.json')) continue;
      const full = path.join(staticDir, f);
      try {
        const txt = await fs.readFile(full, 'utf8');
        const parsed = JSON.parse(txt);
        // determine season key from filename (strip extension)
        const seasonKey = path.basename(f, '.json');
        overrides[String(seasonKey)] = parsed;
        messages.push(`Loaded season override file: ${f} -> seasonKey "${seasonKey}"`);
      } catch (err) {
        messages.push(`Failed to parse override file ${f}: ${err?.message ?? String(err)}`);
      }
    }
  } catch (err) {
    messages.push(`Error reading season overrides: ${err?.message ?? String(err)}`);
  }
  return overrides;
}

/**
 * Extract a mapping of playerId -> points using starters_points or similar structures.
 * Returns {} if nothing useful found.
 */
function extractPlayerPointsMap(participant) {
  const map = {};
  if (!participant || typeof participant !== 'object') return map;

  // Common shapes tried in order
  // 1) starters_points: object or array
  // 2) player_points (object or array)
  // 3) player_points array with player ids list
  // 4) fallback to empty

  // helper to coerce value to number
  const toN = v => (v === null || v === undefined) ? null : (Number(v) || 0);

  // 1) starters_points
  const spCandidates = ['starters_points', 'startersPoints', 'starters_points_for', 'starters_points_for'];
  for (const key of spCandidates) {
    if (participant[key]) {
      const sp = participant[key];
      if (typeof sp === 'object' && !Array.isArray(sp)) {
        for (const k in sp) {
          if (!Object.prototype.hasOwnProperty.call(sp, k)) continue;
          map[String(k)] = toN(sp[k]);
        }
        return map;
      } else if (Array.isArray(sp)) {
        // if it's an array, attempt to align with participant.starters / participant.players
        const starters = participant.starters ?? participant.starting_lineup ?? participant.players ?? participant.player_ids ?? [];
        for (let i = 0; i < sp.length; i++) {
          const pid = starters && starters[i] ? String(starters[i]) : String(i);
          map[pid] = toN(sp[i]);
        }
        return map;
      }
    }
  }

  // 2) player_points (object)
  const ppCandidates = ['player_points', 'playerPoints', 'player_points_for', 'player_points_for_object'];
  for (const key of ppCandidates) {
    if (participant[key] && typeof participant[key] === 'object' && !Array.isArray(participant[key])) {
      for (const k in participant[key]) {
        if (!Object.prototype.hasOwnProperty.call(participant[key], k)) continue;
        map[String(k)] = toN(participant[key][k]);
      }
      if (Object.keys(map).length) return map;
    }
  }

  // 3) array of player objects
  const arrCandidates = ['players_points', 'player_points_array', 'points_by_player'];
  for (const key of arrCandidates) {
    const arr = participant[key];
    if (Array.isArray(arr)) {
      // attempt to pick up {player_id, points} style
      for (const item of arr) {
        if (!item) continue;
        const pid = item.player_id ?? item.player ?? item.id ?? null;
        const pts = item.points ?? item.pts ?? item.p ?? null;
        if (pid) map[String(pid)] = toN(pts);
      }
      if (Object.keys(map).length) return map;
    }
  }

  // 4) defensive: if participant.players + participant.player_points arrays align
  const playersList = participant.players ?? participant.player_ids ?? participant.playerIds;
  const playerPointsArr = participant.player_points ?? participant.playerPoints ?? null;
  if (Array.isArray(playersList) && Array.isArray(playerPointsArr) && playersList.length === playerPointsArr.length) {
    for (let i = 0; i < playersList.length; i++) {
      const pid = playersList[i];
      const pval = playerPointsArr[i];
      map[String(pid)] = toN((pval && pval.points) ? pval.points : pval);
    }
    return map;
  }

  return map;
}

/**
 * Compute a numeric scoreboard (teamA/teamB points) for a single matchup entry.
 * If matchOverride is present (from season override file) it will return that immediately.
 * If using a Sleeper participant entry (ent), this computes sum of starters_points only,
 * falling back to ent.points if no starters_points found.
 *
 * Return shape:
 *  { rosterId: '1', name: 'Team', ownerName: 'owner', points: 123.45, raw: ent }
 */
function buildParticipantFromOverrideEntry(roleObj) {
  // roleObj already contains rosterId/name/ownerName/teamAScore etc
  const rid = roleObj.rosterId ?? roleObj.roster_id ?? roleObj.roster ?? null;
  const name = roleObj.name ?? roleObj.teamName ?? roleObj.team ?? null;
  const owner = roleObj.ownerName ?? roleObj.owner ?? null;
  const pts = safeNum(roleObj.teamAScore ?? roleObj.points ?? roleObj.score ?? roleObj.teamAScore ?? roleObj.points_for ?? 0);
  return { rosterId: String(rid), name, ownerName: owner, points: Number(Math.round(pts * 100) / 100), raw: roleObj };
}

export async function load(event) {
  // cache headers
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const messages = [];

  // load season override files
  const seasonOverrides = await loadSeasonOverrides(messages);

  // try to load players dataset for names
  let playersMap = {};
  try {
    const rawPlayers = await sleeper.rawFetch(`/players/nba`);
    if (rawPlayers && typeof rawPlayers === 'object') {
      playersMap = rawPlayers;
      messages.push('Loaded players dataset (' + Object.keys(playersMap).length + ')');
    } else {
      messages.push('Players dataset empty/unexpected shape — continuing without.');
    }
  } catch (e) {
    messages.push('Failed to load players dataset: ' + (e?.message ?? String(e)));
    playersMap = {};
  }

  // Build seasons chain (walk previous_league_id)
  let seasons = [];
  try {
    const mainLeague = await sleeper.getLeague(String(BASE_LEAGUE_ID), { ttl: 60 * 5 });
    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id || BASE_LEAGUE_ID), season: mainLeague.season ?? null, name: mainLeague.name ?? null });
      let prev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let count = 0;
      while (prev && count < 50) {
        count++;
        try {
          const l = await sleeper.getLeague(prev, { ttl: 60 * 5 });
          if (!l) break;
          seasons.push({ league_id: String(l.league_id), season: l.season ?? null, name: l.name ?? null });
          prev = l.previous_league_id ? String(l.previous_league_id) : null;
        } catch (pe) {
          messages.push('Failed to fetch previous league ' + prev + ': ' + (pe?.message ?? String(pe)));
          break;
        }
      }
    } else {
      messages.push('Could not fetch base league ' + BASE_LEAGUE_ID);
    }
  } catch (err) {
    messages.push('Error building seasons chain: ' + (err?.message ?? String(err)));
  }

  // dedupe/sort seasons ascending by season number (or league_id fallback)
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = s;
  seasons = Object.values(byId).sort((a,b) => {
    const as = a.season != null ? Number(a.season) : Number(a.league_id);
    const bs = b.season != null ? Number(b.season) : Number(b.league_id);
    return as - bs;
  });

  // START aggregators & trackers
  const rosterLatest = {};
  const agg = {};
  const originalAgg = {};
  const headToHeadRaw = {};
  const allMatchMarginCandidates = [];
  const topTeamCandidates = [];
  const topPlayerCandidates = [];
  const seasonMatchupsGenerated = {}; // will contain the final per-season JSON (either overrides or generated)
  const ownersSeen = new Set();

  // helper to add a debug line
  function pushDebugLine(line) {
    messages.push(line);
  }

  // helper to detect debug teams in a matchup object (teamA/teamB)
  function pushDebugIfMatches(seasonKey, week, mobj) {
    try {
      const tA = normalizeTeamString(mobj.teamA?.name || mobj.teamA?.team || mobj.teamA?.ownerName || '');
      const tB = normalizeTeamString(mobj.teamB?.name || mobj.teamB?.team || mobj.teamB?.ownerName || '');
      for (const pat of DEBUG_TEAM_PATTERNS) {
        if ((tA && tA.includes(pat)) || (tB && tB.includes(pat))) {
          // build a readable line
          const s = `DBG: season=${seasonKey} week=${week} matchup_id=${mobj.matchup_id ?? mobj.matchupId ?? 'null'} -- ${mobj.teamA?.name ?? mobj.teamA?.team ?? 'A'} (${mobj.teamAScore ?? mobj.teamA?.points ?? mobj.teamA?.score ?? 'N/A'}) vs ${mobj.teamB?.name ?? mobj.teamB?.team ?? 'B'} (${mobj.teamBScore ?? mobj.teamB?.points ?? mobj.teamB?.score ?? 'N/A'})`;
          pushDebugLine(s);
          break;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // iterate seasons and build matchups/aggregations
  for (let si = 0; si < seasons.length; si++) {
    const se = seasons[si];
    const leagueId = String(se.league_id);
    const seasonKey = se.season != null ? String(se.season) : String(se.league_id);

    // attempt to pull roster map for team/owner display
    let rosterMap = {};
    try {
      rosterMap = await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 }) || {};
      // seed rosterLatest
      for (const rk in rosterMap) {
        if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
        const m = rosterMap[rk] || {};
        rosterLatest[String(rk)] = {
          team_name: m.team_name ?? m.owner_name ?? ('Roster ' + rk),
          team_avatar: m.team_avatar ?? m.owner_avatar ?? null,
          owner_username: m.owner_username ?? null,
          owner_name: m.owner_name ?? null
        };
      }
    } catch (rmErr) {
      messages.push(`Could not fetch roster map for league ${leagueId}: ${rmErr?.message ?? String(rmErr)}`);
      rosterMap = {};
    }

    // per-season trackers
    const statsReg = {}; const resultsReg = {}; const paReg = {};
    const statsPlay = {}; const resultsPlay = {}; const paPlay = {};

    // initialize trackers from rosterMap
    for (const rk in rosterMap) {
      statsReg[rk] = { wins:0, losses:0, ties:0, pf:0, pa:0 };
      resultsReg[rk] = [];
      paReg[rk] = 0;
      statsPlay[rk] = { wins:0, losses:0, ties:0, pf:0, pa:0 };
      resultsPlay[rk] = [];
      paPlay[rk] = 0;
    }

    // get league metadata to determine playoff window
    let leagueMeta = null;
    try { leagueMeta = await sleeper.getLeague(leagueId, { ttl: 60 * 10 }); } catch (e) { leagueMeta = null; }
    let playoffStart = 15;
    if (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) {
      const ps = Number(leagueMeta.settings.playoff_week_start);
      if (!isNaN(ps) && ps >= 1) playoffStart = ps;
    }
    // assume +2 playoff rounds unless specified otherwise (same as previous)
    const playoffEnd = playoffStart + 2;

    // season matchups container
    seasonMatchupsGenerated[seasonKey] = seasonMatchupsGenerated[seasonKey] || {};

    // iterate weeks
    for (let week = 1; week <= MAX_WEEKS; week++) {
      // only process weeks that are regular or playoff window
      const isReg = (week >= 1 && week < playoffStart);
      const isPlay = (week >= playoffStart && week <= playoffEnd);
      if (!isReg && !isPlay) continue;

      // If we have an override for this season and week, use it
      const overrideThisSeason = seasonOverrides[seasonKey] ?? null;
      let weekMatchupsFromOverride = null;
      if (overrideThisSeason && Object.prototype.hasOwnProperty.call(overrideThisSeason, String(week))) {
        weekMatchupsFromOverride = overrideThisSeason[String(week)];
      }

      // if override exists, use that week list; otherwise fetch from API
      let rawMatchupEntries = null;
      if (weekMatchupsFromOverride) {
        // transform to a uniform shape similar to what API returns (array of 'entries')
        // The override format uses objects containing teamA/teamB with scores; we will convert to an "entries" array
        rawMatchupEntries = [];
        // each override item is a matchup; create two participant objects if teamB exists
        for (const m of weekMatchupsFromOverride) {
          // store the original override in seasonMatchupsGenerated as-is for UI
          // (the consumer will see the override JSON)
          if (!seasonMatchupsGenerated[seasonKey][String(week)]) seasonMatchupsGenerated[seasonKey][String(week)] = [];
          seasonMatchupsGenerated[seasonKey][String(week)].push(m);

          // push for debug detection
          pushDebugIfMatches(seasonKey, week, m);

          // Build a synthetic "entries" array similar to the API participant objects.
          // We'll put enough fields that extractPlayerPointsMap() won't be used; instead, we'll use override scores directly.
          const matchId = m.matchup_id ?? null;
          if (m.teamA) {
            rawMatchupEntries.push({
              matchup_id: matchId,
              week: week,
              roster_id: String(m.teamA.rosterId ?? m.teamA.roster_id ?? m.teamA.roster ?? 'A'),
              team_name: m.teamA.name ?? m.teamA.team ?? null,
              owner_username: m.teamA.ownerName ?? m.teamA.owner ?? null,
              override_points: Number(safeNum(m.teamAScore ?? m.teamA.points ?? 0)),
              _override_obj: m
            });
          }
          if (m.teamB) {
            rawMatchupEntries.push({
              matchup_id: matchId,
              week: week,
              roster_id: String(m.teamB.rosterId ?? m.teamB.roster_id ?? m.teamB.roster ?? 'B'),
              team_name: m.teamB.name ?? m.teamB.team ?? null,
              owner_username: m.teamB.ownerName ?? m.teamB.owner ?? null,
              override_points: Number(safeNum(m.teamBScore ?? m.teamB.points ?? 0)),
              _override_obj: m
            });
          }
        }
      } else {
        // No override — fetch matchups from API for that week
        try {
          const fetched = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 });
          // normalize to array
          if (Array.isArray(fetched)) rawMatchupEntries = fetched;
          else rawMatchupEntries = Array.isArray(fetched?.matchups) ? fetched.matchups : [];
        } catch (err) {
          messages.push(`Failed to fetch matchups for league ${leagueId} week ${week}: ${err?.message ?? String(err)}`);
          rawMatchupEntries = [];
        }
      }

      // If no matchups found, continue
      if (!rawMatchupEntries || rawMatchupEntries.length === 0) continue;

      // Determine if week is incomplete: if any participant has a score exactly equal to 0.
      // Note: if this week is the final playoff week, we IGNORE the zero-check and always include.
      // Also: if we are using override data, we assume it's complete (overrides come from your saved final scores).
      let weekIncomplete = false;
      if (!weekMatchupsFromOverride) {
        try {
          for (const ent of rawMatchupEntries) {
            // We attempt to derive points:
            // prefer starters_points-derived sum (we compute later), but here we detect explicit participant points if present.
            // Some API shapes have participant.points, participant.points_for, or aggregated fields.
            const pCandidates = ['points', 'points_for', 'points_for_display', 'score', 'total_points'];
            let pval = null;
            for (const pk of pCandidates) {
              if (ent[pk] !== undefined && ent[pk] !== null) { pval = ent[pk]; break; }
            }
            // If ent.override_points present (synthetic), use that
            if (ent.override_points !== undefined && ent.override_points !== null) pval = ent.override_points;
            // if still null, try to compute starters_points quickly here: participant.starters_points or player_points object sum
            if (pval === null || pval === undefined) {
              // Attempt to extract a quick starters_points sum if present; don't call heavy helper here.
              if (ent.starters_points && (typeof ent.starters_points === 'object' || Array.isArray(ent.starters_points))) {
                if (Array.isArray(ent.starters_points)) {
                  pval = ent.starters_points.reduce((s, v) => s + (Number(v) || 0), 0);
                } else {
                  pval = Object.values(ent.starters_points).reduce((s, v) => s + (Number(v) || 0), 0);
                }
              } else if (ent.player_points && typeof ent.player_points === 'object') {
                pval = Object.values(ent.player_points).reduce((s,v) => s + (Number(v) || 0), 0);
              }
            }
            // If pval is still null, set to 0 to be conservative
            const num = (pval === null || pval === undefined) ? 0 : Number(pval || 0);
            if (num === 0) {
              weekIncomplete = true;
              break;
            }
          }
        } catch (e) {
          // in uncertain case, leave weekIncomplete = false (we won't skip)
          weekIncomplete = false;
        }
      } else {
        // override present => treat as complete (don't mark incomplete)
        weekIncomplete = false;
      }

      // If the week is incomplete and it's NOT the final playoff week, skip it.
      if (weekIncomplete && !(isPlay && week === playoffEnd)) {
        messages.push(`Skipping season=${seasonKey} week=${week} (incomplete: a participant had 0 points).`);
        continue;
      }

      // Build participant arrays grouped by logical matchup
      // We'll build byMatch keyed by matchup_id|week or generated key
      const byMatch = {};
      for (let mi = 0; mi < rawMatchupEntries.length; mi++) {
        const e = rawMatchupEntries[mi];
        const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
        const wk = e.week ?? e.w ?? week;
        const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
        if (!byMatch[key]) byMatch[key] = [];
        byMatch[key].push(e);
      }

      // For each matchup group, build participants using either override points or extracted starters_points
      const matchKeys = Object.keys(byMatch);
      for (const mk of matchKeys) {
        const entries = byMatch[mk];
        if (!entries || entries.length === 0) continue;

        // participants array for aggregator
        const participants = [];
        for (const ent of entries) {
          // If ent has _override_obj or override_points, prefer that
          if (ent._override_obj || (ent.override_points !== undefined && ent.override_points !== null)) {
            // Build a participant using the override role (we need rosterId and points)
            const rid = ent.roster_id ?? ent.rosterId ?? ent.roster ?? String(Math.random()).slice(2,8);
            const pts = safeNum(ent.override_points ?? ent._override_obj?.teamAScore ?? ent._override_obj?.teamBScore ?? 0);
            participants.push({ rosterId: String(rid), points: Number(Math.round(pts * 100) / 100), raw: ent });
            // push debug for override matchups (already pushed when reading overrides, but do it again for completeness)
            if (ent._override_obj) pushDebugIfMatches(seasonKey, week, ent._override_obj);
            continue;
          }

          // No override — compute score from starters_points ONLY
          let computedScore = null;
          try {
            const pm = extractPlayerPointsMap(ent);
            if (pm && Object.keys(pm).length) {
              // Try to align with ent.starters (array) if present
              let starters = ent.starters ?? ent.starting_lineup ?? ent.players ?? ent.player_ids ?? [];
              if (!Array.isArray(starters)) starters = [];
              if (starters && starters.length && Object.keys(pm).length) {
                let sum = 0;
                for (let si = 0; si < starters.length; si++) {
                  const pid = String(starters[si] ?? '');
                  if (pid && Object.prototype.hasOwnProperty.call(pm, pid)) sum += Number(pm[pid] || 0);
                  else if (pid && Object.prototype.hasOwnProperty.call(pm, pid.toUpperCase())) sum += Number(pm[pid.toUpperCase()] || 0);
                }
                computedScore = sum;
              } else {
                // pm had entries keyed by player id — sum all values (safe)
                let sum = 0;
                for (const k in pm) {
                  if (!Object.prototype.hasOwnProperty.call(pm, k)) continue;
                  sum += Number(pm[k] || 0);
                }
                computedScore = sum;
              }
            }
          } catch (e) {
            computedScore = null;
          }

          // fallback to participant.points only if computedScore is null
          if (computedScore === null) {
            const fallbackCandidates = ['points', 'points_for', 'pts', 'score'];
            let fallback = null;
            for (const fk of fallbackCandidates) {
              if (ent[fk] !== undefined && ent[fk] !== null) { fallback = ent[fk]; break; }
            }
            computedScore = safeNum(fallback ?? 0);
          }

          const rid2 = ent.roster_id ?? ent.rosterId ?? ent.roster ?? ('roster:' + Math.random().toString(36).slice(2,8));
          participants.push({ rosterId: String(rid2), points: Number(Math.round((computedScore || 0) * 100) / 100), raw: ent });
        } // end participants building

        // Now use participants array to:
        // - update topTeamCandidates & topPlayerCandidates
        // - update margins list
        // - update statsReg/statsPlay and headToHeadRaw

        // canonical winner / margin logic (for multi-team matchups we consider top vs second)
        if (participants.length >= 2) {
          const sorted = participants.slice().sort((a,b) => (b.points || 0) - (a.points || 0));
          const winner = sorted[0];
          const runner = sorted[1];
          const margin = Number(Math.round(((winner.points || 0) - (runner.points || 0)) * 100) / 100);
          if (Math.abs(margin) > 1e-9) {
            const winMeta = rosterLatest[winner.rosterId] || {};
            const runMeta = rosterLatest[runner.rosterId] || {};
            allMatchMarginCandidates.push({
              team_rosterId: winner.rosterId,
              team_name: winMeta.team_name || null,
              team_avatar: winMeta.team_avatar || null,
              opponent_rosterId: runner.rosterId,
              opponent_name: runMeta.team_name || null,
              opponent_avatar: runMeta.team_avatar || null,
              winning_score: winner.points,
              losing_score: runner.points,
              margin,
              season: se.season,
              week
            });
          }
        }

        // topTeamCandidates
        for (const part of participants) {
          const other = participants.filter(x => x.rosterId !== part.rosterId);
          const bestOpp = other.length ? other.slice().sort((a,b) => (b.points || 0) - (a.points || 0))[0] : null;
          const teamMeta = rosterLatest[part.rosterId] || rosterMap[part.rosterId] || {};
          const oppMeta = bestOpp ? (rosterLatest[bestOpp.rosterId] || rosterMap[bestOpp.rosterId] || {}) : {};
          topTeamCandidates.push({
            team_rosterId: part.rosterId,
            team_name: teamMeta.team_name || teamMeta.owner_name || null,
            team_avatar: teamMeta.team_avatar || teamMeta.owner_avatar || null,
            opponent_rosterId: bestOpp ? bestOpp.rosterId : null,
            opponent_name: bestOpp ? (oppMeta.team_name || oppMeta.owner_name) : null,
            opponent_avatar: oppMeta.team_avatar || null,
            team_score: part.points || 0,
            opponent_score: bestOpp ? bestOpp.points || 0 : 0,
            season: se.season,
            week
          });
        }

        // topPlayerCandidates: inspect each participant raw starters and add per-player entries
        for (const p of participants) {
          const entRaw = p.raw || {};
          const playerPointsMap = extractPlayerPointsMap(entRaw);
          let starters = entRaw.starters ?? entRaw.starting_lineup ?? entRaw.players ?? entRaw.player_ids ?? [];
          if (!Array.isArray(starters)) starters = [];
          for (const pid of starters) {
            if (!pid) continue;
            const pidStr = String(pid);
            let pts = null;
            if (Object.prototype.hasOwnProperty.call(playerPointsMap, pidStr)) pts = Number(playerPointsMap[pidStr]);
            else if (Object.prototype.hasOwnProperty.call(playerPointsMap, pidStr.toUpperCase())) pts = Number(playerPointsMap[pidStr.toUpperCase()]);
            if (pts == null || isNaN(pts)) continue;
            const playerObj = playersMap[pidStr] || playersMap[pidStr.toUpperCase()] || null;
            const playerName = playerObj ? (playerObj.full_name || (playerObj.first_name ? (playerObj.first_name + ' ' + playerObj.last_name) : pidStr)) : pidStr;
            const teamMeta = rosterLatest[p.rosterId] || rosterMap[p.rosterId] || {};
            const otherArr = participants.filter(x => x.rosterId !== p.rosterId);
            const bestOpp = otherArr.length ? otherArr.slice().sort((a,b)=>(b.points||0)-(a.points||0))[0] : null;
            const oppMeta = bestOpp ? (rosterLatest[bestOpp.rosterId] || rosterMap[bestOpp.rosterId] || {}) : {};
            topPlayerCandidates.push({
              player_id: pidStr,
              player_name: playerName,
              points: Number(Math.round(pts * 100) / 100),
              team_rosterId: p.rosterId,
              team_name: teamMeta.team_name || teamMeta.owner_name || null,
              team_avatar: teamMeta.team_avatar || null,
              opponent_rosterId: bestOpp ? bestOpp.rosterId : null,
              opponent_name: bestOpp ? (oppMeta.team_name || oppMeta.owner_name) : null,
              opponent_avatar: oppMeta.team_avatar || null,
              season: se.season,
              week
            });
          }
        }

        // compute W/L/T relative to opponents average (used for wins/losses)
        for (const part of participants) {
          const opps = participants.filter(x => x.rosterId !== part.rosterId);
          let oppAvg = 0;
          if (opps.length) {
            for (const o of opps) oppAvg += o.points || 0;
            oppAvg = oppAvg / opps.length;
          }
          const paRef = (isPlay ? paPlay : paReg);
          const statsRef = (isPlay ? statsPlay : statsReg);
          const resultsRef = (isPlay ? resultsPlay : resultsReg);

          paRef[part.rosterId] = paRef[part.rosterId] || 0;
          statsRef[part.rosterId] = statsRef[part.rosterId] || { wins:0, losses:0, ties:0, pf:0, pa:0 };
          resultsRef[part.rosterId] = resultsRef[part.rosterId] || [];

          paRef[part.rosterId] += oppAvg;
          statsRef[part.rosterId].pf += Number(Math.round((part.points || 0) * 100) / 100);

          if ((part.points || 0) > oppAvg + 1e-9) {
            resultsRef[part.rosterId].push('W');
            statsRef[part.rosterId].wins += 1;
          } else if ((part.points || 0) < oppAvg - 1e-9) {
            resultsRef[part.rosterId].push('L');
            statsRef[part.rosterId].losses += 1;
          } else {
            resultsRef[part.rosterId].push('T');
            statsRef[part.rosterId].ties += 1;
          }
        }

        // Update headToHeadRaw per pair
        for (let a = 0; a < participants.length; a++) {
          for (let b = 0; b < participants.length; b++) {
            if (a === b) continue;
            const A = participants[a], B = participants[b];
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

      } // end matchKeys loop
    } // end weeks loop

    // After processing all weeks in season, aggregate per-roster stats into per-owner agg
    function buildAndMerge(statsByRoster, resultsByRoster, paByRoster, isPlay) {
      let rosterKeys = Object.keys(resultsByRoster);
      if (rosterKeys.length === 0 && rosterMap) rosterKeys = Object.keys(rosterMap);

      for (const rk of rosterKeys) {
        const s = statsByRoster[rk] || { wins:0, losses:0, ties:0, pf:0, pa:0 };
        const wins = s.wins || 0;
        const losses = s.losses || 0;
        const pfV = Math.round((s.pf || 0) * 100) / 100;
        const paV = Math.round((paByRoster[rk] || s.pa || 0) * 100) / 100;

        // determine owner key from rosterLatest (owner_username preferred) else fallback to roster:ID
        const meta = rosterLatest[rk] || {};
        const owner_username = meta.owner_username ?? null;
        const owner_name = meta.owner_name ?? null;
        const team_name = meta.team_name ?? meta.owner_name ?? ('Roster ' + rk);
        const avatar = meta.team_avatar ?? meta.owner_avatar ?? null;

        const rawOwnerKey = owner_username ? String(owner_username).toLowerCase() : (owner_name ? String(owner_name).toLowerCase() : ('roster:' + rk));
        // preserve originalAgg
        if (!originalAgg[rawOwnerKey]) {
          originalAgg[rawOwnerKey] = {
            ownerKey: rawOwnerKey,
            owner_username,
            owner_name,
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
        }

        if (isPlay) {
          originalAgg[rawOwnerKey].playoffWins += wins;
          originalAgg[rawOwnerKey].playoffLosses += losses;
          originalAgg[rawOwnerKey].playoffPF += pfV;
          originalAgg[rawOwnerKey].playoffPA += paV;
        } else {
          originalAgg[rawOwnerKey].regWins += wins;
          originalAgg[rawOwnerKey].regLosses += losses;
          originalAgg[rawOwnerKey].regPF += pfV;
          originalAgg[rawOwnerKey].regPA += paV;
          const res = resultsByRoster[rk] && Array.isArray(resultsByRoster[rk]) ? resultsByRoster[rk] : [];
          if (res.length) originalAgg[rawOwnerKey].regResults = originalAgg[rawOwnerKey].regResults.concat(res);
        }

        // canonicalize to aggregated owner
        const canonical = CANONICAL_OWNER_MAP[rawOwnerKey] || rawOwnerKey;
        if (!agg[canonical]) {
          agg[canonical] = {
            ownerKey: canonical,
            owner_username: canonical === 'jakepratt' ? 'jakepratt' : owner_username,
            owner_name: canonical === 'jakepratt' ? 'JakePratt' : owner_name,
            latest_team: team_name,
            latest_avatar: avatar,
            regWins: 0, regLosses: 0, regPF: 0, regPA: 0,
            playoffWins: 0, playoffLosses: 0, playoffPF: 0, playoffPA: 0,
            championships: 0,
            regResults: []
          };
        } else {
          agg[canonical].latest_team = team_name;
          if (avatar) agg[canonical].latest_avatar = avatar;
          if (!agg[canonical].owner_username && owner_username) agg[canonical].owner_username = owner_username;
          if (!agg[canonical].owner_name && owner_name) agg[canonical].owner_name = owner_name;
        }

        if (isPlay) {
          agg[canonical].playoffWins += wins;
          agg[canonical].playoffLosses += losses;
          agg[canonical].playoffPF += pfV;
          agg[canonical].playoffPA += paV;
        } else {
          agg[canonical].regWins += wins;
          agg[canonical].regLosses += losses;
          agg[canonical].regPF += pfV;
          agg[canonical].regPA += paV;
          const res2 = resultsByRoster[rk] && Array.isArray(resultsByRoster[rk]) ? resultsByRoster[rk] : [];
          if (res2.length) agg[canonical].regResults = agg[canonical].regResults.concat(res2);
        }

        ownersSeen.add(canonical);
      } // end rosterKeys
    }

    // merge reg & play
    buildAndMerge(statsReg, resultsReg, paReg, false);
    buildAndMerge(statsPlay, resultsPlay, paPlay, true);

  } // end seasons loop

  // compute max streaks
  function computeMaxStreaksFromResults(resultsArr) {
    let maxW = 0, maxL = 0, curW = 0, curL = 0;
    for (const r of resultsArr || []) {
      if (r === 'W') { curW++; curL = 0; if (curW > maxW) maxW = curW; }
      else if (r === 'L') { curL++; curW = 0; if (curL > maxL) maxL = curL; }
      else { curW = 0; curL = 0; }
    }
    return { maxW, maxL };
  }

  // Build arrays for UI tables
  const regularAllTime = [];
  const playoffAllTime = [];

  for (const k in agg) {
    if (!Object.prototype.hasOwnProperty.call(agg, k)) continue;
    if (EXCLUDE_OWNER_KEYS.indexOf(String(k).toLowerCase()) !== -1) continue;
    const a = agg[k];
    const streaks = computeMaxStreaksFromResults(a.regResults || []);
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
      maxWinStreak: streaks.maxW || 0,
      maxLoseStreak: streaks.maxL || 0,
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

  // sort regular table
  regularAllTime.sort((a,b) => {
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    return (b.pf || 0) - (a.pf || 0);
  });

  // sort playoff table
  playoffAllTime.sort((a,b) => {
    if ((b.championships || 0) !== (a.championships || 0)) return (b.championships || 0) - (a.championships || 0);
    if ((b.playoffWins || 0) !== (a.playoffWins || 0)) return (b.playoffWins || 0) - (a.playoffWins || 0);
    return (b.pf || 0) - (a.pf || 0);
  });

  // topTeamMatchups & topPlayerMatchups & margins lists from candidate arrays
  const largestMargins = allMatchMarginCandidates.slice().sort((a,b) => (b.margin || 0) - (a.margin || 0)).slice(0, 10);
  const closestMatches = allMatchMarginCandidates.slice().sort((a,b) => (Math.abs(a.margin || 0) - Math.abs(b.margin || 0))).filter(x => Math.abs(x.margin || 0) > 1e-9).slice(0, 10);

  const topTeamMatchups = topTeamCandidates.slice().sort((a,b) => (b.team_score || 0) - (a.team_score || 0)).slice(0, 10);
  const topPlayerMatchups = topPlayerCandidates.slice().sort((a,b) => (b.points || 0) - (a.points || 0)).slice(0, 10);

  // Convert headToHeadRaw roster->roster into canonical owner aggregated headToHeadByOwner
  const headToHeadByOwner = {};
  // build roster -> ownerKey map based on rosterLatest / canonical map
  const rosterToOwner = {};
  for (const r in rosterLatest) {
    const m = rosterLatest[r] || {};
    const raw = (m.owner_username ? String(m.owner_username).toLowerCase() : (m.owner_name ? String(m.owner_name).toLowerCase() : ('roster:' + r)));
    rosterToOwner[r] = CANONICAL_OWNER_MAP[raw] || raw;
  }

  function ensureHeadMap(ownerKey, oppKey) {
    headToHeadByOwner[ownerKey] = headToHeadByOwner[ownerKey] || {};
    if (!headToHeadByOwner[ownerKey][oppKey]) {
      headToHeadByOwner[ownerKey][oppKey] = {
        opponent_ownerKey: oppKey,
        opponent_name: null,
        opponent_avatar: null,
        regWins:0, regLosses:0, regPF:0, regPA:0,
        playWins:0, playLosses:0, playPF:0, playPA:0
      };
    }
    return headToHeadByOwner[ownerKey][oppKey];
  }

  for (const aRid in headToHeadRaw) {
    for (const bRid in headToHeadRaw[aRid]) {
      const rec = headToHeadRaw[aRid][bRid];
      const aOwner = rosterToOwner[aRid] || ('roster:' + aRid);
      const bOwner = rosterToOwner[bRid] || ('roster:' + bRid);
      if (!aOwner || !bOwner || aOwner === bOwner) continue;
      const out = ensureHeadMap(aOwner, bOwner);
      out.regWins += rec.regWins || 0;
      out.regLosses += rec.regLosses || 0;
      out.regPF += rec.regPF || 0;
      out.regPA += rec.regPA || 0;
      out.playWins += rec.playWins || 0;
      out.playLosses += rec.playLosses || 0;
      out.playPF += rec.playPF || 0;
      out.playPA += rec.playPA || 0;
      // attach display meta from rosterLatest or agg
      const oppMeta = rosterLatest[bRid] || {};
      out.opponent_name = out.opponent_name || oppMeta.team_name || (agg[bOwner] && agg[bOwner].latest_team) || bOwner;
      out.opponent_avatar = out.opponent_avatar || oppMeta.team_avatar || (agg[bOwner] && agg[bOwner].latest_avatar) || null;
    }
  }

  // convert inner maps to arrays sorted by wins
  const headToHeadByOwnerArr = {};
  for (const ok in headToHeadByOwner) {
    const inner = headToHeadByOwner[ok];
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
        regWins,
        regLosses,
        regGP: regWins + regLosses,
        regPF: Math.round((r.regPF || 0) * 100) / 100,
        regPA: Math.round((r.regPA || 0) * 100) / 100,
        playWins,
        playLosses,
        playGP: playWins + playLosses,
        playPF: Math.round((r.playPF || 0) * 100) / 100,
        playPA: Math.round((r.playPA || 0) * 100) / 100
      };
    });
    arr.sort((a,b) => (b.regWins || 0) - (a.regWins || 0));
    headToHeadByOwnerArr[ok] = arr;
  }

  // ownersList
  const ownersList = [];
  for (const k of Object.keys(agg)) {
    const a = agg[k];
    ownersList.push({
      ownerKey: a.ownerKey,
      owner_username: a.owner_username,
      owner_name: a.owner_name,
      team: a.latest_team,
      team_avatar: a.latest_avatar
    });
  }
  ownersList.sort((a,b) => (a.team || '').localeCompare(b.team || ''));

  // originalRecords for preserved owners
  const originalRecords = {};
  for (const p of PRESERVE_ORIGINAL_OWNERS) {
    const key = String(p).toLowerCase();
    if (originalAgg[key]) {
      const o = originalAgg[key];
      originalRecords[key] = {
        owner_username: o.owner_username || p,
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
        owner_username: p,
        owner_name: null,
        team: null,
        avatar: null,
        regWins: 0, regLosses: 0, regPF: 0, regPA: 0,
        playoffWins: 0, playoffLosses: 0, playoffPF: 0, playoffPA: 0,
        championships: 0
      };
    }
  }

  // Final messages summary
  messages.push(`Processed ${seasons.length} seasons; generated seasonMatchups keys: ${Object.keys(seasonMatchupsGenerated).join(', ')}`);

  // return shape (the Records page expects these keys)
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
    headToHeadByOwner: headToHeadByOwnerArr,
    ownersList,
    players: playersMap,
    seasonMatchups: seasonMatchupsGenerated
  };
}
