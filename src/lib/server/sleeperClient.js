// src/lib/server/sleeperClient.js
//
// Lightweight Sleeper client wrapper used by server loaders.
// - createSleeperClient({ cache, concurrency })
// - client exposes: rawFetch, getLeague, getMatchupsForWeek, getRosters, getUsers,
//   getRosterMapWithOwners, getMatchupScoresForWeek, _extractPlayerPointsMap
//
// The implementation below is intentionally defensive about payload shapes and naming.

export function createSleeperClient({ cache = null, concurrency = 8 } = {}) {
  // Basic helpers for cache (expect cache.get(key) and cache.set(key, value, ttl))
  const CACHE = cache || {
    async get() { return null; },
    async set() { return; }
  };

  // Basic backoff retry wrapper for fetch-like calls
  async function withRetries(fn, tries = 3, delayMs = 250) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        // exponential backoff
        await new Promise(res => setTimeout(res, delayMs * (1 + i * 1.5)));
      }
    }
    throw lastErr;
  }

  // Normalized fetch that returns parsed JSON (server-side)
  async function rawFetch(path, opts = {}) {
    // Accept either a fully-qualified URL or a path - normalize to Sleeper API
    const ttl = opts.ttl || 0;
    const isFullUrl = String(path).indexOf('http') === 0;
    const url = isFullUrl ? String(path) : `https://api.sleeper.app/v1${String(path)}`;

    const cacheKey = `sleeper:raw:${url}`;
    if (ttl && CACHE && typeof CACHE.get === 'function') {
      const cached = await CACHE.get(cacheKey);
      if (cached != null) return cached;
    }

    const res = await withRetries(() => fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } }));
    if (!res.ok) throw new Error(`Sleeper fetch failed: ${res.status} ${url}`);
    const j = await res.json();

    if (ttl && CACHE && typeof CACHE.set === 'function') {
      try { await CACHE.set(cacheKey, j, ttl); } catch (e) { /* ignore cache failures */ }
    }
    return j;
  }

  // Convenience wrappers with TTL support
  async function getLeague(leagueId, opts = {}) {
    return await rawFetch(`/league/${encodeURIComponent(String(leagueId))}`, { ttl: opts.ttl || 0 });
  }

  async function getRosters(leagueId, opts = {}) {
    return await rawFetch(`/league/${encodeURIComponent(String(leagueId))}/rosters`, { ttl: opts.ttl || 0 });
  }

  async function getUsers(leagueId, opts = {}) {
    return await rawFetch(`/league/${encodeURIComponent(String(leagueId))}/users`, { ttl: opts.ttl || 0 });
  }

  async function getMatchupsForWeek(leagueId, week, opts = {}) {
    return await rawFetch(`/league/${encodeURIComponent(String(leagueId))}/matchups/${encodeURIComponent(String(week))}`, { ttl: opts.ttl || 0 });
  }

  // Build roster map with owner enrichment; prefer roster_map endpoint if available
  // returns { rosterIdStr: { roster_id, owner_id, team_name, owner_name, team_avatar, owner_avatar, owner_username, roster_raw, user_raw } }
  async function getRosterMapWithOwners(leagueId, opts = {}) {
    const ttl = opts.ttl || 0;
    const cacheKey = `sleeper:rosterMap:${leagueId}`;
    if (ttl && CACHE && typeof CACHE.get === 'function') {
      const cached = await CACHE.get(cacheKey);
      if (cached) return cached;
    }

    // Try roster map endpoint if exists (some client implementations provide one)
    // We'll attempt direct fetch of rosters + users and build a map
    const [rosters, users] = await Promise.all([
      getRosters(leagueId, opts).catch(() => []),
      getUsers(leagueId, opts).catch(() => [])
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

        // team name heuristics
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

        let teamAvatar = null;
        try { if (r.metadata && r.metadata.team_avatar) { const c = String(r.metadata.team_avatar); teamAvatar = (c.indexOf('http') === 0) ? c : ('https://sleepercdn.com/avatars/' + c); } } catch (e) {}

        let ownerAvatar = null;
        if (uobj) {
          try { if (uobj.metadata && uobj.metadata.team_avatar) ownerAvatar = (String(uobj.metadata.team_avatar).indexOf('http') === 0 ? String(uobj.metadata.team_avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.metadata.team_avatar)); } catch (e) {}
          if (!ownerAvatar) try { if (uobj.metadata && uobj.metadata.avatar) ownerAvatar = (String(uobj.metadata.avatar).indexOf('http') === 0 ? String(uobj.metadata.avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.metadata.avatar)); } catch (e) {}
          if (!ownerAvatar) try { if (uobj.avatar) ownerAvatar = (String(uobj.avatar).indexOf('http') === 0 ? String(uobj.avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.avatar)); } catch (e) {}
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

    if (ttl && CACHE && typeof CACHE.set === 'function') {
      try { await CACHE.set(cacheKey, map, ttl); } catch (e) { /* ignore cache errors */ }
    }

    return map;
  }

  // _extractPlayerPointsMap: returns a map playerId => starterPoints (ONLY starters/starter_points)
  // This intentionally prefers starters_points / starter_points and ignores bench/other aggregated fields.
  function _extractPlayerPointsMap(matchupEntry) {
    // matchupEntry is one team object returned from the matchups endpoint
    // Look for fields: starters_points, startersPoints, starter_points, starters_points_for
    if (!matchupEntry || typeof matchupEntry !== 'object') return {};

    const candidates = matchupEntry.starters_points ?? matchupEntry.startersPoints ?? matchupEntry.starter_points ?? matchupEntry.starters_points_for ?? null;

    // If starters_points is an array, we need to know which players correspond to which value.
    // Some payloads include both 'starters' (array of ids in lineup order) and 'starters_points' (parallel array).
    // Build mapping only when both present.
    const starters = Array.isArray(matchupEntry.starters) ? matchupEntry.starters.slice() : (Array.isArray(matchupEntry.starting_lineup) ? matchupEntry.starting_lineup.slice() : null);

    const out = {};
    if (Array.isArray(candidates) && candidates.length) {
      if (Array.isArray(starters) && starters.length) {
        for (let i = 0; i < starters.length && i < candidates.length; i++) {
          const pid = starters[i];
          try {
            const n = Number(candidates[i]);
            if (!Number.isNaN(n)) out[String(pid)] = n;
          } catch (e) { /* ignore conversion errors */ }
        }
        return out;
      }

      // If no starters array present, but we have starters_points array, try to set keys as numeric indices
      for (let i = 0; i < candidates.length; i++) {
        try {
          const n = Number(candidates[i]);
          if (!Number.isNaN(n)) out[`p_${i}`] = n;
        } catch (e) {}
      }
      return out;
    }

    // If starters_points missing, but we have mapping in 'player_points' keyed by player id, try that
    const altMap = matchupEntry.player_points ?? matchupEntry.player_points_by_id ?? null;
    if (altMap && typeof altMap === 'object') {
      for (const k of Object.keys(altMap)) {
        const v = altMap[k];
        const n = Number(v);
        if (!Number.isNaN(n)) out[String(k)] = n;
      }
      return out;
    }

    // Fallback: use points / points_for for the team as a whole — not per-player —
    // but since the function's purpose is to return per-player starters, prefer empty map instead.
    return out;
  }

  // computeParticipantScore helper - prefers starters_points arrays, falls back to points/points_for
  function _computeScoreFromEntry(entry) {
    if (!entry || typeof entry !== 'object') return 0;
    const safe = v => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const sp = entry.starters_points ?? entry.startersPoints ?? entry.starter_points ?? entry.starters_points_for ?? null;
    if (Array.isArray(sp) && sp.length) {
      return sp.reduce((s, v) => s + safe(v), 0);
    }
    if (typeof sp === 'string') {
      // try parse
      try {
        const parsed = JSON.parse(sp);
        if (Array.isArray(parsed)) return parsed.reduce((s, v) => s + safe(v), 0);
      } catch (e) { /* ignore */ }
    }
    // fallback to team-level points
    return safe(entry.points ?? entry.points_for ?? entry.pts ?? 0);
  }

  // getMatchupScoresForWeek: fetch matchups + build enriched matchup list using starters_points preferentially
  async function getMatchupScoresForWeek(leagueId, week, opts = {}) {
    const ttl = opts.ttl || 0;
    // fetch raw matchups
    const raw = await getMatchupsForWeek(leagueId, week, { ttl }).catch(() => []);
    if (!Array.isArray(raw) || raw.length === 0) return [];

    // roster metadata map
    const rosterMap = await getRosterMapWithOwners(leagueId, { ttl: opts.rosterTtl || 60 * 5 }).catch(() => ({}));

    // Group by matchup key (matchup_id + week or synthetic)
    const groups = {};
    for (let i = 0; i < raw.length; i++) {
      const e = raw[i];
      const mid = e.matchup_id ?? e.matchupId ?? (typeof e.matchup !== 'undefined' ? e.matchup : null);
      const wk = (typeof e.week !== 'undefined' && e.week !== null) ? e.week : week;
      const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    }

    const results = [];
    for (const key of Object.keys(groups)) {
      const entries = groups[key];
      if (!entries || entries.length === 0) continue;

      const sampleMid = entries[0].matchup_id ?? entries[0].matchupId ?? entries[0].matchup ?? null;
      const wkSample = entries[0].week ?? week;

      const participants = entries.map(en => {
        const roster_id_raw = en.roster_id ?? en.rosterId ?? en.owner_id ?? en.ownerId ?? null;
        const roster_id = roster_id_raw != null ? String(roster_id_raw) : null;
        const owner_id_raw = en.owner_id ?? en.ownerId ?? null;
        const owner_id = owner_id_raw != null ? String(owner_id_raw) : null;

        const score = _computeScoreFromEntry(en);

        let meta = null;
        if (roster_id && rosterMap && rosterMap[String(roster_id)]) meta = rosterMap[String(roster_id)];
        else if (owner_id && rosterMap) {
          // fallback: find roster by owner id if possible
          for (const rk of Object.keys(rosterMap)) {
            const rmeta = rosterMap[rk];
            if (rmeta && rmeta.owner_id && String(rmeta.owner_id) === String(owner_id)) { meta = rmeta; break; }
          }
        }

        return {
          roster_id,
          owner_id,
          matchup_id: sampleMid != null ? String(sampleMid) : key,
          starters: Array.isArray(en.starters) ? en.starters.slice() : (Array.isArray(en.starting_lineup) ? en.starting_lineup.slice() : null),
          starters_points: Array.isArray(en.starters_points) ? en.starters_points.slice() : (Array.isArray(en.startersPoints) ? en.startersPoints.slice() : (Array.isArray(en.starter_points) ? en.starter_points.slice() : null)),
          score,
          team_name: meta ? meta.team_name : (en.team_name ?? en.team ?? null),
          owner_name: meta ? meta.owner_name : (en.owner_name ?? en.owner ?? null),
          owner_username: meta ? meta.owner_username : (en.owner_username ?? null),
          team_avatar: meta ? meta.team_avatar : (en.team_avatar ?? null),
          owner_avatar: meta ? meta.owner_avatar : (en.owner_avatar ?? null),
          raw: en
        };
      });

      // compute winners / losers / tie
      let maxScore = -Infinity, minScore = Infinity;
      for (const p of participants) {
        if (typeof p.score === 'number') {
          if (p.score > maxScore) maxScore = p.score;
          if (p.score < minScore) minScore = p.score;
        }
      }

      const winners = participants.filter(p => Math.abs(p.score - maxScore) <= 1e-9).map(p => p.roster_id).filter(Boolean);
      const losers = participants.filter(p => Math.abs(p.score - maxScore) > 1e-9).map(p => p.roster_id).filter(Boolean);
      const tie = winners.length > 1 && participants.length > 1 && Math.abs(maxScore - minScore) <= 1e-9;

      results.push({
        matchup_id: sampleMid != null ? String(sampleMid) : key,
        week: wkSample,
        participants,
        winners,
        losers,
        tie
      });
    }

    return results;
  }

  // expose the client API
  return {
    rawFetch,
    getLeague,
    getRosters,
    getUsers,
    getMatchupsForWeek,
    getRosterMapWithOwners,
    getMatchupScoresForWeek,
    _extractPlayerPointsMap // exported for backward-compatibility/tests
  };
}
