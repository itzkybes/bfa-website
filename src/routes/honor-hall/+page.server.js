// src/routes/honor-hall/+page.server.js
import { error } from '@sveltejs/kit';
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';

let cache;
try {
  // prefer a KV backing in edge environment if available (same pattern as Matchups)
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
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** @type {import('./$types').PageServerLoad} */
export async function load(event) {
  // edge caching hints (same as your other loaders)
  event.setHeaders?.({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];

  try {
    if (!BASE_LEAGUE_ID) {
      messages.push('BASE_LEAGUE_ID not set in environment — cannot fetch seasons.');
      return { seasons: [], seasonsMeta: [], selectedSeason: null, matchupsRows: [], standings: null, messages };
    }

    // 1) Build seasons chain by walking previous_league_id (same as Matchups)
    const seasonsMeta = [];
    try {
      // start from the base league and walk back
      let main = null;
      try {
        main = await sleeper.getLeague(String(BASE_LEAGUE_ID), { ttl: 60 * 5 });
      } catch (e) {
        main = null;
        messages.push(`Error fetching base league ${BASE_LEAGUE_ID}: ${e?.message ?? e}`);
      }
      if (main) {
        seasonsMeta.push({ league_id: String(main.league_id), season: main.season ?? null, name: main.name ?? null });
        let prev = main.previous_league_id ? String(main.previous_league_id) : null;
        let steps = 0;
        while (prev && steps < 50) {
          steps++;
          try {
            const p = await sleeper.getLeague(prev, { ttl: 60 * 5 });
            if (!p) {
              messages.push('Could not fetch league for previous_league_id: ' + prev);
              break;
            }
            seasonsMeta.push({ league_id: String(p.league_id), season: p.season ?? null, name: p.name ?? null });
            prev = p.previous_league_id ? String(p.previous_league_id) : null;
          } catch (pe) {
            messages.push('Error fetching previous_league_id ' + prev + ': ' + (pe?.message ?? pe));
            break;
          }
        }
      } else {
        messages.push(`Failed to fetch base league ${BASE_LEAGUE_ID}`);
      }
    } catch (e) {
      messages.push('Error while discovering seasons: ' + (e?.message ?? e));
    }

    if (seasonsMeta.length === 0) {
      messages.push('No seasons discovered from BASE_LEAGUE_ID.');
      return { seasons: [], seasonsMeta: [], selectedSeason: null, matchupsRows: [], standings: null, messages };
    }

    // 2) Determine selected season/league id (season param may be season-year or league_id)
    const url = event.url;
    const seasonParam = url.searchParams.get('season') ?? seasonsMeta[0].season;
    let selectedLeagueId = null;
    let selectedSeason = seasonParam;
    for (const s of seasonsMeta) {
      if (String(s.season) === String(seasonParam) || String(s.league_id) === String(seasonParam)) {
        selectedLeagueId = s.league_id;
        selectedSeason = s.season ?? s.season;
        break;
      }
    }
    if (!selectedLeagueId) {
      selectedLeagueId = seasonsMeta[0].league_id;
      selectedSeason = seasonsMeta[0].season;
    }

    // 3) Fetch league meta to detect playoff start (use same getLeague)
    let leagueMeta = null;
    try {
      leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 });
    } catch (e) {
      leagueMeta = null;
      messages.push('Failed fetching league meta for selected season: ' + (e?.message ?? e));
    }

    const playoffStart = safeNum(
      leagueMeta?.settings?.playoff_week_start ??
      leagueMeta?.settings?.playoffStartWeek ??
      leagueMeta?.playoff_week_start
    ) ?? null;

    // 4) Fetch roster map with owners (same helper used by Matchups)
    let rosterMap = {};
    try {
      rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
      messages.push(`Loaded rosters (${Object.keys(rosterMap).length})`);
    } catch (e) {
      rosterMap = {};
      messages.push('Failed to fetch rosters/users: ' + (e?.message ?? e));
    }

    // 5) Determine playoff weeks to fetch
    let startWeek = playoffStart && Number(playoffStart) >= 1 ? Number(playoffStart) : null;
    if (!startWeek) {
      startWeek = Math.max(1, MAX_WEEKS - 2);
      messages.push('Playoff start not found in league metadata — defaulting to week ' + startWeek);
    }
    const endWeek = Math.min(MAX_WEEKS, startWeek + 2);
    const playoffWeeks = [];
    for (let w = startWeek; w <= endWeek; w++) playoffWeeks.push(w);

    // 6) Fetch matchups for each playoff week using the same helper as Matchups
    const weekMatchups = {};
    for (const wk of playoffWeeks) {
      try {
        const wkMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, wk, { ttl: 60 * 5 });
        weekMatchups[wk] = Array.isArray(wkMatchups) ? wkMatchups : [];
      } catch (e) {
        messages.push(`Failed to fetch matchups for week ${wk}: ${e?.message ?? e}`);
        weekMatchups[wk] = [];
      }
    }

    // 7) Group matchups by matchup id and build matchupsRows matching Matchups tab shape
    const matchupsRows = [];
    for (let idx = 0; idx < playoffWeeks.length; idx++) {
      const wk = playoffWeeks[idx];
      const raw = weekMatchups[wk] || [];

      // group by matchup id, fallback to index-based key
      const groups = new Map();
      for (let i = 0; i < raw.length; i++) {
        const ent = raw[i];
        const mid = ent.matchup_id ?? ent.matchupId ?? ent.matchup ?? null;
        const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ent);
      }

      for (const [key, entries] of groups.entries()) {
        if (!entries || entries.length === 0) continue;

        // BYE (single participant)
        if (entries.length === 1) {
          const a = entries[0];
          const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknown');
          const aMeta = rosterMap[aId] || {};
          const aName = aMeta.team_name || aMeta.display_name || aMeta.owner_display || ('Roster ' + aId);
          const aAvatar = aMeta.team_avatar || aMeta.avatar || null;
          const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);

          matchupsRows.push({
            matchup_id: key,
            season: selectedSeason,
            week: a.week ?? a.w ?? wk,
            round: idx + 1,
            participantsCount: 1,
            teamA: { rosterId: aId, name: aName, avatar: aAvatar, owner_display: aMeta.owner_display, points: aPts },
            teamB: null
          });
          continue;
        }

        // standard head-to-head (2 participants)
        if (entries.length === 2) {
          const a = entries[0];
          const b = entries[1];
          const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'a');
          const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'b');
          const aMeta = rosterMap[aId] || {};
          const bMeta = rosterMap[bId] || {};
          const aName = aMeta.team_name || aMeta.display_name || aMeta.owner_display || ('Roster ' + aId);
          const bName = bMeta.team_name || bMeta.display_name || bMeta.owner_display || ('Roster ' + bId);
          const aAvatar = aMeta.team_avatar || aMeta.avatar || null;
          const bAvatar = bMeta.team_avatar || bMeta.avatar || null;
          const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
          const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? null);

          matchupsRows.push({
            matchup_id: key,
            season: selectedSeason,
            week: a.week ?? a.w ?? wk,
            round: idx + 1,
            participantsCount: 2,
            teamA: { rosterId: aId, name: aName, avatar: aAvatar, owner_display: aMeta.owner_display, points: aPts },
            teamB: { rosterId: bId, name: bName, avatar: bAvatar, owner_display: bMeta.owner_display, points: bPts }
          });
          continue;
        }

        // multi-team
        const participants = entries.map(ent => {
          const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
          const meta = rosterMap[pid] || {};
          return {
            rosterId: pid,
            name: meta.team_name || meta.display_name || meta.owner_display || ('Roster ' + pid),
            avatar: meta.team_avatar || meta.avatar || null,
            points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0),
            owner_display: meta.owner_display || null
          };
        });

        matchupsRows.push({
          matchup_id: key,
          season: selectedSeason,
          week: entries[0].week ?? entries[0].w ?? wk,
          round: idx + 1,
          combinedParticipants: participants,
          combinedLabel: participants.map(p => p.name).join(' / '),
          participantsCount: participants.length
        });
      }
    }

    // sort matchupsRows similar to Matchups tab (optional)
    matchupsRows.sort((a, b) => {
      const ax = (a.teamA && a.teamA.points != null) ? a.teamA.points : 0;
      const by = (b.teamA && b.teamA.points != null) ? b.teamA.points : 0;
      return by - ax;
    });

    // 8) Injected fixed standings (owner names) — provided earlier
    const standingsMap = {
      '2024': [
        "riguy506","smallvt","JakePratt","Kybes",
        "TLupinetti","samsilverman12","armyjunior","JFK4312",
        "WebbWarrior","slawflesh","jewishhorsemen","noahlap01",
        "zamt","WillMichael"
      ],
      '2023': [
        "armyjunior","jewishhorsemen","Kybes","riguy506",
        "zamt","slawflesh","JFK4312","smallvt",
        "samsilverman12","WebbWarrior","TLupinetti","noahlap01",
        "JakePratt","WillMichael"
      ],
      '2022': [
        "riguy506","smallvt","jewishhorsemen","zamt",
        "noahlap01","Kybes","armyjunior","slawflesh",
        "WillMichael","JFK4312","WebbWarrior","TLupinetti",
        "JakePratt","samsilverman12"
      ]
    };
    const rawStandings = standingsMap[String(selectedSeason)] ?? null;
    const standings = rawStandings ? rawStandings.map((name, i) => ({ id: null, name, placement: i + 1 })) : null;

    const seasons = seasonsMeta.map(s => ({ league_id: s.league_id, season: s.season, name: s.name }));

    return {
      seasons,
      seasonsMeta,
      selectedSeason,
      selectedLeagueId,
      matchupsRows,
      standings,
      messages
    };
  } catch (err) {
    const msg = `Failed to load playoff matchups: ${err?.message ?? err}`;
    console.error(msg, err);
    return {
      seasons: [],
      seasonsMeta: [],
      selectedSeason: null,
      selectedLeagueId: null,
      matchupsRows: [],
      standings: null,
      messages: [msg]
    };
  }
}
