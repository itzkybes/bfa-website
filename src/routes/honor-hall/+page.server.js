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

// fallback/base league id (use env var in production)
const BASE_LEAGUE_ID = process.env.BASE_LEAGUE_ID ?? '1219816671624048640';
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/** @type {import('./$types').PageServerLoad} */
export async function load(event) {
  // short edge cache
  event.setHeaders?.({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];

  // 1) build seasons chain (same approach as matchups page)
  const seasons = [];
  try {
    let mainLeague = null;
    try {
      mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 });
    } catch (e) {
      mainLeague = null;
      messages.push('Failed to fetch base league: ' + (e?.message ?? e));
    }

    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id), season: mainLeague.season ?? null, name: mainLeague.name ?? null });
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prev = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prev) { messages.push('Could not fetch league for previous_league_id ' + currPrev); break; }
          seasons.push({ league_id: String(prev.league_id), season: prev.season ?? null, name: prev.name ?? null });
          currPrev = prev.previous_league_id ? String(prev.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err?.message ?? String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error while building seasons chain: ' + (err?.message ?? String(err)));
  }

  // 2) determine selected season / league id
  const url = event.url;
  const seasonParam = url.searchParams.get('season') ?? null;
  let selectedSeason = seasonParam;
  if (!selectedSeason) {
    if (seasons.length) selectedSeason = seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id;
  }

  let selectedLeagueId = null;
  for (const s of seasons) {
    if (String(s.season) === String(selectedSeason) || String(s.league_id) === String(selectedSeason)) {
      selectedLeagueId = String(s.league_id);
      selectedSeason = s.season ?? selectedSeason;
      break;
    }
  }
  if (!selectedLeagueId && seasons.length) selectedLeagueId = seasons[seasons.length - 1].league_id;

  // 3) selected week fallback (we keep weeks array to match matchups UI even though loader will fetch playoff weeks)
  let selectedWeek = Number(url.searchParams.get('week') || (MAX_WEEKS > 0 ? MAX_WEEKS : 1));
  if (!selectedWeek || selectedWeek < 1) selectedWeek = 1;
  const weeks = [];
  for (let i = 1; i <= MAX_WEEKS; i++) weeks.push(i);

  // 4) get league metadata to find playoff_start
  let leagueMeta = null;
  try {
    leagueMeta = selectedLeagueId ? await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }) : null;
  } catch (e) {
    leagueMeta = null;
    messages.push('Failed fetching league meta for selected season: ' + (e?.message ?? e));
  }

  let playoffStart = null;
  if (leagueMeta && leagueMeta.settings) {
    playoffStart = Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek ?? 0) || null;
  }

  // 5) fetch roster map (with owner metadata)
  let rosterMap = {};
  try {
    if (selectedLeagueId) {
      rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
      messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
    }
  } catch (e) {
    rosterMap = {};
    messages.push('Failed to fetch rosters for season: ' + (e?.message ?? e));
  }

  // 6) fetch matchups but ONLY for playoff window (playoffStart -> playoffStart+2)
  let rawMatchups = [];
  try {
    if (selectedLeagueId) {
      let startWeek = playoffStart && Number(playoffStart) >= 1 ? Number(playoffStart) : null;
      if (!startWeek) {
        // fallback to last 3 weeks
        startWeek = Math.max(1, MAX_WEEKS - 2);
        messages.push('Playoff start not found in league metadata — defaulting to week ' + startWeek);
      }
      const endWeek = Math.min(MAX_WEEKS, startWeek + 2);
      for (let wk = startWeek; wk <= endWeek; wk++) {
        try {
          const wkMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, wk, { ttl: 60 * 5 });
          if (Array.isArray(wkMatchups) && wkMatchups.length) {
            for (const m of wkMatchups) {
              // ensure week property exists
              if (m && (m.week == null && m.w == null)) m.week = wk;
              rawMatchups.push(m);
            }
          }
        } catch (we) {
          messages.push('Failed to fetch matchups for week ' + wk + ': ' + (we?.message ?? we));
        }
      }
    }
  } catch (e) {
    rawMatchups = [];
    messages.push('Failed to fetch playoff matchups: ' + (e?.message ?? e));
  }

  // 7) group matchups by matchup id / week
  const byMatch = {};
  for (let i = 0; i < rawMatchups.length; i++) {
    const e = rawMatchups[i];
    const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
    const wk = e.week ?? e.w ?? selectedWeek;
    const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  // 8) build matchupsRows (same structure Matchups tab expects)
  const matchupsRows = [];
  for (const k of Object.keys(byMatch)) {
    const entries = byMatch[k];
    if (!entries || entries.length === 0) continue;

    // bye (single)
    if (entries.length === 1) {
      const a = entries[0];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const aMeta = rosterMap[aId] || {};
      const aName = aMeta.team_name || aMeta.owner_name || aMeta.display_name || aMeta.owner_display || ('Roster ' + aId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || aMeta.avatar || null;
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);

      matchupsRows.push({
        matchup_id: k,
        season: selectedSeason ?? null,
        week: a.week ?? a.w ?? selectedWeek,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, owner_display: aMeta.owner_display },
        teamB: { rosterId: null, name: 'BYE', avatar: null, points: null },
        participantsCount: 1
      });
      continue;
    }

    // head-to-head (2 entries)
    if (entries.length === 2) {
      const a = entries[0];
      const b = entries[1];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
      const aMeta = rosterMap[aId] || {};
      const bMeta = rosterMap[bId] || {};
      const aName = aMeta.team_name || aMeta.owner_name || aMeta.display_name || aMeta.owner_display || ('Roster ' + aId);
      const bName = bMeta.team_name || bMeta.owner_name || bMeta.display_name || bMeta.owner_display || ('Roster ' + bId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || aMeta.avatar || null;
      const bAvatar = bMeta.team_avatar || bMeta.owner_avatar || bMeta.avatar || null;
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? null);

      matchupsRows.push({
        matchup_id: k,
        season: selectedSeason ?? null,
        week: a.week ?? a.w ?? selectedWeek,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, owner_display: aMeta.owner_display },
        teamB: { rosterId: bId, name: bName, avatar: bAvatar, points: bPts, owner_display: bMeta.owner_display },
        participantsCount: 2
      });
      continue;
    }

    // multi-team
    const participants = entries.map(ent => {
      const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
      const meta = rosterMap[pid] || {};
      return {
        rosterId: pid,
        name: meta.team_name || meta.owner_name || meta.display_name || meta.owner_display || ('Roster ' + pid),
        avatar: meta.team_avatar || meta.owner_avatar || meta.avatar || null,
        points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0),
        owner_display: meta.owner_display || null
      };
    });
    matchupsRows.push({
      matchup_id: k,
      season: selectedSeason ?? null,
      week: entries[0].week ?? entries[0].w ?? selectedWeek,
      combinedParticipants: participants,
      combinedLabel: participants.map(p => p.name).join(' / '),
      participantsCount: participants.length
    });
  }

  // 9) sort rows by week/points like matchups tab
  matchupsRows.sort((x, y) => {
    const ax = (x.teamA && x.teamA.points != null) ? x.teamA.points : (x.combinedParticipants ? (x.combinedParticipants[0]?.points || 0) : 0);
    const by = (y.teamA && y.teamA.points != null) ? y.teamA.points : (y.combinedParticipants ? (y.combinedParticipants[0]?.points || 0) : 0);
    // sort descending by points (mirror matchups page)
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
