import test from 'node:test';
import assert from 'node:assert/strict';
import { getCompletedWeekForLeague } from '../src/lib/compute/weekCutoff.js';

test('active season exposes only the week before Sleeper current leg', () => {
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: { leg: 10 } }, 21), 9);
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: { leg: '4' } }, 21), 3);
});

test('first active week exposes no completed weeks', () => {
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: { leg: 1 } }, 21), 0);
});

test('completed seasons expose only their configured season weeks', () => {
  assert.equal(getCompletedWeekForLeague({ status: 'complete', settings: { leg: 10 } }, 21), 21);
  assert.equal(getCompletedWeekForLeague({ status: 'complete' }, 23), 23);
});

test('pre-draft, drafting, and unknown seasons expose no stats', () => {
  assert.equal(getCompletedWeekForLeague({ status: 'pre_draft', settings: { leg: 1 } }, 21), 0);
  assert.equal(getCompletedWeekForLeague({ status: 'drafting', settings: { leg: 1 } }, 21), 0);
  assert.equal(getCompletedWeekForLeague(null, 21), 0);
});

test('active season cutoff is capped at the configured final week', () => {
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: { leg: 25 } }, 21), 21);
});

test('invalid active-season leg conservatively exposes no weeks', () => {
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: {} }, 21), 0);
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: { leg: 0 } }, 21), 0);
  assert.equal(getCompletedWeekForLeague({ status: 'in_season', settings: { leg: 'unknown' } }, 21), 0);
});
