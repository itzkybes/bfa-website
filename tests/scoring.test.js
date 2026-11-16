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
