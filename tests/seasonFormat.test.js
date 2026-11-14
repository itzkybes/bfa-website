import test from 'node:test';
import assert from 'node:assert/strict';
import { getSeasonFormat } from '../src/lib/compute/seasonFormat.js';

const expected = {
  2022: [19, 20, 6, 8],
  2023: [20, 21, 8, 6],
  2024: [20, 21, 8, 6],
  2025: [19, 20, 8, 6],
};

for (const [season, [regularSeasonWeeks, playoffStart, playoffTeams, toiletBowlTeams]] of Object.entries(expected)) {
  test(`${season} keeps its historical BFA format`, () => {
    assert.deepEqual(getSeasonFormat(season), {
      regularSeasonWeeks,
      playoffStart,
      playoffTeams,
      toiletBowlTeams,
      playoffWeeks: 3,
      playoffEnd: playoffStart + 2,
    });
  });
}

test('2026 and future seasons use the current BFA format', () => {
  for (const season of [2026, 2027, 2035]) {
    assert.deepEqual(getSeasonFormat(season), {
      regularSeasonWeeks: 18,
      playoffStart: 19,
      playoffTeams: 8,
      toiletBowlTeams: 6,
      playoffWeeks: 3,
      playoffEnd: 21,
    });
  }
});

test('unknown seasons fall back to Sleeper playoff settings', () => {
  assert.deepEqual(getSeasonFormat(2021, { playoff_week_start: 18, playoff_teams: 4 }), {
    regularSeasonWeeks: 17,
    playoffStart: 18,
    playoffTeams: 4,
    toiletBowlTeams: null,
    playoffWeeks: 3,
    playoffEnd: 20,
  });
});

test('invalid fallback settings return null', () => {
  assert.equal(getSeasonFormat(2021, {}), null);
  assert.equal(getSeasonFormat(2021, { playoff_week_start: 0 }), null);
});
