// src/routes/honor-hall/+page.server.js
// Server-side loader for Honor Hall (playoff matchups).
// Uses server `fetch` to call Sleeper endpoints and returns:
// { seasons, selectedSeason, playoffWeeks, matchupsRows, rosterMap, league, errors }

const HARD_CODED_LEAGUE_ID = '1219816671624048640';

export async function load({ fetch, url }) {
  const errors = [];
  const selectedSeason = url.searchParams.get('season') ?? String(new Date().getFullYear());

  // helper wrapper for fetch with JSON parse and unified errors
  async function safeFetchJson(endpoint) {
    try {
      const resp = await fetch(endpoint);
      if (!resp.ok) {
        return { ok: false, status: resp.status, statusText: resp.statusText, body: null };
      }
      const body = await resp.json();
      return { ok: true, status: 200, body };
    } catch (err) {
      return { ok: false, status: 0, statusText: String(err), body: null };
    }
  }

  // quick guard
  const BASE_LEAGUE_ID = HARD_CODED_LEAGUE_ID;
  if (!BASE_LEAGUE_ID) {
    errors.push('No BASE_LEAGUE_ID configured');
    return {
      seasons: [selectedSeason],
      selectedSeason,
      playoffWeeks: [],
      matchupsRows: [],
      rosterMap: {},
      league: null,
      errors
    };
  }

  // 1) league metadata
  const leagueUrl = `https://api.sleeper.app/v1/league/${BASE_LEAGUE_ID}`;
  const leagueRes = await safeFetchJson(leagueUrl);
  let league = null;
  if (leagueRes.ok) {
    league = leagueRes.body;
  } else {
    errors.push(`Failed fetching league metadata for ${BASE_LEAGUE_ID}: ${leagueRes.status} ${leagueRes.statusText}`);
  }

  // 2) attempt to build seasons list (try a few metadata locations; fallback to last 3 years)
  let seasons = [];
  try {
    // Some league metadata may contain a history array or seasons property; try to read it
    if (league) {
      // Example fields that some leagues or tools expose
      if (Array.isArray(league.seasons)) seasons = league.seasons.map(String);
      else if (Array.isArray(league.years)) seasons = league.years.map(String);
      else if (Array.isArray(league.history)) seasons = league.history.map(String);
    }
  } catch (e) {
    seasons = [];
  }
  if (!seasons || seasons.length === 0) {
    // fallback: current year and two previous years
    const now = new Date().getFullYear();
    seasons = [String(now), String(now - 1), String(now - 2)];
  }

  // If the selectedSeason isn't in the seasons list, make sure the dropdown can show it
  if (!seasons.includes(String(selectedSeason))) {
    seasons = [String(selectedSeason), ...seasons.filter(s => String(s) !== String(selectedSeason))];
  }

  // 3) determine playoff start week from league metadata if present, else default to 23
  let playoffStart = null;
  try {
    // common locations
    playoffStart =
      (league && league.settings && league.settings.playoff_week_start) ??
      league?.playoff_week_start ??
      league?.metadata?.playoff_week_start ??
      null;
    if (playoffStart != null) playoffStart = Number(playoffStart);
  } catch (e) {
    playoffStart = null;
  }
  const fallbackStart = 23;
  const startWeek = (Number.isFinite(playoffStart) && playoffStart > 0) ? playoffStart : fallbackStart;
  const playoffWeeks = [startWeek, startWeek + 1, startWeek + 2];

  // 4) fetch rosters + users so we can display team names and avatars
  const rostersUrl = `https://api.sleeper.app/v1/league/${BASE_LEAGUE_ID}/rosters`;
  const usersUrl = `https://api.sleeper.app/v1/league/${BASE_LEAGUE_ID}/users`;

  const [rostersRes, usersRes] = await Promise.all([safeFetchJson(rostersUrl), safeFetchJson(usersUrl)]);
  let rosters = [];
  let users = [];
  if (rostersRes.ok) rosters = Array.isArray(rostersRes.body) ? rostersRes.body : [];
  else errors.push(`Failed fetching rosters: ${rostersRes.status} ${rostersRes.statusText}`);
  if (usersRes.ok) users = Array.isArray(usersRes.body) ? usersRes.body : [];
  else errors.push(`Failed fetching users: ${usersRes.status} ${usersRes.statusText}`);

  // build quick user map
  const userMap = {};
  for (const u of users) {
    if (!u) continue;
    const id = String(u.user_id ?? u.id ?? '');
    userMap[id] = {
      user_id: u.user_id ?? u.id,
      display_name: u.display_name ?? u.username ?? u.name ?? null,
      avatar: u.avatar ?? u.photo_url ?? null
    };
  }

  // rosterMap: roster_id -> display_name, avatar, settings
  const rosterMap = {};
  for (const r of rosters) {
    if (!r) continue;
    const rid = String(r.roster_id ?? r.id ?? '');
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

  // 5) fetch matchups for the playoff weeks and transform into rows (matchup pair -> teamA/teamB)
  const allMatchupsRows = [];
  for (const week of playoffWeeks) {
    const matchupsUrl = `https://api.sleeper.app/v1/league/${BASE_LEAGUE_ID}/matchups/${week}`;
    const mRes = await safeFetchJson(matchupsUrl);
    if (!mRes.ok) {
      errors.push(`Failed to fetch matchups for week ${week}: ${mRes.status} ${mRes.statusText}`);
      continue;
    }
    const arr = Array.isArray(mRes.body) ? mRes.body : [];
    if (!arr.length) continue;

    // group by matchup id if present; else pair by index
    const groups = new Map();
    arr.forEach((entry, idx) => {
      const mid = entry.matchup_id ?? entry.matchup ?? entry.matchupId ?? null;
      if (mid != null) {
        const key = String(mid);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ entry, idx });
      } else {
        const key = `i${Math.floor(idx / 2)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ entry, idx });
      }
    });

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

  // final payload
  return {
    seasons,
    selectedSeason,
    playoffWeeks,
    matchupsRows: allMatchupsRows,
    rosterMap,
    league,
    errors
  };
}
