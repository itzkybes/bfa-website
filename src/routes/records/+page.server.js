// src/routes/matchups/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { readFile, readdir } from 'fs/promises';
import path from 'path';

let cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) cache = createKVCache(globalThis.KV);
  else cache = createMemoryCache();
} catch (e) {
  cache = createMemoryCache();
}

const SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
const sleeper = createSleeperClient({ cache, concurrency: SLEEPER_CONCURRENCY });

const BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID)
  ? process.env.BASE_LEAGUE_ID
  : '1219816671624048640';
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// tryLoadEarly2023 kept for backwards compatibility (still used if needed)
async function tryLoadEarly2023(origin) {
  try {
    if (typeof fetch === 'function' && origin) {
      const url = origin.replace(/\/$/, '') + '/early2023.json';
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res && res.ok) {
          const txt = await res.text();
          try { return JSON.parse(txt); } catch (e) { /* disk fallback */ }
        }
      } catch (e) { /* disk fallback */ }
    }
  } catch (e) { /* ignore */ }

  try {
    const fileUrl = new URL('../../../static/early2023.json', import.meta.url);
    const txt = await readFile(fileUrl, 'utf8');
    try { return JSON.parse(txt); } catch (e) { return null; }
  } catch (e) {
    return null;
  }
}

/**
 * New: read all JSON files under static/season_matchups
 * expects folder: ../../../static/season_matchups relative to this file
 * returns { [season]: parsedJson }
 */
async function readAllSeasonMatchupFiles(messages = []) {
  const out = {};
  // same directory as early2023.json
  try {
    const folderUrl = new URL('../../../static/season_matchups', import.meta.url);
    const folderPath = folderUrl.pathname;
    let files;
    try {
      files = await readdir(folderPath);
    } catch (e) {
      messages.push(`No override dir found at ${folderPath}`);
      return out;
    }
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.json')) continue;
      const full = path.join(folderPath, f);
      try {
        const txt = await readFile(full, 'utf8');
        const parsed = JSON.parse(txt);
        // infer season key from filename
        const m = f.match(/(20\d{2})/);
        const seasonKey = m ? m[1] : f.replace(/\.json$/i, '');
        out[seasonKey] = { file: f, path: full, json: parsed };
        messages.push(`Loaded override file for season=${seasonKey} from ${full}`);
      } catch (err) {
        messages.push(`Failed to read/parse ${full}: ${err?.message ?? err}`);
      }
    }
    return out;
  } catch (err) {
    messages.push(`Error locating season_matchups folder: ${err?.message ?? err}`);
    return out;
  }
}

/**
 * Normalize a JSON payload (your example had shape { "1":[...], "2":[...], ... })
 * to an object: { weekNumber: [matchup, ...], ... }
 */
function normalizeSeasonJson(payload) {
  const weeks = {};
  if (!payload) return weeks;
  // if payload already keyed by season (e.g., { "2023": { "1": [...] } })
  // callers should pass payload for that season (not the full wrapper)
  if (Array.isArray(payload)) {
    // unknown mapping, attempt to bucket by "week" property on entries
    for (const m of payload) {
      const wk = Number(m.week ?? m.w ?? m.week_number ?? 0) || 0;
      if (!weeks[wk]) weeks[wk] = [];
      weeks[wk].push(m);
    }
    return weeks;
  }
  for (const [k, v] of Object.entries(payload)) {
    const wk = Number(k);
    if (!Number.isNaN(wk)) weeks[wk] = Array.isArray(v) ? v : [];
  }
  return weeks;
}

/**
 * Helper to prefer starters_points when present in Sleeper API row
 */
function getPointsFromSleeperRow(row) {
  if (!row) return 0;
  // common keys to check (prioritize starters_points)
  const candidates = [
    'starters_points', 'starters_points_total', 'starters_points_sum',
    'startersPoints', 'starters_points_total', 'points', 'points_for', 'pts', 'score'
  ];
  for (const k of candidates) {
    if (typeof row[k] === 'number') return row[k];
  }
  // some shapes have nested object with starters_points
  for (const v of Object.values(row)) {
    if (v && typeof v === 'object') {
      for (const k of candidates) {
        if (typeof v[k] === 'number') return v[k];
      }
    }
  }
  return 0;
}

