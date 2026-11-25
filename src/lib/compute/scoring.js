// src/lib/compute/scoring.js
//
// Single source of truth for "how do we turn one Sleeper matchup entry into
// a team's point total?". Everything below is pure — no API calls, no state.

import { safeNum } from '../api/sleeper.js';

/**
 * Score a single matchup entry.
 *
 * Team-total precedence:
 *   1. `__final_score` — a saved BFA historical/manual override.
 *   2. `custom_points` — Sleeper's commissioner-overridden team total.
 *   3. `points` — Sleeper's team total calculated using the league settings.
 *   4. Aligned `starters_points` sum — fallback only when Sleeper did not
 *      provide a team-level total.
 *
 * Player-level stats remain separate and are always read from
 * `starters_points` zipped to `starters`.
 */
export function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== 'object') return 0;

  const readScore = (value) => {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
  };

  // 1. Saved BFA override remains authoritative.
  const savedOverride = readScore(entry.__final_score);
  if (savedOverride != null) return savedOverride;

  // 2–3. Prefer Sleeper's own team-level total over re-adding player scores.
  for (const key of ['custom_points', 'points']) {
    const teamTotal = readScore(entry[key]);
    if (teamTotal != null) return teamTotal;
  }

  // 4. Only reconstruct the total if Sleeper did not provide one.
  const starters = Array.isArray(entry.starters) ? entry.starters : [];
  const arrayKeys = ['starters_points', 'starter_points', 'startersPoints', 'starterPoints'];
  for (const key of arrayKeys) {
    if (starters.length && Array.isArray(entry[key]) && entry[key].length === starters.length) {
      const total = entry[key].reduce((sum, value) => sum + safeNum(value), 0);
      return Math.round(total * 100) / 100;
    }
  }

  // Missing score data is unknown, not permission to count bench players.
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
    if (Array.isArray(entry[k]) && entry[k].length === starters.length) {
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

/**
 * Aggregate Finals MVP points from both teams in the championship game.
 * The supplied entries and finalist roster IDs come from the saved season
 * snapshot and bracket context; player scores are read only from aligned
 * selected-starter arrays.
 *
 * @param {Array<object | null>} matchupEntries
 * @param {Array<string | number>} finalistRosterIds
 * @returns {Record<string, { playerId: string, points: number, rosterId: string, pointsByRoster: Record<string, number> }>}
 */
export function aggregateFinalsMvpPoints(matchupEntries, finalistRosterIds) {
  const finalists = new Set((Array.isArray(finalistRosterIds) ? finalistRosterIds : []).map(String));
  if (!finalists.size) return {};
  const finalistEntries = (Array.isArray(matchupEntries) ? matchupEntries : []).filter(
    (entry) => entry && finalists.has(String(entry.roster_id ?? entry.rosterId ?? ''))
  );
  return aggregatePlayerPoints(finalistEntries);
}
