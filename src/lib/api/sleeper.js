// src/lib/api/sleeper.js
//
// Thin wrapper around Sleeper's public REST API for the browser. Everything
// here runs client-side (we use the global `fetch` and lean on the localStorage
// cache in `./cache.js`) — there's no Node-only code, and no env vars to set.
//
// The Sleeper API is read-only and unauthenticated, so it works just as well
// for a static deploy as it does for a dev box.

import { fetchWithCache } from './cache';

const BASE = 'https://api.sleeper.app/v1';
const SLEEPER_CDN = 'https://sleepercdn.com';

// The "anchor" league this site was built around. `getSeasonsChain` walks
// the `previous_league_id` chain BACKWARDS from here to find historical
// seasons, AND also walks FORWARDS via Sleeper's user-leagues endpoint to
// pick up newly-created seasons (e.g. the 2026 league shows up automatically
// without anyone having to bump this constant).
export const BASE_LEAGUE_ID = '1219816671624048640';

const CACHE_60_SEC = 60 * 1000;
const CACHE_5_MIN = 5 * 60 * 1000;
const CACHE_10_MIN = 10 * 60 * 1000;
const CACHE_1_HOUR = 60 * 60 * 1000;

/** Coerce a value to a number; anything that doesn't parse becomes 0. */
export function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// ─── League ─────────────────────────────────────────────────────────────

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

/**
 * All matchup entries for a given week (Sleeper returns one entry per roster).
 *
 * Default TTL is 60 SECONDS — short enough that a stat correction or
 * mid-game scoring update propagates to the recap within ~1 minute, but
 * long enough that rapid week-clicking through the dropdown still gets
 * served from cache. Note the recap "selected game" semantics: Sleeper's
 * `players_points` / `starters_points` arrays already reflect the owner's
 * manually-selected game (Sleeper resolves the selection internally — no
 * separate "selected game" field is exposed by the public API). So if a
 * recap stat ever looks wrong, the fix is to (a) wait for Sleeper's stat
 * correction job to run and (b) let this short TTL pull it in.
 */
export async function getMatchupsForWeek(leagueId, week, ttl = CACHE_60_SEC) {
  return await fetchWithCache(
    `${BASE}/league/${encodeURIComponent(leagueId)}/matchups/${encodeURIComponent(week)}`,
    {},
    ttl
  );
}

// ─── Brackets ───────────────────────────────────────────────────────────

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

// ─── Players ────────────────────────────────────────────────────────────

/**
 * The full NBA player map keyed by Sleeper player id. The payload is ~5 MB so
 * we cache aggressively in localStorage — subsequent page loads read straight
 * from the cache without hitting Sleeper.
 */
export async function getPlayersNba(ttl = CACHE_1_HOUR) {
  return await fetchWithCache(`${BASE}/players/nba`, {}, ttl);
}

/** CDN URL for an NBA player's headshot, or an empty string if no pid. */
export function playerHeadshot(pid) {
  return pid ? `${SLEEPER_CDN}/content/nba/players/${pid}.jpg` : '';
}

// ─── Roster + owner enrichment ──────────────────────────────────────────

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
      // Sleeper privacy settings can null out `username`. For our purposes the
      // `display_name` is the stable handle (it's what owners are known by in
      // the league chat and what the URLs use), so fall back to it.
      owner_username: uobj ? (uobj.username || uobj.display_name || null) : null,
      team_avatar: teamAvatar,
      owner_avatar: ownerAvatar,
      roster_raw: r,
      user_raw: uobj || null
    };
  }
  return map;
}

// ─── Seasons chain (auto-discovery) ─────────────────────────────────────

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
    name: mainLeague.name || null,
    status: mainLeague.status || null
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
        name: prev.name || null,
        status: prev.status || null
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
        name: next.name || null,
        status: next.status || null
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

/**
 * Pick the "live" league out of a seasons chain — the one we should default
 * to for current-week matchups, power rankings, trade ledger, etc.
 *
 * Priority:
 *   1. Newest league with status === 'in_season' (live games being played)
 *   2. Newest league with status === 'complete'   (last season's final results)
 *   3. Newest league overall                       (any state)
 *
 * Returns the matching `{ league_id, season, name, status }` entry — or
 * `null` if the chain is empty.
 */
