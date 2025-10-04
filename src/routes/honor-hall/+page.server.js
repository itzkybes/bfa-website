// src/routes/honor-hall/+page.server.js
// Honor Hall loader + bracket simulation (including 2022 special-case)

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

/**
 * computeFinal2022 - special-case bracket simulation for season 2022
 * Accepts:
 *   rosterMap, placementMap, placementToRoster, matchupsRows, regularStandings, playoffStart
 * Returns:
 *   { finalStandings, debug }
 *
 * This is the bespoke 2022 flow you specified earlier.
 */
function computeFinal2022({ rosterMap, placementMap, placementToRoster, matchupsRows, regularStandings, playoffStart }) {
  const debug = [];
  debug.push(`Loaded rosters (${Object.keys(rosterMap || {}).length})`);

  // helper meta
  function metaFor(rid) {
    const m = rosterMap && rosterMap[String(rid)] ? rosterMap[String(rid)] : {};
    return {
      rosterId: String(rid),
      team_name: m.team_name || m.owner_name || ('Roster ' + String(rid)),
      owner_name: m.owner_name ?? m.owner_username ?? null,
      avatar: m.team_avatar || m.owner_avatar || null,
      seed: placementMap && placementMap[String(rid)] ? Number(placementMap[String(rid)]) : null
    };
  }

  // find match row between two roster ids
  function findMatch(aRid, bRid, preferredWeeks = [playoffStart, playoffStart + 1, playoffStart + 2]) {
    if (!aRid || !bRid) return null;
    aRid = String(aRid); bRid = String(bRid);
    for (const wk of preferredWeeks) {
      for (const r of matchupsRows || []) {
        if (!r.week || Number(r.week) !== Number(wk)) continue;
        if (r.participantsCount === 2) {
          const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
          if ((p1 === aRid && p2 === bRid) || (p1 === bRid && p2 === aRid)) return r;
        } else if (Array.isArray(r.combinedParticipants)) {
          const ids = r.combinedParticipants.map(p => String(p.rosterId));
          if (ids.includes(aRid) && ids.includes(bRid)) return r;
        }
      }
    }
    // fallback scan
    for (const r of matchupsRows || []) {
      if (r.participantsCount === 2) {
        const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
        if ((p1 === aRid && p2 === bRid) || (p1 === bRid && p2 === aRid)) return r;
      } else if (Array.isArray(r.combinedParticipants)) {
        const ids = r.combinedParticipants.map(p => String(p.rosterId));
        if (ids.includes(aRid) && ids.includes(bRid)) return r;
      }
    }
    return null;
  }

  // pf map for tiebreak decisions
  const pfMap = {};
  (regularStandings || []).forEach(r => { pfMap[String(r.rosterId)] = Number(r.pf ?? 0); });

  function decideFromMatch(matchRow, a, b) {
    if (!matchRow) return null;
    let aPts = null, bPts = null;
    if (matchRow.participantsCount === 2) {
      const pA = String(matchRow.teamA.rosterId), pB = String(matchRow.teamB.rosterId);
      if (pA === String(a)) { aPts = matchRow.teamA.points; bPts = matchRow.teamB.points; }
      else { aPts = matchRow.teamB.points; bPts = matchRow.teamA.points; }
    } else if (Array.isArray(matchRow.combinedParticipants)) {
      const pa = matchRow.combinedParticipants.find(p => String(p.rosterId) === String(a));
      const pb = matchRow.combinedParticipants.find(p => String(p.rosterId) === String(b));
      aPts = pa?.points ?? 0; bPts = pb?.points ?? 0;
    }
    if (aPts == null || bPts == null) return null;
    if (aPts > bPts + 1e-9) return { winner: String(a), loser: String(b), method: 'matchup' };
    if (bPts > aPts + 1e-9) return { winner: String(b), loser: String(a), method: 'matchup' };
    // tiebreak pf
    const aPf = pfMap[String(a)] ?? 0, bPf = pfMap[String(b)] ?? 0;
    if (aPf > bPf) return { winner: String(a), loser: String(b), method: 'tiebreak-pf' };
    if (bPf > aPf) return { winner: String(b), loser: String(a), method: 'tiebreak-pf' };
    // fallback deterministic
    const aSeed = placementMap[String(a)] ?? 999, bSeed = placementMap[String(b)] ?? 999;
    if (aSeed < bSeed) return { winner: String(a), loser: String(b), method: 'tiebreak-seed' };
    if (bSeed < aSeed) return { winner: String(b), loser: String(a), method: 'tiebreak-seed' };
    return { winner: String(a) < String(b) ? String(a) : String(b), loser: String(a) < String(b) ? String(b) : String(a), method: 'fallback' };
  }

  function runPair(seedA, seedB, label) {
    const aRid = placementToRoster[seedA] ?? null;
    const bRid = placementToRoster[seedB] ?? null;
    if (!aRid || !bRid) {
      debug.push(`${label} ${seedA}v${seedB} -> missing-roster`);
      return { winner: aRid || bRid, loser: aRid ? bRid : aRid, method: 'missing-roster' };
    }
    const row = findMatch(aRid, bRid);
    const dec = decideFromMatch(row, aRid, bRid);
    if (dec) {
      const winSeed = placementMap[dec.winner] ?? dec.winner;
      debug.push(`${label} ${seedA}v${seedB} -> ${winSeed} (matchup)`);
      return dec;
    }
    // fallback: use pf/seed
    const aPf = pfMap[aRid] ?? 0, bPf = pfMap[bRid] ?? 0;
    let winner = null, loser = null, method = 'fallback-no-match';
    if (aPf !== bPf) { winner = aPf > bPf ? aRid : bRid; loser = winner === aRid ? bRid : aRid; method = 'tiebreak-pf'; }
    else {
      const aSeed = placementMap[aRid] ?? 999, bSeed = placementMap[bRid] ?? 999;
      if (aSeed !== bSeed) { winner = aSeed < bSeed ? aRid : bRid; loser = winner === aRid ? bRid : aRid; method = 'tiebreak-seed'; }
      else { winner = aRid < bRid ? aRid : bRid; loser = winner === aRid ? bRid : aRid; method = 'fallback' ;}
    }
    debug.push(`${label} ${seedA}v${seedB} -> ${placementMap[winner] ?? winner} (${method})`);
    return { winner, loser, method };
  }

  // Start building per your provided 2022 trace:
  // W1 4v5, W1 3v6
  const r_w1_4v5 = runPair(4, 5, 'W1 4v5');
  const r_w1_3v6 = runPair(3, 6, 'W1 3v6');

  // Semis: 1 vs winner(4v5), 2 vs winner(3v6)
  const semi1OppSeed = (r_w1_4v5.winner && placementMap[r_w1_4v5.winner]) ? placementMap[r_w1_4v5.winner] : (r_w1_4v5.winner ? r_w1_4v5.winner : 4);
  const semi2OppSeed = (r_w1_3v6.winner && placementMap[r_w1_3v6.winner]) ? placementMap[r_w1_3v6.winner] : (r_w1_3v6.winner ? r_w1_3v6.winner : 3);

  const r_semi1 = runPair(1, semi1OppSeed, 'Semi 1v4');
  const r_semi2 = runPair(2, semi2OppSeed, 'Semi 2v6');

  // Final: winners
  const finalSeedA = r_semi1.winner ? placementMap[r_semi1.winner] ?? r_semi1.winner : 1;
  const finalSeedB = r_semi2.winner ? placementMap[r_semi2.winner] ?? r_semi2.winner : 2;
  const r_final = runPair(finalSeedA, finalSeedB, 'Final 1v2');

  // 3rd: losers of semis (3rd 4v6 per trace)
  const semiLoserSeedA = r_semi1.loser ? placementMap[r_semi1.loser] ?? r_semi1.loser : null;
  const semiLoserSeedB = r_semi2.loser ? placementMap[r_semi2.loser] ?? r_semi2.loser : null;
  let r_3rd = null;
  if (semiLoserSeedA && semiLoserSeedB) {
    r_3rd = runPair(semiLoserSeedA, semiLoserSeedB, `3rd ${semiLoserSeedA}v${semiLoserSeedB}`);
  }

  // champion & runner-up assign
  const placeMap = {};
  const assigned = new Set();

  function assignPlaceUnique(rosterId, place, note = '') {
    rosterId = String(rosterId);
    if (!rosterId) return;
    let p = Number(place);
    // ensure unique by bumping if already used
    const used = new Set(Object.values(placeMap).map(x => Number(x)));
    while (used.has(p)) p++;
    placeMap[rosterId] = p;
    assigned.add(rosterId);
    debug.push(`Assign place ${p} -> ${metaFor(rosterId).team_name}${note ? ' ('+note+')' : ''}`);
  }

  // assign final places
  if (r_final && r_final.winner) assignPlaceUnique(r_final.winner, 1, 'champion (final)');
  if (r_final && r_final.loser) assignPlaceUnique(r_final.loser, 2, 'runner-up (final)');

  if (r_3rd && r_3rd.winner) assignPlaceUnique(r_3rd.winner, 3, '3rd (matchup)');
  if (r_3rd && r_3rd.loser) assignPlaceUnique(r_3rd.loser, 4, '4th (matchup)');

  // 5th/6th: per your trace "5th 5v3 -> 3 (matchup)"
  const r_5th = runPair(5, 3, '5th 5v3');
  if (r_5th && r_5th.winner) assignPlaceUnique(r_5th.winner, 5, '5th (consolation)');
  if (r_5th && r_5th.loser) assignPlaceUnique(r_5th.loser, 6, '6th (consolation)');

  // Loser-race pairs: 9v12, 10v11, 7v14, 8v13
  const lr1 = runPair(9, 12, 'LRace 9v12');
  const lr2 = runPair(10, 11, 'LRace 10v11');
  const lr3 = runPair(7, 14, 'LRace 7v14');
  const lr4 = runPair(8, 13, 'LRace 8v13');

  // Consolation LRace1: 7v10 -> 10, 8v9 -> 9 per trace (we run the matches)
  const cl1 = runPair(7, 10, 'Consolation LRace1 7v10');
  const cl2 = runPair(8, 9, 'Consolation LRace1 8v9');

  // LRaceSemi placeholders: 11v14 and 12v13
  const lrsemi1 = runPair(11, 14, 'LRaceSemi 11v14');
  const lrsemi2 = runPair(12, 13, 'LRaceSemi 12v13');

  // 7th: per trace "7th 10v9 -> 9 (matchup)"
  const r7 = runPair(10, 9, '7th 10v9');
  if (r7 && r7.winner) assignPlaceUnique(r7.winner, 7, '7th (matchup)');
  if (r7 && r7.loser) assignPlaceUnique(r7.loser, 8, '8th (matchup)');

  // 9th: per trace "9th 7v8 -> 8 (matchup)"
  const r9 = runPair(7, 8, '9th 7v8');
  if (r9 && r9.winner) assignPlaceUnique(r9.winner, 9, '9th (matchup)');
  if (r9 && r9.loser) assignPlaceUnique(r9.loser, 10, '10th (matchup)');

  // 11th: per trace "11th 11v13 -> 13 (fallback-no-match)" - we still run pair
  const r11 = runPair(11, 13, '11th 11v13');
  if (r11 && r11.winner) assignPlaceUnique(r11.winner, 11, '11th (matchup/fallback)');
  if (r11 && r11.loser) assignPlaceUnique(r11.loser, 12, '12th (matchup/fallback)');

  // 13th: 14v12 -> 14 (per trace)
  const r13 = runPair(14, 12, '13th 14v12');
  if (r13 && r13.winner) assignPlaceUnique(r13.winner, 13, '13th (matchup)');
  if (r13 && r13.loser) assignPlaceUnique(r13.loser, 14, '14th (matchup)');

  // ensure every roster gets a place (unique)
  const allRosterIds = Object.keys(rosterMap || {}).map(String);
  const usedPlaces = new Set(Object.values(placeMap).map(x => Number(x)));
  const freePlaces = [];
  const N = Math.max(14, allRosterIds.length || 14);
  for (let p = 1; p <= N; p++) if (!usedPlaces.has(p)) freePlaces.push(p);
  const stillUnassigned = allRosterIds.filter(rid => !Object.prototype.hasOwnProperty.call(placeMap, rid));
  stillUnassigned.sort((a,b) => (placementMap[a]||999) - (placementMap[b]||999));
  for (let i = 0; i < stillUnassigned.length; i++) {
    const rid = stillUnassigned[i];
    const p = freePlaces[i] || (N - i);
    placeMap[rid] = p;
    debug.push(`Fallback assign ${p} -> ${metaFor(rid).team_name}`);
  }

  // Build finalStandings[] sorted ascending by place
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

  return { finalStandings, debug };
}

