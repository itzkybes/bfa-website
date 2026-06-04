// src/lib/compute/avatars.js
//
// Helpers for back-filling historical roster maps with each owner's
// CURRENT (newest league) team art. Owners are stable across seasons
// (same Sleeper user_id / username) but the roster_id and team metadata
// change every year — so we key by username.

import {
  BASE_LEAGUE_ID,
  getSeasonsChain,
  pickActiveLeague,
  getRosterMapWithOwners
} from '$lib/api/sleeper';

/**
 * Snapshot the CURRENT league's owner → avatar / team_name map, memoized
 * for the lifetime of the page. "Current" is whatever `pickActiveLeague`
 * picks (in_season > complete > newest), so when a new season is created
 * in Sleeper the overlay flips automatically.
 *
 * Falls back to `BASE_LEAGUE_ID` if season discovery fails.
 */
let _latestAvatarsPromise = null;
export function getLatestOwnerAvatars() {
  if (_latestAvatarsPromise) return _latestAvatarsPromise;
  _latestAvatarsPromise = (async () => {
    try {
      let latestLeagueId = BASE_LEAGUE_ID;
      try {
        const { seasons } = await getSeasonsChain(BASE_LEAGUE_ID);
        const active = pickActiveLeague(seasons);
        if (active?.league_id) {
          latestLeagueId = String(active.league_id);
        } else if (Array.isArray(seasons) && seasons.length > 0) {
          latestLeagueId = String(seasons[seasons.length - 1].league_id || BASE_LEAGUE_ID);
        }
      } catch (e) { /* fall back to BASE_LEAGUE_ID */ }
      const map = await getRosterMapWithOwners(latestLeagueId);
      const out = {};
      for (const rid of Object.keys(map)) {
        const m = map[rid] || {};
        const key = (m.owner_username || m.owner_name || '').toLowerCase();
        if (!key) continue;
        out[key] = {
          team_avatar: m.team_avatar || null,
          owner_avatar: m.owner_avatar || null,
          team_name: m.team_name || null
        };
      }
      return out;
    } catch (e) {
      return {};
    }
  })();
  return _latestAvatarsPromise;
}

/**
 * Mutate a rosterMap in place, overlaying each entry with the matching
 * owner's "latest" avatar / team name (matched by `owner_username`).
 *
 * Used by both `computeStandingsForLeague` and `computeMatchupsForLeagueWeek`
 * so the two paths stay visually identical.
 */
export function applyLatestAvatars(rosterMap, latestAvatars) {
  if (!rosterMap || !latestAvatars) return;
  for (const rid of Object.keys(rosterMap)) {
    const meta = rosterMap[rid];
    if (!meta) continue;
    const key = (meta.owner_username || meta.owner_name || '').toLowerCase();
    if (!key) continue;
    const latest = latestAvatars[key];
    if (!latest) continue;
    if (latest.team_avatar) meta.team_avatar = latest.team_avatar;
    if (latest.owner_avatar && !meta.owner_avatar) meta.owner_avatar = latest.owner_avatar;
    // Prefer latest team_name only if it looks "personal" (not generic).
    if (latest.team_name && !String(latest.team_name).startsWith('Roster ')) {
      meta.team_name = latest.team_name;
    }
  }
}
