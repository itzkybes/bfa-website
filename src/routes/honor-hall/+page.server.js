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

// default BASE_LEAGUE_ID falls back to provided ID if env not set
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

  // determine selected season (league id) from query params
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
  // fallback - use BASE_LEAGUE_ID if nothing matched
  if (!selectedLeagueId && seasons.length) selectedLeagueId = seasons[seasons.length - 1].league_id;
  if (!selectedLeagueId) selectedLeagueId = BASE_LEAGUE_ID;

  // build weeks array (1..MAX_WEEKS)
  const weeks = [];
  for (let i = 1; i <= MAX_WEEKS; i++) weeks.push(i);

  // load league metadata to determine playoff start
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

  // fetch roster map (with owner metadata)
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

  // --- NEW: fetch standings and build a placement map ---
  const placementMap = {}; // rosterId -> placement (1-based)
  try {
    if (selectedLeagueId) {
      let standings = null;
      // try a few method names commonly used in clients
      try {
        if (typeof sleeper.getStandings === 'function') {
          standings = await sleeper.getStandings(selectedLeagueId, { ttl: 60 * 5 });
        } else if (typeof sleeper.getStandingsForLeague === 'function') {
          standings = await sleeper.getStandingsForLeague(selectedLeagueId, { ttl: 60 * 5 });
        } else if (typeof sleeper.getLeagueStandings === 'function') {
          standings = await sleeper.getLeagueStandings(selectedLeagueId, { ttl: 60 * 5 });
        } else {
          // no standings helper available on sleeper client
          messages.push('No standings helper function found on sleeper client — skipping standings fetch.');
        }
      } catch (se) {
        messages.push('Error fetching standings (via helper): ' + (se?.message ?? se));
        standings = null;
      }

      // If standings returned as array-of-objects (common), map roster->placement
      if (Array.isArray(standings) && standings.length) {
        // attempt to interpret standard shapes: objects with roster_id/rosterId and rank/placement/position
        for (let i = 0; i < standings.length; i++) {
          const r = standings[i];
          const rid = String(r.roster_id ?? r.rosterId ?? r.roster ?? r.id ?? r.roster_id ?? r.owner_id ?? '').trim();
          const rank = Number(r.rank ?? r.placement ?? r.position ?? r.position ?? (i + 1));
          if (rid) placementMap[rid] = Number.isFinite(rank) ? rank : (i + 1);
        }
        messages.push('Loaded standings for ' + standings.length + ' entries from standings helper.');
      } else if (!standings) {
        // If no helper results, try to build placements from rosterMap if it contains a "placement" or "settings" field
        // Sometimes rosterMap entries may contain final_placement or points_rank - check and fall back
        for (const [rid, meta] of Object.entries(rosterMap || {})) {
          const explicit = meta?.placement ?? meta?.final_placement ?? meta?.rank ?? meta?.position ?? null;
          if (explicit != null) {
            placementMap[String(rid)] = Number(explicit);
          }
        }
        if (Object.keys(placementMap).length) {
          messages.push('Derived placements from rosterMap metadata (' + Object.keys(placementMap).length + ' entries).');
        } else {
          messages.push('Standings not available via helper and rosterMap had no placement metadata — placements unavailable.');
        }
      } else {
        // If standings object has a different shape (object keyed by roster ids), attempt to parse
        if (standings && typeof standings === 'object' && !Array.isArray(standings)) {
          // iterate keys
          for (const [k,v] of Object.entries(standings)) {
            // if value is object with rank
            const rank = Number((v && (v.rank ?? v.placement ?? v.position)) ?? NaN);
            if (!Number.isNaN(rank)) placementMap[String(k)] = rank;
          }
          if (Object.keys(placementMap).length) messages.push('Parsed placement map from standings object.');
        }
      }
    }
  } catch (e) {
    messages.push('Failed to fetch/parse standings: ' + (e?.message ?? e));
  }

  // fetch playoff matchups (fetch matchups for playoff window)
  let rawMatchups = [];
  try {
    if (selectedLeagueId) {
      // Determine playoff start from league metadata if available
      let startWeek = playoffStart && Number(playoffStart) >= 1 ? Number(playoffStart) : null;
      // If not available, assume final 3 weeks are playoffs (fallback)
      if (!startWeek) {
        startWeek = Math.max(1, MAX_WEEKS - 2);
        messages.push('Playoff start not found in league metadata — defaulting to week ' + startWeek);
      }
      // Fetch matchups for each playoff week up to startWeek+2 (3-week playoff window)
      const endWeek = Math.min(MAX_WEEKS, startWeek + 2);
      for (let wk = startWeek; wk <= endWeek; wk++) {
        try {
          const wkMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, wk, { ttl: 60 * 5 });
          if (Array.isArray(wkMatchups) && wkMatchups.length) {
            // ensure week property is set for each matchup entry
            for (const m of wkMatchups) {
              if (m && (m.week == null && m.w == null)) m.week = wk;
              rawMatchups.push(m);
            }
          }
        } catch (we) {
          messages.push('Failed to fetch matchups for week ' + wk + ': ' + (we?.message ?? we));
          // continue to next week
        }
      }
    }
  } catch (e) {
    rawMatchups = [];
    messages.push('Failed to fetch playoff matchups: ' + (e?.message ?? e));
  }

  // group matchups by matchup id / week so we present pair rows
  const byMatch = {};
  for (let i = 0; i < rawMatchups.length; i++) {
    const e = rawMatchups[i];
    const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
    const wk = e.week ?? e.w ?? null;
    const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  // Build rows for UI: when pair (2 participants) => Team A vs Team B; otherwise join participants (multi-team)
  const matchupsRows = [];
  for (const k of Object.keys(byMatch)) {
    const entries = byMatch[k];
    if (!entries || entries.length === 0) continue;

    // handle bye (single participant)
    if (entries.length === 1) {
      const a = entries[0];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const aMeta = rosterMap[aId] || {};
      const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const aPlacement = placementMap[aId] ?? null;

      matchupsRows.push({
        matchup_id: k,
        season: selectedSeason ?? null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement },
        teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, placement: null },
        participantsCount: 1
      });
      continue;
    }

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

      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? null);

      const aPlacement = placementMap[aId] ?? null;
      const bPlacement = placementMap[bId] ?? null;

      matchupsRows.push({
        matchup_id: k,
        season: selectedSeason ?? null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement },
        teamB: { rosterId: bId, name: bName, avatar: bAvatar, points: bPts, placement: bPlacement },
        participantsCount: 2
      });
    } else {
      // multi-participant matchup -- aggregate into combinedParticipants for display
      const participants = entries.map(ent => {
        const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
        const meta = rosterMap[pid] || {};
        return {
          rosterId: pid,
          name: meta.team_name || meta.owner_name || ('Roster ' + pid),
          avatar: meta.team_avatar || meta.owner_avatar || null,
          points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0),
          placement: placementMap[pid] ?? null
        };
      });
      // build a combined label
      const combinedNames = participants.map(p => p.name).join(' / ');
      matchupsRows.push({
        matchup_id: k,
        season: selectedSeason ?? null,
        week: entries[0].week ?? entries[0].w ?? null,
        combinedParticipants: participants,
        combinedLabel: combinedNames,
        participantsCount: participants.length
      });
    }
  }

  // sort rows by week desc then teamA points desc (so finals appear first)
  matchupsRows.sort((x,y) => {
    const wx = Number(x.week ?? 0), wy = Number(y.week ?? 0);
    if (wy !== wx) return wy - wx;
    const ax = (x.teamA && x.teamA.points) ? safeNum(x.teamA.points) : 0;
    const by = (y.teamA && y.teamA.points) ? safeNum(y.teamA.points) : 0;
    return by - ax;
  });

  return {
    seasons,
    weeks,
    selectedSeason,
    matchupsRows,
    messages
  };
}
