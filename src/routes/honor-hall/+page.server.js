import { error } from '@sveltejs/kit';

const CURRENT_LEAGUE_ID = "YOUR_CURRENT_LEAGUE_ID"; // replace with your current Sleeper league ID

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed fetch: ${url}`);
  return res.json();
}

export async function load({ url }) {
  const selectedSeason = url.searchParams.get("season");

  try {
    let leagueId = CURRENT_LEAGUE_ID;
    const seasons = [];

    // Walk backwards through seasons
    while (leagueId) {
      const league = await fetchJson(`https://api.sleeper.app/v1/league/${leagueId}`);

      // Bracket
      const bracket = await fetchJson(`https://api.sleeper.app/v1/league/${leagueId}/winners_bracket`);

      // Rosters + Users
      const rosters = await fetchJson(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
      const users = await fetchJson(`https://api.sleeper.app/v1/league/${leagueId}/users`);

      // Map roster_id → user info
      const rosterMap = {};
      for (const r of rosters) {
        const user = users.find(u => u.user_id === r.owner_id);
        rosterMap[r.roster_id] = {
          roster_id: r.roster_id,
          display_name: user?.display_name || "Unknown",
          avatar: user?.avatar || null
        };
      }

      // Group matchups by round
      const rounds = {};
      for (const match of bracket) {
        if (!rounds[match.r]) rounds[match.r] = [];

        rounds[match.r].push({
          ...match,
          t1: rosterMap[match.t1] || null,
          t2: rosterMap[match.t2] || null,
          winner: rosterMap[match.w] || null,
          loser: rosterMap[match.l] || null
        });
      }

      seasons.push({
        season: league.season,
        leagueId,
        rounds
      });

      leagueId = league.previous_league_id || null;
    }

    // Sort newest → oldest
    seasons.sort((a, b) => b.season - a.season);

    // Pick selected season or default to most recent
    const season = selectedSeason || seasons[0].season;
    const activeSeason = seasons.find(s => s.season == season);

    return {
      season,
      seasons: seasons.map(s => s.season),
      rounds: activeSeason?.rounds || {}
    };
  } catch (e) {
    console.error("Failed to load playoff data:", e);
    throw error(500, "Failed to load playoff data");
  }
}
