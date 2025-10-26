// +page.server.js
import fs from 'fs/promises';
import path from 'path';

const SEASON_MATCHUPS_DIR = path.join(process.cwd(), 'static', 'season_matchups');

// Sleeper config
const SLEEPER_BASE = process.env.SLEEPER_BASE || 'https://api.sleeper.app';
const LEAGUE_ID = process.env.LEAGUE_ID || ''; // required for fetching from Sleeper for 2025
const SLEEPER_SEASON = 2025; // only fetch from Sleeper for this season

// General config
const CURRENT_SEASON = Number(process.env.CURRENT_SEASON || new Date().getFullYear());
const PLAYOFF_FINAL_WEEK = Number(process.env.PLAYOFF_FINAL_WEEK || 23);
const MAX_WEEK = Number(process.env.MAX_WEEK || 23);

// Helper: safe numeric coercion
function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute a team score from a raw matchup entry.
 * Preference:
 * 1) look for starters_points arrays or teamX.starters_points
 * 2) teamA/teamB.score or teamAScore/teamBScore fields
 * 3) home/away points fields
 * 4) heuristic fallback
 */
function computeNormalizedMatchupScores(raw) {
  if (!raw || typeof raw !== 'object') return { teamAScore: 0, teamBScore: 0, origin: 'invalid' };

  // If explicitly normalized shape
  if ('teamAScore' in raw || 'teamBScore' in raw) {
    return {
      teamAScore: safeNum(raw.teamAScore ?? raw.teamA?.teamAScore ?? raw.home_score ?? raw.home_points ?? raw.teamA?.score),
      teamBScore: safeNum(raw.teamBScore ?? raw.teamB?.teamBScore ?? raw.away_score ?? raw.away_points ?? raw.teamB?.score),
      origin: 'already_normalized',
      details: raw
    };
  }

  // If teamA/teamB objects (your custom JSON)
  if (raw.teamA && raw.teamB) {
    let aScore = 0;
    let bScore = 0;

    if (Array.isArray(raw.teamA.starters_points) && raw.teamA.starters_points.length) {
      aScore = raw.teamA.starters_points.reduce((s, x) => s + safeNum(x), 0);
    } else if ('teamAScore' in raw.teamA) {
      aScore = safeNum(raw.teamA.teamAScore);
    } else if ('score' in raw.teamA) {
      aScore = safeNum(raw.teamA.score);
    }

    if (Array.isArray(raw.teamB.starters_points) && raw.teamB.starters_points.length) {
      bScore = raw.teamB.starters_points.reduce((s, x) => s + safeNum(x), 0);
    } else if ('teamBScore' in raw.teamB) {
      bScore = safeNum(raw.teamB.teamBScore);
    } else if ('score' in raw.teamB) {
      bScore = safeNum(raw.teamB.score);
    }

    return { teamAScore: aScore, teamBScore: bScore, origin: 'teamA-teamB', details: raw };
  }

  // If Sleeper-like objects already include computed fields (some routes return points fields)
  // Try common field names
  const aCandidates = ['teamAScore', 'team_a_score', 'home_points', 'home_score', 'points_home', 'points_a', 'teamA.points', 'teamA.score'];
  const bCandidates = ['teamBScore', 'team_b_score', 'away_points', 'away_score', 'points_away', 'points_b', 'teamB.points', 'teamB.score'];

  for (const aKey of aCandidates) {
    const aVal = aKey.includes('.') ? aKey.split('.').reduce((o, k) => o && o[k], raw) : raw[aKey];
    if (aVal !== undefined) {
      for (const bKey of bCandidates) {
        const bVal = bKey.includes('.') ? bKey.split('.').reduce((o, k) => o && o[k], raw) : raw[bKey];
        if (bVal !== undefined) {
          return { teamAScore: safeNum(aVal), teamBScore: safeNum(bVal), origin: 'direct_fields', details: raw };
        }
      }
    }
  }

  // If object includes 'home' and 'away' objects
  if (raw.home || raw.away) {
    const a = safeNum(raw.home?.points ?? raw.home?.score ?? raw.home?.starters_points?.reduce?.((s,x)=>s+safeNum(x),0));
    const b = safeNum(raw.away?.points ?? raw.away?.score ?? raw.away?.starters_points?.reduce?.((s,x)=>s+safeNum(x),0));
    return { teamAScore: a, teamBScore: b, origin: 'home-away', details: raw };
  }

  // If array of starters_points (rare)
  if (Array.isArray(raw.starters_points) && raw.starters_points.length === 2) {
    return { teamAScore: safeNum(raw.starters_points[0]), teamBScore: safeNum(raw.starters_points[1]), origin: 'starters_points_array2', details: raw };
  }

  // heuristic: collect numeric leaves and use two largest
  const numericValues = [];
  (function collectNums(v) {
    if (v == null) return;
    if (typeof v === 'number') numericValues.push(v);
    else if (Array.isArray(v)) v.forEach(collectNums);
    else if (typeof v === 'object') Object.values(v).forEach(collectNums);
  })(raw);
  if (numericValues.length >= 2) {
    numericValues.sort((a,b) => b - a);
    return { teamAScore: safeNum(numericValues[0]), teamBScore: safeNum(numericValues[1]), origin: 'heuristic_two_largest', details: raw };
  }

  return { teamAScore: 0, teamBScore: 0, origin: 'unknown', details: raw };
}

