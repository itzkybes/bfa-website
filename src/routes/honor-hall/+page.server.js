// src/routes/honor-hall/+page.server.js
// Honor Hall loader + bracket simulation (uses season_matchups JSON when available)

import { readFile } from 'fs/promises';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { createSleeperClient } from '$lib/server/sleeperClient';

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
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 23; // per your request
const SEASON_MATCHUP_YEARS = [2022, 2023, 2024, 2025]; // adjust as needed

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// compute participant points (same robust approach used elsewhere)
function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== 'object') return 0;

  const arrayKeys = ['starters_points', 'starter_points', 'startersPoints', 'starterPoints', 'starters_points_list'];
  for (const k of arrayKeys) {
    if (Array.isArray(entry[k]) && entry[k].length) {
      let s = 0;
      for (const v of entry[k]) s += safeNum(v);
      return Math.round(s * 100) / 100;
    }
  }

  if (Array.isArray(entry.starters) && entry.player_points && typeof entry.player_points === 'object') {
    let s = 0;
    for (const st of entry.starters) {
      const pval = entry.player_points[String(st)] ?? entry.player_points[st];
      s += safeNum(pval);
    }
    return Math.round(s * 100) / 100;
  }

  if (Array.isArray(entry.starters) && entry.starters.length && typeof entry.starters[0] === 'object') {
    let s = 0;
    for (const obj of entry.starters) {
      s += safeNum(obj.points ?? obj.p);
    }
    return Math.round(s * 100) / 100;
  }

  const fallback = safeNum(entry.points ?? entry.points_for ?? entry.pts ?? entry.score ?? 0);
  return Math.round(fallback * 100) / 100;
}

// next-week explicit zero detection (avoids current in-progress weeks)
function nextWeekContainsExplicitZero(matchupsArr) {
  if (!Array.isArray(matchupsArr) || matchupsArr.length === 0) return false;

  for (const m of matchupsArr) {
    if (Object.prototype.hasOwnProperty.call(m, 'teamAScore') && Number(m.teamAScore) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'teamBScore') && Number(m.teamBScore) === 0) return true;

    if (m.teamA && Object.prototype.hasOwnProperty.call(m.teamA, 'score') && Number(m.teamA.score) === 0) return true;
    if (m.teamB && Object.prototype.hasOwnProperty.call(m, 'score') && Number(m.teamB.score) === 0) return true;
    if (m.teamA && Object.prototype.hasOwnProperty.call(m.teamA, 'points') && Number(m.teamA.points) === 0) return true;
    if (m.teamB && Object.prototype.hasOwnProperty.call(m.teamB, 'points') && Number(m.teamB.points) === 0) return true;

    if (Object.prototype.hasOwnProperty.call(m, 'points') && Number(m.points) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'points_for') && Number(m.points_for) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'pts') && Number(m.pts) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'score') && Number(m.score) === 0) return true;
  }
  return false;
}

// load season_matchups JSON files (origin then static fallback)
async function tryLoadSeasonMatchups(years, origin) {
  const map = {};
  const jsonLinks = [];
  for (const y of years) {
    let loaded = null;
    if (origin && typeof origin === 'string') {
      try {
        const url = origin.replace(/\/$/, '') + `/season_matchups/${String(y)}.json`;
        const res = await fetch(url, { method: 'GET' });
        if (res && res.ok) {
          const txt = await res.text();
          loaded = JSON.parse(txt);
          jsonLinks.push(url);
        }
      } catch (e) {
        loaded = null;
      }
    }

    if (!loaded) {
      try {
        const fileUrl = new URL(`../../../static/season_matchups/${String(y)}.json`, import.meta.url);
        const txt = await readFile(fileUrl, 'utf8');
        loaded = JSON.parse(txt);
        jsonLinks.push(`/season_matchups/${String(y)}.json`);
      } catch (e) {
        loaded = null;
      }
    }

    if (loaded) map[String(y)] = loaded;
  }
  return { map, jsonLinks };
}

// build per-roster standings array from trackers (used for regular standings)
function buildStandingsFromTrackers(statsByRoster, resultsByRoster, paByRoster, rosterMap) {
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
    out.push({
      rosterId: rid,
      team_name,
      owner_name,
      avatar,
      wins,
      losses,
      ties,
      pf: pfVal,
      pa: paVal
    });
  }
  out.sort((a,b) => {
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    return (b.pf || 0) - (a.pf || 0);
  });
  return out;
}

