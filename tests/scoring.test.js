import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePlayerPoints } from '../src/lib/compute/scoring.js';

test('aggregatePlayerPoints preserves total points and attributes scoring to each roster', () => {
  const result = aggregatePlayerPoints([
    { roster_id: '1', starters: ['player-a', 'player-b'], starters_points: [20, 8] },
    { roster_id: '2', starters: ['player-a'], starters_points: [35] },
    { roster_id: '1', starters: ['player-a'], starters_points: [15] },
  ]);

  assert.equal(result['player-a'].points, 70);
  assert.deepEqual(result['player-a'].pointsByRoster, { '1': 35, '2': 35 });
  assert.equal(result['player-a'].rosterId, '1');
  assert.equal(result['player-b'].points, 8);
  assert.deepEqual(result['player-b'].pointsByRoster, { '1': 8 });
});

test('aggregatePlayerPoints uses starter points aliases without reading raw player points', () => {
  const result = aggregatePlayerPoints([
    {
      roster_id: '4',
      starters: ['player-a'],
      starter_points: [12],
      player_points: { 'player-a': 999 },
    },
  ]);

  assert.equal(result['player-a'].points, 12);
  assert.deepEqual(result['player-a'].pointsByRoster, { '4': 12 });
});

import { computeParticipantPoints } from '../src/lib/compute/scoring.js';

test('computeParticipantPoints sums only starter points and ignores full-roster totals', () => {
  const result = computeParticipantPoints({
    starters: ['starter-a', 'starter-b'],
    starters_points: [24.5, 18],
    players_points: { 'starter-a': 24.5, 'starter-b': 18, 'bench-c': 42 },
    points: 84.5,
  });

  assert.equal(result, 42.5);
});

test('computeParticipantPoints does not fall back to ambiguous team points when starter data is missing', () => {
  assert.equal(computeParticipantPoints({
    starters: ['starter-a'],
    player_points: { 'starter-a': 20, 'bench-b': 35 },
    points: 55,
  }), 0);
});

test('computeParticipantPoints preserves explicit historical score overrides', () => {
  assert.equal(computeParticipantPoints({
    __final_score: 91.25,
    starters: ['starter-a'],
    starters_points: [20],
    points: 120,
  }), 91.25);
});
