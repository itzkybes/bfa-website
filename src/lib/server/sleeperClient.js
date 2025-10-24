// src/lib/server/sleeperClient.js
//
// Lightweight Sleeper API client wrapper used across server loaders.
// Exposes: createSleeperClient({ cache, concurrency })
//
// Notes:
// - cache is optional: if provided it should implement `get(key)` and `set(key, value, ttlSeconds)`
// - concurrency controls the number of concurrent outbound requests where used (not strictly enforced for every call)
// - this file includes a patched _extractPlayerPointsMap that returns only starter player -> points mapping.

const BASE = 'https://api.sleeper.app/v1';
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 350;

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Extract a map of playerId -> points for starter players only.
 * Accepts a matchup/roster entry object (various shapes) and returns
 * a plain object mapping playerId (string) to numeric points.
 *
 * Only starters are included (bench players intentionally excluded).
 */
function _extractPlayerPointsMap(entry) {
  const map = {};
  if (!entry || typeof entry !== 'object') return map;

  // 1) find starters array from common possible fields
  const startersKeys = [
    'starters', 'starting_lineup', 'starting_lineups', 'lineup',
    'starters_list', 'starting_roster', 'starting_lineup_roster', 'players'
  ];
  let starters = null;
  for (const k of startersKeys) {
    if (Array.isArray(entry[k]) && entry[k].length) { starters = entry[k]; break; }
    // some APIs nest under entry.roster
    if (entry.roster && Array.isArray(entry.roster[k]) && entry.roster[k].length) { starters = entry.roster[k]; break; }
  }

  // nothing to do if no starters found
  if (!Array.isArray(starters) || starters.length === 0) return map;

  // 2) find starter-points array or object from common possible fields
  const starterPointsArrayKeys = [
    'starters_points', 'startersPoints', 'starter_points', 'starterPoints', 'starters_points_list'
  ];
  let starterPointsArray = null;
  for (const k of starterPointsArrayKeys) {
    if (Array.isArray(entry[k]) && entry[k].length) { starterPointsArray = entry[k]; break; }
    if (entry.roster && Array.isArray(entry.roster[k]) && entry.roster[k].length) { starterPointsArray = entry.roster[k]; break; }
  }

  // 3) find keyed points object if present (playerId -> points)
  const starterPointsObjKeys = [
    'player_points', 'players_points', 'players_points_map', 'player_points_map', 'player_points_by_id'
  ];
  let starterPointsObj = null;
  for (const k of starterPointsObjKeys) {
    if (entry[k] && typeof entry[k] === 'object' && !Array.isArray(entry[k])) { starterPointsObj = entry[k]; break; }
    if (entry.roster && entry.roster[k] && typeof entry.roster[k] === 'object' && !Array.isArray(entry.roster[k])) { starterPointsObj = entry.roster[k]; break; }
  }

  // 4) If starterPointsArray exists and lengths match, map by index (preferred)
  if (Array.isArray(starterPointsArray) && starterPointsArray.length >= starters.length) {
    // Align indices: some providers might include more entries; prefer same length or larger
    for (let i = 0; i < starters.length; i++) {
      const sidRaw = starters[i];
      const pid = (sidRaw && typeof sidRaw === 'object') ? (sidRaw.player_id ?? sidRaw.id ?? sidRaw?.playerId ?? String(sidRaw)) : String(sidRaw);
      if (!pid) continue;
      const pts = safeNum(starterPointsArray[i]);
      map[String(pid)] = pts;
    }
    return map;
  }

  // 5) If we have a keyed points object, use it for starters (best-effort keys by pid/upper/lower)
  if (starterPointsObj && typeof starterPointsObj === 'object') {
    for (const s of starters) {
      const sidRaw = s;
      const pid = (sidRaw && typeof sidRaw === 'object') ? (sidRaw.player_id ?? sidRaw.id ?? sidRaw?.playerId ?? String(sidRaw)) : String(sidRaw);
      if (!pid) continue;
      // check a few key variants
      let val = starterPointsObj[pid];
      if (val == null) {
        if (pid.toUpperCase) val = starterPointsObj[pid.toUpperCase()];
      }
      if (val == null) {
        if (pid.toLowerCase) val = starterPointsObj[pid.toLowerCase()];
      }
      // if starterPointsObj contains nested object (e.g. { points: X })
      if (val && typeof val === 'object' && (val.points != null || val.points_for != null || val.pts != null)) {
        val = val.points ?? val.points_for ?? val.pts;
      }
      if (val != null) map[String(pid)] = safeNum(val);
    }
    return map;
  }

  // 6) Fallback: sometimes starters are objects that include points inline (e.g. { player_id, points })
  for (const s of starters) {
    if (s && typeof s === 'object') {
      const pid = String(s.player_id ?? s.id ?? s?.playerId ?? '');
      if (!pid) continue;
      const pts = safeNum(s.points ?? s.points_for ?? s.pts ?? s.starter_points ?? null);
      // include even zero points if explicitly present
      if (pts !== 0 || (s.points !== undefined && s.points !== null) || (s.points_for !== undefined && s.points_for !== null)) {
        map[pid] = pts;
      }
    }
  }

  // 7) If we still have an empty map, do a last resort: try pulling points from top-level entry properties keyed by player ids
  if (Object.keys(map).length === 0) {
    for (const s of starters) {
      const pid = (s && typeof s === 'object') ? (s.player_id ?? s.id ?? s?.playerId ?? String(s)) : String(s);
      if (!pid) continue;
      // check top-level for a property that looks like points for that player
      const v = entry[pid] ?? entry[pid.toUpperCase?.()] ?? entry[pid.toLowerCase?.()];
      if (v != null && typeof v !== 'object') map[String(pid)] = safeNum(v);
    }
  }

  return map;
}

