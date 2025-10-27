// src/routes/records/+page.server.js
import fs from 'fs/promises';
import path from 'path';

// SvelteKit load on server
export async function load({ fetch, url }) {
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

  // helper: read JSON file if exists (disk)
  async function tryReadSeasonFile(season) {
    const candidates = [
      path.join(OVERRIDE_DIR, `${season}.json`),
      path.join(OVERRIDE_DIR, `season_${season}.json`),
      path.join(OVERRIDE_DIR, `${season}_matchups.json`),
    ];
    for (const p of candidates) {
      try {
        const raw = await fs.readFile(p, 'utf-8');
        messages.push(`Loaded override file for season=${season} from ${p}`);
        return JSON.parse(raw);
      } catch (err) {
        // ignore and try next
      }
    }
    // no file found on disk
    return null;
  }

  // helper: determine if a week is "complete"
  // Given a list of matchups for that week, ensure every participating team's score is > 0
  // We try several common shapes: matchup.teamAScore/teamBScore, matchup.teamAScore only (single team rows), or numeric fields.
  function weekIsComplete(matchups, season, week) {
    if (!Array.isArray(matchups) || matchups.length === 0) return true; // nothing to skip
    for (const m of matchups) {
      // Try straightforward shape: teamAScore / teamBScore numeric fields
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

      // Other shapes: sleeper API returns roster scores per matchup where keys might be `points` or `points_for` or `starters_points`.
      // We'll check for any numeric value on the object that looks like a score.
      const numericVals = Object.values(m).flatMap(v => (Array.isArray(v) ? v : [v])).filter(v => typeof v === 'number');
      if (numericVals.length > 0) {
        // if any numeric value is 0, be conservative and say incomplete
        if (numericVals.some(n => n === 0)) return false;
        continue;
      }

      // If we get here, no clear numeric; be permissive
    }
    return true;
  }

  // 1) Try to load per-season files from disk
  const files = {}; // season -> parsed json
  for (const season of seasonsToLoad) {
    try {
      const parsed = await tryReadSeasonFile(season);
      if (parsed) {
        files[String(season)] = parsed;
      } else {
        messages.push(`No override file found for season=${season} in ${OVERRIDE_DIR}`);
      }
    } catch (err) {
      messages.push(`Error reading season file for ${season}: ${err?.message ?? err}`);
    }
  }

  // 2) If some seasons missing, try HTTP fetch from origin and a hard-coded fallback origin
  // candidate origins: the request origin (url.origin) and explicit HARDCODE_ORIGIN for your vercel deployment
  const HARDCODE_ORIGIN = 'https://bfa-website-tau.vercel.app';
  const origin = (url && url.origin) ? String(url.origin).replace(/\/$/, '') : null;

  const wantSeasons = seasonsToLoad.map(s => String(s));
  const candidateOrigins = [];
  if (origin) candidateOrigins.push(origin);
  candidateOrigins.push(HARDCODE_ORIGIN);

  if (fetch && candidateOrigins.length) {
    for (const s of wantSeasons) {
      if (files[s]) continue; // already loaded from disk
      let found = false;
      const tried = [];
      for (const base of candidateOrigins) {
        const candidateUrl = `${base.replace(/\/$/, '')}/season_matchups/${s}.json`;
        tried.push(candidateUrl);
        try {
          const r = await fetch(candidateUrl, { method: 'GET' });
          if (r && r.ok) {
            const parsed = await r.json();
            files[s] = parsed;
            messages.push(`Fetched override season=${s} from ${candidateUrl}`);
            found = true;
            break;
          } else {
            messages.push(`No remote override at ${candidateUrl} (status ${r?.status})`);
          }
        } catch (err) {
          messages.push(`Error fetching remote override for season=${s} from ${candidateUrl}: ${err?.message ?? err}`);
        }
      }
      if (!found) {
        messages.push(`Tried remote override URLs for season=${s}: ${tried.join(', ')}`);
      }
    }
  } else {
    messages.push('Origin or fetch not available; skipping remote fetch attempt for per-season overrides.');
  }

  // 3) Normalize loaded season JSONs into seasonMatchups object (season -> weekNum -> array)
  for (const season of seasonsToLoad) {
    const s = String(season);
    const json = files[s];
    seasonMatchups[s] = {};
    if (!json) {
      messages.push(`No matchups imported for season ${s}`);
      continue;
    }
    let weeksCount = 0;
    let matchupsCount = 0;
    // Expect json shape like { "1": [matchup,...], "2": [...], ... } OR possibly already a week->arr map
    for (const [wk, arr] of Object.entries(json)) {
      const wkNum = Number(wk);
      if (Number.isNaN(wkNum)) continue;
      seasonMatchups[s][wkNum] = Array.isArray(arr) ? arr : [];
      weeksCount++;
      matchupsCount += Array.isArray(arr) ? arr.length : 0;
    }
    messages.push(`Imported season=${s} — weeks: ${weeksCount} — matchups: ${matchupsCount}`);
  }

  // 4) For currentSeason, fetch per-week from Sleeper API (use fetch passed into load)
  seasonMatchups[String(currentSeason)] = {};
  messages.push(`Fetching matchups for current season ${currentSeason} from Sleeper for league ${leagueIdCurrent}`);

  const maxWeek = Number(process.env.MAX_WEEK || maxWeekDefault);

  for (let week = 1; week <= maxWeek; week++) {
    try {
      const urlMatchups = `https://api.sleeper.app/v1/league/${leagueIdCurrent}/matchups/${week}`;
      const res = await fetch(urlMatchups);
      if (!res || !res.ok) {
        messages.push(`Sleeper API: failed to fetch season=${currentSeason} week=${week} — status ${res?.status ?? 'no response'}`);
        continue;
      }
      const matchups = await res.json();

      // If matchups are empty or contain participants with 0 points, skip unless it's the designated playoffFinalWeek
      const incomplete = !weekIsComplete(matchups, currentSeason, week);
      if (incomplete && week !== playoffFinalWeek) {
        messages.push(`Skipping season=${currentSeason} week=${week} (incomplete: a participant had 0 points).`);
        continue;
      }

      seasonMatchups[String(currentSeason)][week] = matchups;
      messages.push(`Fetched season=${currentSeason} week=${week} — matchups: ${Array.isArray(matchups) ? matchups.length : 0}`);
    } catch (err) {
      messages.push(`Error fetching season=${currentSeason} week=${week}: ${err?.message ?? err}`);
    }
  }

  // 5) Build an importSummary for display
  const importSummary = Object.fromEntries(
    Object.entries(seasonMatchups).map(([season, weeks]) => {
      const wkKeys = Object.keys(weeks).map(k => Number(k)).sort((a,b) => a-b);
      const totalMatchups = Object.values(weeks).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      return [season, { weeks: wkKeys.length, matchups: totalMatchups }];
    })
  );

  // 6) Placeholder table-completion checks (you'll replace these with real checks once standings generation exists)
  const tableChecks = {
    regularAllTime: 'OK',
    playoffAllTime: 'OK',
    ownersList: 'OK',
    topTeamScores: 'OK',
    topPlayerScores: 'OK'
  };

  // 7) Debug teams convenience list (page can use this to print matchups for specific teams)
  const debugTeams = [
    'The Emperors',
    'DAMN!!!!!!!!!!!!!!!!!',
    'Corey’s Shower',
    "Corey's Shower", // ascii variant
  ];

  return {
    seasonMatchups,
    importSummary,
    tableChecks,
    messages,
    debugTeams,
  };
}
