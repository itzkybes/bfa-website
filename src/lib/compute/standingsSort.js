// BFA standings order: wins first, then total points for as the tiebreaker.
export function compareStandings(a, b) {
  if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
  return (b.pf || 0) - (a.pf || 0);
}
