import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyScoringTrends } from '../src/lib/compute/trends.js';

test('builds completed weekly scoring averages and season records', () => {
  const result = buildWeeklyScoringTrends(
    {
      1: [{ week: 1, pf: 110 }, { week: 2, pf: 130 }],
      2: [{ week: 1, pf: 90 }, { week: 2, pf: 150 }],
      3: [{ week: 1, pf: 100 }, { week: 2, pf: 0 }],
    },
    {
      1: { team_name: 'Alpha', owner_name: 'Owner A' },
      2: { team_name: 'Bravo', owner_name: 'Owner B' },
      3: { team_name: 'Charlie', owner_name: 'Owner C' },
    }
  );

  assert.deepEqual(
    result.weeks.map((week) => ({
      week: week.week,
      averageScore: week.averageScore,
      teamCount: week.teamCount,
      highScore: week.highScore.score,
      highTeam: week.highScore.teamName,
      lowScore: week.lowScore.score,
      lowTeam: week.lowScore.teamName,
    })),
    [
      { week: 1, averageScore: 100, teamCount: 3, highScore: 110, highTeam: 'Alpha', lowScore: 90, lowTeam: 'Bravo' },
      { week: 2, averageScore: 140, teamCount: 2, highScore: 150, highTeam: 'Bravo', lowScore: 130, lowTeam: 'Alpha' },
    ]
  );
  assert.deepEqual(
    { team: result.seasonHigh.teamName, week: result.seasonHigh.week, score: result.seasonHigh.score },
    { team: 'Bravo', week: 2, score: 150 }
  );
  assert.deepEqual(
    { team: result.seasonLow.teamName, week: result.seasonLow.week, score: result.seasonLow.score },
    { team: 'Bravo', week: 1, score: 90 }
  );
});

test('ignores malformed rows and zero scores that represent unavailable starter scoring', () => {
  const result = buildWeeklyScoringTrends(
    {
      1: [{ week: 1, pf: 0 }, { week: 'bad', pf: 120 }, { week: 2, pf: 'not-a-score' }],
      2: null,
    },
    {}
  );

  assert.deepEqual(result.weeks, []);
  assert.equal(result.seasonHigh, null);
  assert.equal(result.seasonLow, null);
});
