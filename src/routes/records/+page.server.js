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

export async function load(event) {
  // set CDN caching
  event.setHeaders({
    'cache-control': 's-maxage=120, stale-while-revalidate=300'
  });

  var url = event.url;
  var incomingSeasonParam = url.searchParams.get('season') || null;
  var messages = [];
  var prevChain = [];

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

      // Helper: process one week's matchups into the provided trackers.
      async function processWeekIntoTrackers(week, statsByRoster, resultsByRoster, paByRoster) {
        var matchups = null;
        try {
          matchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 });
        } catch (errWeek) {
          messages.push('Error fetching matchups for league ' + leagueId + ' week ' + week + ' — ' + (errWeek && errWeek.message ? errWeek.message : String(errWeek)));
          return;
        }
        if (!matchups || !matchups.length) return;

        // group by matchup_id|week
        var byMatch = {};
        for (var mi = 0; mi < matchups.length; mi++) {
          var entry = matchups[mi];
          var mid = entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? null;
          var wk = entry.week ?? entry.w ?? week;
          var key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(entry);
        }

        var mids = Object.keys(byMatch);
        for (var mii = 0; mii < mids.length; mii++) {
          var mid = mids[mii];
          var entries = byMatch[mid];
          if (!entries || entries.length === 0) continue;

          if (entries.length === 1) {
            // single entry (bye or lone participant) — add pf but do NOT create wins/losses
            var only = entries[0];
            var ridOnly = only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId;
            var ptsOnly = safeNum(only.points ?? only.points_for ?? only.pts ?? 0);
            // Only process if this roster maps to a real roster (ignore synthetic override-like IDs)
            if (ridOnly != null && Object.prototype.hasOwnProperty.call(statsByRoster, String(ridOnly))) {
              paByRoster[String(ridOnly)] = paByRoster[String(ridOnly)] || 0;
              resultsByRoster[String(ridOnly)] = resultsByRoster[String(ridOnly)] || [];
              statsByRoster[String(ridOnly)] = statsByRoster[String(ridOnly)] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
              statsByRoster[String(ridOnly)].pf += ptsOnly;
            }
            continue;
          }

          // Build participants list but ONLY include participants that map to an existing roster in rosterMap
          var participants = [];
          for (var e = 0; e < entries.length; e++) {
            var en = entries[e];
            var pid = en.roster_id ?? en.rosterId ?? en.owner_id ?? en.ownerId;
            var ppts = safeNum(en.points ?? en.points_for ?? en.pts ?? 0);

            // Ignore participants that don't exist in rosterMap — this prevents synthetic/override ids polluting standings
            if (!pid || !Object.prototype.hasOwnProperty.call(statsByRoster, String(pid))) {
              // skip; not a recognized roster
              continue;
            }

            participants.push({ rosterId: String(pid), points: ppts });
            paByRoster[String(pid)] = paByRoster[String(pid)] || 0;
            resultsByRoster[String(pid)] = resultsByRoster[String(pid)] || [];
            statsByRoster[String(pid)] = statsByRoster[String(pid)] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
            statsByRoster[String(pid)].pf += ppts;
          }

          // If after filtering participants array has < 2 valid participants, skip results logic (no matchup)
          if (participants.length < 2) {
            continue;
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
      } // end processWeekIntoTrackers

      // === Process only the regular weeks explicitly 1..(playoffStart-1) ===
      for (var w = 1; w < playoffStart; w++) {
        await processWeekIntoTrackers(w, statsByRosterRegular, resultsByRosterRegular, paByRosterRegular);
      }

      // === Process playoff weeks explicitly playoffStart..playoffEnd ===
      for (var w2 = playoffStart; w2 <= playoffEnd; w2++) {
        await processWeekIntoTrackers(w2, statsByRosterPlayoff, resultsByRosterPlayoff, paByRosterPlayoff);
      }

      // helper to build a standings array from trackers (also compute streaks)
      function buildStandings(statsByRoster, resultsByRoster, paByRoster) {
        var standings = [];
        // Only consider iteration keys that are either seeded from rosterMap or present in statsByRoster (which we seeded from rosterMap)
        var iterationKeys = Object.keys(resultsByRoster).filter(function(k) {
          return Object.prototype.hasOwnProperty.call(statsByRoster, k);
        });

        if (iterationKeys.length === 0 && rosterMap && Object.keys(rosterMap).length) iterationKeys = Object.keys(rosterMap);

        for (var idx = 0; idx < iterationKeys.length; idx++) {
          var ridK = iterationKeys[idx];
          if (!Object.prototype.hasOwnProperty.call(statsByRoster, ridK)) {
            // ensure we only build rows for roster ids we seeded (i.e., real rosters)
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
    prevChain: prevChain
  };
}
