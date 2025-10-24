// src/routes/standings/+page.server.js
// Standings loader using centralized Sleeper client (sleeperClient.js).
// Splits computed results into regularStandings and playoffStandings.
// Regular-season stats are strictly taken from weeks 1 .. (playoff_week_start - 1).
// Playoff stats are taken only from the 3-week playoff window: playoff_week_start .. playoff_week_start+2.
// Hardcoded champions for 2022/2023/2024 are still applied.
// Adds maxWinStreak and maxLoseStreak per roster for both regular and playoff standings.

import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';

// pick cache: prefer global KV if available, otherwise memory cache
var cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) {
    cache = createKVCache(globalThis.KV);
  } else {
    cache = createMemoryCache();
  }
} catch (e) {
  cache = createMemoryCache();
}

// create client singleton
var SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
var sleeper = createSleeperClient({ cache: cache, concurrency: SLEEPER_CONCURRENCY });

// config
var BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID)
  ? process.env.BASE_LEAGUE_ID
  : '1219816671624048640';
var MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

// compute streaks from results array (array of 'W'/'L'/'T')
function computeStreaks(resultsArray) {
  var maxW = 0, maxL = 0, curW = 0, curL = 0;
  if (!resultsArray || !Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
  for (var i = 0; i < resultsArray.length; i++) {
    var r = resultsArray[i];
    if (r === 'W') {
      curW += 1;
      curL = 0;
      if (curW > maxW) maxW = curW;
    } else if (r === 'L') {
      curL += 1;
      curW = 0;
      if (curL > maxL) maxL = curL;
    } else {
      // T or unspecified breaks streaks
      curW = 0;
      curL = 0;
    }
  }
  return { maxW: maxW, maxL: maxL };
}

/**
 * Robust extractor: prefer starters-level totals, then per-player maps (sum),
 * then sum only the players listed in `starters` if a player-points map is present,
 * finally fall back to points/points_for/pts numeric fields.
 */
function extractPointsFromEntry(entry) {
  if (!entry || typeof entry !== 'object') return 0;

  // helper to try a list of keys on an object and return the first numeric
  function tryKeys(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        var v = obj[k];
        if (v != null && v !== '') {
          var n = Number(v);
          if (!isNaN(n)) return n;
        }
      }
    }
    return null;
  }

  // candidate direct aggregate fields (prefer starter totals)
  var priorityFields = [
    'starters_points',
    'starters_points_for',
    'starters_points_total',
    'starters_points_for_total',
    'starters_points_week',
    'starters_points_for_week',
    'players_points_total',
    'points_for',
    'points',
    'pts',
    'points_for_total',
    'points_total'
  ];

  // check entry top-level then raw sub-object
  var v = tryKeys(entry, priorityFields);
  if (v != null) return safeNum(v);
  if (entry.raw && typeof entry.raw === 'object') {
    v = tryKeys(entry.raw, priorityFields);
    if (v != null) return safeNum(v);
  }

  // candidate per-player maps (object where keys = playerId and values = numeric points)
  var playerMapKeys = [
    'players_points',
    'players_points_map',
    'player_points',
    'player_points_map',
    'players_scored',
    'playerScoring',
    'player_scores',
    'players_score_map'
  ];

  // try to find any player-points map and sum numeric values
  function sumPlayerMap(obj) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < playerMapKeys.length; i++) {
      var pk = playerMapKeys[i];
      if (Object.prototype.hasOwnProperty.call(obj, pk)) {
        var map = obj[pk];
        // if it's an object of playerId -> number
        if (map && typeof map === 'object' && !Array.isArray(map)) {
          var sum = 0, any = false;
          for (var kk in map) {
            if (!Object.prototype.hasOwnProperty.call(map, kk)) continue;
            var val = map[kk];
            var num = Number(val);
            if (!isNaN(num)) { sum += num; any = true; }
          }
          if (any) return sum;
        }
        // if it's an array of items with a numeric field
        if (Array.isArray(map)) {
          var sum2 = 0, any2 = false;
          for (var ai = 0; ai < map.length; ai++) {
            var it = map[ai];
            if (it == null) continue;
            // try numeric value directly
            if (typeof it === 'number') { sum2 += it; any2 = true; continue; }
            // try known numeric props
            var candidateVals = [it.points, it.pts, it.score, it.total, it.points_for];
            var foundNum = null;
            for (var cv = 0; cv < candidateVals.length; cv++) {
              var vv = candidateVals[cv];
              if (vv != null && !isNaN(Number(vv))) { foundNum = Number(vv); break; }
            }
            if (foundNum != null) { sum2 += foundNum; any2 = true; }
          }
          if (any2) return sum2;
        }
      }
    }
    return null;
  }

  var sumAllPlayers = sumPlayerMap(entry);
  if (sumAllPlayers != null) return safeNum(sumAllPlayers);
  if (entry.raw && typeof entry.raw === 'object') {
    var sumAllPlayersRaw = sumPlayerMap(entry.raw);
    if (sumAllPlayersRaw != null) return safeNum(sumAllPlayersRaw);
  }

  // If starters array exists, try to sum only the starters using any available player map (top-level or raw)
  var startersList = null;
  if (Array.isArray(entry.starters) && entry.starters.length) startersList = entry.starters.slice();
  else if (Array.isArray(entry.starting_lineup) && entry.starting_lineup.length) startersList = entry.starting_lineup.slice();
  else if (Array.isArray(entry.starters_list) && entry.starters_list.length) startersList = entry.starters_list.slice();
  else if (entry.raw && Array.isArray(entry.raw.starters) && entry.raw.starters.length) startersList = entry.raw.starters.slice();

  if (startersList && startersList.length) {
    // try to find player -> points map on entry or entry.raw
    function sumStartersFromMap(obj) {
      if (!obj || typeof obj !== 'object') return null;
      for (var i2 = 0; i2 < playerMapKeys.length; i2++) {
        var pkey = playerMapKeys[i2];
        if (Object.prototype.hasOwnProperty.call(obj, pkey)) {
          var pmap = obj[pkey];
          if (pmap && typeof pmap === 'object') {
            // if map is array, convert to lookup by player_id/ID field
            var sum = 0, any = false;
            if (Array.isArray(pmap)) {
              // build lookup by possible id fields
              var lookup = {};
              for (var ai2 = 0; ai2 < pmap.length; ai2++) {
                var it = pmap[ai2];
                if (!it) continue;
                var idCandidate = it.player_id ?? it.playerId ?? it.player ?? it.id ?? it.pid ?? null;
                var scoreCandidate = it.points ?? it.pts ?? it.score ?? it.total ?? it.points_for;
                if (idCandidate != null && scoreCandidate != null && !isNaN(Number(scoreCandidate))) {
                  lookup[String(idCandidate)] = Number(scoreCandidate);
                }
              }
              for (var si = 0; si < startersList.length; si++) {
                var sid = String(startersList[si]);
                if (Object.prototype.hasOwnProperty.call(lookup, sid)) { sum += lookup[sid]; any = true; }
              }
              if (any) return sum;
            } else {
              // pmap is object keyed by playerId
              for (var si2 = 0; si2 < startersList.length; si2++) {
                var sId = String(startersList[si2]);
                // try raw key and uppercased/lowercased variants
                var foundVal = null;
                if (Object.prototype.hasOwnProperty.call(pmap, sId)) foundVal = pmap[sId];
                else if (Object.prototype.hasOwnProperty.call(pmap, sId.toUpperCase())) foundVal = pmap[sId.toUpperCase()];
                else if (Object.prototype.hasOwnProperty.call(pmap, sId.toLowerCase())) foundVal = pmap[sId.toLowerCase()];
                if (foundVal != null && !isNaN(Number(foundVal))) { sum += Number(foundVal); any = true; }
              }
              if (any) return sum;
            }
          }
        }
      }
      return null;
    }

    var sumFromMapTop = sumStartersFromMap(entry);
    if (sumFromMapTop != null) return safeNum(sumFromMapTop);
    if (entry.raw && typeof entry.raw === 'object') {
      var sumFromMapRaw = sumStartersFromMap(entry.raw);
      if (sumFromMapRaw != null) return safeNum(sumFromMapRaw);
    }
  }

  // last resort: use points/points_for/pts numeric fields (already tried above but try again more explicitly)
  var fallback = safeNum(entry.points ?? entry.points_for ?? entry.pts ?? (entry.raw && (entry.raw.points ?? entry.raw.points_for ?? entry.raw.pts)) ?? 0);
  return fallback;
}