/**
 * createSleeperClient - returns a small wrapper with convenient methods.
 *
 * Usage:
 * const client = createSleeperClient({ cache, concurrency: 8 });
 * await client.getLeague(leagueId);
 * await client.getMatchupsForWeek(leagueId, week);
 */
export function createSleeperClient(opts = {}) {
  const cache = opts.cache || null;
  const concurrency = Number(opts.concurrency) || DEFAULT_CONCURRENCY;
  const retries = Number(opts.retries ?? DEFAULT_RETRIES);

  // Basic delay helper
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Compose cache key helper
  function cacheKey(path) {
    return `sleeper:${path}`;
  }

  // rawFetch with retries + optional caching
  async function rawFetch(path, { ttl = 0, force = false } = {}) {
    const url = (path.indexOf('http') === 0) ? path : (BASE + (path.indexOf('/') === 0 ? path : '/' + path));
    const key = cache ? cacheKey(url) : null;

    if (cache && !force && ttl > 0) {
      try {
        const cached = await cache.get(key);
        if (cached) {
          // assume cache.get returns parsed object (if KV), if it's string try parse
          return typeof cached === 'string' ? JSON.parse(cached) : cached;
        }
      } catch (e) {
        // ignore cache errors
      }
    }

    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
          // for 4xx, don't retry except 429
          if (res.status >= 400 && res.status < 500 && res.status !== 429) throw lastErr;
          // else allow retry
        } else {
          const json = await res.json();
          if (cache && ttl > 0) {
            try {
              // store stringified if KV requires string
              await cache.set(key, JSON.stringify(json), ttl);
            } catch (e) {
              // ignore cache set errors
            }
          }
          return json;
        }
      } catch (err) {
        lastErr = err;
        // exponential-ish backoff
        await delay(DEFAULT_RETRY_DELAY * (attempt + 1));
      }
    }
    throw lastErr || new Error('rawFetch failed: ' + url);
  }

  // Convenience callers

  async function getLeague(leagueId, { ttl = 60 * 5 } = {}) {
    if (!leagueId) throw new Error('leagueId required');
    return await rawFetch(`/league/${encodeURIComponent(leagueId)}`, { ttl });
  }

  async function getRosters(leagueId, { ttl = 60 * 5 } = {}) {
    return await rawFetch(`/league/${encodeURIComponent(leagueId)}/rosters`, { ttl });
  }

  async function getUsers(leagueId, { ttl = 60 * 5 } = {}) {
    return await rawFetch(`/league/${encodeURIComponent(leagueId)}/users`, { ttl });
  }

  async function getMatchupsForWeek(leagueId, week, { ttl = 60 * 5 } = {}) {
    if (!leagueId) throw new Error('leagueId required');
    if (week == null) throw new Error('week required');
    // some callers expect roster-level matchups structure
    return await rawFetch(`/league/${encodeURIComponent(leagueId)}/matchups/${encodeURIComponent(String(week))}`, { ttl });
  }

  // Helper: get rosters + users and produce a rosterMap keyed by roster_id with owner info
  async function getRosterMapWithOwners(leagueId, { ttl = 60 * 5 } = {}) {
    const [rosters, users] = await Promise.all([
      getRosters(leagueId, { ttl }),
      getUsers(leagueId, { ttl })
    ]);

    // normalize users by id
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
        const ownerId = r.owner_id ?? r.ownerId ?? r.user_id ?? null;
        const uobj = ownerId != null ? usersById[String(ownerId)] : null;

        // heuristics for team name/avatar
        let teamName = null;
        try {
          if (r.metadata && r.metadata.team_name) teamName = r.metadata.team_name;
        } catch(e){}
        if (!teamName && uobj) {
          try {
            if (uobj.metadata && uobj.metadata.team_name) teamName = uobj.metadata.team_name;
            else if (uobj.display_name) teamName = `${uobj.display_name}'s Team`;
            else if (uobj.username) teamName = `${uobj.username}'s Team`;
          } catch(e){}
        }
        if (!teamName) teamName = 'Roster ' + String(rid);

        let teamAvatar = null;
        try {
          if (r.metadata && r.metadata.team_avatar) {
            const c = String(r.metadata.team_avatar);
            teamAvatar = (c.indexOf('http') === 0) ? c : ('https://sleepercdn.com/avatars/' + c);
          }
        } catch(e){}

        let ownerAvatar = null;
        if (uobj) {
          try {
            if (uobj.metadata && uobj.metadata.team_avatar) ownerAvatar = (String(uobj.metadata.team_avatar).indexOf('http') === 0 ? String(uobj.metadata.team_avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.metadata.team_avatar));
          } catch(e){}
          if (!ownerAvatar) try { if (uobj.metadata && uobj.metadata.avatar) ownerAvatar = (String(uobj.metadata.avatar).indexOf('http') === 0 ? String(uobj.metadata.avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.metadata.avatar)); } catch(e){}
          if (!ownerAvatar) try { if (uobj.avatar) ownerAvatar = (String(uobj.avatar).indexOf('http') === 0 ? String(uobj.avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.avatar)); } catch(e){}
        }

        map[String(rid)] = {
          roster_id: rid != null ? String(rid) : null,
          owner_id: ownerId != null ? String(ownerId) : null,
          team_name: teamName,
          owner_name: uobj ? (uobj.display_name || uobj.username || null) : null,
          team_avatar: teamAvatar,
          owner_avatar: ownerAvatar,
          roster_raw: r,
          user_raw: uobj || null
        };
      }
    }

    return map;
  }

  // Helper: get rosters with owners aggregated array form (fallback)
  async function getRostersWithOwners(leagueId, { ttl = 60 * 5 } = {}) {
    const map = await getRosterMapWithOwners(leagueId, { ttl });
    return Object.keys(map).map(k => map[k]);
  }

  // expose everything
  return {
    rawFetch,
    getLeague,
    getRosters,
    getUsers,
    getMatchupsForWeek,
    getRosterMapWithOwners,
    getRostersWithOwners,
    // export utility for tests/inspection if desired
    _extractPlayerPointsMap,
    safeNum
  };
}

export default createSleeperClient;
