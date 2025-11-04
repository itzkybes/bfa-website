// src/routes/records-player/+page.server.js
// Records (player MVPs + team leaders + cross-season bests)
// JSON-first, API fallback. Defensive lookups + per-season and cross-season aggregations.

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
      } catch (e) { /* parse -> continue */ }
    } catch (e) { /* not found -> continue */ }
  }
  return null;
}

async function fetchPlayersMap() {
  try {
    if (sleeper && typeof sleeper.getPlayers === 'function') {
      const map = await sleeper.getPlayers('nba', { ttl: 60 * 60 });
      if (map && typeof map === 'object') return map;
    }
  } catch (e) { /* fallback */ }
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
    if (r === 'W') { curW++; curL = 0; if (curW > maxW) maxW = curW; }
    else if (r === 'L') { curL++; curW = 0; if (curL > maxL) maxL = curL; }
    else { curW = 0; curL = 0; }
  }
  return { maxW, maxL };
}

/* normalize api matchups to teamA/teamB shape */
function normalizeApiMatchups(rawArr) {
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
    if (!entries || !entries.length) continue;
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

/* robust player lookup from playersMap (try several keys) */
function resolvePlayerFromMap(playersMap, pid) {
  if (!playersMap || !pid) return null;
  const asStr = String(pid);
  if (playersMap[asStr]) return playersMap[asStr];
  if (playersMap[asStr.toUpperCase()]) return playersMap[asStr.toUpperCase()];
  // sometimes map keys are numeric
  if (playersMap[Number(asStr)]) return playersMap[Number(asStr)];
  // fallback: scan by player_id/search_player_id
  for (const k of Object.keys(playersMap)) {
    const p = playersMap[k];
    if (!p) continue;
    const keys = [p.player_id, p.search_player_id, p.playerId, p.player_id?.toString(), p.search_player_id?.toString()];
    if (keys.some(v => v != null && String(v) === asStr)) return p;
  }
  return null;
}

/* compute per-season team leaders (top player per roster that season)
   returns array of { rosterId, owner_name, roster_name, teamAvatar, topPlayerId, topPlayerName, playerAvatar, regularPoints, playoffPoints, totalPoints, roster_meta } */
async function computeTeamLeadersForSeason(fullSeasonMatchupsRows, matchupsRows, playoffStart, playoffEnd, rosterMap, playersMap) {
  const rosterPlayerRegular = {}; // rosterId -> pid -> pts
  const rosterPlayerPlayoff = {}; // rosterId -> pid -> pts

  function addTo(mapObj, rosterId, pid, pts) {
    if (!rosterId || !pid) return;
    const r = String(rosterId), p = String(pid);
    if (!mapObj[r]) mapObj[r] = {};
    mapObj[r][p] = (mapObj[r][p] || 0) + Number(pts || 0);
  }

  // regular weeks: 1..(playoffStart-1)
  if (Array.isArray(fullSeasonMatchupsRows)) {
    for (const row of fullSeasonMatchupsRows) {
      if (!row || typeof row.week === 'undefined') continue;
      const wk = Number(row.week);
      if (isNaN(wk) || wk < 1) continue;
      if (wk >= playoffStart) continue;
      for (const side of ['teamA','teamB']) {
        const t = row[side];
        if (!t || !t.rosterId) continue;
        if (Array.isArray(t.starters) && Array.isArray(t.starters_points) && t.starters.length === t.starters_points.length) {
          for (let i=0;i<t.starters.length;i++) addTo(rosterPlayerRegular, t.rosterId, t.starters[i], t.starters_points[i]);
        } else if (Array.isArray(t.player_points)) {
          for (const pp of t.player_points) {
            const pid = pp.player_id ?? pp.playerId ?? pp.id ?? null;
            const pts = pp.points ?? pp.pts ?? 0;
            if (pid) addTo(rosterPlayerRegular, t.rosterId, pid, pts);
          }
        } else if (t.player_points && typeof t.player_points === 'object') {
          for (const pidKey of Object.keys(t.player_points || {})) addTo(rosterPlayerRegular, t.rosterId, pidKey, safeNum(t.player_points[pidKey]));
        }
      }
    }
  }

  // playoffs: playoffStart..playoffEnd
  if (Array.isArray(matchupsRows)) {
    for (const row of matchupsRows) {
      if (!row || typeof row.week === 'undefined') continue;
      const wk = Number(row.week);
      if (isNaN(wk) || wk < playoffStart || wk > playoffEnd) continue;
      for (const side of ['teamA','teamB']) {
        const t = row[side];
        if (!t || !t.rosterId) continue;
        if (Array.isArray(t.starters) && Array.isArray(t.starters_points) && t.starters.length === t.starters_points.length) {
          for (let i=0;i<t.starters.length;i++) addTo(rosterPlayerPlayoff, t.rosterId, t.starters[i], t.starters_points[i]);
        } else if (Array.isArray(t.player_points)) {
          for (const pp of t.player_points) {
            const pid = pp.player_id ?? pp.playerId ?? pp.id ?? null;
            const pts = pp.points ?? pp.pts ?? 0;
            if (pid) addTo(rosterPlayerPlayoff, t.rosterId, pid, pts);
          }
        } else if (t.player_points && typeof t.player_points === 'object') {
          for (const pidKey of Object.keys(t.player_points || {})) addTo(rosterPlayerPlayoff, t.rosterId, pidKey, safeNum(t.player_points[pidKey]));
        }
      }
    }
  }

  // gather roster ids
  const rosterIds = new Set([
    ...Object.keys(rosterMap || {}),
    ...Object.keys(rosterPlayerRegular || {}),
    ...Object.keys(rosterPlayerPlayoff || {})
  ]);

  const out = [];
  for (const rid of Array.from(rosterIds)) {
    const regularPlayers = rosterPlayerRegular[rid] || {};
    const playoffPlayers = rosterPlayerPlayoff[rid] || {};
    const pidsSet = new Set([...Object.keys(regularPlayers), ...Object.keys(playoffPlayers)]);
    let topPid = null, topRegular = 0, topPlayoff = 0, topTotal = -Infinity;
    for (const pid of pidsSet) {
      const rpts = Number(regularPlayers[pid] || 0);
      const ppts = Number(playoffPlayers[pid] || 0);
      const tot = rpts + ppts;
      if (tot > topTotal) { topTotal = tot; topPid = pid; topRegular = rpts; topPlayoff = ppts; }
    }

    const rosterMeta = rosterMap && rosterMap[rid] ? rosterMap[rid] : null;
    const owner_name = rosterMeta ? (rosterMeta.owner_name || (rosterMeta.owner && (rosterMeta.owner.display_name || rosterMeta.owner.username)) || null) : null;
    const roster_name = rosterMeta ? (rosterMeta.team_name || (rosterMeta.roster_raw && rosterMeta.roster_raw.metadata && rosterMeta.roster_raw.metadata.team_name) || null) : null;
    const teamAvatar = rosterMeta ? (rosterMeta.team_avatar || rosterMeta.owner_avatar || null) : null;

    // resolve player name/avatar from playersMap
    let playerName = null, playerAvatar = null;
    if (topPid) {
      const pm = resolvePlayerFromMap(playersMap, topPid);
      if (pm) {
        playerName = pm.full_name || (pm.first_name && pm.last_name ? `${pm.first_name} ${pm.last_name}` : (pm.display_name || pm.player_name || null));
        const cdnId = pm.player_id ?? pm.search_player_id ?? pm.playerId ?? pm.id ?? null;
        if (cdnId) playerAvatar = `https://sleepercdn.com/content/nba/players/${cdnId}.jpg`;
      }
    }

    out.push({
      rosterId: rid,
      owner_name: owner_name || `Roster ${rid}`,
      roster_name: roster_name || null,
      teamAvatar: teamAvatar || null,
      topPlayerId: topPid,
      topPlayerName: playerName || null,
      playerAvatar: playerAvatar || null,
      regularPoints: Math.round((topRegular || 0) * 100) / 100,
      playoffPoints: Math.round((topPlayoff || 0) * 100) / 100,
      totalPoints: Math.round(((topRegular || 0) + (topPlayoff || 0)) * 100) / 100,
      roster_meta: rosterMeta || null
    });
  }

  return out;
}

/* compute MVPs (overall + finals) from matchups — uses honor-hall approach */
async function computeMvpsFromMatchups(matchupsRows, playoffStart, playoffEnd, rosterMap, finalRes, fullSeasonMatchupsRows = null) {
  // reuse the previously-proven implementation, but simplified here for brevity
  // We'll re-use the computeMvpsFromMatchups body from prior file (kept same logic)
  // For brevity in this patch: call out to a small inline implementation.
  const debug = [];
  const playoffPlayers = {};
  const seasonPlayers = {};

  function note(playersObj, pid, pts, rosterId) {
    if (!pid || pid === '0' || pid === 0) return;
    const id = String(pid);
    if (!playersObj[id]) playersObj[id] = { points: 0, byRoster: {} };
    playersObj[id].points += Number(pts) || 0;
    if (rosterId) playersObj[id].byRoster[rosterId] = (playersObj[id].byRoster[rosterId] || 0) + (Number(pts) || 0);
  }

  for (const r of matchupsRows || []) {
    if (!r || !r.week) continue;
    const wk = Number(r.week);
    if (isNaN(wk)) continue;
    if (wk < playoffStart || wk > playoffEnd) continue;
    for (const side of ['teamA','teamB']) {
      const t = r[side];
      if (!t) continue;
      if (Array.isArray(t.starters) && Array.isArray(t.starters_points) && t.starters.length === t.starters_points.length) {
        for (let i=0;i<t.starters.length;i++) note(playoffPlayers, t.starters[i], t.starters_points[i], t.rosterId ?? null);
      } else if (Array.isArray(t.player_points)) {
        for (const pp of t.player_points) if (pp) note(playoffPlayers, pp.player_id ?? pp.playerId, pp.points ?? pp.pts ?? 0, t.rosterId ?? null);
      } else if (t.player_points && typeof t.player_points === 'object') {
        for (const pidKey of Object.keys(t.player_points || {})) note(playoffPlayers, pidKey, safeNum(t.player_points[pidKey]), t.rosterId ?? null);
      }
    }
  }

  if (fullSeasonMatchupsRows && Array.isArray(fullSeasonMatchupsRows) && fullSeasonMatchupsRows.length) {
    for (const r of fullSeasonMatchupsRows) {
      if (!r || !r.week) continue;
      const wk = Number(r.week);
      if (isNaN(wk)) continue;
      if (wk < 1 || wk > playoffEnd) continue;
      for (const side of ['teamA','teamB']) {
        const t = r[side];
        if (!t) continue;
        if (Array.isArray(t.starters) && Array.isArray(t.starters_points) && t.starters.length === t.starters_points.length) {
          for (let i=0;i<t.starters.length;i++) note(seasonPlayers, t.starters[i], t.starters_points[i], t.rosterId ?? null);
        } else if (Array.isArray(t.player_points)) {
          for (const pp of t.player_points) if (pp) note(seasonPlayers, pp.player_id ?? pp.playerId, pp.points ?? pp.pts ?? 0, t.rosterId ?? null);
        } else if (t.player_points && typeof t.player_points === 'object') {
          for (const pidKey of Object.keys(t.player_points || {})) note(seasonPlayers, pidKey, safeNum(t.player_points[pidKey]), t.rosterId ?? null);
        }
      }
    }
  } else {
    for (const id of Object.keys(playoffPlayers)) {
      seasonPlayers[id] = { points: playoffPlayers[id].points, byRoster: { ...(playoffPlayers[id].byRoster || {}) } };
    }
    debug.push('No fullSeasonMatchupsRows provided, overall MVP derived from playoff-only totals.');
  }

  let overallId = null, overallPts = -Infinity;
  for (const pid of Object.keys(seasonPlayers)) {
    if (seasonPlayers[pid].points > overallPts) { overallPts = seasonPlayers[pid].points; overallId = pid; }
  }

  // finals selection based on bracket pair (finalRes) — prefer matching week rows
  let finalsId = null, finalsPts = -Infinity;
  let finalsRow = null;
  if (finalRes && finalRes.winner && finalRes.loser) {
    const a = String(finalRes.winner), b = String(finalRes.loser);
    const preferredWeeks = [playoffEnd, playoffEnd - 1, playoffEnd - 2];
    for (const wk of preferredWeeks) {
      for (const r of matchupsRows || []) {
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
    for (const side of ['teamA','teamB']) {
      const t = finalsRow[side];
      if (!t) continue;
      if (Array.isArray(t.starters) && Array.isArray(t.starters_points)) {
        for (let i=0;i<t.starters.length;i++) {
          const pid = String(t.starters[i]); const pts = Number(t.starters_points[i]) || 0;
          if (!pid || pid === '0') continue;
          localPoints[pid] = (localPoints[pid] || 0) + pts;
        }
      } else if (Array.isArray(t.player_points)) {
        for (const pp of t.player_points) { const pid = pp.player_id ?? pp.playerId ?? pp.id ?? null; const pts = Number(pp.points ?? pp.pts ?? 0); if (!pid || String(pid) === '0') continue; localPoints[String(pid)] = (localPoints[String(pid)] || 0) + pts; }
      } else if (t.player_points && typeof t.player_points === 'object') {
        for (const pidKey of Object.keys(t.player_points || {})) localPoints[pidKey] = (localPoints[pidKey] || 0) + safeNum(t.player_points[pidKey]);
      }
    }
    for (const pid of Object.keys(localPoints)) {
      const pts = localPoints[pid] || 0;
      if (pts > finalsPts) { finalsPts = pts; finalsId = pid; }
    }
    debug.push('Finals row matched — computed finals MVP from that matchup.');
  } else {
    for (const pid of Object.keys(playoffPlayers)) {
      const pts = playoffPlayers[pid].points || 0;
      if (pts > finalsPts) { finalsPts = pts; finalsId = pid; }
    }
    debug.push('Could not find finals matchup; finals MVP fallback to top playoff scorer.');
  }

  const playersMap = await fetchPlayersMap();
  function buildMvpObj(pid, pts, playersObj) {
    if (!pid) return null;
    const pm = resolvePlayerFromMap(playersMap, pid) || {};
    const playerName = pm.full_name || (pm.first_name && pm.last_name ? `${pm.first_name} ${pm.last_name}` : (pm.display_name || pm.player_name || pm.name)) || (`Player ${pid}`);
    const byRoster = (playersObj && playersObj[pid] && playersObj[pid].byRoster) ? playersObj[pid].byRoster : {};
    let topRosterId = null, topRosterPts = -Infinity;
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

export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const url = event.url;
  const origin = url?.origin ?? null;
  const incomingSeasonParam = url.searchParams.get('season') || null;

  const messages = [];
  const jsonLinks = [];

  // build seasons chain (honor-hall approach)
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { mainLeague = null; messages.push('Failed fetching base league ' + BASE_LEAGUE_ID + ' — ' + (e?.message ?? String(e))); }
    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id), season: mainLeague.season ?? null, name: mainLeague.name ?? null });
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

  // dedupe + sort ascending
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  seasons = Object.values(byId);
  seasons.sort((a,b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return (a.season < b.season ? -1 : (a.season > b.season ? 1 : 0));
  });

  // selectedSeason (dropdown only determines MVPs) -> default to latest season/seasons array or incoming param
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = String(BASE_LEAGUE_ID);
    }
  }

  const seasonsToProcess = seasons.length ? seasons.map(s => ({ leagueId: s.league_id, season: s.season })) : [{ leagueId: BASE_LEAGUE_ID, season: String(new Date().getFullYear()) }];

  // prefetch players map once
  const playersMap = await fetchPlayersMap();

  const seasonsResults = [];
  const crossSeasonByRoster = {}; // store best single-season per roster (by totalPoints)
  const playoffAllTimeByRoster = {}; // store best playoff season per roster (by playoffPoints)

  for (const s of seasonsToProcess) {
    const seasonLabel = s.season != null ? String(s.season) : (s.leagueId ? String(s.leagueId) : null);
    messages.push(`Season ${seasonLabel}: starting processing.`);

    const leagueId = s.leagueId || BASE_LEAGUE_ID;

    let leagueMeta = null;
    try { leagueMeta = await sleeper.getLeague(leagueId, { ttl: 60 * 5 }); } catch (e) { leagueMeta = null; messages.push(`Season ${seasonLabel}: failed fetching league meta (${e?.message ?? e})`); }

    let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : 15;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
    const playoffEnd = playoffStart + 2;

    let rosterMap = {};
    try {
      rosterMap = await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 }) || {};
      messages.push(`Season ${seasonLabel}: loaded rosters (${Object.keys(rosterMap).length}).`);
    } catch (e) {
      rosterMap = {};
      messages.push(`Season ${seasonLabel}: failed to load rosters — ${e?.message ?? e}`);
    }

    // compute minimal regular-season trackers for tiebreaks
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
    for (let week = regStart; week <= regEnd; week++) {
      let wkMatchups = [];
      try { wkMatchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 }) || []; } catch (e) { /* ignore */ }
      if (!wkMatchups || !wkMatchups.length) continue;
      const byMatch = {};
      for (let mi=0; mi<wkMatchups.length; mi++) {
        const e = wkMatchups[mi]; const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null; const wk = e.week ?? e.w ?? week;
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
        for (let i=0;i<entries.length;i++) {
          const ent = entries[i];
          const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? ('r' + i));
          const ppts = safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0);
          participants.push({ rosterId: pid, points: ppts });
          if (!statsByRosterRegular[pid]) statsByRosterRegular[pid] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
          if (!resultsByRosterRegular[pid]) resultsByRosterRegular[pid] = [];
          if (!paByRosterRegular[pid]) paByRosterRegular[pid] = 0;
          statsByRosterRegular[pid].pf += ppts;
        }

        for (let i=0;i<participants.length;i++) {
          const part = participants[i];
          const opponents = participants.filter((_, idx) => idx !== i);
          let oppAvg = 0;
          if (opponents.length) oppAvg = opponents.reduce((acc,o) => acc + o.points, 0) / opponents.length;
          paByRosterRegular[part.rosterId] = (paByRosterRegular[part.rosterId] || 0) + oppAvg;
          if (part.points > oppAvg + 1e-9) {
            resultsByRosterRegular[part.rosterId].push('W');
            statsByRosterRegular[part.rosterId].wins += 1;
          } else if (part.points < oppAvg - 1e-9) {
            resultsByRosterRegular[part.rosterId].push('L');
            statsByRosterRegular[part.rosterId].losses += 1;
          } else {
            resultsByRosterRegular[part.rosterId].push('T');
            statsByRosterRegular[part.rosterId].ties += 1;
          }
        }
      }
    } // end regular loop

    function buildStandingsFromTrackers(statsByRoster, resultsByRoster, paByRoster) {
      const keys = Object.keys(resultsByRoster).length ? Object.keys(resultsByRoster) : (rosterMap ? Object.keys(rosterMap) : []);
      const out = [];
      for (let i=0;i<keys.length;i++) {
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

    // load playoff matchups (JSON-first) and full season matchups
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
        // API fallback for playoff weeks
        const rawMatchups = [];
        for (let wk=playoffStart; wk<=Math.min(playoffEnd, MAX_WEEKS); wk++) {
          try {
            const wkMatchups = await sleeper.getMatchupsForWeek(leagueId, wk, { ttl: 60 * 5 });
            if (Array.isArray(wkMatchups) && wkMatchups.length) {
              for (const m of wkMatchups) { if (m && (m.week == null && m.w == null)) m.week = wk; rawMatchups.push(m); }
            }
          } catch (we) { /* ignore single-week failures */ }
        }

        const byMatch = {};
        for (let i=0;i<rawMatchups.length;i++) {
          const e = rawMatchups[i];
          const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
          const wk = e.week ?? e.w ?? null;
          const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + i));
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(e);
        }

        const mkeys = Object.keys(byMatch);
        for (let ki=0; ki<mkeys.length; ki++) {
          const entries = byMatch[mkeys[ki]];
          if (!entries || entries.length === 0) continue;

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
            const a = entries[0], b = entries[1];
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

    // fullSeasonMatchupsRows: prefer local JSON; else construct via API weeks 1..playoffEnd
    let fullSeasonMatchupsRows = null;
    if (localUsedKey && matchupsRows && matchupsRows.length) {
      fullSeasonMatchupsRows = matchupsRows.slice();
    } else {
      const allRaw = [];
      for (let wk = 1; wk <= Math.min(playoffEnd, MAX_WEEKS); wk++) {
        try {
          const wkMatchups = await sleeper.getMatchupsForWeek(leagueId, wk, { ttl: 60 * 5 });
          if (Array.isArray(wkMatchups) && wkMatchups.length) {
            for (const m of wkMatchups) { if (m && (m.week == null && m.w == null)) m.week = wk; allRaw.push(m); }
          }
        } catch (e) { /* continue */ }
      }
      if (allRaw.length) {
        fullSeasonMatchupsRows = normalizeApiMatchups(allRaw);
        messages.push(`Season ${seasonLabel}: loaded ${fullSeasonMatchupsRows.length} total matchups via API for full season.`);
      } else {
        fullSeasonMatchupsRows = matchupsRows.slice();
      }
    }

    if (!fullSeasonMatchupsRows || !fullSeasonMatchupsRows.length) {
      messages.push(`Season ${seasonLabel}: no matchups available — skipping.`);
      seasonsResults.push({ season: seasonLabel, leagueId, championshipWeek: playoffEnd, finalsMvp: null, overallMvp: null, teamLeaders: [], _sourceJson: localUsedKey ?? null });
      continue;
    }

    // bracket simulation to derive finalRes (same logic as honor-hall)
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
        aPts = pAobj?.points ?? 0; bPts = pBobj?.points ?? 0;
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

    function runMatch(seedA, seedB) {
      const a = seedA.rosterId, b = seedB.rosterId;
      const matchRow = findMatchForPair(a, b);
      const decision = decideWinnerFromMatch(matchRow, a, b);
      if (!decision) {
        const winner = Number(seedA.seed) <= Number(seedB.seed) ? seedA.rosterId : seedB.rosterId;
        const loser = winner === seedA.rosterId ? seedB.rosterId : seedA.rosterId;
        return { winner, loser, row: matchRow, reason: 'fallback-no-match' };
      }
      return { winner: decision.winner, loser: decision.loser, row: matchRow, reason: decision.reason };
    }

    // build winners seeds 1..8 logic
    const winnersSeeds = [];
    for (let sN=1; sN<=8; sN++) {
      const rid = placementToRoster[sN] ?? null;
      if (rid) winnersSeeds.push({ seed: sN, rosterId: rid });
    }
    const wR1Pairs = [
      [1,8],[2,7],[3,6],[4,5]
    ].map(([s1,s2]) => ({ a: {seed: s1, rosterId: placementToRoster[s1]}, b: {seed: s2, rosterId: placementToRoster[s2]} }));

    const wR1Results = [];
    for (const p of wR1Pairs) {
      if (!p.a.rosterId || !p.b.rosterId) { wR1Results.push({ winner: p.a.rosterId || p.b.rosterId, loser: p.a.rosterId ? p.b.rosterId : p.a.rosterId, reason: 'missing-roster' }); continue; }
      wR1Results.push(runMatch(p.a, p.b));
    }

    const wR1Winners = wR1Results.map(r => ({ seed: placementMap[r.winner] ?? null, rosterId: r.winner, loserSeed: placementMap[r.loser] ?? null, loserId: r.loser })).sort((a,b) => (a.seed||999)-(b.seed||999));
    const wSemiPairs = [
      [ wR1Winners[0], wR1Winners[wR1Winners.length-1] ],
      [ wR1Winners[1], wR1Winners[wR1Winners.length-2] ]
    ];

    const wSemiResults = [];
    for (const pair of wSemiPairs) {
      if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) { wSemiResults.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[1]?.rosterId || pair[0]?.rosterId, reason:'missing' }); continue; }
      wSemiResults.push(runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}));
    }

    const finalRes = (wSemiResults.length >= 2) ? runMatch({seed: placementMap[wSemiResults[0].winner], rosterId: wSemiResults[0].winner}, {seed: placementMap[wSemiResults[1].winner], rosterId: wSemiResults[1].winner}) : null;
    if (finalRes) messages.push(`Season ${seasonLabel}: bracket simulation finalRes -> winner ${finalRes.winner}, loser ${finalRes.loser} (reason ${finalRes.reason}).`);
    else messages.push(`Season ${seasonLabel}: could not derive finalRes from bracket simulation — will fallback to matchups week scanning.`);

    // compute MVPs using computeMvpsFromMatchups
    let finalsMvp = null, overallMvp = null, mdebug = [];
    try {
      const mm = await computeMvpsFromMatchups(matchupsRows.length ? matchupsRows : fullSeasonMatchupsRows, playoffStart, playoffEnd, rosterMap, finalRes, fullSeasonMatchupsRows);
      finalsMvp = mm.finalsMvp ?? null;
      overallMvp = mm.overallMvp ?? null;
      mdebug = Array.isArray(mm.debug) ? mm.debug : [];
      for (const d of mdebug) messages.push(`Season ${seasonLabel}: ${d}`);
    } catch (e) { messages.push(`Season ${seasonLabel}: error computing MVPs — ${e?.message ?? e}`); }

    // compute team leaders server-side for this season
    let teamLeaders = [];
    try {
      teamLeaders = await computeTeamLeadersForSeason(fullSeasonMatchupsRows, matchupsRows, playoffStart, playoffEnd, rosterMap, playersMap);
      // ensure playerAvatar/teamAvatar populated with fallbacks
      for (const t of teamLeaders) {
        t.teamAvatar = t.teamAvatar || (t.roster_meta ? (t.roster_meta.team_avatar || t.roster_meta.owner_avatar) : null) || null;
        if (!t.playerAvatar && t.topPlayerId) {
          const pm = resolvePlayerFromMap(playersMap, t.topPlayerId);
          if (pm) {
            const cdnId = pm.player_id ?? pm.search_player_id ?? pm.playerId ?? pm.id ?? null;
            if (cdnId) t.playerAvatar = `https://sleepercdn.com/content/nba/players/${cdnId}.jpg`;
          }
        }
        t.regularPoints = Math.round((t.regularPoints||0)*100)/100;
        t.playoffPoints = Math.round((t.playoffPoints||0)*100)/100;
        t.totalPoints = Math.round((t.totalPoints||0)*100)/100;
      }
    } catch (e) {
      messages.push(`Season ${seasonLabel}: failed computing teamLeaders — ${e?.message ?? e}`);
      teamLeaders = [];
    }

    // feed cross-season aggregates (best single-season per roster by totalPoints; playoff best by playoffPoints)
    for (const t of teamLeaders) {
      const rid = String(t.rosterId);
      const existing = crossSeasonByRoster[rid];
      if (!existing || (Number(t.totalPoints || 0) > Number(existing.totalPoints || 0))) {
        crossSeasonByRoster[rid] = {
          rosterId: rid,
          owner_name: t.owner_name,
          roster_name: t.roster_name,
          teamAvatar: t.teamAvatar,
          topPlayerId: t.topPlayerId,
          topPlayerName: t.topPlayerName,
          playerAvatar: t.playerAvatar,
          regularPoints: t.regularPoints,
          playoffPoints: t.playoffPoints,
          totalPoints: t.totalPoints,
          season: seasonLabel,
          roster_meta: t.roster_meta ?? null
        };
      }
      const existingPlayoff = playoffAllTimeByRoster[rid];
      if (!existingPlayoff || (Number(t.playoffPoints || 0) > Number(existingPlayoff.playoffPoints || 0))) {
        playoffAllTimeByRoster[rid] = {
          rosterId: rid,
          owner_name: t.owner_name,
          roster_name: t.roster_name,
          teamAvatar: t.teamAvatar,
          topPlayerId: t.topPlayerId,
          topPlayerName: t.topPlayerName,
          playerAvatar: t.playerAvatar,
          playoffPoints: t.playoffPoints,
          season: seasonLabel,
          roster_meta: t.roster_meta ?? null
        };
      }
    }

    // push season result
    seasonsResults.push({
      season: seasonLabel,
      leagueId,
      championshipWeek: playoffEnd,
      finalsMvp,
      overallMvp,
      teamLeaders,
      matchupsRows,
      fullSeasonMatchupsRows,
      _sourceJson: localUsedKey ?? null
    });
  } // end seasons loop

  // convert cross-season maps to arrays sorted by points desc
  const crossSeasonLeaders = Object.keys(crossSeasonByRoster).map(k => crossSeasonByRoster[k]).sort((a,b) => (Number(b.totalPoints||0) - Number(a.totalPoints||0)));
  const playoffAllTimeLeaders = Object.keys(playoffAllTimeByRoster).map(k => playoffAllTimeByRoster[k]).sort((a,b) => (Number(b.playoffPoints||0) - Number(a.playoffPoints||0)));

  return {
    seasons,
    selectedSeason: selectedSeasonParam, // dropdown uses this only for MVP selection
    seasonsResults,
    jsonLinks,
    messages,
    crossSeasonLeaders,
    playoffAllTimeLeaders
  };
}
