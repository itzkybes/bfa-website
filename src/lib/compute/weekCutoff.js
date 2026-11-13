// Shared cutoff for in-progress fantasy weeks.
// Sleeper's league settings.leg identifies the current scoring week. BFA weeks
// roll over at 3:00 a.m. America/New_York on Monday; the current leg stays
// hidden until Sleeper advances to the next leg at that boundary.
// Completed seasons are intentionally unaffected.
export function getCompletedWeekForLeague(leagueMeta) {
  if (leagueMeta?.status !== 'in_season') return null;

  const currentWeek = Number(leagueMeta?.settings?.leg);
  if (!Number.isInteger(currentWeek) || currentWeek < 1) return 0;

  return currentWeek - 1;
}
