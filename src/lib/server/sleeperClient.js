// Utility: safe number conversion
export function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// Utility: compute win/loss streaks
export function computeStreaks(resultsArray) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  if (!resultsArray || !Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
  for (let i = 0; i < resultsArray.length; i++) {
    const r = resultsArray[i];
    if (r === 'W') {
      curW += 1;
      curL = 0;
      if (curW > maxW) maxW = curW;
    } else if (r === 'L') {
      curL += 1;
      curW = 0;
      if (curL > maxL) maxL = curL;
    } else {
      curW = 0;
      curL = 0;
    }
  }
  return { maxW, maxL };
}

// Main Honor Hall data builder (extracted from +page.server.js)
export async function getHonorHallData({
  sleeper,
  BASE_LEAGUE_ID,
  selectedSeasonParam,
  MAX_WEEKS,
  messages = [],
  prevChain = []
}) {
  let seasons = [];
  let mainLeague = null;
  try {
    mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 });
  } catch (e) {
    messages.push('Failed fetching base league ' + BASE_LEAGUE_ID + ' — ' + (e && e.message ? e.message : String(e)));
  }
  if (mainLeague) {
    seasons.push({
      league_id: String(mainLeague.league_id || BASE_LEAGUE_ID),
      season: mainLeague.season ?? null,
      name: mainLeague.name ?? null
    });
    let currPrev = mainLeague.previous_league_id || mainLeague.previousLeagueId || null;
    let steps = 0;
    while (currPrev && steps < 50) {
      let prev = null;
      try {
        prev = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
      } catch (e) {
        messages.push('Failed fetching previous league ' + currPrev + ' — ' + (e && e.message ? e.message : String(e)));
        break;
      }
      if (!prev) break;
      seasons.push({
        league_id: String(prev.league_id || currPrev),
        season: prev.season ?? null,
        name: prev.name ?? null
      });
      currPrev = prev.previous_league_id || prev.previousLeagueId || null;
      steps++;
    }
  }
  // fallback: always include base league if fetch fails or error
  if (!seasons.length) {
    seasons.push({
      league_id: String(BASE_LEAGUE_ID),
      season: null,
      name: null
    });
  }
  // dedupe
  const byId = {};
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = Object.values(byId);
  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return nb - na;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });
  let selSeason = selectedSeasonParam;
  if (!selSeason) {
    if (seasons && seasons.length) {
      selSeason = seasons[0].season ?? seasons[0].league_id;
    } else {
      selSeason = BASE_LEAGUE_ID;
    }
  }
            name: prevLeague.name ?? null
          });
          prevChain.push(String(prevLeague.league_id || currPrev));
          currPrev = prevLeague.previous_league_id ? String(prevLeague.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err && err.message ? err.message : String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error while building seasons chain: ' + (err && err.message ? err.message : String(err)));
  }
  // dedupe
  const byId = {};
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);
  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });
  let selSeason = selectedSeasonParam;
  if (!selSeason) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selSeason = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selSeason = String(BASE_LEAGUE_ID);
    }
  }
  let selectedLeagueId = null;
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selSeason) || (s.season != null && String(s.season) === String(selSeason))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selSeason || BASE_LEAGUE_ID);
  let leagueMeta = null;
  try { leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }); }
  catch (e) { leagueMeta = null; messages.push('Failed fetching league meta for ' + selectedLeagueId + ' — ' + (e?.message ?? e)); }
  let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : null;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
    playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      playoffStart = 15;
      messages.push('Playoff start not found in metadata — defaulting to week ' + playoffStart);
    }
  }
  const playoffEnd = playoffStart + 2;
  // roster map
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
  } catch (e) {
    rosterMap = {};
    messages.push('Failed fetching rosters for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }
  // --- compute regular-season standings (for tiebreaks) ---
  // ...existing code from +page.server.js for regular season, playoffs, and standings...
  // For brevity, you can move the rest of the logic as a direct copy from +page.server.js
  // and return the same object as before.
}
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
  const next = () => {
    if (!queue.length) return;
    if (active >= maxConcurrency) return;
    active++;
    const fn = queue.shift();
    fn().then(() => { active--; next(); }).catch(() => { active--; next(); });
  };
  return (fn) => {
    return new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          const res = await fn();
          resolve(res);
        } catch (e) {
          reject(e);
        }
      });
      next();
    });
  };
}

// Retry wrapper (simple exponential backoff)
async function retryFetch(url, opts = {}, retries = 3, baseDelay = 200) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) {
        let bodyText = '';
        try { bodyText = await res.text(); } catch (e) {}
        const err = new Error(`HTTP ${res.status} ${res.statusText} - ${url}: ${bodyText}`);
        err.status = res.status;
        throw err;
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.indexOf('application/json') !== -1) return await res.json();
      return await res.text();
    } catch (err) {
      lastErr = err;
      await sleep(baseDelay * Math.pow(2, i));
    }
  }
  throw lastErr;
}

