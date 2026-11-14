// Derive week-over-week regular-season standings movement from the matchups
// already collected for the selected season. Uses the same scoring and
// opponent-average win/loss calculation as the main standings computation.
import { computeParticipantPoints } from './scoring';

export function getStandingsMovement(collectedMatchups, playoffStart) {
  if (!collectedMatchups || !Number.isInteger(Number(playoffStart))) {
    return { byRoster: {}, previousWeek: null, latestWeek: null };
  }

  const weeks = Object.keys(collectedMatchups)
    .map(Number)
    .filter((week) => Number.isInteger(week) && week >= 1 && week < Number(playoffStart))
    .sort((a, b) => a - b);

  if (weeks.length < 2) {
    return { byRoster: {}, previousWeek: null, latestWeek: weeks.at(-1) ?? null };
  }

  const totals = {};
  let previousRanks = {};
  let latestRanks = {};

  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex++) {
    const week = weeks[weekIndex];
    const entries = Array.isArray(collectedMatchups[String(week)])
      ? collectedMatchups[String(week)]
      : [];
    const groups = new Map();

    entries.forEach((entry, entryIndex) => {
      const rosterId = String(entry?.roster_id ?? entry?.rosterId ?? entry?.owner_id ?? '');
      if (!rosterId) return;
      const matchupId = entry?.matchup_id ?? entry?.matchupId ?? null;
      const key = matchupId != null ? `${matchupId}|${week}` : `auto|${week}|${entryIndex}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ rosterId, points: computeParticipantPoints(entry) });
      if (!totals[rosterId]) totals[rosterId] = { wins: 0, losses: 0, ties: 0, pf: 0 };
      totals[rosterId].pf += computeParticipantPoints(entry);
    });

    for (const participants of groups.values()) {
      if (participants.length < 2) continue;
      for (const participant of participants) {
        const opponents = participants.filter((other) => other.rosterId !== participant.rosterId);
        if (!opponents.length) continue;
        const opponentAverage = opponents.reduce((sum, other) => sum + other.points, 0) / opponents.length;
        const stats = totals[participant.rosterId];
        if (participant.points > opponentAverage + 1e-9) stats.wins += 1;
        else if (participant.points < opponentAverage - 1e-9) stats.losses += 1;
        else stats.ties += 1;
      }
    }

    const ranked = Object.entries(totals).sort((a, b) => {
      if (b[1].wins !== a[1].wins) return b[1].wins - a[1].wins;
      return b[1].pf - a[1].pf;
    });
    const ranks = Object.fromEntries(ranked.map(([rosterId], index) => [rosterId, index + 1]));

    if (weekIndex === weeks.length - 2) previousRanks = ranks;
    if (weekIndex === weeks.length - 1) latestRanks = ranks;
  }

  const byRoster = {};
  for (const [rosterId, currentRank] of Object.entries(latestRanks)) {
    const previousRank = previousRanks[rosterId];
    if (previousRank != null) byRoster[rosterId] = previousRank - currentRank;
  }

  return {
    byRoster,
    previousWeek: weeks[weeks.length - 2],
    latestWeek: weeks[weeks.length - 1],
  };
}
