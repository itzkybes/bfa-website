// src/routes/honor-hall/+page.server.js
import { error } from '@sveltejs/kit';

export async function load({ url }) {
  const season = url.searchParams.get('season');
  if (!season) return { seasons: [], matchupsRows: [] };

  // 1. Get league info
  const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${season}`);
  if (!leagueRes.ok) throw error(500, 'Failed to fetch league');
  const league = await leagueRes.json();

  const playoffStart = league.settings?.playoff_week_start ?? 15;
  const playoffWeeks = [playoffStart, playoffStart + 1, playoffStart + 2];

  // 2. Get rosters & users
  const [rostersRes, usersRes] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${season}/rosters`),
    fetch(`https://api.sleeper.app/v1/league/${season}/users`)
  ]);
  const rosters = await rostersRes.json();
  const users = await usersRes.json();

  const userMap = new Map(users.map(u => [u.user_id, u]));
  const rosterMap = new Map(rosters.map(r => [r.roster_id, r]));

  // 3. Get winners bracket
  const bracketRes = await fetch(`https://api.sleeper.app/v1/league/${season}/winners_bracket`);
  const bracket = bracketRes.ok ? await bracketRes.json() : [];

  // 4. Fetch all playoff week matchups (for scores)
  const weeklyMatchups = {};
  for (const week of playoffWeeks) {
    const res = await fetch(`https://api.sleeper.app/v1/league/${season}/matchups/${week}`);
    weeklyMatchups[week] = res.ok ? await res.json() : [];
  }

  // Map matchup_id+roster_id → points
  const pointsLookup = {};
  for (const week of playoffWeeks) {
    for (const m of weeklyMatchups[week]) {
      pointsLookup[`${week}_${m.roster_id}`] = m.points;
    }
  }

  // 5. Build matchupsRows
  const matchupsRows = bracket.map(m => {
    const teamA = rosterMap.get(m.t1);
    const teamB = rosterMap.get(m.t2);

    const userA = teamA ? userMap.get(teamA.owner_id) : null;
    const userB = teamB ? userMap.get(teamB.owner_id) : null;

    // determine correct week for this round
    const week = playoffWeeks[m.r - 1];

    return {
      round: m.r,
      week,
      teamA: teamA
        ? {
            name: userA?.metadata?.team_name || userA?.display_name,
            ownerName: userA?.display_name ?? '',
            avatar: userA?.avatar ? `https://sleepercdn.com/avatars/${userA.avatar}` : null,
            points: pointsLookup[`${week}_${teamA.roster_id}`] ?? 0
          }
        : null,
      teamB: teamB
        ? {
            name: userB?.metadata?.team_name || userB?.display_name,
            ownerName: userB?.display_name ?? '',
            avatar: userB?.avatar ? `https://sleepercdn.com/avatars/${userB.avatar}` : null,
            points: pointsLookup[`${week}_${teamB.roster_id}`] ?? 0
          }
        : null
    };
  });

  return {
    seasons: [{ season, name: league.name }],
    selectedSeason: season,
    matchupsRows
  };
}
