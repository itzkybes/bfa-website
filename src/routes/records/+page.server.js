// src/routes/records/+page.server.js
import fs from 'fs/promises';
import path from 'path';

// SvelteKit load on server
export async function load({ fetch, url }) {
  const messages = [];
  const seasonMatchups = {}; // season -> { week -> [matchups] }

  // CONFIG
  const PROJECT_ROOT = process.cwd();
  const OVERRIDE_DIR = path.join(PROJECT_ROOT, 'static', 'season_matchups'); // expected to contain 2022.json, 2023.json, ...
  const seasonsToLoad = [2022, 2023, 2024]; // explicit seasons to load (one-by-one)
  const currentSeason = 2025;
  const leagueIdCurrent = '1219816671624048640'; // given league id for 2025
  const maxWeekDefault = 23;
  const playoffFinalWeek = Number(process.env.PLAYOFF_FINAL_WEEK || 23);
  const HARDCODE_ORIGIN = 'https://bfa-website-tau.vercel.app';
  const origin = (url && url.origin) ? String(url.origin).replace(/\/$/, '') : null;

  // helper
  function safeNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  // ----- fetch-or-disk helpers -----
  // Try to fetch a public static file from origin or hard-coded origin
  async function tryFetchStaticJSON(fetchFn, baseOrigin, relPath) {
    if (!fetchFn || !baseOrigin) return null;
    const candidate = `${baseOrigin.replace(/\/$/, '')}${relPath.startsWith('/') ? '' : '/'}${relPath}`;
    try {
      const res = await fetchFn(candidate, { method: 'GET' });
      if (res && res.ok) {
        try {
          const parsed = await res.json();
          messages.push(`Fetched JSON from ${candidate}`);
          return parsed;
        } catch (e) {
          messages.push(`Failed parsing JSON from ${candidate}: ${e?.message ?? e}`);
          return null;
        }
      } else {
        messages.push(`No JSON at ${candidate} (status ${res?.status ?? 'no response'})`);
      }
    } catch (err) {
      messages.push(`Error fetching ${candidate}: ${err?.message ?? err}`);
    }
    return null;
  }

  // Try read from disk (static/...)
  async function tryReadDiskJSON(relPathFromStatic) {
    try {
      // compute path relative to /static in source tree
      const fileUrl = new URL(`../../../${relPathFromStatic.replace(/^\//, '')}`, import.meta.url);
      const txt = await fs.readFile(fileUrl, 'utf8');
      try {
        const parsed = JSON.parse(txt);
        messages.push(`Loaded JSON from disk ${relPathFromStatic}`);
        return parsed;
      } catch (e) {
        messages.push(`Failed parsing disk JSON ${relPathFromStatic}: ${e?.message ?? e}`);
        return null;
      }
    } catch (e) {
      messages.push(`No disk file ${relPathFromStatic}: ${e?.message ?? e}`);
      return null;
    }
  }

  // Try load early2023.json (origin fetch -> hardcoded origin -> disk)
  async function tryLoadEarly2023() {
    // try origin first (if provided)
    if (fetch && origin) {
      const got = await tryFetchStaticJSON(fetch, origin, '/early2023.json');
      if (got) return got;
    }
    // try HARDCODE origin
    if (fetch) {
      const got = await tryFetchStaticJSON(fetch, HARDCODE_ORIGIN, '/early2023.json');
      if (got) return got;
    }
    // disk fallback
    return await tryReadDiskJSON('early2023.json');
  }

  // Try load season_matchups/{season}.json explicitly (no directory scan)
  async function tryLoadSeasonMatchups(season) {
    const relPath = `season_matchups/${season}.json`;
    // try request origin
    if (fetch && origin) {
      const got = await tryFetchStaticJSON(fetch, origin, `/${relPath}`);
      if (got) return got;
    }
    // try hard-coded vercel origin
    if (fetch) {
      const got = await tryFetchStaticJSON(fetch, HARDCODE_ORIGIN, `/${relPath}`);
      if (got) return got;
    }
    // disk fallback
    return await tryReadDiskJSON(relPath);
  }

  // ----- week completeness helper (conservative) -----
  function weekIsComplete(matchups) {
    if (!Array.isArray(matchups) || matchups.length === 0) return true;
    for (const m of matchups) {
      // common override fields
      if (typeof m.teamAScore === 'number' || typeof m.teamBScore === 'number') {
        const a = Number(m.teamAScore ?? 0);
        const b = Number(m.teamBScore ?? 0);
        if (a === 0 || b === 0) return false;
        continue;
      }
      if (m.teamA && m.teamB) {
        const a = Number(m.teamAScore ?? m.teamA?.points ?? 0);
        const b = Number(m.teamBScore ?? m.teamB?.points ?? 0);
        if (a === 0 || b === 0) return false;
        continue;
      }
      // otherwise check numeric values
      const numeric = Object.values(m).flatMap(v => Array.isArray(v) ? v : [v]).filter(v => typeof v === 'number');
      if (numeric.length > 0 && numeric.some(n => n === 0)) return false;
    }
    return true;
  }

  // ----- participant scoring preference (starters_points) -----
  function computeParticipantScore(part) {
    if (!part || typeof part !== 'object') return 0;

    // prefer starters_points forms (arrays or numbers)
    const startersKeys = ['starters_points', 'startersPoints', 'starter_points', 'starterPoints'];
    for (const k of startersKeys) {
      if (Array.isArray(part[k]) && part[k].length) {
        return part[k].reduce((s, x) => s + safeNum(x), 0);
      }
      if (typeof part[k] === 'number') return safeNum(part[k]);
    }

    // players_points array/object
    if (Array.isArray(part.players_points)) {
      return part.players_points.reduce((s,x) => s + safeNum(x), 0);
    }
    if (typeof part.players_points === 'object' && part.starters && Array.isArray(part.starters)) {
      // sum by starter ids if player_points maps ids->points
      let s = 0;
      for (const st of part.starters) s += safeNum(part.players_points[String(st)]);
      return s;
    }

    // fallback numeric fields
    const fallback = part.points ?? part.points_for ?? part.pts ?? part.score ?? 0;
    return safeNum(fallback);
  }

  // ----- normalization of raw week matchups into canonical pairs -----
  function normalizeWeekMatchups(rawArr, season, week, sourceHint = 'override') {
    const out = [];
    if (!Array.isArray(rawArr)) return out;

    // detect early/override style: entries with teamA/teamB
    const overrideLike = rawArr.length && rawArr.every(r => r && (r.teamA || r.teamAScore || r.teamA?.name));
    if (overrideLike) {
      for (let i = 0; i < rawArr.length; i++) {
        const e = rawArr[i];
        const a = e.teamA ?? null;
        const b = e.teamB ?? null;
        const aPts = safeNum(e.teamAScore ?? a?.points ?? a?.score ?? 0);
        const bPts = safeNum(e.teamBScore ?? b?.points ?? b?.score ?? 0);
        out.push({
          season,
          week,
          matchup_id: e.matchup_id ?? `override-${season}-${week}-${i}`,
          teamA: { rosterId: a?.rosterId ?? null, name: a?.name ?? a?.team ?? null, ownerName: a?.ownerName ?? null, points: aPts },
          teamB: b ? { rosterId: b?.rosterId ?? null, name: b?.name ?? b?.team ?? null, ownerName: b?.ownerName ?? null, points: bPts } : null,
          participantsCount: b ? 2 : 1,
          _source: sourceHint
        });
      }
      return out;
    }

    // otherwise assume Sleeper API participant rows; group by matchup id or pair by two
    const byMatch = {};
    for (let i = 0; i < rawArr.length; i++) {
      const e = rawArr[i] || {};
      const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
      const wk = e.week ?? e.w ?? week;
      const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${Math.floor(i/2)}`;
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(e);
    }

    for (const [k, group] of Object.entries(byMatch)) {
      if (!group || group.length === 0) continue;
      if (group.length === 1) {
        const a = group[0];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
        out.push({
          season,
          week,
          matchup_id: k,
          teamA: { rosterId: aId, name: a.team_name ?? a.team ?? a.owner_name ?? `Roster ${aId}`, ownerName: a.owner_name ?? null, points: computeParticipantScore(a) },
          teamB: null,
          participantsCount: 1,
          _source: 'sleeper'
        });
      } else {
        const a = group[0];
        const b = group[1];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
        const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
        out.push({
          season,
          week,
          matchup_id: k,
          teamA: { rosterId: aId, name: a.team_name ?? a.team ?? a.owner_name ?? `Roster ${aId}`, ownerName: a.owner_name ?? null, points: computeParticipantScore(a) },
          teamB: { rosterId: bId, name: b.team_name ?? b.team ?? b.owner_name ?? `Roster ${bId}`, ownerName: b.owner_name ?? null, points: computeParticipantScore(b) },
          participantsCount: group.length,
          _source: 'sleeper'
        });
      }
    }
    return out;
  }

  // ----- 1) Load explicit season JSONs (2022,2023,2024) individually -----
  for (const season of seasonsToLoad) {
    seasonMatchups[String(season)] = {};
    messages.push(`Attempting to load season_matchups ${season} via origin/hardcode/disk (explicit single-file checks)`);

    const json = await tryLoadSeasonMatchups(season);
    if (!json) {
      messages.push(`No matchups imported for season ${season}`);
      continue;
    }
    // Expect shape like { "1": [matchups], "2": [...], ... }
    let weeksCount = 0;
    let matchupsCount = 0;
    for (const [wk, arr] of Object.entries(json)) {
      const wkNum = Number(wk);
      if (Number.isNaN(wkNum)) continue;
      seasonMatchups[String(season)][wkNum] = Array.isArray(arr) ? arr : [];
      weeksCount++;
      matchupsCount += Array.isArray(arr) ? arr.length : 0;
    }
    messages.push(`Imported season=${season} — weeks: ${weeksCount} — matchups: ${matchupsCount}`);
  }

  // ----- 2) Fetch current season (2025) matchups from Sleeper per-week -----
  seasonMatchups[String(currentSeason)] = {};
  messages.push(`Fetching matchups for current season ${currentSeason} from Sleeper for league ${leagueIdCurrent}`);
  const maxWeek = Number(process.env.MAX_WEEK || maxWeekDefault);

  for (let week = 1; week <= maxWeek; week++) {
    try {
      const urlMatchups = `https://api.sleeper.app/v1/league/${leagueIdCurrent}/matchups/${week}`;
      if (!fetch) {
        messages.push(`Error fetching season=${currentSeason} week=${week}: fetch is not a function`);
        break; // avoid repeating fetch-not-a-function for every week
      }
      const res = await fetch(urlMatchups);
      if (!res || !res.ok) {
        messages.push(`Sleeper API: failed to fetch season=${currentSeason} week=${week} — status ${res?.status ?? 'no response'}`);
        continue;
      }
      const matchups = await res.json();

      // If incomplete and not final playoff week, skip
      const incomplete = !weekIsComplete(matchups);
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

  // ----- 3) Load early2023.json (origin->hardcode->disk) and log it -----
  const early2023 = await tryLoadEarly2023();
  if (early2023) {
    messages.push('early2023.json loaded and available for 2023 weeks 1-3 override');
  } else {
    messages.push('early2023.json not available (will not override 2023 early weeks)');
  }

  // ----- 4) Aggregation: consume seasonMatchups -> normalized matchups -> build standings -----
  function createStandingsFromSeasonMatchups(allSeasonMatchups, early2023Overrides = null) {
    const regMap = {}; // teamKey -> stats
    const playMap = {};
    const debugMatchups = [];

    function ensureTeam(map, key) {
      if (!map[key]) {
        map[key] = {
          team: key,
          wins: 0,
          losses: 0,
          pf: 0,
          pa: 0,
          maxWinStreak: 0,
          maxLoseStreak: 0,
          curSign: null,
          curLen: 0
        };
      }
      return map[key];
    }

    function applyResult(map, teamKey, oppKey, teamPts, oppPts) {
      const T = ensureTeam(map, teamKey);
      const O = ensureTeam(map, oppKey);

      T.pf += safeNum(teamPts);
      T.pa += safeNum(oppPts);

      if (safeNum(teamPts) > safeNum(oppPts)) {
        T.wins += 1;
        if (T.curSign === 'W') T.curLen += 1; else { T.curSign = 'W'; T.curLen = 1; }
        if (T.curLen > T.maxWinStreak) T.maxWinStreak = T.curLen;

        // opponent
        if (O.curSign === 'L') O.curLen += 1; else { O.curSign = 'L'; O.curLen = 1; }
        if (O.curLen > O.maxLoseStreak) O.maxLoseStreak = O.curLen;

      } else if (safeNum(teamPts) < safeNum(oppPts)) {
        T.losses += 1;
        if (T.curSign === 'L') T.curLen += 1; else { T.curSign = 'L'; T.curLen = 1; }
        if (T.curLen > T.maxLoseStreak) T.maxLoseStreak = T.curLen;

        // opponent
        if (O.curSign === 'W') O.curLen += 1; else { O.curSign = 'W'; O.curLen = 1; }
        if (O.curLen > O.maxWinStreak) O.maxWinStreak = O.curLen;
      } else {
        // tie: do nothing to wins/losses for now
      }
    }

    // process seasons sorted ascending
    const seasons = Object.keys(allSeasonMatchups).map(s => Number(s)).filter(n => !Number.isNaN(n)).sort((a,b) => a-b);
    const DEFAULT_PLAYOFF_START = 15;

    for (const season of seasons) {
      const sKey = String(season);
      const weeksObj = allSeasonMatchups[sKey] || {};
      const weekNums = Object.keys(weeksObj).map(k => Number(k)).filter(n => !Number.isNaN(n)).sort((a,b) => a-b);
      // determine playoff start (we don't have per-season league meta here; use default)
      const playoffStart = DEFAULT_PLAYOFF_START;

      for (const wk of weekNums) {
        let raw = weeksObj[wk] ?? [];

        // If 2023 and we have early2023Overrides, apply for weeks 1..3
        if (Number(season) === 2023 && early2023Overrides && early2023Overrides['2023'] && early2023Overrides['2023'][String(wk)]) {
          raw = early2023Overrides['2023'][String(wk)];
          messages.push(`Applying early2023 override for season=2023 week=${wk}`);
        }

        const normalized = normalizeWeekMatchups(raw, season, wk, Number(season) === 2023 && wk <= 3 ? 'early2023' : 'override_or_sleeper');

        for (const m of normalized) {
          if (!m.teamB) continue; // bye/no-op
          const aName = m.teamA.name || (`Roster ${m.teamA.rosterId || 'A'}`);
          const bName = m.teamB.name || (`Roster ${m.teamB.rosterId || 'B'}`);
          const aPts = safeNum(m.teamA.points ?? 0);
          const bPts = safeNum(m.teamB.points ?? 0);
          const aKey = String(aName);
          const bKey = String(bName);
          const isPlayoff = (wk >= playoffStart);

          if (!isPlayoff) {
            applyResult(regMap, aKey, bKey, aPts, bPts);
            applyResult(regMap, bKey, aKey, bPts, aPts);
          } else {
            applyResult(playMap, aKey, bKey, aPts, bPts);
            applyResult(playMap, bKey, aKey, bPts, aPts);
          }

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

    function finalize(map) {
      const arr = Object.values(map).map(s => ({
        team: s.team,
        wins: s.wins,
        losses: s.losses,
        pf: Number((s.pf || 0).toFixed ? s.pf.toFixed(2) : s.pf),
        pa: Number((s.pa || 0).toFixed ? s.pa.toFixed(2) : s.pa),
        maxWinStreak: s.maxWinStreak || 0,
        maxLoseStreak: s.maxLoseStreak || 0
      }));
      arr.sort((A,B) => {
        if ((B.wins || 0) !== (A.wins || 0)) return (B.wins || 0) - (A.wins || 0);
        return (B.pf || 0) - (A.pf || 0);
      });
      return arr;
    }

    return { regularAllTime: finalize(regMap), playoffAllTime: finalize(playMap), debugMatchups };
  }

  const { regularAllTime, playoffAllTime, debugMatchups } = createStandingsFromSeasonMatchups(seasonMatchups, early2023);

  // importSummary
  const importSummary = Object.fromEntries(
    Object.entries(seasonMatchups).map(([season, weeks]) => {
      const wkKeys = Object.keys(weeks).map(k => Number(k)).filter(n => !Number.isNaN(n)).sort((a,b) => a-b);
      const totalMatchups = Object.values(weeks).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      return [season, { weeks: wkKeys.length, matchups: totalMatchups }];
    })
  );

  // some table checks (informational)
  const tableChecks = {
    regularAllTime: regularAllTime && regularAllTime.length ? 'OK' : 'MISSING',
    playoffAllTime: playoffAllTime && playoffAllTime.length ? 'OK' : 'MISSING'
  };

  // filter debug matchups for a few teams of interest to show on page
  const debugTeams = ['The Emperors', 'DAMN!!!!!!!!!!!!!!!!!', 'Corey’s Shower', "Corey's Shower"];
  const debugMatchupsForTeams = debugMatchups.filter(m => {
    const names = [String(m.teamA?.name ?? '').toLowerCase(), String(m.teamB?.name ?? '').toLowerCase()];
    return debugTeams.some(dt => names.includes(String(dt).toLowerCase()));
  });

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