// accumulate player-level points from a participant entry into a map playerId -> cumulative points
function accumulatePlayerPointsFromParticipant(entry, map) {
  if (!entry || typeof entry !== 'object') return;
  // 1) entry.player_points: map playerId -> points
  if (entry.player_points && typeof entry.player_points === 'object') {
    for (const pid of Object.keys(entry.player_points)) {
      const pval = safeNum(entry.player_points[pid]);
      map[pid] = (map[pid] || 0) + pval;
    }
    return;
  }
  // 2) entry.starters may be array of ids + entry.player_points (handled), or array of objects with {player_id, points} or {id, points} or {p, points}
  if (Array.isArray(entry.starters) && entry.starters.length) {
    if (typeof entry.starters[0] === 'object') {
      for (const obj of entry.starters) {
        const pid = obj.player_id ?? obj.id ?? obj.pid ?? obj.puid ?? obj.p ?? null;
        const pval = safeNum(obj.points ?? obj.p ?? obj.pts ?? 0);
        if (pid) map[String(pid)] = (map[String(pid)] || 0) + pval;
      }
      return;
    }
    // if starters is array of ids, but we don't have player_points map then can't attribute
    if (entry.player_points && typeof entry.player_points === 'object') {
      for (const st of entry.starters) {
        const pval = safeNum(entry.player_points[String(st)]);
        if (!isNaN(pval)) map[String(st)] = (map[String(st)] || 0) + pval;
      }
      return;
    }
  }
  // 3) sometimes participant contains a 'players' array of objects with points
  if (Array.isArray(entry.players) && entry.players.length) {
    for (const p of entry.players) {
      const pid = p.player_id ?? p.id ?? null;
      const pval = safeNum(p.points ?? p.p ?? p.pts ?? 0);
      if (pid) map[String(pid)] = (map[String(pid)] || 0) + pval;
    }
    return;
  }
  // no player-level info available
  return;
}

// find championship matchup row between two roster ids from matchupsRows (preferring final week)
function findChampionshipMatch(matchupsRows, rosterA, rosterB, playoffEnd) {
  if (!Array.isArray(matchupsRows)) return null;
  // prefer week === playoffEnd first
  for (const r of matchupsRows) {
    if (!r.week) continue;
    if (Number(r.week) !== Number(playoffEnd)) continue;
    if (r.participantsCount === 2) {
      const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
      if ((p1 === String(rosterA) && p2 === String(rosterB)) || (p1 === String(rosterB) && p2 === String(rosterA))) return r;
    } else if (r.combinedParticipants) {
      const ids = r.combinedParticipants.map(p => String(p.rosterId));
      if (ids.includes(String(rosterA)) && ids.includes(String(rosterB))) return r;
    }
  }
  // fallback: any week
  for (const r of matchupsRows) {
    if (r.participantsCount === 2) {
      const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
      if ((p1 === String(rosterA) && p2 === String(rosterB)) || (p1 === String(rosterB) && p2 === String(rosterA))) return r;
    } else if (r.combinedParticipants) {
      const ids = r.combinedParticipants.map(p => String(p.rosterId));
      if (ids.includes(String(rosterA)) && ids.includes(String(rosterB))) return r;
    }
  }
  return null;
}

