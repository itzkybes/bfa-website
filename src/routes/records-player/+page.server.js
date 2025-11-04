// src/routes/records-player/+page.server.js
// Records (player MVPs, team playoff leaders, cross-season bests)
// JSON-first: use season_matchups/*.json for historical seasons when present
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { readFile } from 'fs/promises';
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

/* -----------------------------
   Helpers copied / adapted from honor-hall
   ----------------------------- */

async function tryLoadLocalSeasonMatchups(key) {
  if (!key) return null;
  const candidates = [
    path.join(process.cwd(), 'season_matchups', `${key}.json`),
    path.join(process.cwd(), 'static', 'season_matchups', `${key}.json`),
    path.join(process.cwd(), 'src', 'season_matchups', `${key}.json`)
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, 'utf8');
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        return { parsedRaw: parsed, path: p };
      } catch (e) { /* parse error -> continue */ }
    } catch (e) { /* missing file -> continue */ }
  }
  return null;
}

async function fetchPlayersMap() {
  try {
    // if sleeper client has getPlayers helper, use it
    if (sleeper && typeof sleeper.getPlayers === 'function') {
      const map = await sleeper.getPlayers('nba', { ttl: 60 * 60 });
      if (map && typeof map === 'object') return map;
    }
  } catch (e) { /* ignore and fallback */ }
  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nba');
    if (!res.ok) return {};
    const obj = await res.json();
    return obj || {};
  } catch (e) {
    return {};
  }
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

/* Compute Finals MVP and Overall MVP using the approach from honor-hall.
   - finalsMvp: highest scorer in the championship matchup (only players who play in that matchup are eligible)
   - overallMvp: top aggregated season total (weeks 1..playoffEnd when fullSeasonMatchupsRows is provided)
*/
async function computeMvpsFromMatchups(matchupsRows, playoffStart, playoffEnd, rosterMap, finalRes, fullSeasonMatchupsRows = null) {
  const debug = [];
  const playoffPlayers = {}; // pid -> { points, byRoster }
  const seasonPlayers = {}; // pid -> { points, byRoster }

  function note(playersObj, pid, pts, rosterId) {
    if (!pid || pid === '0' || pid === 0) return;
    const id = String(pid);
    if (!playersObj[id]) playersObj[id] = { points: 0, byRoster: {} };
    playersObj[id].points += Number(pts) || 0;
    if (rosterId) {
      playersObj[id].byRoster[rosterId] = (playersObj[id].byRoster[rosterId] || 0) + (Number(pts) || 0);
    }
  }

  // --- playoffs aggregation (for Finals MVP) ---
  for (const r of matchupsRows) {
    if (!r || !r.week) continue;
    const wk = Number(r.week);
    if (isNaN(wk)) continue;
    if (wk < playoffStart || wk > playoffEnd) continue;

    for (const side of ['teamA', 'teamB']) {
      const t = r[side];
      if (!t) continue;
      if (Array.isArray(t.starters) && Array.isArray(t.starters_points) && t.starters.length === t.starters_points.length) {
        for (let i = 0; i < t.starters.length; i++) {
          const pid = t.starters[i];
          const pts = t.starters_points[i];
          note(playoffPlayers, pid, pts, t.rosterId ?? null);
        }
      } else if (Array.isArray(t.player_points)) {
        for (const pp of t.player_points) {
          if (!pp) continue;
          if (pp.player_id || pp.playerId) note(playoffPlayers, pp.player_id ?? pp.playerId, pp.points ?? pp.pts ?? 0, t.rosterId ?? null);
        }
      } else if (t.player_points && typeof t.player_points === 'object') {
        for (const pidKey of Object.keys(t.player_points || {})) {
          const ppts = safeNum(t.player_points[pidKey]);
          note(playoffPlayers, pidKey, ppts, t.rosterId ?? null);
        }
      }
    }
  }

  // --- season aggregation (for Overall MVP) ---
  if (fullSeasonMatchupsRows && Array.isArray(fullSeasonMatchupsRows) && fullSeasonMatchupsRows.length) {
    for (const r of fullSeasonMatchupsRows) {
      if (!r || !r.week) continue;
      const wk = Number(r.week);
      if (isNaN(wk)) continue;
      if (wk < 1 || wk > playoffEnd) continue;
      for (const side of ['teamA', 'teamB']) {
        const t = r[side];
        if (!t) continue;
        if (Array.isArray(t.starters) && Array.isArray(t.starters_points) && t.starters.length === t.starters_points.length) {
          for (let i = 0; i < t.starters.length; i++) {
            const pid = t.starters[i];
            const pts = t.starters_points[i];
            note(seasonPlayers, pid, pts, t.rosterId ?? null);
          }
        } else if (Array.isArray(t.player_points)) {
          for (const pp of t.player_points) {
            if (!pp) continue;
            if (pp.player_id || pp.playerId) note(seasonPlayers, pp.player_id ?? pp.playerId, pp.points ?? pp.pts ?? 0, t.rosterId ?? null);
          }
        } else if (t.player_points && typeof t.player_points === 'object') {
          for (const pidKey of Object.keys(t.player_points || {})) {
            const ppts = safeNum(t.player_points[pidKey]);
            note(seasonPlayers, pidKey, ppts, t.rosterId ?? null);
          }
        }
      }
    }
  } else {
    debug.push('No fullSeasonMatchupsRows provided — overall MVP will fall back to playoff-only totals (not ideal).');
    for (const id of Object.keys(playoffPlayers)) {
      seasonPlayers[id] = { points: playoffPlayers[id].points, byRoster: { ...(playoffPlayers[id].byRoster || {}) } };
    }
  }

  // compute overall MVP
  let overallId = null;
  let overallPts = -Infinity;
  for (const pid of Object.keys(seasonPlayers)) {
    const pinfo = seasonPlayers[pid];
    if (pinfo.points > overallPts) {
      overallPts = pinfo.points;
      overallId = pid;
    }
  }

  // compute finals MVP — strict championship matchup logic (must be participant in finalRes)
  let finalsId = null;
  let finalsPts = -Infinity;

  // find finals row by matching finalRes winner/loser in preferred weeks
  let finalsRow = null;
  if (finalRes && finalRes.winner && finalRes.loser) {
    const a = String(finalRes.winner), b = String(finalRes.loser);
    const preferredWeeks = [playoffEnd, playoffEnd - 1, playoffEnd - 2];
    for (const wk of preferredWeeks) {
      for (const r of matchupsRows) {
        if (!r.week) continue;
        if (Number(r.week) !== Number(wk)) continue;
        if (r.participantsCount === 2) {
          const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
          if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) { finalsRow = r; break; }
        } else if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
          const ids = r.combinedParticipants.map(p => String(p.rosterId));
          if (ids.includes(a) && ids.includes(b)) { finalsRow = r; break; }
        }
      }
      if (finalsRow) break;
    }
  }

  if (finalsRow) {
    const localPoints = {};
    for (const side of ['teamA', 'teamB']) {
      const t = finalsRow[side];
      if (!t) continue;
      if (Array.isArray(t.starters) && Array.isArray(t.starters_points)) {
        for (let i = 0; i < t.starters.length; i++) {
          const pid = String(t.starters[i]);
          const pts = Number(t.starters_points[i]) || 0;
          if (!pid || pid === '0') continue;
          localPoints[pid] = (localPoints[pid] || 0) + pts;
        }
      } else if (Array.isArray(t.player_points)) {
        for (const pp of t.player_points) {
          const pid = pp.player_id ?? pp.playerId ?? pp.id ?? null;
          const pts = Number(pp.points ?? pp.pts ?? 0);
          if (!pid || pid === '0') continue;
          localPoints[String(pid)] = (localPoints[String(pid)] || 0) + pts;
        }
      } else if (t.player_points && typeof t.player_points === 'object') {
        for (const pidKey of Object.keys(t.player_points || {})) {
          const ppts = safeNum(t.player_points[pidKey]);
          localPoints[pidKey] = (localPoints[pidKey] || 0) + ppts;
        }
      }
    }
    for (const pid of Object.keys(localPoints)) {
      const pts = localPoints[pid] || 0;
      if (pts > finalsPts) { finalsPts = pts; finalsId = pid; }
    }
    debug.push('Finals row matched — computed finals MVP from that matchup.');
  } else {
    debug.push('Could not find finals matchup row for bracket pair — falling back to top playoff scorer.');
    for (const pid of Object.keys(playoffPlayers)) {
      const pts = playoffPlayers[pid].points || 0;
      if (pts > finalsPts) { finalsPts = pts; finalsId = pid; }
    }
  }

  // attach player names via playersMap (best-effort)
  const playersMap = await fetchPlayersMap();
  function buildMvpObj(pid, pts, playersObj) {
    if (!pid) return null;
    const pm = playersMap[pid] || {};
    const playerName = pm.full_name || (pm.first_name && pm.last_name ? `${pm.first_name} ${pm.last_name}` : (pm.display_name || pm.player_name || pm.player_name)) || (`Player ${pid}`);
    const byRoster = (playersObj && playersObj[pid] && playersObj[pid].byRoster) ? playersObj[pid].byRoster : {};
    let topRosterId = null;
    let topRosterPts = -Infinity;
    for (const rId in byRoster) {
      const rpts = byRoster[rId] || 0;
      if (rpts > topRosterPts) { topRosterPts = rpts; topRosterId = rId; }
    }
    return {
      playerId: pid,
      playerName,
      points: Math.round((pts || 0) * 100) / 100,
      topRosterId,
      roster_meta: (topRosterId && rosterMap && rosterMap[String(topRosterId)]) ? rosterMap[String(topRosterId)] : null
    };
  }

  const overallMvp = buildMvpObj(overallId, overallPts, seasonPlayers);
  const finalsMvp = buildMvpObj(finalsId, finalsPts, playoffPlayers);

  if (finalsMvp) debug.push(`Finals MVP computed: ${finalsMvp.playerName} (${finalsMvp.playerId}) — ${finalsMvp.points} pts`);
  if (overallMvp) debug.push(`Overall MVP computed: ${overallMvp.playerName} (${overallMvp.playerId}) — ${overallMvp.points} pts`);

  return { finalsMvp, overallMvp, debug };
}

