// src/routes/honor-hall/+page.server.js
import { error } from '@sveltejs/kit';

export async function load({ url, fetch }) {
  const season = url.searchParams.get('season');

  if (!season) {
    return { seasons: [], matchupsRows: [] };
  }

  // Get base league info
  const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${season}`);
  if (!leagueRes.ok) throw error(500, 'Failed to fetch league info');
  const league = await leagueRes.json();

  // Fetch rosters & users
  const [rostersRes, usersRes] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${season}/rosters`),
    fetch(`https://api.sleeper.app/v1/league/${season}/users`)
  ]);
  const rosters = await rostersRes.json();
  const users = await usersRes.json();

  const userMap = new Map(users.map(u => [u.user_id, u]));
  const rosterMap = new Map(rosters.map(r => [r.roster_id, r]));

  // Fetch winners bracket
  const bracketRes = await fetch(`https://api.sleeper.app/v1/league/${season}/winners_bracket`);
  const bracket = await bracketRes.json();

  // Build matchupsRows
  const matchupsRows = bracket.map(m => {
    const teamA = rosterMap.get(m.t1);
    const teamB = rosterMap.get(m.t2);

    const userA = teamA ? userMap.get(teamA.owner_id) : null;
    const userB = teamB ? userMap.get(teamB.owner_id) : null;

    return {
      matchup_id: m.m,
      round: m.r,
      teamA: teamA
        ? {
            id: teamA.roster_id,
            name: userA?.metadata?.team_name || userA?.display_name || 'Unknown',
            ownerName: userA?.display_name ?? '',
            avatar: userA?.avatar ? `https://sleepercdn.com/avatars/${userA.avatar}` : null,
            points: m.t1_from?.p ?? 0
          }
        : null,
      teamB: teamB
        ? {
            id: teamB.roster_id,
            name: userB?.metadata?.team_name || userB?.display_name || 'Unknown',
            ownerName: userB?.display_name ?? '',
            avatar: userB?.avatar ? `https://sleepercdn.com/avatars/${userB.avatar}` : null,
            points: m.t2_from?.p ?? 0
          }
        : null
    };
  });

  // Build season list (for dropdown)
  // Normally you'd store league history somewhere. For now just return the one.
  const seasons = [{ season, name: league.name }];

  return {
    seasons,
    selectedSeason: season,
    matchupsRows
  };
}
