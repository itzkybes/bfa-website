// src/routes/records/+page.server.js
import fs from 'fs/promises';
import path from 'path';

/**
 * Server-side loader for the Records page.
 *
 * Responsibilities:
 *  - read season override JSON files from static/season_matchups (one file per season, e.g. 2023.json)
 *  - for the current season (2025) fetch matchups from Sleeper API per-week and apply "skip week if a participant has 0 starters_points"
 *  - use starters_points exclusively when available to compute matchup scores (fall back to points only with a debug message)
 *  - use override files for prior seasons (and optionally for 2025 if a file is present and you want to override)
 *  - combine Bellooshio & cholybevv into jakepratt using early2023.json rules (we canonicalize on ownerName here)
 *  - produce seasonMatchups map and basic aggregated tables for the page
 *
 * Note: this implementation is defensive and logs many helpful messages into `messages` for the client debug panel.
 */

const LEAGUE_ID = '1219816671624048640'; // as provided by you
const STATIC_OVERRIDES_DIR = path.join(process.cwd(), 'static', 'season_matchups'); // folder with per-season JSON files
const EARLY_2023_FILE = path.join(STATIC_OVERRIDES_DIR, 'early2023.json');

// tuning
const CURRENT_SEASON = 2025;
const MAX_WEEKS = 23; // adjust if your league has a different max weeks
const REGULAR_SEASON_WEEKS = 16; // weeks <= this are considered "regular"; > are playoffs
const PLAYOFF_FINAL_WEEK = MAX_WEEKS; // include final week regardless of zero-score check

// teams we want to emit detailed matchups for in debug
const DEBUG_TEAMS = [
  'The Emperors',
  'DAMN!!!!!!!!!!!!!!!!!',
  'Corey’s Shower',     // use curly apostrophe because the JSON you showed uses that for Corey's
  'Corey\'s Shower',    // include plain apostrophe variant for safety
  'Kanto Embers'
];

