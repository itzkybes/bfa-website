// src/routes/standings/+page.server.js
// Standings loader using centralized Sleeper client (sleeperClient.js).
// Uses early2023.json overrides for 2023 weeks 1-3 when present.
// Splits computed results into regularStandings and playoffStandings.
// Regular-season stats are strictly taken from weeks 1 .. (playoff_week_start - 1).
// Playoff stats are taken only from the 3-week playoff window: playoff_week_start .. playoff_week_start+2.
// Hardcoded champions for 2022/2023/2024 are still applied.
// Adds maxWinStreak and maxLoseStreak per roster for both regular and playoff standings.

import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { readFile } from 'fs/promises';

let cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) {
    cache = createKVCache(globalThis.KV);
  } else {
    cache = createMemoryCache();
  }
} catch (e) {
  cache = createMemoryCache();
}

const SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
const sleeper = createSleeperClient({ cache: cache, concurrency: SLEEPER_CONCURRENCY });

const BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID)
  ? process.env.BASE_LEAGUE_ID
  : '1219816671624048640';
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// compute streaks from results array (array of 'W'/'L'/'T')
function computeStreaks(resultsArray) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  if (!resultsArray || !Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
  for (let i = 0; i < resultsArray.length; i++) {
    const r = resultsArray[i];
    if (r === 'W') {
      curW += 1; curL = 0; if (curW > maxW) maxW = curW;
    } else if (r === 'L') {
      curL += 1; curW = 0; if (curL > maxL) maxL = curL;
    } else {
      curW = 0; curL = 0;
    }
  }
  return { maxW, maxL };
}

