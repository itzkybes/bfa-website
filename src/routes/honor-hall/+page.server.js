// src/routes/honor-hall/+page.server.js
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
 * Find a match row in matchupsRows for two rosterIds (order-insensitive).
 * Returns the match object or null.
 * Prefer an exact roster-id match with scores present.
 */
function findMatchRowForRosterPair(matchupsRows, rA, rB) {
  if (!Array.isArray(matchupsRows)) return null;
  // Find exact entry where two participants are present and rosterIds match
  for (const m of matchupsRows) {
    if (m.participantsCount === 2 && m.teamA && m.teamB) {
      const ids = [String(m.teamA.rosterId), String(m.teamB.rosterId)];
      if (ids.indexOf(String(rA)) !== -1 && ids.indexOf(String(rB)) !== -1) return m;
    }
    // Combined/multi entries will be ignored for bracket matching
  }
  return null;
}

/**
 * Compare two roster's outcome using: matchup score (if available) -> regular PF -> seed (lower number is better).
 * Returns winnerRosterId (string) and an object { method: 'matchup'|'pf'|'seed', reason } for debug.
 */
function decideWinner(rA, rB, matchupsRows, regularPfMap = {}, placementMap = {}) {
  // Try direct matchup
  const row = findMatchRowForRosterPair(matchupsRows, rA, rB);
  if (row && row.participantsCount === 2 && typeof row.teamA.points === 'number' && typeof row.teamB.points === 'number') {
    // determine which roster is teamA/teamB in that row
    const aId = String(row.teamA.rosterId), bId = String(row.teamB.rosterId);
    const aPts = safeNum(row.teamA.points), bPts = safeNum(row.teamB.points);
    if (Math.abs(aPts - bPts) < 1e-9) {
      // tie on matchup points -> fall through to PF
    } else {
      const winner = aPts > bPts ? aId : bId;
      return { winner: winner, method: 'matchup', reason: `${aPts} vs ${bPts}` };
    }
  }

  // fallback: regular season PF (higher is better)
  const aPf = safeNum(regularPfMap[String(rA)] ?? 0);
  const bPf = safeNum(regularPfMap[String(rB)] ?? 0);
  if (Math.abs(aPf - bPf) > 1e-9) {
    const winner = aPf > bPf ? String(rA) : String(rB);
    return { winner, method: 'pf', reason: `${aPf} vs ${bPf}` };
  }

  // final fallback: seed (lower seed number wins)
  const aSeed = Number(placementMap[String(rA)] ?? 999);
  const bSeed = Number(placementMap[String(rB)] ?? 999);
  let winner = String(rA);
  if (aSeed === bSeed) {
    // If same seed fallback consistent: smaller rosterId string
    winner = String(rA) < String(rB) ? String(rA) : String(rB);
  } else {
    winner = (aSeed < bSeed) ? String(rA) : String(rB);
  }
  return { winner, method: 'seed', reason: `${aSeed} vs ${bSeed}` };
}

/**
 * Simulates brackets and returns final standings array (1..N) plus debug trace.
 *
 * Rules implemented:
 * - For season '2022' use the special winners size=6 layout described previously.
 * - For other seasons winners bracket is seeds 1..8, losers 9..14.
 * - Use real matchup results when present; fallback to regular pf then seed.
 *
 * Input:
 *  - matchupsRows: array of playoff match rows
 *  - placementMap: rosterId -> placement (1..14)
 *  - rosterMap: rosterId -> roster metadata (for names/owner)
 *  - regularPfMap: rosterId -> regular season pf (numeric)
 *  - leagueSeason: string season (used to test '2022' special-case)
 *
 * Returns:
 *  { finalStandings: [ { rank, rosterId, team_name, owner_name, avatar, seed, pf }, ... ],
 *    debugLog: [string,...] }
 */