function weekHasZeroScore(matchupsForWeek) {
  if (!Array.isArray(matchupsForWeek)) return false;
  for (const m of matchupsForWeek) {
    const norm = computeNormalizedMatchupScores(m);
    if (safeNum(norm.teamAScore) === 0 || safeNum(norm.teamBScore) === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Fetch matchups from the Sleeper API for a specific week.
 * Correct endpoint: /v1/league/{LEAGUE_ID}/matchups/{week}
 * We include the season as a query param to ensure the correct season is returned.
 */
async function fetchMatchupsFromSleeper(season, week, fetchFn) {
  if (!LEAGUE_ID) {
    return { ok: false, data: [], error: 'LEAGUE_ID not set' };
  }

  // Corrected endpoint per your note; add season as query param
  const url = `${SLEEPER_BASE.replace(/\/$/, '')}/v1/league/${LEAGUE_ID}/matchups/${week}?season=${season}`;

  try {
    const res = await fetchFn(url);
    if (!res.ok) {
      return { ok: false, data: [], error: `HTTP ${res.status} ${res.statusText}` };
    }
    const json = await res.json();
    if (!Array.isArray(json)) {
      // If API returns an object or other shape, attempt to coerce into array
      // but return error message for visibility
      return { ok: false, data: [], error: 'Unexpected sleeper response shape (not array)' };
    }

    const normalized = json.map((m) => {
      const norm = computeNormalizedMatchupScores(m);
      return { ...m, _computedTeamAScore: norm.teamAScore, _computedTeamBScore: norm.teamBScore, _score_origin: norm.origin };
    });

    return { ok: true, data: normalized };
  } catch (err) {
    return { ok: false, data: [], error: String(err) };
  }
}

export async function load({ fetch }) {
  const messages = [];
  const seasonMatchups = {};

  // 1) Load static files from static/season_matchups
  try {
    let entries = [];
    try {
      entries = await fs.readdir(SEASON_MATCHUPS_DIR);
    } catch (err) {
      messages.push(`No override dir at ${SEASON_MATCHUPS_DIR} (fine; continuing without overrides).`);
      entries = [];
    }

    const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith('.json'));
    for (const fname of jsonFiles) {
      const full = path.join(SEASON_MATCHUPS_DIR, fname);
      try {
        const raw = await fs.readFile(full, 'utf-8');
        const parsed = JSON.parse(raw);
        const base = path.basename(fname, '.json');
        const seasonKey = parsed.season ? String(parsed.season) : base;
        seasonMatchups[seasonKey] = parsed;
        const weekKeys = Object.keys(parsed).filter(k => k !== 'season');
        let total = 0;
        for (const wk of weekKeys) {
          const arr = Array.isArray(parsed[wk]) ? parsed[wk] : [];
          total += arr.length;
        }
        messages.push(`Loaded season override file ${fname} as season=${seasonKey} (weeks: ${weekKeys.length}, matchups: ${total}).`);
      } catch (err) {
        messages.push(`Error reading/parsing ${fname}: ${String(err)}`);
      }
    }
  } catch (err) {
    messages.push(`Unexpected error reading season_matchups dir: ${String(err)}`);
  }

  // 2) For SLEEPER_SEASON fetch weeks from Sleeper API (or use static overrides if present)
  const sleeperSeason = SLEEPER_SEASON;
  messages.push(`Preparing to fetch Sleeper matchups for season ${sleeperSeason} (only this season will be fetched from Sleeper).`);

  const fetchedWeeks = {};
  for (let wk = 1; wk <= MAX_WEEK; wk++) {
    const staticForSeason = seasonMatchups[String(sleeperSeason)];
    if (staticForSeason && staticForSeason[String(wk)]) {
      messages.push(`Using static override for season=${sleeperSeason} week=${wk} (found in files).`);
      fetchedWeeks[wk] = { ok: true, data: staticForSeason[String(wk)], source: 'static' };
      continue;
    }

    const resp = await fetchMatchupsFromSleeper(sleeperSeason, wk, fetch);
    if (resp.ok) {
      fetchedWeeks[wk] = { ok: true, data: resp.data, source: 'sleeper' };
      messages.push(`Fetched season=${sleeperSeason} week=${wk} from Sleeper: ${resp.data.length} matchups.`);
    } else {
      fetchedWeeks[wk] = { ok: false, data: [], source: 'sleeper', error: resp.error };
      messages.push(`Failed fetching season=${sleeperSeason} week=${wk} from Sleeper: ${resp.error}`);
    }
  }

  // Decide which weeks to include using lookahead rule
  const includedWeeks = {};
  for (let wk = 1; wk <= MAX_WEEK; wk++) {
    const thisWeek = fetchedWeeks[wk];
    if (!thisWeek || !thisWeek.ok || !Array.isArray(thisWeek.data) || thisWeek.data.length === 0) {
      messages.push(`Skipping season=${sleeperSeason} week=${wk} (no usable data).`);
      continue;
    }

    const nextWeek = fetchedWeeks[wk+1];
    const isFinalPlayoffWeek = wk === PLAYOFF_FINAL_WEEK;

    let excludeDueToNextWeekIncomplete = false;
    if (!isFinalPlayoffWeek && nextWeek && nextWeek.ok && Array.isArray(nextWeek.data) && nextWeek.data.length > 0) {
      if (weekHasZeroScore(nextWeek.data)) {
        excludeDueToNextWeekIncomplete = true;
      }
    }

    if (excludeDueToNextWeekIncomplete) {
      messages.push(`Skipping season=${sleeperSeason} week=${wk} (next week ${wk+1} appears incomplete: contains zero scores).`);
      continue;
    }

    if (!isFinalPlayoffWeek && weekHasZeroScore(thisWeek.data)) {
      messages.push(`Skipping season=${sleeperSeason} week=${wk} (this week contains zero scores and is incomplete).`);
      continue;
    }

    includedWeeks[String(wk)] = thisWeek.data;
  }

  if (!seasonMatchups[String(sleeperSeason)]) seasonMatchups[String(sleeperSeason)] = {};
  seasonMatchups[String(sleeperSeason)] = { ...seasonMatchups[String(sleeperSeason)], ...includedWeeks };
  messages.push(`Included weeks for season ${sleeperSeason}: ${Object.keys(includedWeeks).join(', ') || '(none)'}`);

  // 3) Summary for all seasons loaded
  const seasons = Object.keys(seasonMatchups).sort((a,b)=>Number(a)-Number(b));
  for (const s of seasons) {
    const weeksObj = seasonMatchups[s] || {};
    const wkKeys = Object.keys(weeksObj).filter(k => k !== 'season');
    let total = 0;
    for (const wk of wkKeys) {
      const arr = Array.isArray(weeksObj[wk]) ? weeksObj[wk] : [];
      total += arr.length;
    }
    messages.push(`Season ${s} — weeks: ${wkKeys.length} — matchups: ${total}`);
  }
  messages.push(`Processed ${seasons.length} seasons; generated seasonMatchups keys: ${seasons.join(', ')}`);

  // 4) Debug printing for the teams you care about
  const debugTeams = [
    'The Emperors', 'The Emperors Team', 'DAMN!!!!!!!!!!!!!!!!!',
    'Corey’s Shower', "Corey's Shower", "Corey\\'s Shower", "Corey's Shower"
  ];

  for (const s of seasons) {
    const weeksObj = seasonMatchups[s] || {};
    const wkKeys = Object.keys(weeksObj).filter(k => k !== 'season').sort((a,b)=>Number(a)-Number(b));
    for (const wk of wkKeys) {
      const arr = Array.isArray(weeksObj[wk]) ? weeksObj[wk] : [];
      for (const m of arr) {
        const text = JSON.stringify(m).toLowerCase();
        for (const t of debugTeams) {
          if (text.includes(t.toLowerCase())) {
            let teamName = null;
            let opponentName = null;
            if (m.teamA && m.teamB) {
              teamName = m.teamA.name || m.teamA.team || m.teamA.ownerName || m.teamA.rosterId;
              opponentName = m.teamB.name || m.teamB.team || m.teamB.ownerName || m.teamB.rosterId;
            } else if (m.home || m.away) {
              teamName = m.home?.team || m.home?.name || m.home?.ownerName;
              opponentName = m.away?.team || m.away?.name || m.away?.ownerName;
            } else {
              teamName = m.teamA?.name || m.home?.team || m.team?.team || null;
              opponentName = m.teamB?.name || m.away?.team || m.opponent?.team || null;
            }

            const computed = computeNormalizedMatchupScores(m);
            messages.push(`DEBUG MATCHUP season=${s} week=${wk} — match contains "${t}" -> team="${teamName ?? '(unknown)'}" vs opponent="${opponentName ?? '(unknown)'}" — scores: ${computed.teamAScore} - ${computed.teamBScore} (origin: ${computed.origin}). Raw: ${JSON.stringify(m).slice(0,800)}`);
            break;
          }
        }
      }
    }
  }

  return {
    seasonMatchups,
    messages
  };
}
