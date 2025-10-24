// src/routes/matchups/+page.server.js
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

const BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID) ? process.env.BASE_LEAGUE_ID : '1219816671624048640';
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const incomingSeasonParam = url.searchParams.get('season') || null;
  const incomingWeekParam = url.searchParams.get('week') || null;
  const messages = [];
  const prevChain = [];

  // --- build seasons chain (same pattern used elsewhere) ---
  const seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) {
      messages.push('Failed fetching base league: ' + (e && e.message ? e.message : e));
    }
    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id || BASE_LEAGUE_ID), season: mainLeague.season || null, name: mainLeague.name || null });
      prevChain.push(String(mainLeague.league_id || BASE_LEAGUE_ID));
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) { messages.push('Could not fetch previous_league_id ' + currPrev); break; }
          seasons.push({ league_id: String(prevLeague.league_id || currPrev), season: prevLeague.season || null, name: prevLeague.name || null });
          prevChain.push(String(prevLeague.league_id || currPrev));
          currPrev = prevLeague.previous_league_id ? String(prevLeague.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err && err.message ? err.message : err));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error building seasons chain: ' + (err && err.message ? err.message : err));
  }

  // dedupe & sort seasons (old -> new)
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = s;
  const seasonsDedup = Object.keys(byId).map(k => byId[k]);
  seasonsDedup.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : 1;
  });

  // determine league to process (support season year or league id)
  let leagueIdToProcess = null;
  if (!incomingSeasonParam || incomingSeasonParam === 'current' || incomingSeasonParam === 'all') {
    if (!seasonsDedup.length) leagueIdToProcess = BASE_LEAGUE_ID;
    else leagueIdToProcess = String(seasonsDedup[seasonsDedup.length - 1].league_id);
  } else {
    let matched = false;
    for (const s of seasonsDedup) {
      if (String(s.league_id) === String(incomingSeasonParam)) { leagueIdToProcess = String(s.league_id); matched = true; break; }
    }
    if (!matched) {
      for (const s of seasonsDedup) {
        if (s.season != null && String(s.season) === String(incomingSeasonParam)) { leagueIdToProcess = String(s.league_id); matched = true; break; }
      }
    }
    if (!matched) leagueIdToProcess = String(incomingSeasonParam);
  }

  // chosen week: default to 1 if not provided (user requested week selector to start at 1)
  const selectedWeek = Number(incomingWeekParam ? incomingWeekParam : 1);

  // fetch league meta (to determine playoff boundaries)
  let leagueMeta = null;
  try {
    leagueMeta = await sleeper.getLeague(leagueIdToProcess, { ttl: 60 * 5 });
  } catch (e) {
    messages.push('Failed to fetch league meta for ' + leagueIdToProcess + ' — ' + (e && e.message ? e.message : e));
  }

  let playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  const playoffEnd = playoffStart + 2;

  // fetch roster map once to enrich participant entries
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(leagueIdToProcess, { ttl: 60 * 5 });
  } catch (e) {
    // non-fatal; we will still render names from participant data if present
    messages.push('Failed to fetch roster map: ' + (e && e.message ? e.message : e));
    rosterMap = {};
  }

  // main: gather matchups for all weeks 1..MAX_WEEKS using new client method
  const matchupsRows = [];
  const seenWeeks = new Set();

  for (let week = 1; week <= MAX_WEEKS; week++) {
    try {
      // this returns an array of { week, participants: [...] } groups for that week
      const groups = await sleeper.getMatchupScoresForWeek(leagueIdToProcess, week, { ttl: 60 * 3, rosterTtl: 60 * 5 }).catch(err => {
        messages.push(`week ${week} fetch error: ${err && err.message ? err.message : String(err)}`);
        return [];
      });

      if (!Array.isArray(groups) || groups.length === 0) continue;

      seenWeeks.add(week);

      for (const grp of groups) {
        const wk = grp.week ?? week;
        const participants = Array.isArray(grp.participants) ? grp.participants : [];
        // ensure participants have matchup_id (string) — the client attaches it
        // Group participants by matchup_id to pair opponents
        const byMid = {};
        for (const p of participants) {
          const mid = (p.matchup_id != null) ? String(p.matchup_id) : ('auto|' + String(wk));
          if (!byMid[mid]) byMid[mid] = [];
          byMid[mid].push(p);
        }

        // For each matchup id group create rows
        for (const midKey of Object.keys(byMid)) {
          const partArr = byMid[midKey] || [];
          if (partArr.length === 0) continue;

          if (partArr.length === 1) {
            // Single participant vs bye / no-op — render a single-vs-bye row
            const a = partArr[0];
            const teamA = {
              name: a.team_name || (a.raw && (a.raw.team_name || a.raw.team) ) || ('Roster ' + (a.roster_id || '')),
              ownerName: a.owner_name || (a.raw && (a.raw.owner_name || a.raw.owner) ) || null,
              avatar: a.team_avatar || a.owner_avatar || (a.raw && (a.raw.team_avatar || a.raw.owner_avatar)) || null,
              points: safeNum(a.score ?? a.points ?? a.raw?.points ?? 0),
              rosterId: a.roster_id || null
            };

            const teamB = {
              name: 'Bye',
              ownerName: null,
              avatar: null,
              points: null,
              rosterId: null
            };

            matchupsRows.push({
              week: wk,
              participantsCount: 1,
              matchup_id: midKey,
              teamA,
              teamB,
              season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null
            });
          } else if (partArr.length === 2) {
            // head-to-head (standard)
            const p0 = partArr[0];
            const p1 = partArr[1];

            const Apts = safeNum(p0.score ?? p0.points ?? p0.raw?.points ?? 0);
            const Bpts = safeNum(p1.score ?? p1.points ?? p1.raw?.points ?? 0);

            const teamA = {
              name: p0.team_name || (p0.raw && (p0.raw.team_name || p0.raw.team)) || ('Roster ' + (p0.roster_id || '')),
              ownerName: p0.owner_name || (p0.raw && (p0.raw.owner_name || p0.raw.owner)) || null,
              avatar: p0.team_avatar || p0.owner_avatar || (p0.raw && (p0.raw.team_avatar || p0.raw.owner_avatar)) || null,
              points: Apts,
              rosterId: p0.roster_id || null,
              matchup_id: p0.matchup_id != null ? String(p0.matchup_id) : midKey
            };
            const teamB = {
              name: p1.team_name || (p1.raw && (p1.raw.team_name || p1.raw.team)) || ('Roster ' + (p1.roster_id || '')),
              ownerName: p1.owner_name || (p1.raw && (p1.raw.owner_name || p1.raw.owner)) || null,
              avatar: p1.team_avatar || p1.owner_avatar || (p1.raw && (p1.raw.team_avatar || p1.raw.owner_avatar)) || null,
              points: Bpts,
              rosterId: p1.roster_id || null,
              matchup_id: p1.matchup_id != null ? String(p1.matchup_id) : midKey
            };

            matchupsRows.push({
              week: wk,
              participantsCount: 2,
              matchup_id: midKey,
              teamA,
              teamB,
              season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
              rawParticipants: partArr
            });
          } else {
            // multi-team matchup: collect combinedParticipants and the winning points
            const combinedParticipants = partArr.map(p => {
              return {
                name: p.team_name || (p.raw && (p.raw.team_name || p.raw.team)) || ('Roster ' + (p.roster_id || '')),
                ownerName: p.owner_name || (p.raw && (p.raw.owner_name || p.raw.owner)) || null,
                avatar: p.team_avatar || p.owner_avatar || (p.raw && (p.raw.team_avatar || p.raw.owner_avatar)) || null,
                points: safeNum(p.score ?? p.points ?? p.raw?.points ?? 0),
                rosterId: p.roster_id || null,
                matchup_id: p.matchup_id != null ? String(p.matchup_id) : midKey
              };
            });

            let combinedWinnerPoints = null;
            if (combinedParticipants.length) {
              combinedWinnerPoints = Math.max(...combinedParticipants.map(cp => safeNum(cp.points)));
            }

            matchupsRows.push({
              week: wk,
              participantsCount: combinedParticipants.length,
              matchup_id: midKey,
              combinedParticipants,
              combinedWinnerPoints,
              season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
              rawParticipants: partArr
            });
          }
        } // end byMid loop
      } // end groups loop
    } catch (err) {
      messages.push('Error processing week ' + week + ': ' + (err && err.message ? err.message : String(err)));
      // continue to next week
    }
  } // end weeks

  // Build weeks array and weekOptions (regular vs playoff)
  const weeksArr = Array.from(seenWeeks).sort((a,b) => a - b);
  const weekOptions = { regular: [], playoffs: [] };
  for (const w of weeksArr) {
    if (w >= playoffStart && w <= playoffEnd) weekOptions.playoffs.push(w);
    else if (w >= 1 && w < playoffStart) weekOptions.regular.push(w);
  }
  const playoffWeeks = weekOptions.playoffs.slice();

  // build simple matchupsRows ordering: sort by week ascending, then by matchup_id
  matchupsRows.sort((a, b) => {
    if ((a.week || 0) !== (b.week || 0)) return (a.week || 0) - (b.week || 0);
    if (a.matchup_id && b.matchup_id) return String(a.matchup_id).localeCompare(String(b.matchup_id));
    return 0;
  });

  // return payload similar shape expected by the front-end page
  return {
    seasons: seasonsDedup,
    selectedSeason: incomingSeasonParam || (seasonsDedup.length ? (seasonsDedup[seasonsDedup.length - 1].season ?? seasonsDedup[seasonsDedup.length - 1].league_id) : null),
    weeks: weeksArr,
    weekOptions,
    playoffWeeks,
    selectedWeek,
    matchupsRows,
    messages,
    originalRecords: {}, // kept for compatibility; pages can fill if they need
    prevChain
  };
}
