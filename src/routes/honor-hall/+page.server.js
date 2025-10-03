// src/routes/honor-hall/+page.server.js
/**
 * Server load for Honor Hall (playoff view).
 * - BASE_LEAGUE_ID is hardcoded to 1219816671624048640
 * - Accepts ?season=YYYY (defaults to current year)
 * - Fetches league metadata, rosters, users, and matchups for playoff weeks
 * - Returns { seasons, selectedSeason, playoffWeeks, matchupsRows, rosterMap, errors }
 *
 * Notes:
 * - This attempts to read playoff_start week from the league object. If not present,
 *   it falls back to common week 23.
 * - Endpoints:
 *   GET https://api.sleeper.app/v1/league/{league_id}
 *   GET https://api.sleeper.app/v1/league/{league_id}/rosters
 *   GET https://api.sleeper.app/v1/league/{league_id}/users
 *   GET https://api.sleeper.app/v1/league/{league_id}/matchups/{week}
 */

export async function load({ fetch, url }) {
  const errors = [];

  // Hardcoded league id per request:
  const BASE_LEAGUE_ID = '1219816671624048640';

  const selectedSeason = url.searchParams.get('season') ?? String(new Date().getFullYear());

  if (!BASE_LEAGUE_ID) {
    errors.push('BASE_LEAGUE_ID not set — cannot fetch league data.');
    return {
      seasons: [selectedSeason],
      selectedSeason,
      playoffWeeks: [],
      matchupsRows: [],
      rosterMap: {},
      errors
    };
  }

  // helper to fetch and parse JSON with error handling
  async function safeFetchJson(urlStr, opts = {}) {
    try {
      const res = await fetch(urlStr, opts);
      if (!res.ok) {
        return { ok: false, status: res.status, statusText: res.statusText, body: null };
      }
      const body = await res.json();
      return { ok: true, status: 200, body };
    } catch (e) {
      return { ok: false, status: 0, statusText: String(e), body: null };
    }
  }

  // 1) fetch league metadata (used to detect playoff_week_start when available)
  const leagueUrl = `https://api.sleeper.app/v1/league/${BASE_LEAGUE_ID}`;
  const leagueRes = await safeFetchJson(leagueUrl);
  let league = null;
  if (leagueRes.ok) {
    league = leagueRes.body;
  } else {
    errors.push(`Failed fetching league metadata for ${BASE_LEAGUE_ID}: ${leagueRes.status} ${leagueRes.statusText}`);
  }

  // derive playoff start week
  let playoffStart = null;
  try {
    playoffStart = league?.settings?.playoff_week_start ?? league?.playoff_week_start ?? league?.metadata?.playoff_week_start ?? null;
    if (playoffStart != null) playoffStart = Number(playoffStart);
  } catch (e) {
    playoffStart = null;
  }

  // fallback weeks if we couldn't detect
  const fallbackStart = 23;
  const ws = playoffStart && Number.isFinite(playoffStart) ? playoffStart : fallbackStart;
  const playoffWeeks = [ws, ws + 1, ws + 2];

  // 2) fetch rosters + users so we can map roster_id -> display_name and avatar
  const rostersUrl = `https://api.sleeper.app/v1/league/${BASE_LEAGUE_ID}/rosters`;
  const usersUrl = `https://api.sleeper.app/v1/league/${BASE_LEAGUE_ID}/users`;

  const [rostersRes, usersRes] = await Promise.all([safeFetchJson(rostersUrl), safeFetchJson(usersUrl)]);
  let rosters = [];
  let users = [];

  if (rostersRes.ok) rosters = Array.isArray(rostersRes.body) ? rostersRes.body : [];
  else errors.push(`Failed fetching rosters: ${rostersRes.status} ${rostersRes.statusText}`);

  if (usersRes.ok) users = Array.isArray(usersRes.body) ? usersRes.body : [];
  else errors.push(`Failed fetching users: ${usersRes.status} ${usersRes.statusText}`);

  // build rosterMap: roster_id -> { roster_id, owner_id, display_name, avatar }
  const userMap = {};
  for (const u of users) {
    if (!u) continue;
    userMap[String(u.user_id ?? u.id ?? '')] = {
      user_id: u.user_id ?? u.id,
      display_name: u.display_name ?? u.username ?? u.name ?? null,
      avatar: u.avatar ?? u.photo_url ?? null
    };
  }

  const rosterMap = {};
  for (const r of rosters) {
    if (!r) continue;
    const rid = String(r.roster_id ?? r.id ?? r.roster ?? '');
    const ownerId = r.owner_id ?? r.user_id ?? r.owner ?? null;
    const owner = ownerId ? userMap[String(ownerId)] : null;
    rosterMap[rid] = {
      roster_id: rid,
      owner_id: ownerId,
      display_name: owner?.display_name ?? r.settings?.team_name ?? r.name ?? r.metadata?.team_name ?? null,
      avatar: owner?.avatar ?? r.settings?.team_logo ?? r.metadata?.logo ?? null,
      settings: r.settings ?? null
    };
  }

  // 3) fetch matchups for each playoff week and flatten into rows
  const allMatchupsRows = [];
  for (const week of playoffWeeks) {
    const mUrl = `https://api.sleeper.app/v1/league/${BASE_LEAGUE_ID}/matchups/${week}`;
    const mRes = await safeFetchJson(mUrl);
    if (!mRes.ok) {
      errors.push(`Failed to fetch matchups for week ${week}: ${mRes.status} ${mRes.statusText}`);
      continue;
    }
    const arr = Array.isArray(mRes.body) ? mRes.body : [];
    if (!arr.length) continue;

    // group by matchup_id (or fallback to pair-up by index if absent)
    const groups = new Map();
    arr.forEach((entry, idx) => {
      const mid = entry.matchup_id ?? entry.matchup ?? entry.matchupId ?? null;
      if (mid != null) {
        const key = String(mid);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ entry, idx });
      } else {
        // fallback: bucket by Math.floor(idx/2)
        const key = `i${Math.floor(idx / 2)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ entry, idx });
      }
    });

    // transform each group into a unified matchup row: { week, matchup_id, teamA:{...}, teamB:{...} }
    for (const [key, members] of groups.entries()) {
      if (!members || members.length === 0) continue;

      let teamA = null;
      let teamB = null;

      if (members.length === 1) {
        const e = members[0].entry;
        const rosterId = String(e.roster_id ?? e.roster ?? e.rosterId ?? '');
        const owner = rosterMap[rosterId] ?? null;
        teamA = {
          roster_id: rosterId || null,
          name: owner?.display_name ?? e.display_name ?? e.owner_display ?? null,
          avatar: owner?.avatar ?? null,
          points: e.points ?? e.score ?? e.total_points ?? e.starters_points ?? null,
          placement: e.placement ?? e.seed ?? null
        };
        teamB = { roster_id: null, name: null, avatar: null, points: null, placement: null };
      } else {
        const e0 = members[0].entry;
        const e1 = members[1].entry;
        const r0 = String(e0.roster_id ?? e0.roster ?? e0.rosterId ?? '');
        const r1 = String(e1.roster_id ?? e1.roster ?? e1.rosterId ?? '');

        const owner0 = rosterMap[r0] ?? null;
        const owner1 = rosterMap[r1] ?? null;

        teamA = {
          roster_id: r0 || null,
          name: owner0?.display_name ?? e0.display_name ?? e0.owner_display ?? null,
          avatar: owner0?.avatar ?? null,
          points: e0.points ?? e0.score ?? e0.total_points ?? null,
          placement: e0.placement ?? e0.seed ?? null
        };

        teamB = {
          roster_id: r1 || null,
          name: owner1?.display_name ?? e1.display_name ?? e1.owner_display ?? null,
          avatar: owner1?.avatar ?? null,
          points: e1.points ?? e1.score ?? e1.total_points ?? null,
          placement: e1.placement ?? e1.seed ?? null
        };
      }

      allMatchupsRows.push({
        week,
        matchup_key: key,
        matchup_id: (members[0]?.entry?.matchup_id ?? members[0]?.entry?.matchup ?? null),
        teamA,
        teamB,
        raw: members.map(m => m.entry)
      });
    }
  }

  // The UI expects a flattened matchupsRows array; we also provide a rosterMap for display lookups.
  return {
    seasons: [selectedSeason],
    selectedSeason,
    playoffWeeks,
    matchupsRows: allMatchupsRows,
    rosterMap,
    league,
    errors
  };
}
