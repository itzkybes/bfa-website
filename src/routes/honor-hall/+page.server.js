// src/routes/honor-hall/+page.server.js
// Honor Hall loader: fetch playoff matchups and compute placements by scrubbing regular-season matchups
// Mirrors the approach used in src/routes/standings/+page.server.js for consistency.

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

// compute streaks (copied from standings loader style)
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

/**
 * Bracket simulation function.
 * Accepts context: matchupsRows (playoff rows), placementMap, rosterMap, regularStandings, seasonKey, playoffStart, playoffEnd
 * Returns { finalStandings, placeMap, debugLog }.
 *
 * NOTE: This function is unchanged from prior final-standings logic: it assigns final places based on playoff matchups.
 */
function simulateBracket({ matchupsRows, placementMap, rosterMap, regularStandings, seasonKey, playoffStart, playoffEnd }) {
  const debugLog = [];
  debugLog.push(`Loaded rosters (${Object.keys(rosterMap || {}).length})`);

  // Build seed->roster mapping from placementMap (placementMap: rosterId -> placement)
  const seedToRoster = {};
  for (const rid of Object.keys(placementMap || {})) {
    const seed = Number(placementMap[rid]);
    if (!isNaN(seed)) seedToRoster[seed] = String(rid);
  }

  // Ensure at least N=14 mapping; fill holes with rosterMap entries deterministically
  const allRosterIds = Object.keys(rosterMap || {}).map(String);
  const N = Math.max(14, allRosterIds.length || 14);
  for (let s = 1; s <= N; s++) {
    if (!seedToRoster[s]) {
      const candidate = allRosterIds.find(id => !Object.values(seedToRoster).includes(id));
      if (candidate) seedToRoster[s] = candidate;
    }
  }

  // helper metadata for rosterId
  function metaFor(rid) {
    const m = (rosterMap && rosterMap[String(rid)]) ? rosterMap[String(rid)] : {};
    return {
      rosterId: String(rid),
      team_name: m.team_name || m.owner_name || ('Roster ' + String(rid)),
      avatar: m.team_avatar || m.owner_avatar || null,
      seed: (placementMap && placementMap[String(rid)]) ? Number(placementMap[String(rid)]) : null
    };
  }

  // locate an actual matchup result (uses matchupsRows entries). returns object or null
  function findMatchupResult(aRid, bRid) {
    aRid = String(aRid); bRid = String(bRid);
    for (const r of (matchupsRows || [])) {
      if (r.participantsCount === 2) {
        const a = String(r.teamA?.rosterId ?? '');
        const b = String(r.teamB?.rosterId ?? '');
        if ((a === aRid && b === bRid) || (a === bRid && b === aRid)) {
          const aPts = Number(r.teamA?.points ?? 0);
          const bPts = Number(r.teamB?.points ?? 0);
          // if both points present and unequal -> decide by points
          if (!isNaN(aPts) && !isNaN(bPts) && Math.abs(aPts - bPts) > 1e-9) {
            if (aPts > bPts) return { winnerRosterId: a, loserRosterId: b, kind: 'matchup' };
            return { winnerRosterId: b, loserRosterId: a, kind: 'matchup' };
          }
          // if tied or missing points, return null (force fallback)
          return null;
        }
      } else if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
        const ids = r.combinedParticipants.map(p => String(p.rosterId));
        if (ids.includes(aRid) && ids.includes(bRid)) {
          const aObj = r.combinedParticipants.find(x => String(x.rosterId) === aRid);
          const bObj = r.combinedParticipants.find(x => String(x.rosterId) === bRid);
          const aPts = Number(aObj?.points ?? 0);
          const bPts = Number(bObj?.points ?? 0);
          if (!isNaN(aPts) && !isNaN(bPts) && Math.abs(aPts - bPts) > 1e-9) {
            if (aPts > bPts) return { winnerRosterId: aRid, loserRosterId: bRid, kind: 'matchup' };
            return { winnerRosterId: bRid, loserRosterId: aRid, kind: 'matchup' };
          }
          return null;
        }
      }
    }
    return null;
  }

  // build PF map from regularStandings for tiebreaks
  const pfMap = {};
  if (Array.isArray(regularStandings)) {
    for (const r of regularStandings) {
      pfMap[String(r.rosterId)] = Number(r.pf ?? 0);
    }
  }

  // fallback decision: highest PF wins, then better seed (lower numeric)
  function decideWinnerFallback(aRid, bRid) {
    aRid = String(aRid); bRid = String(bRid);
    const aPf = pfMap[aRid] ?? 0;
    const bPf = pfMap[bRid] ?? 0;
    if (Math.abs(aPf - bPf) > 1e-9) return aPf > bPf ? aRid : bRid;
    const aSeed = Number(placementMap && placementMap[aRid] ? placementMap[aRid] : 999);
    const bSeed = Number(placementMap && placementMap[bRid] ? placementMap[bRid] : 999);
    if (aSeed !== bSeed) return aSeed < bSeed ? aRid : bRid;
    // deterministic final fallback
    return aRid < bRid ? aRid : bRid;
  }

  // resolve a match given two seeds; returns { winner, loser, method }
  function resolveMatch(aSeed, bSeed, label) {
    const aRid = seedToRoster[aSeed];
    const bRid = seedToRoster[bSeed];
    if (!aRid || !bRid) {
      debugLog.push(`${label} ${aSeed}v${bSeed} -> fallback-missing`);
      return { winner: aRid || bRid || null, loser: aRid && bRid ? (aRid === (aRid||bRid) ? bRid : aRid) : null, method: 'missing' };
    }
    const m = findMatchupResult(aRid, bRid);
    if (m) {
      // Use seed numbering in debug (matchup winner corresponds to aSeed or bSeed)
      const winSeed = (m.winnerRosterId === aRid) ? aSeed : bSeed;
      debugLog.push(`${label} ${aSeed}v${bSeed} -> ${winSeed} (matchup)`);
      return { winner: m.winnerRosterId, loser: m.loserRosterId, method: 'matchup' };
    }
    // fallback
    const winRid = decideWinnerFallback(aRid, bRid);
    const method = (pfMap[aRid] || pfMap[bRid]) ? 'tiebreak-pf' : 'tiebreak-seed';
    const winSeed = (winRid === aRid) ? aSeed : bSeed;
    debugLog.push(`${label} ${aSeed}v${bSeed} -> ${winSeed} (${method})`);
    return { winner: winRid, loser: (winRid === aRid ? bRid : aRid), method };
  }

  // final place map
  const placeMap = {};
  const assigned = new Set();

  function assignPlace(rosterId, place, note = '') {
    rosterId = String(rosterId);
    if (!rosterId) return;
    let p = Number(place);
    // make unique if necessary
    const used = new Set(Object.values(placeMap).map(x => Number(x)));
    while (used.has(p)) p++;
    placeMap[rosterId] = p;
    assigned.add(rosterId);
    debugLog.push(`Assign place ${p} -> ${metaFor(rosterId).team_name}${note ? ' ('+note+')' : ''}`);
  }

  // Helper to find seed number given rosterId deterministically
  function seedForRoster(rid) {
    rid = String(rid);
    for (const s of Object.keys(seedToRoster)) {
      if (String(seedToRoster[s]) === rid) return Number(s);
    }
    // fallback: look in placementMap
    if (placementMap && placementMap[rid]) return Number(placementMap[rid]);
    return null;
  }

  // Main simulation paths: 2022 special-case or default (top 8 winners bracket)
  if (String(seasonKey) === '2022') {
    // Special 2022 bracket mapping (top 6 winners bracket with seeds 1 & 2 byes)
    // According to the provided debug trace, we must follow specific pairings.

    // Round 1: W1 4v5, W1 3v6
    const r_w1_4v5 = resolveMatch(4, 5, 'W1 4v5');
    const r_w1_3v6 = resolveMatch(3, 6, 'W1 3v6');

    // Semis: 1 vs winner(4v5), 2 vs winner(3v6)
    const semi1OpponentSeed = (r_w1_4v5.winner === seedToRoster[4]) ? 4 : 5;
    const semi2OpponentSeed = (r_w1_3v6.winner === seedToRoster[3]) ? 3 : 6;

    const r_semi1 = resolveMatch(1, semi1OpponentSeed, 'Semi 1v4');
    const r_semi2 = resolveMatch(2, semi2OpponentSeed, 'Semi 2v6');

    // Final: winners of semis
    // Determine seeds for final participants
    const finalSeedA = seedForRoster(r_semi1.winner) || 1;
    const finalSeedB = seedForRoster(r_semi2.winner) || 2;
    const r_final = resolveMatch(finalSeedA, finalSeedB, 'Final 1v2');

    // 3rd place: losers of semis
    const semiLoserSeedA = seedForRoster(r_semi1.loser);
    const semiLoserSeedB = seedForRoster(r_semi2.loser);
    if (semiLoserSeedA && semiLoserSeedB) {
      const r_3rd = resolveMatch(semiLoserSeedA, semiLoserSeedB, '3rd ' + semiLoserSeedA + 'v' + semiLoserSeedB);
      assignPlace(r_3rd.winner, 3, '3rd (matchup)');
      assignPlace(r_3rd.loser, 4, '4th (matchup)');
    } else {
      // fallback: assign semis losers by fallback decision
      const loserA = r_semi1.loser, loserB = r_semi2.loser;
      const w = decideWinnerFallback(loserA, loserB);
      assignPlace(w, 3, '3rd (fallback)');
      assignPlace(w === loserA ? loserB : loserA, 4, '4th (fallback)');
    }

    // champion/runner-up
    assignPlace(r_final.winner, 1, 'champion (final)');
    assignPlace(r_final.loser, 2, 'runner-up (final)');

    // 5th/6th — per your 2022 debug: "5th 5v3 -> 3 (matchup)"
    // Try to resolve a match between seeds 5 and 3
    const r_5th = resolveMatch(5, 3, '5th 5v3');
    assignPlace(r_5th.winner, 5, '5th (consolation)');
    assignPlace(r_5th.loser, 6, '6th (consolation)');

    // Loser-race flow (per your 2022 debug)
    // LRace 9v12, 10v11, 7v14, 8v13
    const lr1 = resolveMatch(9, 12, 'LRace 9v12');
    const lr2 = resolveMatch(10, 11, 'LRace 10v11');
    const lr3 = resolveMatch(7, 14, 'LRace 7v14');
    const lr4 = resolveMatch(8, 13, 'LRace 8v13');

    // Consolation LRace1: 7v10 and 8v9 (per debug)
    const cl1 = resolveMatch(7, 10, 'Consolation LRace1 7v10');
    const cl2 = resolveMatch(8, 9, 'Consolation LRace1 8v9');

    // LRaceSemi placeholders (11v14 and 12v13) — resolve if matchups exist
    const lrsemi1 = resolveMatch(11, 14, 'LRaceSemi 11v14');
    const lrsemi2 = resolveMatch(12, 13, 'LRaceSemi 12v13');

    // 7th / 8th — as indicated in your debug: 7th 10v9 -> 9 (matchup) then 9th 7v8 etc.
    const r7 = resolveMatch(10, 9, '7th 10v9');
    assignPlace(r7.winner, 7, '7th (matchup)');
    assignPlace(r7.loser, 8, '8th (matchup)');

    const r9 = resolveMatch(7, 8, '9th 7v8');
    assignPlace(r9.winner, 9, '9th (matchup)');
    assignPlace(r9.loser, 10, '10th (matchup)');

    const r11 = resolveMatch(11, 13, '11th 11v13');
    assignPlace(r11.winner, 11, '11th (matchup/fallback)');
    assignPlace(r11.loser, 12, '12th (matchup/fallback)');

    const r13 = resolveMatch(14, 12, '13th 14v12');
    assignPlace(r13.winner, 13, '13th (matchup)');
    assignPlace(r13.loser, 14, '14th (matchup)');
  } else {
    // DEFAULT flow for most seasons (top 8 winners bracket)
    // Round 1 winners
    const w1 = resolveMatch(1, 8, 'W1 1v8');
    const w2 = resolveMatch(2, 7, 'W1 2v7');
    const w3 = resolveMatch(3, 6, 'W1 3v6');
    const w4 = resolveMatch(4, 5, 'W1 4v5');

    // gather winners and losers seeds (by seed numbers)
    const mapWinnerSeed = (r) => seedForRoster(r.winner) || null;
    const mapLoserSeed = (r) => seedForRoster(r.loser) || null;

    const winnersSeeds = [mapWinnerSeed(w1), mapWinnerSeed(w2), mapWinnerSeed(w3), mapWinnerSeed(w4)].filter(Boolean);
    const losersSeeds = [mapLoserSeed(w1), mapLoserSeed(w2), mapLoserSeed(w3), mapLoserSeed(w4)].filter(Boolean);

    // semis: highest seed vs lowest seed (i.e. best plays worst among winners)
    winnersSeeds.sort((a,b) => a - b);
    const semiA_seedA = winnersSeeds[0];
    const semiA_seedB = winnersSeeds[winnersSeeds.length - 1];
    const semiB_seedA = winnersSeeds[1];
    const semiB_seedB = winnersSeeds[2];

    const semiA = resolveMatch(semiA_seedA, semiA_seedB, `Semi ${semiA_seedA}v${semiA_seedB}`);
    const semiB = resolveMatch(semiB_seedA, semiB_seedB, `Semi ${semiB_seedA}v${semiB_seedB}`);

    // Final and 3rd
    const finalSeedA = seedForRoster(semiA.winner) || semiA_seedA;
    const finalSeedB = seedForRoster(semiB.winner) || semiB_seedA;
    const finalMatch = resolveMatch(finalSeedA, finalSeedB, `Final ${finalSeedA}v${finalSeedB}`);

    const thirdSeedA = seedForRoster(semiA.loser) || semiA_seedB;
    const thirdSeedB = seedForRoster(semiB.loser) || semiB_seedB;
    const thirdMatch = resolveMatch(thirdSeedA, thirdSeedB, `3rd ${thirdSeedA}v${thirdSeedB}`);

    // Assign top 4
    assignPlace(finalMatch.winner, 1, 'champion (final)');
    assignPlace(finalMatch.loser, 2, 'runner-up (final)');
    assignPlace(thirdMatch.winner, 3, '3rd (matchup)');
    assignPlace(thirdMatch.loser, 4, '4th (matchup)');

    // Consolation (5th/6th & 7th/8th)
    losersSeeds.sort((a,b) => a - b); // best seed first among losers
    const c1 = resolveMatch(losersSeeds[0], losersSeeds[losersSeeds.length - 1], `Consolation R1 ${losersSeeds[0]}v${losersSeeds[losersSeeds.length - 1]}`);
    const c2 = resolveMatch(losersSeeds[1], losersSeeds[2], `Consolation R1 ${losersSeeds[1]}v${losersSeeds[2]}`);

    const c5 = resolveMatch(seedForRoster(c1.winner) || losersSeeds[0], seedForRoster(c2.winner) || losersSeeds[1], `5th ${seedForRoster(c1.winner)||''}v${seedForRoster(c2.winner)||''}`);
    assignPlace(c5.winner, 5, '5th (consolation)');
    assignPlace(c5.loser, 6, '6th (consolation)');

    const c7 = resolveMatch(seedForRoster(c1.loser) || losersSeeds[2], seedForRoster(c2.loser) || losersSeeds[3], `7th ${seedForRoster(c1.loser)||''}v${seedForRoster(c2.loser)||''}`);
    assignPlace(c7.winner, 7, '7th (consolation)');
    assignPlace(c7.loser, 8, '8th (consolation)');

    // Losers race for 9..14
    const lr1 = resolveMatch(9, 12, 'LRace 9v12');
    const lr2 = resolveMatch(10, 11, 'LRace 10v11');

    // LRace semi: winners of lr1/lr2 face bye seeds 13/14 as described previously
    const lrsemiA = resolveMatch(seedForRoster(lr1.winner) || 9, 14, `LRaceSemi ${seedForRoster(lr1.winner)||9}v14`);
    const lrsemiB = resolveMatch(seedForRoster(lr2.winner) || 10, 13, `LRaceSemi ${seedForRoster(lr2.winner)||10}v13`);

    // 9th place match: winners of lrsemiA and lrsemiB
    const match9 = resolveMatch(seedForRoster(lrsemiA.winner) || seedForRoster(lr1.winner), seedForRoster(lrsemiB.winner) || seedForRoster(lr2.winner), '9th final');
    assignPlace(match9.winner, 9, '9th (l-race)');
    assignPlace(match9.loser, 10, '10th (l-race)');

    // 11th place match: losers of lrsemiA and lrsemiB
    const match11 = resolveMatch(seedForRoster(lrsemiA.loser) || seedForRoster(lr1.loser), seedForRoster(lrsemiB.loser) || seedForRoster(lr2.loser), '11th final');
    assignPlace(match11.winner, 11, '11th (l-race)');
    assignPlace(match11.loser, 12, '12th (l-race)');

    // final 13th/14th: remaining unassigned rosters (deterministic by seed)
    const remaining = allRosterIds.filter(id => !assigned.has(String(id)));
    remaining.sort((a,b) => (placementMap[a]||999) - (placementMap[b]||999));
    if (remaining.length >= 2) {
      const r13 = resolveMatch(placementMap[remaining[0]] || 13, placementMap[remaining[1]] || 14, '13th final');
      assignPlace(r13.winner, 13, '13th (final)');
      assignPlace(r13.loser, 14, '14th (final)');
    } else {
      // fill any leftover deterministically
      for (let i = 0; i < remaining.length; i++) assignPlace(remaining[i], 13 + i, 'final fill');
    }
  }

  // Ensure all rosters get a unique place
  const usedPlaces = new Set(Object.values(placeMap).map(p => Number(p)));
  const freePlaces = [];
  for (let p = 1; p <= N; p++) if (!usedPlaces.has(p)) freePlaces.push(p);
  const stillUnassigned = Object.keys(rosterMap || {}).map(String).filter(rid => !Object.prototype.hasOwnProperty.call(placeMap, rid));
  stillUnassigned.sort((a,b) => (placementMap[a]||999) - (placementMap[b]||999));
  for (let i = 0; i < stillUnassigned.length; i++) {
    const rid = stillUnassigned[i];
    const p = freePlaces[i] || (N - i);
    placeMap[rid] = p;
    debugLog.push(`Fallback assign ${p} -> ${metaFor(rid).team_name}`);
  }

  // Now build finalStandings[] sorted ascending by place
  const finalEntries = Object.keys(placeMap).map(rid => ({ rosterId: String(rid), place: Number(placeMap[rid]) }));
  finalEntries.sort((a,b) => a.place - b.place);
  const finalStandings = finalEntries.map(e => {
    const m = metaFor(e.rosterId);
    return {
      rank: e.place,
      rosterId: e.rosterId,
      team_name: m.team_name,
      owner_name: m.owner_name || null,
      avatar: m.avatar,
      seed: placementMap && placementMap[e.rosterId] ? Number(placementMap[e.rosterId]) : null
    };
  });

  return { finalStandings, placeMap, debugLog };
}

