import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPlayoffMatchups } from '../src/lib/compute/playoffEligibility.js';

function entry(roster_id, matchup_id) {
  return { roster_id: String(roster_id), matchup_id };
}

test('playoff matchup filter excludes every Toilet Bowl and mixed-field matchup', () => {
  const collected = {
    19: [
      entry(1, 'winner-round-one'),
      entry(2, 'winner-round-one'),
      entry(9, 'toilet-bowl'),
      entry(10, 'toilet-bowl'),
      entry(3, 'mixed-field'),
      entry(9, 'mixed-field'),
    ],
    20: [
      entry(3, 'placement-round'),
      entry(4, 'placement-round'),
    ],
    22: [
      entry(1, 'outside-playoff-window'),
      entry(2, 'outside-playoff-window'),
    ],
  };

  const result = filterPlayoffMatchups(collected, ['1', '2', '3', '4'], 19, 21);

  assert.deepEqual(Object.keys(result), ['19', '20']);
  assert.deepEqual(result['19'], collected[19].slice(0, 2));
  assert.deepEqual(result['20'], collected[20]);
});

test('playoff matchup filter retains eligible bye weeks and accepts numeric or string IDs', () => {
  const collected = {
    20: [
      { rosterId: '1', matchupId: 1 },
      { roster_id: 2, matchup_id: 2 },
      { roster_id: 9, matchup_id: 3 },
    ],
  };

  const result = filterPlayoffMatchups(collected, [1, '2'], 19, 21);

  assert.deepEqual(result['20'], collected[20].slice(0, 2));
});

test('playoff matchup filter returns no stats before playoff teams are established', () => {
  const collected = {
    19: [entry(1, 'matchup'), entry(2, 'matchup')],
  };

  assert.deepEqual(filterPlayoffMatchups(collected, [], 19, 21), {});
});

test('playoff matchup filter is limited to the season-specific playoff window', () => {
  const collected = {
    18: [entry(1, 'regular'), entry(2, 'regular')],
    20: [entry(1, 'playoffs'), entry(2, 'playoffs')],
    22: [entry(1, 'final-round'), entry(2, 'final-round')],
    23: [entry(1, 'postseason-over'), entry(2, 'postseason-over')],
  };

  assert.deepEqual(
    filterPlayoffMatchups(collected, ['1', '2'], 20, 22),
    {
      20: collected[20],
      22: collected[22],
    }
  );
});