/* Helper: normalize API matchups (group roster-level rows into teamA/teamB shape) */
function normalizeApiMatchups(rawArr, rosterMap) {
  const out = [];
  const byMatch = {};
  for (let i = 0; i < rawArr.length; i++) {
    const e = rawArr[i];
    const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
    const wk = e.week ?? e.w ?? null;
    const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  for (const k of Object.keys(byMatch)) {
    const entries = byMatch[k];
    if (!entries || entries.length === 0) continue;
    if (entries.length === 2) {
      const a = entries[0], b = entries[1];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? '');
      const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? '');
      out.push({
        week: a.week ?? a.w ?? null,
        participantsCount: 2,
        teamA: {
          rosterId: aId,
          starters: a.starters ?? (Array.isArray(a.player_ids) ? a.player_ids : null),
          starters_points: a.starters_points ?? null,
          player_points: a.player_points ?? null,
          points: (typeof a.points !== 'undefined') ? a.points : (a.points_for ?? a.pts ?? null)
        },
        teamB: {
          rosterId: bId,
          starters: b.starters ?? (Array.isArray(b.player_ids) ? b.player_ids : null),
          starters_points: b.starters_points ?? null,
          player_points: b.player_points ?? null,
          points: (typeof b.points !== 'undefined') ? b.points : (b.points_for ?? b.pts ?? null)
        }
      });
    } else {
      for (const ent of entries) {
        const id = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? '');
        out.push({
          week: ent.week ?? ent.w ?? null,
          participantsCount: 1,
          teamA: {
            rosterId: id,
            starters: ent.starters ?? null,
            starters_points: ent.starters_points ?? null,
            player_points: ent.player_points ?? null,
            points: (typeof ent.points !== 'undefined') ? ent.points : (ent.points_for ?? ent.pts ?? null)
          },
          teamB: null
        });
      }
    }
  }
  return out;
}

/* -----------------------------
   main load handler
   ----------------------------- */