/**
 * computeFinalForLeague - general bracket simulation for most seasons (non-2022)
 * Accepts:
 *   leagueId, seasonKey, rosterMap, placementMap, placementToRoster, matchupsRows, regularStandings, playoffStart
 * Returns:
 *   { finalStandings, debug }
 *
 * This is adapted from your general algorithm example.
 */
function computeFinalForLeague({ leagueId, seasonKey, rosterMap, placementMap, placementToRoster, matchupsRows, regularStandings, playoffStart }) {
  const trace = [];
  trace.push(`Loaded rosters (${Object.keys(rosterMap || {}).length})`);

  // helpers
  function findMatchForPair(rA, rB, preferredWeeks = [playoffStart, playoffStart + 1, playoffStart + 2]) {
    if (!rA || !rB) return null;
    const a = String(rA), b = String(rB);
    for (const wk of preferredWeeks) {
      for (const r of matchupsRows || []) {
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
    for (const r of matchupsRows || []) {
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

  function runMatch(seedA, seedB, label, preferredWeeks = [playoffStart, playoffStart + 1, playoffStart + 2]) {
    const a = seedA.rosterId, b = seedB.rosterId;
    if (!a || !b) {
      trace.push(`${label} ${seedA.seed}v${seedB.seed} -> missing-roster`);
      return { winner: a || b, loser: a ? b : a, reason: 'missing-roster' };
    }
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

  // Build winners/losers lists by seed
  const winnersSeeds = [];
  const losersSeeds = [];
  for (let s = 1; s <= 14; s++) {
    const rid = placementToRoster[s] ?? null;
    if (!rid) continue;
    if (s <= 8) winnersSeeds.push({ seed: s, rosterId: rid });
    else losersSeeds.push({ seed: s, rosterId: rid });
  }

  // W1 pairs
  function pairObj(nums) { return { a: {seed: nums[0], rosterId: placementToRoster[nums[0]]}, b: {seed: nums[1], rosterId: placementToRoster[nums[1]]} }; }
  const wR1PairsNums = [[1,8],[2,7],[3,6],[4,5]];
  const wR1Pairs = wR1PairsNums.map(pairObj);
  const wR1Results = [];
  for (const p of wR1Pairs) {
    const res = runMatch(p.a, p.b, `W1`);
    wR1Results.push(res);
  }

  const wR1Winners = wR1Results.map(r => ({ seed: placementMap[r.winner] ?? null, rosterId: r.winner, loserId: r.loser }));
  const wR1Losers = wR1Results.map(r => ({ seed: placementMap[r.loser] ?? null, rosterId: r.loser, winnerId: r.winner }));

  wR1Winners.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const wSemiPairs = [
    [ wR1Winners[0], wR1Winners[wR1Winners.length-1] ],
    [ wR1Winners[1], wR1Winners[wR1Winners.length-2] ]
  ];

  const wSemiResults = [];
  for (const pair of wSemiPairs) {
    if (!pair[0] || !pair[1]) { wSemiResults.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[1]?.rosterId || pair[0]?.rosterId }); continue; }
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
    if (!pair[0] || !pair[1]) { cR1Results.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[1]?.rosterId || pair[0]?.rosterId }); continue; }
    const res = runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}, `Consolation R1`);
    cR1Results.push(res);
  }

  const fifthRes = (cR1Results.length >= 2) ? runMatch({seed: placementMap[cR1Results[0].winner], rosterId: cR1Results[0].winner}, {seed: placementMap[cR1Results[1].winner], rosterId: cR1Results[1].winner}, `5th`) : null;
  const seventhRes = (cR1Results.length >= 2) ? runMatch({seed: placementMap[cR1Results[0].loser], rosterId: cR1Results[0].loser}, {seed: placementMap[cR1Results[1].loser], rosterId: cR1Results[1].loser}, `7th`) : null;

  // Losers bracket (corrected)
  const lPairsSeedNums = [[9,12],[10,11]];
  const lR1Results = [];
  const lBySeed = {};
  for (const s of losersSeeds) lBySeed[s.seed] = s;

  for (const [s1,s2] of lPairsSeedNums) {
    const objA = lBySeed[s1] || {seed:s1, rosterId: placementToRoster[s1]};
    const objB = lBySeed[s2] || {seed:s2, rosterId: placementToRoster[s2]};
    const res = runMatch({seed: objA.seed, rosterId: objA.rosterId}, {seed: objB.seed, rosterId: objB.rosterId}, `LRace`);
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
    const res = runMatch({seed: left.seed, rosterId: left.rosterId}, {seed: right.seed, rosterId: right.rosterId}, `LRaceSemi`);
    lSemiResults.push(res);
  }

  // 9th final
  let lFinalRes = null;
  if (lWinners.length >= 2) {
    lFinalRes = runMatch({seed: lWinners[0].seed, rosterId: lWinners[0].rosterId}, {seed: lWinners[1].seed, rosterId: lWinners[1].rosterId}, `9th`);
  } else if (lWinners.length === 1) {
    lFinalRes = { winner: lWinners[0].rosterId, loser: null, reason: 'auto' };
    trace.push(`9th auto -> ${placementMap[lWinners[0].rosterId] ?? lWinners[0].rosterId} (single-winner)`);
  }

  // 11th & 13th from lSemiResults
  let l11Res = null, l13Res = null;
  if (lSemiResults.length >= 2) {
    const semiWinners = lSemiResults.map(r => ({ rosterId: r.winner, seed: placementMap[r.winner] ?? null }));
    const semiLosers = lSemiResults.map(r => ({ rosterId: r.loser, seed: placementMap[r.loser] ?? null }));
    if (semiWinners.length >= 2) l11Res = runMatch({seed: semiWinners[0].seed, rosterId: semiWinners[0].rosterId}, {seed: semiWinners[1].seed, rosterId: semiWinners[1].rosterId}, `11th`);
    if (semiLosers.length >= 2) l13Res = runMatch({seed: semiLosers[0].seed, rosterId: semiLosers[0].rosterId}, {seed: semiLosers[1].seed, rosterId: semiLosers[1].rosterId}, `13th`);
  } else if (lSemiResults.length === 1) {
    l11Res = { winner: lSemiResults[0].winner, loser: null, reason: 'only-semi' };
    l13Res = { winner: lSemiResults[0].loser, loser: null, reason: 'only-semi' };
    trace.push(`LRaceSemi single -> 11th ${placementMap[lSemiResults[0].winner] ?? lSemiResults[0].winner} , 13th ${placementMap[lSemiResults[0].loser] ?? lSemiResults[0].loser}`);
  }

  // Build final ordered list
  const assigned = new Set();
  const placementFinal = [];

  function pushIfNotAssigned(rosterId) {
    if (!rosterId) return;
    const r = String(rosterId);
    if (!assigned.has(r)) { placementFinal.push(r); assigned.add(r); }
  }

  function pushResultPair(resObj) {
    if (!resObj) return;
    pushIfNotAssigned(resObj.winner);
    if (resObj.loser) pushIfNotAssigned(resObj.loser);
  }

  // push winners bracket outcomes
  pushResultPair(finalRes);
  pushResultPair(thirdRes);
  pushResultPair(fifthRes);
  pushResultPair(seventhRes);

  // losers bracket outcomes
  pushResultPair(lFinalRes);
  pushResultPair(l11Res);
  pushResultPair(l13Res);

  // include any playoff match rows with unassigned rosters
  for (const r of matchupsRows || []) {
    if (r.participantsCount === 2) {
      pushIfNotAssigned(r.teamA.rosterId);
      pushIfNotAssigned(r.teamB.rosterId);
    } else if (Array.isArray(r.combinedParticipants)) {
      for (const p of r.combinedParticipants) pushIfNotAssigned(p.rosterId);
    } else if (r.teamA && r.teamA.rosterId) pushIfNotAssigned(r.teamA.rosterId);
  }

  // include any rosterMap entries not yet assigned
  for (const rk in rosterMap) pushIfNotAssigned(rk);

  // finalize and fill any missing
  const totalTeams = Object.keys(rosterMap).length || placementFinal.length;
  if (placementFinal.length < totalTeams) {
    for (const rk in rosterMap) {
      if (!assigned.has(String(rk))) { placementFinal.push(String(rk)); assigned.add(String(rk)); }
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
      owner_name: meta.owner_name ?? meta.owner_username ?? null,
      avatar: meta.team_avatar || meta.owner_avatar || null,
      seed: placementMap[rid] ?? null,
      pf: regularStandings.find(s => String(s.rosterId) === rid)?.pf ?? 0,
      wins: regularStandings.find(s => String(s.rosterId) === rid)?.wins ?? 0
    });
  }

  // stable reorder/fallback unique ranks
  finalStandings.sort((a,b) => {
    if ((a.rank || 0) !== (b.rank || 0)) return (a.rank || 0) - (b.rank || 0);
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    if ((b.pf || 0) !== (a.pf || 0)) return (b.pf || 0) - (a.pf || 0);
    return (a.seed || 999) - (b.seed || 999);
  });
  for (let i = 0; i < finalStandings.length; i++) finalStandings[i].rank = i + 1;

  return { finalStandings, debug: trace };
}

