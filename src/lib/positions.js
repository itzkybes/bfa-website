// /app/src/lib/positions.js
//
// Sleeper stores each player's `fantasy_positions` as 1–2 BASIC positions
// (PG / SG / SF / PF / C). But a fantasy roster has aggregate slots — G is
// "any guard", F is "any forward", UTIL is "anyone" — and the user wants
// every slot a player is eligible for to be visible on their pill.
//
// Expansion table:
//   PG → PG, G       (plus UTIL added below)
//   SG → SG, G
//   SF → SF, F
//   PF → PF, F
//   C  → C
//   G  → G           (already an aggregate — keep as-is)
//   F  → F
// Anyone with at least one basic position is also UTIL-eligible.

const POS_EXPAND = {
  PG: ['PG', 'G'],
  SG: ['SG', 'G'],
  SF: ['SF', 'F'],
  PF: ['PF', 'F'],
  C:  ['C'],
  G:  ['G'],
  F:  ['F']
};

// Render order — guards first, then forwards, then center, then aggregates.
const POS_ORDER = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];

/**
 * Expand a Sleeper `fantasy_positions` array into the FULL set of roster
 * slots the player is eligible for, returned in a stable, intuitive order.
 */
export function expandPositions(positions) {
  if (!Array.isArray(positions) || !positions.length) return [];
  const set = new Set();
  for (const p of positions) {
    const list = POS_EXPAND[p] || [p];
    for (const x of list) set.add(x);
  }
  set.add('UTIL');
  return POS_ORDER.filter((p) => set.has(p));
}
