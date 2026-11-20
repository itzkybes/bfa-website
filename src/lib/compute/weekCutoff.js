// Shared cutoff for completed fantasy weeks across every BFA stat page.
// BFA weeks roll over Monday at 3:00 a.m. America/New_York. During an active
// season Sleeper's settings.leg is the current scoring week, so only the
// preceding leg is complete. A finished season exposes only its configured
// season weeks; pre-draft, drafting, and unknown seasons expose no stats.
export function getCompletedWeekForLeague(leagueMeta, seasonEndWeek = 25) {
  const endWeek = Number(seasonEndWeek);
  const maxWeek = Number.isInteger(endWeek) && endWeek > 0 ? endWeek : 25;

  if (!leagueMeta) return 0;
  if (leagueMeta.status === 'complete') return maxWeek;
  if (leagueMeta.status !== 'in_season') return 0;

  const currentWeek = Number(leagueMeta?.settings?.leg);
  if (!Number.isInteger(currentWeek) || currentWeek < 1) return 0;

  return Math.max(0, Math.min(currentWeek - 1, maxWeek));
}
