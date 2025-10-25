// src/routes/matchups/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { readFile } from 'fs/promises';
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

async function loadEarlyJson(event, debugMessages) {
  // Try event.fetch on the static path first (same pattern homepage used for bfa-logo).
  try {
    if (event && typeof event.fetch === 'function') {
      try {
        const url = new URL('/early2023.json', event.url).toString();
        const res = await event.fetch(url);
        if (res && res.ok) {
          const json = await res.json();
          debugMessages.push('Loaded early2023.json via event.fetch');
          return json;
        } else {
          debugMessages.push('event.fetch returned ' + (res && res.status ? res.status : 'no response'));
        }
      } catch (errFetch) {
        debugMessages.push('event.fetch attempt failed: ' + (errFetch?.message ?? String(errFetch)));
      }
    } else {
      debugMessages.push('event.fetch not available in this runtime');
    }
  } catch (e) {
    debugMessages.push('error while trying event.fetch: ' + (e?.message ?? String(e)));
  }

  // Fallback: attempt to read from disk static/early2023.json
  try {
    const diskPath = path.resolve(process.cwd(), 'static', 'early2023.json');
    const txt = await readFile(diskPath, 'utf8');
    const json = JSON.parse(txt);
    debugMessages.push('Loaded early2023.json from disk: ' + diskPath);
    return json;
  } catch (errDisk) {
    debugMessages.push('readFile fallback failed: ' + (errDisk?.message ?? String(errDisk)));
  }

  debugMessages.push('No early2023.json found via fetch or disk fallback.');
  return null;
}