function simulateBracket(matchupsRows, placementMap, rosterMap, regularPfMap, leagueSeason) {
  const debug = [];
  const totalTeams = Object.keys(placementMap).length || 14;

  debug.push(`Loaded rosters (${totalTeams})`);

  // helper to build roster entry object
  function makeEntry(rid) {
    const meta = rosterMap[String(rid)] || {};
    // owner_name fallback guarantees
    let owner_name = meta.owner_name ?? null;
    if (!owner_name && meta.user_raw) {
      owner_name = meta.user_raw.display_name || meta.user_raw.username || null;
    }
    owner_name = owner_name || 'Unknown Owner';

    const team_name = meta.team_name || meta.owner_name || ('Roster ' + String(rid));
    const avatar = meta.team_avatar || meta.owner_avatar || null;
    const seed = placementMap[String(rid)] ?? null;
    const pf = regularPfMap[String(rid)] ?? 0;
    return { rosterId: String(rid), team_name, owner_name, avatar, seed, pf };
  }

  // build seed->roster mapping (where seed numbers are unique)
  const seedToRoster = {};
  for (const rId in placementMap) {
    const seed = Number(placementMap[rId]);
    if (!isNaN(seed)) seedToRoster[seed] = String(rId);
  }

  // convenience arrays for seeds
  // special 2022 rule: top 6 winners bracket
  const is2022 = String(leagueSeason) === '2022';
  let winnersSeeds = [];
  let losersSeeds = [];

  if (is2022) {
    // winners: top 6 seeds (1..6). losers: rest 7..14.
    winnersSeeds = [1,2,3,4,5,6].filter(s => seedToRoster[s]);
    losersSeeds = [];
    for (let s = 7; s <= 14; s++) if (seedToRoster[s]) losersSeeds.push(s);
  } else {
    // normal seasons: winners 1..8, losers 9..14
    winnersSeeds = [];
    for (let s = 1; s <= 8; s++) if (seedToRoster[s]) winnersSeeds.push(s);
    losersSeeds = [];
    for (let s = 9; s <= 14; s++) if (seedToRoster[s]) losersSeeds.push(s);
  }

  // helper to pick winner given two seeds (not rosterIds). Uses placementMap -> rosterId resolution and decideWinner.
  function decideWinnerBySeeds(seedA, seedB) {
    const ra = seedToRoster[seedA] ?? null;
    const rb = seedToRoster[seedB] ?? null;
    if (!ra && !rb) return { winner: null, method: 'nomatch', reason: 'no rosters' };
    if (!ra) return { winner: rb, method: 'fallback', reason: 'only one roster present' };
    if (!rb) return { winner: ra, method: 'fallback', reason: 'only one roster present' };

    const res = decideWinner(ra, rb, matchupsRows, regularPfMap, placementMap);
    const winner = res.winner;
    const loser = (String(winner) === String(ra)) ? rb : ra;
    return { winner, loser, method: res.method, reason: res.reason, pair: [ra, rb], seeds: [seedA, seedB] };
  }

  // Now simulate per the bracket rules.
  // We'll collect ranking assignments into an array placeIndex -> rosterId
  const place = {}; // place[n] = rosterId

  // ========= Winners bracket (main race) =========
  // For 8-team winners (non-2022) rounds:
  //  R1: 1v8, 2v7, 3v6, 4v5 -> produce 4 winners and 4 losers
  //  Semis: winners sorted by seed ascending -> highest vs lowest, middle two -> produce final winners and semilosers
  //  Final: winners play -> champion; semilosers play -> 3rd place
  //
  // For 2022 winners 6-team layout we follow the exception described by you.
  //
  const winnersFirstPairs = [];

  if (is2022) {
    // The 2022 pairing in your examples used: W1 4v5 and W1 3v6 with top seeds getting byes to semis
    // We'll implement that:
    // Round1 (W1): 3v6, 4v5  (seeds 1 and 2 get byes to semis)
    if (seedToRoster[3] && seedToRoster[6]) winnersFirstPairs.push([3,6]);
    if (seedToRoster[4] && seedToRoster[5]) winnersFirstPairs.push([4,5]);
    debug.push(`W1 3v6 -> ${decideWinnerBySeeds(3,6).winner ? (placementMap[decideWinnerBySeeds(3,6).winner]) : 'fallback' } (matchup)`);
    debug.push(`W1 4v5 -> ${decideWinnerBySeeds(4,5).winner ? (placementMap[decideWinnerBySeeds(4,5).winner]) : 'fallback' } (matchup)`);
  } else {
    // standard 8-team winners
    const standardPairs = [[1,8],[2,7],[3,6],[4,5]];
    for (const p of standardPairs) {
      if (seedToRoster[p[0]] || seedToRoster[p[1]]) {
        winnersFirstPairs.push(p);
        const r = decideWinnerBySeeds(p[0], p[1]);
        debug.push(`W1 ${p[0]}v${p[1]} -> ${r.winner ? (placementMap[String(r.winner)]) : 'fallback'} (${r.method})`);
      }
    }
  }

  // Evaluate first-round winners/lossers for winners bracket
  const winnersRosters = []; // winners rosterIds
  const winnersSeedsActual = []; // winners seeds
  const winnersFirstLosers = []; // losers rosterIds from winners first round

  for (const p of winnersFirstPairs) {
    const seedA = p[0], seedB = p[1];
    const res = decideWinnerBySeeds(seedA, seedB);
    if (res.winner) {
      winnersRosters.push(String(res.winner));
      winnersSeedsActual.push(placementMap[String(res.winner)]);
      winnersFirstLosers.push(String(res.loser));
    } else {
      // if no actual match evaluation was possible, decide deterministically by seed presence
      const aRid = seedToRoster[seedA] ?? null;
      const bRid = seedToRoster[seedB] ?? null;
      if (aRid && !bRid) {
        winnersRosters.push(String(aRid));
        winnersFirstLosers.push(String(bRid || ''));
        winnersSeedsActual.push(seedA);
      } else if (!aRid && bRid) {
        winnersRosters.push(String(bRid));
        winnersFirstLosers.push(String(aRid || ''));
        winnersSeedsActual.push(seedB);
      }
    }
  }

  // For 8-team (non-2022) if we had exactly 4 winners above, arrange semis:
  let semifinalPairs = [];
  let semifinalLosers = [];
  if (is2022) {
    // For 2022 semis: seeds 1 and 2 had byes and play winners from the first round.
    // Semis: 1 vs (winner of 4v5), 2 vs (winner of 3v6)
    const seed1Rid = seedToRoster[1] ?? null;
    const seed2Rid = seedToRoster[2] ?? null;
    const winnerOf45 = winnersRosters.length >= 2 ? winnersRosters[1] : (seedToRoster[4] || seedToRoster[5]) || null; // second pair winner
    const winnerOf36 = winnersRosters.length >= 1 ? winnersRosters[0] : (seedToRoster[3] || seedToRoster[6]) || null; // first pair winner

    if (seed1Rid && winnerOf45) semifinalPairs.push([placementMap[String(seed1Rid)], placementMap[String(winnerOf45)]]);
    if (seed2Rid && winnerOf36) semifinalPairs.push([placementMap[String(seed2Rid)], placementMap[String(winnerOf36)]]);
    for (const sp of semifinalPairs) {
      const r = decideWinnerBySeeds(sp[0], sp[1]);
      debug.push(`Semi ${sp[0]}v${sp[1]} -> ${r.winner ? placementMap[String(r.winner)] : 'fallback'} (${r.method})`);
      semifinalLosers.push(String(r.loser ?? ''));
    }
  } else {
    // Standard 4 winners -> semis. We must sort winners by seed ascending (highest seed = lowest number)
    // and pair highest vs lowest, second-highest vs second-lowest.
    const winnersWithSeeds = winnersRosters.map((rid, idx) => ({ rid, seed: Number(placementMap[String(rid)]) }));
    winnersWithSeeds.sort((a,b) => a.seed - b.seed); // ascending
    if (winnersWithSeeds.length === 4) {
      semicandidates = winnersWithSeeds;
      semifinalPairs = [
        [semicandidates[0].seed, semicandidates[3].seed],
        [semicandidates[1].seed, semicandidates[2].seed]
      ];
      for (const sp of semifinalPairs) {
        const r = decideWinnerBySeeds(sp[0], sp[1]);
        debug.push(`Semi ${sp[0]}v${sp[1]} -> ${r.winner ? placementMap[String(r.winner)] : 'fallback'} (${r.method})`);
        semifinalLosers.push(String(r.loser ?? ''));
      }
    }
  }

  // Determine final & 3rd place
  let finalPair = null;
  let finalWinnerRid = null;
  let finalLoserRid = null;
  if (semifinalPairs.length === 2) {
    // determine winners of semis again by reusing decideWinnerBySeeds
    const semiWinners = [];
    for (const sp of semifinalPairs) {
      const r = decideWinnerBySeeds(sp[0], sp[1]);
      if (r.winner) semiWinners.push({ seed: placementMap[String(r.winner)], rid: r.winner });
      else {
        // fallback: pick smaller seed present
        const aRid = seedToRoster[sp[0]] ?? null;
        const bRid = seedToRoster[sp[1]] ?? null;
        if (aRid && !bRid) semiWinners.push({ seed: sp[0], rid: aRid });
        else if (!aRid && bRid) semiWinners.push({ seed: sp[1], rid: bRid });
      }
    }
    if (semiWinners.length === 2) {
      // final pair: seeds of winners
      const sA = semiWinners[0].seed, sB = semiWinners[1].seed;
      finalPair = [sA, sB];
      const rf = decideWinnerBySeeds(sA, sB);
      finalWinnerRid = rf.winner;
      finalLoserRid = rf.loser;
      debug.push(`Final ${sA}v${sB} -> ${finalWinnerRid ? placementMap[String(finalWinnerRid)] : 'fallback'} (${rf.method})`);
      // 3rd place: the semilosers -> determine by their matchup if present
      const semilosers = semifinalLosers.filter(Boolean);
      if (semilosers.length === 2) {
        const r3 = decideWinner(semilosers[0], semilosers[1], matchupsRows, regularPfMap, placementMap);
        const thirdWinner = r3.winner;
        const thirdLoser = (String(thirdWinner) === String(semilosers[0])) ? semilosers[1] : semilosers[0];
        debug.push(`3rd ${placementMap[semilosers[0]]}v${placementMap[semilosers[1]]} -> ${thirdWinner ? placementMap[String(thirdWinner)] : 'fallback'} (${r3.method})`);
        // assign places: 1 finalWinner, 2 finalLoser, 3 thirdWinner, 4 thirdLoser
        if (finalWinnerRid) place[1] = String(finalWinnerRid);
        if (finalLoserRid) place[2] = String(finalLoserRid);
        if (thirdWinner) place[3] = String(thirdWinner);
        if (thirdLoser) place[4] = String(thirdLoser);
      } else {
        // fallback: use seeds/ordering
        if (finalWinnerRid) place[1] = String(finalWinnerRid);
        if (finalLoserRid) place[2] = String(finalLoserRid);
      }
    }
  }

  // ========= Consolation bracket for winners-first-round losers =========
  // The losers of winners first-round play among themselves: highest seed vs lowest seed.
  // Winners of those play for 5th place; losers play for 7th.
  const losersOfW1 = winnersFirstLosers.filter(Boolean);
  if (losersOfW1.length >= 2) {
    // convert rosterIds -> seeds, sort by seed ascending
    const losersWithSeed = losersOfW1.map(rid => ({ rid, seed: placementMap[String(rid)] || 999 }));
    losersWithSeed.sort((a,b) => a.seed - b.seed);
    let lPair1 = [losersWithSeed[0].seed, losersWithSeed[losersWithSeed.length - 1].seed];
    let lPair2 = [losersWithSeed[1].seed, losersWithSeed[losersWithSeed.length - 2]?.seed];
    const rL1 = decideWinnerBySeeds(lPair1[0], lPair1[1]);
    const rL2 = losersWithSeed.length >= 4 ? decideWinnerBySeeds(lPair2[0], lPair2[1]) : null;

    if (rL1 && rL1.winner) debug.push(`Consolation R1 ${lPair1[0]}v${lPair1[1]} -> ${placementMap[String(rL1.winner)]} (matchup)`);
    if (rL2 && rL2.winner) debug.push(`Consolation R1 ${lPair2[0]}v${lPair2[1]} -> ${placementMap[String(rL2.winner)]} (matchup)`);

    // winners of above play for 5th
    if (rL1 && rL1.winner && rL2 && rL2.winner) {
      const r5 = decideWinner(rL1.winner, rL2.winner, matchupsRows, regularPfMap, placementMap);
      debug.push(`5th ${placementMap[String(rL1.winner)]}v${placementMap[String(rL2.winner)]} -> ${r5.winner ? placementMap[String(r5.winner)] : 'fallback'} (${r5.method})`);
      // losers play for 7th
      const loserR1 = rL1.loser, loserR2 = rL2.loser;
      const r7 = decideWinner(loserR1, loserR2, matchupsRows, regularPfMap, placementMap);
      debug.push(`7th ${placementMap[String(loserR1)]}v${placementMap[String(loserR2)]} -> ${r7.winner ? placementMap[String(r7.winner)] : 'fallback'} (${r7.method})`);
      // assign places accordingly
      place[5] = r5.winner;
      place[6] = (r5.winner === rL1.winner) ? rL2.winner : rL1.winner; // loser of 5th match
      place[7] = r7.winner;
      place[8] = (r7.winner === loserR1) ? loserR2 : loserR1;
    } else if (rL1 && rL1.winner && !rL2) {
      // If only one consolation match exists, winner takes 5th, loser 6th
      place[5] = rL1.winner;
      place[6] = rL1.loser;
    }
  }

  // ========= Losers bracket (LRace) =========
  // LRace initial pairs (non-2022): 9v12, 10v11, 13 & 14 may have bye.
  // For 2022 the losers bracket set may be different, but earlier you specified standard losers flows.
  const lrDebugPrefix = 'LRace';
  const lRacePairs = [];
  if (!is2022) {
    if (seedToRoster[9] || seedToRoster[12]) lRacePairs.push([9,12]);
    if (seedToRoster[10] || seedToRoster[11]) lRacePairs.push([10,11]);
    // 13/14 maybe paired/bye: if both exist pair them, else if one exists pair against bye.
    if ((seedToRoster[13] && seedToRoster[14])) lRacePairs.push([13,14]);
  } else {
    // 2022 more complicated losers mapping used in your example; we'll use the explicit pairs you gave:
    // LRace pairs: 9v12, 10v11, 7v14, 8v13 (since in 2022 winners bracket used top6)
    if (seedToRoster[9] || seedToRoster[12]) lRacePairs.push([9,12]);
    if (seedToRoster[10] || seedToRoster[11]) lRacePairs.push([10,11]);
    if (seedToRoster[7] || seedToRoster[14]) lRacePairs.push([7,14]);
    if (seedToRoster[8] || seedToRoster[13]) lRacePairs.push([8,13]);
  }

  const lRaceWinners = [];
  const lRaceLosers = [];

  for (const p of lRacePairs) {
    const r = decideWinnerBySeeds(p[0], p[1]);
    if (r.winner) {
      lRaceWinners.push(String(r.winner));
      lRaceLosers.push(String(r.loser));
      debug.push(`${lrDebugPrefix} ${p[0]}v${p[1]} -> ${placementMap[String(r.winner)]} (matchup)`);
    } else {
      // fallback messaging
      debug.push(`${lrDebugPrefix} ${p[0]}v${p[1]} -> fallback`);
    }
  }

  // LRace semi: winners play, losers go to consolation; winners -> 9th match; losers for 11th etc
  // We'll pair winners by seed ascending -> highest vs lowest
  if (lRaceWinners.length >= 2) {
    const lwWithSeed = lRaceWinners.map(rid => ({ rid, seed: placementMap[String(rid)] || 999 })).sort((a,b) => a.seed - b.seed);
    if (lwWithSeed.length >= 2) {
      const pairA = [lwWithSeed[0].seed, lwWithSeed[ lwWithSeed.length - 1 ].seed];
      const pairB = lwWithSeed.length >= 4 ? [lwWithSeed[1].seed, lwWithSeed[lwWithSeed.length - 2].seed] : null;
      const rA = decideWinnerBySeeds(pairA[0], pairA[1]);
      if (rA.winner) {
        debug.push(`LRaceSemi ${pairA[0]}v${pairA[1]} -> ${placementMap[String(rA.winner)]} (${rA.method})`);
        // winners play for 9th
        // We'll store for later assignment
        lRaceWinners.push(rA.winner);
      }
      if (pairB && pairB[0] && pairB[1]) {
        const rB = decideWinnerBySeeds(pairB[0], pairB[1]);
        if (rB.winner) debug.push(`LRaceSemi ${pairB[0]}v${pairB[1]} -> ${placementMap[String(rB.winner)]} (${rB.method})`);
      }
    }
  }

  // For simplicity, for remaining spots not assigned by the above explicit matches, we will:
  // - fill 1..14 by picking known winners (place assignments) and then fill any unassigned ranks by the remaining teams
  //   ordered by: did they win a consolation match? then regular-season PF, then seed.

  // First ensure champions and top4 are assigned (if place[1..4] empty fill from final results if we have them)
  // If not already assigned, attempt to extract champion from finalPair/finalWinnerRid above
  if (finalWinnerRid && !place[1]) place[1] = String(finalWinnerRid);
  if (finalLoserRid && !place[2]) place[2] = String(finalLoserRid);

  // If 3/4 not assigned yet, try to discover them from matchups: look for a 3rd place row in matchupsRows (by week or known matchup)
  // We attempt to find any matchup where both participants are among semifinalLosers and pick the winner as 3rd.
  if ((!place[3] || !place[4]) && Array.isArray(matchupsRows) && matchupsRows.length) {
    // collect rosterIds present in semifinalLosers etc
    const candidatePairs = [];
    for (const m of matchupsRows) {
      if (m.participantsCount === 2 && m.teamA && m.teamB) {
        const a = String(m.teamA.rosterId), b = String(m.teamB.rosterId);
        // If neither already assigned to 1/2 and both present, consider this candidate for 3/4
        if (place[1] !== a && place[1] !== b && place[2] !== a && place[2] !== b) {
          candidatePairs.push(m);
        }
      }
    }
    // pick the latest candidate (usually 3rd place is one of playoffWeeks)
    if (candidatePairs.length) {
      const m = candidatePairs[0];
      const r = decideWinner(m.teamA.rosterId, m.teamB.rosterId, matchupsRows, regularPfMap, placementMap);
      if (!place[3] && r.winner) place[3] = String(r.winner);
      if (!place[4]) {
        const other = (String(place[3]) === String(m.teamA.rosterId)) ? m.teamB.rosterId : m.teamA.rosterId;
        place[4] = String(other);
      }
    }
  }

  // Build a list of all rosterIds known
  const allRosterIds = Object.keys(placementMap).map(k => String(k));
  // ensure unique placeholder array
  // Create a set of already assigned rosterIds
  const assigned = new Set(Object.values(place).filter(Boolean).map(String));

  // remaining rosters to fill
  const remaining = allRosterIds.filter(rid => !assigned.has(String(rid)));

  // rank fill order heuristics:
  // - teams that won consolation/placer matches (we tried to set place[5..8] above)
  // - otherwise order by: did they win any playoff match (check matchupsRows points) -> higher number of playoff wins first
  // - then by regularPf descending
  const playoffWinsCount = {};
  for (const rid of allRosterIds) playoffWinsCount[String(rid)] = 0;
  for (const m of matchupsRows) {
    if (m.participantsCount === 2 && m.teamA && m.teamB) {
      if (typeof m.teamA.points === 'number' && typeof m.teamB.points === 'number') {
        if (m.teamA.points > m.teamB.points) playoffWinsCount[String(m.teamA.rosterId)]++;
        else if (m.teamB.points > m.teamA.points) playoffWinsCount[String(m.teamB.rosterId)]++;
      }
    }
  }

  // Sort remaining by: playoffWins desc, regularPf desc, seed asc
  remaining.sort((a,b) => {
    const wA = playoffWinsCount[String(a)] || 0, wB = playoffWinsCount[String(b)] || 0;
    if (wB !== wA) return wB - wA;
    const pfA = Number(regularPfMap[String(a)] || 0), pfB = Number(regularPfMap[String(b)] || 0);
    if (pfB !== pfA) return pfB - pfA;
    const sA = Number(placementMap[String(a)] || 999), sB = Number(placementMap[String(b)] || 999);
    return sA - sB;
  });

  // fill any unassigned rank positions 1..totalTeams
  for (let r = 1; r <= totalTeams; r++) {
    if (!place[r]) {
      const next = remaining.shift();
      if (next) {
        place[r] = String(next);
      }
    }
  }

  // build finalStandings array ordered 1..totalTeams with guaranteed owner_name present
  const finalStandings = [];
  for (let r = 1; r <= totalTeams; r++) {
    const rid = place[r] ? String(place[r]) : null;
    if (!rid) continue;
    const entryMeta = makeEntry(rid);
    finalStandings.push({
      rank: r,
      rosterId: entryMeta.rosterId,
      team_name: entryMeta.team_name,
      owner_name: entryMeta.owner_name, // guaranteed fallback
      avatar: entryMeta.avatar,
      seed: entryMeta.seed,
      pf: entryMeta.pf
    });
  }

  // add helpful debug assignment lines (friendly)
  // We will add a couple of summarizing lines to the debug trace to show final mapping.
  for (let r = 1; r <= totalTeams; r++) {
    if (place[r]) {
      const meta = makeEntry(place[r]);
      debug.push(`Assign place ${r} → ${meta.team_name} (${r === 1 ? 'champion' : r === 2 ? 'runner-up' : (r === 3 ? '3rd' : 'final')})`);
    }
  }

  return { finalStandings, debugLog: debug };
} // end simulateBracket

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

  // determine selectedLeagueId (we only need the selected league for honor-hall)
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
    playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
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

  // Build placement map rosterId -> placement (1-based)
  const placementMap = {};
  for (let i = 0; i < regularStandings.length; i++) {
    placementMap[String(regularStandings[i].rosterId)] = i + 1;
  }

  // Also build a regular pf map for fallbacks in simulation
  const regularPfMap = {};
  for (const rs of regularStandings) {
    regularPfMap[String(rs.rosterId)] = Number(rs.pf || 0);
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
  const keysMatch = Object.keys(byMatch);
  for (let ki = 0; ki < keysMatch.length; ki++) {
    const entries = byMatch[keysMatch[ki]];
    if (!entries || entries.length === 0) continue;

    // single participant -> bye
    if (entries.length === 1) {
      const a = entries[0];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const aMeta = rosterMap[aId] || {};
      const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
      const aPts = (typeof a.points === 'number') ? safeNum(a.points) : null;
      const aPlacement = placementMap[aId] ?? null;

      matchupsRows.push({
        matchup_id: keysMatch[ki],
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
      const aPts = (typeof a.points === 'number') ? safeNum(a.points) : null;
      const bPts = (typeof b.points === 'number') ? safeNum(b.points) : null;
      const aPlacement = placementMap[aId] ?? null;
      const bPlacement = placementMap[bId] ?? null;

      matchupsRows.push({
        matchup_id: keysMatch[ki],
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
      matchup_id: keysMatch[ki],
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
    const ax = x.teamA?.placement ?? (x.combinedParticipants ? (x.combinedParticipants[0]?.placement ?? 999) : 999);
    const by = y.teamA?.placement ?? (y.combinedParticipants ? (y.combinedParticipants[0]?.placement ?? 999) : 999);
    return (ax - by);
  });

  // Now run bracket simulation to compute final standings & debug trace
  const { finalStandings, debugLog } = simulateBracket(matchupsRows, placementMap, rosterMap, regularPfMap, leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null);

  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    matchupsRows,
    regularStandings,
    finalStandings,
    debugLog,
    messages,
    prevChain
  };
}
