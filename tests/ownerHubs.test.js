import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerHubs } from '../src/lib/compute/ownerHubs.js';

function entry(roster_id, matchup_id, points, playerPoints) {
  return {
    roster_id,
    matchup_id,
    points,
    starters: ['player-1'],
    starters_points: [playerPoints],
  };
}

test('Owner Hub playoff records stop after the third playoff week', () => {
  const result = buildOwnerHubs(
    [{
      leagueSeason: '2026',
      playoffStart: 19,
      // Intentionally omit playoffEnd to exercise the canonical format fallback.
      regularStandings: [{ rosterId: '1', wins: 10, losses: 8, pf: 1800, pa: 1700 }],
      rosterMap: {
        1: { owner_username: 'owner-one', team_name: 'Team One' },
        2: { owner_username: 'owner-two', team_name: 'Team Two' },
      },
      collectedMatchups: {
        18: [entry('1', 'w18', 120, 12), entry('2', 'w18', 100, 8)],
        19: [entry('1', 'w19', 110, 15), entry('2', 'w19', 100, 10)],
        20: [entry('1', 'w20', 115, 20), entry('2', 'w20', 100, 10)],
        21: [entry('1', 'w21', 118, 30), entry('2', 'w21', 100, 10)],
        22: [entry('1', 'w22', 150, 99), entry('2', 'w22', 100, 10)],
      },
    }],
    [{ season: '2026' }],
    { 'player-1': { full_name: 'Test Player' } }
  );

  const owner = result['owner-one'];
  assert.equal(owner.bestSingleGame.points, 12);
  assert.equal(owner.bestSingleGame.week, 18);
  assert.equal(owner.bestPlayoffGame.points, 30);
  assert.equal(owner.bestPlayoffGame.week, 21);
  assert.equal(owner.highestWeek.points, 120);
  assert.equal(owner.highestWeek.week, 18);
});

for (const [season, playoffStart] of [[2022, 20], [2023, 21], [2024, 21], [2025, 20], [2026, 19]]) {
  test(`Owner Hub uses the three-week playoff window for ${season}`, () => {
    const playoffEnd = playoffStart + 2;
    const collectedMatchups = {};
    for (let week = playoffStart; week <= playoffEnd + 1; week++) {
      collectedMatchups[week] = [
        entry('1', `w${week}`, 100, week),
        entry('2', `w${week}`, 90, 1),
      ];
    }
    const result = buildOwnerHubs(
      [{
        leagueSeason: String(season),
        playoffStart,
        regularStandings: [{ rosterId: '1', wins: 1, losses: 1, pf: 100, pa: 90 }],
        rosterMap: {
          1: { owner_username: 'owner-one' },
          2: { owner_username: 'owner-two' },
        },
        collectedMatchups,
      }],
      [{ season: String(season) }]
    );

    assert.equal(result['owner-one'].bestPlayoffGame.week, playoffEnd);
    assert.equal(result['owner-one'].bestPlayoffGame.points, playoffEnd);
  });
}