export async function load(event) {
  // cache control for edge
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];
  const debug = [];

  // Build seasons chain (same style as other pages)
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { mainLeague = null; messages.push('Failed to fetch base league: ' + (e?.message ?? String(e))); }

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
        } catch (err) {
          messages.push('Error fetching prev league ' + currPrev + ' — ' + (err?.message ?? String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Season chain error: ' + (err?.message ?? String(err)));
  }

  // dedupe + sort
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  seasons = Object.values(byId);
  seasons.sort((a,b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : 1;
  });

  // select season (query param or latest)
  const url = event.url;
  const seasonParam = url.searchParams.get('season') ?? null;
  let selectedSeason = seasonParam;
  if (!selectedSeason) {
    if (seasons.length) selectedSeason = seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id;
    else selectedSeason = null;
  }

  // find league id for selectedSeason
  let selectedLeagueId = null;
  if (selectedSeason) {
    for (const s of seasons) {
      if (String(s.season) === String(selectedSeason) || String(s.league_id) === String(selectedSeason)) {
        selectedLeagueId = String(s.league_id);
        selectedSeason = s.season ?? selectedSeason;
        break;
      }
    }
  }
  if (!selectedLeagueId) selectedLeagueId = (seasons.length ? seasons[seasons.length-1].league_id : BASE_LEAGUE_ID);

  // load league meta to get playoff start and season
  let leagueMeta = null;
  try {
    leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 });
  } catch (e) {
    leagueMeta = null;
    messages.push('Failed to fetch league meta: ' + (e?.message ?? String(e)));
  }
  const leagueSeason = leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null;
  let playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  const lastRegularWeek = Math.max(1, playoffStart - 1);

  // build available weeks (regular + playoffs)
  const weeks = [];
  for (let w = 1; w <= lastRegularWeek; w++) weeks.push(w);
  const playoffWeeks = [];
  const playoffEnd = Math.min(MAX_WEEKS, playoffStart + 2);
  for (let w = playoffStart; w <= playoffEnd; w++) playoffWeeks.push(w);

  // selected week param (default lastRegularWeek)
  const weekParamRaw = url.searchParams.get('week');
  let selectedWeek = (weekParamRaw != null) ? (Number(weekParamRaw) || lastRegularWeek) : lastRegularWeek;
  if (selectedWeek < 1) selectedWeek = 1;
  if (selectedWeek > MAX_WEEKS) selectedWeek = MAX_WEEKS;

  // fetch roster map for enrichment
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 }) || {};
  } catch (e) {
    rosterMap = {};
    messages.push('Failed to fetch roster map: ' + (e?.message ?? String(e)));
  }

  // helpers to map owner username/name -> rosterId
  const usernameToRoster = {};
  const ownerNameToRoster = {};
  for (const rid in rosterMap) {
    if (!Object.prototype.hasOwnProperty.call(rosterMap, rid)) continue;
    const meta = rosterMap[rid] || {};
    if (meta.owner_username) usernameToRoster[String(meta.owner_username).toLowerCase()] = String(rid);
    if (meta.owner_name) ownerNameToRoster[String(meta.owner_name).toLowerCase()] = String(rid);
  }

  // Try to load early2023.json
  let earlyJson = null;
  try {
    earlyJson = await loadEarlyJson(event, debug);
  } catch (e) {
    debug.push('earlyJson load error: ' + (e?.message ?? String(e)));
    earlyJson = null;
  }

  // If selectedSeason is 2023 and selectedWeek is 1..3 and earlyJson has an entry, build rows from static JSON
  let matchupsRows = [];
  let usedEarlyOverride = false;
  try {
    if (leagueSeason === '2023' && earlyJson && earlyJson['2023'] && [1,2,3].includes(Number(selectedWeek))) {
      const wkObj = earlyJson['2023'][String(selectedWeek)];
      if (Array.isArray(wkObj) && wkObj.length) {
        debug.push(`Applying early2023 override for season=2023 week=${selectedWeek} with ${wkObj.length} entries`);
        // each entry in the static file is a pair object with teamA/teamB
        for (let i=0;i<wkObj.length;i++) {
          const ent = wkObj[i];
          // we expect fields: teamA: { name, ownerName }, teamB: { name, ownerName }, teamAScore, teamBScore
          const teamA = ent.teamA || ent.home || {};
          const teamB = ent.teamB || ent.away || {};
          const aName = teamA.name ?? teamA.team_name ?? null;
          const aOwner = teamA.ownerName ?? teamA.owner_name ?? teamA.owner ?? null;
          const bName = teamB.name ?? teamB.team_name ?? null;
          const bOwner = teamB.ownerName ?? teamB.owner_name ?? teamB.owner ?? null;
          const aScore = safeNum(ent.teamAScore ?? ent.homeScore ?? ent.scoreA ?? 0);
          const bScore = safeNum(ent.teamBScore ?? ent.awayScore ?? ent.scoreB ?? 0);

          // try mapping ownerName/username to rosterId
          let aRosterId = null;
          let bRosterId = null;
          if (aOwner) {
            const low = String(aOwner).toLowerCase();
            if (usernameToRoster[low]) aRosterId = usernameToRoster[low];
            else if (ownerNameToRoster[low]) aRosterId = ownerNameToRoster[low];
          }
          if (bOwner) {
            const lowb = String(bOwner).toLowerCase();
            if (usernameToRoster[lowb]) bRosterId = usernameToRoster[lowb];
            else if (ownerNameToRoster[lowb]) bRosterId = ownerNameToRoster[lowb];
          }

          const aMeta = aRosterId && rosterMap[aRosterId] ? rosterMap[aRosterId] : null;
          const bMeta = bRosterId && rosterMap[bRosterId] ? rosterMap[bRosterId] : null;

          matchupsRows.push({
            matchup_id: `early2023-${selectedWeek}-${i}`,
            season: leagueSeason,
            week: selectedWeek,
            participantsCount: 2,
            teamA: {
              rosterId: aRosterId,
              name: aMeta ? (aMeta.team_name || aName) : (aName || 'Team A'),
              ownerName: aMeta ? aMeta.owner_name : (aOwner || null),
              avatar: aMeta ? (aMeta.team_avatar || aMeta.owner_avatar) : null,
              points: aScore
            },
            teamB: {
              rosterId: bRosterId,
              name: bMeta ? (bMeta.team_name || bName) : (bName || 'Team B'),
              ownerName: bMeta ? bMeta.owner_name : (bOwner || null),
              avatar: bMeta ? (bMeta.team_avatar || bMeta.owner_avatar) : null,
              points: bScore
            }
          });
        }
        usedEarlyOverride = true;
      } else {
        debug.push(`early2023.json has no entries for week ${selectedWeek}`);
      }
    }
  } catch (errEarly) {
    debug.push('Error applying early2023 override: ' + (errEarly?.message ?? String(errEarly)));
    usedEarlyOverride = false;
  }

  // If not overridden, build matchupsRows from Sleper API for the selected week
  if (!usedEarlyOverride) {
    // fetch raw matchups
    let rawMatchups = [];
    try {
      if (selectedLeagueId && selectedWeek >= 1) {
        rawMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, selectedWeek, { ttl: 60 * 5 }) || [];
      }
    } catch (e) {
      rawMatchups = [];
      messages.push('Failed to fetch matchups: ' + (e?.message ?? String(e)));
    }

    // group by matchup id (or generated)
    const byMatch = {};
    for (let i=0;i<rawMatchups.length;i++) {
      const r = rawMatchups[i];
      const mid = r.matchup_id ?? r.matchupId ?? r.matchup ?? null;
      const wk = r.week ?? r.w ?? selectedWeek;
      const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(r);
    }

    // build rows
    const keys = Object.keys(byMatch);
    for (const k of keys) {
      const arr = byMatch[k];
      if (!arr || arr.length === 0) continue;

      if (arr.length === 2) {
        const a = arr[0], b = arr[1];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
        const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
        const aMeta = rosterMap[aId] || {};
        const bMeta = rosterMap[bId] || {};
        const aName = aMeta.team_name || aMeta.owner_name || a.team_name || a.team || ('Roster ' + aId);
        const bName = bMeta.team_name || bMeta.owner_name || b.team_name || b.team || ('Roster ' + bId);
        const aPts = safeNum(a.starter_points ?? a.starterPoints ?? a.points ?? a.points_for ?? a.pts ?? 0);
        const bPts = safeNum(b.starter_points ?? b.starterPoints ?? b.points ?? b.points_for ?? b.pts ?? 0);

        matchupsRows.push({
          matchup_id: k,
          season: leagueSeason,
          week: selectedWeek,
          participantsCount: 2,
          teamA: { rosterId: aId, name: aName, ownerName: aMeta.owner_name || null, avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts },
          teamB: { rosterId: bId, name: bName, ownerName: bMeta.owner_name || null, avatar: bMeta.team_avatar || bMeta.owner_avatar || null, points: bPts }
        });
      } else if (arr.length === 1) {
        const a = arr[0];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
        const aMeta = rosterMap[aId] || {};
        const aName = aMeta.team_name || aMeta.owner_name || a.team_name || a.team || ('Roster ' + aId);
        const aPts = (a.points != null || a.points_for != null || a.pts != null) ? safeNum(a.starter_points ?? a.starterPoints ?? a.points ?? a.points_for ?? a.pts) : null;
        matchupsRows.push({
          matchup_id: k,
          season: leagueSeason,
          week: selectedWeek,
          participantsCount: 1,
          teamA: { rosterId: aId, name: aName, ownerName: aMeta.owner_name || null, avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts },
          teamB: null,
          isBye: true
        });
      } else {
        // multi-team
        const participants = arr.map(p => {
          const pid = String(p.roster_id ?? p.rosterId ?? p.owner_id ?? p.ownerId ?? 'r');
          const meta = rosterMap[pid] || {};
          return {
            rosterId: pid,
            name: meta.team_name || meta.owner_name || p.team_name || p.team || ('Roster ' + pid),
            avatar: meta.team_avatar || meta.owner_avatar || null,
            points: safeNum(p.starter_points ?? p.starterPoints ?? p.points ?? p.points_for ?? p.pts ?? 0)
          };
        });
        matchupsRows.push({
          matchup_id: k,
          season: leagueSeason,
          week: selectedWeek,
          participantsCount: participants.length,
          combinedParticipants: participants
        });
      }
    }
  }

  // return payload
  return {
    seasons,
    weeks,
    playoffWeeks,
    weekOptions: { regular: weeks, playoffs: playoffWeeks },
    selectedSeason,
    selectedWeek,
    matchupsRows,
    messages,
    debug
  };
}
