// src/routes/matchups/+page.server.js
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

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });
  const messages = [];

  // build season chain
  let seasons = [];
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
          if (!prev) break;
          seasons.push({ league_id: String(prev.league_id), season: prev.season ?? null, name: prev.name ?? null });
          currPrev = prev.previous_league_id ? String(prev.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching prev league ' + currPrev + ' — ' + (err?.message ?? err));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Season chain error: ' + (err?.message ?? err));
  }

  // de-dupe + sort ascending
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  seasons = Object.values(byId).sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return (a.season < b.season ? -1 : (a.season > b.season ? 1 : 0));
  });

  // selected season
  const url = event.url;
  const seasonParam = url.searchParams.get('season') ?? null;
  let selectedSeason = seasonParam;
  if (!selectedSeason && seasons.length) {
    selectedSeason = seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id;
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

  // league meta
  let leagueMeta = null;
  try {
    leagueMeta = selectedLeagueId ? await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }) : null;
  } catch (e) {
    leagueMeta = null;
    messages.push('Failed fetching league meta: ' + (e?.message ?? e));
  }

  let playoffStart = (leagueMeta?.settings?.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  const weeks = [];
  const lastRegularWeek = Math.max(1, playoffStart - 1);
  for (let w = 1; w <= lastRegularWeek; w++) weeks.push(w);

  const weekParam = Number(url.searchParams.get('week') ?? 1);
  let selectedWeek = Number.isFinite(weekParam) && weekParam >= 1 ? weekParam : 1;
  if (selectedWeek > lastRegularWeek) selectedWeek = lastRegularWeek;

  // roster map
  let rosterMap = {};
  try {
    rosterMap = selectedLeagueId ? await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 }) : {};
  } catch (e) {
    rosterMap = {};
    messages.push('Failed to fetch roster map: ' + (e?.message ?? e));
  }

  // matchups
  let rawMatchups = [];
  try {
    if (selectedLeagueId && selectedWeek >= 1) {
      rawMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, selectedWeek, { ttl: 60 * 5 }) || [];
    }
  } catch (e) {
    rawMatchups = [];
    messages.push('Failed to fetch matchups: ' + (e?.message ?? e));
  }

  const byMatch = {};
  for (let i = 0; i < rawMatchups.length; i++) {
    const e = rawMatchups[i];
    const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
    const wk = e.week ?? e.w ?? selectedWeek;
    const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  const matchupsRows = [];
  for (const k of Object.keys(byMatch)) {
    const entries = byMatch[k];
    if (!entries?.length) continue;
    if (entries.length === 2) {
      const [a, b] = entries;
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? 'A');
      const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? 'B');
      const aMeta = rosterMap[aId] || {};
      const bMeta = rosterMap[bId] || {};
      matchupsRows.push({
        matchup_id: k,
        season: selectedSeason ?? null,
        week: selectedWeek,
        teamA: { rosterId: aId, name: aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: safeNum(a.points ?? 0) },
        teamB: { rosterId: bId, name: bMeta.team_name || bMeta.owner_name || ('Roster ' + bId), avatar: bMeta.team_avatar || bMeta.owner_avatar || null, points: safeNum(b.points ?? 0) },
        participantsCount: 2
      });
    } else {
      const participants = entries.map(ent => {
        const pid = String(ent.roster_id ?? ent.owner_id ?? 'r');
        const meta = rosterMap[pid] || {};
        return {
          rosterId: pid,
          name: meta.team_name || meta.owner_name || ('Roster ' + pid),
          avatar: meta.team_avatar || meta.owner_avatar || null,
          points: safeNum(ent.points ?? 0)
        };
      });
      matchupsRows.push({
        matchup_id: k,
        season: selectedSeason ?? null,
        week: selectedWeek,
        combinedParticipants: participants,
        combinedLabel: participants.map(p => p.name).join(' / '),
        participantsCount: participants.length
      });
    }
  }

  matchupsRows.sort((x, y) => {
    const ax = (x.teamA?.points) ?? (x.combinedParticipants?.[0]?.points ?? 0);
    const by = (y.teamA?.points) ?? (y.combinedParticipants?.[0]?.points ?? 0);
    return by - ax;
  });

  // final standings from league object
  let finalStandings = [];
  try {
    if (leagueMeta?.rosters) {
      // Sleeper returns rosters with .settings?.rank or .rank
      const rosters = await sleeper.getRosters(selectedLeagueId, { ttl: 60 * 5 });
      finalStandings = rosters
        .map(r => {
          const meta = rosterMap[String(r.roster_id)] || {};
          return {
            rosterId: String(r.roster_id),
            name: meta.team_name || meta.owner_name || ('Roster ' + r.roster_id),
            avatar: meta.team_avatar || meta.owner_avatar || null,
            wins: r.settings?.wins ?? 0,
            losses: r.settings?.losses ?? 0,
            ties: r.settings?.ties ?? 0,
            fpts: r.settings?.fpts ?? 0,
            rank: r.settings?.rank ?? null
          };
        })
        .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    }
  } catch (e) {
    messages.push('Failed to fetch final standings: ' + (e?.message ?? e));
  }

  return {
    seasons,
    weeks,
    selectedSeason,
    selectedWeek,
    matchupsRows,
    finalStandings,
    messages
  };
}
