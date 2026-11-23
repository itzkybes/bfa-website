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

test('builds team scoring profiles and ranks lower standard deviation as more consistent', async () => {
  const { buildTeamScoringProfiles } = await import('../src/lib/compute/trends.js');
  const result = buildTeamScoringProfiles(
    {
      1: [{ week: 1, pf: 100 }, { week: 2, pf: 100 }, { week: 3, pf: 100 }],
      2: [{ week: 1, pf: 80 }, { week: 2, pf: 120 }, { week: 3, pf: 0 }],
    },
    {
      1: { team_name: 'Steady' },
      2: { team_name: 'Volatile' },
    }
  );

  assert.deepEqual(result.map((team) => team.teamName), ['Steady', 'Volatile']);
  assert.equal(result[0].averageScore, 100);
  assert.equal(result[0].standardDeviation, 0);
  assert.equal(result[1].range, 40);
  assert.equal(result[1].weeksPlayed, 2);
});

test('compares the latest completed weeks against each team season average', async () => {
  const { buildRecentVsSeasonComparison } = await import('../src/lib/compute/trends.js');
  const result = buildRecentVsSeasonComparison(
    {
      1: [{ week: 1, pf: 100 }, { week: 2, pf: 110 }, { week: 3, pf: 130 }, { week: 4, pf: 150 }],
      2: [{ week: 1, pf: 120 }, { week: 2, pf: 100 }, { week: 3, pf: 0 }, { week: 4, pf: 100 }],
    },
    { 1: { team_name: 'Alpha' }, 2: { team_name: 'Bravo' } },
    2
  );

  assert.deepEqual(result.recentWeeks, [3, 4]);
  assert.equal(result.teams.find((team) => team.rosterId === '1').seasonAverage, 122.5);
  assert.equal(result.teams.find((team) => team.rosterId === '1').recentAverage, 140);
  assert.equal(result.teams.find((team) => team.rosterId === '2').recentAverage, 100);
  assert.ok(Math.abs(result.teams.find((team) => team.rosterId === '2').difference + (20 / 3)) < 1e-9);
});

test('builds league scoring history from valid team-week scores only', async () => {
  const { buildLeagueScoringHistory } = await import('../src/lib/compute/trends.js');
  const result = buildLeagueScoringHistory([
    { season: 2024, weeklyPfByRoster: { 1: [{ week: 1, pf: 100 }, { week: 2, pf: 120 }], 2: [{ week: 1, pf: 80 }] } },
    { season: 2025, weeklyPfByRoster: { 1: [{ week: 1, pf: 0 }, { week: 2, pf: 140 }] } },
  ]);

  assert.deepEqual(result.map((row) => ({ season: row.season, averageScore: row.averageScore, scoreCount: row.scoreCount })), [
    { season: '2024', averageScore: 100, scoreCount: 3 },
    { season: '2025', averageScore: 140, scoreCount: 1 },
  ]);
});

test('builds rank series from every completed standings snapshot', async () => {
  const { buildStandingsMovementSeries } = await import('../src/lib/compute/trends.js');
  const result = buildStandingsMovementSeries(
    [
      { week: 1, ranks: { 1: 1, 2: 2 } },
      { week: 2, ranks: { 1: 2, 2: 1 } },
    ],
    { 1: { team_name: 'Alpha' }, 2: { team_name: 'Bravo' } }
  );

  assert.deepEqual(result.weeks, [1, 2]);
  assert.deepEqual(result.teams.map((team) => team.ranks), [[1, 2], [2, 1]]);
});