export function pickActiveLeague(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return null;
  // Walk newest → oldest.
  const reversed = [...chain].reverse();
  let inSeason = null, complete = null;
  for (const s of reversed) {
    if (!inSeason && s.status === 'in_season') inSeason = s;
    if (!complete && s.status === 'complete') complete = s;
    if (inSeason && complete) break;
  }
  return inSeason || complete || reversed[0];
}

/**
 * Find the most recent fantasy week with non-trivial scoring for a given
 * league. We first read `settings.last_scored_leg` from league metadata
 * (Sleeper's own canonical answer to "which week was last scored"), and
 * fall back to walking weeks 25 → 1 finding the first week whose average
 * points across all entries exceeds `minAvg` (a heuristic to skip empty
 * future weeks and consolation-bracket dust).
 *
 * Returns `{ week, avgPoints }` or `null` if nothing matches.
 */
export async function getCurrentWeekForLeague(leagueId, { maxWeek = 25, minAvg = 20 } = {}) {
  // Prefer Sleeper's own `last_scored_leg` (it's the championship week for
  // completed leagues, and the most-recent completed week for in-season ones).
  try {
    const meta = await getLeague(leagueId);
    const last = meta?.settings?.last_scored_leg;
    const lastNum = Number(last);
    if (last != null && !isNaN(lastNum) && lastNum > 0) {
      const m = await getMatchupsForWeek(leagueId, lastNum).catch(() => null);
      if (Array.isArray(m) && m.length > 0) {
        let total = 0;
        for (const e of m) total += Number(e?.points ?? 0) || 0;
        const avg = total / m.length;
        if (avg >= minAvg) return { week: lastNum, avgPoints: avg };
      }
    }
  } catch (e) { /* fall through to scan */ }

  for (let wk = maxWeek; wk >= 1; wk--) {
    const m = await getMatchupsForWeek(leagueId, wk).catch(() => null);
    if (!Array.isArray(m) || m.length === 0) continue;
    let total = 0, count = 0;
    for (const e of m) {
      const pts = Number(e?.points ?? 0) || 0;
      total += pts;
      count += 1;
    }
    const avg = count ? total / count : 0;
    if (avg >= minAvg) return { week: wk, avgPoints: avg };
  }
  return null;
}

// ─── Transactions / Trades ──────────────────────────────────────────────

/**
 * Fetch transactions (trades + waivers + free agent moves) for one round
 * (a.k.a. week) of a league. Cached for 10 min — these change rarely once
 * a week has closed.
 */
export async function getTransactionsForWeek(leagueId, week, ttl = CACHE_10_MIN) {
  try {
    const d = await fetchWithCache(
      `${BASE}/league/${encodeURIComponent(leagueId)}/transactions/${encodeURIComponent(week)}`,
      {},
      ttl
    );
    return Array.isArray(d) ? d : [];
  } catch (e) {
    return [];
  }
}

/**
 * Convenience: pull transactions across a range of weeks in parallel and
 * filter to completed trades only (the most interesting subset for a
 * "trade ledger" widget). Newest first.
 */
export async function getRecentTrades(leagueId, { weekFrom = 1, weekTo = 25, limit = 20 } = {}) {
  const weeks = [];
  for (let w = weekFrom; w <= weekTo; w++) weeks.push(w);
  const lists = await Promise.all(weeks.map((w) => getTransactionsForWeek(leagueId, w)));
  const all = [];
  for (let i = 0; i < lists.length; i++) {
    for (const t of (lists[i] || [])) {
      if (t.type !== 'trade') continue;
      if (t.status !== 'complete') continue;
      all.push({ ...t, _week: weeks[i] });
    }
  }
  // Newest first by `status_updated`
  all.sort((a, b) => Number(b.status_updated || 0) - Number(a.status_updated || 0));
  return all.slice(0, limit);
}
