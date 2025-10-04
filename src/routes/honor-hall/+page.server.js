// src/routes/honor-hall/+page.server.js

// Utility: decide winner/loser
function decideMatchup(match) {
  const homeScore = match.home?.score ?? 0;
  const awayScore = match.away?.score ?? 0;
  const home = { ...match.home };
  const away = { ...match.away };

  if (homeScore >= awayScore) {
    return { winner: home, loser: away };
  } else {
    return { winner: away, loser: home };
  }
}

export async function load({ params }) {
  const season = params.season ?? "2023";

  // Example: this should really come from your DB / API
  // For now assume matchupsRows is already provided
  const matchupsRows = []; // <- populate from your source

  // placementMap = { rosterId: { seed, name } }
  const placementMap = {}; // <- populate with actual seeds + names from standings

  const results = [];
  const finalStandings = Array(14).fill(null);

  // --- Winners Bracket (Seeds 1–8) ---
  const qf = matchupsRows.filter(m => m.round === 1 && m.bracket === "winners");
  const sf = matchupsRows.filter(m => m.round === 2 && m.bracket === "winners");
  const champ = matchupsRows.find(m => m.round === 3 && m.bracket === "winners");

  // Quarterfinals
  qf.forEach(m => {
    const { winner, loser } = decideMatchup(m);
    m.roundLabel = "Quarterfinals";
    results.push({ ...m, winner, loser });
  });

  // Semifinals
  sf.forEach(m => {
    const { winner, loser } = decideMatchup(m);
    m.roundLabel = "Semifinals";
    results.push({ ...m, winner, loser });
  });

  // Championship
  if (champ) {
    const { winner, loser } = decideMatchup(champ);
    champ.roundLabel = "Championship";
    results.push({ ...champ, winner, loser });

    // Champion → 1st, Runner-up → 2nd
    finalStandings[winner.seed - 1] = { place: 1, ...winner };
    finalStandings[loser.seed - 1] = { place: 2, ...loser };
  }

  // 3rd-place game
  const thirdPlace = matchupsRows.find(m => m.round === "3rd");
  if (thirdPlace) {
    const { winner, loser } = decideMatchup(thirdPlace);
    thirdPlace.roundLabel = "3rd Place";
    results.push({ ...thirdPlace, winner, loser });
    finalStandings[winner.seed - 1] = { place: 3, ...winner };
    finalStandings[loser.seed - 1] = { place: 4, ...loser };
  }

  // Consolations 5th–8th
  const cons5 = matchupsRows.find(m => m.round === "5th");
  if (cons5) {
    const { winner, loser } = decideMatchup(cons5);
    cons5.roundLabel = "Consolation (5th Place)";
    results.push({ ...cons5, winner, loser });
    finalStandings[winner.seed - 1] = { place: 5, ...winner };
    finalStandings[loser.seed - 1] = { place: 6, ...loser };
  }

  const cons7 = matchupsRows.find(m => m.round === "7th");
  if (cons7) {
    const { winner, loser } = decideMatchup(cons7);
    cons7.roundLabel = "Consolation (7th Place)";
    results.push({ ...cons7, winner, loser });
    finalStandings[winner.seed - 1] = { place: 7, ...winner };
    finalStandings[loser.seed - 1] = { place: 8, ...loser };
  }

  // --- Consolation Bracket (Seeds 9–14) ---
  const consQF = matchupsRows.filter(m => m.round === 1 && m.bracket === "consolation");
  const consSF = matchupsRows.filter(m => m.round === 2 && m.bracket === "consolation");
  const consFinal = matchupsRows.find(m => m.round === 3 && m.bracket === "consolation");

  consQF.forEach(m => {
    const { winner, loser } = decideMatchup(m);
    m.roundLabel = "Consolation Quarterfinals";
    results.push({ ...m, winner, loser });
  });

  consSF.forEach(m => {
    const { winner, loser } = decideMatchup(m);
    m.roundLabel = "Consolation Semifinals";
    results.push({ ...m, winner, loser });
  });

  if (consFinal) {
    const { winner, loser } = decideMatchup(consFinal);
    consFinal.roundLabel = "Consolation Championship";
    results.push({ ...consFinal, winner, loser });
    finalStandings[winner.seed - 1] = { place: 9, ...winner };
    finalStandings[loser.seed - 1] = { place: 10, ...loser };
  }

  // 11th place game
  const cons11 = matchupsRows.find(m => m.round === "11th");
  if (cons11) {
    const { winner, loser } = decideMatchup(cons11);
    cons11.roundLabel = "11th Place";
    results.push({ ...cons11, winner, loser });
    finalStandings[winner.seed - 1] = { place: 11, ...winner };
    finalStandings[loser.seed - 1] = { place: 12, ...loser };
  }

  // 13th place game
  const cons13 = matchupsRows.find(m => m.round === "13th");
  if (cons13) {
    const { winner, loser } = decideMatchup(cons13);
    cons13.roundLabel = "13th Place";
    results.push({ ...cons13, winner, loser });
    finalStandings[winner.seed - 1] = { place: 13, ...winner };
    finalStandings[loser.seed - 1] = { place: 14, ...loser };
  }

  // Fill any missing standings with original seeds if they never played
  Object.values(placementMap).forEach(team => {
    if (!finalStandings[team.seed - 1]) {
      finalStandings[team.seed - 1] = { place: team.seed, ...team };
    }
  });

  // Sort by place
  const standingsArray = finalStandings.filter(Boolean).sort((a, b) => a.place - b.place);

  return {
    season,
    matchupsRows: results,
    finalStandings: standingsArray
  };
}
