import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyBracketTemplate,
  getBracketMatchesForDisplay,
  getBracketDisplaySections,
  isBracketPlacementMatch,
} from '../src/lib/compute/honorHallBracket.js';

function roundMatches(matches, round) {
  return matches.filter((match) => match.r === round);
}

test('empty championship bracket uses the shared three-round structure', () => {
  const matches = createEmptyBracketTemplate('winners', 8, 6);
  assert.deepEqual([1, 2, 3].map((round) => roundMatches(matches, round).length), [4, 4, 4]);
  assert.deepEqual([1, 2, 3].map((round) =>
    roundMatches(matches, round).filter((match) => !isBracketPlacementMatch(match, 'winners', matches, 2023)).length
  ), [4, 2, 2]);
  assert.deepEqual([1, 2, 3].map((round) =>
    roundMatches(matches, round).filter((match) => isBracketPlacementMatch(match, 'winners', matches, 2023)).length
  ), [0, 2, 2]);
  assert.ok(matches.every((match) => match.t1 == null && match.t2 == null));
});

test('empty championship bracket keeps the placement paths connected', () => {
  const matches = createEmptyBracketTemplate('winners', 8, 6);
  const byId = new Map(matches.map((match) => [String(match.m), match]));
  assert.deepEqual(byId.get('7').t1_from, { l: 1 });
  assert.deepEqual(byId.get('7').t2_from, { l: 2 });
  assert.deepEqual(byId.get('11').t1_from, { w: 7 });
  assert.deepEqual(byId.get('11').t2_from, { w: 8 });
  assert.deepEqual(byId.get('12').t1_from, { l: 7 });
  assert.deepEqual(byId.get('12').t2_from, { l: 8 });
});

test('empty six-team Toilet Bowl uses the shared three-round structure', () => {
  const matches = createEmptyBracketTemplate('losers', 8, 6);
  assert.deepEqual([1, 2, 3].map((round) => roundMatches(matches, round).length), [2, 3, 2]);
  assert.deepEqual([1, 2, 3].map((round) =>
    roundMatches(matches, round).filter((match) => !isBracketPlacementMatch(match, 'losers', matches, 2023)).length
  ), [2, 2, 1]);
  assert.deepEqual([1, 2, 3].map((round) =>
    roundMatches(matches, round).filter((match) => isBracketPlacementMatch(match, 'losers', matches, 2023)).length
  ), [0, 1, 1]);
  assert.ok(matches.every((match) => match.t1 == null && match.t2 == null));
});

test('completed championship brackets use the same placement classification', () => {
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
  for (const season of [2023, 2024, 2025, 2026, 2027]) {
    assert.deepEqual(
      completed.filter((match) => match.r === 2).map((match) =>
        isBracketPlacementMatch(match, 'winners', completed, season)
      ),
      [false, false, true, true]
    );
    assert.deepEqual(
      completed.filter((match) => match.r === 3).map((match) =>
        isBracketPlacementMatch(match, 'winners', completed, season)
      ),
      [false, false, true, true]
    );
  }
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

test('every season from 2023 onward fills empty championship shells with the same layout', () => {
  const emptySleeperShells = [
    { r: 1, m: 1, t1: null, t2: null, w: null, l: null },
    { r: 2, m: 2, t1: null, t2: null, w: null, l: null },
  ];
  for (const season of [2023, 2024, 2025, 2026, 2027]) {
    const matches = getBracketMatchesForDisplay(season, 'winners', emptySleeperShells, 8, 6);
    assert.equal(matches.length, 12);
    assert.deepEqual([1, 2, 3].map((round) => roundMatches(matches, round).length), [4, 4, 4]);
    assert.equal(roundMatches(matches, 2).filter((match) =>
      isBracketPlacementMatch(match, 'winners', matches, season)
    ).length, 2);
    assert.equal(roundMatches(matches, 3).filter((match) =>
      isBracketPlacementMatch(match, 'winners', matches, season)
    ).length, 2);
  }
});

test('complete actual brackets are retained for every season from 2023 onward', () => {
  const actual = createEmptyBracketTemplate('winners', 8, 6).map((match, index) =>
    index === 0 ? { ...match, t1: 1, t2: 2 } : match
  );
  for (const season of [2023, 2024, 2025, 2026, 2027]) {
    assert.equal(getBracketMatchesForDisplay(season, 'winners', actual), actual);
  }
});

test('2022 keeps its saved historical bracket data', () => {
  const historical = [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 }];
  assert.equal(getBracketMatchesForDisplay(2022, 'winners', historical), historical);
});

test('incomplete championship responses use the same shared layout for every 2023+ season', () => {
  const partial = [
    { r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 },
    { r: 1, m: 2, t1: 3, t2: 4, w: 3, l: 4 },
  ];
  for (const season of [2023, 2024, 2025, 2026, 2027]) {
    const matches = getBracketMatchesForDisplay(season, 'winners', partial, 8, 6);
    assert.deepEqual([1, 2, 3].map((round) => roundMatches(matches, round).length), [4, 4, 4]);
    assert.ok(matches.every((match) => match.t1 == null && match.t2 == null));
  }
});

test('incomplete Toilet Bowl responses use the same shared layout for every 2023+ season', () => {
  const partial = [
    { r: 1, m: 1, t1: 9, t2: 10, w: 9, l: 10 },
  ];
  for (const season of [2023, 2024, 2025, 2026, 2027]) {
    const matches = getBracketMatchesForDisplay(season, 'losers', partial, 8, 6);
    assert.deepEqual([1, 2, 3].map((round) => roundMatches(matches, round).length), [2, 3, 2]);
  }
});

test('all 2023+ seasons share the same championship main and placement sections', () => {
  const matches = createEmptyBracketTemplate('winners', 8, 6);
  const layouts = [2023, 2024, 2025, 2026, 2027].map((season) =>
    getBracketDisplaySections(matches, 'winners', season)
  );
  for (const layout of layouts) {
    assert.deepEqual(layout.mainRounds.map((round) => round.matches.length), [4, 2, 2]);
    assert.deepEqual(layout.placementRounds.map((round) => round.matches.length), [2, 2]);
  }
  assert.deepEqual(
    layouts.map((layout) => layout.placementMatches.map((match) => match.m)),
    layouts.map(() => [7, 8, 11, 12])
  );
});

test('all 2023+ seasons share the same Toilet Bowl main and placement sections', () => {
  const matches = createEmptyBracketTemplate('losers', 8, 6);
  const layouts = [2023, 2024, 2025, 2026, 2027].map((season) =>
    getBracketDisplaySections(matches, 'losers', season)
  );
  for (const layout of layouts) {
    assert.deepEqual(layout.mainRounds.map((round) => round.matches.length), [2, 2, 1]);
    assert.deepEqual(layout.placementRounds.map((round) => round.matches.length), [1, 1]);
  }
});