export async function load(event) {
  // cache for edge
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];

  // --- discover seasons (existing logic kept) ---
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { mainLeague = null; }
    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id), season: mainLeague.season ?? null, name: mainLeague.name ?? null });
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prev = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prev) break;
          seasons.push({ league_id: String(prev.league_id), season: prev.season ?? null, name: prev.name ?? null });
          currPrev = prev.previous_league_id ? String(prev.previous_league_id) : null;
        } catch (err) { break; }
      }
    }
  } catch (err) {
    messages.push(`Error discovering league chain: ${err?.message ?? err}`);
  }

  // de-dupe + sort ascending by season
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  seasons = Object.values(byId);
  seasons.sort((a,b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return (a.season < b.season ? -1 : (a.season > b.season ? 1 : 0));
  });

  // selected season / week handling (keep your existing logic)
  const url = event.url;
  const seasonParam = url.searchParams.get('season') ?? null;
  let selectedSeason = seasonParam;
  if (!selectedSeason) {
    if (seasons.length) selectedSeason = seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id;
  }

  // find matching league id for selectedSeason (either season value or league_id)
  let selectedLeagueId = null;
  for (const s of seasons) {
    if (String(s.season) === String(selectedSeason) || String(s.league_id) === String(selectedSeason)) {
      selectedLeagueId = String(s.league_id);
      selectedSeason = s.season ?? selectedSeason;
      break;
    }
  }
  if (!selectedLeagueId && seasons.length) selectedLeagueId = seasons[seasons.length - 1].league_id;

  // load league metadata to determine playoff start
  let leagueMeta = null;
  try {
    leagueMeta = selectedLeagueId ? await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }) : null;
  } catch (e) { leagueMeta = null; }

  let playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  const lastRegularWeek = Math.max(1, playoffStart - 1);
  const weeks = [];
  for (let w = 1; w <= lastRegularWeek; w++) weeks.push(w);

  // playoff weeks (small range)
  const playoffWeeks = [];
  const playoffEnd = Math.min(MAX_WEEKS, playoffStart + 2);
  for (let w = playoffStart; w <= playoffEnd; w++) playoffWeeks.push(w);

  // selected week param
  const weekParamRaw = url.searchParams.get('week');
  let selectedWeek = null;
  if (weekParamRaw != null) {
    const wp = Number(weekParamRaw);
    selectedWeek = Number.isFinite(wp) && wp >= 1 ? wp : null;
  }
  if (!selectedWeek) selectedWeek = 1;
  if (selectedWeek > MAX_WEEKS) selectedWeek = MAX_WEEKS;

  // fetch roster map for selected league (to use latest team names/avatars)
  let rosterMap = {};
  try {
    if (selectedLeagueId) rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    else rosterMap = {};
  } catch (e) { rosterMap = {}; }

  // normalize rosterMap for easy searching (lowercased lookups)
  const rosterByOwner = {};
  const rosterByTeamName = {};
  try {
    for (const rk of Object.keys(rosterMap || {})) {
      const meta = rosterMap[rk] || {};
      if (meta.owner_name) rosterByOwner[String(meta.owner_name).toLowerCase()] = { id: String(rk), meta };
      if (meta.owner_username) rosterByOwner[String(meta.owner_username).toLowerCase()] = { id: String(rk), meta };
      if (meta.team_name) rosterByTeamName[String(meta.team_name).toLowerCase()] = { id: String(rk), meta };
    }
  } catch (e) { /* ignore */ }

  function findRosterMeta(ownerName, teamName) {
    if (!ownerName && !teamName) return null;
    if (ownerName) {
      const low = String(ownerName).toLowerCase();
      if (rosterByOwner[low]) return rosterByOwner[low];
      const trimmed = low.trim();
      if (trimmed && rosterByOwner[trimmed]) return rosterByOwner[trimmed];
    }
    if (teamName) {
      const lowt = String(teamName).toLowerCase();
      if (rosterByTeamName[lowt]) return rosterByTeamName[lowt];
      const trimmedt = lowt.trim();
      if (trimmedt && rosterByTeamName[trimmedt]) return rosterByTeamName[trimmedt];
    }
    return null;
  }

  // --- New: read static season files (season_matchups folder) ---
  const seasonFiles = await readAllSeasonMatchupFiles(messages); // { '2022': {file,path,json}, ... }

  // normalize files into seasonMatchups: season -> week -> [matchup objects]
  const seasonMatchups = {};
  for (const s of ['2022','2023','2024']) seasonMatchups[s] = {}; // ensure older seasons exist
  seasonMatchups['2025'] = {}; // ensure current season key exists

  for (const [seasonKey, meta] of Object.entries(seasonFiles)) {
    const norm = normalizeSeasonJson(meta.json);
    seasonMatchups[seasonKey] = {};
    for (const [wkStr, arr] of Object.entries(norm)) {
      const wk = Number(wkStr);
      if (Number.isNaN(wk) || wk <= 0) continue;
      // Normalize each matchup to a consistent shape like your example
      seasonMatchups[seasonKey][wk] = (Array.isArray(arr) ? arr : []).map((m, idx) => {
        // many files use teamA/teamB + teamAScore/teamBScore
        const teamA = m.teamA || m.home || m.team1 || {};
        const teamB = m.teamB || m.away || m.team2 || {};
        const teamAScore = (typeof m.teamAScore === 'number') ? m.teamAScore : safeNum(m.teamA?.score ?? m.teamA?.points ?? m.teamAScore ?? 0);
        const teamBScore = (typeof m.teamBScore === 'number') ? m.teamBScore : safeNum(m.teamB?.score ?? m.teamB?.points ?? m.teamBScore ?? 0);

        // try to resolve roster id via rosterMap if ownerName/teamName present
        const aMatch = findRosterMeta(teamA.ownerName || teamA.owner || teamA.owner_name, teamA.name || teamA.team || teamA.team_name);
        const bMatch = findRosterMeta(teamB.ownerName || teamB.owner || teamB.owner_name, teamB.name || teamB.team || teamB.team_name);

        const aRosterId = aMatch ? aMatch.id : (teamA.rosterId ?? teamA.roster_id ?? null);
        const bRosterId = bMatch ? bMatch.id : (teamB.rosterId ?? teamB.roster_id ?? null);

        const aAvatar = aMatch ? (aMatch.meta.team_avatar || aMatch.meta.owner_avatar || null) : (teamA.avatar ?? teamA.team_avatar ?? null);
        const bAvatar = bMatch ? (bMatch.meta.team_avatar || bMatch.meta.owner_avatar || null) : (teamB.avatar ?? teamB.team_avatar ?? null);

        return {
          matchup_id: m.matchup_id ?? m.matchupId ?? `override-${seasonKey}-${wk}-${idx}`,
          season: Number(seasonKey),
          week: wk,
          teamA: { rosterId: aRosterId, name: teamA.name || teamA.team || teamA.team_name || `Roster ${aRosterId || 'A'}`, ownerName: teamA.ownerName || teamA.owner || teamA.owner_name || null, avatar: aAvatar, points: teamAScore },
          teamB: { rosterId: bRosterId, name: teamB.name || teamB.team || teamB.team_name || `Roster ${bRosterId || 'B'}`, ownerName: teamB.ownerName || teamB.owner || teamB.owner_name || null, avatar: bAvatar, points: teamBScore },
          participantsCount: (teamA ? 1 : 0) + (teamB ? 1 : 0),
          _source: meta.file || 'override'
        };
      });
    }
    messages.push(`Imported season ${seasonKey}: weeks=${Object.keys(seasonMatchups[seasonKey] || {}).length}`);
  }

  // --- Fetch current season (2025) matchups from Sleeper per-week ---
  // Use BASE_LEAGUE_ID (which you set to the 2025 league id) — use sleeper.getMatchupsForWeek
  messages.push(`Fetching matchups for 2025 from Sleeper (league ${BASE_LEAGUE_ID})`);
  for (let wk = 1; wk <= MAX_WEEKS; wk++) {
    try {
      const raw = await sleeper.getMatchupsForWeek(BASE_LEAGUE_ID, wk, { ttl: 60 * 5 }).catch(e => { throw e; }) || [];
      // Normalize sleeper style rows into our match shape grouped by matchup_id
      // raw is array of participant entries
      // group by matchup id if present
      const byMatch = {};
      for (let i = 0; i < raw.length; i++) {
        const ent = raw[i];
        const mid = (ent.matchup_id ?? ent.matchupId ?? ent.matchup) ?? `auto-${i}`;
        const weekNum = ent.week ?? wk;
        const key = `${mid}|${weekNum}`;
        if (!byMatch[key]) byMatch[key] = [];
        byMatch[key].push(ent);
      }

      // build normalized match list for this week
      const normalizedWeek = [];
      for (const [key, entries] of Object.entries(byMatch)) {
        // if entries length === 2, assume head-to-head
        if (entries.length === 2) {
          const a = entries[0], b = entries[1];
          // use starters_points if available
          const aPts = getPointsFromSleeperRow(a);
          const bPts = getPointsFromSleeperRow(b);

          const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
          const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
          const aMeta = rosterMap[aId] || {};
          const bMeta = rosterMap[bId] || {};
          const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
          const bName = bMeta.team_name || bMeta.owner_name || ('Roster ' + bId);
          const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
          const bAvatar = bMeta.team_avatar || bMeta.owner_avatar || null;

          normalizedWeek.push({
            matchup_id: `${key}`,
            season: 2025,
            week: wk,
            teamA: { rosterId: aId, name: aName, ownerName: aMeta.owner_name ?? null, avatar: aAvatar, points: safeNum(aPts) },
            teamB: { rosterId: bId, name: bName, ownerName: bMeta.owner_name ?? null, avatar: bAvatar, points: safeNum(bPts) },
            participantsCount: 2,
            _source: 'sleeper'
          });
        } else if (entries.length === 1) {
          const e = entries[0];
          const pts = getPointsFromSleeperRow(e);
          const id = String(e.roster_id ?? e.rosterId ?? e.owner_id ?? e.ownerId ?? 'unknown');
          const meta = rosterMap[id] || {};
          normalizedWeek.push({
            matchup_id: `${key}`,
            season: 2025,
            week: wk,
            teamA: { rosterId: id, name: meta.team_name || meta.owner_name || ('Roster ' + id), ownerName: meta.owner_name ?? null, avatar: meta.team_avatar || meta.owner_avatar || null, points: safeNum(pts) },
            teamB: null,
            participantsCount: 1,
            isBye: true,
            _source: 'sleeper'
          });
        } else {
          // more than two participants (multi-team match)
          const participants = entries.map(ent => {
            const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
            const m = rosterMap[pid] || {};
            return { rosterId: pid, name: m.team_name || m.owner_name || ('Roster ' + pid), avatar: m.team_avatar || m.owner_avatar || null, points: safeNum(getPointsFromSleeperRow(ent)) };
          });
          normalizedWeek.push({
            matchup_id: key,
            season: 2025,
            week: wk,
            combinedParticipants: participants,
            combinedLabel: participants.map(p => p.name).join(' / '),
            participantsCount: participants.length,
            _source: 'sleeper'
          });
        }
      }

      // now check completeness: skip weeks with a participant at 0 points (except if it's final playoff week)
      const incomplete = normalizedWeek.some(m => {
        if (m.teamA && m.teamB) {
          return (Number(m.teamA.points) === 0 || Number(m.teamB.points) === 0);
        }
        // combined or single participant cases: if any participant has 0 -> incomplete
        if (m.combinedParticipants) return m.combinedParticipants.some(p => Number(p.points) === 0);
        if (m.teamA && !m.teamB) return Number(m.teamA.points) === 0;
        return false;
      });

      // Determine final playoff week from leagueMeta if available; fallback = MAX_WEEKS
      const finalPlayoffWeek = Number(process.env.PLAYOFF_FINAL_WEEK || MAX_WEEKS);

      if (incomplete && wk !== finalPlayoffWeek) {
        messages.push(`Skipping 2025 week=${wk} (incomplete: participant with 0 points)`);
        continue;
      }
      seasonMatchups['2025'][wk] = normalizedWeek;
      messages.push(`Fetched & normalized 2025 week=${wk} — matchups: ${normalizedWeek.length}`);
    } catch (err) {
      messages.push(`Error fetching 2025 week=${wk}: ${err?.message ?? err}`);
    }
  }

  // --- At this point seasonMatchups contains data for 2022/2023/2024 from JSON files, and 2025 from Sleeper fetch ---
  // Prepare matchupsRows for the selectedSeason/selectedWeek (what the page expects)
  let matchupsRows = [];
  const seasonKeyStr = String(selectedSeason);
  if (seasonMatchups[seasonKeyStr] && seasonMatchups[seasonKeyStr][selectedWeek]) {
    matchupsRows = seasonMatchups[seasonKeyStr][selectedWeek];
  } else {
    // fallback: if not available, attempt to fetch single-week via sleeper (if selectedSeason===2025)
    if (String(selectedSeason) === '2025') {
      try {
        const raw = await sleeper.getMatchupsForWeek(BASE_LEAGUE_ID, selectedWeek, { ttl: 60 * 5 }) || [];
        // reuse logic above: group and normalize (but keep simpler)
        const byMatch = {};
        for (let i = 0; i < raw.length; i++) {
          const e = raw[i];
          const mid = (e.matchup_id ?? e.matchupId ?? e.matchup) ?? `auto-${i}`;
          const wk = e.week ?? selectedWeek;
          const key = `${mid}|${wk}`;
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(e);
        }
        for (const [k, entries] of Object.entries(byMatch)) {
          if (entries.length === 2) {
            const a = entries[0], b = entries[1];
            const aPts = getPointsFromSleeperRow(a);
            const bPts = getPointsFromSleeperRow(b);
            const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
            const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
            const aMeta = rosterMap[aId] || {};
            const bMeta = rosterMap[bId] || {};
            matchupsRows.push({
              matchup_id: k,
              season: 2025,
              week: selectedWeek,
              teamA: { rosterId: aId, name: aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), ownerName: aMeta.owner_name ?? null, avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: safeNum(aPts) },
              teamB: { rosterId: bId, name: bMeta.team_name || bMeta.owner_name || ('Roster ' + bId), ownerName: bMeta.owner_name ?? null, avatar: bMeta.team_avatar || bMeta.owner_avatar || null, points: safeNum(bPts) },
              participantsCount: 2,
              _source: 'sleeper'
            });
          } else if (entries.length === 1) {
            const e = entries[0];
            const pts = getPointsFromSleeperRow(e);
            const id = String(e.roster_id ?? e.rosterId ?? e.owner_id ?? e.ownerId ?? 'unknown');
            const meta = rosterMap[id] || {};
            matchupsRows.push({
              matchup_id: k,
              season: 2025,
              week: selectedWeek,
              teamA: { rosterId: id, name: meta.team_name || meta.owner_name || ('Roster ' + id), ownerName: meta.owner_name ?? null, avatar: meta.team_avatar || meta.owner_avatar || null, points: safeNum(pts) },
              teamB: null,
              participantsCount: 1,
              isBye: true,
              _source: 'sleeper'
            });
          } else {
            const participants = entries.map(ent => {
              const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
              const m = rosterMap[pid] || {};
              return { rosterId: pid, name: m.team_name || m.owner_name || ('Roster ' + pid), avatar: m.team_avatar || m.owner_avatar || null, points: safeNum(getPointsFromSleeperRow(ent)) };
            });
            matchupsRows.push({
              matchup_id: k,
              season: 2025,
              week: selectedWeek,
              combinedParticipants: participants,
              combinedLabel: participants.map(p => p.name).join(' / '),
              participantsCount: participants.length,
              _source: 'sleeper'
            });
          }
        }
        // sort as before
        matchupsRows.sort((x,y) => {
          const ax = (x.teamA && x.teamA.points != null) ? x.teamA.points : (x.combinedParticipants ? (x.combinedParticipants[0]?.points || 0) : 0);
          const by = (y.teamA && y.teamA.points != null) ? y.teamA.points : (y.combinedParticipants ? (y.combinedParticipants[0]?.points || 0) : 0);
          return (by - ax);
        });
      } catch (e) {
        messages.push(`Fallback fetch for 2025 week=${selectedWeek} failed: ${e?.message ?? e}`);
      }
    } else {
      messages.push(`No matchups found for season=${selectedSeason} week=${selectedWeek}`);
    }
  }

  const weekOptions = {
    regular: weeks,
    playoffs: playoffWeeks
  };

  // Prepare import summary to show counts per season
  const importSummary = Object.fromEntries(
    Object.entries(seasonMatchups).map(([season, weeksMap]) => {
      const wkKeys = Object.keys(weeksMap || {}).map(k => Number(k)).filter(n => !Number.isNaN(n) && n > 0);
      const totalMatchups = Object.values(weeksMap || {}).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      return [season, { weeks: wkKeys.length, matchups: totalMatchups }];
    })
  );

  return {
    seasons,
    weeks,
    playoffWeeks,
    weekOptions,
    selectedSeason,
    selectedWeek,
    rosterMap,
    seasonMatchups,   // full normalized per-season matchups derived from static files + fetched 2025
    matchupsRows,     // the rows for the selectedSeason/selectedWeek the page expects
    importSummary,
    messages
  };
}
