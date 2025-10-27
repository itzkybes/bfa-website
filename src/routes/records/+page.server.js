// src/routes/records/+page.server.js
import fs from 'fs/promises';
import path from 'path';

// SvelteKit load on server
export async function load({ fetch }) {
  const messages = [];
  const seasonMatchups = {}; // season -> { week -> [matchups] }

  // CONFIG
  const PROJECT_ROOT = process.cwd();
  const OVERRIDE_DIR = path.join(PROJECT_ROOT, 'static', 'season_matchups'); // where you store 2022.json, 2023.json, ...
  const seasonsToLoad = [2022, 2023, 2024]; // finished seasons you created JSON files for
  const currentSeason = 2025;
  const leagueIdCurrent = '1219816671624048640'; // given league id for 2025
  const maxWeekDefault = 23; // fallback max week to iterate for current season
  const playoffFinalWeek = Number(process.env.PLAYOFF_FINAL_WEEK || 23); // treat this week as "final playoff week" and ignore incomplete check if equal

  // helper: read JSON file if exists
  async function tryReadSeasonFile(season) {
    const candidates = [
      path.join(OVERRIDE_DIR, `${season}.json`),
      path.join(OVERRIDE_DIR, `season_${season}.json`),
      path.join(OVERRIDE_DIR, `${season}_matchups.json`),
    ];
    for (const p of candidates) {
      try {
        const data = await fs.readFile(p, 'utf-8');
        messages.push(`Loaded override file for season=${season} from ${p}`);
        return JSON.parse(data);
      } catch (err) {
        // ignore and try next
      }
    }
    messages.push(`No override file found for season=${season} in ${OVERRIDE_DIR}`);
    return null;
  }

  // helper: determine if a week is "complete"
  // Given a list of matchups for that week, ensure every participating team's score is > 0
  // We try several common shapes: matchup.teamAScore/teamBScore, matchup.teamAScore only (single team rows), or numeric fields.
  function weekIsComplete(matchups, season, week) {
    if (!Array.isArray(matchups) || matchups.length === 0) return true; // nothing to skip
    for (const m of matchups) {
      // If final playoff week we will allow incomplete — caller can override by checking week === playoffFinalWeek
      // Try typical shapes:
      if (typeof m.teamAScore === 'number' || typeof m.teamBScore === 'number') {
        const a = Number(m.teamAScore ?? 0);
        const b = Number(m.teamBScore ?? 0);
        if (a === 0 || b === 0) return false;
        continue;
      }

      // Some override files might store matchups as { teamA: { rosterId, ... }, teamB: {} , teamAScore: n, teamBScore: n }
      if (m.teamA && m.teamB) {
        const a = Number(m.teamAScore ?? 0);
        const b = Number(m.teamBScore ?? 0);
        if (a === 0 || b === 0) return false;
        continue;
      }

      // Other shapes: sleeper API returns roster scores per matchup where keys might be `starters_points` or `players_points` or `points`.
      // We'll check for any numeric value on the object that looks like a score.
      const numericVals = Object.values(m).filter(v => typeof v === 'number');
      if (numericVals.length > 0) {
        // if any numeric value is 0, be conservative and say incomplete
        if (numericVals.some(n => n === 0)) return false;
        continue;
      }

      // If we get here, no clear numeric; be permissive
    }
    return true;
  }

  // Load historical JSON overrides (seasonsToLoad)
  for (const season of seasonsToLoad) {
    const json = await tryReadSeasonFile(season);
    if (json) {
      // Expect json shape like { "1": [matchup,...], "2": [...], ... }
      seasonMatchups[season] = {};
      let weeksCount = 0;
      let matchupsCount = 0;
      for (const [wk, arr] of Object.entries(json)) {
        const weekNum = Number(wk);
        if (Number.isNaN(weekNum)) continue;
        // store as-is
        seasonMatchups[season][weekNum] = arr;
        weeksCount++;
        matchupsCount += Array.isArray(arr) ? arr.length : 0;
      }
      messages.push(`Imported season=${season} — weeks: ${weeksCount} — matchups: ${matchupsCount}`);
    } else {
      seasonMatchups[season] = {}; // empty
      messages.push(`No matchups imported for season ${season}`);
    }
  }

  // For currentSeason (2025) fetch from Sleeper API per-week (like previously done)
  seasonMatchups[currentSeason] = {};
  messages.push(`Fetching matchups for current season ${currentSeason} from Sleeper for league ${leagueIdCurrent}`);

  // determine maxWeek to iterate — try to be conservative; you can override MAX_WEEK env var
  const maxWeek = Number(process.env.MAX_WEEK || maxWeekDefault);

  for (let week = 1; week <= maxWeek; week++) {
    try {
      const url = `https://api.sleeper.app/v1/league/${leagueIdCurrent}/matchups/${week}`;
      const res = await fetch(url);
      if (!res.ok) {
        messages.push(`Sleeper API: failed to fetch season=${currentSeason} week=${week} — status ${res.status}`);
        continue;
      }
      const matchups = await res.json();

      // If matchups are empty or contain participants with 0 points, skip unless it's the designated playoffFinalWeek
      const incomplete = !weekIsComplete(matchups, currentSeason, week);
      if (incomplete && week !== playoffFinalWeek) {
        messages.push(`Skipping season=${currentSeason} week=${week} (incomplete: a participant had 0 points).`);
        continue;
      }

      // store
      seasonMatchups[currentSeason][week] = matchups;
      messages.push(`Fetched season=${currentSeason} week=${week} — matchups: ${Array.isArray(matchups) ? matchups.length : 0}`);
    } catch (err) {
      messages.push(`Error fetching season=${currentSeason} week=${week}: ${err?.message ?? err}`);
    }
  }

  // quick import summary that page.svelte will display
  const importSummary = Object.fromEntries(
    Object.entries(seasonMatchups).map(([season, weeks]) => {
      const wkKeys = Object.keys(weeks).map(k => Number(k)).sort((a,b) => a-b);
      const totalMatchups = Object.values(weeks).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      return [season, { weeks: wkKeys.length, matchups: totalMatchups }];
    })
  );

  // Example table-completion checks (these are placeholders — adapt where you compute the actual tables)
  const tableChecks = {
    regularAllTime: 'OK', // when you compute, replace with real status
    playoffAllTime: 'OK',
    ownersList: 'OK',
    topTeamScores: 'OK',
    topPlayerScores: 'OK'
  };

  // Provide a convenience list of debug teams to print in page.svelte
  const debugTeams = [
    'The Emperors',
    'DAMN!!!!!!!!!!!!!!!!!',
    'Corey’s Shower',
    'Corey\'s Shower', // include ASCII variant
    'Corey’s Shower'.replace(/\u2019/g, "'") // ensure both apostrophes considered
  ];

  return {
    seasonMatchups,
    importSummary,
    tableChecks,
    messages,
    debugTeams,
  };
}
