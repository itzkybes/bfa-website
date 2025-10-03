// src/routes/honor-hall/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';

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

export async function load(event) {
  // cache for edge
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];
  // build season chain (same approach as records page)
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { mainLeague = null; messages.push('Failed to fetch base league: ' + (e?.message ?? e)); }

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
        } catch (err) { messages.push('Error fetching prev league ' + currPrev + ' — ' + (err?.message ?? err)); break; }
      }
    }
  } catch (err) {
    messages.push('Season chain error: ' + (err?.message ?? err));
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
    // pick the last season in the sorted array (most recent)
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
  // fallback - use BASE_LEAGUE_ID
  if (!selectedLeagueId && seasons.length) selectedLeagueId = seasons[seasons.length - 1].league_id;

  // load league metadata to determine playoff start
  let leagueMeta = null;
  try {
    leagueMeta = selectedLeagueId ? await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }) : null;
  } catch (e) {
    leagueMeta = null;
    messages.push('Failed fetching league meta for selected season: ' + (e?.message ?? e));
  }

  let playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  // regular season weeks: 1 .. playoffStart - 1
  const weeks = [];
  const lastRegularWeek = Math.max(1, playoffStart - 1);
  for (let w = 1; w <= lastRegularWeek; w++) weeks.push(w);

  // selected week param (or default to latest regular week if not provided)
  const weekParam = Number(url.searchParams.get('week') ?? 1);
  let selectedWeek = Number.isFinite(weekParam) && weekParam >= 1 ? weekParam : 1;
  if (selectedWeek > lastRegularWeek) selectedWeek = lastRegularWeek;

  // fetch roster map for selected league (to use latest team names/avatars)
  let rosterMap = {};
  try {
    if (selectedLeagueId) rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    else rosterMap = {};
  } catch (e) { rosterMap = {}; messages.push('Failed to fetch roster map: ' + (e?.message ?? e)); }

  // fetch matchups for the selected week (regular season only)
  let rawMatchups = [];
  try {
    if (selectedLeagueId && selectedWeek >= 1) {
      rawMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, selectedWeek, { ttl: 60 * 5 }) || [];
    }
  } catch (e) {
    rawMatchups = [];
    messages.push('Failed to fetch matchups: ' + (e?.message ?? e));
  }

  // group matchups by matchup id / week so we present pair rows
  const byMatch = {};
  for (let i = 0; i < rawMatchups.length; i++) {
    const e = rawMatchups[i];
    const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
    const wk = e.week ?? e.w ?? selectedWeek;
    const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  // Build rows for UI: when pair (2 participants) => Team A vs Team B; otherwise join participants (multi-team)
  const matchupsRows = [];
  for (const k of Object.keys(byMatch)) {
    const entries = byMatch[k];
    if (!entries || entries.length === 0) continue;

    // if exactly 2 participants produce a clean two-column row
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
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts },
        teamB: { rosterId: bId, name: bName, avatar: bAvatar, points: bPts },
        participantsCount: 2
      });
    } else {
      // multi-participant matchups: show friendly joined representation
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
      // build a combined label
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
    const ax = (x.teamA && x.teamA.points) ? x.teamA.points : (x.combinedParticipants ? (x.combinedParticipants[0]?.points || 0) : 0);
    const by = (y.teamA && y.teamA.points) ? y.teamA.points : (y.combinedParticipants ? (y.combinedParticipants[0]?.points || 0) : 0);
    return (by - ax);
  });

  return {
    seasons,
    weeks,
    selectedSeason,
    selectedWeek,
    matchupsRows,
    messages
  };
}
