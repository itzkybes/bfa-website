// src/lib/server/sleeperClient.js
// Central Sleeper API client for server-side usage.
// Exports createSleeperClient and a default client using an in-memory cache.
//
// Features:
// - concurrency limiting
// - retry + exponential backoff
// - cached GET helper that uses provided cache adapter
// - helper getRostersWithOwners / getRosterMapWithOwners to centralize roster+owner enrichment

// NOTE: This file expects a cache adapter with async get/set/del (see $lib/server/cache.js)

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// createLimiter: simple p-limit-like concurrency limiter
function createLimiter(maxConcurrency = 8) {
  let active = 0;
  const queue = [];
  function next() {
    if (!queue.length || active >= maxConcurrency) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(
      (v) => { resolve(v); active--; next(); },
      (err) => { reject(err); active--; next(); }
    );
  }
  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

export function createSleeperClient({ cache = null, concurrency = 8, baseUrl = 'https://api.sleeper.app/v1' } = {}) {
  const limit = createLimiter(concurrency);

  // retry wrapper with exponential backoff
  async function retryFetch(fullUrl, opts = {}, retries = 3, baseDelay = 250) {
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(fullUrl, opts);
        if (!res.ok) {
          let bodyText = '';
          try { bodyText = await res.text(); } catch (e) {}
          const err = new Error(`HTTP ${res.status} ${res.statusText} - ${fullUrl}: ${bodyText}`);
          err.status = res.status;
          throw err;
        }
        const json = await res.json();
        return json;
      } catch (err) {
        lastErr = err;
        // don't retry on client errors except 429
        if (err && err.status && err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
        const delay = baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  // cached GET helper
  async function cachedGet(pathOrUrl, { ttl = 60 } = {}) {
    const fullUrl = pathOrUrl.startsWith('http') ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
    const key = `sleeper:${fullUrl}`;
    if (cache) {
      try {
        const cached = await cache.get(key);
        if (cached) {
          try { return JSON.parse(cached); } catch (e) { /* fall through to refetch */ }
        }
      } catch (e) {
        // ignore cache errors
        console.warn('sleeperClient: cache.get error', e && e.message ? e.message : e);
      }
    }

    const data = await limit(() => retryFetch(fullUrl, { method: 'GET' }));
    if (cache) {
      try {
        await cache.set(key, JSON.stringify(data), ttl);
      } catch (e) {
        console.warn('sleeperClient: cache.set error', e && e.message ? e.message : e);
      }
    }
    return data;
  }

  // convenience raw fetch (no cache)
  const rawFetch = (pathOrUrl, opts = {}) => {
    const fullUrl = pathOrUrl.startsWith('http') ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
    return limit(() => retryFetch(fullUrl, opts));
  };

  // helper to normalize avatar id/url into a full URL (mirrors original repo helper)
  function _makeAvatarUrl(candidate) {
    if (!candidate) return null;
    try {
      if (String(candidate).indexOf('http') === 0) return String(candidate);
    } catch (e) {}
    return 'https://sleepercdn.com/avatars/' + String(candidate);
  }

  // Public API: common endpoint wrappers (cached)
  async function getLeague(leagueId, opts = {}) {
    return cachedGet(`/league/${encodeURIComponent(leagueId)}`, opts);
  }
  async function getRosters(leagueId, opts = {}) {
    return cachedGet(`/league/${encodeURIComponent(leagueId)}/rosters`, opts);
  }
  async function getUsers(leagueId, opts = {}) {
    return cachedGet(`/league/${encodeURIComponent(leagueId)}/users`, opts);
  }
  async function getMatchupsForWeek(leagueId, week, opts = {}) {
    return cachedGet(`/league/${encodeURIComponent(leagueId)}/matchups/${week}`, opts);
  }

  /**
   * Build normalized roster+owner enriched objects for a league.
   * Returns an array of:
   *  { roster_id, owner_id, team_name, owner_name, team_avatar, owner_avatar, roster_raw, user_raw }
   *
   * Resolution heuristics:
   * - team_name: roster.metadata.team_name -> user.metadata.team_name -> user.display_name (+ "'s Team") -> fallback 'Roster X'
   * - team_avatar: roster.metadata.team_avatar -> roster.metadata.logo -> user.metadata.team_avatar -> user.metadata.avatar -> user.avatar
   * - owner_name: user.display_name || user.username
   */
  async function getRostersWithOwners(leagueId, { ttl = 60 * 5 } = {}) {
    // Use cached endpoints for rosters + users
    const [rosters, users] = await Promise.all([
      (async () => {
        try { return await cachedGet(`/league/${encodeURIComponent(leagueId)}/rosters`, { ttl }); } catch (e) { return []; }
      })(),
      (async () => {
        try { return await cachedGet(`/league/${encodeURIComponent(leagueId)}/users`, { ttl }); } catch (e) { return []; }
      })()
    ]);

    const usersById = {};
    if (Array.isArray(users)) {
      for (const u of users) {
        const id = u.user_id ?? u.userId ?? u.id;
        if (id != null) usersById[String(id)] = u;
      }
    }

    const out = [];
    if (!Array.isArray(rosters)) return out;

    for (const r of rosters) {
      const rosterId = r.roster_id ?? r.id ?? r.rosterId;
      const ownerId = r.owner_id ?? r.ownerId ?? null;

      // Resolve team name
      let teamName = null;
      if (r && r.metadata && r.metadata.team_name) teamName = r.metadata.team_name;
      const userObj = ownerId != null ? usersById[String(ownerId)] : null;
      if (!teamName && userObj) {
        if (userObj.metadata && userObj.metadata.team_name) teamName = userObj.metadata.team_name;
        else if (userObj.display_name) teamName = userObj.display_name + "'s Team";
        else if (userObj.username) teamName = userObj.username + "'s Team";
      }
      if (!teamName) teamName = 'Roster ' + String(rosterId);

      // Avatar resolution
      let teamAvatar = null;
      if (r && r.metadata && r.metadata.team_avatar) teamAvatar = _makeAvatarUrl(r.metadata.team_avatar);
      else if (r && r.metadata && r.metadata.logo) teamAvatar = _makeAvatarUrl(r.metadata.logo);

      let ownerAvatar = null;
      if (userObj) {
        if (userObj.metadata && userObj.metadata.team_avatar) ownerAvatar = _makeAvatarUrl(userObj.metadata.team_avatar);
        else if (userObj.metadata && userObj.metadata.avatar) ownerAvatar = _makeAvatarUrl(userObj.metadata.avatar);
        else if (userObj.avatar) ownerAvatar = _makeAvatarUrl(userObj.avatar);
      }

      const ownerName = userObj ? (userObj.display_name || userObj.username || null) : null;

      out.push({
        roster_id: rosterId != null ? String(rosterId) : null,
        owner_id: ownerId != null ? String(ownerId) : null,
        team_name: teamName,
        owner_name: ownerName,
        team_avatar: teamAvatar,
        owner_avatar: ownerAvatar,
        roster_raw: r,
        user_raw: userObj || null
      });
    }

    return out;
  }

  /**
   * Map variant: returns { rosterId: enrichedObj } for quick lookup.
   */
  async function getRosterMapWithOwners(leagueId, opts = {}) {
    const arr = await getRostersWithOwners(leagueId, opts);
    const map = {};
    for (const e of arr) {
      if (e && e.roster_id != null) map[String(e.roster_id)] = e;
    }
    return map;
  }

  /**
   * Clear cache for a given path (useful for invalidation).
   */
  async function clearCacheForPath(pathOrUrl) {
    if (!cache) return;
    const fullUrl = pathOrUrl.startsWith('http') ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
    const key = `sleeper:${fullUrl}`;
    if (cache.del) await cache.del(key);
  }

  return {
    rawFetch,
    getLeague,
    getRosters,
    getUsers,
    getMatchupsForWeek,
    // new enrichment helpers
    getRostersWithOwners,
    getRosterMapWithOwners,
    batchGet: async (paths = [], opts = {}) => {
      const promises = paths.map(p => cachedGet(p, opts));
      return Promise.all(promises);
    },
    clearCacheForPath
  };
}

// default export convenience: create a default client with in-memory cache (safe for dev)
import { createMemoryCache } from '$lib/server/cache';
export const defaultSleeperClient = createSleeperClient({ cache: createMemoryCache(), concurrency: 6 });
export default defaultSleeperClient;
