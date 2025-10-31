// src/routes/honor-hall/+page.server.js
// Honor Hall loader + bracket simulation (updated losers-bracket logic)
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

function computeStreaks(resultsArray) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  if (!resultsArray || !Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
  for (let i = 0; i < resultsArray.length; i++) {
    const r = resultsArray[i];
    if (r === 'W') {
      curW += 1;
      curL = 0;
      if (curW > maxW) maxW = curW;
    } else if (r === 'L') {
      curL += 1;
      curW = 0;
      if (curL > maxL) maxL = curL;
    } else {
      curW = 0;
      curL = 0;
    }
  }
  return { maxW, maxL };
}

/* Helper: attempt to find and load local season_matchups JSON for a given key.
   Tries several likely file locations. Returns parsed object or null. */
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
      } catch (e) {
        // ignore parse error, try next
      }
    } catch (e) {
      // file not found, try next
    }
  }
  return null;
}

/* Helper: get a players map (playerId -> playerObj) for NBA players.
   Tries sleeper client helper if available, otherwise falls back to public API fetch.
   Returns an object mapping ids to player objects; returns {} on failure. */
async function fetchPlayersMap() {
  try {
    if (sleeper && typeof sleeper.getPlayers === 'function') {
      // If your client exposes getPlayers, use it (may be cached)
      const map = await sleeper.getPlayers('nba', { ttl: 60 * 60 });
      if (map && typeof map === 'object') return map;
    }
  } catch (e) {
    // ignore and fallback
  }
  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nba');
    if (!res.ok) return {};
    const obj = await res.json();
    return obj || {};
  } catch (e) {
    return {};
  }
}

/* Aggregate per-player points from matchupsRows (expects teamA.teamA.starters and starters_points),
   restricted to weeks in [playoffStart, playoffEnd]. Returns { overallMvp, finalsMvp, debugLines } */
