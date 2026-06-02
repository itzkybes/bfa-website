// src/lib/sleeperClient.client.js
//
// Thin wrapper around Sleeper's public REST API for the browser. Everything
// here runs client-side (we use the global `fetch` and lean on the localStorage
// cache in `./cache.js`) — there's no Node-only code, and no env vars to set.
//
// The Sleeper API is read-only and unauthenticated, so it works just as well
// for a static deploy as it does for a dev box.

import { fetchWithCache } from '$lib/cache';

const BASE = 'https://api.sleeper.app/v1';
const SLEEPER_CDN = 'https://sleepercdn.com';

// The "anchor" league this site was built around. `getSeasonsChain` walks
// the `previous_league_id` chain BACKWARDS from here to find historical
// seasons, AND also walks FORWARDS via Sleeper's user-leagues endpoint to
// pick up newly-created seasons (e.g. the 2026 league shows up automatically
// without anyone having to bump this constant).
export const BASE_LEAGUE_ID = '1219816671624048640';

const CACHE_5_MIN = 5 * 60 * 1000;
const CACHE_10_MIN = 10 * 60 * 1000;
const CACHE_1_HOUR = 60 * 60 * 1000;

/** Coerce a value to a number; anything that doesn't parse becomes 0. */
export function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/** League metadata: name, season, settings (playoff week, scoring, etc.). */
export async function getLeague(leagueId, ttl = CACHE_5_MIN) {
  return await fetchWithCache(`${BASE}/league/${encodeURIComponent(leagueId)}`, {}, ttl);
}

/** Raw roster array for a league — one entry per team with the owner_id. */
export async function getRosters(leagueId, ttl = CACHE_10_MIN) {
  return await fetchWithCache(`${BASE}/league/${encodeURIComponent(leagueId)}/rosters`, {}, ttl);
}

/** All users in a league, including their display name and avatar id. */
export async function getUsers(leagueId, ttl = CACHE_10_MIN) {
  return await fetchWithCache(`${BASE}/league/${encodeURIComponent(leagueId)}/users`, {}, ttl);
}

/** All matchup entries for a given week (Sleeper returns one entry per roster). */
export async function getMatchupsForWeek(leagueId, week, ttl = CACHE_5_MIN) {
  return await fetchWithCache(
    `${BASE}/league/${encodeURIComponent(leagueId)}/matchups/${encodeURIComponent(week)}`,
    {},
    ttl
  );
}

/**
 * Winners bracket — array of matches across rounds. Each entry looks like:
 * `{ r: round, m: match_id, t1, t2, w (winner roster_id), l (loser roster_id), p: placement, t1_from, t2_from }`
 * The match with `p === 1` is the championship game.
 */
export async function getWinnersBracket(leagueId, ttl = CACHE_10_MIN) {
  try {
    return await fetchWithCache(
      `${BASE}/league/${encodeURIComponent(leagueId)}/winners_bracket`,
      {},
      ttl
    );
  } catch (e) { return []; }
}

/**
 * Losers bracket — same shape as the winners bracket, but the team that keeps
 * winning each round advances toward last place (the "Toilet Bowl Champion").
 */
export async function getLosersBracket(leagueId, ttl = CACHE_10_MIN) {
  try {
    return await fetchWithCache(
      `${BASE}/league/${encodeURIComponent(leagueId)}/losers_bracket`,
      {},
      ttl
    );
  } catch (e) { return []; }
}

/**
 * The full NBA player map keyed by Sleeper player id. The payload is ~5 MB so
 * we cache aggressively in localStorage — subsequent page loads read straight
 * from the cache without hitting Sleeper.
 */
export async function getPlayersNba(ttl = CACHE_1_HOUR) {
  return await fetchWithCache(`${BASE}/players/nba`, {}, ttl);
}

