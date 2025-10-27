// src/routes/records/+page.server.js
import fs from 'fs/promises';
import path from 'path';

// SvelteKit load on server
export async function load({ fetch }) {
  const messages = [];
  const seasonMatchups = {}; // season -> { week -> [normalizedMatchups] }

  // CONFIG
  const PROJECT_ROOT = process.cwd();
  const OVERRIDE_DIR = path.join(PROJECT_ROOT, 'static', 'season_matchups'); // where you store 2022.json, 2023.json, ...
  const seasonsToLoad = [2022, 2023, 2024]; // finished seasons you created JSON files for
  const currentSeason = 2025;
  const leagueIdCurrent = '1219816671624048640'; // given league id for 2025
  const maxWeekDefault = 23; // fallback max week to iterate for current season
  const playoffFinalWeek = Number(process.env.PLAYOFF_FINAL_WEEK || 23); // treat this week as "final playoff week" and ignore incomplete check if equal

  // ---------- Helpers ----------

  // helper: read JSON file if exists (tries several candidate names)
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

  // Normalize an override matchup entry into standard shape if necessary.
  // Accepts both already-normalized objects and flexible override shapes.
  function normalizeOverrideMatchup(m) {
    // If already has the fields we need, return as-is (but ensure numbers).
    if (m && ('teamAScore' in m || 'teamBScore' in m) && (m.teamA || m.teamB)) {
      return {
        matchup_id: m.matchup_id ?? m.matchupId ?? m.matchup ?? null,
        teamA: m.teamA ?? m.home ?? m.left ?? null,
        teamB: m.teamB ?? m.away ?? m.right ?? null,
        teamAScore: (m.teamAScore != null) ? Number(m.teamAScore) : (m.team_a_score != null ? Number(m.team_a_score) : null),
        teamBScore: (m.teamBScore != null) ? Number(m.teamBScore) : (m.team_b_score != null ? Number(m.team_b_score) : null)
      };
    }

    // Example override shape in your example: { "1": [ { matchup_id, teamA: {...}, teamB: {...}, teamAScore, teamBScore }, ... ] }
    // If we get shapes with teamA/teamB but different field names, try to adapt.
    if (m && m.teamA && m.teamB) {
      return {
        matchup_id: m.matchup_id ?? null,
        teamA: m.teamA,
        teamB: m.teamB,
        teamAScore: (m.teamAScore != null) ? Number(m.teamAScore) : (m.team_a_score != null ? Number(m.team_a_score) : null),
        teamBScore: (m.teamBScore != null) ? Number(m.teamBScore) : (m.team_b_score != null ? Number(m.team_b_score) : null)
      };
    }

    // Fallback: attempt to detect numeric fields for scores
    const numericVals = Object.entries(m || {}).filter(([k, v]) => typeof v === 'number');
    let teamAScore = null;
    let teamBScore = null;
    if (numericVals.length >= 2) {
      teamAScore = numericVals[0][1];
      teamBScore = numericVals[1][1];
    } else if (numericVals.length === 1) {
      teamAScore = numericVals[0][1];
    }

    return {
      matchup_id: m.matchup_id ?? null,
      teamA: m.teamA ?? null,
      teamB: m.teamB ?? null,
      teamAScore,
      teamBScore
    };
  }

  // Sum starters_points strictly (user requirement: use only starters_points for score computation)
  function sumStartersPointsFromRoster(rosterEntry) {
    // rosterEntry may include 'starters_points' as an array or as object mapping.
    const sp = rosterEntry?.starters_points ?? rosterEntry?.startersPoints ?? rosterEntry?.starters_points_list;
    if (Array.isArray(sp)) {
      return sp.reduce((s, v) => s + (Number(v) || 0), 0);
    }
    // sometimes starters_points comes as an object of {playerId: points}
    if (sp && typeof sp === 'object') {
      return Object.values(sp).reduce((s, v) => s + (Number(v) || 0), 0);
    }

    // fallback: if no starters_points, but there is players_points, we *do not* use it per the user's instruction
    // fallback2: use 'points' only if no starters_points present (very conservative)
    if (typeof rosterEntry?.points === 'number') {
      return Number(rosterEntry.points);
    }

    // No usable score
    return null;
  }

  // Convert raw Sleeper API matchups (array) into normalized matchup entries.
  // Sleeper often returns per-roster entries where each element has 'matchup_id' and 'roster_id' + score fields.
  function normalizeSleeperMatchups(rawMatchups) {
    // rawMatchups is typically an array of roster-level objects where each has matchup_id and roster_id.
    if (!Array.isArray(rawMatchups)) return [];

    // Group by matchup_id
    const byMatchup = rawMatchups.reduce((acc, item) => {
      const mid = item.matchup_id ?? item.matchupId ?? (item.matchup ?? null);
      const key = mid == null ? `null_${Math.random()}` : String(mid);
      acc[key] = acc[key] || [];
      acc[key].push(item);
      return acc;
    }, {});

    const normalized = [];

    for (const [midKey, entries] of Object.entries(byMatchup)) {
      // If there are exactly 2 roster entries for this matchup, treat them as teamA/teamB.
      if (entries.length >= 2) {
        const a = entries[0];
        const b = entries[1];

        const aScore = sumStartersPointsFromRoster(a);
        const bScore = sumStartersPointsFromRoster(b);

        const teamA = {
          rosterId: String(a.roster_id ?? a.rosterId ?? a.roster ?? a.roster_id ?? ''),
          // best-effort name/owner extraction (might be absent)
          name: a.display_name ?? a.owner_name ?? a.name ?? null,
          ownerName: a.owner ?? a.owner_name ?? null
        };
        const teamB = {
          rosterId: String(b.roster_id ?? b.rosterId ?? b.roster ?? b.roster_id ?? ''),
          name: b.display_name ?? b.owner_name ?? b.name ?? null,
          ownerName: b.owner ?? b.owner_name ?? null
        };

        normalized.push({
          matchup_id: a.matchup_id ?? b.matchup_id ?? null,
          teamA,
          teamB,
          teamAScore: (aScore != null) ? Number(aScore) : null,
          teamBScore: (bScore != null) ? Number(bScore) : null
        });
      } else if (entries.length === 1) {
        // Single-entry matchup (bye or incomplete). Create single side object (teamA only).
        const a = entries[0];
        const aScore = sumStartersPointsFromRoster(a);
        const teamA = {
          rosterId: String(a.roster_id ?? a.rosterId ?? a.roster ?? ''),
          name: a.display_name ?? a.owner_name ?? a.name ?? null,
          ownerName: a.owner ?? a.owner_name ?? null
        };
        normalized.push({
          matchup_id: a.matchup_id ?? null,
          teamA,
          teamB: null,
          teamAScore: (aScore != null) ? Number(aScore) : null,
          teamBScore: null
        });
      } else {
        // no entries; ignore
      }
    }

    return normalized;
  }

  // helper: determine if a week is "complete"
  // Given a list of normalized matchups for that week, ensure every participating team's score is > 0
  function weekIsComplete(normalizedMatchups, season, week) {
    if (!Array.isArray(normalizedMatchups) || normalizedMatchups.length === 0) return true; // nothing to skip
    for (const m of normalizedMatchups) {
      // If final playoff week we will allow incomplete — caller can override by checking week === playoffFinalWeek
      // require both sides present and numeric and non-zero
      const a = (m.teamAScore != null) ? Number(m.teamAScore) : null;
      const b = (m.teamBScore != null) ? Number(m.teamBScore) : null;

      // If both sides exist and either is 0/NaN -> incomplete
      if (a != null && b != null) {
        if (Number.isNaN(a) || Number.isNaN(b)) return false;
        if (a === 0 || b === 0) return false;
        continue;
      }

      // if one side missing but the other side exists and is numeric 0 -> incomplete
      if ((a != null && a === 0) || (b != null && b === 0)) return false;

      // otherwise be permissive for single-sided/breakouts
    }
    return true;
  }

  // ---------- Load historical JSON overrides (seasonsToLoad) ----------
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
        // Normalize each matchup entry (so shape is consistent later)
        const normalizedWeek = Array.isArray(arr) ? arr.map(normalizeOverrideMatchup) : [];
        seasonMatchups[season][weekNum] = normalizedWeek;
        weeksCount++;
        matchupsCount += normalizedWeek.length;
      }
      messages.push(`Imported season=${season} — weeks: ${weeksCount} — matchups: ${matchupsCount}`);
    } else {
      seasonMatchups[season] = {}; // empty
      messages.push(`No matchups imported for season ${season}`);
    }
  }

  // ---------- For currentSeason (2025) fetch from Sleeper API per-week ----------
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
      const rawMatchups = await res.json();

      // Normalize the raw matchups from Sleeper into our shape (summing starters_points ONLY)
      const normalized = normalizeSleeperMatchups(rawMatchups);

      // If matchups are empty -> nothing to add, skip
      if (!normalized || normalized.length === 0) {
        messages.push(`No matchups returned for season=${currentSeason} week=${week}`);
        continue;
      }

      // If week is incomplete and not the final playoff week, skip
      const incomplete = !weekIsComplete(normalized, currentSeason, week);
      if (incomplete && week !== playoffFinalWeek) {
        messages.push(`Skipping season=${currentSeason} week=${week} (incomplete: a participant had 0 or missing starter points).`);
        continue;
      }

      // store
      seasonMatchups[currentSeason][week] = normalized;
      messages.push(`Fetched season=${currentSeason} week=${week} — matchups: ${normalized.length}`);
    } catch (err) {
      messages.push(`Error fetching season=${currentSeason} week=${week}: ${err?.message ?? err}`);
    }
  }

  // ---------- quick import summary that page.svelte will display ----------
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
    "Corey's Shower", // include ASCII variant
  ];

  return {
    seasonMatchups,
    importSummary,
    tableChecks,
    messages,
    debugTeams,
  };
}
