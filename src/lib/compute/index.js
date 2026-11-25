// Barrel for `$lib/compute` — one short import for everything callers need.
//
// `HARDCODED_CHAMPIONS` is intentionally NOT re-exported; it's an internal
// fallback used only by the standings computer.

export { computeParticipantPoints, starterPointsByPid, aggregatePlayerPoints, aggregateFinalsMvpPoints } from './scoring';
export { computeStreaks } from './streaks';
export { filterPlayoffMatchups } from './playoffEligibility';
export { resolveFinalStandingsFromBrackets, getChampionshipGame } from './brackets';
export { getLatestOwnerAvatars, applyLatestAvatars } from './avatars';
export { computeStandingsForLeague } from './standings';
export { buildWeeklyScoringTrends, buildRecentVsSeasonComparison, buildLeagueScoringHistory, buildStandingsMovementSeries } from './trends';
export { getStandingsMovementFromSnapshots } from './standingsMovement';
export { computeMatchupsForLeagueWeek } from './matchups';
