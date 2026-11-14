import test from 'node:test';
import assert from 'node:assert/strict';
import { compareStandings } from '../src/lib/compute/standingsSort.js';

test('wins rank ahead of points for', () => {
  const lowerWinsMorePoints = { wins: 8, pf: 1900 };
  const moreWinsFewerPoints = { wins: 9, pf: 1700 };
  assert.ok(compareStandings(moreWinsFewerPoints, lowerWinsMorePoints) < 0);
  assert.ok(compareStandings(lowerWinsMorePoints, moreWinsFewerPoints) > 0);
});

test('points for breaks ties when wins are equal', () => {
  const highPoints = { wins: 7, pf: 1800.25 };
  const lowPoints = { wins: 7, pf: 1799.5 };
  assert.ok(compareStandings(highPoints, lowPoints) < 0);
});

test('equal wins and points for remain tied', () => {
  assert.equal(compareStandings({ wins: 5, pf: 1200 }, { wins: 5, pf: 1200 }), 0);
});

test('missing stats are treated as zero', () => {
  assert.equal(compareStandings({}, { wins: 0, pf: 0 }), 0);
  assert.ok(compareStandings({ wins: 1 }, {}) < 0);
});

test('sorting produces wins-descending then points-for-descending order', () => {
  const rows = [
    { rosterId: 'a', wins: 7, pf: 1800 },
    { rosterId: 'b', wins: 8, pf: 1500 },
    { rosterId: 'c', wins: 7, pf: 1900 },
  ];
  rows.sort(compareStandings);
  assert.deepEqual(rows.map((row) => row.rosterId), ['b', 'c', 'a']);
});
