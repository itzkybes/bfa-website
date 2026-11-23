import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyBracketTemplate,
  isBracketPlacementMatch,
} from '../src/lib/compute/honorHallBracket.js';

test('empty championship bracket uses the full 2025-style 4/4/4 structure', () => {
  const matches = createEmptyBracketTemplate('winners', 8, 6);
  const byRound = (round) => matches.filter((match) => match.r === round);
  assert.deepEqual([1, 2, 3].map((round) => byRound(round).length), [4, 4, 4]);
  assert.deepEqual([1, 2, 3].map((round) =>
    byRound(round).filter((match) => !isBracketPlacementMatch(match, 'winners', matches, 2026)).length
  ), [4, 2, 2]);
  assert.deepEqual([1, 2, 3].map((round) =>
    byRound(round).filter((match) => isBracketPlacementMatch(match, 'winners', matches, 2026)).length
  ), [0, 2, 2]);
  assert.ok(matches.every((match) => match.t1 == null && match.t2 == null));
});

test('empty Toilet Bowl uses the same three-round layout with its six-team field', () => {
  const matches = createEmptyBracketTemplate('losers', 8, 6);
  const byRound = (round) => matches.filter((match) => match.r === round);
  assert.deepEqual([1, 2, 3].map((round) => byRound(round).length), [3, 3, 3]);
  assert.deepEqual([1, 2, 3].map((round) =>
    byRound(round).filter((match) => !isBracketPlacementMatch(match, 'losers', matches, 2026)).length
  ), [3, 1, 1]);
  assert.deepEqual([1, 2, 3].map((round) =>
    byRound(round).filter((match) => isBracketPlacementMatch(match, 'losers', matches, 2026)).length
  ), [0, 2, 2]);
  assert.ok(matches.every((match) => match.t1 == null && match.t2 == null));
});

test('completed historical championship bracket still classifies game progress', () => {
  const completed = [
    { r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 },
    { r: 1, m: 2, t1: 3, t2: 4, w: 3, l: 4 },
    { r: 1, m: 3, t1: 5, t2: 6, w: 5, l: 6 },
    { r: 1, m: 4, t1: 7, t2: 8, w: 7, l: 8 },
    { r: 2, m: 11, p: 1, t1: 1, t2: 3, w: 1, l: 3 },
    { r: 2, m: 12, p: 2, t1: 5, t2: 7, w: 5, l: 7 },
    { r: 2, m: 13, p: 3, t1: 2, t2: 4, w: 2, l: 4 },
    { r: 2, m: 14, p: 4, t1: 6, t2: 8, w: 6, l: 8 },
    { r: 3, m: 21, p: 1, t1: 1, t2: 5 },
    { r: 3, m: 22, p: 2, t1: 3, t2: 7 },
    { r: 3, m: 23, p: 3, t1: 2, t2: 6 },
    { r: 3, m: 24, p: 4, t1: 4, t2: 8 },
  ];
  assert.deepEqual(
    completed.filter((match) => match.r === 2).map((match) =>
      isBracketPlacementMatch(match, 'winners', completed, 2025)
    ),
    [false, false, true, true]
  );
  assert.deepEqual(
    completed.filter((match) => match.r === 3).map((match) =>
      isBracketPlacementMatch(match, 'winners', completed, 2025)
    ),
    [false, false, true, true]
  );
});

test('2022 Toilet Bowl retains its historical round-two classification', () => {
  const matches = [
    { r: 1, m: 1, w: 10, l: 11 },
    { r: 1, m: 2, w: 12, l: 13 },
    { r: 2, m: 3, p: 1, t1: 10, t2: 12 },
    { r: 2, m: 4, p: 2, t1: 10, t2: 13 },
  ];
  assert.equal(isBracketPlacementMatch(matches[2], 'losers', matches, 2022), false);
  assert.equal(isBracketPlacementMatch(matches[3], 'losers', matches, 2022), true);
});
