import test from 'node:test';
import assert from 'node:assert/strict';
import { isBracketPlacementMatch } from '../src/lib/compute/honorHallBracket.js';

const emptyRoundOne = [
  { r: 1, m: 1, t1: 1, t2: 2 },
  { r: 1, m: 2, t1: 3, t2: 4 },
  { r: 1, m: 3, t1: 5, t2: 6 },
  { r: 1, m: 4, t1: 7, t2: 8 },
];

const futureBracket = [
  ...emptyRoundOne,
  { r: 2, m: 11, p: 1, t1_from: { w: 1 }, t2_from: { w: 2 } },
  { r: 2, m: 12, p: 3, t1_from: { w: 3 }, t2_from: { w: 4 } },
  { r: 2, m: 13, p: 5, t1_from: { l: 1 }, t2_from: { l: 2 } },
  { r: 2, m: 14, p: 7, t1_from: { l: 3 }, t2_from: { l: 4 } },
  { r: 3, m: 21, p: 1, t1_from: { w: 11 }, t2_from: { w: 12 } },
  { r: 3, m: 22, p: 3, t1_from: { l: 11 }, t2_from: { l: 12 } },
  { r: 3, m: 23, p: 5, t1_from: { w: 13 }, t2_from: { w: 14 } },
  { r: 3, m: 24, p: 7, t1_from: { l: 13 }, t2_from: { l: 14 } },
];

test('unplayed championship bracket splits two semifinals from two placement games', () => {
  const roundTwo = futureBracket.filter((match) => match.r === 2);
  assert.deepEqual(
    roundTwo.map((match) => isBracketPlacementMatch(match, 'winners', futureBracket, 2026)),
    [false, false, true, true]
  );
});

test('unplayed championship finals keep 1st/3rd place in the main bracket and 5th/7th below', () => {
  const roundThree = futureBracket.filter((match) => match.r === 3);
  assert.deepEqual(
    roundThree.map((match) => isBracketPlacementMatch(match, 'winners', futureBracket, 2026)),
    [false, false, true, true]
  );
});

test('completed historical bracket uses resolved round-one losers and placement-team progression', () => {
  const completed = [
    { r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 },
    { r: 1, m: 2, t1: 3, t2: 4, w: 3, l: 4 },
    { r: 1, m: 3, t1: 5, t2: 6, w: 5, l: 6 },
    { r: 1, m: 4, t1: 7, t2: 8, w: 7, l: 8 },
    { r: 2, m: 11, p: 1, t1: 1, t2: 3, w: 1, l: 3 },
    { r: 2, m: 12, p: 3, t1: 5, t2: 7, w: 5, l: 7 },
    { r: 2, m: 13, p: 5, t1: 2, t2: 4, w: 2, l: 4 },
    { r: 2, m: 14, p: 7, t1: 6, t2: 8, w: 6, l: 8 },
    { r: 3, m: 21, p: 1, t1: 1, t2: 5 },
    { r: 3, m: 22, p: 3, t1: 3, t2: 7 },
    { r: 3, m: 23, p: 5, t1: 2, t2: 6 },
    { r: 3, m: 24, p: 7, t1: 4, t2: 8 },
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
