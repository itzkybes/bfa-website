// src/routes/honor-hall/+page.server.js
// Honor Hall loader + bracket simulation (updated losers-bracket logic)
// Adds: read local season_matchups JSON for historical seasons and compute Finals + Overall MVP
//       from starters + starters_points. Fetches player map from Sleeper API once and caches it.

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

/* -------------------------
   Local JSON loader + players cache
   ------------------------- */

let _playersCache = null;
let _playersCacheFetchedAt = 0;
const PLAYERS_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

async function fetchPlayersMapCached() {
  // Return cached if fresh
  const now = Date.now();
  if (_playersCache && (now - _playersCacheFetchedAt) < PLAYERS_CACHE_TTL_MS) {
    return _playersCache;
  }

  // try to fetch via Sleeper client if it exposes a players method
  try {
    if (sleeper && typeof sleeper.getPlayers === 'function') {
      const map = await sleeper.getPlayers('nba'); // some clients use this signature
      _playersCache = map || {};
      _playersCacheFetchedAt = Date.now();
      return _playersCache;
    }
  } catch (e) {
    // fall through to direct fetch
  }

  // fallback to direct fetch against Sleeper public API
  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nba');
    if (res && res.ok) {
      const json = await res.json();
      // json is { player_id: {...}, ... }
      _playersCache = json || {};
      _playersCacheFetchedAt = Date.now();
      return _playersCache;
    }
  } catch (e) {
    // unable to fetch players, return empty map
    _playersCache = {};
    _playersCacheFetchedAt = Date.now();
    return _playersCache;
  }

  _playersCache = {};
  _playersCacheFetchedAt = Date.now();
  return _playersCache;
}

async function tryLoadLocalSeasonMatchups(seasonOrYear) {
  // Try multiple candidate file locations. Returns null when not found.
  const candidates = [
    path.join(process.cwd(), 'season_matchups', String(seasonOrYear) + '.json'),
    path.join(process.cwd(), 'static', 'season_matchups', String(seasonOrYear) + '.json'),
    path.join(process.cwd(), 'src', 'season_matchups', String(seasonOrYear) + '.json'),
    path.join(process.cwd(), 'src', 'lib', 'season_matchups', String(seasonOrYear) + '.json'),
    path.join(process.cwd(), 'static', String(seasonOrYear) + '.json'),
  ];
  for (const c of candidates) {
    try {
      const txt = await fs.readFile(c, 'utf8');
      if (!txt) continue;
      const parsed = JSON.parse(txt);
      // parsed could be an object with numbered keys or an array of matchups
      // normalize to a flat array of matchup objects
      const flat = [];
      if (Array.isArray(parsed)) {
        for (const m of parsed) flat.push(m);
      } else if (parsed && typeof parsed === 'object') {
        // If top-level contains "playoff_week_start" and then numbered rounds, flatten them
        for (const k of Object.keys(parsed)) {
          if (k === 'playoff_week_start' || k === 'metadata' || k === 'season') continue;
          const val = parsed[k];
          if (Array.isArray(val)) {
            for (const m of val) flat.push(m);
          }
        }
        // If nothing flushed into flat, but object itself looks like a single matchup or mapping keyed by strings that are matchups
        if (flat.length === 0) {
          // attempt to extract any arrays
          for (const k of Object.keys(parsed)) {
            const v = parsed[k];
            if (Array.isArray(v)) {
              for (const m of v) flat.push(m);
            }
          }
        }
      }
      if (flat.length === 0) {
        // maybe the file is an object with an inner key '1' etc and we already handled; if still empty, attempt to pick plausible fields
        // return whatever parsed was anyway (caller will attempt to interpret)
        return parsed;
      }
      return { parsedRaw: parsed, flatMatchups: flat };
    } catch (e) {
      // file not found or parse error - continue to next candidate
      continue;
    }
  }
  return null;
}

/* -------------------------
   Helper: compute MVPs from local JSON matchups
   - overallMvp: sum starter points across playoff matchups
   - finalsMvp: highest starter_points in the championship matchup
   ------------------------- */

function safeStrId(v) {
  if (v == null) return null;
  return String(v);
}

