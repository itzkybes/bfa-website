import { getMatchupsForSeason } from '$lib/matchups.js';

export async function load({ params }) {
  const season = params.season ?? '2023';

  const { matchupsRows, placementMap } = await getMatchupsForSeason(season);

  // Walk bracket + compute final standings (simplified)
  const finalStandings = {};

  matchupsRows.forEach(m => {
    const homeScore = m.home.score ?? 0;
    const awayScore = m.away.score ?? 0;
    const winner = homeScore >= awayScore ? m.home : m.away;
    const loser  = homeScore >= awayScore ? m.away : m.home;

    // Label winners/losers rounds here if needed:
    if (m.round === 1) m.roundLabel = 'Quarterfinals';
    if (m.round === 2) m.roundLabel = 'Semifinals';
    if (m.round === 3) m.roundLabel = 'Championship';
    if (m.round === '5th') m.roundLabel = 'Consolation (5th Place)';
    if (m.round === '7th') m.roundLabel = 'Consolation (7th Place)';

    // Put champion / final places in finalStandings
    if (m.roundLabel === 'Championship') {
      finalStandings[placementMap[winner.rosterId].seed] = 1;
      finalStandings[placementMap[loser.rosterId].seed] = 2;
    }
    if (m.roundLabel === 'Consolation (5th Place)') {
      finalStandings[placementMap[winner.rosterId].seed] = 5;
      finalStandings[placementMap[loser.rosterId].seed] = 6;
    }
    if (m.roundLabel === 'Consolation (7th Place)') {
      finalStandings[placementMap[winner.rosterId].seed] = 7;
      finalStandings[placementMap[loser.rosterId].seed] = 8;
    }
    // …etc (fill in for all spots down to 14th)
  });

  // Convert to array with names
  const standingsArray = Object.entries(finalStandings)
    .map(([seed, place]) => {
      const rosterId = Object.keys(placementMap)
        .find(r => placementMap[r].seed === parseInt(seed, 10));
      const teamName = placementMap[rosterId]?.name ?? `Seed ${seed}`;
      return { seed: parseInt(seed, 10), place, teamName };
    })
    .sort((a, b) => a.place - b.place);

  return {
    season,
    matchupsRows,
    finalStandings: standingsArray
  };
}
