// src/lib/server/sleeperClient.js
/**
 * Sleeper API client used by server loaders.
 * - Provides cachedGet, concurrency control, retry, and a set of convenience helpers.
 * - New helpers implemented here:
 *     - getFinalStandingsForLeague(leagueId, opts)
 *     - getChampionForLeague(leagueId, opts)
 *
 * Usage:
 *   import { createSleeperClient } from '$lib/server/sleeperClient';
 *   const sleeper = createSleeperClient({ concurrency: 6, ttl: 3600 });
 *   const standings = await sleeper.getFinalStandingsForLeague('12345');
 */

import * as cacheModule from '$lib/server/cache'; // optional — many repos export adapter here

// Try to pick a cache adapter exported by the repo, otherwise undefined
const cacheAdapter =
  (cacheModule && (cacheModule.default || cacheModule.cache || cacheModule.adapter || cacheModule)) || null;

/**
 * Creates a Sleeper client instance.
 * opts:
 *   - concurrency: number of parallel outstanding fetches
 *   - baseUrl: base API url (defaults to Sleeper public API)
 *   - ttl: default cache TTL in seconds
 */
export function createSleeperClient(opts = {}) {
  const concurrency = Number(opts.concurrency || process.env.SLEEPER_CONCURRENCY || 6);
  const baseUrl = opts.baseUrl || 'https://api.sleeper.app/v1';
  const ttl = Number(opts.ttl || process.env.SLEEPER_TTL || 3600);
  const cache = opts.cacheAdapter || cacheAdapter || null;

  // Simple concurrency semaphore
  let running = 0;
  const queue = [];
  function withConcurrency(fn) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        running++;
        try {
          const r = await fn();
          resolve(r);
        } catch (err) {
          reject(err);
        } finally {
          running--;
          if (queue.length > 0) {
            const next = queue.shift();
            next();
          }
        }
      };

      if (running < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  }

  // Basic robust fetch with retry/backoff
  async function rawFetch(path, opts = {}) {
    const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const maxAttempts = Number(opts.attempts ?? 3);
    let attempt = 0;
    let lastErr = null;
    while (attempt < maxAttempts) {
      attempt++;
      try {
        // run the underlying fetch under concurrency control
        return await withConcurrency(async () => {
          const res = await fetch(url, opts.fetchOptions || {});
          if (!res.ok) {
            const body = await res.text().catch(() => null);
            const err = new Error(`Fetch ${res.status} ${res.statusText} ${url}: ${body ?? ''}`);
            err.status = res.status;
            throw err;
          }
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('json')) {
            return await res.json();
          }
          return await res.text();
        });
      } catch (e) {
        lastErr = e;
        // simple backoff
        const backoff = 100 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr || new Error('Unknown fetch error for ' + url);
  }

  /**
   * cachedGet: GET with cache (if cache adapter present)
   * key: cache key
   * urlPath: API path (string) or full URL
   * opts: { ttl, attempts, fetchOptions }
   */
  async function cachedGet(key, urlPath, opts = {}) {
    const useCache = !!cache && typeof cache.get === 'function' && typeof cache.set === 'function';
    const cacheTtl = Number(opts.ttl ?? ttl);

    if (useCache) {
      try {
        const raw = await cache.get(key);
        if (raw) {
          try {
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
          } catch (e) {
            // fall through to fetch
          }
        }
      } catch (e) {
        // ignore cache read errors, continue to fetch
      }
    }

    const payload = await rawFetch(urlPath, { attempts: opts.attempts ?? 3, fetchOptions: opts.fetchOptions });

    if (useCache) {
      try {
        await cache.set(key, JSON.stringify(payload), { ttl: cacheTtl });
      } catch (e) {
        // ignore cache write errors
      }
    }

    return payload;
  }

  /**************************************************************************
   * Low-level Sleeper helpers (thin wrappers around the public API)
   **************************************************************************/

  // Get league metadata
  async function getLeague(leagueId, opts = {}) {
    const key = `sleeper:league:${leagueId}`;
    const path = `/league/${leagueId}`;
    try {
      return await cachedGet(key, path, { ttl: opts.ttl ?? 60 * 5 });
    } catch (e) {
      // fallback to raw fetch without caching
      return await rawFetch(path, opts);
    }
  }

  // Get matchups for a given week
  async function getMatchupsForWeek(leagueId, week, opts = {}) {
    const key = `sleeper:matchups:${leagueId}:w${week}`;
    const path = `/league/${leagueId}/matchups/${week}`;
    try {
      return await cachedGet(key, path, { ttl: opts.ttl ?? 60 * 30 });
    } catch (e) {
      return await rawFetch(path, opts);
    }
  }

  // Get rosters plus owners; shape: { rosterId: { rosterId, team_name, owner_name, team_avatar, ... } }
  async function getRosterMapWithOwners(leagueId, opts = {}) {
    const key = `sleeper:rosters:${leagueId}`;
    // Common endpoints: /league/{league_id}/rosters and /league/{league_id}/users or /league/{league_id}/rosters + separate owners
    try {
      // Attempt to fetch rosters
      const rosters = await cachedGet(`${key}:list`, `/league/${leagueId}/rosters`, { ttl: opts.ttl ?? 60 * 60 });
      // users (owners)
      let users = [];
      try {
        users = await cachedGet(`${key}:users`, `/league/${leagueId}/users`, { ttl: opts.ttl ?? 60 * 60 });
      } catch (e) {
        // some leagues may not have users endpoint; ignore
        users = [];
      }

      const map = {};
      if (Array.isArray(rosters)) {
        for (const r of rosters) {
          const rid = String(r.roster_id ?? r.rosterId ?? r.roster_id ?? r.rosterId ?? r.owner_id ?? r.ownerId ?? r.owner ?? r.roster ?? r.roster_id ?? r.owner_id ?? r.rosterId ?? r.id ?? r.roster_id ?? 'unknown');
          map[rid] = {
            rosterId: rid,
            team_name: r.team_name ?? r.team ?? r.nickname ?? r?.settings?.team_name ?? null,
            team_avatar: r.team_avatar ?? r.avatar ?? null,
            // owner info is sometimes on the roster as owner_id or owner
            owner_id: r.owner_id ?? r.ownerId ?? r.owner ?? null,
            ...r
          };
        }
      }

      // enrich with users if possible
      if (Array.isArray(users) && users.length > 0) {
        // users often have user_id, display_name, avatar
        for (const u of users) {
          // connect by user_id or user_id -> roster.owner_id
          const uid = String(u.user_id ?? u.userId ?? u.id ?? u.user_id ?? u.owner_id ?? u.ownerId ?? u?.metadata?.user_id ?? null);
          if (!uid) continue;
          // find roster that matches owner_id === uid
          for (const rid of Object.keys(map)) {
            const r = map[rid];
            if (String(r.owner_id ?? r.user_id ?? r.owner ?? '') === uid || String(r.user_id ?? '') === uid) {
              r.owner_name = u.display_name ?? u.displayName ?? u.username ?? u.username ?? u.name ?? u?.metadata?.display_name ?? u.user_id ?? null;
              r.owner_avatar = r.owner_avatar ?? u.avatar ?? u.user_avatar ?? null;
            }
          }
        }
      }

      return map;
    } catch (e) {
      // fallback: try simpler endpoints or return empty map
      try {
        const rosters = await rawFetch(`/league/${leagueId}/rosters`);
        const map = {};
        if (Array.isArray(rosters)) {
          for (const r of rosters) {
            const rid = String(r.roster_id ?? r.rosterId ?? r.id ?? 'unknown');
            map[rid] = { rosterId: rid, team_name: r.team_name ?? null, team_avatar: r.team_avatar ?? null, ...r };
          }
        }
        return map;
      } catch (err) {
        return {};
      }
    }
  }

  // get users for a league (if needed)
  async function getUsersForLeague(leagueId, opts = {}) {
    const key = `sleeper:users:${leagueId}`;
    try {
      return await cachedGet(key, `/league/${leagueId}/users`, { ttl: opts.ttl ?? 60 * 60 });
    } catch (e) {
      return await rawFetch(`/league/${leagueId}/users`, opts);
    }
  }

  /**************************************************************************
   * New high-level helpers (moved heavy lifting into the client)
   * These are the functions you asked for: getFinalStandingsForLeague, getChampionForLeague
   **************************************************************************/

  /**
   * Compute final standings for a given leagueId.
   * - Uses getRosterMapWithOwners and getMatchupsForWeek internally.
   * - Caches result using the configured cache adapter if present.
   *
   * Returned shape:
   *  { leagueId, standings: [ { rosterId, team_name, owner_name, team_avatar, wins, losses, ties, points_for, points_against } ], meta: { leagueMeta, rosterMap } }
   */
  async function getFinalStandingsForLeague(leagueId, opts = {}) {
    const cacheKey = `sleeper:computed:standings:${leagueId}`;
    const cacheTtl = opts.ttl ?? ttl ?? 3600;

    // try cache
    try {
      if (cache && cache.get) {
        const cached = await cache.get(cacheKey);
        if (cached) {
          try { return typeof cached === 'string' ? JSON.parse(cached) : cached; } catch (e) {}
        }
      }
    } catch (e) {
      // ignore cache read errors
    }

    // fetch league meta + roster map
    let leagueMeta = null;
    try { leagueMeta = await getLeague(leagueId); } catch (e) { leagueMeta = null; }

    let rosterMap = {};
    try { rosterMap = await getRosterMapWithOwners(leagueId); } catch (e) { rosterMap = {}; }

    // Determine how many weeks to consider for the regular season
    let maxWeeks = 17;
    try {
      const s = leagueMeta?.settings ?? {};
      maxWeeks = Number(s.matchup_count ?? s.max_week ?? s.maxWeek ?? leagueMeta?.max_week ?? leagueMeta?.settings?.regular_season_length ?? maxWeeks) || maxWeeks;
      if (maxWeeks < 1 || maxWeeks > 40) maxWeeks = 17;
    } catch (e) {
      maxWeeks = 17;
    }

    const table = {}; // rosterId -> stats

    for (let wk = 1; wk <= maxWeeks; wk++) {
      let matchups = [];
      try { matchups = await getMatchupsForWeek(leagueId, wk); } catch (e) { matchups = []; }
      if (!Array.isArray(matchups) || matchups.length === 0) continue;

      for (const m of matchups) {
        const participants = m.participants ?? m.entries ?? m.rosters ?? m.users ?? null;
        if (Array.isArray(participants) && participants.length >= 1) {
          for (const p of participants) {
            const rid = String(p.roster_id ?? p.rosterId ?? p.owner_id ?? p.ownerId ?? p.roster ?? 'unknown');
            const pts = Number(p.points ?? p.points_for ?? p.pts ?? p.score ?? 0) || 0;
            if (!table[rid]) table[rid] = { rosterId: rid, wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };
            table[rid].points_for += pts;
          }
          if (participants.length === 2) {
            const a = participants[0];
            const b = participants[1];
            const ra = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? a.roster ?? 'a');
            const rb = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? b.roster ?? 'b');
            const pa = Number(a.points ?? a.points_for ?? a.pts ?? a.score ?? 0) || 0;
            const pb = Number(b.points ?? b.points_for ?? b.pts ?? b.score ?? 0) || 0;
            if (!table[ra]) table[ra] = { rosterId: ra, wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };
            if (!table[rb]) table[rb] = { rosterId: rb, wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };
            table[ra].points_against += pb;
            table[rb].points_against += pa;
            if (pa > pb) {
              table[ra].wins += 1; table[rb].losses += 1;
            } else if (pb > pa) {
              table[rb].wins += 1; table[ra].losses += 1;
            } else {
              table[ra].ties += 1; table[rb].ties += 1;
            }
          } else {
            // multi-way: points_for aggregated; wins/losses omitted
          }
        } else {
          const rid = String(m.roster_id ?? m.rosterId ?? m.owner_id ?? m.ownerId ?? 'unknown');
          const pts = Number(m.points ?? m.points_for ?? m.pts ?? 0) || 0;
          if (!table[rid]) table[rid] = { rosterId: rid, wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };
          table[rid].points_for += pts;
        }
      }
    }

    const standings = Object.values(table).map((r) => {
      const meta = rosterMap && rosterMap[r.rosterId] ? rosterMap[r.rosterId] : {};
      return {
        rosterId: r.rosterId,
        team_name: meta.team_name ?? meta.team ?? meta.nickname ?? null,
        owner_name: meta.owner_name ?? meta.owner ?? null,
        team_avatar: meta.team_avatar ?? meta.avatar ?? null,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        points_for: Math.round((r.points_for || 0) * 100) / 100,
        points_against: Math.round((r.points_against || 0) * 100) / 100
      };
    });

    standings.sort((a, b) => {
      const aw = Number(a.wins || 0), bw = Number(b.wins || 0);
      if (aw !== bw) return bw - aw;
      const ap = Number(a.points_for || 0), bp = Number(b.points_for || 0);
      return bp - ap;
    });

    const out = { leagueId: String(leagueId), standings, meta: { leagueMeta, rosterMap } };

    try {
      if (cache && cache.set) await cache.set(cacheKey, JSON.stringify(out), { ttl: cacheTtl });
    } catch (e) {
      // ignore cache write errors
    }

    return out;
  }

  /**
   * Compute champion for a given leagueId.
   * - Heuristic: sum of roster points across playoff weeks (playoffStart, playoffStart+1, playoffStart+2)
   * - Returns: { leagueId, champion, playoffTotals, playoffStart }
   */
  async function getChampionForLeague(leagueId, opts = {}) {
    const cacheKey = `sleeper:computed:champion:${leagueId}`;
    const cacheTtl = opts.ttl ?? (ttl ? ttl * 24 : 60 * 60 * 24);

    try {
      if (cache && cache.get) {
        const raw = await cache.get(cacheKey);
        if (raw) {
          try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) {}
        }
      }
    } catch (e) {
      // ignore cache reads
    }

    // Try to get league meta and roster map
    let leagueMeta = null;
    try { leagueMeta = await getLeague(leagueId); } catch (e) { leagueMeta = null; }

    let rosterMap = {};
    try { rosterMap = await getRosterMapWithOwners(leagueId); } catch (e) { rosterMap = {}; }

    // detect playoff start
    let playoffStart = null;
    try {
      const s = leagueMeta?.settings ?? {};
      playoffStart = Number(s.playoff_week_start ?? s.playoffStart ?? s.playoff_start ?? s.playoffStartWeek ?? leagueMeta?.playoff_start ?? leagueMeta?.playoffStart ?? null);
    } catch (e) {
      playoffStart = null;
    }
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
    const playoffWeeks = [playoffStart, playoffStart + 1, playoffStart + 2];

    const totals = {};
    for (const wk of playoffWeeks) {
      let matchups = [];
      try { matchups = await getMatchupsForWeek(leagueId, wk); } catch (e) { matchups = []; }
      if (!Array.isArray(matchups)) continue;

      for (const m of matchups) {
        const parts = m.participants ?? m.entries ?? m.rosters ?? m.users ?? null;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            const rid = String(p.roster_id ?? p.rosterId ?? p.owner_id ?? p.ownerId ?? p.roster ?? 'unknown');
            const pts = Number(p.points ?? p.points_for ?? p.pts ?? p.score ?? 0) || 0;
            totals[rid] = (totals[rid] || 0) + pts;
          }
        } else {
          const rid = String(m.roster_id ?? m.rosterId ?? m.owner_id ?? m.ownerId ?? 'unknown');
          const pts = Number(m.points ?? m.points_for ?? m.pts ?? 0) || 0;
          totals[rid] = (totals[rid] || 0) + pts;
        }
      }
    }

    let topId = null;
    let topPts = -Infinity;
    for (const k of Object.keys(totals)) {
      if (totals[k] > topPts) {
        topPts = totals[k];
        topId = k;
      }
    }

    const championMeta =
      (topId && rosterMap && rosterMap[topId]) || {
        rosterId: topId,
        team_name: rosterMap?.[topId]?.team_name ?? 'Roster ' + topId,
        owner_name: rosterMap?.[topId]?.owner_name ?? null,
        team_avatar: rosterMap?.[topId]?.team_avatar ?? null
      };

    const out = { leagueId: String(leagueId), champion: championMeta, playoffTotals: totals, playoffStart };

    try { if (cache && cache.set) await cache.set(cacheKey, JSON.stringify(out), { ttl: cacheTtl }); } catch (e) {}

    return out;
  }

  /**************************************************************************
   * Return public API
   **************************************************************************/
  return {
    // low-level
    rawFetch,
    cachedGet,

    // basic helpers
    getLeague,
    getMatchupsForWeek,
    getRosterMapWithOwners,
    getUsersForLeague,

    // high-level computed helpers
    getFinalStandingsForLeague,
    getChampionForLeague
  };
}
