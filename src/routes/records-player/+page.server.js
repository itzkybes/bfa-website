// src/routes/records-player/+page.server.js
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

/* Try to load season_matchups/<year>.json from origin or static files */
async function tryLoadSeasonMatchups(year, origin) {
  if (!year) return null;

  // try origin fetch (deployed)
  try {
    if (typeof fetch === 'function' && origin) {
      const url = origin.replace(/\/$/, '') + `/season_matchups/${year}.json`;
      const res = await fetch(url, { method: 'GET' }).catch(() => null);
      if (res && res.ok) {
        const txt = await res.text();
        return JSON.parse(txt);
      }
    }
  } catch (e) {
    // continue to disk fallback
  }

  // try static file on disk
  try {
    const fileUrl = new URL(`../../../static/season_matchups/${year}.json`, import.meta.url);
    const txt = await readFile(fileUrl, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    // not found
  }

  // try other likely locations
  try {
    const fileUrl = path.join(process.cwd(), 'season_matchups', `${year}.json`);
    const txt = await readFile(fileUrl, 'utf8').catch(() => null);
    if (txt) return JSON.parse(txt);
  } catch (e) {}

  return null;
}

/* Fetch players map (NBA) from Sleeper / fallback public API */
async function fetchPlayersMap() {
  try {
    if (sleeper && typeof sleeper.getPlayers === 'function') {
      const map = await sleeper.getPlayers('nba', { ttl: 60 * 60 }).catch(() => null);
      if (map && typeof map === 'object') return map;
    }
  } catch (e) {}
  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nba');
    if (!res || !res.ok) return {};
    const obj = await res.json();
    return obj || {};
  } catch (e) {
    return {};
  }
}

