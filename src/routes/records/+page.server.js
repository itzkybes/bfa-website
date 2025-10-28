// src/routes/standings/+page.server.js
// Standings loader using centralized Sleeper client (sleeperClient.js).
// Uses early2023.json overrides for 2023 weeks 1-3 when present.
// Also loads season_matchups/<year>.json for 2022/2023/2024 (fetch origin -> disk fallback).
// If season_matchups JSON exists for a given season, matchups for that season are taken
// from the JSON instead of the API.
// Splits computed results into regularStandings and playoffStandings.
// Regular-season stats are strictly taken from weeks 1 .. (playoff_week_start - 1).
// Playoff stats are taken only from the 3-week playoff window: playoff_week_start .. playoff_week_start+2.
// Hardcoded champions for 2022/2023/2024 are still applied.
// Adds maxWinStreak and maxLoseStreak per roster for both regular and playoff standings.
// Also aggregates all seasons into aggregatedRegular and aggregatedPlayoff on the server
// and returns jsonLinks for debug.

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

// Years to attempt to load season_matchups for (change as desired)
const SEASON_MATCHUP_YEARS = [2022, 2023, 2024];

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

// try to load season_matchups/<year>.json either via fetch (origin) or disk fallback.
// returns a map year -> parsed object (or null if not found). also returns jsonLinks (urls used)
async function tryLoadSeasonMatchups(years, origin) {
  const resultMap = {};
  const jsonLinks = [];
  for (const y of years) {
    let loaded = null;

    // try fetch first
    if (origin && typeof origin === 'string') {
      try {
        const url = origin.replace(/\/$/, '') + `/season_matchups/${String(y)}.json`;
        const res = await fetch(url, { method: 'GET' });
        if (res && res.ok) {
          const txt = await res.text();
          try {
            loaded = JSON.parse(txt);
            jsonLinks.push(url);
          } catch (e) {
            loaded = null;
          }
        }
      } catch (e) {
        loaded = null;
      }
    }

    if (!loaded) {
      // disk fallback
      try {
        const fileUrl = new URL(`../../../static/season_matchups/${String(y)}.json`, import.meta.url);
        const txt = await readFile(fileUrl, 'utf8');
        loaded = JSON.parse(txt);
        // construct a pseudo-url for debugging (relative)
        jsonLinks.push(`/season_matchups/${String(y)}.json`);
      } catch (e) {
        loaded = null;
      }
    }

    if (loaded) resultMap[String(y)] = loaded;
  }
  return { map: resultMap, jsonLinks };
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
  const origin = url?.origin || null;
  const incomingSeasonParam = url.searchParams.get('season') || null;
  const messages = [];
  const prevChain = [];

  // Preload season_matchups JSON map (server-side)
  let seasonMatchupsMap = {};
  let jsonLinks = [];
  try {
    const loaded = await tryLoadSeasonMatchups(SEASON_MATCHUP_YEARS, origin);
    if (loaded && loaded.map) seasonMatchupsMap = loaded.map;
    if (loaded && Array.isArray(loaded.jsonLinks)) jsonLinks = loaded.jsonLinks;
    if (!Object.keys(seasonMatchupsMap).length) {
      messages.push('No season_matchups JSON files found (server attempted years: ' + SEASON_MATCHUP_YEARS.join(', ') + ').');
    } else {
      messages.push('Loaded season_matchups JSON for years: ' + Object.keys(seasonMatchupsMap).join(', ') + '.');
    }
  } catch (e) {
    messages.push('Error loading season_matchups JSON: ' + (e?.message ?? String(e)));
    seasonMatchupsMap = {};
  }

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

  // Helper: build standings from maps (same logic as previous)
  function buildStandingsFromMaps(statsByRoster, resultsByRoster, paByRoster, rosterMap) {
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

  // Process each leagueId selected
  for (let li = 0; li < leagueIdsToProcess.length; li++) {
    const leagueId = leagueIdsToProcess[li];
    try {
      let leagueMeta = null;
      try { leagueMeta = await sleeper.getLeague(leagueId, { ttl: 60 * 5 }); } catch (e) { leagueMeta = null; }

      const leagueSeason = leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null;
      const leagueName = leagueMeta && leagueMeta.name ? leagueMeta.name : null;

      // Get enriched roster map from client (still useful to map avatars / owner names if available)
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
          earlyData = await tryLoadEarly2023(origin);
          if (!earlyData) messages.push('early2023.json not available for 2023; will use API values.');
        }
      } catch (err) {
        earlyData = null;
        messages.push('Error loading early2023.json: ' + (err?.message ?? String(err)));
      }

      // If we have season_matchups JSON for this season, use it instead of API matchups
      const seasonMatchupsForLeague = (leagueSeason && seasonMatchupsMap[String(leagueSeason)]) ? seasonMatchupsMap[String(leagueSeason)] : null;
      if (seasonMatchupsForLeague) {
        messages.push(`Using season_matchups JSON for season ${String(leagueSeason)} (server).`);
      }

      // weeks loop
      for (let week = 1; week <= MAX_WEEKS; week++) {
        let matchups = null;
        let isFromSeasonJSON = false;

        if (seasonMatchupsForLeague) {
          // seasonMatchupsForLeague object keyed by week strings -> arrays of matchup objects (sample provided by user)
          try {
            matchups = seasonMatchupsForLeague[String(week)] || [];
            isFromSeasonJSON = true;
          } catch (e) {
            matchups = [];
            isFromSeasonJSON = true;
          }
        } else {
          // fallback to API
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

        // If matchups are from season JSON, they come in the format the user supplied:
        // array of objects having teamA/teamB/teamAScore/teamBScore (or single participant entries)
        if (isFromSeasonJSON) {
          for (const m of matchups) {
            try {
              const a = m.teamA ?? m.teamA ?? m.team ?? null;
              const b = m.teamB ?? null;

              if (a && b) {
                const ridA = a.rosterId ?? a.roster_id ?? a.id ?? null;
                const ridB = b.rosterId ?? b.roster_id ?? b.id ?? null;
                if (ridA == null && ridB == null) continue;
                const pidA = String(ridA);
                const pidB = String(ridB);
                const ptsA = safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? m.points ?? 0);
                const ptsB = safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? 0);

                // ensure initial state
                paByRoster[pidA] = paByRoster[pidA] || 0;
                paByRoster[pidB] = paByRoster[pidB] || 0;
                resultsByRoster[pidA] = resultsByRoster[pidA] || [];
                resultsByRoster[pidB] = resultsByRoster[pidB] || [];
                statsByRoster[pidA] = statsByRoster[pidA] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
                statsByRoster[pidB] = statsByRoster[pidB] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };

                // compute pf
                statsByRoster[pidA].pf += ptsA;
                statsByRoster[pidB].pf += ptsB;

                // opponent average is simply the other participant's points for head-to-head
                const oppAvgA = ptsB;
                const oppAvgB = ptsA;
                paByRoster[pidA] += oppAvgA;
                paByRoster[pidB] += oppAvgB;

                if (ptsA > oppAvgA + 1e-9) { resultsByRoster[pidA].push('W'); statsByRoster[pidA].wins += 1; }
                else if (ptsA < oppAvgA - 1e-9) { resultsByRoster[pidA].push('L'); statsByRoster[pidA].losses += 1; }
                else { resultsByRoster[pidA].push('T'); statsByRoster[pidA].ties += 1; }

                if (ptsB > oppAvgB + 1e-9) { resultsByRoster[pidB].push('W'); statsByRoster[pidB].wins += 1; }
                else if (ptsB < oppAvgB - 1e-9) { resultsByRoster[pidB].push('L'); statsByRoster[pidB].losses += 1; }
                else { resultsByRoster[pidB].push('T'); statsByRoster[pidB].ties += 1; }

                // store roster metadata in stats.roster for later display if not present
                if (!statsByRoster[pidA].roster) statsByRoster[pidA].roster = { metadata: { team_name: a.name ?? null } };
                if (!statsByRoster[pidB].roster) statsByRoster[pidB].roster = { metadata: { team_name: b.name ?? null } };
              } else if (a) {
                // single participant: attribute pf but no opponent to compare
                const ridOnly = a.rosterId ?? a.roster_id ?? a.id ?? null;
                if (ridOnly == null) continue;
                const keyRid = String(ridOnly);
                const ptsOnly = safeNum(m.teamAScore ?? m.teamA?.score ?? m.points ?? 0);
                paByRoster[keyRid] = paByRoster[keyRid] || 0;
                resultsByRoster[keyRid] = resultsByRoster[keyRid] || [];
                statsByRoster[keyRid] = statsByRoster[keyRid] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
                statsByRoster[keyRid].pf += ptsOnly;
                if (!statsByRoster[keyRid].roster) statsByRoster[keyRid].roster = { metadata: { team_name: a.name ?? null } };
              }
            } catch (e) {
              messages.push('Error processing season JSON matchup week ' + week + ' for league ' + leagueId + ': ' + (e?.message ?? String(e)));
              continue;
            }
          } // end loop over matchups from JSON

          continue; // skip the API-style grouping below since we've handled JSON
        }

        // --- legacy/API-style processing (unchanged) ---
        // group entries by matchup id and process as earlier logic
        const byMatch = {};
        for (let mi = 0; mi < matchups.length; mi++) {
          const entry = matchups[mi];
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

            // determine points — prefer early override if available
            let ptsOnly = null;
            try {
              if (earlyData) {
                // try to resolve owner/team for this roster (only for 2023 early override)
                const meta = rosterMap[String(ridOnly)] || {};
                const ownerLow = (meta.owner_name || meta.owner_username) ? String((meta.owner_name || meta.owner_username)).toLowerCase() : null;
                const teamLow = meta.team_name ? String(meta.team_name).toLowerCase() : null;
                if (ownerLow && earlyData['2023'] && earlyData['2023'][String(week)]) {
                  const arr = earlyData['2023'][String(week)];
                  // attempt to find matching entry
                  const found = (arr || []).find(e => (e.teamA && e.teamA.ownerName && String(e.teamA.ownerName).toLowerCase() === ownerLow) || (e.teamB && e.teamB.ownerName && String(e.teamB.ownerName).toLowerCase() === ownerLow) || (e.teamA && e.teamA.name && String(e.teamA.name).toLowerCase() === teamLow) || (e.teamB && e.teamB.name && String(e.teamB.name).toLowerCase() === teamLow));
                  if (found) {
                    if (found.teamA && found.teamA.ownerName && String(found.teamA.ownerName).toLowerCase() === ownerLow) ptsOnly = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                    else if (found.teamB && found.teamB.ownerName && String(found.teamB.ownerName).toLowerCase() === ownerLow) ptsOnly = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                    else if (found.teamA && found.teamA.name && String(found.teamA.name).toLowerCase() === teamLow) ptsOnly = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                    else if (found.teamB && found.teamB.name && String(found.teamB.name).toLowerCase() === teamLow) ptsOnly = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                  }
                }
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
            if (earlyData) {
              try {
                const meta = rosterMap[pidStr] || {};
                const ownerLow = (meta.owner_name || meta.owner_username) ? String((meta.owner_name || meta.owner_username)).toLowerCase() : null;
                const teamLow = meta.team_name ? String(meta.team_name).toLowerCase() : null;
                if (ownerLow && earlyData['2023'] && earlyData['2023'][String(week)]) {
                  const arr = earlyData['2023'][String(week)];
                  const found = (arr || []).find(e2 => (e2.teamA && e2.teamA.ownerName && String(e2.teamA.ownerName).toLowerCase() === ownerLow) || (e2.teamB && e2.teamB.ownerName && String(e2.teamB.ownerName).toLowerCase() === ownerLow) || (e2.teamA && e2.teamA.name && String(e2.teamA.name).toLowerCase() === teamLow) || (e2.teamB && e2.teamB.name && String(e2.teamB.name).toLowerCase() === teamLow));
                  if (found) {
                    if (found.teamA && found.teamA.ownerName && String(found.teamA.ownerName).toLowerCase() === ownerLow) ppts = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                    else if (found.teamB && found.teamB.ownerName && String(found.teamB.ownerName).toLowerCase() === ownerLow) ppts = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                    else if (found.teamA && found.teamA.name && String(found.teamA.name).toLowerCase() === teamLow) ppts = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                    else if (found.teamB && found.teamB.name && String(found.teamB.name).toLowerCase() === teamLow) ppts = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                  }
                }
              } catch (e) {
                ppts = null;
              }
            }
            if (ppts == null) {
              ppts = computeParticipantPoints(en);
            }

            participants.push({ rosterId: String(pid), points: ppts });
            paByRoster[String(pid)] = paByRoster[String(pid)] || 0;
            resultsByRoster[String(pid)] = resultsByRoster[String(pid)] || [];
            statsByRoster[String(pid)] = statsByRoster[String(pid)] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
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
      const regularStandings = buildStandingsFromMaps(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular, rosterMap);
      const playoffStandings = buildStandingsFromMaps(statsByRosterPlayoff, resultsByRosterPlayoff, paByRosterPlayoff, rosterMap);

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

  // -----------------------
  // Aggregate all seasons into aggregatedRegular / aggregatedPlayoff on the server
  // -----------------------
  function aggregateStandingsList(list, map) {
    if (!list || !Array.isArray(list)) return;
    for (const row of list) {
      if (!row) continue;
      // choose a stable key: prefer rosterId, then owner_id, then team_name
      let key = row.rosterId ?? row.roster_id ?? row.owner_id ?? null;
      if (!key) {
        key = (row.team_name ? ('team:' + String(row.team_name).toLowerCase()) : null);
      } else {
        key = String(key);
      }
      if (!key) continue;

      if (!map[key]) {
        map[key] = {
          rosterId: row.rosterId ?? row.roster_id ?? null,
          team_name: row.team_name ?? null,
          owner_name: row.owner_name ?? null,
          avatar: row.avatar ?? null,
          wins: 0,
          losses: 0,
          ties: 0,
          pf: 0,
          pa: 0,
          maxWinStreak: 0,
          maxLoseStreak: 0,
          seasonsCount: 0,
          championCount: 0
        };
      }

      const dest = map[key];
      dest.wins += Number(row.wins || 0);
      dest.losses += Number(row.losses || 0);
      dest.ties += Number(row.ties || 0);
      dest.pf += Number(row.pf || 0);
      dest.pa += Number(row.pa || 0);

      // keep latest display fields if present
      if (row.team_name) dest.team_name = row.team_name;
      if (row.owner_name) dest.owner_name = row.owner_name;
      if (row.avatar) dest.avatar = row.avatar;

      // max streaks (take the maximum observed)
      dest.maxWinStreak = Math.max(dest.maxWinStreak || 0, Number(row.maxWinStreak || 0));
      dest.maxLoseStreak = Math.max(dest.maxLoseStreak || 0, Number(row.maxLoseStreak || 0));

      // champion
      if (row.champion === true) dest.championCount = (dest.championCount || 0) + 1;

      dest.seasonsCount = (dest.seasonsCount || 0) + 1;
    }
  }

  const regMap = {};
  const poMap = {};
  for (const sr of seasonsResults) {
    if (!sr) continue;
    const regular = sr.regularStandings ?? sr.regular ?? sr.standings ?? [];
    aggregateStandingsList(regular, regMap);

    if (sr.playoffStandings && sr.playoffStandings.length) {
      aggregateStandingsList(sr.playoffStandings, poMap);
    } else if (sr.playoffs && sr.playoffs.length) {
      aggregateStandingsList(sr.playoffs, poMap);
    } else if (!sr.regularStandings && sr.standings && sr.standings.length) {
      aggregateStandingsList(sr.standings, poMap);
    }
  }

  const aggregatedRegular = Object.keys(regMap).map(k => {
    const r = regMap[k];
    r.pf = Math.round((r.pf || 0) * 100) / 100;
    r.pa = Math.round((r.pa || 0) * 100) / 100;
    r.champion = (r.championCount || 0) > 0;
    return r;
  });

  const aggregatedPlayoff = Object.keys(poMap).map(k => {
    const r = poMap[k];
    r.pf = Math.round((r.pf || 0) * 100) / 100;
    r.pa = Math.round((r.pa || 0) * 100) / 100;
    r.champion = (r.championCount || 0) > 0;
    return r;
  });

  aggregatedRegular.sort((a,b) => {
    const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
    if (wb !== wa) return wb - wa;
    return (b.pf || 0) - (a.pf || 0);
  });

  aggregatedPlayoff.sort((a,b) => {
    const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
    if (wb !== wa) return wb - wa;
    return (b.pf || 0) - (a.pf || 0);
  });

  return {
    seasons: seasons,
    selectedSeason: selectedSeasonParam,
    seasonsResults: seasonsResults,
    aggregatedRegular,
    aggregatedPlayoff,
    jsonLinks,
    error: finalError,
    messages: messages,
    prevChain: prevChain
  };
}
