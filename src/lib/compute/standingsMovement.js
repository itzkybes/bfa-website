// Compare completed regular-season standings snapshots and retain the full
// sequence for the Trends page's week-by-week rank movement chart.
export function getStandingsMovementFromSnapshots(snapshots) {
  const history = (Array.isArray(snapshots) ? snapshots : []).map((snapshot) => ({
    week: Number(snapshot?.week),
    ranks: { ...(snapshot?.ranks || {}) },
  })).filter((snapshot) => Number.isInteger(snapshot.week));

  if (history.length < 2) {
    return {
      byRoster: {},
      previousWeek: null,
      latestWeek: history[0]?.week ?? null,
      snapshots: history,
    };
  }

  const previous = history[history.length - 2];
  const latest = history[history.length - 1];
  const byRoster = {};

  for (const [rosterId, currentRank] of Object.entries(latest?.ranks || {})) {
    const previousRank = previous?.ranks?.[rosterId];
    if (Number.isInteger(previousRank) && Number.isInteger(currentRank)) {
      byRoster[rosterId] = previousRank - currentRank;
    }
  }

  return {
    byRoster,
    previousWeek: previous?.week ?? null,
    latestWeek: latest?.week ?? null,
    snapshots: history,
  };
}
