import test from 'node:test';
import assert from 'node:assert/strict';
import { getStandingsMovementFromSnapshots } from '../src/lib/compute/standingsMovement.js';

test('movement is empty until two completed regular-season weeks exist', () => {
  assert.deepEqual(getStandingsMovementFromSnapshots([]), {
    byRoster: {}, previousWeek: null, latestWeek: null, snapshots: [],
  });
  assert.deepEqual(getStandingsMovementFromSnapshots([{ week: 1, ranks: { a: 1 } }]), {
    byRoster: {}, previousWeek: null, latestWeek: 1, snapshots: [{ week: 1, ranks: { a: 1 } }],
  });
});

test('movement compares cumulative ranks from the latest two snapshots', () => {
  const result = getStandingsMovementFromSnapshots([
    { week: 4, ranks: { a: 1, b: 2, c: 3 } },
    { week: 5, ranks: { a: 2, b: 1, c: 3 } },
  ]);

  assert.deepEqual(result, {
    byRoster: { a: -1, b: 1, c: 0 },
    previousWeek: 4,
    latestWeek: 5,
    snapshots: [
      { week: 4, ranks: { a: 1, b: 2, c: 3 } },
      { week: 5, ranks: { a: 2, b: 1, c: 3 } },
    ],
  });
});

test('newly appearing rosters do not receive a fabricated movement value', () => {
  const result = getStandingsMovementFromSnapshots([
    { week: 1, ranks: { a: 1, b: 2 } },
    { week: 2, ranks: { a: 2, b: 1, c: 3 } },
  ]);

  assert.deepEqual(result.byRoster, { a: -1, b: 1 });
});