export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const origin = event.url?.origin || null;
  const incomingSeasonParam = event.url?.searchParams.get('season') || null;
  const messages = [];
  let jsonLinks = [];
  let seasonMatchupsMap = {};

  // load season JSONs first
  try {
    const loaded = await tryLoadSeasonMatchups(SEASON_MATCHUP_YEARS, origin);
    seasonMatchupsMap = loaded.map || {};
    jsonLinks = loaded.jsonLinks || [];
    if (Object.keys(seasonMatchupsMap).length) messages.push('Loaded season JSONs: ' + Object.keys(seasonMatchupsMap).join(', '));
    else messages.push('No season JSONs found for configured years.');
  } catch (e) {
    seasonMatchupsMap = {};
    messages.push('Error loading season JSONs: ' + (e?.message ?? String(e)));
  }

  // build seasons chain (from BASE_LEAGUE_ID)
  let seasons = [];
  const prevChain = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { mainLeague = null; messages.push('Failed fetching base league meta: ' + (e?.message ?? String(e))); }

    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id), season: mainLeague.season ?? null, name: mainLeague.name ?? null });
      prevChain.push(String(mainLeague.league_id));
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) break;
          seasons.push({ league_id: String(prevLeague.league_id || currPrev), season: prevLeague.season ?? null, name: prevLeague.name ?? null });
          prevChain.push(String(prevLeague.league_id || currPrev));
          currPrev = prevLeague.previous_league_id ? String(prevLeague.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err?.message ?? String(err)));
          break;
        }
      }
    }
  } catch (e) {
    messages.push('Error while building seasons chain: ' + (e?.message ?? String(e)));
  }

  // dedupe & sort
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);
  seasons.sort((a,b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a.season).localeCompare(String(b.season));
  });

  // determine selected season (prefer incoming param, else newest known season)
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      // fallback: choose latest JSON year if present
      const jsonYears = Object.keys(seasonMatchupsMap).sort();
      if (jsonYears.length) selectedSeasonParam = jsonYears[jsonYears.length - 1];
      else selectedSeasonParam = null;
    }
  }

  // determine matchups source for selected season
  const seasonJsonForSelected = (selectedSeasonParam && seasonMatchupsMap[String(selectedSeasonParam)]) ? seasonMatchupsMap[String(selectedSeasonParam)] : null;

  // find league id for the selectedSeasonParam (if given) else null (used only when we fallback to API)
  let selectedLeagueId = null;
  for (const s of seasons) {
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }

  // If no leagueId found, and selectedSeasonParam is numeric we might treat it as the season year and attempt to find league with that season
  if (!selectedLeagueId) {
    for (const s of seasons) {
      if (s.season != null && String(s.season) === String(selectedSeasonParam)) {
        selectedLeagueId = String(s.league_id);
        break;
      }
    }
  }

  // If still null, fallback to base league id
  if (!selectedLeagueId && seasons && seasons.length) selectedLeagueId = String(seasons[seasons.length - 1].league_id || BASE_LEAGUE_ID);
  if (!selectedLeagueId) selectedLeagueId = BASE_LEAGUE_ID;

  // Determine playoff boundaries (prefer JSON, else league settings, else default 15)
  let playoffStart = 15;
  if (seasonJsonForSelected) {
    playoffStart = (typeof seasonJsonForSelected.playoff_week_start === 'number') ? Number(seasonJsonForSelected.playoff_week_start)
      : (seasonJsonForSelected._meta && typeof seasonJsonForSelected._meta.playoff_week_start === 'number') ? Number(seasonJsonForSelected._meta.playoff_week_start) : 15;
    messages.push(`Processed season JSON ${String(selectedSeasonParam)} (playoff_week_start=${playoffStart})`);
  } else {
    try {
      const leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 });
      const ps = leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek);
      if (ps && !isNaN(Number(ps))) playoffStart = Number(ps);
      else playoffStart = 15;
      messages.push(`Computed playoff_start from API for league ${selectedLeagueId} -> ${playoffStart}`);
    } catch (e) {
      playoffStart = 15;
      messages.push('Failed to fetch league settings for playoff week; defaulting to ' + playoffStart);
    }
  }
  const playoffEnd = playoffStart + 2;

  // load rosterMap for enrichment (try to get the most recent roster metadata for the league selected)
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 }) || {};
    messages.push(`Loaded rosters (${Object.keys(rosterMap).length}) for league ${selectedLeagueId}`);
  } catch (e) {
    rosterMap = {};
    messages.push('Failed fetching rosterMap: ' + (e?.message ?? String(e)));
  }

  // --- Build regular season trackers, skipping current-in-progress week detection ---
  const statsByRosterRegular = {};
  const resultsByRosterRegular = {};
  const paByRosterRegular = {};

  // seed trackers from rosterMap
  if (rosterMap && Object.keys(rosterMap).length) {
    for (const rk in rosterMap) {
      if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
      statsByRosterRegular[String(rk)] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: rosterMap[rk].roster_raw || null };
      resultsByRosterRegular[String(rk)] = [];
      paByRosterRegular[String(rk)] = 0;
    }
  }

  // helper to obtain matchups for a week: prefer JSON when available, else API call
  async function getMatchupsForWeek(week) {
    if (seasonJsonForSelected) {
      return seasonJsonForSelected[String(week)] || [];
    }
    try {
      const arr = await sleeper.getMatchupsForWeek(selectedLeagueId, week, { ttl: 60 * 5 });
      return arr || [];
    } catch (e) {
      messages.push(`Error fetching matchups for league ${selectedLeagueId} week ${week}: ${e?.message ?? String(e)}`);
      return [];
    }
  }

  // process weeks for regular season
  for (let week = 1; week <= MAX_WEEKS; week++) {
    const matchups = (await getMatchupsForWeek(week)) || [];
    if (!matchups || !matchups.length) continue;

    const isRegularWeek = (week >= 1 && week < playoffStart);
    const isPlayoffWeek = (week >= playoffStart && week <= playoffEnd);
    if (!isRegularWeek && !isPlayoffWeek) continue;

    // skip "current" in-progress week if next-week has explicit zeros (but do not apply for final playoff week)
    if (week !== playoffEnd) {
      const next = await getMatchupsForWeek(week + 1);
      if (next && next.length && nextWeekContainsExplicitZero(next)) {
        // skip this week
        continue;
      }
    }

    // only process regular-season weeks into regular trackers
    if (!isRegularWeek) continue;

    // group by matchup key (some APIs produce separate participant entries)
    const byMatch = {};
    for (let mi = 0; mi < matchups.length; mi++) {
      const entry = matchups[mi];
      const mid = entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? null;
      const wk = entry.week ?? entry.w ?? week;
      const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(entry);
    }

    const keys = Object.keys(byMatch);
    for (const k of keys) {
      const entries = byMatch[k];
      if (!entries || entries.length === 0) continue;

      if (entries.length === 1) {
        const only = entries[0];
        const ridOnly = String(only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId ?? ('r' + Math.random()));
        const ptsOnly = computeParticipantPoints(only);
        paByRosterRegular[ridOnly] = paByRosterRegular[ridOnly] || 0;
        resultsByRosterRegular[ridOnly] = resultsByRosterRegular[ridOnly] || [];
        statsByRosterRegular[ridOnly] = statsByRosterRegular[ridOnly] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
        statsByRosterRegular[ridOnly].pf += ptsOnly;
        continue;
      }

      // multiple participants (usually 2)
      const participants = [];
      for (let e = 0; e < entries.length; e++) {
        const en = entries[e];
        const pid = String(en.roster_id ?? en.rosterId ?? en.owner_id ?? en.ownerId ?? ('r' + e));
        let ppts = computeParticipantPoints(en);
        participants.push({ rosterId: pid, points: ppts, raw: en });
        paByRosterRegular[pid] = paByRosterRegular[pid] || 0;
        resultsByRosterRegular[pid] = resultsByRosterRegular[pid] || [];
        statsByRosterRegular[pid] = statsByRosterRegular[pid] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
        statsByRosterRegular[pid].pf += ppts;
      }

      // compute opponent average and W/L/T
      for (let pi = 0; pi < participants.length; pi++) {
        const part = participants[pi];
        const opponents = [];
        for (let oi = 0; oi < participants.length; oi++) if (oi !== pi) opponents.push(participants[oi]);
        let oppAvg = 0;
        if (opponents.length) oppAvg = opponents.reduce((acc,o) => acc + o.points, 0) / opponents.length;
        paByRosterRegular[part.rosterId] = paByRosterRegular[part.rosterId] || 0;
        paByRosterRegular[part.rosterId] += oppAvg;
        if (part.points > oppAvg + 1e-9) {
          resultsByRosterRegular[part.rosterId].push('W'); statsByRosterRegular[part.rosterId].wins += 1;
        } else if (part.points < oppAvg - 1e-9) {
          resultsByRosterRegular[part.rosterId].push('L'); statsByRosterRegular[part.rosterId].losses += 1;
        } else {
          resultsByRosterRegular[part.rosterId].push('T'); statsByRosterRegular[part.rosterId].ties += 1;
        }
      }
    }
  } // end weeks loop for regular

  const regularStandings = buildStandingsFromTrackers(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular, rosterMap);

  // --- gather playoff matchups (weeks playoffStart..playoffEnd) and normalize them into matchupsRows ---
  const matchupsRows = [];
  // fetch each playoff week
  for (let wk = playoffStart; wk <= playoffEnd; wk++) {
    const matchups = (await getMatchupsForWeek(wk)) || [];
    if (!matchups || !matchups.length) continue;
    // group cluster
    const byMatch = {};
    for (let mi = 0; mi < matchups.length; mi++) {
      const e = matchups[mi];
      const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
      const wknum = e.week ?? e.w ?? wk;
      const key = String(mid != null ? (mid + '|' + wknum) : ('auto|' + wknum + '|' + mi));
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(e);
    }

    for (const key of Object.keys(byMatch)) {
      const entries = byMatch[key];
      if (!entries || entries.length === 0) continue;
      if (entries.length === 1) {
        const a = entries[0];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? ('r' + Math.random()));
        const aPts = computeParticipantPoints(a);
        const metaA = rosterMap[aId] || {};
        matchupsRows.push({
          matchup_id: key,
          season: String(selectedSeasonParam || (await (async () => { try { const L = await sleeper.getLeague(selectedLeagueId, { ttl: 60*5 }); return L && L.season ? L.season : null; } catch(e){return null;} })())),
          week: a.week ?? a.w ?? wk,
          teamA: { rosterId: aId, name: metaA.team_name || metaA.owner_name || ('Roster ' + aId), avatar: metaA.team_avatar || metaA.owner_avatar || null, points: aPts },
          teamB: { rosterId: null, name: 'BYE', avatar: null, points: null },
          participantsCount: 1
        });
        continue;
      }

      if (entries.length === 2) {
        const a = entries[0], b = entries[1];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? ('rA'));
        const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? ('rB'));
        const aPts = computeParticipantPoints(a);
        const bPts = computeParticipantPoints(b);
        const metaA = rosterMap[aId] || {};
        const metaB = rosterMap[bId] || {};
        matchupsRows.push({
          matchup_id: key,
          season: String(selectedSeasonParam || (await (async () => { try { const L = await sleeper.getLeague(selectedLeagueId, { ttl: 60*5 }); return L && L.season ? L.season : null; } catch(e){return null;} })())),
          week: a.week ?? a.w ?? wk,
          teamA: { rosterId: aId, name: metaA.team_name || metaA.owner_name || ('Roster ' + aId), avatar: metaA.team_avatar || metaA.owner_avatar || null, points: aPts },
          teamB: { rosterId: bId, name: metaB.team_name || metaB.owner_name || ('Roster ' + bId), avatar: metaB.team_avatar || metaB.owner_avatar || null, points: bPts },
          participantsCount: 2
        });
        continue;
      }

      // more than two participants
      const participants = entries.map(ent => {
        const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? ('r'));
        const pts = computeParticipantPoints(ent);
        const meta = rosterMap[pid] || {};
        return { rosterId: pid, name: meta.team_name || meta.owner_name || ('Roster ' + pid), avatar: meta.team_avatar || meta.owner_avatar || null, points: pts };
      });
      matchupsRows.push({
        matchup_id: key,
        season: String(selectedSeasonParam),
        week: entries[0].week ?? entries[0].w ?? wk,
        combinedParticipants: participants,
        combinedLabel: participants.map(p => p.name).join(' / '),
        participantsCount: participants.length
      });
    }
  } // end playoff weeks

  // build placement map from regularStandings
  const placementMap = {};
  for (let i = 0; i < regularStandings.length; i++) placementMap[String(regularStandings[i].rosterId)] = i + 1;
  const placementToRoster = {};
  for (const k in placementMap) placementToRoster[placementMap[k]] = k;

  // helper: find match for a pair in playoff matchupsRows (prefer final week)
  function findMatchForPair(rA, rB, preferredWeeks = [playoffStart, playoffStart+1, playoffEnd]) {
    if (!rA || !rB) return null;
    const a = String(rA), b = String(rB);
    // try preferred weeks
    for (const wk of preferredWeeks) {
      for (const r of matchupsRows) {
        if (!r.week) continue;
        if (Number(r.week) !== Number(wk)) continue;
        if (r.participantsCount === 2) {
          const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
          if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) return r;
        } else if (r.combinedParticipants) {
          const ids = r.combinedParticipants.map(p => String(p.rosterId));
          if (ids.includes(a) && ids.includes(b)) return r;
        }
      }
    }
    // fallback any week
    for (const r of matchupsRows) {
      if (r.participantsCount === 2) {
        const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
        if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) return r;
      } else if (r.combinedParticipants) {
        const ids = r.combinedParticipants.map(p => String(p.rosterId));
        if (ids.includes(a) && ids.includes(b)) return r;
      }
    }
    return null;
  }

  // helper: decide winner from matchup row (by points, then tiebreaks using regular standings pf/wins)
  function decideWinnerFromMatch(matchRow, aId, bId) {
    if (!matchRow) return null;
    const a = String(aId), b = String(bId);
    let aPts = null, bPts = null;
    if (matchRow.participantsCount === 2) {
      const pA = String(matchRow.teamA.rosterId), pB = String(matchRow.teamB.rosterId);
      if (pA === a) { aPts = matchRow.teamA.points; bPts = matchRow.teamB.points; }
      else { aPts = matchRow.teamB.points; bPts = matchRow.teamA.points; }
    } else if (matchRow.combinedParticipants) {
      const pAobj = matchRow.combinedParticipants.find(p => String(p.rosterId) === a);
      const pBobj = matchRow.combinedParticipants.find(p => String(p.rosterId) === b);
      aPts = pAobj?.points ?? null;
      bPts = pBobj?.points ?? null;
    }

    if (aPts == null || bPts == null) return null;
    if (aPts > bPts + 1e-9) return { winner: a, loser: b, reason: 'matchup' };
    if (bPts > aPts + 1e-9) return { winner: b, loser: a, reason: 'matchup' };

    // tiebreaks from regular standings pf -> wins -> placement
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

  // run a bracket match given seeded objects {seed, rosterId}
  function runMatch(seedA, seedB, label, preferredWeeks) {
    const a = seedA.rosterId, b = seedB.rosterId;
    const matchRow = findMatchForPair(a, b, preferredWeeks);
    const decision = decideWinnerFromMatch(matchRow, a, b);
    if (!decision) {
      // fallback: higher seed (lower numeric seed) wins
      const winner = (Number(seedA.seed) <= Number(seedB.seed)) ? seedA.rosterId : seedB.rosterId;
      const loser = (winner === seedA.rosterId) ? seedB.rosterId : seedA.rosterId;
      return { winner, loser, row: matchRow, reason: 'fallback-no-match' };
    }
    return { winner: decision.winner, loser: decision.loser, row: matchRow, reason: decision.reason };
  }

  // -------------------------
  // Winners bracket: seeds 1-8
  // -------------------------
  const winnersSeeds = [];
  const losersSeeds = [];
  for (let s = 1; s <= 14; s++) {
    const rid = placementToRoster[s] ?? null;
    if (!rid) continue;
    if (s <= 8) winnersSeeds.push({ seed: s, rosterId: rid });
    else losersSeeds.push({ seed: s, rosterId: rid });
  }

  // if not enough seeds, use rosterMap order
  while (winnersSeeds.length < 8 && Object.keys(rosterMap).length) {
    // fill with any remaining rosters not present
    for (const rk in rosterMap) {
      const present = winnersSeeds.find(w => String(w.rosterId) === String(rk)) || losersSeeds.find(l => String(l.rosterId) === String(rk));
      if (!present) {
        winnersSeeds.push({ seed: null, rosterId: String(rk) });
        if (winnersSeeds.length >= 8) break;
      }
    }
    break;
  }

  // W1 pairings: 1v8,2v7,3v6,4v5
  const wR1Pairs = [
    [1,8],[2,7],[3,6],[4,5]
  ].map(([a,b]) => ({ a: { seed: a, rosterId: placementToRoster[a] || null }, b: { seed: b, rosterId: placementToRoster[b] || null } }));

  const wR1Results = [];
  for (const p of wR1Pairs) {
    if (!p.a.rosterId && !p.b.rosterId) {
      wR1Results.push({ winner: p.a.rosterId || p.b.rosterId, loser: p.a.rosterId ? p.b.rosterId : p.a.rosterId, reason: 'missing-roster' });
      continue;
    }
    const res = runMatch(p.a, p.b, 'W1');
    wR1Results.push(res);
  }

  const wR1Winners = wR1Results.map(r => ({ seed: placementMap[r.winner] ?? null, rosterId: r.winner, loser: r.loser }));
  wR1Winners.sort((a,b) => (a.seed || 999) - (b.seed || 999));

  // semifinals pairing: highest vs lowest among winners
  const wSemiPairs = [];
  if (wR1Winners.length >= 4) {
    wSemiPairs.push([ wR1Winners[0], wR1Winners[3] ]);
    wSemiPairs.push([ wR1Winners[1], wR1Winners[2] ]);
  } else if (wR1Winners.length >= 2) {
    wSemiPairs.push([ wR1Winners[0], wR1Winners[1] ]);
  }

  const wSemiResults = [];
  for (const pair of wSemiPairs) {
    const left = pair[0], right = pair[1];
    if (!left || !right || !left.rosterId || !right.rosterId) {
      wSemiResults.push({ winner: left?.rosterId || right?.rosterId, loser: left?.rosterId ? right?.rosterId : left?.rosterId, reason: 'missing' });
      continue;
    }
    const res = runMatch({seed: left.seed, rosterId: left.rosterId}, {seed: right.seed, rosterId: right.rosterId}, 'Semi');
    wSemiResults.push(res);
  }

  // Final
  const finalRes = (wSemiResults.length >= 2)
    ? runMatch({ seed: placementMap[wSemiResults[0].winner], rosterId: wSemiResults[0].winner }, { seed: placementMap[wSemiResults[1].winner], rosterId: wSemiResults[1].winner }, 'Final')
    : (wSemiResults.length === 1 ? wSemiResults[0] : null);
  // 3rd place
  const thirdRes = (wSemiResults.length >= 2)
    ? runMatch({ seed: placementMap[wSemiResults[0].loser], rosterId: wSemiResults[0].loser }, { seed: placementMap[wSemiResults[1].loser], rosterId: wSemiResults[1].loser }, '3rd')
    : null;

  // Consolation bracket from wR1 losers for 5th..8th
  const wR1Losers = wR1Results.map(r => ({ seed: placementMap[r.loser] ?? null, rosterId: r.loser }));
  wR1Losers.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const cR1Pairs = [
    [ wR1Losers[0], wR1Losers[wR1Losers.length - 1] ],
    [ wR1Losers[1], wR1Losers[wR1Losers.length - 2] ]
  ].filter(Boolean);

  const cR1Results = [];
  for (const pair of cR1Pairs) {
    if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) {
      cR1Results.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[0]?.rosterId ? pair[1]?.rosterId : pair[0]?.rosterId, reason: 'missing' });
      continue;
    }
    const res = runMatch({ seed: pair[0].seed, rosterId: pair[0].rosterId }, { seed: pair[1].seed, rosterId: pair[1].rosterId }, 'Consolation R1');
    cR1Results.push(res);
  }

  const fifthRes = (cR1Results.length >= 2)
    ? runMatch({ seed: placementMap[cR1Results[0].winner], rosterId: cR1Results[0].winner }, { seed: placementMap[cR1Results[1].winner], rosterId: cR1Results[1].winner }, '5th')
    : (cR1Results.length === 1 ? cR1Results[0] : null);
  const seventhRes = (cR1Results.length >= 2)
    ? runMatch({ seed: placementMap[cR1Results[0].loser], rosterId: cR1Results[0].loser }, { seed: placementMap[cR1Results[1].loser], rosterId: cR1Results[1].loser }, '7th')
    : null;

  // Losers bracket for 9..14 (attempt best-effort similar to prior logic)
  const lPairsSeedNums = [[9,12],[10,11]];
  const lBySeed = {};
  for (const s of losersSeeds) lBySeed[s.seed] = s;
  const lR1Results = [];
  for (const [s1,s2] of lPairsSeedNums) {
    const objA = lBySeed[s1] || { seed: s1, rosterId: placementToRoster[s1] || null };
    const objB = lBySeed[s2] || { seed: s2, rosterId: placementToRoster[s2] || null };
    if (!objA.rosterId && !objB.rosterId) {
      lR1Results.push({ winner: objA.rosterId || objB.rosterId, loser: objA.rosterId ? objB.rosterId : objA.rosterId, reason: 'missing' });
      continue;
    }
    const res = runMatch({ seed: objA.seed, rosterId: objA.rosterId }, { seed: objB.seed, rosterId: objB.rosterId }, 'LRace');
    lR1Results.push(res);
  }

  const lWinners = lR1Results.map(r => ({ rosterId: r.winner, seed: placementMap[r.winner] ?? null }));
  const lLosers = lR1Results.map(r => ({ rosterId: r.loser, seed: placementMap[r.loser] ?? null }));
  const bye13 = { seed: 13, rosterId: placementToRoster[13] ?? null };
  const bye14 = { seed: 14, rosterId: placementToRoster[14] ?? null };

  lLosers.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const lrSemiPairs = [];
  if (lLosers.length >= 1) lrSemiPairs.push([ lLosers[0], bye14 ]);
  if (lLosers.length >= 2) lrSemiPairs.push([ lLosers[1], bye13 ]);

  const lSemiResults = [];
  for (const pair of lrSemiPairs) {
    const left = pair[0], right = pair[1];
    if (!left || !right || !left.rosterId || !right.rosterId) {
      lSemiResults.push({ winner: left?.rosterId || right?.rosterId, loser: right?.rosterId || left?.rosterId, reason: 'missing' });
      continue;
    }
    const res = runMatch({ seed: left.seed, rosterId: left.rosterId }, { seed: right.seed, rosterId: right.rosterId }, 'LRaceSemi');
    lSemiResults.push(res);
  }

  let lFinalRes = null;
  if (lWinners.length >= 2) lFinalRes = runMatch({ seed: lWinners[0].seed, rosterId: lWinners[0].rosterId }, { seed: lWinners[1].seed, rosterId: lWinners[1].rosterId }, '9th');
  else if (lWinners.length === 1) lFinalRes = { winner: lWinners[0].rosterId, loser: null, reason: 'auto' };

  let l11Res = null, l13Res = null;
  if (lSemiResults.length >= 2) {
    const semiWinners = lSemiResults.map(r => ({ rosterId: r.winner, seed: placementMap[r.winner] ?? null }));
    const semiLosers = lSemiResults.map(r => ({ rosterId: r.loser, seed: placementMap[r.loser] ?? null }));
    if (semiWinners.length >= 2) l11Res = runMatch({seed: semiWinners[0].seed, rosterId: semiWinners[0].rosterId}, {seed: semiWinners[1].seed, rosterId: semiWinners[1].rosterId}, '11th');
    else if (semiWinners.length === 1) l11Res = { winner: semiWinners[0].rosterId, loser: null, reason: 'auto' };

    if (semiLosers.length >= 2) l13Res = runMatch({seed: semiLosers[0].seed, rosterId: semiLosers[0].rosterId}, {seed: semiLosers[1].seed, rosterId: semiLosers[1].rosterId}, '13th');
    else if (semiLosers.length === 1) l13Res = { winner: semiLosers[0].rosterId, loser: null, reason: 'auto' };
  } else if (lSemiResults.length === 1) {
    l11Res = { winner: lSemiResults[0].winner, loser: null, reason: 'only-semi' };
    l13Res = { winner: lSemiResults[0].loser, loser: null, reason: 'only-semi' };
  }

  // Build final ordered placement list (1..N)
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

  pushResultPair(finalRes);
  pushResultPair(thirdRes);
  pushResultPair(fifthRes);
  pushResultPair(seventhRes);
  pushResultPair(lFinalRes);
  pushResultPair(l11Res);
  pushResultPair(l13Res);

  // include any playoff match participants not assigned
  for (const r of matchupsRows) {
    if (r.participantsCount === 2) {
      pushIfNotAssigned(r.teamA.rosterId);
      pushIfNotAssigned(r.teamB.rosterId);
    } else if (Array.isArray(r.combinedParticipants)) {
      for (const p of r.combinedParticipants) pushIfNotAssigned(p.rosterId);
    } else if (r.teamA && r.teamA.rosterId) pushIfNotAssigned(r.teamA.rosterId);
  }
  // include any rosterMap entries not assigned
  for (const rk in rosterMap) pushIfNotAssigned(rk);

  // trim/pad to number of teams
  const totalTeams = Object.keys(rosterMap).length || placementFinal.length;
  if (placementFinal.length < totalTeams) {
    for (const rk in rosterMap) {
      if (!assigned.has(String(rk))) pushIfNotAssigned(rk);
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
      pf: (regularStandings.find(s => String(s.rosterId) === rid)?.pf) ?? 0,
      wins: (regularStandings.find(s => String(s.rosterId) === rid)?.wins) ?? 0,
      owner_name: meta.owner_name ?? null,
      roster_meta: meta
    });
  }

  // stable fallback ordering
  finalStandings.sort((a,b) => {
    if ((a.rank || 0) !== (b.rank || 0)) return (a.rank || 0) - (b.rank || 0);
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    if ((b.pf || 0) !== (a.pf || 0)) return (b.pf || 0) - (a.pf || 0);
    return (a.seed || 999) - (b.seed || 999);
  });
  for (let i = 0; i < finalStandings.length; i++) finalStandings[i].rank = i + 1;

  const champion = finalStandings[0] ?? null;
  const lastPlace = finalStandings[finalStandings.length - 1] ?? null;

  // -------------------------
  // MVP calculations (player-level)
  // overallMvp: player with most total points across season (regular + playoffs)
  // finalsMvp: player with most points in the championship matchup
  // we will iterate matchups weeks 1..playoffEnd and accumulate player-level points where available
  // -------------------------
  const playerTotals = {}; // playerId -> cumulative points

  // helper to process a week's matchups and accumulate playerPoints
  async function processWeekForPlayers(week) {
    const matchups = await getMatchupsForWeek(week);
    if (!matchups || !matchups.length) return;
    const byMatch = {};
    for (let mi = 0; mi < matchups.length; mi++) {
      const entry = matchups[mi];
      const mid = entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? null;
      const wk = entry.week ?? entry.w ?? week;
      const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(entry);
    }
    for (const k of Object.keys(byMatch)) {
      const entries = byMatch[k];
      if (!entries || entries.length === 0) continue;
      // each participant entry might have player_points or starters arrays
      for (const ent of entries) {
        accumulatePlayerPointsFromParticipant(ent, playerTotals);
      }
    }
  }

  // accumulate over season weeks up to playoffEnd
  for (let wk = 1; wk <= playoffEnd; wk++) {
    // skip current in-progress week detection as earlier
    if (wk !== playoffEnd) {
      const next = await getMatchupsForWeek(wk + 1);
      if (next && next.length && nextWeekContainsExplicitZero(next)) continue;
    }
    await processWeekForPlayers(wk);
  }

  // determine overallMvp: top player by cumulative points
  let overallMvp = null;
  try {
    const sortedPlayers = Object.keys(playerTotals).map(pid => ({ playerId: pid, points: playerTotals[pid] })).sort((a,b) => b.points - a.points);
    if (sortedPlayers.length) {
      const top = sortedPlayers[0];
      overallMvp = { playerId: top.playerId, points: Math.round((top.points || 0) * 100) / 100 };
    }
  } catch (e) {
    overallMvp = null;
    messages.push('Error computing overall MVP: ' + (e?.message ?? String(e)));
  }

  // determine finalsMvp: find championship matchup and attribute player points for that matchup
  let finalsMvp = null;
  try {
    if (finalRes && finalRes.winner && finalRes.loser) {
      const champRid = finalRes.winner, runnerRid = finalRes.loser;
      const champMatch = findChampionshipMatch(matchupsRows, champRid, runnerRid, playoffEnd);
      if (champMatch) {
        // gather player points for that specific matchup (from raw participant entries if season JSON used we need to find those original entries)
        // We re-extract entries from the matchup row: if participantsCount===2 we need to obtain participant raw objects for each side — the matchupsRows stored only points; but when season JSON used it contained player-level info; however we didn't retain the raw participant objects in matchupsRows for simplicity.
        // Approach: attempt to re-read the JSON/API matchup raw entries for the championship week and find the specific matchup by matching roster IDs and week.
        const champWeek = Number(champMatch.week);
        const rawWeekEntries = (seasonJsonForSelected && seasonJsonForSelected[String(champWeek)]) ? (seasonJsonForSelected[String(champWeek)] || []) : (await sleeper.getMatchupsForWeek(selectedLeagueId, champWeek, { ttl: 60 * 5 }) || []);
        // find the matching cluster
        const targetCluster = (rawWeekEntries || []).find(e => {
          const possibleId = String(e.roster_id ?? e.rosterId ?? e.owner_id ?? e.ownerId ?? null);
          // single-entry match, skip; we need a cluster that includes both roster ids
          return false;
        });
        // Instead of brittle cluster matching, iterate clusters by grouping again
        const clusterMap = {};
        for (let mi = 0; mi < rawWeekEntries.length; mi++) {
          const entry = rawWeekEntries[mi];
          const mid = entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? null;
          const wk = entry.week ?? entry.w ?? champWeek;
          const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + Math.floor(Math.random()*1e9)));
          if (!clusterMap[key]) clusterMap[key] = [];
          clusterMap[key].push(entry);
        }
        // find cluster where both roster ids present
        let chosenCluster = null;
        for (const ck of Object.keys(clusterMap)) {
          const arr = clusterMap[ck];
          const ids = arr.map(en => String(en.roster_id ?? en.rosterId ?? en.owner_id ?? en.ownerId ?? '')).filter(Boolean);
          if (ids.includes(String(champRid)) && ids.includes(String(runnerRid))) {
            chosenCluster = arr;
            break;
          }
        }
        // If found, compute top player in that cluster
        if (chosenCluster) {
          const finPlayers = {};
          for (const ent of chosenCluster) {
            accumulatePlayerPointsFromParticipant(ent, finPlayers);
          }
          const sorted = Object.keys(finPlayers).map(pid => ({ playerId: pid, points: finPlayers[pid] })).sort((a,b) => b.points - a.points);
          if (sorted.length) finalsMvp = { playerId: sorted[0].playerId, points: Math.round((sorted[0].points || 0) * 100) / 100 };
        } else {
          // fallback: check matchupsRows participant-level players if present (combinedParticipants won't have player details)
          // If no player information found, leave finalsMvp null
          finalsMvp = null;
        }
      }
    }
  } catch (e) {
    finalsMvp = null;
    messages.push('Error computing finals MVP: ' + (e?.message ?? String(e)));
  }

  // finalize return payload
  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    regularStandings,
    matchupsRows,
    finalStandings,
    champion,
    lastPlace,
    overallMvp,
    finalsMvp,
    jsonLinks,
    messages,
    prevChain
  };
}