export async function load(event) {
  // edge cache header
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

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

  // dedupe by league id
  const byId = {};
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);

  // sort by season (old -> new)
  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  // selected season param (default to latest)
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = String(BASE_LEAGUE_ID);
    }
  }

  // determine leagueIdsToProcess (we only need the selected league for honor-hall)
  let selectedLeagueId = null;
  // try to match season or league_id in seasons array
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selectedSeasonParam || BASE_LEAGUE_ID);

  // Fetch league meta to determine playoff weeks
  let leagueMeta = null;
  try {
    leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 });
  } catch (e) {
    leagueMeta = null;
    messages.push('Failed fetching league meta for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }

  // determine playoff start/end using same fields as standings loader (fallback to 15)
  let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : null;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
    // fallback: try some known fields then set default
    playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      // fallback default (match standings' fallback behavior)
      playoffStart = 15;
      messages.push('Playoff start not found in metadata — defaulting to week ' + playoffStart);
    }
  }
  const playoffEnd = playoffStart + 2;

  // fetch roster map
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
  } catch (e) {
    rosterMap = {};
    messages.push('Failed fetching rosters for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }

  // --- compute regular-season standings by scrubbing matchups 1..(playoffStart-1) ---
  const statsByRosterRegular = {};
  const resultsByRosterRegular = {};
  const paByRosterRegular = {};

  // seed from rosterMap
  for (const rk in rosterMap) {
    if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
    statsByRosterRegular[String(rk)] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk].roster_raw ?? null };
    resultsByRosterRegular[String(rk)] = [];
    paByRosterRegular[String(rk)] = 0;
  }

  // regular weeks: 1 .. (playoffStart - 1)
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

    // group by matchup id | week
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
        // single-entry matches don't produce W/L in this schema
        continue;
      }

      // multi-entry: compute each participant's points and compare against opponents' average
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
        if (opponents.length) {
          oppAvg = opponents.reduce((acc, o) => acc + o.points, 0) / opponents.length;
        }
        paByRosterRegular[part.rosterId] = (paByRosterRegular[part.rosterId] || 0) + oppAvg;
        // determine result
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
  } // end regular weeks loop

  // Build sorted regular standings (same scheme as standings route)
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
    // sort by wins desc, then pf desc (same as standings)
    out.sort((a,b) => {
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      return (b.pf || 0) - (a.pf || 0);
    });
    return out;
  }

  const regularStandings = buildStandingsFromTrackers(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular);

  // Build placement map rosterId -> placement (1-based) from regularStandings (used as seed fallback)
  const placementMap = {};
  for (let i = 0; i < regularStandings.length; i++) {
    placementMap[String(regularStandings[i].rosterId)] = i + 1;
  }

  // --- fetch playoff matchups (playoffStart .. playoffEnd) and build matchupsRows ---
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

  // group by matchup id + week
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
  const keysM = Object.keys(byMatch);
  for (let ki = 0; ki < keysM.length; ki++) {
    const entries = byMatch[keysM[ki]];
    if (!entries || entries.length === 0) continue;

    // single participant -> bye
    if (entries.length === 1) {
      const a = entries[0];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const aMeta = rosterMap[aId] || {};
      const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const aPlacement = placementMap[aId] ?? null;

      matchupsRows.push({
        matchup_id: keysM[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement },
        teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, placement: null },
        participantsCount: 1
      });
      continue;
    }

    // two participants -> normal row
    if (entries.length === 2) {
      const a = entries[0];
      const b = entries[1];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
      const aMeta = rosterMap[aId] || {};
      const bMeta = rosterMap[bId] || {};
      const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
      const bName = bMeta.team_name || bMeta.owner_name || ('Roster ' + bId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
      const bAvatar = bMeta.team_avatar || bMeta.owner_avatar || null;
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? null);
      const aPlacement = placementMap[aId] ?? null;
      const bPlacement = placementMap[bId] ?? null;

      matchupsRows.push({
        matchup_id: keysM[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement },
        teamB: { rosterId: bId, name: bName, avatar: bAvatar, points: bPts, placement: bPlacement },
        participantsCount: 2
      });
      continue;
    }

    // multi-participant: aggregate
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
      matchup_id: keysM[ki],
      season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
      week: entries[0].week ?? entries[0].w ?? null,
      combinedParticipants: participants,
      combinedLabel,
      participantsCount: participants.length
    });
  }

  // sort rows by week desc then placement ascending (so finals / higher rounds first)
  matchupsRows.sort((x,y) => {
    const wx = Number(x.week ?? 0), wy = Number(y.week ?? 0);
    if (wy !== wx) return wy - wx;
    // prefer matches involving higher-placed teams earlier
    const ax = x.teamA?.placement ?? (x.combinedParticipants ? (x.combinedParticipants[0]?.placement ?? 999) : 999);
    const by = y.teamA?.placement ?? (y.combinedParticipants ? (y.combinedParticipants[0]?.placement ?? 999) : 999);
    return (ax - by);
  });

  // Now call simulateBracket to produce finalStandings/placeMap/debugLog
  const simulationResult = simulateBracket({
    matchupsRows,
    placementMap,
    rosterMap,
    regularStandings,
    seasonKey: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : selectedSeasonParam,
    playoffStart,
    playoffEnd
  });

  const finalStandings = simulationResult.finalStandings || [];
  const placeMap = simulationResult.placeMap || {};
  const debugLog = simulationResult.debugLog || [];

  // -------------------------
  // MVP computation (new)
  // - finalsMvp: player who started and scored the most points in the championship game
  // - overallMvp: player who scored the most points as a starter across the whole season
  // This is intentionally isolated and does not change finalStandings logic.
  // -------------------------

  // helper: try a few sleeper client methods to fetch boxscore-like rows for a given week
  async function fetchMatchupsRowsForWeek(leagueId, week) {
    // try a couple of common client helper names, defensive
    const ttlOpt = { ttl: 60 * 5 };
    try {
      if (typeof sleeper.getBoxscoresForWeek === 'function') {
        const out = await sleeper.getBoxscoresForWeek(leagueId, week, ttlOpt);
        if (Array.isArray(out)) return out;
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof sleeper.getBoxscoreForWeek === 'function') {
        const out = await sleeper.getBoxscoreForWeek(leagueId, week, ttlOpt);
        if (Array.isArray(out)) return out;
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof sleeper.getMatchupBoxscores === 'function') {
        const out = await sleeper.getMatchupBoxscores(leagueId, week, ttlOpt);
        if (Array.isArray(out)) return out;
      }
    } catch (e) { /* ignore */ }

    // fallback to matchups endpoint
    try {
      if (typeof sleeper.getMatchupsForWeek === 'function') {
        const out = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 });
        if (Array.isArray(out)) return out;
      }
    } catch (e) { /* ignore */ }

    // last resort: use already-fetched playoff rawMatchups if it includes this week
    try {
      const rows = rawMatchups.filter(r => Number(r.week) === Number(week));
      if (rows && rows.length) return rows;
    } catch (e) { /* ignore */ }

    return null;
  }

  // normalize common shapes into per-roster rows containing array of { playerId, points, starter }
  function normalizeBoxscoresRowsToRosterPlayers(rows) {
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (const r of rows) {
      // Several shapes:
      // 1) per-roster row: { roster_id, players: [ { player_id, points, starter } ] }
      const rid = String(r.roster_id ?? r.rosterId ?? r.owner_id ?? r.ownerId ?? r.teamId ?? r.roster ?? '');
      if (!rid) {
        // If it's a matchup row with teamA/teamB, handle below
      } else {
        if (Array.isArray(r.players) && r.players.length) {
          const players = r.players.map(p => ({
            playerId: p.player_id ?? p.playerId ?? p.player ?? p.id,
            points: safeNum(p.points ?? p.pts ?? p.fp ?? 0),
            starter: Boolean(p.starter ?? p.is_starter ?? p.isStarter ?? p.lineupStarter ?? true)
          }));
          out.push({ rosterId: rid, players });
          continue;
        }
        if (Array.isArray(r.starters) && r.starters.length) {
          const players = r.starters.map(pid => ({
            playerId: pid,
            points: safeNum((r.player_points && (r.player_points[pid] ?? r.starters_points && r.starters_points[pid])) ?? 0),
            starter: true
          }));
          out.push({ rosterId: rid, players });
          continue;
        }
        const maybePlayers = r.player_list ?? r.lineup ?? r.players_list ?? null;
        if (Array.isArray(maybePlayers) && maybePlayers.length) {
          const players = maybePlayers.map(p => ({
            playerId: p.player_id ?? p.player ?? p.id,
            points: safeNum(p.points ?? p.pts ?? 0),
            starter: Boolean(p.starter ?? p.isStarter ?? true)
          }));
          out.push({ rosterId: rid, players });
          continue;
        }
      }

      // 2) matchup object shape: { teamA: {...}, teamB: {...} }
      if (r.teamA || r.teamB) {
        if (r.teamA && r.teamA.rosterId) {
          const playersA = [];
          if (Array.isArray(r.teamA.players) && r.teamA.players.length) {
            for (const p of r.teamA.players) playersA.push({ playerId: p.player_id ?? p.player ?? p.id, points: safeNum(p.points ?? p.pts ?? 0), starter: Boolean(p.starter ?? true) });
          }
          out.push({ rosterId: String(r.teamA.rosterId), players: playersA });
        }
        if (r.teamB && r.teamB.rosterId) {
          const playersB = [];
          if (Array.isArray(r.teamB.players) && r.teamB.players.length) {
            for (const p of r.teamB.players) playersB.push({ playerId: p.player_id ?? p.player ?? p.id, points: safeNum(p.points ?? p.pts ?? 0), starter: Boolean(p.starter ?? true) });
          }
          out.push({ rosterId: String(r.teamB.rosterId), players: playersB });
        }
        continue;
      }

      // 3) combinedParticipants (from earlier normalization)
      if (Array.isArray(r.combinedParticipants) && r.combinedParticipants.length) {
        // combinedParticipants items might include rosterId and points
        for (const cp of r.combinedParticipants) {
          // try find corresponding rosterId in out; if not present, add with empty players array
          const pRid = String(cp.rosterId ?? '');
          if (!pRid) continue;
          const existing = out.find(x => String(x.rosterId) === pRid);
          if (!existing) out.push({ rosterId: pRid, players: [] });
        }
        continue;
      }

      // unknown shape -> skip
    }
    return out;
  }

  // helper to resolve player name via sleeper client (defensive)
  const playerNameCache = {};
  async function resolvePlayerName(playerId) {
    const pid = String(playerId);
    if (playerNameCache[pid]) return playerNameCache[pid];
    // try a few common methods exposed by various sleepers SDKs
    try {
      if (typeof sleeper.getPlayer === 'function') {
        const p = await sleeper.getPlayer(pid);
        if (p && (p.full_name || p.name)) {
          playerNameCache[pid] = p.full_name || p.name;
          return playerNameCache[pid];
        }
        if (p && p.player_id && p.player_id === pid && p.name) {
          playerNameCache[pid] = p.name;
          return playerNameCache[pid];
        }
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof sleeper.getPlayersByIds === 'function') {
        const map = await sleeper.getPlayersByIds([pid]);
        if (map && map[pid] && (map[pid].full_name || map[pid].name)) {
          playerNameCache[pid] = map[pid].full_name || map[pid].name;
          return playerNameCache[pid];
        }
      }
    } catch (e) { /* ignore */ }
    // fallback: return id
    playerNameCache[pid] = pid;
    return pid;
  }

  // === overall MVP: starters-only points across weeks 1..playoffEnd ===
  let overallMvp = null;
  try {
    const playerTotals = {}; // pid -> total points (starters only)
    const playerRosterSeen = {}; // pid -> rosterId seen for that starter

    for (let wk = 1; wk <= playoffEnd; wk++) {
      const weekRows = await fetchMatchupsRowsForWeek(selectedLeagueId, wk);
      if (!weekRows) continue;
      const perRoster = normalizeBoxscoresRowsToRosterPlayers(weekRows);
      for (const bs of perRoster) {
        const rid = String(bs.rosterId ?? '');
        if (!Array.isArray(bs.players)) continue;
        for (const p of bs.players) {
          if (!p.playerId) continue;
          if (!p.starter) continue; // only count starters
          const pid = String(p.playerId);
          const pts = safeNum(p.points);
          playerTotals[pid] = (playerTotals[pid] || 0) + pts;
          if (!playerRosterSeen[pid]) playerRosterSeen[pid] = rid || null;
        }
      }
    }

    let bestPid = null;
    let bestPts = -Infinity;
    for (const pid of Object.keys(playerTotals)) {
      if (playerTotals[pid] > bestPts) {
        bestPts = playerTotals[pid];
        bestPid = pid;
      }
    }
    if (bestPid) {
      overallMvp = {
        playerId: bestPid,
        playerName: await resolvePlayerName(bestPid),
        points: Math.round((playerTotals[bestPid] || 0) * 100) / 100,
        rosterId: playerRosterSeen[bestPid] ?? null,
        roster_meta: playerRosterSeen[bestPid] ? (rosterMap[playerRosterSeen[bestPid]] || null) : null
      };
    }
  } catch (e) {
    // don't break final standings
    messages.push('MVP (overall) computation error: ' + (e?.message ?? String(e)));
    overallMvp = null;
  }

  // === finals MVP: inspect the championship matchup roster rows directly ===
  let finalsMvp = null;
  try {
    // try to locate the final pairing we used in simulation: find the final participants
    // We can infer them from placeMap (rank 1 and rank 2)
    const championEntry = Object.keys(placeMap).find(rid => Number(placeMap[rid]) === 1);
    const runnerupEntry = Object.keys(placeMap).find(rid => Number(placeMap[rid]) === 2);
    if (championEntry && runnerupEntry) {
      // attempt to find the playoff matchup row containing both these rosterIds
      let finalWeek = null;
      let finalRow = null;
      // prefer matchupsRows (we already fetched playoff matchups for playoff weeks)
      for (const r of matchupsRows) {
        if (!r.week) continue;
        if (r.participantsCount === 2) {
          const a = String(r.teamA.rosterId), b = String(r.teamB.rosterId);
          if ((a === championEntry && b === runnerupEntry) || (a === runnerupEntry && b === championEntry)) {
            finalWeek = Number(r.week);
            finalRow = r;
            break;
          }
        } else if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
          const ids = r.combinedParticipants.map(p => String(p.rosterId));
          if (ids.includes(championEntry) && ids.includes(runnerupEntry)) {
            finalWeek = Number(r.week);
            finalRow = r;
            break;
          }
        }
      }

      // if not found, fetch playoff weeks explicitly and attempt to find the matchup
      if (!finalRow) {
        for (let wk = playoffStart; wk <= playoffEnd; wk++) {
          const wkRows = await fetchMatchupsRowsForWeek(selectedLeagueId, wk);
          if (!wkRows) continue;
          // normalize shapes and also look for teamA/teamB shapes
          for (const r of wkRows) {
            // shape: teamA/teamB
            if (r.teamA && r.teamB) {
              const a = String(r.teamA.rosterId ?? r.teamA.roster_id ?? r.teamA.rosterId);
              const b = String(r.teamB.rosterId ?? r.teamB.roster_id ?? r.teamB.rosterId);
              if ((a === championEntry && b === runnerupEntry) || (a === runnerupEntry && b === championEntry)) {
                finalWeek = wk;
                finalRow = r;
                break;
              }
            }
            // combinedParticipants or per-roster shapes handled by normalize
            if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
              const ids = r.combinedParticipants.map(p => String(p.rosterId));
              if (ids.includes(championEntry) && ids.includes(runnerupEntry)) {
                finalWeek = wk;
                finalRow = r;
                break;
              }
            }
          }
          if (finalRow) break;
        }
      }

      // If we found a finalRow or finalWeek, normalize boxscore rows for that week and search starters
      if (finalWeek) {
        const fwRows = await fetchMatchupsRowsForWeek(selectedLeagueId, finalWeek);
        const perRoster = normalizeBoxscoresRowsToRosterPlayers(fwRows || []);
        const finalists = perRoster.filter(pr => String(pr.rosterId) === String(championEntry) || String(pr.rosterId) === String(runnerupEntry));
        const candidates = [];
        for (const pr of finalists) {
          for (const p of pr.players) {
            if (!p.playerId || !p.starter) continue;
            candidates.push({ playerId: p.playerId, rosterId: pr.rosterId, points: safeNum(p.points) });
          }
        }
        if (candidates.length) {
          candidates.sort((a,b) => b.points - a.points);
          const top = candidates[0];
          finalsMvp = {
            playerId: top.playerId,
            playerName: await resolvePlayerName(top.playerId),
            points: Math.round(top.points * 100) / 100,
            rosterId: top.rosterId,
            roster_meta: rosterMap[top.rosterId] || null
          };
        }
      }
    }
  } catch (e) {
    messages.push('MVP (finals) computation error: ' + (e?.message ?? String(e)));
    finalsMvp = null;
  }

  // Determine champion / biggest loser (for UI)
  const champion = finalStandings && finalStandings.length ? finalStandings[0] : null;
  const biggestLoser = finalStandings && finalStandings.length ? finalStandings[finalStandings.length - 1] : null;

  // Expose results in return payload
  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    matchupsRows,
    regularStandings,
    finalStandings,
    placeMap,
    debugLog,
    finalsMvp,
    overallMvp,
    champion,
    biggestLoser,
    messages,
    prevChain
  };
}
