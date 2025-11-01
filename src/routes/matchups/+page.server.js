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

// Try fetch from origin/{path} first, then fall back to local static file
async function tryLoadJsonFromStatic(origin, relPath) {
  // relPath expected like '/season_matchups/2022.json' or '/early2023.json'
  try {
    if (typeof fetch === 'function' && origin) {
      const url = origin.replace(/\/$/, '') + '/' + relPath.replace(/^\//, '');
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

  // disk fallback (static directory)
  try {
    const fileUrl = new URL(`../../../static/${relPath}`, import.meta.url);
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

async function tryLoadSeasonMatchups(origin, id) {
  if (!id) return null;
  // try by id as provided (e.g., '2022' or league id)
  const path1 = `season_matchups/${id}.json`;
  const loaded = await tryLoadJsonFromStatic(origin, path1);
  if (loaded) return loaded;

  // sometimes selectedSeason is a league_id; try to find a file by season if it's numeric
  // attempt a fallback where id might be like '2022' already handled above.
  return null;
}

async function tryLoadEarly2023(origin) {
  // keep backward-compatibility for early2023.json
  return tryLoadJsonFromStatic(origin, 'early2023.json');
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
  } catch (e) {
    // ignore
  }

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

  // First: try to load season_matchups JSON for the selectedSeason (by season year or league id)
  let seasonJSON = null;
  try {
    // try by season label first (e.g., '2022')
    seasonJSON = await tryLoadSeasonMatchups(event.url?.origin || null, String(selectedSeason));
    // if not found and we have a league id, try by league id
    if (!seasonJSON && selectedLeagueId) {
      seasonJSON = await tryLoadSeasonMatchups(event.url?.origin || null, String(selectedLeagueId));
    }
  } catch (e) {
    seasonJSON = null;
  }

  // keep legacy early2023 logic for weeks 1-3 of 2023 (if present)
  let earlyData = null;
  if (String(selectedSeason) === '2023' && selectedWeek >= 1 && selectedWeek <= 3) {
    try {
      earlyData = await tryLoadEarly2023(event.url?.origin || null);
    } catch (e) {
      earlyData = null;
    }
  }

  // build matchupsRows: prefer season JSON (or earlyData) when available; else use Sleeper API
  const matchupsRows = [];

  // Helper to normalize JSON matchup entry to our desired shape
  function pushJsonMatchup(entry, idxForId = null) {
    const aName = entry?.teamA?.name ?? entry?.teamA?.team_name ?? 'Roster A';
    const bName = entry?.teamB?.name ?? entry?.teamB?.team_name ?? 'Roster B';
    const aOwner = entry?.teamA?.ownerName ?? entry?.teamA?.owner_name ?? null;
    const bOwner = entry?.teamB?.ownerName ?? entry?.teamB?.owner_name ?? null;

    // possible fields for points in JSONs: teamAScore/teamBScore or teamA.points etc.
    const aPts = (typeof entry?.teamAScore !== 'undefined') ? safeNum(entry.teamAScore) : (typeof entry?.teamA?.score !== 'undefined' ? safeNum(entry.teamA.score) : safeNum(entry?.teamA?.points ?? entry?.teamA?.points_for ?? 0));
    const bPts = (typeof entry?.teamBScore !== 'undefined') ? safeNum(entry.teamBScore) : (typeof entry?.teamB?.score !== 'undefined' ? safeNum(entry.teamB.score) : safeNum(entry?.teamB?.points ?? entry?.teamB?.points_for ?? 0));

    // Try to resolve roster IDs and avatars using rosterMap heuristics
    const aMatch = findRosterMeta(aOwner, aName);
    const bMatch = findRosterMeta(bOwner, bName);

    const aRosterId = aMatch ? aMatch.id : (entry?.teamA?.rosterId ?? entry?.teamA?.roster_id ?? null);
    const bRosterId = bMatch ? bMatch.id : (entry?.teamB?.rosterId ?? entry?.teamB?.roster_id ?? null);

    const aAvatar = aMatch ? (aMatch.meta.team_avatar || aMatch.meta.owner_avatar || null) : (entry?.teamA?.avatar ?? null);
    const bAvatar = bMatch ? (bMatch.meta.team_avatar || bMatch.meta.owner_avatar || null) : (entry?.teamB?.avatar ?? null);

    // preserve starters + starters_points if present in JSON (useful for MVP calculations)
    const aStarters = Array.isArray(entry?.teamA?.starters) ? entry.teamA.starters.slice() : null;
    const aStartersPoints = Array.isArray(entry?.teamA?.starters_points) ? entry.teamA.starters_points.slice() : null;
    const bStarters = Array.isArray(entry?.teamB?.starters) ? entry.teamB.starters.slice() : null;
    const bStartersPoints = Array.isArray(entry?.teamB?.starters_points) ? entry.teamB.starters_points.slice() : null;

    matchupsRows.push({
      matchup_id: entry?.matchup_id ?? entry?.matchupId ?? (idxForId != null ? `json-${selectedWeek}-${idxForId}` : (`json-${selectedWeek}-${matchupsRows.length}`)),
      season: selectedSeason,
      week: selectedWeek,
      teamA: {
        rosterId: aRosterId ? String(aRosterId) : null,
        name: aName,
        ownerName: aOwner,
        avatar: aAvatar,
        points: aPts,
        starters: aStarters,
        starters_points: aStartersPoints
      },
      teamB: {
        rosterId: bRosterId ? String(bRosterId) : null,
        name: bName,
        ownerName: bOwner,
        avatar: bAvatar,
        points: bPts,
        starters: bStarters,
        starters_points: bStartersPoints
      },
      participantsCount: 2,
      _source: 'season_matchups_json'
    });
  }

  // If we have earlyData specifically and it contains this week, use it (legacy)
  if (earlyData && earlyData['2023'] && earlyData['2023'][String(selectedWeek)] && earlyData['2023'][String(selectedWeek)].length) {
    const weekArr = earlyData['2023'][String(selectedWeek)];
    for (let i = 0; i < weekArr.length; i++) {
      try {
        pushJsonMatchup(weekArr[i], i);
      } catch (e) {
        // ignore malformed entries
      }
    }
    // optionally sort (we keep previous behavior of sorting by teamA points)
    matchupsRows.sort((x,y) => ( (y.teamA?.points || 0) - (x.teamA?.points || 0) ));
  } else if (seasonJSON && (seasonJSON[String(selectedWeek)] && seasonJSON[String(selectedWeek)].length)) {
    // Season JSON contains an entry for the selected week (preferred)
    const weekArr = seasonJSON[String(selectedWeek)];
    for (let i = 0; i < weekArr.length; i++) {
      try {
        pushJsonMatchup(weekArr[i], i);
      } catch (e) {
        // ignore bad entry
      }
    }
    // keep consistent sorting
    matchupsRows.sort((x,y) => ( (y.teamA?.points || 0) - (x.teamA?.points || 0) ));
  } else {
    // No JSON available for this season/week -> fallback to Sleeper API (current-season behavior)
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