/**
 * Build a `{ rosterId: { team_name, owner_name, team_avatar, owner_avatar, ... } }`
 * map for a league. This is the "give me everything I need to render a team
 * card" helper — it joins rosters with users and resolves avatar URLs.
 */
export async function getRosterMapWithOwners(leagueId, ttl = CACHE_10_MIN) {
  const [rosters, users] = await Promise.all([
    getRosters(leagueId, ttl),
    getUsers(leagueId, ttl)
  ]);

  const usersById = {};
  if (Array.isArray(users)) {
    for (const u of users) {
      const id = u.user_id ?? u.id ?? u.userId;
      if (id != null) usersById[String(id)] = u;
    }
  }

  const map = {};
  if (!Array.isArray(rosters)) return map;

  for (const r of rosters) {
    const rid = r.roster_id ?? r.id ?? r.rosterId;
    if (rid == null) continue;
    const ownerId = r.owner_id ?? r.ownerId ?? r.user_id ?? null;
    const uobj = ownerId != null ? usersById[String(ownerId)] : null;

    // Team name preference: explicit roster metadata > user metadata > derived
    // from display name > fallback "Roster N".
    let teamName = null;
    try { if (r.metadata && r.metadata.team_name) teamName = r.metadata.team_name; } catch (e) {}
    if (!teamName && uobj) {
      try {
        if (uobj.metadata && uobj.metadata.team_name) teamName = uobj.metadata.team_name;
        else if (uobj.display_name) teamName = `${uobj.display_name}'s Team`;
        else if (uobj.username) teamName = `${uobj.username}'s Team`;
      } catch (e) {}
    }
    if (!teamName) teamName = 'Roster ' + String(rid);

    // Sleeper stores avatars as either a full URL or a CDN key — normalize both
    // to absolute URLs so the UI never has to think about it.
    let teamAvatar = null;
    try {
      if (r.metadata && r.metadata.team_avatar) {
        const c = String(r.metadata.team_avatar);
        teamAvatar = (c.indexOf('http') === 0) ? c : (SLEEPER_CDN + '/avatars/' + c);
      }
    } catch (e) {}

    let ownerAvatar = null;
    if (uobj) {
      const tryAvatar = (val) => {
        if (!val) return null;
        const s = String(val);
        return s.indexOf('http') === 0 ? s : (SLEEPER_CDN + '/avatars/' + s);
      };
      ownerAvatar = tryAvatar(uobj.metadata?.team_avatar)
        || tryAvatar(uobj.metadata?.avatar)
        || tryAvatar(uobj.avatar);
    }

    map[String(rid)] = {
      roster_id: String(rid),
      owner_id: ownerId != null ? String(ownerId) : null,
      team_name: teamName,
      owner_name: uobj ? (uobj.display_name || uobj.username || null) : null,
      owner_username: uobj ? (uobj.username || null) : null,
      team_avatar: teamAvatar,
      owner_avatar: ownerAvatar,
      roster_raw: r,
      user_raw: uobj || null
    };
  }
  return map;
}

/**
 * List every NBA league a given user is in for a given season year.
 * Used by `getSeasonsChain` to discover future seasons whose
 * `previous_league_id` chains back into our known set.
 *
 * Returns `[]` on any error — Sleeper sometimes 404s for empty user/season
 * combos and we don't want one bad request to break season discovery.
 */