async function computeMvpsFromMatchups(matchupsRows, playoffStart, playoffEnd, rosterMap, finalRes) {
  const debug = [];
  const playersPoints = {}; // id -> { points: number, rosterMap: { rosterId: pts } }

  function notePlayer(pid, pts, rosterId) {
    if (!pid || pid === '0' || pid === 0) return;
    const id = String(pid);
    if (!playersPoints[id]) playersPoints[id] = { points: 0, byRoster: {} };
    playersPoints[id].points += Number(pts) || 0;
    if (rosterId) {
      playersPoints[id].byRoster[rosterId] = (playersPoints[id].byRoster[rosterId] || 0) + (Number(pts) || 0);
    }
  }

  // collect from playoff weeks only
  for (const r of matchupsRows) {
    if (!r || !r.week) continue;
    const wk = Number(r.week);
    if (isNaN(wk)) continue;
    if (wk < playoffStart || wk > playoffEnd) continue;

    // prefer structured teamA/teamB with starters arrays if present
    for (const side of ['teamA', 'teamB']) {
      const t = r[side];
      if (!t) continue;
      // If JSON-structured: starters + starters_points arrays
      if (Array.isArray(t.starters) && Array.isArray(t.starters_points) && t.starters.length === t.starters_points.length) {
        for (let i = 0; i < t.starters.length; i++) {
          const pid = t.starters[i];
          const pts = t.starters_points[i];
          notePlayer(pid, pts, t.rosterId ?? t.rosterId ?? null);
        }
      } else if (Array.isArray(t.player_points)) {
        // if there is a player_points array mapping, attempt to sum those
        for (const pp of t.player_points) {
          if (!pp) continue;
          if (pp.player_id || pp.playerId) notePlayer(pp.player_id ?? pp.playerId, pp.points ?? pp.pts ?? 0, t.rosterId ?? null);
        }
      }
    }
  }

  // If no players collected, we can't compute MVPs
  const allPlayerIds = Object.keys(playersPoints);
  if (!allPlayerIds.length) {
    debug.push('No per-player starter points found in matchupsRows; skipping MVP computation.');
    return { finalsMvp: null, overallMvp: null, debug };
  }

  // fetch player names map
  const playersMap = await fetchPlayersMap();

  // compute overall MVP (player with highest cumulative playoff points)
  let overallId = null;
  let overallPts = -Infinity;
  for (const pid of allPlayerIds) {
    const pinfo = playersPoints[pid];
    if (pinfo.points > overallPts) {
      overallPts = pinfo.points;
      overallId = pid;
    }
  }

  // compute finals MVP: find the final matchup row (week === playoffEnd) that includes finalists or use finalRes info
  let finalsId = null;
  let finalsPts = -Infinity;
  // find finals rows (week == playoffEnd)
  const finalsRows = matchupsRows.filter(r => Number(r.week) === Number(playoffEnd) && r.participantsCount && r.participantsCount >= 1);
  // prefer a row that matches finalRes winner/loser if provided
  let finalsRow = null;
  if (finalsRows.length) {
    if (finalRes && finalRes.winner && finalRes.loser) {
      finalsRow = finalsRows.find(r => {
        if (r.participantsCount === 2) {
          const a = String(r.teamA.rosterId), b = String(r.teamB.rosterId);
          return (a === String(finalRes.winner) && b === String(finalRes.loser)) || (a === String(finalRes.loser) && b === String(finalRes.winner));
        }
        if (r.combinedParticipants) {
          const ids = r.combinedParticipants.map(p => String(p.rosterId));
          return ids.includes(String(finalRes.winner)) && ids.includes(String(finalRes.loser));
        }
        return false;
      });
    }
    if (!finalsRow) finalsRow = finalsRows[0];
  } else {
    // fallback: search any row that contains both champion and runner-up across all matchupsRows
    if (finalRes && finalRes.winner && finalRes.loser) {
      finalsRow = matchupsRows.find(r => {
        if (r.participantsCount === 2) {
          const a = String(r.teamA.rosterId), b = String(r.teamB.rosterId);
          return (a === String(finalRes.winner) && b === String(finalRes.loser)) || (a === String(finalRes.loser) && b === String(finalRes.winner));
        }
        if (r.combinedParticipants) {
          const ids = r.combinedParticipants.map(p => String(p.rosterId));
          return ids.includes(String(finalRes.winner)) && ids.includes(String(finalRes.loser));
        }
        return false;
      });
    }
  }

  // gather player points just for finalsRow (if present)
  if (finalsRow) {
    const localPoints = {};
    for (const side of ['teamA', 'teamB']) {
      const t = finalsRow[side];
      if (!t) continue;
      if (Array.isArray(t.starters) && Array.isArray(t.starters_points) && t.starters.length === t.starters_points.length) {
        for (let i = 0; i < t.starters.length; i++) {
          const pid = String(t.starters[i]);
          const pts = Number(t.starters_points[i]) || 0;
          if (!pid || pid === '0') continue;
          localPoints[pid] = (localPoints[pid] || 0) + pts;
        }
      } else if (Array.isArray(t.player_points)) {
        for (const pp of t.player_points) {
          const pid = String(pp.player_id ?? pp.playerId);
          const pts = Number(pp.points ?? pp.pts ?? 0);
          if (!pid || pid === '0') continue;
          localPoints[pid] = (localPoints[pid] || 0) + pts;
        }
      }
    }

    // choose finals MVP based on highest points in finalsRow
    for (const pid of Object.keys(localPoints)) {
      const pts = localPoints[pid];
      if (pts > finalsPts) {
        finalsPts = pts;
        finalsId = pid;
      }
    }
  } else {
    debug.push('Could not find finals matchup row to compute Finals MVP; falling back to top playoff scorer if present.');
    // use top overall player but restrict to those who played in playoff weeks (already restricted above)
    finalsId = overallId;
    finalsPts = overallPts;
  }

  // Form output objects, including playerName and roster info (topRosterId)
  function buildMvpObj(pid, pts) {
    if (!pid) return null;
    const pm = playersMap[pid] || {};
    const playerName = pm.full_name || (pm.first_name && pm.last_name ? `${pm.first_name} ${pm.last_name}` : (pm.player_name || pm.name || null)) || (`Player ${pid}`);
    const byRoster = playersPoints[pid] ? playersPoints[pid].byRoster : {};
    // pick roster with max contribution for this player
    let topRosterId = null;
    let topRosterPts = -Infinity;
    for (const rId in byRoster) {
      const rpts = byRoster[rId] || 0;
      if (rpts > topRosterPts) {
        topRosterPts = rpts;
        topRosterId = rId;
      }
    }
    const obj = {
      playerId: pid,
      playerName,
      points: Math.round((pts || 0) * 100) / 100,
      topRosterId,
      roster_meta: (topRosterId && rosterMap && rosterMap[String(topRosterId)]) ? rosterMap[String(topRosterId)] : null
    };
    return obj;
  }

  const overallMvp = buildMvpObj(overallId, overallPts);
  const finalsMvp = buildMvpObj(finalsId, finalsPts);

  if (finalsMvp) debug.push(`Finals MVP computed: ${finalsMvp.playerName} (${finalsMvp.playerId}) — ${finalsMvp.points} pts`);
  if (overallMvp) debug.push(`Overall MVP computed: ${overallMvp.playerName} (${overallMvp.playerId}) — ${overallMvp.points} pts`);

  return { finalsMvp, overallMvp, debug };
}