/* compute MVPs given normalized matchups and a finalRes (winner/loser) — uses honor-hall logic */
async function computeMvps(matchupsRows, playoffStart, playoffEnd, rosterMap, finalRes, fullSeasonMatchupsRows = null) {
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

  // --- playoffs aggregation (for Finals MVP candidates) ---
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
        // object mapping id->points
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
    debug.push('No fullSeasonMatchupsRows provided — overall MVP will fall back to playoff-only totals.');
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

  // compute finals MVP: prefer strict championship matchup discovered by finalRes
  let finalsId = null;
  let finalsPts = -Infinity;

  // find final row (match between finalRes.winner & finalRes.loser) in playoff weeks
  let finalsRow = null;
  if (finalRes && finalRes.winner && finalRes.loser) {
    const a = String(finalRes.winner), b = String(finalRes.loser);
    // search preferred weeks (playoffEnd then previous)
    const preferredWeeks = [playoffEnd, playoffEnd - 1, playoffEnd - 2];
    for (const wk of preferredWeeks) {
      for (const r of matchupsRows) {
        if (!r.week) continue;
        if (Number(r.week) !== Number(wk)) continue;
        if (r.participantsCount === 2) {
          const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
          if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) {
            finalsRow = r;
            break;
          }
        } else if (r.combinedParticipants) {
          const ids = r.combinedParticipants.map(p => String(p.rosterId));
          if (ids.includes(a) && ids.includes(b)) {
            finalsRow = r;
            break;
          }
        }
      }
      if (finalsRow) break;
    }
  }

  // If finalsRow found, compute top scorer among players in that row only.
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
          localPoints[pid] = Math.max(localPoints[pid] || 0, pts);
        }
      } else if (Array.isArray(t.player_points)) {
        for (const pp of t.player_points) {
          const pid = pp.player_id ?? pp.playerId ?? pp.id ?? null;
          const pts = Number(pp.points ?? pp.pts ?? 0);
          if (!pid || pid === '0') continue;
          localPoints[String(pid)] = Math.max(localPoints[String(pid)] || 0, pts);
        }
      } else if (t.player_points && typeof t.player_points === 'object') {
        for (const pidKey of Object.keys(t.player_points || {})) {
          const ppts = safeNum(t.player_points[pidKey]);
          localPoints[pidKey] = Math.max(localPoints[pidKey] || 0, ppts);
        }
      }
    }
    for (const pid of Object.keys(localPoints)) {
      const pts = localPoints[pid] || 0;
      if (pts > finalsPts) {
        finalsPts = pts;
        finalsId = pid;
      }
    }
    debug.push('Finals row matched using bracket-simulation finalRes.');
  } else {
    // fallback: pick top playoff scorer (but this is fallback only)
    debug.push('Could not find finalsRow for bracket pair — falling back to top playoff scorer.');
    for (const pid of Object.keys(playoffPlayers)) {
      const pts = playoffPlayers[pid].points || 0;
      if (pts > finalsPts) {
        finalsPts = pts;
        finalsId = pid;
      }
    }
  }

  // Build output MVP objects (include top roster if available)
  async function fetchPlayersMapLocal() {
    // attempt to fetch players map for naming (may be heavy)
    return await fetchPlayersMap().catch(() => ({}));
  }

  const playersMap = await fetchPlayersMapLocal();

  function buildMvpObj(pid, pts, playersObj) {
    if (!pid) return null;
    const pm = playersMap[pid] || {};
    const playerName = pm.full_name || (pm.first_name && pm.last_name ? `${pm.first_name} ${pm.last_name}` : (pm.display_name || pm.player_name || pm.player_name)) || (`Player ${pid}`);
    const byRoster = (playersObj && playersObj[pid] && playersObj[pid].byRoster) ? playersObj[pid].byRoster : {};
    let topRosterId = null;
    let topRosterPts = -Infinity;
    for (const rId in byRoster) {
      const rpts = byRoster[rId] || 0;
      if (rpts > topRosterPts) {
        topRosterPts = rpts;
        topRosterId = rId;
      }
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

/* Helper to normalize API raw match entries into a consistent shape used by the compute function */
function normalizeApiMatchups(rawArr, rosterMap) {
  // convert API roster-per-row entries into teamA/teamB form (when possible)
  const out = [];
  // group by matchup id
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
      // convert each entry into a single-team matchup (teamA) so computeMvps can consume starters/player_points
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

export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const url = event.url;
  const origin = url?.origin ?? null;

  const messages = [];
  const jsonLinks = [];

  // Build seasons chain (same as other pages)
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { mainLeague = null; messages.push('Failed fetching base league: ' + (e?.message ?? e)); }
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
    messages.push('Error building seasons chain: ' + (e?.message ?? e));
  }

  // dedupe + sort ascending by season
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

  // players map for name resolution (optional heavy)
  const playersMap = await fetchPlayersMap();

  const seasonsResults = [];

  // If seasons empty fallback to a few likely years
  const seasonsToProcess = seasons.length ? seasons.map(s => ({ leagueId: s.league_id, season: s.season })) : [{ leagueId: BASE_LEAGUE_ID, season: new Date().getFullYear() }];

  for (const s of seasonsToProcess) {
    const seasonLabel = s.season != null ? String(s.season) : (s.leagueId ? String(s.leagueId) : null);
    messages.push(`Processing season ${seasonLabel}...`);

    const leagueIdToUse = s.leagueId || BASE_LEAGUE_ID;

    // load league meta to find playoffStart
    let leagueMeta = null;
    try { leagueMeta = await sleeper.getLeague(leagueIdToUse, { ttl: 60 * 5 }); } catch (e) { leagueMeta = null; messages.push(`Season ${seasonLabel}: failed to fetch league meta (${e?.message ?? e})`); }
    let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : 15;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
    const playoffEnd = playoffStart + 2;

    // --- fetch rosterMap to run regular-season standings / placement ---
    let rosterMap = {};
    try {
      rosterMap = await sleeper.getRosterMapWithOwners(leagueIdToUse, { ttl: 60 * 5 }) || {};
      messages.push(`Loaded rosters (${Object.keys(rosterMap).length}) for league ${leagueIdToUse}.`);
    } catch (e) {
      rosterMap = {};
      messages.push(`Failed fetching rosters for ${leagueIdToUse} — ${e?.message ?? e}`);
    }

    // build regular season standings for seeding (weeks 1..playoffStart-1)
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
      try {
        wkMatchups = await sleeper.getMatchupsForWeek(leagueIdToUse, week, { ttl: 60 * 5 }) || [];
      } catch (e) {
        // ignore single-week failure
      }
      if (!wkMatchups || !wkMatchups.length) continue;

      // group by matchup id
      const byMatch = {};
      for (let mi = 0; mi < wkMatchups.length; mi++) {
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
    } // end regular season loop

    // build regularStandings array from trackers
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

    // --------------------------
    // load playoff matchups: prefer season_matchups JSON else API for playoff weeks
    // --------------------------
    let matchupsRows = [];
    let usedJson = null;
    // candidate keys
    const candidateKeys = [];
    if (seasonLabel) candidateKeys.push(String(seasonLabel));
    if (leagueMeta && typeof leagueMeta.season !== 'undefined' && leagueMeta.season != null) candidateKeys.push(String(leagueMeta.season));
    if (leagueIdToUse) candidateKeys.push(String(leagueIdToUse));
    const uniqKeys = Array.from(new Set(candidateKeys.filter(k => k != null && k !== '')));

    let foundJson = null;
    let foundKey = null;
    for (const k of uniqKeys) {
      const loaded = await tryLoadSeasonMatchups(k, origin);
      if (loaded) { foundJson = loaded; foundKey = k; break; }
    }

    if (foundJson) {
      // normalize foundJson into array
      const collected = [];
      if (Array.isArray(foundJson)) {
        for (const m of foundJson) collected.push(m);
      } else if (Array.isArray(foundJson.matchups)) {
        for (const m of foundJson.matchups) collected.push(m);
      } else {
        // flatten numeric-week keys
        for (const kk of Object.keys(foundJson)) {
          if (kk === 'playoff_week_start' || kk === 'metadata' || kk === 'season') continue;
          const v = foundJson[kk];
          if (Array.isArray(v)) {
            for (const m of v) {
              if (m && (m.week == null)) m.week = Number(kk);
              collected.push(m);
            }
          }
        }
      }

      // normalize into expected shape teamA/teamB etc.
      for (const m of collected) {
        if (!m) continue;
        const wk = (typeof m.week !== 'undefined' && m.week != null) ? Number(m.week) : ((typeof m.w !== 'undefined') ? Number(m.w) : null);
        const mappedWeek = (wk != null && !isNaN(wk)) ? wk : (m.week ?? m.w ?? null);
        function normalizeTeam(t) {
          if (!t) return null;
          return {
            rosterId: t.rosterId ?? t.roster_id ?? t.ownerId ?? t.owner_id ?? null,
            name: t.name ?? t.teamName ?? t.team_name ?? t.ownerName ?? t.owner_name ?? null,
            avatar: t.avatar ?? t.team_avatar ?? t.owner_avatar ?? null,
            points: typeof t.teamAScore !== 'undefined' || typeof t.teamBScore !== 'undefined' ? null : (t.points ?? t.points_for ?? t.pts ?? null),
            starters: t.starters ?? t.starters_list ?? null,
            starters_points: t.starters_points ?? t.startersPoints ?? null,
            player_points: t.player_points ?? null
          };
        }
        const tA = m.teamA ? normalizeTeam(m.teamA) : (m.home ? normalizeTeam(m.home) : null);
        const tB = m.teamB ? normalizeTeam(m.teamB) : (m.away ? normalizeTeam(m.away) : null);
        const scoreA = (typeof m.teamAScore !== 'undefined') ? Number(m.teamAScore) : null;
        const scoreB = (typeof m.teamBScore !== 'undefined') ? Number(m.teamBScore) : null;
        // ensure starters_points arrays exist if present as player_points mapping
        matchupsRows.push({
          matchup_id: m.matchup_id ?? m.matchupId ?? m.id ?? null,
          season: String(foundJson.season ?? leagueMeta?.season ?? seasonLabel ?? ''),
          week: mappedWeek,
          teamA: tA || null,
          teamB: tB || null,
          participantsCount: (tA && tA.rosterId ? 1 : 0) + (tB && tB.rosterId ? 1 : 0)
        });
      }

      usedJson = foundKey;
      jsonLinks.push({ title: `season_matchups/${foundKey}.json`, url: origin ? `${origin}/season_matchups/${foundKey}.json` : `season_matchups/${foundKey}.json` });
      messages.push(`Loaded local season_matchups JSON for ${foundKey}.`);
    } else {
      // API fallback: fetch playoff weeks
      const raw = [];
      for (let wk = playoffStart; wk <= Math.min(playoffEnd, MAX_WEEKS); wk++) {
        try {
          const wkMatchups = await sleeper.getMatchupsForWeek(leagueIdToUse, wk, { ttl: 60 * 5 }) || [];
          for (const m of wkMatchups) {
            if (m && (m.week == null && m.w == null)) m.week = wk;
            raw.push(m);
          }
        } catch (e) {
          // ignore single-week errors
        }
      }
      if (raw.length) {
        matchupsRows = normalizeApiMatchups(raw, rosterMap);
        messages.push(`Loaded ${matchupsRows.length} playoff matchups via API fallback for season ${seasonLabel} (league ${leagueIdToUse}).`);
      } else {
        messages.push(`No playoff matchups found via API for season ${seasonLabel} (league ${leagueIdToUse}).`);
      }
    }

    // Build fullSeasonMatchupsRows: prefer JSON (if used) else fetch weeks 1..playoffEnd and normalize
    let fullSeasonMatchupsRows = null;
    if (usedJson) {
      fullSeasonMatchupsRows = matchupsRows.slice();
    } else {
      // fetch 1..playoffEnd
      const rawAll = [];
      for (let wk = 1; wk <= Math.min(playoffEnd, MAX_WEEKS); wk++) {
        try {
          const wkMatchups = await sleeper.getMatchupsForWeek(leagueIdToUse, wk, { ttl: 60 * 5 }) || [];
          for (const m of wkMatchups) {
            if (m && (m.week == null && m.w == null)) m.week = wk;
            rawAll.push(m);
          }
        } catch (e) {}
      }
      if (rawAll.length) {
        fullSeasonMatchupsRows = normalizeApiMatchups(rawAll, rosterMap);
        messages.push(`Loaded ${fullSeasonMatchupsRows.length} total matchups for full season via API for ${seasonLabel}.`);
      } else {
        // if none, attempt to use matchupsRows (playoff-only) as fallback
        fullSeasonMatchupsRows = matchupsRows.slice();
      }
    }

    // If still no matchups at all, skip
    if (!fullSeasonMatchupsRows || !fullSeasonMatchupsRows.length) {
      messages.push(`Skipping season ${seasonLabel}: no matchups data available.`);
      seasonsResults.push({ season: seasonLabel, leagueId: leagueIdToUse, finalsMvp: null, overallMvp: null, _sourceJson: usedJson });
      continue;
    }

    // -------------------------
    // bracket simulation to determine finalRes (winner/loser pair) using matchupsRows & placement map
    // reuse logic from honor-hall
    // -------------------------
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
      // try any week fallback
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
        // single-team rows: can't decide pair -> return null
        return null;
      }

      if (aPts == null || bPts == null) return null;
      if (aPts > bPts + 1e-9) return { winner: a, loser: b, reason: 'matchup' };
      if (bPts > aPts + 1e-9) return { winner: b, loser: a, reason: 'matchup' };

      // tie-breaks by PF then wins then placement
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

    // create seed arrays (1..N)
    const winnersSeeds = [];
    const losersSeeds = [];
    for (let sN = 1; sN <= 14; sN++) {
      const rid = placementToRoster[sN] ?? null;
      if (!rid) continue;
      if (sN <= 8) winnersSeeds.push({ seed: sN, rosterId: rid });
      else losersSeeds.push({ seed: sN, rosterId: rid });
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

    // Winners R1
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

    const wR1Winners = wR1Results.map((r) => ({ seed: placementMap[r.winner] ?? null, rosterId: r.winner, loserSeed: placementMap[r.loser] ?? null, loserId: r.loser }));
    const wR1Losers = wR1Results.map((r) => ({ seed: placementMap[r.loser] ?? null, rosterId: r.loser, winnerSeed: placementMap[r.winner] ?? null, winnerId: r.winner }));

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

    // -------------------------
    // compute MVPs using computed finalRes
    // -------------------------
    let finalsMvp = null;
    let overallMvp = null;
    try {
      const { finalsMvp: fm, overallMvp: om, debug } = await computeMvps(fullSeasonMatchupsRows, playoffStart, playoffEnd, rosterMap, finalRes, fullSeasonMatchupsRows);
      finalsMvp = fm;
      overallMvp = om;
      for (const d of debug) messages.push(d);
    } catch (e) {
      messages.push('Error computing MVPs: ' + (e?.message ?? e));
      finalsMvp = null;
      overallMvp = null;
    }

    if (usedJson) messages.push(`Processed season_matchups JSON for ${usedJson} (used for playoff matchups).`);
    else messages.push(`Used API matchups for season ${seasonLabel}.`);

    seasonsResults.push({
      season: seasonLabel,
      leagueId: leagueIdToUse,
      championshipWeek: playoffEnd,
      finalsMvp,
      overallMvp,
      _sourceJson: usedJson ?? null
    });
  } // end seasons loop

  return { seasons, seasonsResults, jsonLinks, messages };
}
