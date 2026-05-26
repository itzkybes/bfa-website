// src/lib/sleeperClient.client.js
// Browser-safe Sleeper API client. Same shape as the server one, but uses
// browser fetch + localStorage cache (no Node-only deps). Use this in
// +page.svelte / +page.js (NOT +page.server.js).

import { fetchWithCache } from '$lib/cache';

const BASE = 'https://api.sleeper.app/v1';
const SLEEPER_CDN = 'https://sleepercdn.com';

export const BASE_LEAGUE_ID = '1219816671624048640';

const CACHE_5_MIN = 5 * 60 * 1000;
const CACHE_10_MIN = 10 * 60 * 1000;
const CACHE_1_HOUR = 60 * 60 * 1000;

export function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export async function getLeague(leagueId, ttl = CACHE_5_MIN) {
  return await fetchWithCache(`${BASE}/league/${encodeURIComponent(leagueId)}`, {}, ttl);
}

export async function getRosters(leagueId, ttl = CACHE_10_MIN) {
  return await fetchWithCache(`${BASE}/league/${encodeURIComponent(leagueId)}/rosters`, {}, ttl);
}

export async function getUsers(leagueId, ttl = CACHE_10_MIN) {
  return await fetchWithCache(`${BASE}/league/${encodeURIComponent(leagueId)}/users`, {}, ttl);
}

export async function getMatchupsForWeek(leagueId, week, ttl = CACHE_5_MIN) {
  return await fetchWithCache(
    `${BASE}/league/${encodeURIComponent(leagueId)}/matchups/${encodeURIComponent(week)}`,
    {},
    ttl
  );
}

export async function getPlayersNba(ttl = CACHE_1_HOUR) {
  // The full players map is ~5MB. Cache aggressively (the browser pays the
  // cost once; subsequent visits read from localStorage).
  return await fetchWithCache(`${BASE}/players/nba`, {}, ttl);
}

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
  if (Array.isArray(rosters)) {
    for (const r of rosters) {
      const rid = r.roster_id ?? r.id ?? r.rosterId;
      if (rid == null) continue;
      const ownerId = r.owner_id ?? r.ownerId ?? r.user_id ?? null;
      const uobj = ownerId != null ? usersById[String(ownerId)] : null;

      // team name
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

      // team avatar
      let teamAvatar = null;
      try {
        if (r.metadata && r.metadata.team_avatar) {
          const c = String(r.metadata.team_avatar);
          teamAvatar = (c.indexOf('http') === 0) ? c : (SLEEPER_CDN + '/avatars/' + c);
        }
      } catch (e) {}

      // owner avatar
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
  }
  return map;
}

/** Build the seasons chain (current → previous_league_id chain) from a base league. */
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
  // sort old → new
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

/** Player headshot URL */
export function playerHeadshot(pid) {
  return pid ? `${SLEEPER_CDN}/content/nba/players/${pid}.jpg` : '';
}
