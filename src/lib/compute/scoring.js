// src/lib/compute/scoring.js
//
// Single source of truth for "how do we turn one Sleeper matchup entry into
// a team's point total?". Everything below is pure — no API calls, no state.

import { safeNum } from '$lib/api/sleeper';

/**
 * Score a single Sleeper matchup entry.
 *
 * Order of precedence (top to bottom):
 *   1. `entry.__final_score` — authoritative override pinned by the static
 *      JSON path. Use this to manually fix a score: edit `teamAScore` or
 *      `teamBScore` directly in `/static/season_matchups/{year}.json`. The
 *      static-load synthesis carries those values through under this key.
 *   2. `starters_points` array — project policy: per-player figures only
 *      ever come from this; the team total is the sum.
 *   3. Top-level `points` field — last-resort fallback (still a Sleeper
 *      starter-only total).
 *
 * `player_points` / `players_points` is deliberately NOT consulted, since
 * for our league with manual game-selection it includes raw unselected
 * games.
 */
export function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  // 1. Static-JSON authoritative override (teamAScore / teamBScore).
  if (entry.__final_score != null) {
    const v = safeNum(entry.__final_score);
    if (isFinite(v)) return Math.round(v * 100) / 100;
  }
  // 2. Sum of starters_points.
  const arrayKeys = ['starters_points', 'starter_points', 'startersPoints', 'starterPoints'];
  for (const k of arrayKeys) {
    if (Array.isArray(entry[k]) && entry[k].length) {
      let s = 0;
      for (const v of entry[k]) s += safeNum(v);
      return Math.round(s * 100) / 100;
    }
  }
  // 3. Top-level points fallback.
  const fallback = safeNum(entry.points ?? entry.points_for ?? entry.pts ?? entry.score ?? 0);
  return Math.round(fallback * 100) / 100;
}

/**
 * Build a `{ pid: points }` map of STARTER scoring from a raw Sleeper
 * matchup entry. Sleeper has shipped several representations of starter
 * points over the years (`starters_points` as array, `starter_points`,
 * `startersPoints`, `starterPoints`) — this helper checks them in order
 * and zips with `entry.starters` to produce a stable map.
 *
 * Returns `null` if the entry doesn't have BOTH a `starters` array AND
 * a matching starters_points array. The caller MUST treat null as
 * "no authoritative starter scoring for this team this week" — never
 * fall back to `player_points` for stats like Top Scorer or Bust of the
 * Week (per-week starter scoring is the only authoritative source).
 */
export function starterPointsByPid(entry) {
  if (!entry) return null;
  const starters = Array.isArray(entry.starters) ? entry.starters : [];
  if (!starters.length) return null;
  const arrayKeys = ['starters_points', 'starter_points', 'startersPoints', 'starterPoints'];
  let arr = null;
  for (const k of arrayKeys) {
    if (Array.isArray(entry[k]) && entry[k].length) { arr = entry[k]; break; }
  }
  if (!arr) return null;   // refuse to silently emit zeros — caller will skip the entry
  const out = {};
  for (let i = 0; i < starters.length; i++) {
    const pid = starters[i];
    if (!pid) continue;
    const n = safeNum(arr[i]);
    const val = isFinite(n) ? n : 0;
    // Sum in case the same pid somehow appears twice.
    out[pid] = (out[pid] || 0) + val;
  }
  return out;
}
