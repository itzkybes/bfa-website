// src/lib/compute/scoring.js
//
// Single source of truth for "how do we turn one Sleeper matchup entry into
// a team's point total?". Everything below is pure — no API calls, no state.

import { safeNum } from '../api/sleeper.js';

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
 *   3. If starter scoring is unavailable, return 0 rather than using
 *      an ambiguous team-level total that may include non-starters.
 *
 * `points`, `points_for`, `pts`, `score`, `player_points` and
 * `players_points` are deliberately NOT consulted. Team results must be
 * derived from the selected starters only (unless a static score override
 * has been explicitly pinned above).
 */
export function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  // 1. Static-JSON authoritative override (teamAScore / teamBScore).
  if (entry.__final_score != null) {
    const v = safeNum(entry.__final_score);
    if (isFinite(v)) return Math.round(v * 100) / 100;
  }
  // 2. Sum only the points aligned to the selected starter IDs.
  const starters = Array.isArray(entry.starters) ? entry.starters : [];
  const arrayKeys = ['starters_points', 'starter_points', 'startersPoints', 'starterPoints'];
  for (const k of arrayKeys) {
    if (starters.length && Array.isArray(entry[k]) && entry[k].length === starters.length) {
      const total = entry[k].reduce((sum, value) => sum + safeNum(value), 0);
      return Math.round(total * 100) / 100;
    }
  }
  // 3. Missing starter scoring is unknown, not permission to count the
  // whole roster (which can include bench/non-selected players).
  return 0;
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
    if (Array.isArray(entry[k]) && entry[k].length) {
      arr = entry[k];
      break;
    }
  }
  if (!arr) return null; // refuse to silently emit zeros — caller will skip the entry
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

/**
 * Sum STARTER points per player across a list of raw Sleeper matchup entries
 * (e.g. every week of a season, or just the playoff window).
 *
 * Source of truth is the `starters_points` array zipped with `starters`. We
 * never fall back to `player_points` — it includes raw unselected games and
 * would corrupt MVP figures for managers who manually pick which game counts
 * each week.
 *
 * @param {Array<object | null>} matchupEntries
 * @returns {Record<string, { playerId: string, points: number, rosterId: string, pointsByRoster: Record<string, number> }>}
 */
export function aggregatePlayerPoints(matchupEntries) {
  const byPlayer = {};
  for (const entry of matchupEntries) {
    if (!entry) continue;
    const rid = String(entry.roster_id ?? entry.rosterId ?? '');
    const playerPoints = starterPointsByPid(entry);
    if (!playerPoints) continue;
    for (const [pid, rawPoints] of Object.entries(playerPoints)) {
      const points = Number(rawPoints);
      if (!Number.isFinite(points)) continue;
      if (!byPlayer[pid]) {
        byPlayer[pid] = { playerId: pid, points: 0, rosterId: rid, pointsByRoster: {} };
      }
      const player = byPlayer[pid];
      player.points += points;
      if (rid) {
        player.pointsByRoster[rid] = (player.pointsByRoster[rid] || 0) + points;
        // For season-wide MVP display, attribute a traded player to the
        // roster that received the largest share of their selected-game points.
  
      }
    }
  }
  for (const player of Object.values(byPlayer)) {
    player.points = Math.round(player.points * 100) / 100;
    let topRoster = player.rosterId;
    let topPoints = -Infinity;
    // Keep the first-seen roster on a tie; choose the roster with the
    // largest final share after all weeks have been aggregated.
    for (const rid of Object.keys(player.pointsByRoster)) {
      player.pointsByRoster[rid] = Math.round(player.pointsByRoster[rid] * 100) / 100;
      if (player.pointsByRoster[rid] > topPoints) {
        topPoints = player.pointsByRoster[rid];
        topRoster = rid;
      }
    }
    player.rosterId = topRoster;
  }
  return byPlayer;
}
