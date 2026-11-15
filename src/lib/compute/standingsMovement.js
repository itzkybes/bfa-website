// Compare the latest two completed regular-season standings snapshots.
// Snapshots are captured inside standings.js from the exact cumulative
// totals used by the official table, so historical score overrides and
// opponent-average results stay consistent.
export function getStandingsMovementFromSnapshots(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return { byRoster: {}, previousWeek: null, latestWeek: snapshots?.[0]?.week ?? null };
  }

  const previous = snapshots[snapshots.length - 2];
  const latest = snapshots[snapshots.length - 1];
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
  };
}
