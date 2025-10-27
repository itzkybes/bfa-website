// src/routes/records/+page.server.js
import fs from 'fs/promises';
import path from 'path';

/**
 * Server load: reads season JSON overrides from static dir(s),
 * builds seasonMatchups[season][week] -> [matchups],
 * and aggregates total regular + playoff standings.
 */
export async function load() {
  const messages = [];
  const seasonMatchups = {}; // season -> { week -> [matchups] }

  const PROJECT_ROOT = process.cwd();

  // check both naming conventions just in case
  const CANDIDATE_OVERRIDE_DIRS = [
    path.join(PROJECT_ROOT, 'static', 'season_matchups'),
    path.join(PROJECT_ROOT, 'static', 'season-matchups'),
    path.join(PROJECT_ROOT, 'static', 'season-matchup'),
  ];

  // Which seasons to pick up from static JSON files (we'll autodiscover too)
  // If you want only specific seasons, adjust this list. We'll also scan dir contents.
  const discoveredFiles = [];

  // config: playoff start week (weeks >= this are playoffs)
  const playoffStartWeek = Number(process.env.PLAYOFF_START_WEEK || 17);

  // helper: try to list files in the candidate dirs and return whichever exists
  async function findOverrideDir() {
    for (const d of CANDIDATE_OVERRIDE_DIRS) {
      try {
        const stat = await fs.stat(d);
        if (stat && stat.isDirectory()) {
          messages.push(`Found override dir: ${d}`);
          return d;
        }
      } catch (err) {
        // not found - continue
      }
    }
    messages.push(`No override dir found in candidates: ${CANDIDATE_OVERRIDE_DIRS.join(', ')}`);
    return null;
  }

  // read and parse all JSON files in the override dir
  async function readAllSeasonFiles(dir) {
    if (!dir) return {};
    const out = {};
    try {
      const entries = await fs.readdir(dir);
      for (const fname of entries) {
        // only JSON files
        if (!fname.toLowerCase().endsWith('.json')) continue;
        const full = path.join(dir, fname);
        try {
          const raw = await fs.readFile(full, 'utf8');
          const json = JSON.parse(raw);
          // try to infer season from filename like 2023.json or season_2023.json
          const seasonMatch = fname.match(/(20\d{2})/);
          const seasonKey = seasonMatch ? seasonMatch[1] : fname.replace(/\.json$/i, '');
          out[seasonKey] = { file: fname, path: full, json };
          discoveredFiles.push({ season: seasonKey, filename: fname, path: full });
          messages.push(`Loaded override file for season=${seasonKey} from ${full}`);
        } catch (err) {
          messages.push(`Failed to parse ${full}: ${err?.message ?? err}`);
        }
      }
    } catch (err) {
      messages.push(`Error reading override dir ${dir}: ${err?.message ?? err}`);
    }
    return out;
  }

  // Normalize matchups object for a given season JSON into seasonMatchups[season][week] = [matchups]
  function normalizeSeasonJson(seasonJson) {
    // Expect shape like { "1": [matchup,...], "2": [...], ... }
    // but tolerate alternate shapes. We'll return mapping weekNum->array
    const weeks = {};
    if (!seasonJson || typeof seasonJson !== 'object') return weeks;
    // If top-level is array (maybe entire season as an array with week property on entries) - try to group by week
    if (Array.isArray(seasonJson)) {
      for (const m of seasonJson) {
        const wk = Number(m.week ?? m.week_number ?? m.weekNum ?? m.weeknum ?? 0) || 0;
        if (!weeks[wk]) weeks[wk] = [];
        weeks[wk].push(m);
      }
      return weeks;
    }

    // If top-level keys look like week numbers, copy them
    for (const [k, v] of Object.entries(seasonJson)) {
      const wk = Number(k);
      if (!Number.isNaN(wk)) {
        weeks[wk] = Array.isArray(v) ? v : [];
        continue;
      }
      // otherwise: skip unknown top-level keys
    }
    return weeks;
  }

  // utility: safe-number check
  function isNumberLike(v) {
    return typeof v === 'number' && !Number.isNaN(v);
  }

  // Build seasonMatchups from discoveredFiles
  const overrideDir = await findOverrideDir();
  const overrides = await readAllSeasonFiles(overrideDir);

  // For each discovered season file, normalize into seasonMatchups
  for (const [seasonKey, meta] of Object.entries(overrides)) {
    const json = meta.json;
    const weeks = normalizeSeasonJson(json);
    seasonMatchups[seasonKey] = {};
    let weeksCount = 0;
    let matchupsCount = 0;
    for (const [wk, arr] of Object.entries(weeks)) {
      const wn = Number(wk);
      if (Number.isNaN(wn)) continue;
      seasonMatchups[seasonKey][wn] = Array.isArray(arr) ? arr : [];
      weeksCount++;
      matchupsCount += Array.isArray(arr) ? arr.length : 0;
    }
    messages.push(`Imported season=${seasonKey} — weeks: ${weeksCount} — matchups: ${matchupsCount}`);
  }

  // If no override files were loaded, still ensure seasonMatchups is at least empty for 2022..2025
  const seasonsToEnsure = ['2022', '2023', '2024', '2025'];
  for (const s of seasonsToEnsure) {
    if (!seasonMatchups[s]) seasonMatchups[s] = {};
  }

  // --- Standings creator ---
  // Input: seasonMatchups: { season: { week: [matchup] } }
  // Output: { regularAllTime: [...], playoffAllTime: [...] }
  function createStandingsFromSeasonMatchups(allSeasonMatchups, options = {}) {
    const playStart = Number(options.playoffStartWeek ?? playoffStartWeek);
    // teams keyed by ownerName (preferred) or team name fallback. store aggregated stats.
    const teams = {}; // key => { key, ownerName, teamName, regWins, regLosses, regPF, regPA, playoffWins, playoffLosses, playoffPF, playoffPA }

    function getTeamKeyFromMatchupSide(sideObj) {
      if (!sideObj) return null;
      // many override entries have teamA: { rosterId, name, ownerName } shape
      if (typeof sideObj === 'object') {
        return (sideObj.ownerName || sideObj.owner || sideObj.owner_name || sideObj.name || sideObj.rosterId || `${sideObj.rosterId||''}_${sideObj.name||''}`).toString();
      }
      // fallback: if sideObj is string use it
      return String(sideObj);
    }

    function ensureTeam(key, sideObj) {
      if (!teams[key]) {
        const ownerName = (sideObj && (sideObj.ownerName || sideObj.owner || sideObj.owner_name)) || null;
        const teamName = (sideObj && (sideObj.name || sideObj.team || sideObj.teamName)) || key;
        teams[key] = {
          key,
          ownerName: ownerName || teamName || key,
          teamName: teamName || ownerName || key,
          regWins: 0,
          regLosses: 0,
          regPF: 0,
          regPA: 0,
          maxWinStreak: 0,
          maxLoseStreak: 0,
          // for simplicity we won't compute streaks accurately over season boundaries here
          playoffWins: 0,
          playoffLosses: 0,
          playoffPF: 0,
          playoffPA: 0,
          championships: 0
        };
      }
      return teams[key];
    }

    // iterate seasons/weeks/matchups
    for (const [season, weeks] of Object.entries(allSeasonMatchups)) {
      for (const [wkStr, arr] of Object.entries(weeks || {})) {
        const wk = Number(wkStr);
        if (!Array.isArray(arr)) continue;
        const isPlayoffWeek = wk >= playStart;
        for (const rawMatchup of arr) {
          // try the common override shape: { teamA: {...}, teamB: {...}, teamAScore: n, teamBScore: n }
          const hasTeamA = rawMatchup.teamA || rawMatchup.team1 || rawMatchup.home;
          const hasTeamB = rawMatchup.teamB || rawMatchup.team2 || rawMatchup.away;

          // read numeric scores by many common keys
          const aScore = (isNumberLike(rawMatchup.teamAScore) ? rawMatchup.teamAScore
            : isNumberLike(rawMatchup.scoreA) ? rawMatchup.scoreA
            : isNumberLike(rawMatchup.team_a_score) ? rawMatchup.team_a_score
            : isNumberLike(rawMatchup.home_score) ? rawMatchup.home_score
            : isNumberLike(rawMatchup.home_points) ? rawMatchup.home_points
            : (rawMatchup.teamA && isNumberLike(rawMatchup.teamA.teamScore)) ? rawMatchup.teamA.teamScore
            : (rawMatchup.starters_points && typeof rawMatchup.starters_points === 'object' && rawMatchup.teamA && rawMatchup.teamA.rosterId && isNumberLike(rawMatchup.starters_points[rawMatchup.teamA.rosterId])) ? rawMatchup.starters_points[rawMatchup.teamA.rosterId]
            : null
          );

          const bScore = (isNumberLike(rawMatchup.teamBScore) ? rawMatchup.teamBScore
            : isNumberLike(rawMatchup.scoreB) ? rawMatchup.scoreB
            : isNumberLike(rawMatchup.team_b_score) ? rawMatchup.team_b_score
            : isNumberLike(rawMatchup.away_score) ? rawMatchup.away_score
            : isNumberLike(rawMatchup.away_points) ? rawMatchup.away_points
            : (rawMatchup.teamB && isNumberLike(rawMatchup.teamB.teamScore)) ? rawMatchup.teamB.teamScore
            : (rawMatchup.starters_points && typeof rawMatchup.starters_points === 'object' && rawMatchup.teamB && rawMatchup.teamB.rosterId && isNumberLike(rawMatchup.starters_points[rawMatchup.teamB.rosterId])) ? rawMatchup.starters_points[rawMatchup.teamB.rosterId]
            : null
          );

          // If both scores not present - try other shapes: sleeper-style where matchup is an object keyed by rosterId -> { starters_points } etc.
          // But because we're focusing on the static override JSON format you created (teamAScore/teamBScore), skip more exotic shapes here.
          if (!isNumberLike(aScore) || !isNumberLike(bScore)) {
            // skip incomplete or unrecognized matchup
            continue;
          }

          // Determine side objects for meta (team name/owner)
          const sideA = rawMatchup.teamA || rawMatchup.team1 || rawMatchup.home || {};
          const sideB = rawMatchup.teamB || rawMatchup.team2 || rawMatchup.away || {};

          const keyA = getTeamKeyFromMatchupSide(sideA) || `${season}_wk${wk}_a_${Math.random().toString(36).slice(2,6)}`;
          const keyB = getTeamKeyFromMatchupSide(sideB) || `${season}_wk${wk}_b_${Math.random().toString(36).slice(2,6)}`;

          const tA = ensureTeam(keyA, sideA);
          const tB = ensureTeam(keyB, sideB);

          // Update PF/PA
          if (isPlayoffWeek) {
            tA.playoffPF += Number(aScore);
            tA.playoffPA += Number(bScore);
            tB.playoffPF += Number(bScore);
            tB.playoffPA += Number(aScore);
          } else {
            tA.regPF += Number(aScore);
            tA.regPA += Number(bScore);
            tB.regPF += Number(bScore);
            tB.regPA += Number(aScore);
          }

          // Update W/L (no ties accounted -> if equal scores, skip W/L)
          if (Number(aScore) > Number(bScore)) {
            if (isPlayoffWeek) {
              tA.playoffWins += 1;
              tB.playoffLosses += 1;
            } else {
              tA.regWins += 1;
              tB.regLosses += 1;
            }
          } else if (Number(bScore) > Number(aScore)) {
            if (isPlayoffWeek) {
              tB.playoffWins += 1;
              tA.playoffLosses += 1;
            } else {
              tB.regWins += 1;
              tA.regLosses += 1;
            }
          } else {
            // tie -> no wins/losses changed
          }
        } // end for matchup
      } // end for week
    } // end for season

    // Convert teams map to arrays
    const regularAllTime = Object.values(teams).map(t => ({
      key: t.key,
      team: t.teamName,
      owner_name: t.ownerName,
      wins: t.regWins,
      losses: t.regLosses,
      pf: Number(t.regPF.toFixed(2)),
      pa: Number(t.regPA.toFixed(2)),
      maxWinStreak: t.maxWinStreak,
      maxLoseStreak: t.maxLoseStreak,
    }));

    const playoffAllTime = Object.values(teams).map(t => ({
      key: t.key,
      team: t.teamName,
      owner_name: t.ownerName,
      playoffWins: t.playoffWins,
      playoffLosses: t.playoffLosses,
      pf: Number(t.playoffPF.toFixed(2)),
      pa: Number(t.playoffPA.toFixed(2)),
      championships: t.championships || 0
    }));

    // Sort: regular by wins desc, pf desc
    regularAllTime.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return (b.pf || 0) - (a.pf || 0);
    });

    // Sort playoffs by playoffWins desc then pf
    playoffAllTime.sort((a, b) => {
      if (b.playoffWins !== a.playoffWins) return b.playoffWins - a.playoffWins;
      return (b.pf || 0) - (a.pf || 0);
    });

    return { regularAllTime, playoffAllTime };
  } // end createStandings

  const { regularAllTime, playoffAllTime } = createStandingsFromSeasonMatchups(seasonMatchups, { playoffStartWeek });

  // Build import summary for display
  const importSummary = Object.fromEntries(
    Object.entries(seasonMatchups).map(([season, weeks]) => {
      const wkKeys = Object.keys(weeks).map(k => Number(k)).filter(n => !Number.isNaN(n) && n > 0);
      const totalMatchups = Object.values(weeks).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      return [season, { weeks: wkKeys.length, matchups: totalMatchups }];
    })
  );

  // If we discovered files, build a list for client to link to (static path)
  const overrideFiles = discoveredFiles.map(d => {
    // serve path: '/season_matchups/<filename>' or '/season-matchups/<filename>' depending on dir name used
    let serveBase = '/season_matchups';
    if (d.path.indexOf('season-matchups') !== -1) serveBase = '/season-matchups';
    // fallback to season_matchups
    const serveUrl = `${serveBase}/${d.filename}`;
    return { season: d.season, filename: d.filename, path: d.path, url: serveUrl };
  });

  messages.push(`Processed ${Object.keys(seasonMatchups).length} seasons; generated seasonMatchups keys: ${Object.keys(seasonMatchups).join(', ')}`);

  return {
    seasonMatchups,
    importSummary,
    overrideFiles,
    regularAllTime,
    playoffAllTime,
    messages
  };
}
