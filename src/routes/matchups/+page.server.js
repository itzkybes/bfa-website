// src/routes/matchups/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { readFile } from 'fs/promises';

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

async function tryLoadEarly2023(origin) {
  // Try to fetch from same origin (deployed static), then fallback to reading from disk.
  // Return parsed JSON or null.
  // NOTE: this function swallows errors and returns null on failure.
  try {
    if (typeof fetch === 'function' && origin) {
      const url = origin.replace(/\/$/, '') + '/early2023.json';
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res && res.ok) {
          const txt = await res.text();
          try {
            const parsed = JSON.parse(txt);
            return parsed;
          } catch (e) {
            // fallthrough to disk fallback
          }
        }
      } catch (e) {
        // continue to disk fallback
      }
    }
  } catch (e) {
    // ignore
  }

  // Disk fallback: attempt to read static/early2023.json relative to this file.
  try {
    // from src/routes/matchups/+page.server.js -> project root is ../../../
    const fileUrl = new URL('../../../static/early2023.json', import.meta.url);
    const txt = await readFile(fileUrl, 'utf8');
    try {
      const parsed = JSON.parse(txt);
      return parsed;
    } catch (e) {
      return null;
    }
  } catch (e) {
    return null;
  }
}

export async function load(event) {
  // cache for edge
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  // build season chain (same approach as records page)
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
    // ignore; we'll return empty seasons if necessary
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

  // choose season param or default to most recent
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
  } catch (e) {
    leagueMeta = null;
  }

  let playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  const weeks = [];
  const lastRegularWeek = Math.max(1, playoffStart - 1);
  for (let w = 1; w <= lastRegularWeek; w++) weeks.push(w);

  const playoffWeeks = [];
  const playoffEnd = Math.min(MAX_WEEKS, playoffStart + 2);
  for (let w = playoffStart; w <= playoffEnd; w++) playoffWeeks.push(w);

  // selected week param (or default to 1 if not provided)
  const weekParamRaw = url.searchParams.get('week');
  let selectedWeek = null;
  if (weekParamRaw != null) {
    const wp = Number(weekParamRaw);
    selectedWeek = Number.isFinite(wp) && wp >= 1 ? wp : null;
  }
  // default to week 1 per request
  if (!selectedWeek) selectedWeek = 1;
  if (selectedWeek > MAX_WEEKS) selectedWeek = MAX_WEEKS;

  // fetch roster map for selected league (to use latest team names/avatars)
  let rosterMap = {};
  try {
    if (selectedLeagueId) rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    else rosterMap = {};
  } catch (e) { rosterMap = {}; }

  // Attempt to load early2023.json if needed
  let earlyData = null;
  if (String(selectedSeason) === '2023' && selectedWeek >= 1 && selectedWeek <= 3) {
    // try loading; pass origin so fetch uses same host
    try {
      earlyData = await tryLoadEarly2023(event.url?.origin || null);
    } catch (e) {
      earlyData = null;
    }
  }

  // If earlyData contains the week, build matchupsRows from that JSON
  const matchupsRows = [];
  if (earlyData && earlyData['2023'] && earlyData['2023'][String(selectedWeek)] && earlyData['2023'][String(selectedWeek)].length) {
    const weekArr = earlyData['2023'][String(selectedWeek)];
    // Each entry is expected to be { teamA: { name, ownerName }, teamB: {...}, teamAScore, teamBScore }
    for (const entry of weekArr) {
      const aName = entry?.teamA?.name ?? 'Roster A';
      const bName = entry?.teamB?.name ?? 'Roster B';
      const aOwner = entry?.teamA?.ownerName ?? null;
      const bOwner = entry?.teamB?.ownerName ?? null;
      const aPts = safeNum(entry?.teamAScore ?? entry?.teamA?.score ?? 0);
      const bPts = safeNum(entry?.teamBScore ?? entry?.teamB?.score ?? 0);

      // We don't know roster IDs from the JSON; keep rosterId null but include ownerName for mapping.
      matchupsRows.push({
        matchup_id: `early2023-${selectedWeek}-${matchupsRows.length}`,
        season: selectedSeason,
        week: selectedWeek,
        teamA: { rosterId: null, name: aName, ownerName: aOwner, avatar: null, points: aPts },
        teamB: { rosterId: null, name: bName, ownerName: bOwner, avatar: null, points: bPts },
        participantsCount: 2,
        _source: 'early2023.json'
      });
    }

    // sort to keep consistent ordering (desc teamA.points)
    matchupsRows.sort((x,y) => ( (y.teamA?.points || 0) - (x.teamA?.points || 0) ));
  } else {
    // No early JSON mapping for this week/season — fallback to Sleeper API matchups
    let rawMatchups = [];
    try {
      if (selectedLeagueId && selectedWeek >= 1) {
        rawMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, selectedWeek, { ttl: 60 * 5 }) || [];
      }
    } catch (e) {
      rawMatchups = [];
    }

    // group matchups by matchup id / week
    const byMatch = {};
    for (let i = 0; i < rawMatchups.length; i++) {
      const e = rawMatchups[i];
      const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
      const wk = e.week ?? e.w ?? selectedWeek;
      const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(e);
    }

    for (const k of Object.keys(byMatch)) {
      const entries = byMatch[k];
      if (!entries || entries.length === 0) continue;

      if (entries.length === 2) {
        const a = entries[0];
        const b = entries[1];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
        const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
        const aMeta = rosterMap[aId] || {};
        const bMeta = rosterMap[bId] || {};
        const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
        const bName = bMeta.team_name || bMeta.owner_name || ('Roster ' + bId);
        const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
        const bAvatar = bMeta.team_avatar || bMeta.owner_avatar || null;
        const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? 0);
        const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? 0);
        matchupsRows.push({
          matchup_id: k,
          season: selectedSeason ?? null,
          week: selectedWeek,
          teamA: { rosterId: aId, name: aName, ownerName: aMeta.owner_name ?? null, avatar: aAvatar, points: aPts },
          teamB: { rosterId: bId, name: bName, ownerName: bMeta.owner_name ?? null, avatar: bAvatar, points: bPts },
          participantsCount: 2
        });

      } else if (entries.length === 1) {
        const a = entries[0];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
        const aMeta = rosterMap[aId] || {};
        const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
        const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
        const aPts = (a.points != null || a.points_for != null || a.pts != null) ? safeNum(a.points ?? a.points_for ?? a.pts ?? 0) : null;
        matchupsRows.push({
          matchup_id: k,
          season: selectedSeason ?? null,
          week: selectedWeek,
          teamA: { rosterId: aId, name: aName, ownerName: aMeta.owner_name ?? null, avatar: aAvatar, points: aPts },
          teamB: null,
          participantsCount: 1,
          isBye: true
        });

      } else {
        const participants = entries.map(ent => {
          const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
          const meta = rosterMap[pid] || {};
          return {
            rosterId: pid,
            name: meta.team_name || meta.owner_name || ('Roster ' + pid),
            avatar: meta.team_avatar || meta.owner_avatar || null,
            points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0)
          };
        });
        const combinedNames = participants.map(p => p.name).join(' / ');
        matchupsRows.push({
          matchup_id: k,
          season: selectedSeason ?? null,
          week: selectedWeek,
          combinedParticipants: participants,
          combinedLabel: combinedNames,
          participantsCount: participants.length
        });
      }
    }

    // sort rows by teamA.points desc when possible
    matchupsRows.sort((x,y) => {
      const ax = (x.teamA && x.teamA.points != null) ? x.teamA.points : (x.combinedParticipants ? (x.combinedParticipants[0]?.points || 0) : 0);
      const by = (y.teamA && y.teamA.points != null) ? y.teamA.points : (y.combinedParticipants ? (y.combinedParticipants[0]?.points || 0) : 0);
      return (by - ax);
    });
  }

  const weekOptions = {
    regular: weeks,
    playoffs: playoffWeeks
  };

  // Return only the UI-facing data (no debug messages)
  return {
    seasons,
    weeks,
    playoffWeeks,
    weekOptions,
    selectedSeason,
    selectedWeek,
    matchupsRows
  };
}
