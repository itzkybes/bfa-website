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
        // Omit playoff metadata so the shared season format supplies both bounds.
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

test('Owner Hub counts franchise records only in regular season', () => {
  const result = buildOwnerHubs(
    [{
      leagueSeason: '2026',
      regularStandings: [{ rosterId: '1', wins: 7, losses: 11, pf: 1500, pa: 1600 }],
      rosterMap: {
        1: { owner_username: 'Owner-One', team_name: 'Team One' },
        2: { owner_username: 'owner-two', team_name: 'Team Two' },
      },
      collectedMatchups: {
        18: [entry('1', 'regular', 130, 25), entry('2', 'regular', 100, 5)],
        19: [entry('1', 'playoff-1', 140, 40), entry('2', 'playoff-1', 100, 5)],
        20: [entry('1', 'playoff-2', 150, 50), entry('2', 'playoff-2', 100, 5)],
        21: [entry('1', 'playoff-3', 160, 60), entry('2', 'playoff-3', 100, 5)],
        22: [entry('1', 'after-playoffs', 999, 999), entry('2', 'after-playoffs', 100, 5)],
      },
    }],
    [{ season: '2026' }]
  );

  const owner = result['owner-one'];
  assert.equal(owner.careerWins, 7);
  assert.equal(owner.careerLosses, 11);
  assert.equal(owner.careerPF, 1500);
  assert.equal(owner.careerPA, 1600);
  assert.equal(owner.highestWeek.week, 18);
  assert.equal(owner.highestWeek.points, 130);
  assert.equal(owner.bestSingleGame.week, 18);
  assert.equal(owner.bestSingleGame.points, 25);
  assert.equal(owner.bestPlayoffGame.week, 21);
  assert.equal(owner.bestPlayoffGame.points, 60);
});

test('Owner Hub uses starters_points and ignores player_points', () => {
  const result = buildOwnerHubs(
    [{
      leagueSeason: '2026',
      regularStandings: [{ rosterId: '1', wins: 1, losses: 0, pf: 100, pa: 90 }],
      rosterMap: { 1: { owner_username: 'owner-one' } },
      collectedMatchups: {
        18: [{
          roster_id: '1',
          matchup_id: 'only-game',
          points: 100,
          starters: ['player-1'],
          starters_points: [17],
          player_points: { 'player-1': 999 },
        }],
      },
    }],
    [{ season: '2026' }],
    { 'player-1': { full_name: 'Test Player' } }
  );

  assert.equal(result['owner-one'].bestSingleGame.points, 17);
  assert.equal(result['owner-one'].bestSingleGame.player_name, 'Test Player');
});

test('Owner Hub merges owner identity case-insensitively and calculates win percentage', () => {
  const result = buildOwnerHubs(
    [{
      leagueSeason: '2025',
      regularStandings: [
        { rosterId: '1', wins: 8, losses: 2, pf: 1000, pa: 900 },
        { rosterId: '2', wins: 4, losses: 6, pf: 900, pa: 1000 },
      ],
      rosterMap: {
        1: { owner_username: 'SameOwner' },
        2: { owner_username: 'sameowner' },
      },
      collectedMatchups: {},
    }],
    [{ season: '2025' }]
  );

  assert.equal(Object.keys(result).length, 1);
  assert.equal(result.sameowner.careerWins, 12);
  assert.equal(result.sameowner.careerLosses, 8);
  assert.equal(result.sameowner.seasonsPlayed, 1);
  assert.equal(result.sameowner.winPct, 0.6);
});


test('Owner Hub adds career efficiency and season-by-season totals', () => {
  const result = buildOwnerHubs(
    [{
      leagueSeason: '2025',
      bracketComplete: true,
      regularStandings: [
        { rosterId: '1', wins: 8, losses: 2, ties: 1, pf: 1100, pa: 1000 },
        { rosterId: '2', wins: 4, losses: 6, ties: 0, pf: 900, pa: 950 },
      ],
      finalStandings: [
        { rosterId: '1', rank: 2, isChampion: false, isPlayoff: true },
        { rosterId: '2', rank: 8, isChampion: false, isPlayoff: false },
      ],
      rosterMap: {
        1: { owner_username: 'owner-one' },
        2: { owner_username: 'owner-two' },
      },
      collectedMatchups: {},
    }],
    [{ season: '2025' }]
  );

  const owner = result['owner-one'];
  assert.equal(owner.careerTies, 1);
  assert.equal(owner.gamesPlayed, 11);
  assert.equal(owner.winPct, 8.5 / 11);
  assert.equal(owner.avgPF, 100);
  assert.equal(owner.avgPA, 1000 / 11);
  assert.equal(owner.pointDifferential, 100);
  assert.equal(owner.avgMargin, 100 / 11);
  assert.deepEqual(owner.seasonHistory, [{
    season: '2025', wins: 8, losses: 2, ties: 1, pf: 1100, pa: 1000, finish: 2,
  }]);
});