// try to load early2023.json either via fetch (origin) or disk fallback
async function tryLoadEarly2023(origin) {
  // try fetch from origin if available
  if (origin && typeof origin === 'string') {
    try {
      const url = origin.replace(/\/$/, '') + '/early2023.json';
      // use global fetch (works in many runtimes); if not available, will throw
      const res = await fetch(url, { method: 'GET' });
      if (res && res.ok) {
        const txt = await res.text();
        try {
          return JSON.parse(txt);
        } catch (e) {
          // invalid json from remote; fall through to disk fallback
        }
      }
    } catch (e) {
      // ignore and try disk read
    }
  }

  // disk fallback: relative path to static folder
  try {
    const fileUrl = new URL('../../../static/early2023.json', import.meta.url);
    const txt = await readFile(fileUrl, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

// NEW: try to load season_matchups/<season>.json via origin fetch then disk fallback
async function tryLoadSeasonMatchups(season, origin) {
  if (!season) return null;
  // try fetch from origin if available
  if (origin && typeof origin === 'string') {
    try {
      const url = origin.replace(/\/$/, '') + `/season_matchups/${season}.json`;
      const res = await fetch(url, { method: 'GET' });
      if (res && res.ok) {
        const txt = await res.text();
        try {
          return JSON.parse(txt);
        } catch (e) {
          // invalid remote json, fall through to disk fallback
        }
      }
    } catch (e) {
      // ignore and try disk
    }
  }

  // disk fallback: relative path to static folder
  try {
    const fileUrl = new URL(`../../../static/season_matchups/${season}.json`, import.meta.url);
    const txt = await readFile(fileUrl, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

// robust participant points extractor — prefers starters-only values if present
function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== 'object') return 0;

  // common array-key forms for starters points
  const arrayKeys = ['starters_points', 'starter_points', 'startersPoints', 'starterPoints', 'starters_points_list'];
  for (const k of arrayKeys) {
    if (Array.isArray(entry[k]) && entry[k].length) {
      // sum numeric values
      let s = 0;
      for (const v of entry[k]) s += safeNum(v);
      return Math.round(s * 100) / 100;
    }
  }

  // sometimes there's a player -> points mapping with starters list; if found, sum starter ids
  if (Array.isArray(entry.starters) && entry.player_points && typeof entry.player_points === 'object') {
    let s = 0;
    for (const st of entry.starters) {
      const pval = entry.player_points[String(st)] ?? entry.player_points[st];
      s += safeNum(pval);
    }
    return Math.round(s * 100) / 100;
  }

  // some responses include 'starters' array of objects with points
  if (Array.isArray(entry.starters) && entry.starters.length && typeof entry.starters[0] === 'object') {
    let s = 0;
    for (const obj of entry.starters) {
      s += safeNum(obj.points ?? obj.p); // tolerate keys
    }
    return Math.round(s * 100) / 100;
  }

  // fallback to common numeric fields
  const fallback = safeNum(entry.points ?? entry.points_for ?? entry.pts ?? entry.score ?? 0);
  return Math.round(fallback * 100) / 100;
}

export async function load(event) {
  // set CDN caching
  event.setHeaders({
    'cache-control': 's-maxage=120, stale-while-revalidate=300'
  });

  const url = event.url;
  const incomingSeasonParam = url.searchParams.get('season') || null;
  const messages = [];
  const prevChain = [];

  // Build seasons chain via previous_league_id starting from BASE_LEAGUE_ID
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
        season: mainLeague.season || null,
        name: mainLeague.name || null
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
            season: prevLeague.season || null,
            name: prevLeague.name || null
          });
          prevChain.push(String(prevLeague.league_id || currPrev));
          if (prevLeague.previous_league_id) currPrev = String(prevLeague.previous_league_id);
          else currPrev = null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err && err.message ? err.message : String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error while building seasons chain: ' + (err && err.message ? err.message : String(err)));
  }

  // dedupe by league id
  const byId = {};
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);

  // sort by season if available (old -> new)
  seasons.sort(function (a, b) {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  // If no season param provided, default to the latest season (most recent)
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = 'all';
    }
  }

  // choose league ids to process (supports either a specific season value or league_id)
  const leagueIdsToProcess = [];
  if (!selectedSeasonParam || selectedSeasonParam === 'all') {
    if (seasons.length === 0) leagueIdsToProcess.push(BASE_LEAGUE_ID);
    else for (let ii = 0; ii < seasons.length; ii++) leagueIdsToProcess.push(String(seasons[ii].league_id));
  } else {
    let matched = false;
    for (let jj = 0; jj < seasons.length; jj++) {
      if (String(seasons[jj].league_id) === String(selectedSeasonParam)) {
        leagueIdsToProcess.push(String(seasons[jj].league_id));
        matched = true;
        break;
      }
    }
    if (!matched) {
      for (let kk = 0; kk < seasons.length; kk++) {
        if (seasons[kk].season != null && String(seasons[kk].season) === String(selectedSeasonParam)) {
          leagueIdsToProcess.push(String(seasons[kk].league_id));
          matched = true;
          break;
        }
      }
    }
    if (!matched) leagueIdsToProcess.push(String(selectedSeasonParam));
  }

  // compute results per league; produce regularStandings & playoffStandings
  const seasonsResults = [];
  let anyDataFound = false;

  // Hardcoded champions by season-year -> owner username (owner_username)
  const HARDCODED_CHAMPIONS = {
    '2022': 'riguy506',
    '2023': 'armyjunior',
    '2024': 'riguy506'
  };

  // Helper: build roster maps for quick lookups
  function buildRosterLookup(rosterMap) {
    const usernameToRoster = {};
    const ownerNameToRoster = {};
    const teamNameToRoster = {};
    for (const rk in rosterMap) {
      if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
      const meta = rosterMap[rk] || {};
      if (meta.owner_username) usernameToRoster[String(meta.owner_username).toLowerCase()] = String(rk);
      if (meta.owner_name) ownerNameToRoster[String(meta.owner_name).toLowerCase()] = String(rk);
      if (meta.team_name) teamNameToRoster[String(meta.team_name).toLowerCase()] = String(rk);
    }
    return { usernameToRoster, ownerNameToRoster, teamNameToRoster };
  }

  // Process each leagueId selected
  for (let li = 0; li < leagueIdsToProcess.length; li++) {
    const leagueId = leagueIdsToProcess[li];
    try {
      let leagueMeta = null;
      try { leagueMeta = await sleeper.getLeague(leagueId, { ttl: 60 * 5 }); } catch (e) { leagueMeta = null; }

      const leagueSeason = leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null;
      const leagueName = leagueMeta && leagueMeta.name ? leagueMeta.name : null;

      // Get enriched roster map from client
      let rosterMap = {};
      try {
        rosterMap = await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 }) || {};
      } catch (e) {
        rosterMap = {};
      }

      const { usernameToRoster, ownerNameToRoster, teamNameToRoster } = buildRosterLookup(rosterMap);

      // Determine playoff week boundaries (fallback to 15 if missing)
      let playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
      if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
      const playoffEnd = playoffStart + 2;

      // trackers for regular vs playoffs
      const statsByRosterRegular = {}, resultsByRosterRegular = {}, paByRosterRegular = {};
      const statsByRosterPlayoff = {}, resultsByRosterPlayoff = {}, paByRosterPlayoff = {};

      // seed keys from rosterMap if available
      if (rosterMap && Object.keys(rosterMap).length) {
        for (const rk2 in rosterMap) {
          if (!Object.prototype.hasOwnProperty.call(rosterMap, rk2)) continue;
          statsByRosterRegular[String(rk2)] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk2].roster_raw || null };
          resultsByRosterRegular[String(rk2)] = [];
          paByRosterRegular[String(rk2)] = 0;

          statsByRosterPlayoff[String(rk2)] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk2].roster_raw || null };
          resultsByRosterPlayoff[String(rk2)] = [];
          paByRosterPlayoff[String(rk2)] = 0;
        }
      }

      // Try loading early2023.json once per league loop (we'll use it for weeks 1..3 when season === 2023)
      let earlyData = null;
      try {
        if (String(leagueSeason) === '2023') {
          earlyData = await tryLoadEarly2023(url?.origin || null);
          if (!earlyData) messages.push('early2023.json not available for 2023; will use API values.');
          else messages.push('early2023.json loaded for 2023 (override weeks 1-3).');
        }
      } catch (err) {
        earlyData = null;
        messages.push('Error loading early2023.json: ' + (err?.message ?? String(err)));
      }

      // NEW: Try to load season_matchups/<season>.json for 2022/2023/2024 and use it instead of API for that season
      let seasonMatchups = null;
      try {
        if (leagueSeason && ['2022','2023','2024'].includes(String(leagueSeason))) {
          seasonMatchups = await tryLoadSeasonMatchups(String(leagueSeason), url?.origin || null);
          if (seasonMatchups) {
            messages.push(`Loaded static season_matchups/${leagueSeason}.json and will use it for matchup data for season ${leagueSeason}.`);
            // ensure it's an object keyed by week (strings) -> array
            if (typeof seasonMatchups !== 'object' || Array.isArray(seasonMatchups) === true) {
              messages.push(`season_matchups/${leagueSeason}.json loaded but unexpected shape; will fall back to API.`);
              seasonMatchups = null;
            }
          } else {
            messages.push(`season_matchups/${leagueSeason}.json not available; will use API for season ${leagueSeason}.`);
          }
        }
      } catch (err) {
        seasonMatchups = null;
        messages.push('Error loading season_matchups for ' + leagueSeason + ': ' + (err?.message ?? String(err)));
      }

      // weeks loop
      for (let week = 1; week <= MAX_WEEKS; week++) {
        let matchups = null;

        // If static seasonMatchups is present and has entries for this week, use them (transform into the expected "entry" shapes)
        if (seasonMatchups && seasonMatchups[String(week)] && Array.isArray(seasonMatchups[String(week)])) {
          try {
            const arr = seasonMatchups[String(week)];
            const transformed = [];
            for (const m of arr) {
              // m is a matchup object from static JSON (example provided)
              // teamA -> entryA, teamB -> entryB (if present). We put points on 'points' so computeParticipantPoints() falls back to it.
              if (m.teamA) {
                const ridA = (m.teamA.rosterId ?? m.teamA.roster_id ?? m.teamA.roster) != null ? String(m.teamA.rosterId ?? m.teamA.roster_id ?? m.teamA.roster) : null;
                const ptsA = safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? m.teamA?.pts ?? 0);
                const entryA = {
                  matchup_id: m.matchup_id ?? m.matchupId ?? null,
                  week: week,
                  roster_id: ridA,
                  points: ptsA,
                  // carry metadata so we can inject into rosterMap if roster not found
                  __team_name: m.teamA.name ?? null,
                  __owner_name: m.teamA.ownerName ?? null
                };
                transformed.push(entryA);
              }
              if (m.teamB) {
                const ridB = (m.teamB.rosterId ?? m.teamB.roster_id ?? m.teamB.roster) != null ? String(m.teamB.rosterId ?? m.teamB.roster_id ?? m.teamB.roster) : null;
                const ptsB = safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? m.teamB?.pts ?? 0);
                const entryB = {
                  matchup_id: m.matchup_id ?? m.matchupId ?? null,
                  week: week,
                  roster_id: ridB,
                  points: ptsB,
                  __team_name: m.teamB.name ?? null,
                  __owner_name: m.teamB.ownerName ?? null
                };
                transformed.push(entryB);
              }
            }
            matchups = transformed;
          } catch (e) {
            messages.push(`Error transforming static matchups for week ${week} season ${leagueSeason}: ${e?.message ?? String(e)}`);
            matchups = null;
          }
        } else {
          // fallback to API for non-static seasons or missing weeks
          try {
            matchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 }) || [];
          } catch (errWeek) {
            messages.push('Error fetching matchups for league ' + leagueId + ' week ' + week + ' — ' + (errWeek && errWeek.message ? errWeek.message : String(errWeek)));
            continue;
          }
        }

        if (!matchups || !matchups.length) continue;

        const isRegularWeek = (week >= 1 && week < playoffStart);
        const isPlayoffWeek = (week >= playoffStart && week <= playoffEnd);
        if (!isRegularWeek && !isPlayoffWeek) continue;

        const statsByRoster = isPlayoffWeek ? statsByRosterPlayoff : statsByRosterRegular;
        const resultsByRoster = isPlayoffWeek ? resultsByRosterPlayoff : resultsByRosterRegular;
        const paByRoster = isPlayoffWeek ? paByRosterPlayoff : paByRosterRegular;

        // If early override present for this week, build a map from ownerName/teamName -> scores
        let earlyWeekMap = null;
        try {
          if (earlyData && earlyData['2023'] && earlyData['2023'][String(week)] && String(leagueSeason) === '2023' && week >= 1 && week <= 3) {
            earlyWeekMap = {};
            const arr = earlyData['2023'][String(week)];
            for (const e of arr) {
              // normalize fields and index both ownerName and teamName
              const aOwner = (e.teamA && e.teamA.ownerName) ? String(e.teamA.ownerName).toLowerCase() : null;
              const bOwner = (e.teamB && e.teamB.ownerName) ? String(e.teamB.ownerName).toLowerCase() : null;
              const aTeam = (e.teamA && e.teamA.name) ? String(e.teamA.name).toLowerCase() : null;
              const bTeam = (e.teamB && e.teamB.name) ? String(e.teamB.name).toLowerCase() : null;
              const aScore = safeNum(e.teamAScore ?? e.teamA?.score ?? e.teamA?.points ?? 0);
              const bScore = safeNum(e.teamBScore ?? e.teamB?.score ?? e.teamB?.points ?? 0);

              if (aOwner) earlyWeekMap['owner:' + aOwner] = aScore;
              if (aTeam) earlyWeekMap['team:' + aTeam] = aScore;
              if (bOwner) earlyWeekMap['owner:' + bOwner] = bScore;
              if (bTeam) earlyWeekMap['team:' + bTeam] = bScore;
            }
          }
        } catch (e) {
          earlyWeekMap = null;
          messages.push('Failed building earlyWeekMap week ' + week + ': ' + (e?.message ?? e));
        }

        // group entries by matchup id and process as earlier logic
        const byMatch = {};
        for (let mi = 0; mi < matchups.length; mi++) {
          const entry = matchups[mi];
          // If this entry came from static season JSON we included __team_name / __owner_name
          // If rosterMap doesn't have metadata for this roster, inject it so buildStandings can show the correct name.
          const possibleRid = entry.roster_id ?? entry.rosterId ?? entry.owner_id ?? entry.ownerId ?? null;
          const pidStrMeta = possibleRid != null ? String(possibleRid) : null;
          if (pidStrMeta) {
            if (!rosterMap[pidStrMeta]) {
              // inject minimal meta from static file entries (if present)
              const tname = entry.__team_name ?? entry.team_name ?? null;
              const oname = entry.__owner_name ?? entry.owner_name ?? null;
              if (tname || oname) {
                rosterMap[pidStrMeta] = rosterMap[pidStrMeta] || {
                  team_name: tname || null,
                  owner_name: oname || null,
                  team_avatar: null,
                  owner_avatar: null,
                  owner_username: null,
                  owner_id: null,
                  roster_raw: null
                };
              }
            }
          }

          const mid = entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? null;
          const wk = entry.week ?? entry.w ?? week;
          const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(entry);
        }

        const mids = Object.keys(byMatch);
        for (let mii = 0; mii < mids.length; mii++) {
          const mid = mids[mii];
          const entries = byMatch[mid];
          if (!entries || entries.length === 0) continue;

          if (entries.length === 1) {
            // single participant: attribute pf but no opponent to compare
            const only = entries[0];
            const ridOnly = only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId;
            const keyRid = String(ridOnly);
            paByRoster[keyRid] = paByRoster[keyRid] || 0;
            resultsByRoster[keyRid] = resultsByRoster[keyRid] || [];
            statsByRoster[keyRid] = statsByRoster[keyRid] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };

            // ensure roster metadata is present if the entry carried it
            if ((only.__team_name || only.__owner_name) && (!rosterMap[String(ridOnly)])) {
              rosterMap[String(ridOnly)] = rosterMap[String(ridOnly)] || { team_name: only.__team_name || null, owner_name: only.__owner_name || null, team_avatar: null, owner_avatar: null, owner_username: null, owner_id: null, roster_raw: null };
            }

            // determine points — prefer early override if available
            let ptsOnly = null;
            try {
              if (earlyWeekMap) {
                // try to resolve owner/team for this roster
                const meta = rosterMap[String(ridOnly)] || {};
                const ownerLow = (meta.owner_name || meta.owner_username) ? String((meta.owner_name || meta.owner_username)).toLowerCase() : null;
                const teamLow = meta.team_name ? String(meta.team_name).toLowerCase() : null;
                if (ownerLow && earlyWeekMap['owner:' + ownerLow] != null) ptsOnly = earlyWeekMap['owner:' + ownerLow];
                else if (teamLow && earlyWeekMap['team:' + teamLow] != null) ptsOnly = earlyWeekMap['team:' + teamLow];
              }
            } catch (e) {
              ptsOnly = null;
            }
            if (ptsOnly == null) ptsOnly = computeParticipantPoints(only);
            statsByRoster[keyRid].pf += ptsOnly;
            continue;
          }

          // multi-participant group (normally 2 for head-to-head)
          const participants = [];
          for (let e = 0; e < entries.length; e++) {
            const en = entries[e];
            const pid = en.roster_id ?? en.rosterId ?? en.owner_id ?? en.ownerId;
            const pidStr = String(pid);
            // compute ppts - but allow early overrides
            let ppts = null;

            // If static entry included __team_name/__owner_name and rosterMap lacks metadata, inject it
            if ((en.__team_name || en.__owner_name) && !rosterMap[pidStr]) {
              rosterMap[pidStr] = rosterMap[pidStr] || { team_name: en.__team_name || null, owner_name: en.__owner_name || null, team_avatar: null, owner_avatar: null, owner_username: null, owner_id: null, roster_raw: null };
            }

            if (earlyWeekMap) {
              try {
                const meta = rosterMap[pidStr] || {};
                const ownerLow = (meta.owner_name || meta.owner_username) ? String((meta.owner_name || meta.owner_username)).toLowerCase() : null;
                const teamLow = meta.team_name ? String(meta.team_name).toLowerCase() : null;
                if (ownerLow && earlyWeekMap['owner:' + ownerLow] != null) ppts = earlyWeekMap['owner:' + ownerLow];
                else if (teamLow && earlyWeekMap['team:' + teamLow] != null) ppts = earlyWeekMap['team:' + teamLow];
              } catch (e) {
                ppts = null;
              }
            }
            if (ppts == null) {
              ppts = computeParticipantPoints(en);
            }

            participants.push({ rosterId: String(pid), points: ppts, __entry: en });
            paByRoster[String(pid)] = paByRoster[String(pid)] || 0;
            resultsByRoster[String(pid)] = resultsByRoster[String(pid)] || [];
            statsByRoster[String(pid)] = statsByRoster[String(pid)] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
            // if rosterMap lacks metadata, ensure it was injected above; statsByRoster will show roster via buildStandings fallback
            statsByRoster[String(pid)].pf += ppts;
          }

          // compare vs opponents average (multi-team logic)
          for (let pi = 0; pi < participants.length; pi++) {
            const part = participants[pi];
            const opponents = [];
            for (let oi = 0; oi < participants.length; oi++) {
              if (oi === pi) continue;
              opponents.push(participants[oi]);
            }
            let oppAvg = 0;
            if (opponents.length) {
              for (let oa = 0; oa < opponents.length; oa++) oppAvg += opponents[oa].points;
              oppAvg = oppAvg / opponents.length;
            }
            paByRoster[part.rosterId] = paByRoster[part.rosterId] || 0;
            paByRoster[part.rosterId] += oppAvg;
            if (part.points > oppAvg + 1e-9) { resultsByRoster[part.rosterId].push('W'); statsByRoster[part.rosterId].wins += 1; }
            else if (part.points < oppAvg - 1e-9) { resultsByRoster[part.rosterId].push('L'); statsByRoster[part.rosterId].losses += 1; }
            else { resultsByRoster[part.rosterId].push('T'); statsByRoster[part.rosterId].ties += 1; }
          }
        }
      } // end weeks loop

      // build standings helper (unchanged logic, uses resultsByRoster and statsByRoster)
      function buildStandings(statsByRoster, resultsByRoster, paByRoster) {
        const standings = [];
        let iterationKeys = Object.keys(resultsByRoster);
        if (iterationKeys.length === 0 && rosterMap && Object.keys(rosterMap).length) iterationKeys = Object.keys(rosterMap);

        for (let idx = 0; idx < iterationKeys.length; idx++) {
          const ridK = iterationKeys[idx];
          if (!Object.prototype.hasOwnProperty.call(statsByRoster, ridK)) {
            statsByRoster[ridK] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: (rosterMap && rosterMap[ridK] ? rosterMap[ridK].roster_raw : null) };
          }
          const s = statsByRoster[ridK];
          const wins = s.wins || 0;
          const losses = s.losses || 0;
          const ties = s.ties || 0;
          const pfVal = Math.round((s.pf || 0) * 100) / 100;
          const paVal = Math.round((paByRoster[ridK] || s.pa || 0) * 100) / 100;

          const meta = (rosterMap && rosterMap[ridK]) ? rosterMap[ridK] : {};
          const team_name = meta.team_name ? meta.team_name : ((s.roster && s.roster.metadata && s.roster.metadata.team_name) ? s.roster.metadata.team_name : ('Roster ' + ridK));
          const owner_name = meta.owner_name || null;
          const team_avatar = meta.team_avatar || null;
          const owner_avatar = meta.owner_avatar || null;
          const avatar = team_avatar || owner_avatar || null;

          // compute streaks from resultsByRoster
          const resArr = resultsByRoster && resultsByRoster[ridK] ? resultsByRoster[ridK] : [];
          const streaks = computeStreaks(resArr);

          standings.push({
            rosterId: ridK,
            owner_id: meta.owner_id || null,
            team_name: team_name,
            owner_name: owner_name,
            avatar: avatar,
            wins: wins,
            losses: losses,
            ties: ties,
            pf: pfVal,
            pa: paVal,
            champion: false,
            maxWinStreak: streaks.maxW,
            maxLoseStreak: streaks.maxL
          });
        }

        standings.sort(function (a, b) {
          if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
          return (b.pf || 0) - (a.pf || 0);
        });

        return standings;
      }

      const regularStandings = buildStandings(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular);
      const playoffStandings = buildStandings(statsByRosterPlayoff, resultsByRosterPlayoff, paByRosterPlayoff);

      // Hardcoded champion overrides
      try {
        if (leagueSeason != null) {
          const seasonKey = String(leagueSeason);
          if (HARDCODED_CHAMPIONS.hasOwnProperty(seasonKey)) {
            const championOwner = String(HARDCODED_CHAMPIONS[seasonKey]);
            const low = championOwner.toLowerCase();
            let rosterId = null;
            if (usernameToRoster[low]) rosterId = usernameToRoster[low];
            else if (ownerNameToRoster[low]) rosterId = ownerNameToRoster[low];
            if (rosterId) {
              const matchingRow = (playoffStandings || []).find(function(r) { return String(r.rosterId) === String(rosterId); });
              if (matchingRow) {
                matchingRow.champion = true;
                messages.push('Hardcoded champion applied for season ' + seasonKey + ': owner "' + championOwner + '" -> roster ' + rosterId);
              } else {
                messages.push('Hardcoded champion owner "' + championOwner + '" mapped to roster ' + rosterId + ' but roster not present in playoffStandings for season ' + seasonKey + '.');
              }
            } else {
              messages.push('Hardcoded champion owner "' + championOwner + '" could not be mapped to a roster for season ' + seasonKey + '.');
            }
          }
        }
      } catch (hcErr) {
        messages.push('Error applying hardcoded champion for league ' + leagueId + ' — ' + (hcErr && hcErr.message ? hcErr.message : String(hcErr)));
      }

      if ((regularStandings && regularStandings.length) || (playoffStandings && playoffStandings.length)) anyDataFound = true;

      seasonsResults.push({
        leagueId: String(leagueId),
        season: leagueSeason,
        leagueName: leagueName,
        regularStandings: regularStandings,
        playoffStandings: playoffStandings
      });
    } catch (err) {
      messages.push('Error processing league ' + leagueId + ' — ' + (err && err.message ? err.message : String(err)));
      seasonsResults.push({ leagueId: String(leagueId), error: (err && err.message ? err.message : String(err)) });
    }
  } // end league loop

  if (!anyDataFound && messages.length === 0) messages.push('No data found for requested seasons.');

  const finalError = !anyDataFound ? 'No roster/matchup data found for requested seasons. Details: ' + (messages.length ? messages.join(' | ') : 'no details') : null;

  return {
    seasons: seasons,
    selectedSeason: selectedSeasonParam,
    seasonsResults: seasonsResults,
    error: finalError,
    messages: messages,
    prevChain: prevChain
  };
}