export async function load(event) {
  // short edge caching
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const url = event.url;
  const origin = url?.origin ?? null;
  const incomingSeasonParam = url.searchParams.get('season') || null;

  const messages = [];
  const jsonLinks = [];

  // --- build seasons chain (same as honor-hall) ---
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
          const prev = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prev) break;
          seasons.push({ league_id: String(prev.league_id), season: prev.season ?? null, name: prev.name ?? null });
          currPrev = prev.previous_league_id ? String(prev.previous_league_id) : null;
        } catch (err) { break; }
      }
    }
  } catch (e) {
    messages.push('Error building seasons chain: ' + (e?.message ?? String(e)));
  }

  // dedupe + sort ascending by season/year
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  seasons = Object.values(byId);
  seasons.sort((a,b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  // Determine which season to treat as "selected" for MVP table: prefer URL param, else latest
  let selectedSeason = incomingSeasonParam;
  if (!selectedSeason) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeason = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeason = String(new Date().getFullYear());
    }
  }

  // Build seasonsToProcess: only seasons from 2022 to present (user requested 2022..present)
  const currentYear = new Date().getFullYear();
  let seasonsToProcess = [];
  // prefer numeric season field if present, else fall back to league ids (we'll still try to read json by key)
  for (const s of seasons) {
    const y = s.season != null ? Number(s.season) : null;
    if (y && !isNaN(y) && y >= 2022 && y <= currentYear) seasonsToProcess.push({ leagueId: s.league_id, season: s.season, name: s.name });
    else if (s.league_id && (!s.season || isNaN(Number(s.season)))) {
      // include as last-resort entry (but prefer numeric seasons)
      seasonsToProcess.push({ leagueId: s.league_id, season: s.season, name: s.name });
    }
  }
  // If none found, fallback to [currentYear]
  if (!seasonsToProcess.length) seasonsToProcess = [{ leagueId: BASE_LEAGUE_ID, season: String(currentYear) }];

  // prefetch players map (for headshots/name fallback)
  const playersMap = await fetchPlayersMap();

  // collector arrays
  const seasonsResults = []; // per-season results (including matchupsRows, fullSeasonMatchupsRows, mvps, rosterMap, team-level leaders)
  const perRosterCrossSeason = {}; // rosterId -> { bestEntry: {...}, entries: [...] }

  // helper to compute per-roster leader data for a single season (regular + playoffs)
  function computeTeamLeaderForSeason(fullSeasonMatchupsRows, playoffMatchupsRows, rosterMap, playoffStart, playoffEnd) {
    // We'll compute:
    // - for regular season weeks (1..playoffStart-1): per-player totals per roster (regularPoints)
    // - for playoffs (playoffStart..playoffEnd): per-player totals per roster (playoffTotal) and per-game single max (playoffSingleMax)
    // Returns object mapping rosterId -> { topPlayerRegular: { playerId, points }, topPlayerPlayoffSingle: {playerId, points}, topPlayerPlayoffTotal: {...}, regularPointsMap, playoffPointsMap }
    const regularByPlayer = {}; // playerId -> { total, byRoster: { rosterId: pts } }
    const playoffByPlayerTotal = {};
    const playoffByPlayerSingleMax = {}; // playerId -> max single-game pts

    function note(obj, pid, pts, rosterId) {
      if (!pid || String(pid) === '0') return;
      const id = String(pid);
      if (!obj[id]) obj[id] = { points: 0, byRoster: {} };
      obj[id].points += Number(pts) || 0;
      if (rosterId) obj[id].byRoster[String(rosterId)] = (obj[id].byRoster[String(rosterId)] || 0) + (Number(pts) || 0);
    }

    // helper to extract player->points map from a team object for a single matchup
    function extractPlayerPointsFromTeam(t) {
      const local = {}; // pid -> pts in this matchup
      if (!t) return local;
      if (Array.isArray(t.starters) && Array.isArray(t.starters_points) && t.starters.length === t.starters_points.length) {
        for (let i = 0; i < t.starters.length; i++) {
          const pid = t.starters[i];
          const pts = Number(t.starters_points[i]) || 0;
          if (!pid || String(pid) === '0') continue;
          local[String(pid)] = (local[String(pid)] || 0) + pts;
        }
      } else if (Array.isArray(t.player_points)) {
        for (const pp of t.player_points) {
          const pid = pp.player_id ?? pp.playerId ?? pp.id ?? null;
          const pts = Number(pp.points ?? pp.pts ?? 0);
          if (!pid || String(pid) === '0') continue;
          local[String(pid)] = (local[String(pid)] || 0) + pts;
        }
      } else if (t.player_points && typeof t.player_points === 'object') {
        for (const pidKey of Object.keys(t.player_points || {})) {
          const ppts = safeNum(t.player_points[pidKey]);
          if (!pidKey || String(pidKey) === '0') continue;
          local[String(pidKey)] = (local[String(pidKey)] || 0) + ppts;
        }
      }
      return local;
    }

    // Regular season aggregation
    if (Array.isArray(fullSeasonMatchupsRows)) {
      for (const m of fullSeasonMatchupsRows) {
        if (!m || !m.week) continue;
        const wk = Number(m.week);
        if (isNaN(wk) || wk < 1) continue;
        if (wk >= playoffStart) continue; // only regular weeks
        for (const side of ['teamA', 'teamB']) {
          const t = m[side];
          if (!t) continue;
          const rosterId = String(t.rosterId ?? null);
          const local = extractPlayerPointsFromTeam(t);
          for (const pid of Object.keys(local)) {
            const pts = local[pid] || 0;
            note(regularByPlayer, pid, pts, rosterId);
          }
        }
      }
    }

    // Playoff aggregation (total per-player across playoff weeks + per-match single-game)
    if (Array.isArray(playoffMatchupsRows)) {
      for (const m of playoffMatchupsRows) {
        if (!m || !m.week) continue;
        const wk = Number(m.week);
        if (isNaN(wk) || wk < playoffStart || wk > playoffEnd) continue;
        for (const side of ['teamA', 'teamB']) {
          const t = m[side];
          if (!t) continue;
          const rosterId = String(t.rosterId ?? null);
          const local = extractPlayerPointsFromTeam(t);
          // per player in this matchup
          for (const pid of Object.keys(local)) {
            const pts = local[pid] || 0;
            // total across playoffs
            note(playoffByPlayerTotal, pid, pts, rosterId);
            // single-game max
            const id = String(pid);
            const prevMax = playoffByPlayerSingleMax[id] || 0;
            if ((pts || 0) > prevMax) playoffByPlayerSingleMax[id] = pts;
          }
        }
      }
    }

    // Build roster -> bests
    const rosterPlayersRegular = {}; // rosterId -> { pid -> pts }
    const rosterPlayersPlayoffTotal = {}; // rosterId -> { pid -> pts }
    const rosterPlayersPlayoffSingle = {}; // rosterId -> { pid -> maxSinglePts }

    // populate from regularByPlayer
    for (const pid of Object.keys(regularByPlayer)) {
      const mod = regularByPlayer[pid];
      for (const rid of Object.keys(mod.byRoster || {})) {
        rosterPlayersRegular[rid] = rosterPlayersRegular[rid] || {};
        rosterPlayersRegular[rid][pid] = (rosterPlayersRegular[rid][pid] || 0) + (mod.byRoster[rid] || 0);
      }
    }
    // populate from playoff totals
    for (const pid of Object.keys(playoffByPlayerTotal)) {
      const mod = playoffByPlayerTotal[pid];
      for (const rid of Object.keys(mod.byRoster || {})) {
        rosterPlayersPlayoffTotal[rid] = rosterPlayersPlayoffTotal[rid] || {};
        rosterPlayersPlayoffTotal[rid][pid] = (rosterPlayersPlayoffTotal[rid][pid] || 0) + (mod.byRoster[rid] || 0);
      }
    }
    // populate single max by scanning playoffByPlayerSingleMax and mapping to roster if possible
    // we need roster affiliation per player during playoffs; we will infer it from rosterPlayersPlayoffTotal mapping where possible,
    // otherwise ignore (single-game player must be associated to roster via earlier byRoster info).
    for (const pid of Object.keys(playoffByPlayerSingleMax)) {
      const maxSingle = playoffByPlayerSingleMax[pid] || 0;
      // find rosterIds where this player has playoff total
      const rids = [];
      for (const rid of Object.keys(rosterPlayersPlayoffTotal || {})) {
        if (rosterPlayersPlayoffTotal[rid] && rosterPlayersPlayoffTotal[rid][pid]) rids.push(rid);
      }
      if (rids.length) {
        for (const rid of rids) {
          rosterPlayersPlayoffSingle[rid] = rosterPlayersPlayoffSingle[rid] || {};
          rosterPlayersPlayoffSingle[rid][pid] = Math.max(rosterPlayersPlayoffSingle[rid][pid] || 0, maxSingle);
        }
      } else {
        // if we can't map by roster via totals, try to place under a null/unknown roster (skip)
      }
    }

    const out = {};
    // for each roster we have in rosterMap, produce the top entries (even if no data)
    for (const rk in rosterMap) {
      if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
      const rid = String(rk);
      // find top regular player
      let topRegPid = null, topRegPts = 0;
      if (rosterPlayersRegular[rid]) {
        for (const pid of Object.keys(rosterPlayersRegular[rid])) {
          const pts = rosterPlayersRegular[rid][pid] || 0;
          if (topRegPid === null || pts > topRegPts) { topRegPid = pid; topRegPts = pts; }
        }
      }
      // find top playoff single-game
      let topPlaySinglePid = null, topPlaySinglePts = 0;
      if (rosterPlayersPlayoffSingle[rid]) {
        for (const pid of Object.keys(rosterPlayersPlayoffSingle[rid])) {
          const pts = rosterPlayersPlayoffSingle[rid][pid] || 0;
          if (topPlaySinglePid === null || pts > topPlaySinglePts) { topPlaySinglePid = pid; topPlaySinglePts = pts; }
        }
      }
      // find top playoff total
      let topPlayTotalPid = null, topPlayTotalPts = 0;
      if (rosterPlayersPlayoffTotal[rid]) {
        for (const pid of Object.keys(rosterPlayersPlayoffTotal[rid])) {
          const pts = rosterPlayersPlayoffTotal[rid][pid] || 0;
          if (topPlayTotalPid === null || pts > topPlayTotalPts) { topPlayTotalPid = pid; topPlayTotalPts = pts; }
        }
      }

      // choose best combined player for this roster-season (used for cross-season)
      // define combined = topRegPts + topPlayTotalPts (if same player, that's okay; if different players, we take max per-player combined below)
      // Actually compute per-player combined for roster by checking all players seen across maps:
      const playersSeen = new Set();
      if (rosterPlayersRegular[rid]) for (const pid of Object.keys(rosterPlayersRegular[rid])) playersSeen.add(pid);
      if (rosterPlayersPlayoffTotal[rid]) for (const pid of Object.keys(rosterPlayersPlayoffTotal[rid])) playersSeen.add(pid);
      let bestPlayerCombinedPid = null, bestPlayerCombinedPts = -Infinity;
      for (const pid of Array.from(playersSeen)) {
        const reg = (rosterPlayersRegular[rid] && rosterPlayersRegular[rid][pid]) || 0;
        const play = (rosterPlayersPlayoffTotal[rid] && rosterPlayersPlayoffTotal[rid][pid]) || 0;
        const combined = reg + play;
        if (bestPlayerCombinedPid === null || combined > bestPlayerCombinedPts) { bestPlayerCombinedPid = pid; bestPlayerCombinedPts = combined; }
      }

      out[rid] = {
        rosterId: rid,
        owner_name: rosterMap[rid]?.owner_name ?? rosterMap[rid]?.owner?.display_name ?? null,
        team_name: rosterMap[rid]?.team_name ?? rosterMap[rid]?.owner_name ?? `Roster ${rid}`,
        teamAvatar: rosterMap[rid]?.team_avatar ?? rosterMap[rid]?.owner_avatar ?? null,
        // regular-season top player for roster-season
        topPlayerRegular: topRegPid ? { playerId: topRegPid, points: Math.round(topRegPts * 100) / 100 } : null,
        // playoff single-game top
        topPlayerPlayoffSingle: topPlaySinglePid ? { playerId: topPlaySinglePid, points: Math.round(topPlaySinglePts * 100) / 100 } : null,
        // playoff total top
        topPlayerPlayoffTotal: topPlayTotalPid ? { playerId: topPlayTotalPid, points: Math.round(topPlayTotalPts * 100) / 100 } : null,
        // best combined player for roster this season
        topPlayerCombined: bestPlayerCombinedPid ? { playerId: bestPlayerCombinedPid, points: Math.round(bestPlayerCombinedPts * 100) / 100 } : null
      };
    }

    return out;
  }

  // iterate seasonsToProcess and compute results
  for (const s of seasonsToProcess) {
    const seasonLabel = s.season != null ? String(s.season) : (s.leagueId ? String(s.leagueId) : null);
    messages.push(`Season ${seasonLabel}: starting processing.`);

    const leagueId = s.leagueId || BASE_LEAGUE_ID;

    // league meta to get playoff settings
    let leagueMeta = null;
    try { leagueMeta = await sleeper.getLeague(leagueId, { ttl: 60 * 5 }); } catch (e) { leagueMeta = null; messages.push(`Season ${seasonLabel}: failed fetching league meta (${e?.message ?? e})`); }

    let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : 15;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
    let playoffEnd = playoffStart + 2;

    // load rosterMap
    let rosterMap = {};
    try {
      rosterMap = await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 }) || {};
      messages.push(`Season ${seasonLabel}: loaded rosters (${Object.keys(rosterMap).length}).`);
    } catch (e) {
      rosterMap = {};
      messages.push(`Season ${seasonLabel}: failed to load rosters — ${e?.message ?? e}`);
    }

    // compute regular standings to support bracket simulation
    const statsByRosterRegular = {};
    const resultsByRosterRegular = {};
    const paByRosterRegular = {};
    for (const rk in rosterMap) {
      if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
      statsByRosterRegular[String(rk)] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: rosterMap[rk].roster_raw ?? null };
      resultsByRosterRegular[String(rk)] = [];
      paByRosterRegular[String(rk)] = 0;
    }
    const regStart = 1;
    const regEnd = Math.max(1, playoffStart - 1);
    for (let week=regStart; week<=regEnd; week++) {
      let wkMatchups = [];
      try { wkMatchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 }) || []; } catch (_) { wkMatchups = []; }
      if (!wkMatchups.length) continue;
      const byMatch = {};
      for (let mi=0; mi<wkMatchups.length; mi++) {
        const e = wkMatchups[mi];
        const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
        const wk = e.week ?? e.w ?? week;
        const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
        if (!byMatch[key]) byMatch[key] = [];
        byMatch[key].push(e);
      }
      for (const key of Object.keys(byMatch)) {
        const entries = byMatch[key];
        if (!entries || !entries.length) continue;
        if (entries.length === 1) {
          const only = entries[0];
          const ridOnly = String(only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId ?? 'unknown');
          const ptsOnly = safeNum(only.points ?? only.points_for ?? only.pts ?? 0);
          if (!statsByRosterRegular[ridOnly]) statsByRosterRegular[ridOnly] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
          if (!resultsByRosterRegular[ridOnly]) resultsByRosterRegular[ridOnly] = [];
          if (!paByRosterRegular[ridOnly]) paByRosterRegular[ridOnly] = 0;
          statsByRosterRegular[ridOnly].pf += ptsOnly;
          continue;
        }
        const participants = [];
        for (let i=0;i<entries.length;i++){
          const ent = entries[i];
          const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? ('r' + i));
          const ppts = safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0);
          participants.push({ rosterId: pid, points: ppts });
          if (!statsByRosterRegular[pid]) statsByRosterRegular[pid] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
          if (!resultsByRosterRegular[pid]) resultsByRosterRegular[pid] = [];
          if (!paByRosterRegular[pid]) paByRosterRegular[pid] = 0;
          statsByRosterRegular[pid].pf += ppts;
        }
        for (let i=0;i<participants.length;i++){
          const part = participants[i];
          const opponents = participants.filter((_, idx) => idx !== i);
          let oppAvg = 0;
          if (opponents.length) oppAvg = opponents.reduce((acc,o) => acc + o.points, 0) / opponents.length;
          paByRosterRegular[part.rosterId] = (paByRosterRegular[part.rosterId] || 0) + oppAvg;
          if (part.points > oppAvg + 1e-9) { resultsByRosterRegular[part.rosterId].push('W'); statsByRosterRegular[part.rosterId].wins += 1; }
          else if (part.points < oppAvg - 1e-9) { resultsByRosterRegular[part.rosterId].push('L'); statsByRosterRegular[part.rosterId].losses += 1; }
          else { resultsByRosterRegular[part.rosterId].push('T'); statsByRosterRegular[part.rosterId].ties += 1; }
        }
      }
    } // end regular loop

    function buildStandingsFromTrackers(statsByRoster, resultsByRoster, paByRoster) {
      const keys = Object.keys(resultsByRoster).length ? Object.keys(resultsByRoster) : (rosterMap ? Object.keys(rosterMap) : []);
      const out = [];
      for (let i=0;i<keys.length;i++){
        const rid = keys[i];
        if (!Object.prototype.hasOwnProperty.call(statsByRoster, rid)) {
          statsByRoster[rid] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: (rosterMap && rosterMap[rid] ? rosterMap[rid].roster_raw : null) };
        }
        const s = statsByRoster[rid];
        const wins = s.wins || 0;
        const losses = s.losses || 0;
        const ties = s.ties || 0;
        const pfVal = Math.round((s.pf || 0) * 100) / 100;
        const paVal = Math.round((paByRoster[rid] || s.pa || 0) * 100) / 100;
        const meta = rosterMap && rosterMap[rid] ? rosterMap[rid] : {};
        const team_name = meta.team_name ? meta.team_name : ((s.roster && s.roster.metadata && s.roster.metadata.team_name) ? s.roster.metadata.team_name : ('Roster ' + rid));
        const owner_name = meta.owner_name || null;
        const avatar = meta.team_avatar || meta.owner_avatar || null;
        const resArr = resultsByRoster && resultsByRoster[rid] ? resultsByRoster[rid] : [];
        const streaks = computeStreaks(resArr);
        out.push({
          rosterId: rid,
          team_name,
          owner_name,
          avatar,
          wins,
          losses,
          ties,
          pf: pfVal,
          pa: paVal,
          maxWinStreak: streaks.maxW,
          maxLoseStreak: streaks.maxL
        });
      }
      out.sort((a,b) => {
        if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
        return (b.pf || 0) - (a.pf || 0);
      });
      return out;
    }

    const regularStandings = buildStandingsFromTrackers(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular);
    const placementMap = {};
    for (let i=0;i<regularStandings.length;i++) placementMap[String(regularStandings[i].rosterId)] = i + 1;
    const placementToRoster = {};
    for (const k in placementMap) placementToRoster[ placementMap[k] ] = k;

    // -------------------------
    // load playoff matchups (JSON-first) and full season matchups (JSON or API)
    // -------------------------
    let matchupsRows = [];
    let localUsedKey = null;
    try {
      const candidateKeys = [];
      if (seasonLabel) candidateKeys.push(String(seasonLabel));
      if (leagueMeta && typeof leagueMeta.season !== 'undefined' && leagueMeta.season != null) candidateKeys.push(String(leagueMeta.season));
      if (leagueId) candidateKeys.push(String(leagueId));
      try {
        const seasonObj = seasons.find(se => String(se.league_id) === String(leagueId));
        if (seasonObj && seasonObj.season != null) candidateKeys.push(String(seasonObj.season));
      } catch (_) {}
      const uniqKeys = Array.from(new Set(candidateKeys.filter(k => k != null && k !== '')));

      let foundLocal = null;
      let foundKey = null;
      for (const k of uniqKeys) {
        const attempt = await tryLoadLocalSeasonMatchups(k);
        if (attempt && attempt.parsedRaw) { foundLocal = attempt.parsedRaw; foundKey = k; break; }
      }

      if (foundLocal) {
        const baseWeek = Number(foundLocal.playoff_week_start ?? foundLocal.playoffWeekStart ?? (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start ? leagueMeta.settings.playoff_week_start : playoffStart)) || playoffStart;
        let collected = [];
        if (Array.isArray(foundLocal)) collected = foundLocal;
        else if (Array.isArray(foundLocal.parsedRaw)) collected = foundLocal.parsedRaw;
        else {
          for (const kk of Object.keys(foundLocal)) {
            if (kk === 'playoff_week_start' || kk === 'metadata' || kk === 'season') continue;
            const v = foundLocal[kk];
            if (Array.isArray(v)) for (const m of v) collected.push(m);
          }
        }
        for (const m of collected) {
          if (!m) continue;
          const wk = (typeof m.week !== 'undefined' && m.week != null) ? Number(m.week) : ((typeof m.w !== 'undefined') ? Number(m.w) : null);
          const mappedWeek = (wk != null && !isNaN(wk)) ? (baseWeek + (wk - 1)) : (m.week ?? m.w ?? null);
          function normalizeTeam(t) {
            if (!t) return { rosterId: null, name: null, avatar: null, points: null, starters: null, starters_points: null, player_points: null, placement: null };
            return {
              rosterId: t.rosterId ?? t.roster_id ?? t.ownerId ?? t.owner_id ?? null,
              name: t.name ?? t.teamName ?? t.team_name ?? t.ownerName ?? t.owner_name ?? null,
              avatar: t.avatar ?? t.team_avatar ?? t.owner_avatar ?? null,
              points: typeof t.teamAScore !== 'undefined' || typeof t.teamBScore !== 'undefined' ? null : (t.points ?? t.points_for ?? t.pts ?? null),
              starters: t.starters ?? t.starters_list ?? null,
              starters_points: t.starters_points ?? t.startersPoints ?? t.starters_points ?? null,
              player_points: t.player_points ?? null,
              placement: null
            };
          }
          const tA = m.teamA ? normalizeTeam(m.teamA) : (m.home ? normalizeTeam(m.home) : null);
          const tB = m.teamB ? normalizeTeam(m.teamB) : (m.away ? normalizeTeam(m.away) : null);
          if (tA && (tA.points == null)) tA.points = (m.teamAScore != null ? Number(m.teamAScore) : (m.teamA && (m.teamA.points ?? m.teamA.score) ? safeNum(m.teamA.points ?? m.teamA.score) : null));
          if (tB && (tB.points == null)) tB.points = (m.teamBScore != null ? Number(m.teamBScore) : (m.teamB && (m.teamB.points ?? m.teamB.score) ? safeNum(m.teamB.points ?? m.teamB.score) : null));
          matchupsRows.push({
            matchup_id: m.matchup_id ?? m.matchupId ?? m.id ?? null,
            season: String(foundLocal.season ?? leagueMeta?.season ?? seasonLabel ?? null),
            week: mappedWeek,
            teamA: tA || { rosterId: null, name: 'BYE', avatar: null, points: null, starters: null, starters_points: null, player_points: null, placement: null },
            teamB: tB || { rosterId: null, name: 'BYE', avatar: null, points: null, starters: null, starters_points: null, player_points: null, placement: null },
            participantsCount: (tA && tA.rosterId ? 1 : 0) + (tB && tB.rosterId ? 1 : 0)
          });
        }
        localUsedKey = foundKey;
      } else {
        // API fallback: fetch playoff weeks
        const rawMatchups = [];
        for (let wk = playoffStart; wk <= Math.min(playoffEnd, MAX_WEEKS); wk++) {
          try {
            const wkMatchups = await sleeper.getMatchupsForWeek(leagueId, wk, { ttl: 60 * 5 });
            if (Array.isArray(wkMatchups) && wkMatchups.length) {
              for (const m of wkMatchups) {
                if (m && (m.week == null && m.w == null)) m.week = wk;
                rawMatchups.push(m);
              }
            }
          } catch (we) { /* ignore per-week failure */ }
        }
        const byMatch = {};
        for (let i = 0; i < rawMatchups.length; i++) {
          const e = rawMatchups[i];
          const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
          const wk = e.week ?? e.w ?? null;
          const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + i));
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(e);
        }
        const mkeys = Object.keys(byMatch);
        for (let ki = 0; ki < mkeys.length; ki++) {
          const entries = byMatch[mkeys[ki]];
          if (!entries || !entries.length) continue;
          if (entries.length === 1) {
            const a = entries[0];
            const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
            const aMeta = rosterMap[aId] || {};
            const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
            const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
            const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
            const aPlacement = placementMap[aId] ?? null;
            matchupsRows.push({
              matchup_id: mkeys[ki],
              season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
              week: a.week ?? a.w ?? null,
              teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement, starters: a.starters ?? null, starters_points: a.starters_points ?? a.startersPoints ?? null, player_points: a.player_points ?? null },
              teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, placement: null, starters: null, starters_points: null, player_points: null },
              participantsCount: 1
            });
            continue;
          }
          if (entries.length === 2) {
            const a = entries[0];
            const b = entries[1];
            const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
            const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
            const aMeta = rosterMap[aId] || {};
            const bMeta = rosterMap[bId] || {};
            const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
            const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? null);
            const aPlacement = placementMap[aId] ?? null;
            const bPlacement = placementMap[bId] ?? null;
            matchupsRows.push({
              matchup_id: mkeys[ki],
              season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
              week: a.week ?? a.w ?? null,
              teamA: { rosterId: aId, name: aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts, placement: aPlacement, starters: a.starters ?? null, starters_points: a.starters_points ?? null, player_points: a.player_points ?? null },
              teamB: { rosterId: bId, name: bMeta.team_name || bMeta.owner_name || ('Roster ' + bId), avatar: bMeta.team_avatar || bMeta.owner_avatar || null, points: bPts, placement: bPlacement, starters: b.starters ?? null, starters_points: b.starters_points ?? null, player_points: b.player_points ?? null },
              participantsCount: 2
            });
            continue;
          }
          // many participants
          const participants = entries.map(ent => {
            const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
            const meta = rosterMap[pid] || {};
            return {
              rosterId: pid,
              name: meta.team_name || meta.owner_name || ('Roster ' + pid),
              avatar: meta.team_avatar || meta.owner_avatar || null,
              points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0),
              placement: placementMap[pid] ?? null,
              starters: ent.starters ?? null,
              starters_points: ent.starters_points ?? null,
              player_points: ent.player_points ?? null
            };
          });
          const combinedLabel = participants.map(p => p.name).join(' / ');
          matchupsRows.push({
            matchup_id: mkeys[ki],
            season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
            week: entries[0].week ?? entries[0].w ?? null,
            combinedParticipants: participants,
            combinedLabel,
            participantsCount: participants.length
          });
        }
      }
    } catch (e) {
      messages.push('Error while attempting to load local season_matchups JSON: ' + (e?.message ?? String(e)));
    }

    if (localUsedKey) {
      jsonLinks.push({ title: `season_matchups/${localUsedKey}.json`, url: origin ? `${origin}/season_matchups/${localUsedKey}.json` : `season_matchups/${localUsedKey}.json` });
      messages.push(`Season ${seasonLabel}: loaded local season_matchups JSON for key ${localUsedKey}.`);
    }

    // full season rows: if localUsedKey used, use matchupsRows; else fetch weeks 1..playoffEnd
    let fullSeasonMatchupsRows = null;
    if (localUsedKey) {
      fullSeasonMatchupsRows = matchupsRows.slice();
    } else {
      const allRaw = [];
      for (let wk = 1; wk <= Math.min(playoffEnd, MAX_WEEKS); wk++) {
        try {
          const wkMatchups = await sleeper.getMatchupsForWeek(leagueId, wk, { ttl: 60 * 5 });
          if (Array.isArray(wkMatchups) && wkMatchups.length) {
            for (const m of wkMatchups) {
              if (m && (m.week == null && m.w == null)) m.week = wk;
              allRaw.push(m);
            }
          }
        } catch (e) { /* ignore */ }
      }
      if (allRaw.length) {
        fullSeasonMatchupsRows = normalizeApiMatchups(allRaw, rosterMap);
        messages.push(`Season ${seasonLabel}: loaded ${fullSeasonMatchupsRows.length} total matchups via API for full season.`);
      } else {
        fullSeasonMatchupsRows = matchupsRows.slice();
      }
    }

    if (!fullSeasonMatchupsRows || !fullSeasonMatchupsRows.length) {
      messages.push(`Season ${seasonLabel}: no matchups available — skipping.`);
      seasonsResults.push({ season: seasonLabel, leagueId, playoffStart, playoffEnd, matchupsRows, fullSeasonMatchupsRows, rosterMap, finalsMvp: null, overallMvp: null, teamLeaders: {}, _sourceJson: localUsedKey ?? null });
      continue;
    }

    // bracket simulation to derive finalRes
    function findMatchForPair(rA, rB, preferredWeeks = [playoffStart, playoffStart+1, playoffStart+2]) {
      if (!rA || !rB) return null;
      const a = String(rA), b = String(rB);
      for (const wk of preferredWeeks) {
        for (const r of matchupsRows) {
          if (!r.week) continue;
          if (Number(r.week) !== Number(wk)) continue;
          if (r.participantsCount === 2) {
            const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
            if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) return r;
          } else if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
            const ids = r.combinedParticipants.map(p => String(p.rosterId));
            if (ids.includes(a) && ids.includes(b)) return r;
          }
        }
      }
      for (const r of matchupsRows) {
        if (r.participantsCount === 2) {
          const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
          if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) return r;
        } else if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
          const ids = r.combinedParticipants.map(p => String(p.rosterId));
          if (ids.includes(a) && ids.includes(b)) return r;
        }
      }
      return null;
    }

    function decideWinnerFromMatch(matchRow, aId, bId) {
      const a = String(aId), b = String(bId);
      if (!matchRow) return null;
      let aPts = null, bPts = null;
      if (matchRow.participantsCount === 2) {
        const pA = String(matchRow.teamA.rosterId), pB = String(matchRow.teamB.rosterId);
        if (pA === a) { aPts = matchRow.teamA.points; bPts = matchRow.teamB.points; }
        else { aPts = matchRow.teamB.points; bPts = matchRow.teamA.points; }
      } else if (matchRow.combinedParticipants) {
        const pAobj = matchRow.combinedParticipants.find(p => String(p.rosterId) === a);
        const pBobj = matchRow.combinedParticipants.find(p => String(p.rosterId) === b);
        aPts = pAobj?.points ?? 0;
        bPts = pBobj?.points ?? 0;
      } else if (matchRow.teamA && !matchRow.teamB) {
        return null;
      }

      if (aPts == null || bPts == null) return null;
      if (aPts > bPts + 1e-9) return { winner: a, loser: b, reason: 'matchup' };
      if (bPts > aPts + 1e-9) return { winner: b, loser: a, reason: 'matchup' };

      const aPF = (regularStandings.find(s => String(s.rosterId) === a)?.pf) ?? 0;
      const bPF = (regularStandings.find(s => String(s.rosterId) === b)?.pf) ?? 0;
      if (aPF > bPF) return { winner: a, loser: b, reason: 'tiebreak-pf' };
      if (bPF > aPF) return { winner: b, loser: a, reason: 'tiebreak-pf' };

      const aW = (regularStandings.find(s => String(s.rosterId) === a)?.wins) ?? 0;
      const bW = (regularStandings.find(s => String(s.rosterId) === b)?.wins) ?? 0;
      if (aW > bW) return { winner: a, loser: b, reason: 'tiebreak-wins' };
      if (bW > aW) return { winner: b, loser: a, reason: 'tiebreak-wins' };

      const aPl = placementMap[a] ?? 999;
      const bPl = placementMap[b] ?? 999;
      if (aPl < bPl) return { winner: a, loser: b, reason: 'tiebreak-placement' };
      if (bPl < aPl) return { winner: b, loser: a, reason: 'tiebreak-placement' };

      return { winner: a, loser: b, reason: 'fallback' };
    }

    function runMatch(seedA, seedB, label, preferredWeeks = [playoffStart, playoffStart+1, playoffStart+2]) {
      const a = seedA.rosterId, b = seedB.rosterId;
      const matchRow = findMatchForPair(a, b, preferredWeeks);
      const decision = decideWinnerFromMatch(matchRow, a, b);
      if (!decision) {
        const winner = Number(seedA.seed) <= Number(seedB.seed) ? seedA.rosterId : seedB.rosterId;
        const loser = winner === seedA.rosterId ? seedB.rosterId : seedA.rosterId;
        return { winner, loser, row: matchRow, reason: 'fallback-no-match' };
      }
      const winner = decision.winner;
      const loser = decision.loser;
      return { winner, loser, row: matchRow, reason: decision.reason };
    }

    const winnersSeeds = [];
    const losersSeeds = [];
    for (let sN=1; sN<=14; sN++) {
      const rid = placementToRoster[sN] ?? null;
      if (!rid) continue;
      if (sN <= 8) winnersSeeds.push({ seed: sN, rosterId: rid });
      else losersSeeds.push({ seed: sN, rosterId: rid });
    }

    const wR1Pairs = [
      [1,8],[2,7],[3,6],[4,5]
    ].map(([s1,s2]) => ({ a: {seed: s1, rosterId: placementToRoster[s1]}, b: {seed: s2, rosterId: placementToRoster[s2]} }));

    const wR1Results = [];
    for (const p of wR1Pairs) {
      if (!p.a.rosterId || !p.b.rosterId) {
        wR1Results.push({ winner: p.a.rosterId || p.b.rosterId, loser: p.a.rosterId ? p.b.rosterId : p.a.rosterId, reason: 'missing-roster' });
        continue;
      }
      const res = runMatch(p.a, p.b, `W1`);
      wR1Results.push(res);
    }

    const wR1Winners = wR1Results.map((r, idx) => ({ seed: placementMap[r.winner] ?? null, rosterId: r.winner, loserSeed: placementMap[r.loser] ?? null, loserId: r.loser }));
    wR1Winners.sort((a,b) => (a.seed || 999) - (b.seed || 999));
    const wSemiPairs = [
      [ wR1Winners[0], wR1Winners[wR1Winners.length-1] ],
      [ wR1Winners[1], wR1Winners[wR1Winners.length-2] ]
    ];
    const wSemiResults = [];
    for (const pair of wSemiPairs) {
      if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) {
        wSemiResults.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[1]?.rosterId || pair[0]?.rosterId, reason:'missing' });
        continue;
      }
      const res = runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}, `Semi`);
      wSemiResults.push(res);
    }
    const finalRes = (wSemiResults.length >= 2) ? runMatch({seed: placementMap[wSemiResults[0].winner], rosterId: wSemiResults[0].winner}, {seed: placementMap[wSemiResults[1].winner], rosterId: wSemiResults[1].winner}, `Final`) : null;
    if (finalRes) messages.push(`Season ${seasonLabel}: bracket simulation finalRes -> winner ${finalRes.winner}, loser ${finalRes.loser} (reason ${finalRes.reason}).`);
    else messages.push(`Season ${seasonLabel}: could not derive finalRes from bracket simulation — will fallback to matchups week scanning.`);

    // compute MVPs for this season using computeMvpsFromMatchups
    let finalsMvp = null, overallMvp = null, mdebug = [];
    try {
      const comp = await computeMvpsFromMatchups(matchupsRows.length ? matchupsRows : fullSeasonMatchupsRows, playoffStart, playoffEnd, rosterMap, finalRes, fullSeasonMatchupsRows);
      finalsMvp = comp.finalsMvp; overallMvp = comp.overallMvp; mdebug = comp.debug || [];
      for (const d of mdebug) messages.push(`Season ${seasonLabel}: ${d}`);
    } catch (e) {
      messages.push(`Season ${seasonLabel}: error computing MVPs — ${e?.message ?? e}`);
      finalsMvp = null; overallMvp = null;
    }

    // compute team-level leaders for this season (server-side)
    const teamLeaders = computeTeamLeaderForSeason(fullSeasonMatchupsRows, matchupsRows, rosterMap, playoffStart, playoffEnd);

    // attach playersMap names & avatars where possible for the leaders (best-effort)
    function attachPlayerMetaForLeader(obj) {
      if (!obj) return obj;
      const pid = obj.playerId ?? obj.player_id ?? null;
      if (!pid) return obj;
      const pm = playersMap && (playersMap[pid] || playersMap[String(pid)] || playersMap[Number(pid)]) ? (playersMap[pid] || playersMap[String(pid)] || playersMap[Number(pid)]) : null;
      const playerName = pm ? (pm.full_name || (pm.first_name ? (pm.first_name + (pm.last_name ? ' ' + pm.last_name : '')) : (pm.display_name || pm.player_name || null))) : null;
      const playerAvatar = playerHeadshotUrl(pid);
      return { ...obj, playerName: playerName ?? null, playerAvatar };
    }
    // helper for CDN headshot url
    function playerHeadshotUrl(pid) { if (!pid) return null; return `https://sleepercdn.com/content/nba/players/${pid}.jpg`; }

    // augment teamLeaders with owner/team names and attach player meta
    for (const rid of Object.keys(teamLeaders)) {
      const t = teamLeaders[rid];
      // attach roster meta
      const meta = rosterMap[rid] || {};
      t.owner_name = meta.owner_name ?? meta.owner?.display_name ?? null;
      t.team_name = meta.team_name ?? t.team_name ?? `Roster ${rid}`;
      t.teamAvatar = meta.team_avatar ?? meta.owner_avatar ?? t.teamAvatar ?? null;
      // attach deeper player meta for the 3 main fields
      if (t.topPlayerRegular) t.topPlayerRegular = attachPlayerMetaForLeader(t.topPlayerRegular);
      if (t.topPlayerPlayoffSingle) t.topPlayerPlayoffSingle = attachPlayerMetaForLeader(t.topPlayerPlayoffSingle);
      if (t.topPlayerPlayoffTotal) t.topPlayerPlayoffTotal = attachPlayerMetaForLeader(t.topPlayerPlayoffTotal);
      if (t.topPlayerCombined) t.topPlayerCombined = attachPlayerMetaForLeader(t.topPlayerCombined);
    }

    // store per-season results
    seasonsResults.push({
      season: seasonLabel,
      leagueId,
      playoffs: { start: playoffStart, end: playoffEnd },
      rosterMap,
      matchupsRows,
      fullSeasonMatchupsRows,
      finalsMvp,
      overallMvp,
      teamLeaders,
      _sourceJson: localUsedKey ?? null
    });

    // accumulate cross-season per-roster bests: for each roster, consider this season's topPlayerCombined (player + points)
    for (const rid of Object.keys(teamLeaders)) {
      const t = teamLeaders[rid];
      const candidate = {
        season: seasonLabel,
        rosterId: rid,
        owner_name: t.owner_name ?? null,
        team_name: t.team_name ?? null,
        teamAvatar: t.teamAvatar ?? null,
        topPlayerRegular: t.topPlayerRegular ? { ...t.topPlayerRegular } : null,
        topPlayerPlayoffSingle: t.topPlayerPlayoffSingle ? { ...t.topPlayerPlayoffSingle } : null,
        topPlayerPlayoffTotal: t.topPlayerPlayoffTotal ? { ...t.topPlayerPlayoffTotal } : null,
        topPlayerCombined: t.topPlayerCombined ? { ...t.topPlayerCombined } : null,
        combinedPoints: (t.topPlayerCombined && t.topPlayerCombined.points) ? Number(t.topPlayerCombined.points) : 0
      };
      if (!perRosterCrossSeason[rid]) perRosterCrossSeason[rid] = { bestEntry: null, entries: [] };
      perRosterCrossSeason[rid].entries.push(candidate);
      if (!perRosterCrossSeason[rid].bestEntry || candidate.combinedPoints > perRosterCrossSeason[rid].bestEntry.combinedPoints) {
        perRosterCrossSeason[rid].bestEntry = candidate;
      }
    }
  } // end seasons loop

  // build crossSeasonLeaders array sorted by descending combinedPoints
  const crossSeasonLeaders = [];
  for (const rid of Object.keys(perRosterCrossSeason)) {
    const be = perRosterCrossSeason[rid].bestEntry;
    if (!be) continue;
    // attach player avatar fallback using playersMap if possible
    let playerAvatar = null;
    const pid = be.topPlayerCombined?.playerId ?? be.topPlayerRegular?.playerId ?? be.topPlayerPlayoffTotal?.playerId ?? null;
    if (pid) playerAvatar = `https://sleepercdn.com/content/nba/players/${pid}.jpg`;
    crossSeasonLeaders.push({
      season: be.season,
      rosterId: be.rosterId,
      owner_name: be.owner_name,
      team_name: be.team_name,
      teamAvatar: be.teamAvatar,
      playerId: pid,
      playerAvatar,
      playerName: (be.topPlayerCombined?.playerName || be.topPlayerRegular?.playerName || be.topPlayerPlayoffTotal?.playerName) ?? null,
      regularPoints: be.topPlayerRegular?.points ?? 0,
      playoffPoints: be.topPlayerPlayoffTotal?.points ?? 0,
      totalPoints: Math.round(((be.topPlayerRegular?.points ?? 0) + (be.topPlayerPlayoffTotal?.points ?? 0)) * 100)/100
    });
  }
  crossSeasonLeaders.sort((a,b) => (b.totalPoints || 0) - (a.totalPoints || 0));

  // find selected season result in seasonsResults
  const selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? (seasonsResults.length ? seasonsResults[seasonsResults.length - 1] : null);

  // For the selectedRow ensure we provide a playoffTeamLeaders array sorted by points (playoff single-game)
  let playoffTeamLeaders = [];
  if (selectedRow && selectedRow.teamLeaders) {
    for (const rid of Object.keys(selectedRow.teamLeaders)) {
      const t = selectedRow.teamLeaders[rid];
      // We want playoff-table which is "only points in playoffs" as user requested: choose topPlayerPlayoffSingle (single-game) as main metric
      const topSingle = t.topPlayerPlayoffSingle;
      const topTotal = t.topPlayerPlayoffTotal;
      const topReg = t.topPlayerRegular;
      const obj = {
        rosterId: rid,
        team_name: t.team_name,
        owner_name: t.owner_name,
        teamAvatar: t.teamAvatar,
        topPlayerPlayoffSingle: topSingle ? {
          playerId: topSingle.playerId,
          playerName: playersMap && playersMap[topSingle.playerId] ? (playersMap[topSingle.playerId].full_name || playersMap[topSingle.playerId].player_name) : (topSingle.playerName ?? null),
          points: topSingle.points,
          playerAvatar: topSingle.playerId ? `https://sleepercdn.com/content/nba/players/${topSingle.playerId}.jpg` : null
        } : null,
        topPlayerPlayoffTotal: topTotal ? {
          playerId: topTotal.playerId,
          playerName: playersMap && playersMap[topTotal.playerId] ? (playersMap[topTotal.playerId].full_name || playersMap[topTotal.playerId].player_name) : (topTotal.playerName ?? null),
          points: topTotal.points,
          playerAvatar: topTotal.playerId ? `https://sleepercdn.com/content/nba/players/${topTotal.playerId}.jpg` : null
        } : null,
        topPlayerRegular: topReg ? {
          playerId: topReg.playerId,
          playerName: playersMap && playersMap[topReg.playerId] ? (playersMap[topReg.playerId].full_name || playersMap[topReg.playerId].player_name) : (topReg.playerName ?? null),
          points: topReg.points,
          playerAvatar: topReg.playerId ? `https://sleepercdn.com/content/nba/players/${topReg.playerId}.jpg` : null
        } : null
      };
      playoffTeamLeaders.push(obj);
    }
    // sort by playoff single-game points desc (missing values to bottom)
    playoffTeamLeaders.sort((a,b) => {
      const A = a.topPlayerPlayoffSingle?.points ?? -Infinity;
      const B = b.topPlayerPlayoffSingle?.points ?? -Infinity;
      return B - A;
    });
  }

  // Provide helpful top-level debug/messages
  return {
    seasons,
    seasonsResults, // many fields kept for debugging / future use
    selectedSeason,
    selectedRow,
    playoffTeamLeaders, // for the selected season: one-row per roster, sorted by playoff single-game
    crossSeasonLeaders, // cross-season best single-season per roster (combined regular+playoff top-player totals)
    jsonLinks,
    messages
  };
}