function computeMvpsFromJsonMatchups(matchupsArray, finalStandings, debugLines = []) {
  // matchupsArray is array of matchup objects (expected fields: teamA, teamB, teamAScore/teamBScore or similar)
  // finalStandings is array with champion at index 0, runner-up index 1
  // returns { finalsMvp: {...}|null, overallMvp: {...}|null, debugLinesAdded: [] }
  if (!Array.isArray(matchupsArray) || matchupsArray.length === 0) {
    return { finalsMvp: null, overallMvp: null, debugAdded: [] };
  }

  const addedDebug = [];

  // champion and runner-up roster ids
  const champ = finalStandings && finalStandings[0] ? String(finalStandings[0].rosterId) : null;
  const runner = finalStandings && finalStandings[1] ? String(finalStandings[1].rosterId) : null;

  // Flatten even nested structures: some entries have teamA/teamB, others may be team1/team2 - we'll handle teamA/teamB primarily.
  // Build player totals across playoff matchups for starters.
  const totals = {}; // playerId -> { points: number, appearances: number, rosterIds: Set }
  function addPlayer(playerId, pts, rosterId) {
    if (playerId == null) return;
    const pid = String(playerId);
    if (!totals[pid]) totals[pid] = { points: 0, appearances: 0, rosterIds: new Set() };
    totals[pid].points += safeNum(pts);
    totals[pid].appearances += 1;
    if (rosterId != null) totals[pid].rosterIds.add(String(rosterId));
  }

  // track championship matchup to compute finals MVP
  let championshipMatch = null;

  for (const m of matchupsArray) {
    if (!m) continue;
    // accept various shapes: {teamA: {...}, teamB: {...}, week: ...}
    const tA = m.teamA || m.team1 || m.home || null;
    const tB = m.teamB || m.team2 || m.away || null;

    // If this matchup includes both champion & runner-up, mark as final candidate
    const aRid = tA && (tA.rosterId ?? tA.roster_id ?? tA.roster) ? String(tA.rosterId ?? tA.roster_id ?? tA.roster) : null;
    const bRid = tB && (tB.rosterId ?? tB.roster_id ?? tB.roster) ? String(tB.rosterId ?? tB.roster_id ?? tB.roster) : null;
    if (champ && runner && ((aRid === champ && bRid === runner) || (aRid === runner && bRid === champ))) {
      championshipMatch = m;
    }

    // For overall MVP: look for starters + starters_points arrays on team objects
    // many JSONs use fields 'starters' and 'starters_points'
    if (tA && Array.isArray(tA.starters) && Array.isArray(tA.starters_points)) {
      for (let i = 0; i < tA.starters.length; i++) {
        const pid = tA.starters[i];
        const pts = tA.starters_points[i];
        addPlayer(pid, pts, aRid);
      }
    } else if (tA && Array.isArray(tA.player_points) && typeof tA.player_points === 'object') {
      // alternate shape: player_points map
      for (const pidKey of Object.keys(tA.player_points)) {
        addPlayer(pidKey, tA.player_points[pidKey], aRid);
      }
    }

    if (tB && Array.isArray(tB.starters) && Array.isArray(tB.starters_points)) {
      for (let i = 0; i < tB.starters.length; i++) {
        const pid = tB.starters[i];
        const pts = tB.starters_points[i];
        addPlayer(pid, pts, bRid);
      }
    } else if (tB && Array.isArray(tB.player_points) && typeof tB.player_points === 'object') {
      for (const pidKey of Object.keys(tB.player_points)) {
        addPlayer(pidKey, tB.player_points[pidKey], bRid);
      }
    }
  }

  // compute overall MVP (player with max total points)
  let overallMvp = null;
  let bestTotal = -Infinity;
  for (const pid in totals) {
    if (!Object.prototype.hasOwnProperty.call(totals, pid)) continue;
    const rec = totals[pid];
    if (rec.points > bestTotal) {
      bestTotal = rec.points;
      overallMvp = { playerId: pid, points: Math.round(rec.points * 100) / 100, appearances: rec.appearances, rosterIds: Array.from(rec.rosterIds) };
    }
  }
  if (overallMvp) {
    addedDebug.push(`Computed overall MVP candidate: ${overallMvp.playerId} -> ${overallMvp.points} pts (appearances ${overallMvp.appearances})`);
  } else {
    addedDebug.push('No overall MVP computed from JSON (no starters data found).');
  }

  // compute finals MVP from championshipMatch: pick the single starter with highest points in that matchup
  let finalsMvp = null;
  if (championshipMatch) {
    // check teamA/teamB starters arrays
    const tA = championshipMatch.teamA || championshipMatch.team1 || championshipMatch.home || null;
    const tB = championshipMatch.teamB || championshipMatch.team2 || championshipMatch.away || null;
    const candidates = [];

    if (tA && Array.isArray(tA.starters) && Array.isArray(tA.starters_points)) {
      for (let i = 0; i < tA.starters.length; i++) {
        const pid = tA.starters[i];
        const pts = safeNum(tA.starters_points[i]);
        candidates.push({ playerId: String(pid), points: pts, rosterId: String(tA.rosterId ?? tA.roster_id ?? tA.roster) });
      }
    }
    if (tB && Array.isArray(tB.starters) && Array.isArray(tB.starters_points)) {
      for (let i = 0; i < tB.starters.length; i++) {
        const pid = tB.starters[i];
        const pts = safeNum(tB.starters_points[i]);
        candidates.push({ playerId: String(pid), points: pts, rosterId: String(tB.rosterId ?? tB.roster_id ?? tB.roster) });
      }
    }

    if (candidates.length) {
      candidates.sort((a,b) => b.points - a.points);
      const top = candidates[0];
      finalsMvp = { playerId: top.playerId, points: Math.round(top.points * 100) / 100, rosterId: top.rosterId };
      addedDebug.push(`Computed finals MVP candidate: ${finalsMvp.playerId} -> ${finalsMvp.points} pts (roster ${finalsMvp.rosterId})`);
    } else {
      addedDebug.push('Found championship matchup but no starters data present to compute Finals MVP.');
    }
  } else {
    addedDebug.push('No championship matchup found in JSON to compute Finals MVP.');
  }

  return { finalsMvp, overallMvp, debugAdded: addedDebug };
}