export async function getUserLeaguesForSeason(userId, season, ttl = CACHE_10_MIN) {
  if (!userId || !season) return [];
  try {
    const data = await fetchWithCache(
      `${BASE}/user/${encodeURIComponent(userId)}/leagues/nba/${encodeURIComponent(season)}`,
      {},
      ttl
    );
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

/**
 * Walk a league's `previous_league_id` chain to enumerate every season.
 * Returns `{ seasons, prevChain }` sorted oldest → newest, so the most
 * recent season is always `seasons[seasons.length - 1]`.
 *
 * Walks in BOTH directions:
 *  1. Backwards via `previous_league_id` (handles 2022 → 2025 history).
 *  2. Forwards via `/user/{user_id}/leagues/nba/{season}` against a few
 *     seed users from the anchor league, so when a new season is created
 *     in Sleeper (e.g. 2026, 2027, …) it shows up here automatically with
 *     zero code changes.
 */
export async function getSeasonsChain(baseLeagueId, maxSteps = 50) {
  const seasons = [];
  const prevChain = [];
  let mainLeague = null;
  try {
    mainLeague = await getLeague(baseLeagueId);
  } catch (e) {
    return { seasons, prevChain, error: e?.message };
  }
  if (!mainLeague) return { seasons, prevChain };

  seasons.push({
    league_id: String(mainLeague.league_id || baseLeagueId),
    season: mainLeague.season || null,
    name: mainLeague.name || null
  });
  prevChain.push(String(mainLeague.league_id || baseLeagueId));

  // -- Backwards walk via previous_league_id ---------------------------------
  let curr = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
  let steps = 0;
  while (curr && steps < maxSteps) {
    steps++;
    try {
      const prev = await getLeague(curr);
      if (!prev) break;
      seasons.push({
        league_id: String(prev.league_id || curr),
        season: prev.season || null,
        name: prev.name || null
      });
      prevChain.push(String(prev.league_id || curr));
      curr = prev.previous_league_id ? String(prev.previous_league_id) : null;
    } catch (e) {
      break;
    }
  }

  // -- Forwards walk via user-leagues lookup --------------------------------
  // Grab a few seed user_ids from the anchor league. We try more than one in
  // case any single user has left the league since.
  let seedUserIds = [];
  try {
    const anchorUsers = await getUsers(String(mainLeague.league_id || baseLeagueId));
    if (Array.isArray(anchorUsers)) {
      seedUserIds = anchorUsers
        .map(u => u && (u.user_id || u.id || u.userId))
        .filter(Boolean)
        .map(String)
        .slice(0, 4);
    }
  } catch (e) { /* swallow — backwards-only chain is still valid */ }

  if (seedUserIds.length > 0) {
    const anchorSeasonNum = Number(mainLeague.season);
    // If the anchor league has no season, fall back to the current calendar
    // year. Sleeper marks NBA seasons by the year the playoffs end in (so the
    // 2025/26 season is `season: "2026"`).
    const startYear = !isNaN(anchorSeasonNum) && anchorSeasonNum > 0
      ? anchorSeasonNum
      : new Date().getUTCFullYear();
    const maxYear = Math.max(startYear, new Date().getUTCFullYear()) + 5;

    let latestId = String(mainLeague.league_id || baseLeagueId);
    let forwardSteps = 0;
    for (let yr = startYear + 1; yr <= maxYear && forwardSteps < maxSteps; yr++) {
      forwardSteps++;
      // Probe each seed user in parallel; the first one with a matching
      // league wins.
      const lists = await Promise.all(
        seedUserIds.map(uid => getUserLeaguesForSeason(uid, String(yr)))
      );
      const flat = [];
      const seen = new Set();
      for (const list of lists) {
        for (const lg of (list || [])) {
          if (!lg || !lg.league_id) continue;
          const id = String(lg.league_id);
          if (seen.has(id)) continue;
          seen.add(id);
          flat.push(lg);
        }
      }
      const next = flat.find(lg => String(lg.previous_league_id || '') === latestId);
      if (!next) break;

      seasons.push({
        league_id: String(next.league_id),
        season: next.season || String(yr),
        name: next.name || null
      });
      prevChain.push(String(next.league_id));
      latestId = String(next.league_id);
    }
  }

  // Sort old → new so callers can `.slice(-1)` for "current season".
  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  return { seasons, prevChain };
}

/** CDN URL for an NBA player's headshot, or an empty string if no pid. */
export function playerHeadshot(pid) {
  return pid ? `${SLEEPER_CDN}/content/nba/players/${pid}.jpg` : '';
}
