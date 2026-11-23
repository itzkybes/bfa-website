import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyBracketTemplate,
  getBracketMatchesForDisplay,
  isBracketPlacementMatch,
} from '../src/lib/compute/honorHallBracket.js';

function roundMatches(matches, round) {
  return matches.filter((match) => match.r === round);
}

test('empty championship bracket has the same sections as 2025', () => {
  const matches = createEmptyBracketTemplate('winners', 8, 6);
  assert.deepEqual([1, 2, 3].map((round) => roundMatches(matches, round).length), [4, 4, 4]);
  assert.deepEqual([1, 2, 3].map((round) =>
    roundMatches(matches, round).filter((match) => !isBracketPlacementMatch(match, 'winners', matches, 2026)).length
  ), [4, 2, 2]);
  assert.deepEqual([1, 2, 3].map((round) =>
    roundMatches(matches, round).filter((match) => isBracketPlacementMatch(match, 'winners', matches, 2026)).length
  ), [0, 2, 2]);
  assert.ok(matches.every((match) => match.t1 == null && match.t2 == null));
});

test('empty championship bracket keeps the four placement paths connected', () => {
  const matches = createEmptyBracketTemplate('winners', 8, 6);
  const byId = new Map(matches.map((match) => [String(match.m), match]));
  assert.deepEqual(byId.get('7').t1_from, { l: 1 });
  assert.deepEqual(byId.get('7').t2_from, { l: 2 });
  assert.deepEqual(byId.get('11').t1_from, { w: 7 });
  assert.deepEqual(byId.get('11').t2_from, { w: 8 });
  assert.deepEqual(byId.get('12').t1_from, { l: 7 });
  assert.deepEqual(byId.get('12').t2_from, { l: 8 });
});

test('empty six-team Toilet Bowl matches the 2025 three-round bye structure', () => {
  const matches = createEmptyBracketTemplate('losers', 8, 6);
  assert.deepEqual([1, 2, 3].map((round) => roundMatches(matches, round).length), [2, 3, 2]);
  assert.deepEqual([1, 2, 3].map((round) =>
    roundMatches(matches, round).filter((match) => !isBracketPlacementMatch(match, 'losers', matches, 2026)).length
  ), [2, 2, 1]);
  assert.deepEqual([1, 2, 3].map((round) =>
    roundMatches(matches, round).filter((match) => isBracketPlacementMatch(match, 'losers', matches, 2026)).length
  ), [0, 1, 1]);
  assert.ok(matches.every((match) => match.t1 == null && match.t2 == null));
});

test('completed historical championship bracket still classifies game progress', () => {
  const completed = [
    { r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 },
    { r: 1, m: 2, t1: 3, t2: 4, w: 3, l: 4 },
    { r: 1, m: 3, t1: 5, t2: 6, w: 5, l: 6 },
    { r: 1, m: 4, t1: 7, t2: 8, w: 7, l: 8 },
    { r: 2, m: 11, p: 1, t1: 1, t2: 3, w: 1, l: 3 },
    { r: 2, m: 12, p: 1, t1: 5, t2: 7, w: 5, l: 7 },
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

test('2026 empty Sleeper shells are replaced with the complete 2025 layout', () => {
  const emptySleeperShells = [
    { r: 1, m: 1, t1: null, t2: null, w: null, l: null },
    { r: 2, m: 2, t1: null, t2: null, w: null, l: null },
  ];
  const matches = getBracketMatchesForDisplay(2026, 'winners', emptySleeperShells, 8, 6);
  assert.equal(matches.length, 12);
  assert.deepEqual([1, 2, 3].map((round) => roundMatches(matches, round).length), [4, 4, 4]);
  assert.equal(roundMatches(matches, 2).filter((match) =>
    isBracketPlacementMatch(match, 'winners', matches, 2026)
  ).length, 2);
  assert.equal(roundMatches(matches, 3).filter((match) =>
    isBracketPlacementMatch(match, 'winners', matches, 2026)
  ).length, 2);
});

test('2026 keeps actual matchup data once the full 2025 structure has teams', () => {
  const actual = createEmptyBracketTemplate('winners', 8, 6).map((match, index) =>
    index === 0 ? { ...match, t1: 1, t2: 2 } : match
  );
  assert.equal(getBracketMatchesForDisplay(2026, 'winners', actual), actual);
});

test('2025 uses its saved bracket rather than the future empty template', () => {
  const historical = [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 }];
  assert.equal(getBracketMatchesForDisplay(2025, 'winners', historical), historical);
});

test('2026 partial bracket responses cannot hide missing 2025 rounds or sections', () => {
  const partial = [
    { r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 },
    { r: 1, m: 2, t1: 3, t2: 4, w: 3, l: 4 },
  ];
  const matches = getBracketMatchesForDisplay(2026, 'winners', partial, 8, 6);
  assert.deepEqual([1, 2, 3].map((round) => roundMatches(matches, round).length), [4, 4, 4]);
  assert.ok(matches.every((match) => match.t1 == null && match.t2 == null));
});

test('2026 partial Toilet Bowl responses preserve the six-team 2025 structure', () => {
  const partial = [
    { r: 1, m: 1, t1: 9, t2: 10, w: 9, l: 10 },
  ];
  const matches = getBracketMatchesForDisplay(2026, 'losers', partial, 8, 6);
  assert.deepEqual([1, 2, 3].map((round) => roundMatches(matches, round).length), [2, 3, 2]);
});