/* -------------------------
   Main load function (existing logic kept, extended for MVP from JSON)
   ------------------------- */

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
  const playoffEnd = playoffStart + 2;

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

  // --- fetch playoff matchups and normalize rows ---
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

  const matchupsRows = [];
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
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement },
        teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, placement: null },
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
        teamA: { rosterId: aId, name: aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts, placement: aPlacement },
        teamB: { rosterId: bId, name: bMeta.team_name || bMeta.owner_name || ('Roster ' + bId), avatar: bMeta.team_avatar || bMeta.owner_avatar || null, points: bPts, placement: bPlacement },
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
        placement: placementMap[pid] ?? null
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

  // -------------------------
  // MVP computation
  // - prefer to use local season_matchups JSON (historical)
  // - if local JSON found, compute finals & overall MVP from starters + starters_points
  // - if not, attempt to use sleeper helper if present; otherwise fall back to null and log debug
  // -------------------------
  let finalsMvp = null;
  let overallMvp = null;

  // attempt to parse local season_matchups JSON for this season (selectedSeasonParam)
  try {
    const seasonKey = selectedSeasonParam;
    const local = await tryLoadLocalSeasonMatchups(seasonKey);
    if (local) {
      // local may be { parsedRaw, flatMatchups } or an array
      const flat = local.flatMatchups ?? (Array.isArray(local) ? local : (Array.isArray(local.parsedRaw) ? local.parsedRaw : null));
      if (flat && flat.length) {
        // compute MVPs from the flat matchups
        const { finalsMvp: fm, overallMvp: om, debugAdded } = computeMvpsFromJsonMatchups(flat, finalStandings, trace);
        // attach debug
        for (const dd of debugAdded) trace.push(dd);

        // attach into finalsMvp/overallMvp if present
        if (fm) finalsMvp = fm;
        if (om) overallMvp = om;
        trace.push(`Processed season_matchups JSON for year ${String(selectedSeasonParam)} (found ${flat.length} matchups).`);
      } else {
        // maybe local.parsedRaw is object with nested rounds
        if (local.parsedRaw && typeof local.parsedRaw === 'object') {
          // flatten nested arrays that may be at numeric keys
          const collected = [];
          for (const k of Object.keys(local.parsedRaw)) {
            if (k === 'playoff_week_start' || k === 'metadata' || k === 'season') continue;
            const v = local.parsedRaw[k];
            if (Array.isArray(v)) {
              for (const m of v) collected.push(m);
            }
          }
          if (collected.length) {
            const { finalsMvp: fm, overallMvp: om, debugAdded } = computeMvpsFromJsonMatchups(collected, finalStandings, trace);
            for (const dd of debugAdded) trace.push(dd);
            if (fm) finalsMvp = fm;
            if (om) overallMvp = om;
            trace.push(`Processed season_matchups JSON (nested) for year ${String(selectedSeasonParam)} (found ${collected.length} matchups).`);
          } else {
            trace.push(`Loaded season_matchups JSON for ${String(selectedSeasonParam)} but could not find usable matchups arrays.`);
          }
        } else {
          trace.push(`Loaded season_matchups JSON for ${String(selectedSeasonParam)} but structure was unexpected.`);
        }
      }
    } else {
      trace.push(`No local season_matchups JSON found for ${String(selectedSeasonParam)} — will attempt API fallback for MVPs.`);
    }
  } catch (e) {
    trace.push(`Error processing local season_matchups JSON: ${e?.message ?? String(e)}`);
  }

  // If we didn't compute MVPs from local JSON, attempt API-based helpers if available.
  // Some sleeper clients expose getFinalsMVP/getOverallMVP; but from your debug they are not present.
  if (!finalsMvp || !overallMvp) {
    // Attempt to use helper functions if the sleeper client implements them
    if (sleeper && typeof sleeper.getFinalsMVP === 'function' && !finalsMvp) {
      try {
        const helper = await sleeper.getFinalsMVP(selectedLeagueId, {
          season: selectedSeasonParam || (leagueMeta && leagueMeta.season) || null,
          championshipWeek: playoffEnd,
          maxWeek: playoffEnd,
          playersEndpoint: '/players/nba'
        });
        if (helper) {
          finalsMvp = helper;
          trace.push('Computed Finals MVP via sleeper helper.');
        }
      } catch (e) {
        trace.push('Failed computing Finals MVP via Sleeper helper: ' + (e?.message ?? e));
      }
    } else {
      if (!finalsMvp) trace.push('sleeper.getFinalsMVP not available — skipped helper for Finals MVP.');
    }

    if (sleeper && typeof sleeper.getOverallMVP === 'function' && !overallMvp) {
      try {
        const helper2 = await sleeper.getOverallMVP(selectedLeagueId, {
          season: selectedSeasonParam || (leagueMeta && leagueMeta.season) || null,
          maxWeek: playoffEnd,
          playersEndpoint: '/players/nba'
        });
        if (helper2) {
          overallMvp = helper2;
          trace.push('Computed Overall MVP via sleeper helper.');
        }
      } catch (e) {
        trace.push('Failed computing Overall MVP via Sleeper helper: ' + (e?.message ?? e));
      }
    } else {
      if (!overallMvp) trace.push('sleeper.getOverallMVP not available — skipped helper for Overall MVP.');
    }
  }

  // At this point we have potentially finalsMvp and overallMvp with {playerId, points, rosterId} shapes from our computation
  // Next: fetch players map (once) and resolve playerName fields if possible
  try {
    const playersMap = await fetchPlayersMapCached(); // player_id -> player obj
    const ensureName = (m) => {
      if (!m) return m;
      // normalize keys
      const pid = m.playerId ?? m.player_id ?? m.topPlayerId ?? m.top_player_id ?? null;
      if (!m.playerName) {
        if (pid && playersMap && playersMap[pid] && (playersMap[pid].full_name || playersMap[pid].first_name || playersMap[pid].last_name)) {
          m.playerName = playersMap[pid].full_name ?? [playersMap[pid].first_name, playersMap[pid].last_name].filter(Boolean).join(' ');
        } else if (pid && playersMap && playersMap[pid] && playersMap[pid].search_full_name) {
          m.playerName = playersMap[pid].search_full_name;
        } else if (pid) {
          m.playerName = `Player ${pid}`;
        }
      }
      // attach small player object if available
      if (pid && playersMap && playersMap[pid]) {
        m.playerObj = playersMap[pid];
      }
      return m;
    };

    if (finalsMvp) {
      finalsMvp = ensureName(finalsMvp);
      trace.push(`Finals MVP: ${finalsMvp.playerName ?? finalsMvp.playerId ?? 'unknown'} (${finalsMvp.points ?? '—'} pts)`);
    }
    if (overallMvp) {
      overallMvp = ensureName(overallMvp);
      trace.push(`Overall MVP: ${overallMvp.playerName ?? overallMvp.playerId ?? 'unknown'} (${overallMvp.points ?? '—'} pts)`);
    }
  } catch (e) {
    trace.push('Failed fetching/attaching player names for MVPs: ' + (e?.message ?? e));
  }

  // enrich MVP objects with roster metadata (if available)
  try {
    if (finalsMvp && typeof finalsMvp.rosterId !== 'undefined' && rosterMap && rosterMap[String(finalsMvp.rosterId)]) {
      finalsMvp.roster_meta = rosterMap[String(finalsMvp.rosterId)];
    }
    if (overallMvp && typeof overallMvp.topRosterId !== 'undefined' && rosterMap && rosterMap[String(overallMvp.topRosterId)]) {
      overallMvp.roster_meta = rosterMap[String(overallMvp.topRosterId)];
    } else if (overallMvp && overallMvp.rosterIds && Array.isArray(overallMvp.rosterIds) && overallMvp.rosterIds.length) {
      // pick first roster for metadata if present
      const r0 = overallMvp.rosterIds[0];
      if (r0 && rosterMap[String(r0)]) overallMvp.roster_meta = rosterMap[String(r0)];
    }
  } catch (e) {
    // non-fatal
  }

  // final return (keeps previous API shape)
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
