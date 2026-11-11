// Canonical BFA season format. Keep playoff timing and qualification counts here
// so standings, matchups, snapshot generation, and historical pages agree.
const SEASON_FORMATS = {
  2022: { regularSeasonWeeks: 19, playoffStart: 20, playoffTeams: 6, toiletBowlTeams: 8 },
  2023: { regularSeasonWeeks: 20, playoffStart: 21, playoffTeams: 8, toiletBowlTeams: 6 },
  2024: { regularSeasonWeeks: 20, playoffStart: 21, playoffTeams: 8, toiletBowlTeams: 6 },
  2025: { regularSeasonWeeks: 19, playoffStart: 20, playoffTeams: 8, toiletBowlTeams: 6 },
};
const FUTURE_FORMAT = {
  regularSeasonWeeks: 18, playoffStart: 19, playoffTeams: 8, toiletBowlTeams: 6,
};

export function getSeasonFormat(season, sleeperSettings = {}) {
  const year = Number(season);
  let format = Number.isInteger(year) ? SEASON_FORMATS[year] : null;
  if (!format && Number.isInteger(year) && year >= 2026) format = FUTURE_FORMAT;
  if (!format) {
    const sleeperStart = Number(sleeperSettings?.playoff_week_start);
    if (!Number.isInteger(sleeperStart) || sleeperStart < 1) return null;
    const sleeperTeams = Number(sleeperSettings?.playoff_teams);
    format = {
      regularSeasonWeeks: sleeperStart - 1,
      playoffStart: sleeperStart,
      playoffTeams: Number.isInteger(sleeperTeams) && sleeperTeams > 0 ? sleeperTeams : 8,
      toiletBowlTeams: null,
    };
  }
  return { ...format, playoffWeeks: 3, playoffEnd: format.playoffStart + 2 };
}