export async function load(event) {
  // set CDN caching
  event.setHeaders({
    'cache-control': 's-maxage=120, stale-while-revalidate=300'
  });

  var url = event.url;
  var incomingSeasonParam = url.searchParams.get('season') || null;
  var messages = [];
  var prevChain = [];

  // diagnostics collector
  var diagnostics = [];

  // Build seasons chain via previous_league_id starting from BASE_LEAGUE_ID
  var seasons = [];
  try {
    var mainLeague = null;
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

      var currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      var steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          var prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
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
  var byId = {};
  for (var i = 0; i < seasons.length; i++) {
    var s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = [];
  for (var k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);

  // sort by season if available (old -> new)
  seasons.sort(function (a, b) {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    var na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  // If no season param provided, default to the latest season (most recent)
  var selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      var latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = 'all';
    }
  }

  // choose league ids to process (supports either a specific season value or league_id)
  var leagueIdsToProcess = [];
  if (!selectedSeasonParam || selectedSeasonParam === 'all') {
    if (seasons.length === 0) leagueIdsToProcess.push(BASE_LEAGUE_ID);
    else for (var ii = 0; ii < seasons.length; ii++) leagueIdsToProcess.push(String(seasons[ii].league_id));
  } else {
    var matched = false;
    // try to match league_id
    for (var jj = 0; jj < seasons.length; jj++) {
      if (String(seasons[jj].league_id) === String(selectedSeasonParam)) {
        leagueIdsToProcess.push(String(seasons[jj].league_id));
        matched = true;
        break;
      }
    }
    // try to match by season value
    if (!matched) {
      for (var kk = 0; kk < seasons.length; kk++) {
        if (seasons[kk].season != null && String(seasons[kk].season) === String(selectedSeasonParam)) {
          leagueIdsToProcess.push(String(seasons[kk].league_id));
          matched = true;
          break;
        }
      }
    }
    // if still not matched, assume the param was a league id
    if (!matched) leagueIdsToProcess.push(String(selectedSeasonParam));
  }

  // compute results per league; produce regularStandings & playoffStandings
  var seasonsResults = [];
  var anyDataFound = false;

  // Hardcoded champions by season-year -> owner username (owner_username)
  var HARDCODED_CHAMPIONS = {
    '2022': 'riguy506',
    '2023': 'armyjunior',
    '2024': 'riguy506'
  };

  for (var li = 0; li < leagueIdsToProcess.length; li++) {
    var leagueId = leagueIdsToProcess[li];
    try {
      var leagueMeta = null;
      try { leagueMeta = await sleeper.getLeague(leagueId, { ttl: 60 * 5 }); } catch (e) { leagueMeta = null; }

      var leagueSeason = leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null;
      var leagueName = leagueMeta && leagueMeta.name ? leagueMeta.name : null;

      // Get enriched roster map from client (team_name, owner_name, owner_username, owner_id, team_avatar, owner_avatar)
      var rosterMap = {};
      try {
        rosterMap = await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 });
      } catch (e) {
        rosterMap = {};
      }

      // Build quick maps for owner_username and owner_name -> rosterId
      var usernameToRoster = {};
      var ownerNameToRoster = {};
      for (var rk in rosterMap) {
        if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
        var meta = rosterMap[rk] || {};
        if (meta.owner_username) usernameToRoster[String(meta.owner_username).toLowerCase()] = String(rk);
        if (meta.owner_name) ownerNameToRoster[String(meta.owner_name).toLowerCase()] = String(rk);
      }

      // Determine playoff week boundaries (fallback to 15 if missing)
      var playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
      if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
      var playoffEnd = playoffStart + 2; // three-week playoff window

      // trackers for regular vs playoffs
      var statsByRosterRegular = {}, resultsByRosterRegular = {}, paByRosterRegular = {};
      var statsByRosterPlayoff = {}, resultsByRosterPlayoff = {}, paByRosterPlayoff = {};

      // seed keys from rosterMap if available
      if (rosterMap && Object.keys(rosterMap).length) {
        for (var rk2 in rosterMap) {
          if (!Object.prototype.hasOwnProperty.call(rosterMap, rk2)) continue;
          statsByRosterRegular[String(rk2)] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk2].roster_raw || null };
          resultsByRosterRegular[String(rk2)] = [];
          paByRosterRegular[String(rk2)] = 0;

          statsByRosterPlayoff[String(rk2)] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk2].roster_raw || null };
          resultsByRosterPlayoff[String(rk2)] = [];
          paByRosterPlayoff[String(rk2)] = 0;
        }
      }

      // weeks loop — use client to get per-week matchups and attribute to regular or playoff
      // NOTE: regular weeks are explicitly 1 .. (playoffStart - 1); playoff weeks are playoffStart .. playoffEnd.
      for (var week = 1; week <= MAX_WEEKS; week++) {
        var matchups = null;
        try {
          matchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 });
        } catch (errWeek) {
          // treat as end of season/weeks that can't be fetched
          messages.push('Error fetching matchups for league ' + leagueId + ' week ' + week + ' — ' + (errWeek && errWeek.message ? errWeek.message : String(errWeek)));
          // continue checking later weeks (do not break) so we can still capture playoff weeks
          continue;
        }
        // if there are no matchups for this week, skip it (do not break; later weeks may exist)
        if (!matchups || !matchups.length) continue;

        // ----------------- DIAGNOSTICS (default checks week 9) -----------------
        // Change DIAG_WEEKS to include other weeks as needed, or tie to an env var.
        var DIAG_WEEKS = [9];
        if (DIAG_WEEKS.indexOf(Number(week)) !== -1) {
          // helper: keys that may contain per-player maps
          const playerMapKeys = [
            'players_points',
            'players_points_map',
            'player_points',
            'player_points_map',
            'players_scored',
            'playerScoring',
            'player_scores',
            'players_score_map'
          ];

          function findPlayerMapKeys(obj) {
            if (!obj || typeof obj !== 'object') return [];
            var found = [];
            for (var pk = 0; pk < playerMapKeys.length; pk++) {
              var key = playerMapKeys[pk];
              if (Object.prototype.hasOwnProperty.call(obj, key)) found.push(key);
            }
            if (obj && obj.raw && typeof obj.raw === 'object') {
              for (var pk2 = 0; pk2 < playerMapKeys.length; pk2++) {
                var key2 = playerMapKeys[pk2];
                if (Object.prototype.hasOwnProperty.call(obj.raw, key2) && found.indexOf(key2 + ' (raw)') === -1) found.push(key2 + ' (raw)');
              }
            }
            return found;
          }

          for (var mi = 0; mi < matchups.length; mi++) {
            var entry = matchups[mi];
            var rosterId = entry.roster_id ?? entry.rosterId ?? entry.owner_id ?? entry.ownerId ?? null;
            var officialPoints = safeNum(entry.points ?? entry.points_for ?? entry.pts ?? (entry.raw && (entry.raw.points ?? entry.raw.points_for ?? entry.raw.pts)) ?? 0);
            var extractedPoints = safeNum(extractPointsFromEntry(entry));

            // compute starters-sum if possible (best-effort)
            var startersSum = null;
            var startersList = Array.isArray(entry.starters) ? entry.starters
              : Array.isArray(entry.starting_lineup) ? entry.starting_lineup
              : Array.isArray(entry.starters_list) ? entry.starters_list
              : (entry.raw && Array.isArray(entry.raw.starters) ? entry.raw.starters : null);

            if (startersList && startersList.length) {
              for (var pkx = 0; pkx < playerMapKeys.length; pkx++) {
                var mapKey = playerMapKeys[pkx];
                var mapObj = entry[mapKey];
                if (!mapObj && entry.raw && entry.raw[mapKey]) mapObj = entry.raw[mapKey];
                if (!mapObj) continue;

                if (mapObj && typeof mapObj === 'object' && !Array.isArray(mapObj)) {
                  var sum = 0, any = false;
                  for (var si = 0; si < startersList.length; si++) {
                    var sid = String(startersList[si]);
                    if (Object.prototype.hasOwnProperty.call(mapObj, sid)) {
                      var vv = Number(mapObj[sid]);
                      if (!isNaN(vv)) { sum += vv; any = true; }
                    } else if (Object.prototype.hasOwnProperty.call(mapObj, sid.toUpperCase())) {
                      var vv2 = Number(mapObj[sid.toUpperCase()]);
                      if (!isNaN(vv2)) { sum += vv2; any = true; }
                    } else if (Object.prototype.hasOwnProperty.call(mapObj, sid.toLowerCase())) {
                      var vv3 = Number(mapObj[sid.toLowerCase()]);
                      if (!isNaN(vv3)) { sum += vv3; any = true; }
                    }
                  }
                  if (any) { startersSum = sum; break; }
                }

                if (Array.isArray(mapObj)) {
                  var lookup = {};
                  for (var ai = 0; ai < mapObj.length; ai++) {
                    var it = mapObj[ai] || {};
                    var idc = it.player_id ?? it.playerId ?? it.player ?? it.id ?? null;
                    var sc = it.points ?? it.pts ?? it.score ?? it.total ?? null;
                    if (idc != null && sc != null && !isNaN(Number(sc))) lookup[String(idc)] = Number(sc);
                  }
                  var sumA = 0, anyA = false;
                  for (var si2 = 0; si2 < startersList.length; si2++) {
                    var sid2 = String(startersList[si2]);
                    if (Object.prototype.hasOwnProperty.call(lookup, sid2)) { sumA += lookup[sid2]; anyA = true; }
                  }
                  if (anyA) { startersSum = sumA; break; }
                }
              }
            }

            var diff = Math.abs(Number(extractedPoints) - Number(officialPoints));
            if (diff > 0.001) {
              // keep compact snapshot to avoid huge payloads
              var safeSnap = Object.assign({}, entry);
              if (safeSnap.player_points && typeof safeSnap.player_points === 'object') safeSnap.player_points = '[player_points omitted]';
              if (safeSnap.raw && typeof safeSnap.raw === 'object') safeSnap.raw = '[raw omitted]';

              diagnostics.push({
                week: week,
                matchup_id: entry.matchup_id ?? entry.matchupId ?? null,
                rosterId: rosterId,
                officialPoints: officialPoints,
                extractedPoints: extractedPoints,
                startersList: startersList,
                startersSumFromMap: startersSum,
                playerMapKeysFound: findPlayerMapKeys(entry),
                entrySnapshot: safeSnap
              });

              messages.push(`Diag week ${week}: roster ${rosterId} mismatch official=${officialPoints} extracted=${extractedPoints} (matchup ${entry.matchup_id ?? 'n/a'})`);
            }
          } // end matchups iteration
        } // end diagnostics block

        var isRegularWeek = (week >= 1 && week < playoffStart);
        var isPlayoffWeek = (week >= playoffStart && week <= playoffEnd);

        // ignore weeks that are neither regular nor playoff
        if (!isRegularWeek && !isPlayoffWeek) continue;

        var statsByRoster = isPlayoffWeek ? statsByRosterPlayoff : statsByRosterRegular;
        var resultsByRoster = isPlayoffWeek ? resultsByRosterPlayoff : resultsByRosterRegular;
        var paByRoster = isPlayoffWeek ? paByRosterPlayoff : paByRosterRegular;

        // group by matchup_id|week
        var byMatch = {};
        for (var mi2 = 0; mi2 < matchups.length; mi2++) {
          var entry2 = matchups[mi2];
          var mid = entry2.matchup_id ?? entry2.matchupId ?? entry2.matchup ?? null;
          var wk = entry2.week ?? entry2.w ?? week;
          var key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi2));
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(entry2);
        }

        // process groups
        var mids = Object.keys(byMatch);
        for (var mii = 0; mii < mids.length; mii++) {
          var mid = mids[mii];
          var entries = byMatch[mid];
          if (!entries || entries.length === 0) continue;

          if (entries.length === 1) {
            var only = entries[0];
            var ridOnly = only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId;
            // use extractor that prefers starters and per-player sums
            var ptsOnly = safeNum(extractPointsFromEntry(only));
            paByRoster[String(ridOnly)] = paByRoster[String(ridOnly)] || 0;
            resultsByRoster[String(ridOnly)] = resultsByRoster[String(ridOnly)] || [];
            statsByRoster[String(ridOnly)] = statsByRoster[String(ridOnly)] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
            statsByRoster[String(ridOnly)].pf += ptsOnly;
            continue;
          }

          var participants = [];
          for (var e = 0; e < entries.length; e++) {
            var en = entries[e];
            var pid = en.roster_id ?? en.rosterId ?? en.owner_id ?? en.ownerId;
            // NEW: compute participant points via extractPointsFromEntry
            var ppts = safeNum(extractPointsFromEntry(en));
            participants.push({ rosterId: String(pid), points: ppts });
            paByRoster[String(pid)] = paByRoster[String(pid)] || 0;
            resultsByRoster[String(pid)] = resultsByRoster[String(pid)] || [];
            statsByRoster[String(pid)] = statsByRoster[String(pid)] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
            statsByRoster[String(pid)].pf += ppts;
          }

          for (var pi = 0; pi < participants.length; pi++) {
            var part = participants[pi];
            var opponents = [];
            for (var oi = 0; oi < participants.length; oi++) {
              if (oi === pi) continue;
              opponents.push(participants[oi]);
            }
            var oppAvg = 0;
            if (opponents.length) {
              for (var oa = 0; oa < opponents.length; oa++) oppAvg += opponents[oa].points;
              oppAvg = oppAvg / opponents.length;
            }
            // track pa accumulator on each participant
            paByRoster[part.rosterId] = paByRoster[part.rosterId] || 0;
            paByRoster[part.rosterId] += oppAvg;
            // determine result vs oppAvg
            if (part.points > oppAvg + 1e-9) { resultsByRoster[part.rosterId].push('W'); statsByRoster[part.rosterId].wins += 1; }
            else if (part.points < oppAvg - 1e-9) { resultsByRoster[part.rosterId].push('L'); statsByRoster[part.rosterId].losses += 1; }
            else { resultsByRoster[part.rosterId].push('T'); statsByRoster[part.rosterId].ties += 1; }
          }
        }
      } // end weeks loop

      // helper to build a standings array from trackers (also compute streaks)
      function buildStandings(statsByRoster, resultsByRoster, paByRoster) {
        var standings = [];
        var iterationKeys = Object.keys(resultsByRoster);
        if (iterationKeys.length === 0 && rosterMap && Object.keys(rosterMap).length) iterationKeys = Object.keys(rosterMap);

        for (var idx = 0; idx < iterationKeys.length; idx++) {
          var ridK = iterationKeys[idx];
          if (!Object.prototype.hasOwnProperty.call(statsByRoster, ridK)) {
            statsByRoster[ridK] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: (rosterMap && rosterMap[ridK] ? rosterMap[ridK].roster_raw : null) };
          }
          var s = statsByRoster[ridK];
          var wins = s.wins || 0;
          var losses = s.losses || 0;
          var ties = s.ties || 0;
          var pfVal = Math.round((s.pf || 0) * 100) / 100;
          var paVal = Math.round((paByRoster[ridK] || s.pa || 0) * 100) / 100;

          var meta = (rosterMap && rosterMap[ridK]) ? rosterMap[ridK] : {};
          var team_name = meta.team_name ? meta.team_name : ((s.roster && s.roster.metadata && s.roster.metadata.team_name) ? s.roster.metadata.team_name : ('Roster ' + ridK));
          var owner_name = meta.owner_name || null;
          var team_avatar = meta.team_avatar || null;
          var owner_avatar = meta.owner_avatar || null;
          var avatar = team_avatar || owner_avatar || null;

          // compute streaks from resultsByRoster
          var resArr = resultsByRoster && resultsByRoster[ridK] ? resultsByRoster[ridK] : [];
          var streaks = computeStreaks(resArr);

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

      var regularStandings = buildStandings(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular);
      var playoffStandings = buildStandings(statsByRosterPlayoff, resultsByRosterPlayoff, paByRosterPlayoff);

      // === Hardcoded champion overrides (owner usernames) ===
      try {
        if (leagueSeason != null) {
          var seasonKey = String(leagueSeason);
          if (HARDCODED_CHAMPIONS.hasOwnProperty(seasonKey)) {
            var championOwner = String(HARDCODED_CHAMPIONS[seasonKey]);
            // look up rosterId by owner_username (case-insensitive) or owner_name as fallback
            var rosterId = null;
            var low = championOwner.toLowerCase();
            if (usernameToRoster[low]) rosterId = usernameToRoster[low];
            else if (ownerNameToRoster[low]) rosterId = ownerNameToRoster[low];

            if (rosterId) {
              var matchingRow = (playoffStandings || []).find(function(r) { return String(r.rosterId) === String(rosterId); });
              if (matchingRow) {
                matchingRow.champion = true;
                messages.push('Hardcoded champion applied for season ' + seasonKey + ': owner "' + championOwner + '" -> roster ' + rosterId);
              } else {
                messages.push('Hardcoded champion owner "' + championOwner + '" mapped to roster ' + rosterId + ' but that roster was not present in playoffStandings for season ' + seasonKey + '.');
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

  var finalError = null;
  if (!anyDataFound) finalError = 'No roster/matchup data found for requested seasons. Details: ' + (messages.length ? messages.join(' | ') : 'no details');

  return {
    seasons: seasons,
    selectedSeason: selectedSeasonParam,
    seasonsResults: seasonsResults,
    error: finalError,
    messages: messages,
    prevChain: prevChain,
    diagnostics: diagnostics
  };
}