function pushMsg(arr, m) {
  arr.push(m);
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// helpers to attempt extracting starters_points in various possible shapes the Sleeper API might return
function extractStarterScoreForRoster(matchupObj, rosterId) {
  // Try known patterns (best-effort):
  // 1) matchupObj.starters_points keyed by roster id object e.g. { "1": 232.5, "2": 210.1 }
  // 2) matchupObj.starters_points as array in same order as matchupObj.rosters
  // 3) matchupObj.starters_points (alternate key)
  // 4) fallback to matchupObj.points (array keyed by rosters)
  try {
    // Case 1: object keyed by roster id
    if (matchupObj.starters_points && typeof matchupObj.starters_points === 'object' && !Array.isArray(matchupObj.starters_points)) {
      const val = matchupObj.starters_points[rosterId] ?? matchupObj.starters_points[String(rosterId)];
      if (val !== undefined && val !== null) return safeNum(val);
    }

    // Case 2: array in same order as roster list
    if (Array.isArray(matchupObj.starters_points) && Array.isArray(matchupObj.rosters)) {
      const idx = matchupObj.rosters.indexOf(Number(rosterId)) !== -1 ? matchupObj.rosters.indexOf(Number(rosterId)) : matchupObj.rosters.indexOf(String(rosterId));
      if (idx !== -1 && matchupObj.starters_points[idx] !== undefined) return safeNum(matchupObj.starters_points[idx]);
    }

    // Case 3: alternate key name
    if (matchupObj.starters_points && typeof matchupObj.starters_points === 'object' && !Array.isArray(matchupObj.starters_points)) {
      const val = matchupObj.starters_points[rosterId] ?? matchupObj.starters_points[String(rosterId)];
      if (val !== undefined && val !== null) return safeNum(val);
    }
    if (Array.isArray(matchupObj.starters_points) && Array.isArray(matchupObj.rosters)) {
      const idx = matchupObj.rosters.indexOf(Number(rosterId)) !== -1 ? matchupObj.rosters.indexOf(Number(rosterId)) : matchupObj.rosters.indexOf(String(rosterId));
      if (idx !== -1 && matchupObj.starters_points[idx] !== undefined) return safeNum(matchupObj.starters_points[idx]);
    }

    // Fallback to points array (not preferred)
    if (Array.isArray(matchupObj.points) && Array.isArray(matchupObj.rosters)) {
      const idx = matchupObj.rosters.indexOf(Number(rosterId)) !== -1 ? matchupObj.rosters.indexOf(Number(rosterId)) : matchupObj.rosters.indexOf(String(rosterId));
      if (idx !== -1 && matchupObj.points[idx] !== undefined) return safeNum(matchupObj.points[idx]);
    }

    // Fallback: maybe the matchup object directly has teamA/teamB like keys (used by your JSON overrides) - these should be handled elsewhere
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Load any season overrides present in static/season_matchups.
 * Expected file layout: e.g. static/season_matchups/2023.json (full season JSON),
 * optionally early2023.json (used for canonicalization logic).
 */
async function loadSeasonOverrides(messages) {
  const out = {};
  try {
    const dirents = await fs.readdir(STATIC_OVERRIDES_DIR, { withFileTypes: true });
    for (const d of dirents) {
      if (!d.isFile()) continue;
      if (!d.name.toLowerCase().endsWith('.json')) continue;
      const filepath = path.join(STATIC_OVERRIDES_DIR, d.name);
      try {
        const raw = await fs.readFile(filepath, 'utf8');
        const json = JSON.parse(raw);
        // Map file name to a season key. If filename is like "2023.json" use 2023, else if the JSON itself has season property, use it
        const seasonKeyCandidate = path.basename(d.name, '.json');
        // If the file looks like the "per-season object" (keys: week numbers), we store directly under seasonKey
        if (/^\d{4}$/.test(seasonKeyCandidate)) {
          out[seasonKeyCandidate] = json;
          pushMsg(messages, `Loaded override file for season ${seasonKeyCandidate} from ${d.name}`);
        } else {
          // If file is early2023.json or other, try to detect season inside JSON. If JSON has numeric top-level keys (weeks) treat as season 2023 maybe.
          // We'll attempt shallow detection:
          const topKeys = Object.keys(json || {});
          const numericTop = topKeys.filter(k => /^\d+$/.test(k));
          if (numericTop.length > 0 && numericTop.length <= 30) {
            // ambiguous — test for 'season' property inside file or fallback to using filename as label
            const seasonFromFile = (json.season && String(json.season)) || seasonKeyCandidate;
            out[seasonFromFile] = json;
            pushMsg(messages, `Loaded override object (likely season ${seasonFromFile}) from ${d.name}`);
          } else {
            // store as auxiliary (e.g., early2023.json). Keep under the filename key so callers can look for 'early2023'
            out[seasonKeyCandidate] = json;
            pushMsg(messages, `Loaded auxiliary override ${d.name}`);
          }
        }
      } catch (e) {
        pushMsg(messages, `Failed to parse override ${d.name}: ${e?.message ?? e}`);
      }
    }
    if (Object.keys(out).length === 0) {
      pushMsg(messages, `No override dir at ${STATIC_OVERRIDES_DIR} (fine; continuing without overrides).`);
    }
  } catch (err) {
    pushMsg(messages, `No override dir at ${STATIC_OVERRIDES_DIR} (fine; continuing without overrides).`);
  }
  return out;
}

/**
 * Fetch Sleeper matchups for a given week (returns raw array from API or null on error)
 */
async function fetchSleeperWeekMatchups(fetchFn, week) {
  const url = `https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    return json;
  } catch (e) {
    return { __fetch_error: `${e?.message ?? e}` };
  }
}

/**
 * Convert a raw Sleeper matchup response item to our normalized per-matchup object:
 * { matchup_id, teamA: { rosterId, name?, ownerName? }, teamB: {...}, teamAScore, teamBScore, season, week }
 *
 * NOTE: roster/team name mapping might not be present in the Sleeper matchups endpoint; often mapping of rosterId->owner or team name is fetched from rosters endpoint.
 * For simplicity we carry rosterId and any available display fields, and rely on the override JSON (per-season files) to provide exact names if needed.
 */
function normalizeSleeperMatchup(raw, season, week, messages) {
  // raw is an item returned by Sleeper's matchups endpoint.
  // typical fields: matchup_id, rosters (array of roster_ids), starters_points/points arrays, etc.
  const normalized = {
    matchup_id: raw.matchup_id ?? (raw.id ?? null),
    season: season,
    week: week,
    // fallback team placeholders; name/owner may be provided by override JSON; roster ids are the main stable identifiers
    teamA: { rosterId: raw.rosters && raw.rosters[0] !== undefined ? String(raw.rosters[0]) : null, name: raw?.home_team ?? null },
    teamB: { rosterId: raw.rosters && raw.rosters[1] !== undefined ? String(raw.rosters[1]) : null, name: raw?.away_team ?? null },
    teamAScore: null,
    teamBScore: null,
    raw
  };

  try {
    const r0 = normalized.teamA.rosterId;
    const r1 = normalized.teamB.rosterId;
    const s0 = extractStarterScoreForRoster(raw, r0);
    const s1 = extractStarterScoreForRoster(raw, r1);

    if (s0 !== null && s1 !== null) {
      normalized.teamAScore = s0;
      normalized.teamBScore = s1;
    } else {
      // fallback and warn
      const p0 = (() => {
        if (Array.isArray(raw.points) && Array.isArray(raw.rosters)) {
          const idx = raw.rosters.indexOf(Number(r0)) !== -1 ? raw.rosters.indexOf(Number(r0)) : raw.rosters.indexOf(String(r0));
          if (idx !== -1) return safeNum(raw.points[idx]);
        }
        return null;
      })();
      const p1 = (() => {
        if (Array.isArray(raw.points) && Array.isArray(raw.rosters)) {
          const idx = raw.rosters.indexOf(Number(r1)) !== -1 ? raw.rosters.indexOf(Number(r1)) : raw.rosters.indexOf(String(r1));
          if (idx !== -1) return safeNum(raw.points[idx]);
        }
        return null;
      })();

      normalized.teamAScore = p0 !== null ? p0 : null;
      normalized.teamBScore = p1 !== null ? p1 : null;

      pushMsg(messages, `Warning: matchup ${normalized.matchup_id} week=${week} season=${season} missing starters_points; falling back to points.`);
    }
  } catch (e) {
    pushMsg(messages, `Error normalizing matchup week=${week} season=${season}: ${e?.message ?? e}`);
  }

  return normalized;
}

/**
 * Build seasonMatchups for all seasons:
 *  - use override JSONs for seasons present
 *  - fetch matchups for CURRENT_SEASON from Sleeper API
 *  - apply skip rule: if any participant has score === 0 using starters_points, skip that week (unless week === PLAYOFF_FINAL_WEEK)
 */
export async function load({ fetch }) {
  const messages = [];

  // 1) load overrides
  const overrides = await loadSeasonOverrides(messages);

  // If early2023.json exists under key 'early2023' or similar, keep it separately
  const early2023 = overrides['early2023'] || overrides['early_2023'] || overrides['2023-early'] || null;
  if (early2023) {
    pushMsg(messages, 'Loaded early2023 override (will apply canonicalization / first-3-weeks overrides).');
  }

  // seasonMatchups map we will return to the client
  const seasonMatchups = {};

  // process override seasons (non-2025)
  for (const key of Object.keys(overrides)) {
    // skip auxiliary files like early2023 (we'll store it separately)
    if (key === 'early2023' || key === 'early_2023' || key === 'early2023.json') continue;
    // if the override key is not a year (e.g., '2023') it's either auxiliary or a naming we don't understand
    if (!/^\d{4}$/.test(key)) {
      // but we already handled early2023 earlier; skip other unknown keys
      continue;
    }
    // Use override object for this season directly
    seasonMatchups[key] = overrides[key];
    // quick counts
    const wkCount = Object.keys(seasonMatchups[key]).filter(k => k !== 'season').length;
    let matchupsTotal = 0;
    for (const wk of Object.keys(seasonMatchups[key]).filter(k => k !== 'season')) {
      const arr = Array.isArray(seasonMatchups[key][wk]) ? seasonMatchups[key][wk] : [];
      matchupsTotal += arr.length;
    }
    pushMsg(messages, `Imported season ${key} from overrides: weeks=${wkCount}, matchups=${matchupsTotal}`);
  }

  // 2) fetch matchups for current season (2025) from Sleeper API
  // We'll try weeks 1..MAX_WEEKS and apply the "skip week" rule
  const currentSeasonKey = String(CURRENT_SEASON);
  seasonMatchups[currentSeasonKey] = {}; // will fill with weeks (1..N)
  let processedSeasons = 0;
  processedSeasons += Object.keys(seasonMatchups).length;

  for (let wk = 1; wk <= MAX_WEEKS; wk++) {
    // If an override exists for the current season and week, use the override instead of fetching (this allows local replacement)
    const overrideForWeek = (overrides[currentSeasonKey] && overrides[currentSeasonKey][String(wk)]) ? overrides[currentSeasonKey][String(wk)] : null;
    if (overrideForWeek) {
      // push local override into seasonMatchups
      seasonMatchups[currentSeasonKey][String(wk)] = overrideForWeek;
      pushMsg(messages, `Applying local override for season ${currentSeasonKey} week ${wk}`);
      continue;
    }

    // fetch from Sleeper
    const raw = await fetchSleeperWeekMatchups(fetch, wk);
    if (raw && raw.__fetch_error) {
      pushMsg(messages, `Failed fetching season=${currentSeasonKey} week=${wk} from Sleeper: ${raw.__fetch_error}`);
      // don't include this week
      continue;
    }

    if (!Array.isArray(raw) || raw.length === 0) {
      // no matchups (bye week?) still store empty array so client can see it
      seasonMatchups[currentSeasonKey][String(wk)] = [];
      pushMsg(messages, `Fetched season=${currentSeasonKey} week=${wk} — no matchups returned.`);
      continue;
    }

    // Normalize each raw matchup
    const normalizedList = raw.map(m => normalizeSleeperMatchup(m, currentSeasonKey, wk, messages));

    // Check skip condition: if any participant in any matchup has starters_points === 0, skip the entire week
    let foundZeroStarter = false;
    for (const nm of normalizedList) {
      // Check if raw has starters_points available and non-null (use extractStarterScoreForRoster)
      const rA = nm.teamA.rosterId;
      const rB = nm.teamB.rosterId;
      const sA = extractStarterScoreForRoster(nm.raw, rA);
      const sB = extractStarterScoreForRoster(nm.raw, rB);

      // if either sA or sB is explicitly 0 (and starters_points existed), we treat as incomplete
      // if starters_points didn't exist for this matchup (sA/sB null), we can't use skip by zero; we'll accept it but log a note
      if ((sA === 0) || (sB === 0)) {
        foundZeroStarter = true;
        break;
      }
    }

    if (foundZeroStarter && wk !== PLAYOFF_FINAL_WEEK) {
      pushMsg(messages, `Skipping season=${currentSeasonKey} week=${wk} (incomplete: a participant had 0 starters_points)`);
      // Do NOT include this week (so it's ignored when computing all-time tables)
      continue;
    }

    // Otherwise include normalized list
    seasonMatchups[currentSeasonKey][String(wk)] = normalizedList.map(n => {
      // convert normalized to the same simple shape as your per-season JSON (teamA/teamB names/rosterId and teamAScore/teamBScore fields)
      return {
        matchup_id: n.matchup_id,
        teamA: { rosterId: n.teamA.rosterId, name: n.teamA.name },
        teamB: { rosterId: n.teamB.rosterId, name: n.teamB.name },
        teamAScore: n.teamAScore,
        teamBScore: n.teamBScore,
        season: String(n.season),
        week: Number(n.week)
      };
    });

    pushMsg(messages, `Fetched season=${currentSeasonKey} week=${wk} — included ${seasonMatchups[currentSeasonKey][String(wk)].length} matchups.`);
  }

  // 3) Apply early-2023 override to weeks 1..3 of 2023 if present (you asked to use early2023.json specifically for overriding first 3 weeks)
  if (early2023) {
    const targetSeason = '2023';
    const earlyWeeks = ['1', '2', '3'];
    if (!seasonMatchups[targetSeason]) seasonMatchups[targetSeason] = {};
    for (const w of earlyWeeks) {
      if (early2023[w]) {
        seasonMatchups[targetSeason][w] = early2023[w];
        pushMsg(messages, `Applied early2023.json override to season ${targetSeason} week ${w}`);
      }
    }
  }

  // 4) Now compute aggregated tables (regularAllTime, playoffAllTime) using only matchup-level teamAScore/teamBScore values.
  // This is a conservative aggregator — it sums wins/losses across all seasons/weeks included in seasonMatchups.
  const regularAllTimeMap = {}; // key: teamKey (ownerName or rosterId or teamName), value: aggregated stats
  const playoffAllTimeMap = {};
  const originalRecords = {}; // preserve original owners if early2023 data used to canonicalize

  function ensureTeamSlot(map, teamKey, display) {
    if (!map[teamKey]) {
      map[teamKey] = {
        team: display || teamKey,
        owner_name: display || teamKey,
        wins: 0,
        losses: 0,
        maxWinStreak: 0,
        maxLoseStreak: 0,
        currentWinStreak: 0,
        currentLoseStreak: 0,
        pf: 0,
        pa: 0,
        playoffWins: 0,
        playoffLosses: 0,
        championships: 0
      };
    }
    return map[teamKey];
  }

  // canonicalization mapping: if early2023 specified we should map Bellooshio & cholybevv into jakepratt
  const canonicalMap = {};
  if (early2023) {
    // We'll canonicalize any owner/team names that appear as 'Bellooshio' or 'cholybevv' into 'jakepratt'
    canonicalMap['Bellooshio'] = 'jakepratt';
    canonicalMap['bellooshio'] = 'jakepratt';
    canonicalMap['cholybevv'] = 'jakepratt';
    canonicalMap['Cholybevv'] = 'jakepratt';
  }

  // We'll also collect debug matchup lines for the four requested teams
  const debugMatchupLines = [];

  for (const seasonKey of Object.keys(seasonMatchups)) {
    const weeksObj = seasonMatchups[seasonKey] || {};
    for (const wkKey of Object.keys(weeksObj).filter(k => k !== 'season')) {
      const wk = Number(wkKey);
      const arr = Array.isArray(weeksObj[wkKey]) ? weeksObj[wkKey] : [];
      for (const mu of arr) {
        // expected mu shape from your provided JSON: {matchup_id, teamA:{rosterId,name,ownerName?}, teamB: {...}, teamAScore, teamBScore, season, week}
        const teamAname = (mu.teamA && (mu.teamA.name || mu.teamA.ownerName || mu.teamA.owner || mu.teamA.rosterId)) || (mu.teamA?.rosterId ? `roster:${mu.teamA.rosterId}` : 'TeamA');
        const teamBname = (mu.teamB && (mu.teamB.name || mu.teamB.ownerName || mu.teamB.owner || mu.teamB.rosterId)) || (mu.teamB?.rosterId ? `roster:${mu.teamB.rosterId}` : 'TeamB');
        const scoreA = safeNum(mu.teamAScore ?? mu.teamA?.teamAScore ?? mu.teamA?.score ?? mu.teamA?.points);
        const scoreB = safeNum(mu.teamBScore ?? mu.teamB?.teamBScore ?? mu.teamB?.score ?? mu.teamB?.points);

        // apply canonicalization if owner name matches Bellooshio or cholybevv (we detect ownerName fields when present)
        let ownerA = (mu.teamA && (mu.teamA.ownerName || mu.teamA.owner || mu.teamA.owner_name)) || teamAname;
        let ownerB = (mu.teamB && (mu.teamB.ownerName || mu.teamB.owner || mu.teamB.owner_name)) || teamBname;

        // Save original owner entries for preserved record view (if any)
        if (mu.teamA && mu.teamA.ownerName) {
          const k = mu.teamA.ownerName;
          if (!originalRecords[k]) {
            originalRecords[k] = {
              team: teamAname,
              regWins: 0, regLosses: 0, regPF: 0, regPA: 0,
              playoffWins: 0, playoffLosses: 0, playoffPF: 0, playoffPA: 0,
              championships: 0
            };
          }
        }
        if (mu.teamB && mu.teamB.ownerName) {
          const k = mu.teamB.ownerName;
          if (!originalRecords[k]) {
            originalRecords[k] = {
              team: teamBname,
              regWins: 0, regLosses: 0, regPF: 0, regPA: 0,
              playoffWins: 0, playoffLosses: 0, playoffPF: 0, playoffPA: 0,
              championships: 0
            };
          }
        }

        // canonicalization
        if (canonicalMap[ownerA]) ownerA = canonicalMap[ownerA];
        if (canonicalMap[ownerB]) ownerB = canonicalMap[ownerB];

        // choose teamKey as ownerA or team name fallback
        const teamKeyA = ownerA || teamAname;
        const teamKeyB = ownerB || teamBname;

        // populate maps
        const isPlayoff = wk > REGULAR_SEASON_WEEKS;
        const mapA = ensureTeamSlot(isPlayoff ? playoffAllTimeMap : regularAllTimeMap, teamKeyA, teamAname);
        const mapB = ensureTeamSlot(isPlayoff ? playoffAllTimeMap : regularAllTimeMap, teamKeyB, teamBname);

        // only count if both scores are numbers (some entries may have null due to incomplete weeks)
        if (Number.isFinite(scoreA) && Number.isFinite(scoreB)) {
          // winner determination
          if (scoreA > scoreB) {
            mapA.wins += 1;
            mapB.losses += 1;
            if (isPlayoff) {
              mapA.playoffWins = (mapA.playoffWins || 0) + 1;
              mapB.playoffLosses = (mapB.playoffLosses || 0) + 1;
            }
          } else if (scoreB > scoreA) {
            mapB.wins += 1;
            mapA.losses += 1;
            if (isPlayoff) {
              mapB.playoffWins = (mapB.playoffWins || 0) + 1;
              mapA.playoffLosses = (mapA.playoffLosses || 0) + 1;
            }
          } else {
            // tie -> do nothing to wins/losses but we still count GP if you want to display GP later
          }

          mapA.pf = safeNum(mapA.pf) + scoreA;
          mapA.pa = safeNum(mapA.pa) + scoreB;
          mapB.pf = safeNum(mapB.pf) + scoreB;
          mapB.pa = safeNum(mapB.pa) + scoreA;

          // update originalRecords preserved (use full season stats if early2023 provided those)
          const origAKey = mu.teamA?.ownerName;
          const origBKey = mu.teamB?.ownerName;
          if (origAKey && originalRecords[origAKey]) {
            if (isPlayoff) {
              originalRecords[origAKey].playoffWins += scoreA > scoreB ? 1 : 0;
              originalRecords[origAKey].playoffLosses += scoreA < scoreB ? 1 : 0;
              originalRecords[origAKey].playoffPF = safeNum(originalRecords[origAKey].playoffPF) + scoreA;
              originalRecords[origAKey].playoffPA = safeNum(originalRecords[origAKey].playoffPA) + scoreB;
            } else {
              originalRecords[origAKey].regWins += scoreA > scoreB ? 1 : 0;
              originalRecords[origAKey].regLosses += scoreA < scoreB ? 1 : 0;
              originalRecords[origAKey].regPF = safeNum(originalRecords[origAKey].regPF) + scoreA;
              originalRecords[origAKey].regPA = safeNum(originalRecords[origAKey].regPA) + scoreB;
            }
          }
          if (origBKey && originalRecords[origBKey]) {
            if (isPlayoff) {
              originalRecords[origBKey].playoffWins += scoreB > scoreA ? 1 : 0;
              originalRecords[origBKey].playoffLosses += scoreB < scoreA ? 1 : 0;
              originalRecords[origBKey].playoffPF = safeNum(originalRecords[origBKey].playoffPF) + scoreB;
              originalRecords[origBKey].playoffPA = safeNum(originalRecords[origBKey].playoffPA) + scoreA;
            } else {
              originalRecords[origBKey].regWins += scoreB > scoreA ? 1 : 0;
              originalRecords[origBKey].regLosses += scoreB < scoreA ? 1 : 0;
              originalRecords[origBKey].regPF = safeNum(originalRecords[origBKey].regPF) + scoreB;
              originalRecords[origBKey].regPA = safeNum(originalRecords[origBKey].regPA) + scoreA;
            }
          }

          // If this matchup includes a debug team, add a line to debugMatchupLines
          const checkNames = [teamAname, teamBname, teamKeyA, teamKeyB].map(x => String(x || '').trim());
          for (const t of DEBUG_TEAMS) {
            if (checkNames.includes(t)) {
              const opponent = (checkNames[0] === t) ? checkNames[1] : (checkNames[1] === t ? checkNames[0] : null);
              debugMatchupLines.push(`${t} vs ${opponent || '(unknown)'} — ${scoreA} - ${scoreB} (season ${seasonKey} week ${wk})`);
            }
          }
        } else {
          // incomplete matchup - store a message
          pushMsg(messages, `Skipped counting matchup ${mu.matchup_id ?? 'unknown'} season=${seasonKey} week=${wk} because scores incomplete (A:${mu.teamAScore} B:${mu.teamBScore})`);
        }
      } // end for each matchup
    } // end for each week
  } // end for each season

  // convert maps to sorted arrays for the page
  function mapToSortedArray(map) {
    const arr = Object.keys(map).map(k => {
      const v = map[k];
      return {
        team: v.team || k,
        owner_name: v.owner_name || k,
        wins: v.wins || 0,
        losses: v.losses || 0,
        maxWinStreak: v.maxWinStreak || 0,
        maxLoseStreak: v.maxLoseStreak || 0,
        pf: v.pf || 0,
        pa: v.pa || 0,
        playoffWins: v.playoffWins || 0,
        playoffLosses: v.playoffLosses || 0,
        championships: v.championships || 0
      };
    });

    // default sort: wins desc, pf desc
    arr.sort((a, b) => {
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      return (b.pf || 0) - (a.pf || 0);
    });
    return arr;
  }

  const regularAllTime = mapToSortedArray(regularAllTimeMap);
  const playoffAllTime = mapToSortedArray(playoffAllTimeMap);

  // Build owners list (simple extraction from maps)
  const ownersList = Object.keys({ ...regularAllTimeMap, ...playoffAllTimeMap }).map(k => {
    const r = regularAllTimeMap[k] || playoffAllTimeMap[k];
    return { ownerKey: k, owner_name: r?.owner_name || k, team: r?.team || k };
  }).sort((a, b) => (a.ownerKey > b.ownerKey ? 1 : -1));

  // Top team matchups / top player matchups / closestMatches / largestMargins are left as pass-through placeholders.
  // If you had earlier logic to compute those, replace the placeholders below with your old logic. For now we return empty arrays or compute simplistic versions for team matchups from seasonMatchups.
  const topTeamMatchups = []; // you can compute this from seasonMatchups if desired
  const topPlayerMatchups = []; // needs player-level data; omit here
  const closestMatches = []; // compute if needed
  const largestMargins = []; // compute if needed

  // Format debug messages: include the detailed matchup lines for debug teams
  if (debugMatchupLines.length) {
    pushMsg(messages, 'DEBUG: Matchups for monitored teams:');
    for (const line of debugMatchupLines) {
      pushMsg(messages, ` - ${line}`);
    }
  } else {
    pushMsg(messages, 'DEBUG: No monitored-team matchups found in processed matchups.');
  }

  // Summary lines: seasons processed
  pushMsg(messages, `Processed ${Object.keys(seasonMatchups).length} seasons; generated seasonMatchups keys: ${Object.keys(seasonMatchups).join(', ')}`);

  // final returned payload (page.svelte expects many of these keys)
  return {
    regularAllTime,
    playoffAllTime,
    originalRecords,
    topTeamMatchups,
    topPlayerMatchups,
    closestMatches,
    largestMargins,
    headToHeadByOwner: {}, // keep old logic or compute separately; left as empty placeholder
    ownersList,
    players: {}, // players map not computed here
    seasonMatchups,
    messages
  };
}