export function createSleeperClient(opts = {}) {
  const {
    baseUrl = 'https://api.sleeper.app/v1',
    cache = null,
    concurrency = 6,
    ttl = 60 * 60 // 1 hour default
  } = opts || {};

  const limit = createLimiter(concurrency);

  // cached GET helper
  async function cachedGet(pathOrUrl, opts = {}) {
    const fullUrl = String(pathOrUrl).startsWith('http') ? String(pathOrUrl) : `${baseUrl}${pathOrUrl}`;
    const key = `sleeper:${fullUrl}`;
    const useCache = opts.cache !== false && !!cache;
    const localTtl = opts.ttl != null ? opts.ttl : ttl;

    if (useCache && cache && cache.get) {
      try {
        const raw = await cache.get(key);
        if (raw) {
          try { return JSON.parse(raw); } catch (e) { return raw; }
        }
      } catch (e) {
        // ignore cache errors
      }
    }

    const data = await limit(() => retryFetch(fullUrl, { method: 'GET' }));
    if (cache) {
      try {
        await cache.set(key, JSON.stringify(data), localTtl);
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

  function _makeAvatarUrl(candidate) {
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
   */
  async function getRostersWithOwners(leagueId, opts = {}) {
    const ttl = opts.ttl ?? 3600;
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
    if (Array.isArray(rosters)) {
      for (const r of rosters) {
        const rosterId = r.roster_id != null ? String(r.roster_id) : (r.rosterId != null ? String(r.rosterId) : null);
        const ownerId = r.owner_id != null ? String(r.owner_id) : (r.ownerId != null ? String(r.ownerId) : null);
        // Resolve team name (improved fallbacks)
        let teamName = null;
        if (r && r.metadata) teamName = r.metadata.team_name ?? r.metadata.teamName ?? r.metadata.name ?? teamName;
        // prefer explicit roster fields
        teamName = teamName ?? (r.team_name || r.name || (r.settings && (r.settings.team_name || r.settings.name)) || null);
        const userObj = ownerId != null ? usersById[String(ownerId)] : null;
        if (!teamName && userObj) {
        if (userObj.metadata) teamName = userObj.metadata.team_name ?? userObj.metadata.teamName ?? userObj.metadata.name ?? teamName;
        if (!teamName) {
          if (userObj.display_name) teamName = userObj.display_name + "'s Team";
          else if (userObj.username) teamName = userObj.username + "'s Team";
        }
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
    }

    return out;
  }

  /**
   * Map variant: returns { rosterId: enrichedObj } for quick lookup.
   */
  async function getRosterMapWithOwners(leagueId, opts = {}) {
    const arr = await getRostersWithOwners(leagueId, opts);
    const map = {};
    if (Array.isArray(arr)) {
      for (const r of arr) {
        if (r && r.roster_id != null) map[String(r.roster_id)] = r;
      }
    }
    return map;
  }

  /**
   * Helper: extract a mapping of playerId -> points and list of starters from a participant/matchup object.
   * Best-effort to handle different shapes returned by Sleeper endpoints.
   */
  function _extractPlayerPointsMap(participant) {
    const safeNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const pp = participant.player_points ?? participant.playerPoints ?? participant.player_points_for ?? participant.player_points_for ?? null;
    const playersList = participant.players ?? participant.player_ids ?? participant.playerIds ?? participant.player_ids_list ?? null;
    // starters_points may be an array aligned with starters
    const startersPoints = participant.starters_points ?? participant.startersPoints ?? participant.starters_points_for ?? participant.starters_points_for ?? null;
    const starters = participant.starters ?? participant.starting_lineup ?? participant.starters_list ?? participant.startersList ?? null;

    const map = {};
    // If player_points is an object mapping pid -> { points } or number
    if (pp && typeof pp === 'object' && !Array.isArray(pp)) {
      for (const [k, v] of Object.entries(pp)) {
        if (v == null) continue;
        if (typeof v === 'object') {
          map[String(k)] = safeNum(v.points ?? v.pts ?? v.p ?? 0);
        } else {
          map[String(k)] = safeNum(v);
        }
      }
    }

    // If startersPoints + starters arrays are available, align them
    if (Array.isArray(starters) && Array.isArray(startersPoints) && starters.length === startersPoints.length) {
      for (let i = 0; i < starters.length; i++) {
        const pid = starters[i];
        if (pid == null) continue;
        map[String(pid)] = safeNum(startersPoints[i]);
      }
    }

    // If playersList exists and pp is an array aligned, align them
    if (Array.isArray(playersList) && Array.isArray(pp) && playersList.length === pp.length) {
      for (let i = 0; i < playersList.length; i++) {
        const pid = playersList[i];
        const v = pp[i];
        if (pid == null) continue;
        if (v == null) continue;
        if (typeof v === 'object') map[String(pid)] = safeNum(v.points ?? v.pts ?? 0);
        else map[String(pid)] = safeNum(v);
      }
    }

    return { map, starters: Array.isArray(starters) ? starters.map(s => String(s)) : [] };
  }

  /**
   * Compute the Finals MVP with richer output: player name, team, roster/owner who started them, and sanity checks.
   * The player must be a starter in the championship matchup.
   *
   * Parameters:
   * - leagueId (string)
   * - opts: { season, maxWeek (default 30), championshipWeek (optional), playersEndpoint (optional, default '/players/nba') }
   *
   * Returns: {
   *   playerId, playerName, playerTeam, points, week, matchupId,
   *   rosterId, rosterName, ownerId, ownerName,
   *   sanity: { playerFound, starterFound, playersEndpointChecked },
   *   playerObj
   * }
   */
  async function getFinalsMVP(leagueId, opts = {}) {
    const { season = null, maxWeek = 30, championshipWeek = null, playersEndpoint = '/players/nba' } = opts || {};
    const playersMapPromise = rawFetch(playersEndpoint).catch(() => ({}));
    const rosterMapPromise = getRosterMapWithOwners(leagueId).catch(() => ({}));

   const findFinalWeek = async () => {
  // Try to determine playoff start from league settings (Honor Hall logic)
  let playoffStart = null;
  try {
    const leagueMeta = await getLeague(leagueId).catch(() => null);
    if (leagueMeta && leagueMeta.settings) {
      playoffStart = leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek ?? null;
      if (!playoffStart) playoffStart = leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start ?? null;
    }
  } catch (e) {
    playoffStart = null;
  }
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
    // default to Honor Hall fallback
    playoffStart = 15;
  }
  const championshipWeek = Number(playoffStart) + 2;

  // Attempt to load the championship matchup directly for the computed week
  try {
    const rows = await getMatchupsForWeek(leagueId, championshipWeek);
    if (Array.isArray(rows) && rows.length) {
      // group by matchup identifier
      const groups = {};
      for (const r of rows) {
        const key = r.matchup_id ?? r.matchup ?? r.matchupId ?? String(r.id ?? (r.roster_id ?? Math.random()));
        groups[key] = groups[key] || [];
        groups[key].push(r);
      }
      // find a head-to-head group with 2 participants
      for (const [k, g] of Object.entries(groups)) {
        if (g.length === 2) return { week: championshipWeek, matchup: g };
      }
    }
  } catch (e) {
    // ignore and fall back
  }

  // Fallback: scan weeks from maxWeek downwards and pick first head-to-head with 2 participants
  for (let wk = maxWeek; wk >= 1; wk--) {
    let rows;
    try { rows = await getMatchupsForWeek(leagueId, wk); } catch (e) { continue; }
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const groups = {};
    for (const r of rows) {
      let key = r.matchup_id ?? r.matchup ?? r.matchupId ?? null;
      if (key == null) {
        key = (function(){
          const rid = r.roster_id ?? r.rosterId ?? r.roster ?? null;
          const opp = r.opponent_id ?? r.opponentId ?? r.opponent ?? r.opponent_roster_id ?? null;
          if (rid != null && opp != null) return [String(rid), String(opp)].sort().join('-');
          return 'idx-'+String(r.id ?? (r.roster_id ?? Math.random())).slice(0,8);
        })();
      }
      groups[key] = groups[key] || [];
      groups[key].push(r);
    }
    for (const [k, g] of Object.entries(groups)) {
      if (g.length === 2) return { week: wk, matchup: g };
    }
  }
  return null;
};


    const finalMatch = await findFinalWeek();
    if (!finalMatch || !finalMatch.matchup) return null;
    const week = finalMatch.week;
    const participants = finalMatch.matchup;

    const playersMap = await playersMapPromise;
    const rosterMap = await rosterMapPromise;

    let best = null;
    for (const part of participants) {
      const rosterId = String(part.roster_id ?? part.rosterId ?? part.roster ?? (part.roster_id == null ? (part.rosterId ?? null) : null) ?? '');
      const rosterEntry = (rosterMap && rosterMap[rosterId]) || null;
      const ownerId = rosterEntry ? rosterEntry.owner_id : (part.owner_id ?? part.ownerId ?? null);
      const ownerName = rosterEntry ? rosterEntry.owner_name : null;
      const rosterName = rosterEntry ? rosterEntry.team_name : null;

      const { map: pmap, starters } = _extractPlayerPointsMap(part);
      for (const s of starters) {
        const pid = String(s);
        const pts = Number(pmap[pid] ?? 0);
        const playerObj = playersMap[pid] || playersMap[pid.toUpperCase()] || null;
        const playerName = playerObj ? (playerObj.full_name || (playerObj.first_name && playerObj.last_name ? (playerObj.first_name + ' ' + playerObj.last_name) : (playerObj.name || null))) : null;
        const playerTeam = playerObj ? (playerObj.team ?? playerObj.team_id ?? playerObj.teamCode ?? null) : null;

        const sanity = {
          playerFound: !!playerObj,
          starterFound: true,
          playersEndpointChecked: !!playersMap
        };

        if (!best || pts > best.points) {
          best = {
            playerId: pid,
            playerName,
            playerTeam,
            points: pts,
            week,
            matchupId: part.matchup_id ?? part.matchup ?? null,
            rosterId,
            rosterName,
            ownerId,
            ownerName,
            sanity,
            playerObj
          };
        }
      }
    }

    return best;
  }

  /**
   * Compute the Overall MVP for a season with richer output:
   * - player who scored the most AS A STARTER across the season
   * - identifies the roster/owner that contributed the most starter points for that player
   *
   * Parameters:
   * - leagueId
   * - opts: { season, maxWeek = 30, playersEndpoint = '/players/nba' }
   *
   * Returns:
   * {
   *   playerId, playerName, playerTeam, points,
   *   topRosterId, topRosterName, topOwnerId, topOwnerName,
   *   weeksCounted, sanity: { playersEndpointChecked, weeksWithData },
   *   playerObj
   * }
   */
  async function getOverallMVP(leagueId, opts = {}) {
    const { season = null, maxWeek = 30, playersEndpoint = '/players/nba' } = opts || {};
    const totals = {}; // pid -> total starter points
    const perRoster = {}; // pid -> { rosterId -> points }
    const playersMapPromise = rawFetch(playersEndpoint).catch(() => ({}));
    const rosterMapPromise = getRosterMapWithOwners(leagueId).catch(() => ({}));

    let weeksWithData = 0;
    for (let wk = 1; wk <= maxWeek; wk++) {
      let rows;
      try { rows = await getMatchupsForWeek(leagueId, wk); } catch (e) { continue; }
      if (!Array.isArray(rows) || rows.length === 0) continue;
      weeksWithData++;
      for (const part of rows) {
        const rosterId = String(part.roster_id ?? part.rosterId ?? part.roster ?? '');
        const { map: pmap, starters } = _extractPlayerPointsMap(part);
        for (const s of starters) {
          const pid = String(s);
          const pts = Number(pmap[pid] ?? 0);
          totals[pid] = (totals[pid] || 0) + Number(pts || 0);
          perRoster[pid] = perRoster[pid] || {};
          perRoster[pid][rosterId] = (perRoster[pid][rosterId] || 0) + Number(pts || 0);
        }
      }
    }

    let best = null;
    for (const [pid, pts] of Object.entries(totals)) {
      if (!best || pts > best.points) best = { playerId: pid, points: pts };
    }
    if (!best) {
      return { message: 'No starter scoring data found', weeksCounted: weeksWithData, sanity: { playersEndpointChecked: false, weeksWithData } };
    }

    const playersMap = await playersMapPromise;
    const rosterMap = await rosterMapPromise;
    const playerObj = playersMap[best.playerId] || playersMap[best.playerId.toUpperCase()] || null;
    const playerName = playerObj ? (playerObj.full_name || (playerObj.first_name && playerObj.last_name ? (playerObj.first_name + ' ' + playerObj.last_name) : (playerObj.name || null))) : null;
    const playerTeam = playerObj ? (playerObj.team ?? playerObj.team_id ?? playerObj.teamCode ?? null) : null;

    // pick the roster that contributed the most starter points to this player
    const rosterPoints = perRoster[best.playerId] || {};
    let topRosterId = null, topRosterPts = 0;
    for (const [rid, rpts] of Object.entries(rosterPoints)) {
      if (topRosterId === null || rpts > topRosterPts) {
        topRosterId = rid;
        topRosterPts = rpts;
      }
    }
    const topRosterEntry = (rosterMap && rosterMap[topRosterId]) || null;
    const topRosterName = topRosterEntry ? topRosterEntry.team_name : null;
    const topOwnerId = topRosterEntry ? topRosterEntry.owner_id : null;
    const topOwnerName = topRosterEntry ? topRosterEntry.owner_name : null;

    return {
      playerId: best.playerId,
      playerName,
      playerTeam,
      points: best.points,
      topRosterId,
      topRosterName,
      topOwnerId,
      topOwnerName,
      weeksCounted: weeksWithData,
      sanity: { playersEndpointChecked: !!playersMap, weeksWithData },
      playerObj
    };
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
    getFinalsMVP,
    getOverallMVP,
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
