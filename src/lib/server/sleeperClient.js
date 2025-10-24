/**
 * getMatchupScoresForWeek(clientOrRawFetch, leagueId, week, opts = {})
 *
 * - clientOrRawFetch: either a sleeper client object (with getMatchupsForWeek, getRosterMapWithOwners)
 *                     or a rawFetch function that accepts a path and returns parsed JSON.
 * - leagueId: string|number
 * - week: number
 * - opts: { ttl: number } optional (passed to client methods where supported)
 *
 * Returns: Promise<Array<{
 *   matchup_id: string,
 *   week: number,
 *   participants: Array<{
 *     roster_id: string|null,
 *     owner_id: string|null,
 *     team_name: string|null,
 *     owner_name: string|null,
 *     team_avatar: string|null,
 *     owner_avatar: string|null,
 *     owner_username: string|null,
 *     starters: array|null,
 *     starters_points: array|null,
 *     score: number,
 *     matchup_id: string
 *     raw: object
 *   }>,
 *   winners: string[], // roster_id(s)
 *   losers: string[],
 *   tie: boolean
 * }>>
 */
export async function getMatchupScoresForWeek(clientOrRawFetch, leagueId, week, opts = {}) {
  const safeNum = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // --- Fetch matchups helper ---
  async function fetchMatchups() {
    // If client has getMatchupsForWeek, use it
    if (clientOrRawFetch && typeof clientOrRawFetch.getMatchupsForWeek === 'function') {
      return await clientOrRawFetch.getMatchupsForWeek(String(leagueId), Number(week), opts);
    }

    // If clientOrRawFetch is a function, call as rawFetch(path)
    if (typeof clientOrRawFetch === 'function') {
      return await clientOrRawFetch(`/league/${encodeURIComponent(String(leagueId))}/matchups/${encodeURIComponent(String(week))}`);
    }

    // Final fallback: global fetch (server)
    if (typeof fetch === 'function') {
      const url = `https://api.sleeper.app/v1/league/${encodeURIComponent(String(leagueId))}/matchups/${encodeURIComponent(String(week))}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Sleeper matchups fetch failed: ${res.status}`);
      return await res.json();
    }

    throw new Error('No fetch method available for retrieving matchups.');
  }

  // --- Build rosterMap helper ---
  // Returns: { [roster_id]: { roster_id, owner_id, team_name, owner_name, team_avatar, owner_avatar, owner_username, roster_raw, user_raw } }
  async function getRosterMap() {
    // If client provides getRosterMapWithOwners, use it (preferred)
    if (clientOrRawFetch && typeof clientOrRawFetch.getRosterMapWithOwners === 'function') {
      try {
        return await clientOrRawFetch.getRosterMapWithOwners(String(leagueId), opts);
      } catch (e) {
        // fallback to manual building
      }
    }

    // If client offers getRosters & getUsers, use those
    if (clientOrRawFetch && typeof clientOrRawFetch.getRosters === 'function' && typeof clientOrRawFetch.getUsers === 'function') {
      try {
        const [rosters, users] = await Promise.all([
          clientOrRawFetch.getRosters(String(leagueId), opts),
          clientOrRawFetch.getUsers(String(leagueId), opts)
        ]);
        return buildRosterMapFromArrays(rosters, users);
      } catch (e) {
        // continue to rawFetch path
      }
    }

    // If we have a rawFetch function, use it to fetch rosters+users
    if (typeof clientOrRawFetch === 'function') {
      try {
        const [rosters, users] = await Promise.all([
          clientOrRawFetch(`/league/${encodeURIComponent(String(leagueId))}/rosters`),
          clientOrRawFetch(`/league/${encodeURIComponent(String(leagueId))}/users`)
        ]);
        return buildRosterMapFromArrays(rosters, users);
      } catch (e) {
        // ignore and try global fetch below
      }
    }

    // Last fallback: use global fetch if available
    if (typeof fetch === 'function') {
      try {
        const [rRes, uRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${encodeURIComponent(String(leagueId))}/rosters`),
          fetch(`https://api.sleeper.app/v1/league/${encodeURIComponent(String(leagueId))}/users`)
        ]);
        const rosters = rRes.ok ? await rRes.json() : [];
        const users = uRes.ok ? await uRes.json() : [];
        return buildRosterMapFromArrays(rosters, users);
      } catch (e) {
        // final fallback: empty map
      }
    }

    return {};
  }

  function buildRosterMapFromArrays(rosters, users) {
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
        try { if (r.metadata && r.metadata.team_name) teamName = r.metadata.team_name; } catch(e){}
        if (!teamName && uobj) {
          try {
            if (uobj.metadata && uobj.metadata.team_name) teamName = uobj.metadata.team_name;
            else if (uobj.display_name) teamName = `${uobj.display_name}'s Team`;
            else if (uobj.username) teamName = `${uobj.username}'s Team`;
          } catch(e){}
        }
        if (!teamName) teamName = 'Roster ' + String(rid);

        let teamAvatar = null;
        try { if (r.metadata && r.metadata.team_avatar) { const c = String(r.metadata.team_avatar); teamAvatar = (c.indexOf('http') === 0) ? c : ('https://sleepercdn.com/avatars/' + c); } } catch(e){}

        let ownerAvatar = null;
        if (uobj) {
          try { if (uobj.metadata && uobj.metadata.team_avatar) ownerAvatar = (String(uobj.metadata.team_avatar).indexOf('http') === 0 ? String(uobj.metadata.team_avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.metadata.team_avatar)); } catch(e){}
          if (!ownerAvatar) try { if (uobj.metadata && uobj.metadata.avatar) ownerAvatar = (String(uobj.metadata.avatar).indexOf('http') === 0 ? String(uobj.metadata.avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.metadata.avatar)); } catch(e){}
          if (!ownerAvatar) try { if (uobj.avatar) ownerAvatar = (String(uobj.avatar).indexOf('http') === 0 ? String(uobj.avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.avatar)); } catch(e){}
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

  // --- Compute score helper (prefers starters_points) ---
  function computeParticipantScore(entry) {
    const sp = entry.starters_points ?? entry.startersPoints ?? entry.starters_points_for ?? entry.starter_points;
    if (Array.isArray(sp) && sp.length) {
      return sp.reduce((s, v) => s + safeNum(v), 0);
    }
    if (typeof sp === 'string') {
      try {
        const parsed = JSON.parse(sp);
        if (Array.isArray(parsed)) return parsed.reduce((s, v) => s + safeNum(v), 0);
      } catch (e) { /* ignore */ }
    }
    return safeNum(entry.points ?? entry.points_for ?? entry.pts ?? 0);
  }

  // --- Main flow ---
  const rawMatchups = await fetchMatchups();
  if (!Array.isArray(rawMatchups) || rawMatchups.length === 0) return [];

  const rosterMap = await getRosterMap(); // may be empty object

  // group by matchup key (use matchup_id + week when available; else synthetic)
  const groups = {};
  for (let i = 0; i < rawMatchups.length; i++) {
    const e = rawMatchups[i];
    const mid = (e.matchup_id ?? e.matchupId ?? (typeof e.matchup !== 'undefined' ? e.matchup : null));
    const wk = (typeof e.week !== 'undefined' && e.week !== null) ? e.week : week;
    const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }

  const results = [];

  for (const key of Object.keys(groups)) {
    const entries = groups[key];
    if (!entries || entries.length === 0) continue;

    // pick a sample matchup_id if present
    const sampleMid = entries[0].matchup_id ?? entries[0].matchupId ?? entries[0].matchup ?? null;
    const wkSample = entries[0].week ?? week;

    const participants = entries.map(en => {
      const roster_id_raw = en.roster_id ?? en.rosterId ?? en.owner_id ?? en.ownerId ?? null;
      const roster_id = roster_id_raw != null ? String(roster_id_raw) : null;
      const owner_id_raw = en.owner_id ?? en.ownerId ?? null;
      const owner_id = owner_id_raw != null ? String(owner_id_raw) : null;

      // compute score
      const score = computeParticipantScore(en);

      // attempt to get metadata from rosterMap
      let meta = null;
      if (roster_id && rosterMap && rosterMap[String(roster_id)]) {
        meta = rosterMap[String(roster_id)];
      } else if (owner_id && rosterMap) {
        // try to find the roster by owner_id (fallback)
        for (const rk of Object.keys(rosterMap)) {
          const rmeta = rosterMap[rk];
          if (rmeta && rmeta.owner_id && String(rmeta.owner_id) === String(owner_id)) { meta = rmeta; break; }
        }
      }

      return {
        roster_id,
        owner_id,
        matchup_id: sampleMid != null ? String(sampleMid) : key,
        // raw starter fields if present
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

    // compute winners/losers
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
