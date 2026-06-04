// src/lib/compute/streaks.js
//
// Tiny pure helper for streak math. Lives by itself so it's easy to find
// and easy to unit-test.

/**
 * Given a list of "W" / "L" / "T" results in chronological order, return the
 * longest winning and losing streaks. Ties reset both counters.
 */
export function computeStreaks(resultsArray) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  if (!Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
  for (const r of resultsArray) {
    if (r === 'W') { curW += 1; curL = 0; if (curW > maxW) maxW = curW; }
    else if (r === 'L') { curL += 1; curW = 0; if (curL > maxL) maxL = curL; }
    else { curW = 0; curL = 0; }
  }
  return { maxW, maxL };
}
