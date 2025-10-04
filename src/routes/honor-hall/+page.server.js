import { getMatchupsForSeason } from '$lib/matchups';

export async function load({ params }) {
  const season = parseInt(params.season, 10);
  const playoffStart = 15; // or dynamic based on league settings

  // Fetch regular + playoff matchups
  const matchupsRows = await getMatchupsForSeason(season);

  // Build placement map (seed by standings from season scrubbing)
  const placementMap = {}; // rosterId → seed
  // TODO: fill with standings scrubbing logic (wins, PF tiebreaker)
  // Example: placementMap[3] = 1; // roster 3 = seed 1

  function resolveWinnerLoser(row) {
    const aPts = row.teamA?.points ?? 0;
    const bPts = row.teamB?.points ?? 0;
    if (aPts === bPts) {
      const aSeed = placementMap[row.teamA?.rosterId];
      const bSeed = placementMap[row.teamB?.rosterId];
      return aSeed < bSeed
        ? { winner: row.teamA, loser: row.teamB }
        : { winner: row.teamB, loser: row.teamA };
    }
    return aPts > bPts
      ? { winner: row.teamA, loser: row.teamB }
      : { winner: row.teamB, loser: row.teamA };
  }

  const byWeek = {};
  for (const row of matchupsRows) {
    if (!byWeek[row.week]) byWeek[row.week] = [];
    byWeek[row.week].push(row);
  }

  const finalStandings = {}; // seed → final place
  const labeledRows = [];

  // === Championship Bracket (Seeds 1–8) ===
  const champSeeds = [1,2,3,4,5,6,7,8];

  const qf = (byWeek[playoffStart] || []).filter(r =>
    champSeeds.includes(placementMap[r.teamA?.rosterId]) &&
    champSeeds.includes(placementMap[r.teamB?.rosterId])
  );
  for (const row of qf) {
    row.roundLabel = "Quarterfinals";
    labeledRows.push(row);
  }

  const sf = (byWeek[playoffStart+1] || []).filter(r =>
    champSeeds.includes(placementMap[r.teamA?.rosterId]) &&
    champSeeds.includes(placementMap[r.teamB?.rosterId])
  );
  for (const row of sf) {
    row.roundLabel = "Semifinals";
    labeledRows.push(row);
  }

  const finals = (byWeek[playoffStart+2] || []).filter(r =>
    champSeeds.includes(placementMap[r.teamA?.rosterId]) &&
    champSeeds.includes(placementMap[r.teamB?.rosterId])
  );
  for (const row of finals) {
    const { winner, loser } = resolveWinnerLoser(row);
    row.roundLabel = "Championship / 3rd Place";
    finalStandings[placementMap[winner.rosterId]] = 1; // champ
    finalStandings[placementMap[loser.rosterId]] = 2; // runner-up
    labeledRows.push(row);
  }

  // Semifinal losers → 3rd/4th
  for (const row of sf) {
    const { loser } = resolveWinnerLoser(row);
    finalStandings[placementMap[loser.rosterId]] = 4; // adjust to 3rd/4th
  }

  // QF losers → 5th–8th
  for (const row of qf) {
    const { loser } = resolveWinnerLoser(row);
    // will be slotted later by their consolation results
    labeledRows.push({
      ...row,
      roundLabel: "Consolation (5th–8th)"
    });
  }

  // === Consolation Bracket (Seeds 9–14) ===
  const consSeeds = [9,10,11,12,13,14];

  const consR1 = (byWeek[playoffStart] || []).filter(r =>
    consSeeds.includes(placementMap[r.teamA?.rosterId]) &&
    consSeeds.includes(placementMap[r.teamB?.rosterId])
  );
  for (const row of consR1) {
    row.roundLabel = "Consolation Round 1";
    labeledRows.push(row);
  }

  const consSF = (byWeek[playoffStart+1] || []).filter(r =>
    consSeeds.includes(placementMap[r.teamA?.rosterId]) &&
    consSeeds.includes(placementMap[r.teamB?.rosterId])
  );
  for (const row of consSF) {
    row.roundLabel = "Consolation Semifinals";
    labeledRows.push(row);
  }

  const consF = (byWeek[playoffStart+2] || []).filter(r =>
    consSeeds.includes(placementMap[r.teamA?.rosterId]) &&
    consSeeds.includes(placementMap[r.teamB?.rosterId])
  );
  for (const row of consF) {
    row.roundLabel = "Consolation Finals (9th–14th)";
    const { winner, loser } = resolveWinnerLoser(row);
    // slot into final standings
    finalStandings[placementMap[winner.rosterId]] = 9;
    finalStandings[placementMap[loser.rosterId]] = 10; // adjust for placement
    labeledRows.push(row);
  }

  // === Fill in missing seeds ===
  for (const [rosterId, seed] of Object.entries(placementMap)) {
    if (!finalStandings[seed]) {
      // fallback: assign bottom
      finalStandings[seed] = 14;
    }
  }

  const standingsArray = Object.entries(finalStandings)
    .map(([seed, place]) => ({ seed: parseInt(seed, 10), place }))
    .sort((a,b) => a.place - b.place);

  return {
    matchupsRows: labeledRows,
    finalStandings: standingsArray
  };
}
