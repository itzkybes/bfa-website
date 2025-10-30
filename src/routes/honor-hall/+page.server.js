// src/routes/honor-hall/+page.server.js
// Honor Hall loader + bracket simulation (JSON-first playoff loading + server-side player resolution)

import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { readFile } from 'fs/promises';

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
// seasons to attempt JSON loading
const SEASON_MATCHUP_YEARS = (process.env.SEASON_MATCHUP_YEARS && String(process.env.SEASON_MATCHUP_YEARS).trim().length)
  ? String(process.env.SEASON_MATCHUP_YEARS).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
  : [2022, 2023, 2024];

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

// Try to load per-year season_matchups JSON (fetch origin first, then static file)
async function tryLoadSeasonMatchups(years, origin) {
  const map = {};
  const jsonLinks = [];
  for (const y of years) {
    let loaded = null;

    // remote fetch first (if origin provided)
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

    // static fallback
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

// ---------- helper to detect explicit zero scores in next-week matchups ----------
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

export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const origin = url?.origin || null;
  const incomingSeasonParam = url.searchParams.get('season') || null;

  const messages = [];
  const prevChain = [];
  const debug = [];

  // Load season JSONs first (if available)
  let seasonMatchupsMap = {};
  let jsonLinks = [];
  try {
    const loaded = await tryLoadSeasonMatchups(SEASON_MATCHUP_YEARS, origin);
    seasonMatchupsMap = loaded.map || {};
    jsonLinks = loaded.jsonLinks || [];
    if (Object.keys(seasonMatchupsMap).length) {
      messages.push('Loaded season JSONs: ' + Object.keys(seasonMatchupsMap).join(', '));
    } else {
      messages.push('No season JSONs found for configured years: ' + SEASON_MATCHUP_YEARS.join(', '));
    }
  } catch (e) {
    messages.push('Error loading season JSONs: ' + (e?.message ?? String(e)));
    seasonMatchupsMap = {};
  }

  // --- build seasons chain using Sleeper API (same as previous logic) ---
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

  // dedupe & sort seasons
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

  // chosen season param
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = String(BASE_LEAGUE_ID);
    }
  }

  // map selectedSeasonParam -> league id (if possible)
  let selectedLeagueId = null;
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selectedSeasonParam || BASE_LEAGUE_ID);

  // fetch league metadata
  let leagueMeta = null;
  try { leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }); }
  catch (e) { leagueMeta = null; messages.push('Failed fetching league meta for ' + selectedLeagueId + ' — ' + (e?.message ?? e)); }

  // Determine playoff boundaries, prefer JSON per-season override if present
  const seasonJsonForSelected = (leagueMeta && leagueMeta.season && seasonMatchupsMap[String(leagueMeta.season)]) ? seasonMatchupsMap[String(leagueMeta.season)] : null;
  let playoffStart = null;
  if (seasonJsonForSelected && (typeof seasonJsonForSelected.playoff_week_start === 'number' || (seasonJsonForSelected._meta && typeof seasonJsonForSelected._meta.playoff_week_start === 'number'))) {
    playoffStart = (typeof seasonJsonForSelected.playoff_week_start === 'number') ? Number(seasonJsonForSelected.playoff_week_start) : Number(seasonJsonForSelected._meta.playoff_week_start);
    messages.push(`Using playoff_week_start from JSON for season ${leagueMeta?.season}: ${playoffStart}`);
  } else {
    playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      playoffStart = 15;
      messages.push('Playoff start not found in metadata — defaulting to week ' + playoffStart);
    } else {
      messages.push('Using playoff_week_start from API metadata: ' + playoffStart);
    }
  }
  const playoffEnd = playoffStart + 2;

  // roster map (enriched) for selected league
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 }) || {};
    messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ') for league ' + selectedLeagueId);
  } catch (e) {
    rosterMap = {};
    messages.push('Failed fetching roster map for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }

  // --- compute regular-season standings from API/JSON (used for tiebreaks when simulating bracket) ---
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

  // helper to process a collection of matchups for a given week into the regular-season trackers
  function processRegularMatchups(week, matchups, earlyData = null) {
    if (!Array.isArray(matchups) || !matchups.length) return;
    // group by matchup_id/week key (to combine participant entries)
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
        const ptsOnly = safeNum(only.points ?? only.points_for ?? only.pts ?? only.teamAScore ?? only.teamBScore ?? 0);
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
        const ppts = safeNum(ent.points ?? ent.points_for ?? ent.pts ?? ent.teamAScore ?? ent.teamBScore ?? 0);
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
  }

  // optionally use season JSON for regular weeks if present for that season (helps early weeks)
  let earlyJsonData = null;
  try {
    if (seasonJsonForSelected) {
      // nothing special: season JSON covers all weeks and includes starters/starter_points
      // We'll still use the regular processing loop with the JSON matchups
      messages.push(`Season JSON available for selected season ${leagueMeta?.season}`);
    }
  } catch (e) {}

  for (let week = regStart; week <= regEnd; week++) {
    try {
      let matchups = null;
      if (seasonJsonForSelected) {
        matchups = seasonJsonForSelected[String(week)] || [];
      } else {
        try {
          matchups = await sleeper.getMatchupsForWeek(selectedLeagueId, week, { ttl: 60 * 5 }) || [];
        } catch (errWeek) {
          messages.push('Error fetching matchups for league ' + selectedLeagueId + ' week ' + week + ' — ' + (errWeek && errWeek.message ? errWeek.message : String(errWeek)));
          continue;
        }
      }
      if (!matchups || !matchups.length) continue;
      processRegularMatchups(week, matchups);
    } catch (e) {
      messages.push('Error processing regular week ' + week + ' — ' + (e?.message ?? String(e)));
    }
  }

  // Build regular standings list (used by tiebreaks)
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

  // -----------------------------
  // Fetch playoff matchups (JSON-first) and normalize them
  // -----------------------------
  const rawMatchups = [];
  const seasonJsonPathsTried = [];
  let seasonJsonLoaded = false;

  for (let wk = playoffStart; wk <= playoffEnd; wk++) {
    try {
      let wkMatchups = null;
      if (seasonJsonForSelected) {
        wkMatchups = seasonJsonForSelected[String(wk)] || [];
        seasonJsonLoaded = true;
        // record the source path tried
        seasonJsonPathsTried.push(`/season_matchups/${String(leagueMeta?.season)}.json`);
      } else {
        try {
          wkMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, wk, { ttl: 60 * 5 }) || [];
        } catch (we) {
          messages.push('Failed to fetch matchups for week ' + wk + ': ' + (we?.message ?? String(we)));
          wkMatchups = [];
        }
      }

      if (Array.isArray(wkMatchups) && wkMatchups.length) {
        for (const m of wkMatchups) {
          // normalize week if missing
          if (m && (m.week == null && m.w == null)) m.week = wk;
          rawMatchups.push(m);
        }
      }
    } catch (we) {
      messages.push('Error processing playoff week ' + wk + ': ' + (we?.message ?? String(we)));
    }
  }

  // group by matchup key and produce matchupsRows with starters/starter_points metadata when available
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

    // Single participant -> treat as bye etc.
    if (entries.length === 1) {
      const a = entries[0];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const aMeta = rosterMap[aId] || {};
      const aName = aMeta.team_name || aMeta.owner_name || a.teamName ?? a.name ?? ('Roster ' + aId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || a.team_avatar || a.owner_avatar || null;
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? a.teamAScore ?? a.teamBScore ?? null);
      matchupsRows.push({
        matchup_id: mkeys[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: a.week ?? a.w ?? null,
        teamA: {
          rosterId: aId,
          name: aName,
          avatar: aAvatar,
          points: aPts,
          placement: null,
          starters: a.teamA?.starters ?? a.starters ?? a.team?.starters ?? null,
          starters_points: a.teamA?.starters_points ?? a.starters_points ?? a.startersPoints ?? null
        },
        teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, placement: null },
        participantsCount: 1
      });
      continue;
    }

    // Two participant matchup (2-team)
    if (entries.length === 2) {
      const a = entries[0];
      const b = entries[1];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
      const aMeta = rosterMap[aId] || {};
      const bMeta = rosterMap[bId] || {};
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? a.teamAScore ?? a.teamA?.score ?? a.teamA?.points ?? null);
      const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? b.teamBScore ?? b.teamB?.score ?? b.teamB?.points ?? null);
      matchupsRows.push({
        matchup_id: mkeys[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: a.week ?? a.w ?? null,
        teamA: {
          rosterId: aId,
          name: aMeta.team_name || aMeta.owner_name || a.teamA?.name ?? a.name ?? ('Roster ' + aId),
          avatar: aMeta.team_avatar || aMeta.owner_avatar || a.teamA?.team_avatar || a.teamA?.owner_avatar || null,
          points: aPts,
          placement: null,
          starters: a.teamA?.starters ?? a.team?.starters ?? a.starters ?? null,
          starters_points: a.teamA?.starters_points ?? a.team?.starters_points ?? a.starters_points ?? null,
        },
        teamB: {
          rosterId: bId,
          name: bMeta.team_name || bMeta.owner_name || b.teamB?.name ?? b.name ?? ('Roster ' + bId),
          avatar: bMeta.team_avatar || bMeta.owner_avatar || b.teamB?.team_avatar || b.teamB?.owner_avatar || null,
          points: bPts,
          placement: null,
          starters: b.teamB?.starters ?? b.team?.starters ?? b.starters ?? null,
          starters_points: b.teamB?.starters_points ?? b.team?.starters_points ?? b.starters_points ?? null,
        },
        participantsCount: 2
      });
      continue;
    }

    // >2 participants (combined matchups)
    const participants = entries.map(ent => {
      const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
      const meta = rosterMap[pid] || {};
      return {
        rosterId: pid,
        name: meta.team_name || meta.owner_name || ent.teamA?.name ?? ent.teamB?.name ?? ('Roster ' + pid),
        avatar: meta.team_avatar || meta.owner_avatar || null,
        points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0),
        placement: null,
        starters: ent.teamA?.starters ?? ent.team?.starters ?? ent.starters ?? null,
        starters_points: ent.teamA?.starters_points ?? ent.team?.starters_points ?? ent.starters_points ?? null
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
    // fallback: search all
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

    // tiebreak by season PF
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

  // --------------- bracket simulation (similar to earlier logic) ---------------
  // Build placement map from regularStandings (1 = best)
  const placementMap = {};
  for (let i = 0; i < regularStandings.length; i++) placementMap[String(regularStandings[i].rosterId)] = i + 1;
  const placementToRoster = {};
  for (const k in placementMap) placementToRoster[ placementMap[k] ] = k;

  // helpers for seeding and running matches
  function seedToRoster(seed) {
    const rid = placementToRoster[seed] ?? null;
    const meta = rid ? rosterMap[rid] : null;
    return { rosterId: rid, name: meta?.team_name ?? meta?.owner_name ?? ('Roster ' + rid) };
  }

  function runMatch(seedA, seedB, label, preferredWeeks = [playoffStart, playoffStart+1, playoffStart+2]) {
    const a = seedA.rosterId, b = seedB.rosterId;
    const matchRow = findMatchForPair(a, b, preferredWeeks);
    const decision = decideWinnerFromMatch(matchRow, a, b);
    if (!decision) {
      const winner = Number(seedA.seed) <= Number(seedB.seed) ? seedA.rosterId : seedB.rosterId;
      const loser = winner === seedA.rosterId ? seedB.rosterId : seedA.rosterId;
      debug.push(`${label} ${seedA.seed}v${seedB.seed} -> ${ placementMap[winner] ?? winner } (fallback-no-match)`);
      return { winner, loser, row: matchRow, reason: 'fallback-no-match' };
    }
    const winner = decision.winner;
    const loser = decision.loser;
    const wSeed = placementMap[winner] ?? winner;
    debug.push(`${label} ${seedA.seed}v${seedB.seed} -> ${ wSeed } (${decision.reason})`);
    return { winner, loser, row: matchRow, reason: decision.reason };
  }

  // Determine winners-bracket size heuristic:
  // - 2022 has winners bracket size 6 (1 & 2 received byes)
  // - seasons >= 2023: winners bracket size 8
  let winnersBracketSize = 8;
  try {
    if (leagueMeta && leagueMeta.season && Number(leagueMeta.season) === 2022) winnersBracketSize = 6;
  } catch (e) {}

  // seeds arrays
  const winnersSeeds = [];
  const losersSeeds = [];
  for (let s = 1; s <= 14; s++) {
    const rid = placementToRoster[s] ?? null;
    if (!rid) continue;
    if (s <= winnersBracketSize) winnersSeeds.push({ seed: s, rosterId: rid });
    else losersSeeds.push({ seed: s, rosterId: rid });
  }

  // Build winners bracket first round pairs depending on winnersBracketSize
  let wR1Pairs = [];
  if (winnersBracketSize === 6) {
    // seeds: 1 & 2 bye; R1: 3v6, 4v5
    wR1Pairs = [
      { a: { seed: 3, rosterId: placementToRoster[3] }, b: { seed: 6, rosterId: placementToRoster[6] } },
      { a: { seed: 4, rosterId: placementToRoster[4] }, b: { seed: 5, rosterId: placementToRoster[5] } }
    ];
  } else {
    // default 8-team bracket: 1v8,2v7,3v6,4v5
    wR1Pairs = [
      { a: { seed: 1, rosterId: placementToRoster[1] }, b: { seed: 8, rosterId: placementToRoster[8] } },
      { a: { seed: 2, rosterId: placementToRoster[2] }, b: { seed: 7, rosterId: placementToRoster[7] } },
      { a: { seed: 3, rosterId: placementToRoster[3] }, b: { seed: 6, rosterId: placementToRoster[6] } },
      { a: { seed: 4, rosterId: placementToRoster[4] }, b: { seed: 5, rosterId: placementToRoster[5] } }
    ];
  }

  const wR1Results = [];
  for (const p of wR1Pairs) {
    if (!p.a.rosterId || !p.b.rosterId) {
      debug.push(`W1 ${p.a.seed}v${p.b.seed} -> missing-roster`);
      wR1Results.push({ winner: p.a.rosterId || p.b.rosterId, loser: p.a.rosterId ? p.b.rosterId : p.a.rosterId, reason: 'missing-roster' });
      continue;
    }
    const res = runMatch(p.a, p.b, `W1`);
    wR1Results.push(res);
  }

  // winners of W1 proceed; build semis based on winners
  const wR1Winners = wR1Results.map((r) => ({ seed: placementMap[r.winner] ?? null, rosterId: r.winner, loserSeed: placementMap[r.loser] ?? null, loserId: r.loser }));
  wR1Winners.sort((a,b) => (a.seed || 999) - (b.seed || 999));

  // Build semis: take the winners and pair top vs bottom and middle two
  const wSemiPairs = [];
  if (wR1Winners.length >= 2) {
    wSemiPairs.push([ wR1Winners[0], wR1Winners[wR1Winners.length-1] ]);
  }
  if (wR1Winners.length >= 4) {
    wSemiPairs.push([ wR1Winners[1], wR1Winners[wR1Winners.length-2] ]);
  }

  const wSemiResults = [];
  for (const pair of wSemiPairs) {
    if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) {
      debug.push(`Semi missing participant -> skipping`);
      wSemiResults.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[1]?.rosterId || pair[0]?.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}, `Semi`);
    wSemiResults.push(res);
  }

  let finalRes = null;
  let thirdRes = null;
  if (wSemiResults.length >= 2) {
    finalRes = runMatch({seed: placementMap[wSemiResults[0].winner], rosterId: wSemiResults[0].winner}, {seed: placementMap[wSemiResults[1].winner], rosterId: wSemiResults[1].winner}, `Final`);
    thirdRes = runMatch({seed: placementMap[wSemiResults[0].loser], rosterId: wSemiResults[0].loser}, {seed: placementMap[wSemiResults[1].loser], rosterId: wSemiResults[1].loser}, `3rd`);
  } else if (wSemiResults.length === 1) {
    finalRes = runMatch({seed: placementMap[wSemiResults[0].winner], rosterId: wSemiResults[0].winner}, {seed: placementMap[wSemiResults[0].loser], rosterId: wSemiResults[0].loser}, `Final`);
  }

  // Consolation and losers bracket (approximate logic similar to earlier script)
  // Build wR1Losers (those who lost in first winners round)
  const wR1Losers = wR1Results.map((r) => ({ seed: placementMap[r.loser] ?? null, rosterId: r.loser, winnerSeed: placementMap[r.winner] ?? null, winnerId: r.winner }));
  wR1Losers.sort((a,b) => (a.seed || 999) - (b.seed || 999));

  // consolation R1 pairs from wR1Losers
  const cR1Pairs = [];
  if (wR1Losers.length >= 2) {
    cR1Pairs.push([wR1Losers[0], wR1Losers[wR1Losers.length-1]]);
  }
  if (wR1Losers.length >= 4) {
    cR1Pairs.push([wR1Losers[1], wR1Losers[wR1Losers.length-2]]);
  }
  const cR1Results = [];
  for (const pair of cR1Pairs) {
    if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) {
      debug.push(`Consolation R1 missing -> skipping`);
      cR1Results.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[0]?.rosterId ? pair[1]?.rosterId : pair[0]?.rosterId, reason: 'missing' });
      continue;
    }
    const res = runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}, `Consolation R1`);
    cR1Results.push(res);
  }

  let fifthRes = null, seventhRes = null;
  if (cR1Results.length >= 2) {
    fifthRes = runMatch({seed: placementMap[cR1Results[0].winner], rosterId: cR1Results[0].winner}, {seed: placementMap[cR1Results[1].winner], rosterId: cR1Results[1].winner}, `5th`);
    seventhRes = runMatch({seed: placementMap[cR1Results[0].loser], rosterId: cR1Results[0].loser}, {seed: placementMap[cR1Results[1].loser], rosterId: cR1Results[1].loser}, `7th`);
  }

  // Losers bracket initial pairs: depending on winnersBracketSize we may pair different seeds.
  // For 8-team winners bracket: losers bracket seeds are 9..14 with 13/14 byes first week (as described).
  // For 6-team winners bracket: losers bracket seeds are 7..14 (no byes for 13/14 necessarily).
  // We'll build LRace pairs: [lowest losers seeds pairing scheme from earlier code]
  const losersSeedNums = losersSeeds.map(s => s.seed);
  // build the initial LRace pairing logic (common: pair first of losers vs far opponent)
  const lPairsSeedNums = [];
  if (winnersBracketSize === 6) {
    // when winners size = 6, losers tend to be seeds 7-14. We'll pair 9v12, 10v11 like earlier but ensure valid seeds exist
    lPairsSeedNums.push([9,12]);
    lPairsSeedNums.push([10,11]);
  } else {
    // standard: 9v12, 10v11
    lPairsSeedNums.push([9,12], [10,11]);
  }

  const lR1Results = [];
  // map seed -> roster object for losers race
  const lBySeed = {};
  for (const s of losersSeeds) lBySeed[s.seed] = s;

  for (const [s1,s2] of lPairsSeedNums) {
    const objA = lBySeed[s1] || {seed:s1, rosterId: placementToRoster[s1]};
    const objB = lBySeed[s2] || {seed:s2, rosterId: placementToRoster[s2]};
    if (!objA.rosterId || !objB.rosterId) {
      debug.push(`LRace ${s1}v${s2} -> missing-roster`);
      lR1Results.push({ winner: objA.rosterId || objB.rosterId, loser: objA.rosterId ? objB.rosterId : objA.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: objA.seed, rosterId: objA.rosterId}, {seed: objB.seed, rosterId: objB.rosterId}, `LRace`);
    lR1Results.push(res);
  }

  // LRace semi pairing with byes 13/14 (if present)
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
    const left = pair[0];
    const right = pair[1];
    if (!left || !right || !left.rosterId || !right.rosterId) {
      debug.push(`LRaceSemi ${left?.seed ?? '?'}v${right?.seed ?? '?'} -> missing`);
      lSemiResults.push({ winner: left?.rosterId || right?.rosterId, loser: right?.rosterId || left?.rosterId, reason: 'missing' });
      continue;
    }
    const res = runMatch({seed: left.seed, rosterId: left.rosterId}, {seed: right.seed, rosterId: right.rosterId}, `LRaceSemi`);
    lSemiResults.push(res);
  }

  // 9th final and 11th/13th
  let lFinalRes = null, l11Res = null, l13Res = null;
  if (lWinners.length >= 2) {
    lFinalRes = runMatch({seed: lWinners[0].seed, rosterId: lWinners[0].rosterId}, {seed: lWinners[1].seed, rosterId: lWinners[1].rosterId}, `9th`);
  } else if (lWinners.length === 1) {
    lFinalRes = { winner: lWinners[0].rosterId, loser: null, reason: 'auto' };
    debug.push(`9th auto -> ${placementMap[lWinners[0].rosterId] ?? lWinners[0].rosterId} (single-winner)`);
  }

  if (lSemiResults.length >= 2) {
    const semiWinners = lSemiResults.map(r => ({ rosterId: r.winner, seed: placementMap[r.winner] ?? null }));
    const semiLosers = lSemiResults.map(r => ({ rosterId: r.loser, seed: placementMap[r.loser] ?? null }));

    if (semiWinners.length >= 2) l11Res = runMatch({seed: semiWinners[0].seed, rosterId: semiWinners[0].rosterId}, {seed: semiWinners[1].seed, rosterId: semiWinners[1].rosterId}, `11th`);
    else if (semiWinners.length === 1) {
      l11Res = { winner: semiWinners[0].rosterId, loser: null, reason: 'auto' };
      debug.push(`11th auto -> ${placementMap[semiWinners[0].rosterId] ?? semiWinners[0].rosterId} (single-semi-winner)`);
    }

    if (semiLosers.length >= 2) l13Res = runMatch({seed: semiLosers[0].seed, rosterId: semiLosers[0].rosterId}, {seed: semiLosers[1].seed, rosterId: semiLosers[1].rosterId}, `13th`);
    else if (semiLosers.length === 1) {
      l13Res = { winner: semiLosers[0].rosterId, loser: null, reason: 'auto' };
      debug.push(`13th auto -> ${placementMap[semiLosers[0].rosterId] ?? semiLosers[0].rosterId} (single-semi-loser)`);
    }
  } else if (lSemiResults.length === 1) {
    l11Res = { winner: lSemiResults[0].winner, loser: null, reason: 'only-semi' };
    l13Res = { winner: lSemiResults[0].loser, loser: null, reason: 'only-semi' };
    debug.push(`LRaceSemi single -> 11th ${placementMap[lSemiResults[0].winner] ?? lSemiResults[0].winner} , 13th ${placementMap[lSemiResults[0].loser] ?? lSemiResults[0].loser}`);
  }

  // Build final ordered placement list using all resolved results
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

  // primary final outcomes
  pushResultPair(finalRes);
  pushResultPair(thirdRes);
  pushResultPair(fifthRes);
  pushResultPair(seventhRes);

  // losers bracket outcomes
  pushResultPair(lFinalRes);
  pushResultPair(l11Res);
  pushResultPair(l13Res);

  // include any playoff match rows that include unassigned rosters
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

  // stable reorder fallback & final ranks
  finalStandings.sort((a,b) => {
    if ((a.rank || 0) !== (b.rank || 0)) return (a.rank || 0) - (b.rank || 0);
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    if ((b.pf || 0) !== (a.pf || 0)) return (b.pf || 0) - (a.pf || 0);
    return (a.seed || 999) - (b.seed || 999);
  });
  for (let i = 0; i < finalStandings.length; i++) finalStandings[i].rank = i + 1;

  const champion = finalStandings[0] ?? null;
  const biggestLoser = finalStandings[finalStandings.length - 1] ?? null;

  // compute MVPs using sleeper client helpers (these return objects in the shapes you had)
  let finalsMvp = null;
  let overallMvp = null;
  try {
    finalsMvp = await sleeper.getFinalsMVP(selectedLeagueId, { season: selectedSeasonParam || (leagueMeta && leagueMeta.season) || null, championshipWeek: playoffEnd, maxWeek: playoffEnd, playersEndpoint: '/players/nba' });
    messages.push('Computed finalsMvp via sleeper client.');
  } catch (e) {
    messages.push('Failed computing Finals MVP via client: ' + (e?.message ?? String(e)));
    finalsMvp = null;
  }
  try {
    overallMvp = await sleeper.getOverallMVP(selectedLeagueId, { season: selectedSeasonParam || (leagueMeta && leagueMeta.season) || null, maxWeek: playoffEnd, playersEndpoint: '/players/nba' });
    messages.push('Computed overallMvp via sleeper client.');
  } catch (e) {
    messages.push('Failed computing Overall MVP via client: ' + (e?.message ?? String(e)));
    overallMvp = null;
  }

  // --- SERVER-SIDE player resolution: fetch players map from Sleeper and attach player metadata ---
  async function fetchPlayersMap() {
    try {
      const res = await fetch('https://api.sleeper.app/v1/players/nba');
      if (!res.ok) throw new Error('players endpoint returned ' + res.status);
      const map = await res.json();
      return map;
    } catch (err) {
      return null;
    }
  }

  try {
    const playersMap = await fetchPlayersMap();
    if (playersMap) {
      // normalize final / overall mvp objects with resolved player metadata
      function attachPlayerMetaToMVP(mvpObj) {
        if (!mvpObj) return mvpObj;
        // possible fields: playerId, player_id, topPlayerId, top_player_id, playerName, topPlayerName
        const pid = mvpObj.playerId ?? mvpObj.player_id ?? mvpObj.topPlayerId ?? mvpObj.top_player_id ?? null;
        if (pid && playersMap[pid]) {
          const p = playersMap[pid];
          mvpObj.player_meta = {
            player_id: String(pid),
            full_name: p.full_name ?? (mvpObj.playerName ?? mvpObj.playerObj?.full_name) ?? null,
            first_name: p.first_name ?? null,
            last_name: p.last_name ?? null,
            position: p.position ?? null,
            team: p.team ?? null,
            headshot: `https://sleepercdn.com/content/nba/players/${pid}.jpg`
          };
        } else if (pid) {
          // fallback - create minimal player_meta
          mvpObj.player_meta = {
            player_id: String(pid),
            full_name: mvpObj.playerName ?? mvpObj.playerObj?.full_name ?? null,
            headshot: null
          };
        } else {
          // no explicit player id, but sometimes overallMvp returns topPlayerName or playerObj
          const maybeName = mvpObj.playerName ?? mvpObj.playerObj?.full_name ?? mvpObj.topPlayerName ?? null;
          if (maybeName) mvpObj.player_meta = { full_name: maybeName, headshot: null };
          else mvpObj.player_meta = null;
        }
        return mvpObj;
      }

      finalsMvp = attachPlayerMetaToMVP(finalsMvp);
      overallMvp = attachPlayerMetaToMVP(overallMvp);
    } else {
      messages.push('Players map could not be fetched from Sleeper; MVPs left un-resolved.');
    }
  } catch (err) {
    messages.push('Error resolving player metadata: ' + (err?.message ?? String(err)));
  }

  // If there was owner reparenting in your site-level rules (e.g. Bellooshio->JakePratt),
  // you may want to apply that to finalStandings here as well. (Not changing owners automatically in this file.)

  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    winnersBracketSize,
    seasonJsonLoaded,
    seasonJsonPathsTried,
    matchupsRows,
    regularStandings,
    finalStandings,
    champion,
    biggestLoser,
    finalsMvp,
    overallMvp,
    messages,
    debug,
    prevChain,
    jsonLinks
  };
}
