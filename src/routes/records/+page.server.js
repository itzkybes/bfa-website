// src/routes/records/+page.server.js
import fs from 'fs/promises';
import path from 'path';

// SvelteKit load on server
export async function load({ fetch, url }) {
  const messages = [];
  const seasonMatchups = {}; // season -> { week -> [matchups] }

  // CONFIG
  const PROJECT_ROOT = process.cwd();
  const OVERRIDE_DIR = path.join(PROJECT_ROOT, 'static', 'season_matchups'); // where 2022.json, 2023.json, ...
  const seasonsToLoad = [2022, 2023, 2024]; // finished seasons you created JSON files for
  const currentSeason = 2025;
  const leagueIdCurrent = '1219816671624048640'; // given league id for 2025
  const maxWeekDefault = 23; // fallback max week to iterate for current season
  const playoffFinalWeek = Number(process.env.PLAYOFF_FINAL_WEEK || 23); // treat this week as "final playoff week"

  // Helper: safe number
  function safeNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  // Try to read JSON override from disk (multiple candidate filenames)
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
    return null;
  }

  // Try to load early2023.json (either from request origin or static disk)
  async function tryLoadEarly2023(origin) {
    // try fetch from origin/early2023.json if fetch available and origin provided
    if (typeof fetch === 'function' && origin) {
      const url = origin.replace(/\/$/, '') + '/early2023.json';
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res && res.ok) {
          try {
            const parsed = await res.json();
            messages.push(`Loaded early2023.json from origin ${origin}`);
            return parsed;
          } catch (e) {
            // fallthrough to disk
          }
        } else {
          messages.push(`No early2023.json at ${url} (status ${res?.status})`);
        }
      } catch (e) {
        messages.push(`Error fetching early2023.json from origin ${origin}: ${e?.message ?? e}`);
      }
    }

    // disk fallback (static/early2023.json)
    try {
      const fileUrl = new URL('../../../static/early2023.json', import.meta.url);
      const txt = await fs.readFile(fileUrl, 'utf8');
      try {
        const parsed = JSON.parse(txt);
        messages.push('Loaded early2023.json from disk static/early2023.json');
        return parsed;
      } catch (e) {
        messages.push('Failed to parse early2023.json from disk');
        return null;
      }
    } catch (e) {
      messages.push('No early2023.json found on disk');
      return null;
    }
  }

  // Helper: detect if week is "complete" (no participant with zero score) — conservative
  function weekIsComplete(matchups, season, week) {
    if (!Array.isArray(matchups) || matchups.length === 0) return true; // nothing to skip
    for (const m of matchups) {
      // If explicit teamAScore/teamBScore fields exist
      if (typeof m.teamAScore === 'number' || typeof m.teamBScore === 'number') {
        const a = Number(m.teamAScore ?? 0);
        const b = Number(m.teamBScore ?? 0);
        if (a === 0 || b === 0) return false;
        continue;
      }
      // If object shaped as { teamA: {...}, teamB: {...}, teamAScore: n, teamBScore: n }
      if (m.teamA && m.teamB) {
        const a = Number(m.teamAScore ?? 0);
        const b = Number(m.teamBScore ?? 0);
        if (a === 0 || b === 0) return false;
        continue;
      }
      // Otherwise check numeric values on the object (be conservative)
      const numericVals = Object.values(m)
        .flatMap(v => (Array.isArray(v) ? v : [v]))
        .filter(v => typeof v === 'number');
      if (numericVals.length > 0) {
        if (numericVals.some(n => n === 0)) return false;
        continue;
      }
      // no numeric evidence -> permissive
    }
    return true;
  }

  // 1) Load per-season override JSONs from disk (if present)
  const loadedPerSeason = {};
  for (const season of seasonsToLoad) {
    try {
      const parsed = await tryReadSeasonFile(season);
      if (parsed) {
        loadedPerSeason[String(season)] = parsed;
      } else {
        messages.push(`No override file found for season=${season} in ${OVERRIDE_DIR}`);
      }
    } catch (e) {
      messages.push(`Error reading override for season=${season}: ${e?.message ?? e}`);
    }
  }

  // 2) Remote fallback attempt (origin and hard-coded vercel hostname)
  const HARDCODE_ORIGIN = 'https://bfa-website-tau.vercel.app';
  const origin = (url && url.origin) ? String(url.origin).replace(/\/$/, '') : null;
  const candidateOrigins = [];
  if (origin) candidateOrigins.push(origin);
  candidateOrigins.push(HARDCODE_ORIGIN);

  if (typeof fetch === 'function') {
    for (const s of seasonsToLoad) {
      const key = String(s);
      if (loadedPerSeason[key]) continue; // already loaded
      let found = false;
      for (const base of candidateOrigins) {
        const candidateUrl = `${base.replace(/\/$/, '')}/season_matchups/${key}.json`;
        try {
          const r = await fetch(candidateUrl, { method: 'GET' });
          if (r && r.ok) {
            const parsed = await r.json();
            loadedPerSeason[key] = parsed;
            messages.push(`Fetched override season=${key} from ${candidateUrl}`);
            found = true;
            break;
          } else {
            messages.push(`No remote override at ${candidateUrl} (status ${r?.status})`);
          }
        } catch (err) {
          messages.push(`Error fetching ${candidateUrl}: ${err?.message ?? err}`);
        }
      }
      if (!found) {
        messages.push(`Tried remote override URLs for season=${key}: ${candidateOrigins.join(', ')}`);
      }
    }
  } else {
    messages.push('fetch not available in server environment; skipped remote override attempts');
  }

  // 3) Normalize loadedPerSeason into seasonMatchups (season -> weekNum -> array)
  for (const season of seasonsToLoad) {
    const s = String(season);
    seasonMatchups[s] = {};
    const json = loadedPerSeason[s];
    if (!json) {
      messages.push(`No matchups imported for season ${s}`);
      continue;
    }
    let weeksCount = 0;
    let matchupsCount = 0;
    for (const [wk, arr] of Object.entries(json)) {
      const wkNum = Number(wk);
      if (Number.isNaN(wkNum)) continue;
      seasonMatchups[s][wkNum] = Array.isArray(arr) ? arr : [];
      weeksCount++;
      matchupsCount += Array.isArray(arr) ? arr.length : 0;
    }
    messages.push(`Imported season=${s} — weeks: ${weeksCount} — matchups: ${matchupsCount}`);
  }

  // 4) For currentSeason fetch from Sleeper API per-week (use fetch passed into load)
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

      // Skip incomplete weeks unless it's the final playoff week
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

  // 5) Try to load early2023.json (to override weeks 1-3 of 2023)
  let early2023 = null;
  try {
    early2023 = await tryLoadEarly2023(origin);
    if (!early2023) messages.push('early2023.json not available (will not override 2023 early weeks)');
  } catch (e) {
    messages.push(`Error loading early2023.json: ${e?.message ?? e}`);
    early2023 = null;
  }

  // 6) Normalize / flatten matchups for aggregator and compute standings
  // Helper: compute score for a Sleeper participant entry (prefer starters_points)
  function computeParticipantScore(part) {
    if (!part) return 0;
    // starters_points may be an array or a number or undefined
    const sp = part.starters_points ?? part.startersPoints ?? part.starters_points_sum;
    if (Array.isArray(sp)) {
      return sp.reduce((s, x) => s + safeNum(x), 0);
    }
    if (typeof sp === 'number') return safeNum(sp);

    // players_points might be an object or array; if array sum
    const pp = part.players_points ?? part.playersPoints;
    if (Array.isArray(pp)) return pp.reduce((s, x) => s + safeNum(x), 0);
    if (typeof pp === 'number') return safeNum(pp);

    // numeric aliases
    const cand = (part.points ?? part.points_for ?? part.pts ?? part.score ?? part.total_points ?? part.points_total);
    if (typeof cand === 'number') return safeNum(cand);

    // If there's nested teamAScore/teamBScore fields (override style)
    if (typeof part.teamAScore === 'number') return safeNum(part.teamAScore);
    if (typeof part.teamBScore === 'number') return safeNum(part.teamBScore);

    // Nothing we recognize
    return 0;
  }

  // Normalize a single week's raw matchups array into array of { week, season, teamA: {name, ownerName, rosterId, points}, teamB: {...}, source }
  function normalizeWeekMatchups(rawArr, season, week, sourceHint = 'override') {
    const out = [];
    if (!Array.isArray(rawArr)) return out;

    // If the raw entries already have teamA/teamB fields (early2023.json style)
    const looksLikeOverride = rawArr.length > 0 && rawArr.every(r => r && (r.teamA || r.teamAScore || r.teamA?.name));
    if (looksLikeOverride) {
      for (let i = 0; i < rawArr.length; i++) {
        const e = rawArr[i];
        const teamA = e.teamA ?? null;
        const teamB = e.teamB ?? null;
        const aPts = safeNum(e.teamAScore ?? teamA?.score ?? teamA?.teamAScore ?? teamA?.points ?? teamA?.points_for ?? 0);
        const bPts = safeNum(e.teamBScore ?? teamB?.score ?? teamB?.teamBScore ?? teamB?.points ?? teamB?.points_for ?? 0);
        out.push({
          season,
          week,
          matchup_id: e.matchup_id ?? e.matchupId ?? `override-${season}-${week}-${i}`,
          teamA: {
            rosterId: teamA?.rosterId ?? teamA?.rosterId ?? teamA?.rosterId ?? teamA?.rosterId ?? null,
            name: teamA?.name ?? teamA?.team ?? teamA?.team_name ?? teamA?.ownerName ?? teamA?.ownerName ?? null,
            ownerName: teamA?.ownerName ?? teamA?.owner ?? null,
            points: aPts
          },
          teamB: teamB ? {
            rosterId: teamB?.rosterId ?? null,
            name: teamB?.name ?? teamB?.team ?? teamB?.team_name ?? teamB?.ownerName ?? null,
            ownerName: teamB?.ownerName ?? teamB?.owner ?? null,
            points: bPts
          } : null,
          participantsCount: teamB ? 2 : 1,
          _source: sourceHint
        });
      }
      return out;
    }

    // Otherwise assume Sleeper API raw format: an array of participant objects for that week (each row is a participant)
    // We'll group by matchup_id if present, otherwise by pairing in sequence (matchup id may be present on each participant)
    const byMatch = {};
    for (let i = 0; i < rawArr.length; i++) {
      const entry = rawArr[i] || {};
      const mid = (entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? entry.matchup_id ?? null);
      const wk = entry.week ?? entry.w ?? week;
      const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${Math.floor(i/2)}`; // fallback pairing by 2s
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(entry);
    }

    for (const [k, group] of Object.entries(byMatch)) {
      if (!Array.isArray(group) || group.length === 0) continue;
      if (group.length === 1) {
        const a = group[0];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknown');
        out.push({
          season,
          week,
          matchup_id: `${k}`,
          teamA: {
            rosterId: aId,
            name: a.team_name ?? a.team ?? a.owner_name ?? `Roster ${aId}`,
            ownerName: a.owner_name ?? a.owner ?? null,
            points: computeParticipantScore(a)
          },
          teamB: null,
          participantsCount: 1,
          _source: 'sleeper'
        });
      } else if (group.length >= 2) {
        // take first two participants and treat as teamA and teamB
        // try to find two distinct roster ids
        const a = group[0];
        const b = group[1];

        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
        const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');

        out.push({
          season,
          week,
          matchup_id: `${k}`,
          teamA: {
            rosterId: aId,
            name: a.team_name ?? a.team ?? a.owner_name ?? (`Roster ${aId}`),
            ownerName: a.owner_name ?? a.owner ?? null,
            points: computeParticipantScore(a)
          },
          teamB: {
            rosterId: bId,
            name: b.team_name ?? b.team ?? b.owner_name ?? (`Roster ${bId}`),
            ownerName: b.owner_name ?? b.owner ?? null,
            points: computeParticipantScore(b)
          },
          participantsCount: group.length,
          _source: 'sleeper'
        });
      }
    }

    return out;
  }

  // 7) Aggregation engine: consume seasonMatchups and return aggregated standings
  function createStandingsFromSeasonMatchups(allSeasonMatchups, early2023Overrides = null) {
    // standings maps keyed by normalized team label (teamName || owner)
    const regStandings = {}; // teamKey -> stats
    const playStandings = {};
    const debugMatchups = []; // collect matchups for debugTeams later

    // helper updaters
    function ensureTeam(statsMap, key, meta = {}) {
      if (!statsMap[key]) {
        statsMap[key] = {
          team: meta.team ?? key,
          owner_name: meta.owner ?? meta.owner_name ?? null,
          rosterId: meta.rosterId ?? null,
          wins: 0,
          losses: 0,
          pf: 0,
          pa: 0,
          maxWinStreak: 0,
          maxLoseStreak: 0,
          currentStreakSign: null, // 'W' or 'L'
          currentStreakLen: 0,
          championships: 0
        };
      }
      return statsMap[key];
    }

    function registerResult(statsMap, teamKey, opponentKey, teamPts, oppPts) {
      const t = ensureTeam(statsMap, teamKey);
      const o = ensureTeam(statsMap, opponentKey);
      // points
      t.pf += safeNum(teamPts);
      t.pa += safeNum(oppPts);
      // win/lose
      if (safeNum(teamPts) > safeNum(oppPts)) {
        t.wins += 1;
        // update streaks
        if (t.currentStreakSign === 'W') {
          t.currentStreakLen += 1;
        } else {
          t.currentStreakSign = 'W';
          t.currentStreakLen = 1;
        }
        if (t.currentStreakLen > t.maxWinStreak) t.maxWinStreak = t.currentStreakLen;
        // opponent loses streak
        if (o.currentStreakSign === 'L') {
          o.currentStreakLen += 1;
        } else {
          o.currentStreakSign = 'L';
          o.currentStreakLen = 1;
        }
        if (o.currentStreakLen > o.maxLoseStreak) o.maxLoseStreak = o.currentStreakLen;
      } else if (safeNum(teamPts) < safeNum(oppPts)) {
        t.losses += 1;
        if (t.currentStreakSign === 'L') {
          t.currentStreakLen += 1;
        } else {
          t.currentStreakSign = 'L';
          t.currentStreakLen = 1;
        }
        if (t.currentStreakLen > t.maxLoseStreak) t.maxLoseStreak = t.currentStreakLen;

        // opponent wins
        if (o.currentStreakSign === 'W') {
          o.currentStreakLen += 1;
        } else {
          o.currentStreakSign = 'W';
          o.currentStreakLen = 1;
        }
        if (o.currentStreakLen > o.maxWinStreak) o.maxWinStreak = o.currentStreakLen;
      } else {
        // tie -> treat as half-win/half-loss? here we do nothing to wins/losses to keep consistent with original system
      }
    }

    // We'll process seasons sorted ascending, weeks sorted ascending.
    const seasons = Object.keys(allSeasonMatchups).map(s => Number(s)).filter(n => !Number.isNaN(n)).sort((a,b) => a - b);

    // Default playoff start week for seasons where we don't know: 15
    const DEFAULT_PLAYOFF_START = 15;

    for (const season of seasons) {
      const sKey = String(season);
      // Determine playoffStart: try to infer from metadata file if present (not guaranteed) else default
      // (We don't have league metadata here for historical seasons by default.)
      const playoffStart = DEFAULT_PLAYOFF_START;

      const weeksObj = allSeasonMatchups[sKey] || {};
      const weekNums = Object.keys(weeksObj).map(k => Number(k)).filter(n => !Number.isNaN(n)).sort((a,b) => a - b);

      // If early2023Overrides provided AND season===2023, ensure weeks 1-3 replaced by early data
      for (const wk of weekNums) {
        let rawWeekArr = weeksObj[wk] ?? [];
        // override for 2023 weeks 1..3
        if (Number(season) === 2023 && early2023Overrides && early2023Overrides['2023'] && early2023Overrides['2023'][String(wk)]) {
          rawWeekArr = early2023Overrides['2023'][String(wk)];
          messages.push(`Applying early2023.json override for season=2023 week=${wk}`);
        }

        // normalize rawWeekArr into canonical matchups
        const normalized = normalizeWeekMatchups(rawWeekArr, season, wk, Number(season) === 2023 && wk <= 3 ? 'early2023' : 'override_or_sleeper');
        // Process each matchup
        for (const m of normalized) {
          // skip if single-participant (bye)
          if (!m.teamB) {
            // nothing to record
            continue;
          }
          const aName = m.teamA.name || (`Roster ${m.teamA.rosterId || 'A'}`);
          const bName = m.teamB.name || (`Roster ${m.teamB.rosterId || 'B'}`);
          const aKey = String(aName);
          const bKey = String(bName);
          const aPts = safeNum(m.teamA.points ?? 0);
          const bPts = safeNum(m.teamB.points ?? 0);

          // Determine if this week is regular or playoff
          const isPlayoff = wk >= playoffStart;

          if (!isPlayoff) {
            registerResult(regStandings, aKey, bKey, aPts, bPts);
            registerResult(regStandings, bKey, aKey, bPts, aPts);
          } else {
            registerResult(playStandings, aKey, bKey, aPts, bPts);
            registerResult(playStandings, bKey, aKey, bPts, aPts);
          }

          // Collect debug matchups for target teams (we'll filter later)
          debugMatchups.push({
            season,
            week: wk,
            matchup_id: m.matchup_id,
            teamA: { name: aName, rosterId: m.teamA.rosterId ?? null, points: aPts },
            teamB: { name: bName, rosterId: m.teamB.rosterId ?? null, points: bPts },
            source: m._source ?? null
          });
        }
      }
    }

    // Convert standings map to arrays and compute some final fields
    function finalize(statsMap) {
      const arr = Object.values(statsMap).map(s => {
        // ensure max streaks are numeric
        s.maxWinStreak = s.maxWinStreak || 0;
        s.maxLoseStreak = s.maxLoseStreak || 0;
        return {
          team: s.team,
          owner_name: s.owner_name,
          rosterId: s.rosterId,
          wins: s.wins,
          losses: s.losses,
          pf: Number(s.pf.toFixed ? s.pf.toFixed(2) : s.pf),
          pa: Number(s.pa.toFixed ? s.pa.toFixed(2) : s.pa),
          maxWinStreak: s.maxWinStreak,
          maxLoseStreak: s.maxLoseStreak,
          championships: s.championships || 0
        };
      });

      // sort by wins desc, then pf desc
      arr.sort((A,B) => {
        if ((B.wins ?? 0) !== (A.wins ?? 0)) return (B.wins ?? 0) - (A.wins ?? 0);
        if ((B.pf ?? 0) !== (A.pf ?? 0)) return (B.pf ?? 0) - (A.pf ?? 0);
        return (A.team || '').localeCompare(B.team || '');
      });
      return arr;
    }

    const regularAllTime = finalize(regStandings);
    const playoffAllTime = finalize(playStandings);

    return { regularAllTime, playoffAllTime, debugMatchups };
  }

  // compute standings using seasonMatchups and early2023 overrides
  const { regularAllTime, playoffAllTime, debugMatchups } = createStandingsFromSeasonMatchups(seasonMatchups, early2023);

  // 8) Build an importSummary for display
  const importSummary = Object.fromEntries(
    Object.entries(seasonMatchups).map(([season, weeks]) => {
      const wkKeys = Object.keys(weeks).map(k => Number(k)).sort((a,b) => a-b);
      const totalMatchups = Object.values(weeks).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      return [season, { weeks: wkKeys.length, matchups: totalMatchups }];
    })
  );

  // 9) Table checks placeholders
  const tableChecks = {
    regularAllTime: regularAllTime && regularAllTime.length ? 'OK' : 'MISSING',
    playoffAllTime: playoffAllTime && playoffAllTime.length ? 'OK' : 'MISSING',
    ownersList: 'OK',
    topTeamScores: 'OK',
    topPlayerScores: 'OK'
  };

  // 10) Provide a convenience list of debug teams to print on the page
  const debugTeams = [
    'The Emperors',
    'DAMN!!!!!!!!!!!!!!!!!',
    'Corey’s Shower',
    "Corey's Shower"
  ];

  // 11) For convenience, filter debugMatchups for debugTeams (case-insensitive)
  const debugMatchupsForTeams = debugMatchups.filter(m => {
    const names = [String(m.teamA?.name ?? '').toLowerCase(), String(m.teamB?.name ?? '').toLowerCase()];
    return debugTeams.some(dt => names.includes(String(dt).toLowerCase()));
  });

  // Return everything page.svelte expects
  return {
    seasonMatchups,
    importSummary,
    tableChecks,
    messages,
    debugTeams,
    debugMatchups: debugMatchupsForTeams,
    regularAllTime,
    playoffAllTime
  };
}