export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const incomingSeasonParam = url.searchParams.get('season') || null;

  const messages = [];
  const prevChain = [];

  // --- build seasons chain ---
  let seasons = [];
  try {
    let mainLeague = null;
    try {
      mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 });
    } catch (e) {
      messages.push('Failed fetching base league ' + BASE_LEAGUE_ID + ' — ' + (e && e.message ? e.message : String(e)));
    }

    if (mainLeague) {
      seasons.push({
        league_id: String(mainLeague.league_id || BASE_LEAGUE_ID),
        season: mainLeague.season ?? null,
        name: mainLeague.name ?? null
      });
      prevChain.push(String(mainLeague.league_id || BASE_LEAGUE_ID));

      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) {
            messages.push('Could not fetch league for previous_league_id ' + currPrev);
            break;
          }
          seasons.push({
            league_id: String(prevLeague.league_id || currPrev),
            season: prevLeague.season ?? null,
            name: prevLeague.name ?? null
          });
          prevChain.push(String(prevLeague.league_id || currPrev));
          currPrev = prevLeague.previous_league_id ? String(prevLeague.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err && err.message ? err.message : String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error while building seasons chain: ' + (err && err.message ? err.message : String(err)));
  }

  // dedupe
  const byId = {};
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);

  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = String(BASE_LEAGUE_ID);
    }
  }

  let selectedLeagueId = null;
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selectedSeasonParam || BASE_LEAGUE_ID);

  let leagueMeta = null;
  try { leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }); }
  catch (e) { leagueMeta = null; messages.push('Failed fetching league meta for ' + selectedLeagueId + ' — ' + (e?.message ?? e)); }

  let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : null;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
    playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      playoffStart = 15;
      messages.push('Playoff start not found in metadata — defaulting to week ' + playoffStart);
    }
  }
  let playoffEnd = playoffStart + 2;

  // roster map
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
  } catch (e) {
    rosterMap = {};
    messages.push('Failed fetching rosters for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }

  // --- compute regular-season standings (for tiebreaks) ---
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
    let matchups = null;
    try {
      matchups = await sleeper.getMatchupsForWeek(selectedLeagueId, week, { ttl: 60 * 5 });
    } catch (errWeek) {
      messages.push('Error fetching matchups for league ' + selectedLeagueId + ' week ' + week + ' — ' + (errWeek && errWeek.message ? errWeek.message : String(errWeek)));
      continue;
    }
    if (!matchups || !matchups.length) continue;

    const byMatch = {};
    for (let mi = 0; mi < matchups.length; mi++) {
      const e = matchups[mi];
      const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
      const wk = e.week ?? e.w ?? week;
      const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(e);
    }

    const keys = Object.keys(byMatch);
    for (let k = 0; k < keys.length; k++) {
      const entries = byMatch[keys[k]];
      if (!entries || entries.length === 0) continue;

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
      for (let i = 0; i < entries.length; i++) {
        const ent = entries[i];
        const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? ('r' + i));
        const ppts = safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0);
        participants.push({ rosterId: pid, points: ppts });
        if (!statsByRosterRegular[pid]) statsByRosterRegular[pid] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
        if (!resultsByRosterRegular[pid]) resultsByRosterRegular[pid] = [];
        if (!paByRosterRegular[pid]) paByRosterRegular[pid] = 0;
        statsByRosterRegular[pid].pf += ppts;
      }

      for (let i = 0; i < participants.length; i++) {
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
    for (let i = 0; i < keys.length; i++) {
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
  for (let i = 0; i < regularStandings.length; i++) placementMap[String(regularStandings[i].rosterId)] = i + 1;
  const placementToRoster = {};
  for (const k in placementMap) placementToRoster[ placementMap[k] ] = k;

  // -------------------------
  // JSON-first: try to load local season_matchups JSON and use it for playoff matchups when present
  // -------------------------
  let matchupsRows = [];
  let localUsedKey = null;
  try {
    // build candidate keys (season year or league id) and dedupe
    const candidateKeys = [];
    if (selectedSeasonParam) candidateKeys.push(String(selectedSeasonParam));
    if (leagueMeta && typeof leagueMeta.season !== 'undefined' && leagueMeta.season != null) candidateKeys.push(String(leagueMeta.season));
    if (selectedLeagueId) candidateKeys.push(String(selectedLeagueId));
    try {
      const seasonObj = seasons.find(s => String(s.league_id) === String(selectedLeagueId));
      if (seasonObj && seasonObj.season != null) candidateKeys.push(String(seasonObj.season));
    } catch (_) {}
    const uniqKeys = Array.from(new Set(candidateKeys.filter(k => k != null && k !== '')));

    let foundLocal = null;
    let foundKey = null;
    for (const k of uniqKeys) {
      const attempt = await tryLoadLocalSeasonMatchups(k);
      if (attempt && attempt.parsedRaw) {
        foundLocal = attempt.parsedRaw;
        foundKey = k;
        // store path if needed: attempt.path
        break;
      }
    }

    if (foundLocal) {
      // If JSON includes a top-level playoff_week_start, use it to remap relative weeks into league weeks
      const baseWeek = Number(foundLocal.playoff_week_start ?? foundLocal.playoffWeekStart ?? (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start ? leagueMeta.settings.playoff_week_start : playoffStart)) || playoffStart;
      // collect matchups arrays
      let collected = [];
      // If file is an array of matchups
      if (Array.isArray(foundLocal)) {
        collected = foundLocal;
      } else if (Array.isArray(foundLocal.parsedRaw)) {
        collected = foundLocal.parsedRaw;
      } else {
        // gather arrays from keys (like "1": [..], "2": [..], ...)
        for (const kk of Object.keys(foundLocal)) {
          if (kk === 'playoff_week_start' || kk === 'metadata' || kk === 'season') continue;
          const v = foundLocal[kk];
          if (Array.isArray(v)) {
            for (const m of v) collected.push(m);
          }
        }
      }

      // normalize each collected match object into matchupsRows format
      for (const m of collected) {
        if (!m) continue;
        const wk = (typeof m.week !== 'undefined' && m.week != null) ? Number(m.week) : ((typeof m.w !== 'undefined') ? Number(m.w) : null);
        // If wk is relative (1..N) map to actual weeks via baseWeek
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

        // JSON structure often contains teamA/teamB naming
        const tA = m.teamA ? normalizeTeam(m.teamA) : (m.home ? normalizeTeam(m.home) : null);
        const tB = m.teamB ? normalizeTeam(m.teamB) : (m.away ? normalizeTeam(m.away) : null);

        // Some JSON uses teamAScore / teamBScore keys
        const scoreA = (typeof m.teamAScore !== 'undefined') ? Number(m.teamAScore) : (typeof m.homeScore !== 'undefined' ? Number(m.homeScore) : (m.teamA && (m.teamA.points ?? m.teamA.score) ? safeNum(m.teamA.points ?? m.teamA.score) : (m.teamA && m.teamA.teamAScore ? safeNum(m.teamA.teamAScore) : null)));
        const scoreB = (typeof m.teamBScore !== 'undefined') ? Number(m.teamBScore) : (typeof m.awayScore !== 'undefined' ? Number(m.awayScore) : (m.teamB && (m.teamB.points ?? m.teamB.score) ? safeNum(m.teamB.points ?? m.teamB.score) : (m.teamB && m.teamB.teamBScore ? safeNum(m.teamB.teamBScore) : null)));

        const participantsCount = (tA && tA.rosterId ? 1 : 0) + (tB && tB.rosterId ? 1 : 0);

        // set points if not present on team object
        if (tA && (tA.points == null)) tA.points = (scoreA != null ? scoreA : (m.teamA && (m.teamA.points ?? m.teamA.points_for ?? m.teamA.pts) ? safeNum(m.teamA.points ?? m.teamA.points_for ?? m.teamA.pts) : null));
        if (tB && (tB.points == null)) tB.points = (scoreB != null ? scoreB : (m.teamB && (m.teamB.points ?? m.teamB.points_for ?? m.teamB.pts) ? safeNum(m.teamB.points ?? m.teamB.points_for ?? m.teamB.pts) : null));

        matchupsRows.push({
          matchup_id: m.matchup_id ?? m.matchupId ?? m.id ?? null,
          season: String(foundLocal.season ?? leagueMeta?.season ?? selectedSeasonParam ?? null),
          week: mappedWeek,
          teamA: tA || { rosterId: null, name: 'BYE', avatar: null, points: null, starters: null, starters_points: null, player_points: null, placement: null },
          teamB: tB || { rosterId: null, name: 'BYE', avatar: null, points: null, starters: null, starters_points: null, player_points: null, placement: null },
          participantsCount: participantsCount
        });
      }

      localUsedKey = foundKey;
    } else {
      // no local JSON found; matchupsRows left empty, we'll fall back to API below
    }
  } catch (e) {
    // Don't fail hard if file reading errors happen; fallback to API
    messages.push('Error while attempting to load local season_matchups JSON: ' + (e?.message ?? String(e)));
  }

  // If no local matchups found, fetch from the Sleeper API as before
  if (!matchupsRows || !matchupsRows.length) {
    const rawMatchups = [];
    for (let wk = playoffStart; wk <= playoffEnd; wk++) {
      try {
        const wkMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, wk, { ttl: 60 * 5 });
        if (Array.isArray(wkMatchups) && wkMatchups.length) {
          for (const m of wkMatchups) {
            if (m && (m.week == null && m.w == null)) m.week = wk;
            rawMatchups.push(m);
          }
        }
      } catch (we) {
        messages.push('Failed to fetch matchups for week ' + wk + ': ' + (we?.message ?? String(we)));
      }
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
  } // end building matchupsRows

  // helper to find a playoff matchup between two rosterIds across playoff weeks
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

  const trace = [];
  trace.push(`Loaded rosters (${Object.keys(rosterMap).length})`);

  function seedToRoster(seed) {
    const rid = placementToRoster[seed] ?? null;
    const meta = rid ? rosterMap[rid] : null;
    return { rosterId: rid, name: meta?.team_name ?? meta?.owner_name ?? ('Roster ' + rid) };
  }

  const winnersSeeds = [];
  const losersSeeds = [];
  for (let s = 1; s <= 14; s++) {
    const rid = placementToRoster[s] ?? null;
    if (!rid) continue;
    if (s <= 8) winnersSeeds.push({ seed: s, rosterId: rid });
    else losersSeeds.push({ seed: s, rosterId: rid });
  }

  function runMatch(seedA, seedB, label, preferredWeeks = [playoffStart, playoffStart+1, playoffStart+2]) {
    const a = seedA.rosterId, b = seedB.rosterId;
    const matchRow = findMatchForPair(a, b, preferredWeeks);
    const decision = decideWinnerFromMatch(matchRow, a, b);
    if (!decision) {
      const winner = Number(seedA.seed) <= Number(seedB.seed) ? seedA.rosterId : seedB.rosterId;
      const loser = winner === seedA.rosterId ? seedB.rosterId : seedA.rosterId;
      trace.push(`${label} ${seedA.seed}v${seedB.seed} -> ${ placementMap[winner] ?? winner } (fallback-no-match)`);
      return { winner, loser, row: matchRow, reason: 'fallback-no-match' };
    }
    const winner = decision.winner;
    const loser = decision.loser;
    const wSeed = placementMap[winner] ?? winner;
    trace.push(`${label} ${seedA.seed}v${seedB.seed} -> ${ wSeed } (${decision.reason})`);
    return { winner, loser, row: matchRow, reason: decision.reason };
  }

  // -------------------------
  // Winners bracket
  // -------------------------
  const wR1Pairs = [
    [1,8],[2,7],[3,6],[4,5]
  ].map(([s1,s2]) => ({ a: {seed: s1, rosterId: placementToRoster[s1]}, b: {seed: s2, rosterId: placementToRoster[s2]} }));

  const wR1Results = [];
  for (const p of wR1Pairs) {
    if (!p.a.rosterId || !p.b.rosterId) {
      trace.push(`W1 ${p.a.seed}v${p.b.seed} -> missing-roster`);
      wR1Results.push({ winner: p.a.rosterId || p.b.rosterId, loser: p.a.rosterId ? p.b.rosterId : p.a.rosterId, reason: 'missing-roster' });
      continue;
    }
    const res = runMatch(p.a, p.b, `W1`);
    wR1Results.push(res);
  }

  const wR1Winners = wR1Results.map((r, idx) => ({ seed: placementMap[r.winner] ?? null, rosterId: r.winner, loserSeed: placementMap[r.loser] ?? null, loserId: r.loser }));
  const wR1Losers = wR1Results.map((r, idx) => ({ seed: placementMap[r.loser] ?? null, rosterId: r.loser, winnerSeed: placementMap[r.winner] ?? null, winnerId: r.winner }));

  wR1Winners.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const wSemiPairs = [
    [ wR1Winners[0], wR1Winners[wR1Winners.length-1] ],
    [ wR1Winners[1], wR1Winners[wR1Winners.length-2] ]
  ];

  const wSemiResults = [];
  for (const pair of wSemiPairs) {
    if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) {
      trace.push(`Semi missing participant -> skipping`);
      wSemiResults.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[1]?.rosterId || pair[0]?.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}, `Semi`);
    wSemiResults.push(res);
  }

  const finalRes = (wSemiResults.length >= 2) ? runMatch({seed: placementMap[wSemiResults[0].winner], rosterId: wSemiResults[0].winner}, {seed: placementMap[wSemiResults[1].winner], rosterId: wSemiResults[1].winner}, `Final`) : null;
  const thirdRes = (wSemiResults.length >= 2) ? runMatch({seed: placementMap[wSemiResults[0].loser], rosterId: wSemiResults[0].loser}, {seed: placementMap[wSemiResults[1].loser], rosterId: wSemiResults[1].loser}, `3rd`) : null;

  // Consolation from R1 losers
  wR1Losers.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const cR1Pairs = [
    [wR1Losers[0], wR1Losers[wR1Losers.length-1]],
    [wR1Losers[1], wR1Losers[wR1Losers.length-2]]
  ];
  const cR1Results = [];
  for (const pair of cR1Pairs) {
    if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) {
      trace.push(`Consolation R1 missing -> skipping`);
      cR1Results.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[1]?.rosterId || pair[0]?.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}, `Consolation R1`);
    cR1Results.push(res);
  }

  const fifthRes = (cR1Results.length >= 2) ? runMatch({seed: placementMap[cR1Results[0].winner], rosterId: cR1Results[0].winner}, {seed: placementMap[cR1Results[1].winner], rosterId: cR1Results[1].winner}, `5th`) : null;
  const seventhRes = (cR1Results.length >= 2) ? runMatch({seed: placementMap[cR1Results[0].loser], rosterId: cR1Results[0].loser}, {seed: placementMap[cR1Results[1].loser], rosterId: cR1Results[1].loser}, `7th`) : null;

  // -------------------------
  // Losers bracket (corrected)
  // -------------------------
  // initial LRace pairs: 9v12, 10v11 (13 & 14 byes)
  const lPairsSeedNums = [[9,12],[10,11]];
  const lR1Results = [];
  // map seed -> roster object for losers race
  const lBySeed = {};
  for (const s of losersSeeds) lBySeed[s.seed] = s;

  for (const [s1,s2] of lPairsSeedNums) {
    const objA = lBySeed[s1] || {seed:s1, rosterId: placementToRoster[s1]};
    const objB = lBySeed[s2] || {seed:s2, rosterId: placementToRoster[s2]};
    if (!objA.rosterId || !objB.rosterId) {
      trace.push(`LRace ${s1}v${s2} -> missing-roster`);
      lR1Results.push({ winner: objA.rosterId || objB.rosterId, loser: objA.rosterId ? objB.rosterId : objA.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: objA.seed, rosterId: objA.rosterId}, {seed: objB.seed, rosterId: objB.rosterId}, `LRace`);
    lR1Results.push(res);
  }

  // winners of initial LRace will play for 9th
  const lWinners = lR1Results.map(r => ({ rosterId: r.winner, seed: placementMap[r.winner] ?? null }));
  // losers of initial LRace go to LRaceSemi and play the byes 13/14
  const lLosers = lR1Results.map(r => ({ rosterId: r.loser, seed: placementMap[r.loser] ?? null }));

  // byes
  const bye13 = { seed: 13, rosterId: placementToRoster[13] ?? null };
  const bye14 = { seed: 14, rosterId: placementToRoster[14] ?? null };

  // pair losers with byes: map lower-seed loser to higher bye (14), higher-seed loser to lower bye (13)
  lLosers.sort((a,b) => (a.seed || 999) - (b.seed || 999)); // ascending
  const lrSemiPairs = [];
  if (lLosers.length >= 1) {
    const loserA = lLosers[0];
    lrSemiPairs.push([ loserA, bye14 ]);
  }
  if (lLosers.length >= 2) {
    const loserB = lLosers[1];
    lrSemiPairs.push([ loserB, bye13 ]);
  }

  const lSemiResults = [];
  for (const pair of lrSemiPairs) {
    const left = pair[0];
    const right = pair[1];
    if (!left || !right || !left.rosterId || !right.rosterId) {
      trace.push(`LRaceSemi ${left?.seed ?? '?'}v${right?.seed ?? '?'} -> missing`);
      lSemiResults.push({ winner: left?.rosterId || right?.rosterId, loser: right?.rosterId || left?.rosterId, reason: 'missing' });
      continue;
    }
    const res = runMatch({seed: left.seed, rosterId: left.rosterId}, {seed: right.seed, rosterId: right.rosterId}, `LRaceSemi`);
    lSemiResults.push(res);
  }

  // 9th place: winners of initial LRace (lWinners)
  let lFinalRes = null;
  if (lWinners.length >= 2) {
    lFinalRes = runMatch({seed: lWinners[0].seed, rosterId: lWinners[0].rosterId}, {seed: lWinners[1].seed, rosterId: lWinners[1].rosterId}, `9th`);
  } else if (lWinners.length === 1) {
    // only one winner (rare) -> they take 9th
    lFinalRes = { winner: lWinners[0].rosterId, loser: null, reason: 'auto' };
    trace.push(`9th auto -> ${placementMap[lWinners[0].rosterId] ?? lWinners[0].rosterId} (single-winner)`);
  }

  // 11th: winners of LRaceSemi play
  let l11Res = null, l13Res = null;
  if (lSemiResults.length >= 2) {
    // winners of semis -> play for 11th
    const semiWinners = lSemiResults.map(r => ({ rosterId: r.winner, seed: placementMap[r.winner] ?? null }));
    const semiLosers = lSemiResults.map(r => ({ rosterId: r.loser, seed: placementMap[r.loser] ?? null }));

    if (semiWinners.length >= 2) {
      l11Res = runMatch({seed: semiWinners[0].seed, rosterId: semiWinners[0].rosterId}, {seed: semiWinners[1].seed, rosterId: semiWinners[1].rosterId}, `11th`);
    } else if (semiWinners.length === 1) {
      l11Res = { winner: semiWinners[0].rosterId, loser: null, reason: 'auto' };
      trace.push(`11th auto -> ${placementMap[semiWinners[0].rosterId] ?? semiWinners[0].rosterId} (single-semi-winner)`);
    }

    // losers of semis -> play for 13th
    if (semiLosers.length >= 2) {
      l13Res = runMatch({seed: semiLosers[0].seed, rosterId: semiLosers[0].rosterId}, {seed: semiLosers[1].seed, rosterId: semiLosers[1].rosterId}, `13th`);
    } else if (semiLosers.length === 1) {
      l13Res = { winner: semiLosers[0].rosterId, loser: null, reason: 'auto' };
      trace.push(`13th auto -> ${placementMap[semiLosers[0].rosterId] ?? semiLosers[0].rosterId} (single-semi-loser)`);
    }
  } else if (lSemiResults.length === 1) {
    // only one semi result -> the winner gets 11th and loser gets 13th maybe (fallback)
    l11Res = { winner: lSemiResults[0].winner, loser: null, reason: 'only-semi' };
    l13Res = { winner: lSemiResults[0].loser, loser: null, reason: 'only-semi' };
    trace.push(`LRaceSemi single -> 11th ${placementMap[lSemiResults[0].winner] ?? lSemiResults[0].winner} , 13th ${placementMap[lSemiResults[0].loser] ?? lSemiResults[0].loser}`);
  }

  // -------------------------
  // Build final ordered placement list
  // -------------------------
  const assigned = new Set();
  const placementFinal = [];

  function pushIfNotAssigned(rosterId) {
    if (!rosterId) return;
    const r = String(rosterId);
    if (!assigned.has(r)) {
      placementFinal.push(r);
      assigned.add(r);
    }
  }

  function pushResultPair(resObj) {
    if (!resObj) return;
    pushIfNotAssigned(resObj.winner);
    if (resObj.loser) pushIfNotAssigned(resObj.loser);
  }

  // primary final outcomes: champion.. etc (winners bracket)
  pushResultPair(finalRes);
  pushResultPair(thirdRes);
  pushResultPair(fifthRes);
  pushResultPair(seventhRes);

  // losers bracket outcomes
  pushResultPair(lFinalRes);   // 9th/10th
  pushResultPair(l11Res);      // 11th/12th
  pushResultPair(l13Res);      // 13th/14th

  // if any playoff match rows exist that include unassigned rosters, include them
  for (const r of matchupsRows) {
    if (r.participantsCount === 2) {
      pushIfNotAssigned(r.teamA.rosterId);
      pushIfNotAssigned(r.teamB.rosterId);
    } else if (Array.isArray(r.combinedParticipants)) {
      for (const p of r.combinedParticipants) pushIfNotAssigned(p.rosterId);
    } else if (r.teamA && r.teamA.rosterId) pushIfNotAssigned(r.teamA.rosterId);
  }

  // finally include any rosterMap entries not yet assigned
  for (const rk in rosterMap) pushIfNotAssigned(rk);

  // ensure we have exactly as many as total teams and assign ranks 1..N
  const totalTeams = Object.keys(rosterMap).length || placementFinal.length;
  if (placementFinal.length < totalTeams) {
    for (const rk in rosterMap) {
      if (!assigned.has(String(rk))) {
        placementFinal.push(String(rk));
        assigned.add(String(rk));
      }
    }
  }
  while (placementFinal.length > totalTeams) placementFinal.pop();

  const finalStandings = [];
  for (let i = 0; i < placementFinal.length; i++) {
    const rid = String(placementFinal[i]);
    const meta = rosterMap[rid] || {};
    finalStandings.push({
      rank: i + 1,
      rosterId: rid,
      team_name: meta.team_name || meta.owner_name || ('Roster ' + rid),
      avatar: meta.team_avatar || meta.owner_avatar || null,
      seed: placementMap[rid] ?? null,
      pf: regularStandings.find(s => String(s.rosterId) === rid)?.pf ?? 0,
      wins: regularStandings.find(s => String(s.rosterId) === rid)?.wins ?? 0,
      owner_name: meta.owner_name ?? meta.owner?.display_name ?? meta.owner?.username ?? null,
      roster_meta: meta
    });
  }

  // stable re-order fallback (guarantee uniq ranks)
  finalStandings.sort((a,b) => {
    if ((a.rank || 0) !== (b.rank || 0)) return (a.rank || 0) - (b.rank || 0);
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    if ((b.pf || 0) !== (a.pf || 0)) return (b.pf || 0) - (a.pf || 0);
    return (a.seed || 999) - (b.seed || 999);
  });
  for (let i = 0; i < finalStandings.length; i++) finalStandings[i].rank = i + 1;

  const champion = finalStandings[0] ?? null;
  const biggestLoser = finalStandings[finalStandings.length - 1] ?? null;

  // compute MVPs by aggregating starters + starters_points from matchupsRows
  let finalsMvp = null;
  let overallMvp = null;
  try {
    const { finalsMvp: fm, overallMvp: om, debug: mdebug } = await computeMvpsFromMatchups(matchupsRows, playoffStart, playoffEnd, rosterMap, finalRes);
    for (const dd of mdebug) trace.push(dd);
    finalsMvp = fm;
    overallMvp = om;
  } catch (e) {
    trace.push('Failed computing MVPs from matchupsRows: ' + (e?.message ?? e));
    finalsMvp = null;
    overallMvp = null;
  }

  // if local JSON was used note in trace
  if (localUsedKey) {
    trace.push(`Processed season_matchups JSON for year/key ${String(localUsedKey)} (local JSON used for playoff matchups).`);
  } else {
    trace.push(`No local season_matchups JSON found for selected season — using API matchups for simulation.`);
  }

  // enrich MVP objects with roster metadata (if available)
  try {
    if (finalsMvp && typeof finalsMvp.topRosterId !== 'undefined' && finalsMvp.topRosterId && rosterMap && rosterMap[String(finalsMvp.topRosterId)]) {
      finalsMvp.roster_meta = rosterMap[String(finalsMvp.topRosterId)];
    }
    if (overallMvp && typeof overallMvp.topRosterId !== 'undefined' && overallMvp.topRosterId && rosterMap && rosterMap[String(overallMvp.topRosterId)]) {
      overallMvp.roster_meta = rosterMap[String(overallMvp.topRosterId)];
    }
  } catch (e) {
    // non-fatal
  }

  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    matchupsRows,
    regularStandings,
    finalStandings,
    debug: trace,
    messages,
    prevChain,
    finalsMvp,
    overallMvp,
  };
}
