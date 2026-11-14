import test from 'node:test';
import assert from 'node:assert/strict';
import { getCompletedWeekForLeague } from '../src/lib/compute/weekCutoff.js';

test('active season exposes only the week before Sleeper current leg', () => {
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: { leg: 10 } }), 9);
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: { leg: '4' } }), 3);
});

test('first active week exposes no completed weeks', () => {
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: { leg: 1 } }), 0);
});

test('completed and non-active seasons are not cutoff', () => {
  assert.equal(getCompletedWeekForLeague({ status: 'complete', settings: { leg: 10 } }), null);
  assert.equal(getCompletedWeekForLeague({ status: 'pre_draft', settings: { leg: 1 } }), null);
  assert.equal(getCompletedWeekForLeague(null), null);
});

test('invalid active-season leg conservatively exposes no weeks', () => {
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: {} }), 0);
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: { leg: 0 } }), 0);
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: { leg: 'unknown' } }), 0);
});
