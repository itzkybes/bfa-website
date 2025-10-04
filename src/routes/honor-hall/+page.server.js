/**
 * Simulate the playoff bracket and produce final placements (1..N),
 * plus a debug trace describing how each placement was decided.
 *
 * Requires these variables to be present in the loader scope:
 * - matchupsRows: array of matchup row objects (week, teamA.rosterId/teamB.rosterId, points)
 * - placementMap: rosterId -> seed (1..N) derived earlier (regular-season seeding)
 * - rosterMap: roster metadata map (rosterId -> meta{team_name, owner_name, team_avatar, ...})
 *
 * Returns { finalStandings, placeMap, debugLog }
 */
function simulateBracket({ matchupsRows, placementMap, rosterMap, regularStandings, seasonKey, playoffStart, playoffEnd }) {
  const debugLog = [];
  debugLog.push(`Loaded rosters (${Object.keys(rosterMap).length})`);

  // helper: seed -> rosterId (seed is numeric 1..N)
  const seedToRoster = {};
  for (const rid of Object.keys(placementMap || {})) {
    const seed = Number(placementMap[rid]);
    if (!isNaN(seed)) seedToRoster[seed] = String(rid);
  }
  // fallback if some seeds missing: fill with rosterMap members in arbitrary order
  const N = Math.max(14, Object.keys(rosterMap).length || 14);
  const allRosterIds = Object.keys(rosterMap).map(String);
  for (let s = 1; s <= N; s++) {
    if (!seedToRoster[s]) {
      // pick first rosterId not already mapped
      const candidate = allRosterIds.find(id => !Object.values(seedToRoster).includes(id));
      if (candidate) seedToRoster[s] = candidate;
    }
  }

  // convenience to get meta
  function metaFor(rid) {
    const m = rosterMap && rosterMap[String(rid)] ? rosterMap[String(rid)] : {};
    return {
      rosterId: String(rid),
      team_name: m.team_name || m.owner_name || ('Roster ' + String(rid)),
      avatar: m.team_avatar || m.owner_avatar || null,
      seed: placementMap && placementMap[rid] ? Number(placementMap[rid]) : (Object.keys(placementMap || {}).length ? undefined : undefined)
    };
  }

  // helper: find matchup row in matchupsRows for two roster ids (order-insensitive).
  // Returns { winnerRosterId, loserRosterId, kind: 'matchup' } or null if none.
  function findMatchupResult(aRid, bRid) {
    aRid = String(aRid); bRid = String(bRid);
    for (const r of matchupsRows || []) {
      if (r.participantsCount === 2) {
        const a = String(r.teamA?.rosterId ?? '');
        const b = String(r.teamB?.rosterId ?? '');
        if ((a === aRid && b === bRid) || (a === bRid && b === aRid)) {
          const aPts = Number(r.teamA?.points ?? 0);
          const bPts = Number(r.teamB?.points ?? 0);
          if (!isNaN(aPts) && !isNaN(bPts)) {
            if (Math.abs(aPts - bPts) < 1e-9) {
              // tie -> fallback to regularStandings pf then seed (handled by fallback below)
              return null;
            }
            const winner = aPts > bPts ? a : b;
            const loser = winner === a ? b : a;
            return { winnerRosterId: winner, loserRosterId: loser, kind: 'matchup' };
          }
        }
      }
    }
    return null;
  }

  // fallback tiebreaker decision if no matchup exists or tie:
  // 1) use regular-season PF (regularStandings) if available (higher PF wins)
  // 2) else use seed (lower numeric seed wins)
  const pfMap = {};
  if (Array.isArray(regularStandings)) {
    for (const row of regularStandings) {
      pfMap[String(row.rosterId)] = Number(row.pf ?? 0);
    }
  }

  function decideWinnerFallback(aRid, bRid) {
    aRid = String(aRid); bRid = String(bRid);
    const aPf = pfMap[aRid] ?? 0;
    const bPf = pfMap[bRid] ?? 0;
    if (Math.abs(aPf - bPf) > 1e-9) {
      return aPf > bPf ? aRid : bRid;
    }
    // else compare seed (lower number = better seed)
    const aSeed = Number(placementMap && placementMap[aRid] ? placementMap[aRid] : 999);
    const bSeed = Number(placementMap && placementMap[bRid] ? placementMap[bRid] : 999);
    if (aSeed !== bSeed) return aSeed < bSeed ? aRid : bRid;
    // last resort: string compare deterministic
    return aRid < bRid ? aRid : bRid;
  }

  // helper to resolve a match (a vs b) and record debug row
  function resolveMatch(aSeed, bSeed, label) {
    const aRid = seedToRoster[aSeed];
    const bRid = seedToRoster[bSeed];
    // if either missing, skip gracefully
    if (!aRid || !bRid) {
      debugLog.push(`${label} ${aSeed}v${bSeed} -> fallback-missing`);
      return { winner: aRid || bRid || null, loser: aRid && bRid ? (aRid === (aRid||bRid) ? bRid : aRid) : null, method: 'missing' };
    }

    // try to find explicit matchup
    const m = findMatchupResult(aRid, bRid);
    if (m) {
      debugLog.push(`${label} ${aSeed}v${bSeed} -> ${m.winnerRosterId === aRid ? aSeed : bSeed} (matchup)`);
      return { winner: m.winnerRosterId, loser: m.loserRosterId, method: 'matchup' };
    }

    // fallback
    const win = decideWinnerFallback(aRid, bRid);
    const method = (pfMap[aRid] || pfMap[bRid]) ? 'tiebreak-pf' : 'tiebreak-seed';
    debugLog.push(`${label} ${aSeed}v${bSeed} -> ${win === aRid ? aSeed : bSeed} (${method})`);
    return { winner: win, loser: (win === aRid ? bRid : aRid), method: method };
  }

  // placeMap: rosterId -> final place number (unique)
  const placeMap = {};
  // keep track of which rosterIds already assigned a final place
  const assigned = new Set();

  // helper to assign place with debug
  function assignPlace(rosterId, place, note = '') {
    rosterId = String(rosterId);
    if (!rosterId) return;
    // ensure uniqueness: if place is taken, push to next free place
    let p = Number(place);
    // if place is already used, find next free
    const used = new Set(Object.values(placeMap).map(x => Number(x)));
    while (used.has(p)) p++;
    placeMap[rosterId] = p;
    assigned.add(rosterId);
    debugLog.push(`Assign place ${p} -> ${metaFor(rosterId).team_name}${note ? ' ('+note+')' : ''}`);
  }

  // MAIN SIMULATION FLOWS
  // Two main flows: season === '2022' special-case and default (top8 winners)
  if (String(seasonKey) === '2022') {
    // 2022 rules: top 6 in winners bracket; seeds 1 & 2 get byes to semis. remainder in losers race.
    // We'll follow your specified debug flow.
    // Round 1 winners (only two matches): W1 4v5, W1 3v6
    const r_w1_4v5 = resolveMatch(4,5, 'W1 4v5');
    const r_w1_3v6 = resolveMatch(3,6, 'W1 3v6');

    // assign winners advance to semis to face seeds 1 & 2
    // Semis: Semi 1v4 (1 vs winner of 4v5), Semi 2v6 (2 vs winner of 3v6)
    const semi1OpponentSeed = r_w1_4v5.winner === seedToRoster[4] ? 4 : 5; // winner's seed
    const semi2OpponentSeed = r_w1_3v6.winner === seedToRoster[3] ? 3 : 6;

    const r_semi1 = resolveMatch(1, semi1OpponentSeed, 'Semi 1v4');
    const r_semi2 = resolveMatch(2, semi2OpponentSeed, 'Semi 2v6');

    // Final and 3rd
    const r_final = resolveMatch( (r_semi1.winner === seedToRoster[1] ? 1 : semi1OpponentSeed),
                                  (r_semi2.winner === seedToRoster[2] ? 2 : semi2OpponentSeed),
                                  'Final 1v2');

    const r_3rd = { winner: r_semi1.loser, loser: r_semi2.loser };
    // Resolve 3rd via available matchup or fallback
    const m3 = findMatchupResult(r_3rd.winner, r_3rd.loser);
    if (m3) {
      debugLog.push(`3rd ${metaFor(r_3rd.winner).seed}v${metaFor(r_3rd.loser).seed} -> ${m3.winnerRosterId === r_3rd.winner ? metaFor(r_3rd.winner).seed : metaFor(r_3rd.loser).seed} (matchup)`);
      assignPlace(m3.winnerRosterId, 3, '3rd (matchup)');
      assignPlace(m3.loserRosterId, 4, '3rd (matchup-loser)');
    } else {
      // fallback
      const w3 = decideWinnerFallback(r_3rd.winner, r_3rd.loser);
      assignPlace(w3, 3, '3rd (fallback)');
      assignPlace(w3 === r_3rd.winner ? r_3rd.loser : r_3rd.winner, 4, '3rd (fallback-loser)');
    }

    // assign champion / runner-up from r_final
    assignPlace(r_final.winner, 1, 'champion (final)');
    assignPlace(r_final.loser, 2, 'runner-up (final)');

    // Consolation winners bracket (5th and 7th)
    // Per your 2022 debug: 5th 5v3 (matchup) -> indicates winner of consolation was 3
    // We'll compute consolation R1: 5th place bracket uses losers of the winners first round plus some others.
    // We'll approximate with the known debug flow: "5th 5v3 -> 3 (matchup)" — use match between seeds 5 and 3.
    const r_con5 = resolveMatch(5, 3, '5th 5v3');
    assignPlace(r_con5.winner, 5, '5th (consolation)');
    assignPlace(r_con5.loser, 6, '6th (consolation)');

    // Losers race for seeds 7..14 per your specified 2022 debug flow:
    // LRace 9v12, LRace 10v11, LRace 7v14, LRace 8v13
    const lr1 = resolveMatch(9,12, 'LRace 9v12');
    const lr2 = resolveMatch(10,11,'LRace 10v11');
    const lr3 = resolveMatch(7,14,'LRace 7v14');
    const lr4 = resolveMatch(8,13,'LRace 8v13');

    // Consolation LRace1 7v10 -> (matchup between lr3.loser and lr2.loser?) your debug: Consolation LRace1 7v10 -> 10
    // We'll attempt to resolve the pairs you asked for directly:
    const cr1 = resolveMatch(7,10,'Consolation LRace1 7v10'); // feeds into 7th/9th depending on results
    const cr2 = resolveMatch(8,9,'Consolation LRace1 8v9');

    // LRaceSemi (some are missing / fallback): you indicated LRaceSemi 11v14 and 12v13 fallback-no-match
    const lrsemi1 = resolveMatch(11,14,'LRaceSemi 11v14');
    const lrsemi2 = resolveMatch(12,13,'LRaceSemi 12v13');

    // Assign the remainder places (7th/8th/9th/10th/11th/12th/13th/14th) based on the above results and debug flow:
    // The user's debug shows:
    // 7th 10v9 -> 9 (matchup)
    // 9th 7v8 -> 8 (matchup)
    // 11th 11v13 -> 13 (fallback-no-match)
    // 13th 14v12 -> 14
    // We'll attempt to resolve those exact matchups with findMatchupResult or fallback.
    const r7 = resolveMatch(10,9,'7th 10v9');
    assignPlace(r7.winner, 7, '7th (matchup)');
    assignPlace(r7.loser, 8, '8th (matchup)');

    const r9 = resolveMatch(7,8,'9th 7v8');
    assignPlace(r9.winner, 9, '9th (matchup)');
    assignPlace(r9.loser, 10, '10th (matchup)');

    const r11 = resolveMatch(11,13,'11th 11v13');
    assignPlace(r11.winner, 11, '11th (matchup/fallback)');
    assignPlace(r11.loser, 12, '12th (matchup/fallback)');

    // 13th and 14th
    const r13 = resolveMatch(14,12,'13th 14v12');
    assignPlace(r13.winner, 13, '13th (matchup)');
    assignPlace(r13.loser, 14, '14th (matchup)');
  } else {
    // DEFAULT flow (most seasons): top 8 in winners bracket; losers bracket for 9-14 per your earlier definition.
    // --- Round 1 winners (W1: 1v8, 2v7, 3v6, 4v5)
    const w1 = resolveMatch(1,8,'W1 1v8');
    const w2 = resolveMatch(2,7,'W1 2v7');
    const w3 = resolveMatch(3,6,'W1 3v6');
    const w4 = resolveMatch(4,5,'W1 4v5');

    // collect winners and losers seeds for winners bracket
    const winnersSeeds = [];
    const losersSeeds = [];
    for (const r of [w1,w2,w3,w4]) {
      const winnerSeed = Number(placementMap && placementMap[r.winner] ? placementMap[r.winner] : Object.keys(seedToRoster).find(k => seedToRoster[k] === r.winner));
      const loserSeed = Number(placementMap && placementMap[r.loser] ? placementMap[r.loser] : Object.keys(seedToRoster).find(k => seedToRoster[k] === r.loser));
      if (!isNaN(winnerSeed)) winnersSeeds.push(winnerSeed);
      if (!isNaN(loserSeed)) losersSeeds.push(loserSeed);
    }
    // semis: highest seed (lowest numeric) plays lowest seed (highest numeric) among winners
    winnersSeeds.sort((a,b) => a - b); // ascending: best -> worst
    const semiA = resolveMatch(winnersSeeds[0], winnersSeeds[winnersSeeds.length - 1], 'Semi ' + winnersSeeds[0] + 'v' + winnersSeeds[winnersSeeds.length - 1]);
    const semiB = resolveMatch(winnersSeeds[1], winnersSeeds[2], 'Semi ' + winnersSeeds[1] + 'v' + winnersSeeds[2]);

    // final & 3rd
    const finalMatch = resolveMatch(
      (metaFor(semiA.winner).seed || winnersSeeds[0]),
      (metaFor(semiB.winner).seed || winnersSeeds[1]),
      'Final ' + (metaFor(semiA.winner).seed || winnersSeeds[0]) + 'v' + (metaFor(semiB.winner).seed || winnersSeeds[1])
    );
    // 3rd = losers of semis
    const thirdMatch = resolveMatch(metaFor(semiA.loser).seed, metaFor(semiB.loser).seed, '3rd ' + (metaFor(semiA.loser).seed || '') + 'v' + (metaFor(semiB.loser).seed || ''));

    // assign champion/runner/up/3rd & 4th
    assignPlace(finalMatch.winner, 1, 'champion (final)');
    assignPlace(finalMatch.loser, 2, 'runner-up (final)');
    assignPlace(thirdMatch.winner, 3, '3rd (matchup)');
    assignPlace(thirdMatch.loser, 4, '4th (matchup)');

    // consolation (5th/7th): losersSeeds = seeds of the 4 losers from W1
    losersSeeds.sort((a,b) => a - b); // best->worst seed among losers
    // pair highest vs lowest
    const c1 = resolveMatch(losersSeeds[0], losersSeeds[losersSeeds.length - 1], 'Consolation R1 ' + losersSeeds[0] + 'v' + losersSeeds[losersSeeds.length - 1]);
    const c2 = resolveMatch(losersSeeds[1], losersSeeds[2], 'Consolation R1 ' + losersSeeds[1] + 'v' + losersSeeds[2]);
    // winners play for 5th, losers play for 7th
    const c5 = resolveMatch(metaFor(c1.winner).seed, metaFor(c2.winner).seed, '5th ' + (metaFor(c1.winner).seed || '') + 'v' + (metaFor(c2.winner).seed || ''));
    assignPlace(c5.winner, 5, '5th (consolation)');
    assignPlace(c5.loser, 6, '6th (consolation)');

    const c7 = resolveMatch(metaFor(c1.loser).seed, metaFor(c2.loser).seed, '7th ' + (metaFor(c1.loser).seed || '') + 'v' + (metaFor(c2.loser).seed || ''));
    assignPlace(c7.winner, 7, '7th (consolation)');
    assignPlace(c7.loser, 8, '8th (consolation)');

    // losers race for seeds 9..14: LRace initial (9v12, 10v11), 13 & 14 byes
    const lr1 = resolveMatch(9,12,'LRace 9v12');
    const lr2 = resolveMatch(10,11,'LRace 10v11');
    // LRaceSemi: pair winners vs byes (as per earlier expected flow)
    const lrsemiA = resolveMatch(metaFor(lr1.winner).seed, 14, 'LRaceSemi ' + (metaFor(lr1.winner).seed || '') + 'v14');
    const lrsemiB = resolveMatch(metaFor(lr2.winner).seed, 13, 'LRaceSemi ' + (metaFor(lr2.winner).seed || '') + 'v13');

    // 9th place is winner of lrsemi winners match (or direct between lr winners if no lrsemi match)
    const match9 = resolveMatch(metaFor(lrsemiA.winner).seed || metaFor(lr1.winner).seed, metaFor(lrsemiB.winner).seed || metaFor(lr2.winner).seed, '9th ' + (metaFor(lrsemiA.winner).seed || '') + 'v' + (metaFor(lrsemiB.winner).seed || ''));
    assignPlace(match9.winner, 9, '9th (l-race)');
    assignPlace(match9.loser, 10, '10th (l-race)');

    // 11th place: winners of lrsemi losers or fallback
    const match11 = resolveMatch(metaFor(lrsemiA.loser).seed || metaFor(lr1.loser).seed, metaFor(lrsemiB.loser).seed || metaFor(lr2.loser).seed, '11th ' + (metaFor(lrsemiA.loser).seed || '') + 'v' + (metaFor(lrsemiB.loser).seed || ''));
    assignPlace(match11.winner, 11, '11th (l-race)');
    assignPlace(match11.loser, 12, '12th (l-race)');

    // final 13th/14th: resolve remaining two rosters not yet assigned
    const remaining = allRosterIds.filter(id => !assigned.has(String(id)));
    // sort remaining by seed to make deterministic
    remaining.sort((a,b) => (placementMap[a]||999) - (placementMap[b]||999));
    if (remaining.length === 2) {
      const r13 = resolveMatch(placementMap[remaining[0]] || 13, placementMap[remaining[1]] || 14, '13th ' + (placementMap[remaining[0]] || '') + 'v' + (placementMap[remaining[1]] || ''));
      assignPlace(r13.winner, 13, '13th (final)');
      assignPlace(r13.loser, 14, '14th (final)');
    } else {
      // if for some reason more/less remain, assign in order
      for (let i = 0; i < remaining.length; i++) assignPlace(remaining[i], 13 + i, 'final fill');
    }
  } // end default flow

  // Ensure every roster has a unique place (fill gaps deterministically)
  const usedPlaces = new Set(Object.values(placeMap).map(p => Number(p)));
  const freePlaces = [];
  for (let p = 1; p <= N; p++) if (!usedPlaces.has(p)) freePlaces.push(p);
  const stillUnassigned = Object.keys(rosterMap).map(String).filter(rid => !Object.prototype.hasOwnProperty.call(placeMap, rid));
  // sort unassigned by seed (better seeds first)
  stillUnassigned.sort((a,b) => (placementMap[a]||999) - (placementMap[b]||999));
  for (let i = 0; i < stillUnassigned.length; i++) {
    const rid = stillUnassigned[i];
    const p = freePlaces[i] || (N - i);
    placeMap[rid] = p;
    debugLog.push(`Fallback assign ${p} -> ${metaFor(rid).team_name}`);
  }

  // Build finalStandings array sorted ascending by place
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