/**
 * Main loader
 */
export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const incomingSeasonParam = url.searchParams.get('season') || null;

  const messages = [];
  const prevChain = [];

  // Build seasons chain (via previous_league_id)
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

  // determine league id for selected season
  let selectedLeagueId = null;
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selectedSeasonParam || BASE_LEAGUE_ID);

  // We'll compute final standings for every season in the chain (skipping 2022 on general path,
  // but we will call the special-case routine for 2022 below).
  const finalStandingsBySeason = {};

  for (const s of seasons) {
    const seasonKey = s.season != null ? String(s.season) : String(s.league_id);
    const leagueId = String(s.league_id);

    // fetch league meta (to get playoffs weeks)
    let leagueMeta = null;
    try {
      leagueMeta = await sleeper.getLeague(leagueId, { ttl: 60 * 5 });
    } catch (e) {
      leagueMeta = null;
    }
    let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
      if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) { playoffStart = 15; }
    }

    // fetch rosterMap for this league
    let rosterMap = {};
    try {
      rosterMap = await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 });
    } catch (e) {
      rosterMap = {};
    }

    // compute regular standings for tiebreaks (lightweight, same code used earlier)
    const statsByRosterRegular = {};
    const resultsByRosterRegular = {};
    const paByRosterRegular = {};
    for (const rk in rosterMap) {
      if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
      statsByRosterRegular[String(rk)] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: rosterMap[rk].roster_raw ?? null };
      resultsByRosterRegular[String(rk)] = [];
      paByRosterRegular[String(rk)] = 0;
    }

    // compute reg-season weeks summary for tiebreaks (only up to playoffStart -1)
    const regStart = 1;
    const regEnd = Math.max(1, playoffStart - 1);
    for (let week = regStart; week <= regEnd; week++) {
      let matchups = null;
      try {
        matchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 });
      } catch (errWeek) {
        matchups = null;
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
    } // end regular-season summary

    function buildStandingsFromTrackersLocal() {
      const keys = Object.keys(resultsByRosterRegular).length ? Object.keys(resultsByRosterRegular) : (rosterMap ? Object.keys(rosterMap) : []);
      const out = [];
      for (let i = 0; i < keys.length; i++) {
        const rid = keys[i];
        if (!Object.prototype.hasOwnProperty.call(statsByRosterRegular, rid)) {
          statsByRosterRegular[rid] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: (rosterMap && rosterMap[rid] ? rosterMap[rid].roster_raw : null) };
        }
        const s = statsByRosterRegular[rid];
        const wins = s.wins || 0;
        const losses = s.losses || 0;
        const ties = s.ties || 0;
        const pfVal = Math.round((s.pf || 0) * 100) / 100;
        const paVal = Math.round((paByRosterRegular[rid] || s.pa || 0) * 100) / 100;
        const meta = rosterMap && rosterMap[rid] ? rosterMap[rid] : {};
        const team_name = meta.team_name ? meta.team_name : ((s.roster && s.roster.metadata && s.roster.metadata.team_name) ? s.roster.metadata.team_name : ('Roster ' + rid));
        const owner_name = meta.owner_name || meta.owner_username || null;
        const avatar = meta.team_avatar || meta.owner_avatar || null;
        const resArr = resultsByRosterRegular && resultsByRosterRegular[rid] ? resultsByRosterRegular[rid] : [];
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

    const regularStandingsLocal = buildStandingsFromTrackersLocal();
    const placementMapLocal = {};
    for (let i = 0; i < regularStandingsLocal.length; i++) placementMapLocal[String(regularStandingsLocal[i].rosterId)] = i + 1;
    const placementToRosterLocal = {};
    for (const k in placementMapLocal) placementToRosterLocal[ placementMapLocal[k] ] = k;

    // normalize playoff matchups rows
    const rawMatchups = [];
    for (let wk = playoffStart; wk <= playoffStart + 2; wk++) {
      try {
        const wkMatchups = await sleeper.getMatchupsForWeek(leagueId, wk, { ttl: 60 * 5 });
        if (Array.isArray(wkMatchups) && wkMatchups.length) {
          for (const m of wkMatchups) {
            if (m && (m.week == null && m.w == null)) m.week = wk;
            rawMatchups.push(m);
          }
        }
      } catch (we) {
        // ignore per-season and continue
      }
    }

    const byMatch2 = {};
    for (let i = 0; i < rawMatchups.length; i++) {
      const e = rawMatchups[i];
      const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
      const wk = e.week ?? e.w ?? null;
      const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + i));
      if (!byMatch2[key]) byMatch2[key] = [];
      byMatch2[key].push(e);
    }

    const matchupsRowsLocal = [];
    const mkeys = Object.keys(byMatch2);
    for (let ki = 0; ki < mkeys.length; ki++) {
      const entries = byMatch2[mkeys[ki]];
      if (!entries || entries.length === 0) continue;
      if (entries.length === 1) {
        const a = entries[0];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
        const aMeta = rosterMap[aId] || {};
        const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
        const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
        const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
        const aPlacement = placementMapLocal[aId] ?? null;
        matchupsRowsLocal.push({
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
        const aPlacement = placementMapLocal[aId] ?? null;
        const bPlacement = placementMapLocal[bId] ?? null;
        matchupsRowsLocal.push({
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
          placement: placementMapLocal[pid] ?? null
        };
      });
      const combinedLabel = participants.map(p => p.name).join(' / ');
      matchupsRowsLocal.push({
        matchup_id: mkeys[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: entries[0].week ?? entries[0].w ?? null,
        combinedParticipants: participants,
        combinedLabel,
        participantsCount: participants.length
      });
    }

    // Select which compute path to use for this season
    try {
      if (String(s.season) === '2022') {
        // call the 2022 special-case routine
        const res2022 = computeFinal2022({
          rosterMap,
          placementMap: placementMapLocal,
          placementToRoster: placementToRosterLocal,
          matchupsRows: matchupsRowsLocal,
          regularStandings: regularStandingsLocal,
          playoffStart
        });
        finalStandingsBySeason[s.season != null ? String(s.season) : String(s.league_id)] = {
          finalStandings: res2022.finalStandings,
          debug: res2022.debug,
          rosterMap,
          leagueMeta
        };
      } else {
        // general path
        const res = computeFinalForLeague({
          leagueId,
          seasonKey: s.season != null ? String(s.season) : String(s.league_id),
          rosterMap,
          placementMap: placementMapLocal,
          placementToRoster: placementToRosterLocal,
          matchupsRows: matchupsRowsLocal,
          regularStandings: regularStandingsLocal,
          playoffStart
        });
        finalStandingsBySeason[s.season != null ? String(s.season) : String(s.league_id)] = {
          finalStandings: res.finalStandings,
          debug: res.debug,
          rosterMap,
          leagueMeta
        };
      }
    } catch (err) {
      finalStandingsBySeason[s.season != null ? String(s.season) : String(s.league_id)] = { error: (err && err.message) ? err.message : String(err) };
    }
  } // end seasons loop

  // Prepare payload for selected season
  const selectedSeasonKey = selectedSeasonParam;
  let selectedSeasonFinal = finalStandingsBySeason[selectedSeasonKey] ?? null;
  // if nothing computed for selected, attempt to compute directly for selectedLeagueId
  if (!selectedSeasonFinal) {
    // find season object
    const found = seasons.find(s => (String(s.season) === String(selectedSeasonParam) || String(s.league_id) === String(selectedSeasonParam)));
    if (found) {
      selectedSeasonFinal = finalStandingsBySeason[found.season != null ? String(found.season) : String(found.league_id)] ?? null;
    }
  }

  // Return top-level payload (UI expects finalStandings for the selected season and finalStandingsBySeason for all)
  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart: null,
    playoffEnd: null,
    matchupsRows: [],
    regularStandings: [],
    finalStandings: (selectedSeasonFinal && selectedSeasonFinal.finalStandings) ? selectedSeasonFinal.finalStandings : null,
    finalStandingsBySeason,
    messages,
    prevChain
  };
}
