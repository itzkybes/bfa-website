// src/routes/records/+page.server.js
import fs from 'fs/promises';
import path from 'path';

// SvelteKit server load must accept fetch from framework if it will call external APIs
export async function load({ fetch }) {
  const messages = [];
  const seasonMatchups = {}; // season -> { week -> [matchups] }

  // --- Config ---
  const PROJECT_ROOT = process.cwd();
  const POSSIBLE_BASES = [
    path.join(PROJECT_ROOT, 'static'),
    path.join(PROJECT_ROOT),
    path.join(PROJECT_ROOT, 'public'),
    path.join(PROJECT_ROOT, 'src', 'static'),
    path.join(PROJECT_ROOT, '..', 'static'),
  ];
  const OVERRIDE_DIR_NAMES = ['season_matchups', 'season-matchups', 'season_matchup', 'season-matchup'];
  const leagueIdCurrent = '1219816671624048640';
  const currentSeason = '2025';
  const maxWeekDefault = Number(process.env.MAX_WEEK || 23);
  const playoffFinalWeek = Number(process.env.PLAYOFF_FINAL_WEEK || 23);
  const playoffStartWeek = Number(process.env.PLAYOFF_START_WEEK || 17);

  // --- helpers ---
  async function dirExists(p) {
    try {
      const st = await fs.stat(p);
      return st && st.isDirectory();
    } catch (err) {
      return false;
    }
  }

  // Find override dir by probing several likely paths (robust)
  async function findOverrideDir() {
    for (const base of POSSIBLE_BASES) {
      for (const name of OVERRIDE_DIR_NAMES) {
        const candidate = path.join(base, name);
        if (await dirExists(candidate)) {
          messages.push(`Found override dir: ${candidate}`);
          return candidate;
        }
      }
      // also check base itself has a season_matchups-like folder (looser)
      try {
        const entries = await fs.readdir(base, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const lower = e.name.toLowerCase();
          if (OVERRIDE_DIR_NAMES.includes(lower)) {
            const candidate = path.join(base, e.name);
            messages.push(`Found override dir: ${candidate}`);
            return candidate;
          }
        }
      } catch (err) {
        // ignore
      }
    }
    messages.push(`No override dir found in candidates: ${POSSIBLE_BASES.map(b => OVERRIDE_DIR_NAMES.map(n => path.join(b, n)).join(', ')).join(' | ')}`);
    return null;
  }

  // Read all JSON files inside override dir and return mapping { seasonKey: { file, path, json } }
  async function readAllSeasonFiles(dir) {
    const out = {};
    if (!dir) return out;
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      messages.push(`Error reading override dir ${dir}: ${err?.message ?? err}`);
      return out;
    }
    for (const fname of entries) {
      if (!fname.toLowerCase().endsWith('.json')) continue;
      const full = path.join(dir, fname);
      try {
        const raw = await fs.readFile(full, 'utf8');
        const json = JSON.parse(raw);
        // infer season key from filename e.g., 2023.json or season_2023.json
        const m = fname.match(/(20\d{2})/);
        const seasonKey = m ? m[1] : fname.replace(/\.json$/i, '');
        out[seasonKey] = { file: fname, path: full, json };
        messages.push(`Loaded override file for season=${seasonKey} from ${full}`);
      } catch (err) {
        messages.push(`Failed to parse ${full}: ${err?.message ?? err}`);
      }
    }
    return out;
  }

  // normalize season file into { weekNumber: [matchups] }
  function normalizeSeasonJson(payload) {
    const weeks = {};
    if (!payload) return weeks;
    if (Array.isArray(payload)) {
      for (const m of payload) {
        const wk = Number(m.week ?? m.week_number ?? m.w ?? 0) || 0;
        if (!weeks[wk]) weeks[wk] = [];
        weeks[wk].push(m);
      }
      return weeks;
    }
    for (const [k, v] of Object.entries(payload)) {
      const wk = Number(k);
      if (!Number.isNaN(wk)) {
        weeks[wk] = Array.isArray(v) ? v : [];
      }
    }
    return weeks;
  }

  // Determine if a week is complete (no participating team with score 0)
  function weekIsComplete(matchups, season, week) {
    if (!Array.isArray(matchups) || matchups.length === 0) return true;
    for (const m of matchups) {
      // typical override file shape: teamAScore/teamBScore
      if (typeof m.teamAScore === 'number' || typeof m.teamBScore === 'number') {
        const a = Number(m.teamAScore ?? 0);
        const b = Number(m.teamBScore ?? 0);
        if (a === 0 || b === 0) return false;
        continue;
      }
      // if object with teamA/teamB and teamAScore/teamBScore
      if (m.teamA && m.teamB && (typeof m.teamAScore !== 'undefined' || typeof m.teamBScore !== 'undefined')) {
        const a = Number(m.teamAScore ?? 0);
        const b = Number(m.teamBScore ?? 0);
        if (a === 0 || b === 0) return false;
        continue;
      }
      // sleeper style: roster objects keyed with starters_points in nested object — check numeric fields
      const numericVals = Object.values(m).flatMap(v => {
        if (typeof v === 'number') return [v];
        if (Array.isArray(v)) return v.filter(x => typeof x === 'number');
        if (typeof v === 'object' && v !== null) return Object.values(v).filter(x => typeof x === 'number');
        return [];
      });
      if (numericVals.length > 0) {
        if (numericVals.some(n => Number(n) === 0)) return false;
        continue;
      }
      // permissive fallback: consider it complete
    }
    return true;
  }

  // --- Main: read overrides ---
  const overrideDir = await findOverrideDir();
  const overrides = await readAllSeasonFiles(overrideDir);

  // Initialize seasons 2022..2025 to ensure keys exist
  const seasonsToEnsure = ['2022', '2023', '2024', '2025'];
  for (const s of seasonsToEnsure) seasonMatchups[s] = {};

  // ingest overrides
  for (const [seasonKey, meta] of Object.entries(overrides)) {
    const weeks = normalizeSeasonJson(meta.json);
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

  // Build overrideFiles info for client links (static-serving base depends on folder name)
  const discoveredFiles = Object.values(overrides).map(m => m);
  const overrideFiles = discoveredFiles.map(d => {
    // determine serving base: if we found 'season-matchups' in path or 'season_matchups'
    const usedName = path.basename(path.dirname(d.path)); // e.g., 'season_matchups'
    const serveBase = `/${usedName}`; // static files are typically served from root /<folder>/<file>
    const url = `${serveBase}/${d.file}`;
    return { filename: d.file, path: d.path, url };
  });

  // --- Fetch current season (2025) from Sleeper API (use SvelteKit fetch passed into load) ---
  messages.push(`Fetching matchups for current season ${currentSeason} from Sleeper for league ${leagueIdCurrent}`);
  for (let week = 1; week <= maxWeekDefault; week++) {
    try {
      const url = `https://api.sleeper.app/v1/league/${leagueIdCurrent}/matchups/${week}`;
      const res = await fetch(url);
      if (!res.ok) {
        messages.push(`Sleeper API: failed to fetch season=${currentSeason} week=${week} — status ${res.status}`);
        continue;
      }
      const matchups = await res.json();
      // if week incomplete and not final playoff week -> skip
      const incomplete = !weekIsComplete(matchups, currentSeason, week);
      if (incomplete && week !== playoffFinalWeek) {
        messages.push(`Skipping season=${currentSeason} week=${week} (incomplete: a participant had 0 points).`);
        continue;
      }
      seasonMatchups[currentSeason][week] = Array.isArray(matchups) ? matchups : [];
      messages.push(`Fetched season=${currentSeason} week=${week} — matchups: ${Array.isArray(matchups) ? matchups.length : 0}`);
    } catch (err) {
      messages.push(`Error fetching season=${currentSeason} week=${week}: ${err?.message ?? err}`);
    }
  }

  // ---- Create aggregated standings (regular + playoff) from seasonMatchups ----
  // We'll use the override files' shape where matchups contain teamA/teamB and teamAScore/teamBScore (like your sample JSON).
  function createStandings(allSeasonMatchups, options = {}) {
    const playStart = Number(options.playoffStartWeek ?? playoffStartWeek);
    const teams = {}; // key -> aggregated

    function ensureTeam(key, sideObj) {
      if (!teams[key]) {
        const teamName = (sideObj && (sideObj.name || sideObj.team || sideObj.teamName)) || key;
        const ownerName = (sideObj && (sideObj.ownerName || sideObj.owner || sideObj.owner_name)) || teamName;
        teams[key] = {
          key,
          teamName,
          ownerName,
          regWins: 0, regLosses: 0, regPF: 0, regPA: 0,
          playoffWins: 0, playoffLosses: 0, playoffPF: 0, playoffPA: 0,
          championships: 0
        };
      }
      return teams[key];
    }

    for (const [season, weeks] of Object.entries(allSeasonMatchups)) {
      for (const [wkStr, arr] of Object.entries(weeks || {})) {
        const wk = Number(wkStr);
        if (!Array.isArray(arr)) continue;
        const isPlayoffWeek = wk >= playStart;
        for (const m of arr) {
          // priority: use teamAScore/teamBScore if available (these are your override files)
          const aScore = (typeof m.teamAScore === 'number') ? m.teamAScore
            : (typeof m.home_score === 'number') ? m.home_score
            : (typeof m.scoreA === 'number') ? m.scoreA
            : null;
          const bScore = (typeof m.teamBScore === 'number') ? m.teamBScore
            : (typeof m.away_score === 'number') ? m.away_score
            : (typeof m.scoreB === 'number') ? m.scoreB
            : null;

          if (aScore === null || bScore === null) {
            // cannot process this matchup shape — skip
            continue;
          }

          const sideA = m.teamA || m.team1 || m.home || {};
          const sideB = m.teamB || m.team2 || m.away || {};

          const keyA = (sideA.ownerName || sideA.name || sideA.rosterId || `a_${Math.random().toString(36).slice(2,6)}`).toString();
          const keyB = (sideB.ownerName || sideB.name || sideB.rosterId || `b_${Math.random().toString(36).slice(2,6)}`).toString();

          const tA = ensureTeam(keyA, sideA);
          const tB = ensureTeam(keyB, sideB);

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

          if (Number(aScore) > Number(bScore)) {
            if (isPlayoffWeek) { tA.playoffWins++; tB.playoffLosses++; }
            else { tA.regWins++; tB.regLosses++; }
          } else if (Number(bScore) > Number(aScore)) {
            if (isPlayoffWeek) { tB.playoffWins++; tA.playoffLosses++; }
            else { tB.regWins++; tA.regLosses++; }
          } else {
            // tie: do nothing
          }
        }
      }
    }

    const regularAllTime = Object.values(teams).map(t => ({
      key: t.key,
      team: t.teamName,
      owner_name: t.ownerName,
      wins: t.regWins,
      losses: t.regLosses,
      pf: Number(t.regPF.toFixed(2)),
      pa: Number(t.regPA.toFixed(2))
    })).sort((a,b) => (b.wins - a.wins) || (b.pf - a.pf));

    const playoffAllTime = Object.values(teams).map(t => ({
      key: t.key,
      team: t.teamName,
      owner_name: t.ownerName,
      playoffWins: t.playoffWins,
      playoffLosses: t.playoffLosses,
      pf: Number(t.playoffPF.toFixed(2)),
      pa: Number(t.playoffPA.toFixed(2)),
      championships: t.championships || 0
    })).sort((a,b) => (b.playoffWins - a.playoffWins) || (b.pf - a.pf));

    return { regularAllTime, playoffAllTime };
  }

  const { regularAllTime, playoffAllTime } = createStandings(seasonMatchups, { playoffStartWeek });

  // import summary for each season
  const importSummary = Object.fromEntries(
    Object.entries(seasonMatchups).map(([season, weeks]) => {
      const wkKeys = Object.keys(weeks).map(k => Number(k)).filter(n => !Number.isNaN(n) && n > 0);
      const totalMatchups = Object.values(weeks).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      return [season, { weeks: wkKeys.length, matchups: totalMatchups }];
    })
  );

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
