// Barrel for `$lib/compute` — one short import for everything callers need.
//
// `HARDCODED_CHAMPIONS` is intentionally NOT re-exported; it's an internal
// fallback used only by the standings computer.

export { computeParticipantPoints, starterPointsByPid } from './scoring';
export { computeStreaks } from './streaks';
export { resolveFinalStandingsFromBrackets, getChampionshipGame } from './brackets';
export { getLatestOwnerAvatars, applyLatestAvatars } from './avatars';
export { computeStandingsForLeague } from './standings';
export { computeMatchupsForLeagueWeek } from './matchups';
