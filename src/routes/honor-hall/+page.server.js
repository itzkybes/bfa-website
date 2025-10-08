// src/routes/honor-hall/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import * as cacheModule from '$lib/server/cache';

/**
 * Goal:
 * - Keep original Honor Hall loader behavior (season list, final standings per season)
 * - Offload heavy fetching/aggregation to sleeperClient when possible
 * - Cache expensive results (standings/champion) to speed repeated requests
 *
 * Strategy:
 * - Use high-level sleeperClient helpers if present:
 *    - sleeper.getFinalStandingsForLeague(leagueId)
 *    - sleeper.getChampionForLeague(leagueId)
 * - If those are not present, compute standings/champion locally but using sleeperClient
 *   helper calls: getLeague, getMatchupsForWeek, getRosterMapWithOwners, etc.
 */

// Use project's cache adapter if available otherwise fallback to simple in-memory Map
const cache =
  (cacheModule && (cacheModule.default || cacheModule.cache || cacheModule.adapter)) ||
  (function () {
    const _map = new Map();
    return {
      get: async (k) => {
        const v = _map.get(k);
        return v === undefined ? null : v;
      },
      set: async (k, v, opts) => {
        _map.set(k, v);
        return true;
      },
      del: async (k) => {
        _map.delete(k);
        return true;
      }
    };
  })();

// optional: try to import a local seasons mapping if present
let SEASONS_BY_KEY = null;
try {
  // this may fail if file doesn't exist; that's okay
  // eslint-disable-next-line no-undef
  SEASONS_BY_KEY = await import('$lib/data/seasons.json').then((m) => m.default || m).catch(() => null);
} catch (e) {
  SEASONS_BY_KEY = null;
}

// config
const DEFAULT_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY || 6);
const STANDINGS_TTL_SECONDS = Number(process.env.HONOR_HALL_STANDINGS_TTL || 60 * 60); // 1 hour
const CHAMPION_TTL_SECONDS = Number(process.env.HONOR_HALL_CHAMPION_TTL || 60 * 60 * 24); // 24 hours

const sleeper = createSleeperClient({ concurrency: DEFAULT_CONCURRENCY });

/**
 * Bounded concurrency runner
 */
async function mapWithConcurrency(inputs, mapper, concurrency = DEFAULT_CONCURRENCY) {
  const results = new Array(inputs.length);
  let idx = 0;
  const workers = new Array(Math.min(concurrency, inputs.length)).fill(null).map(async () => {
    while (idx < inputs.length) {
      const cur = idx++;
      try {
        results[cur] = await mapper(inputs[cur], cur);
      } catch (e) {
        results[cur] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Try calling a high-level sleeper helper to compute final standings (if implemented there).
 * Fallback: compute standings locally using sleeper.getMatchupsForWeek and roster data.
 *
 * Returned: { leagueId, standings: [ { rosterId, team_name, owner_name, wins, losses, ties, points_for, points_against, ... } ], meta: {...} }
 */
async function getFinalStandingsForLeague(leagueId) {
  const cacheKey = 'honor:standings:' + String(leagueId);

  // cache read
  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return typeof cached === 'string' ? JSON.parse(cached) : cached;
    }
  } catch (e) {
    // ignore cache read errors
  }

  // If the client exposes a high-level helper, use it
  if (typeof sleeper.getFinalStandingsForLeague === 'function') {
    try {
      const remote = await sleeper.getFinalStandingsForLeague(leagueId, { ttl: STANDINGS_TTL_SECONDS });
      if (remote) {
        try {
          await cache.set(cacheKey, JSON.stringify(remote), { ttl: STANDINGS_TTL_SECONDS });
        } catch (e) {}
        return remote;
      }
    } catch (e) {
      // fallthrough to local compute
    }
  }

  // LOCAL computation using sleeperClient helpers
  // 1) fetch league metadata
  let leagueMeta = null;
  try {
    leagueMeta = await (typeof sleeper.getLeague === 'function'
      ? sleeper.getLeague(leagueId, { ttl: 60 * 5 })
      : sleeper.getLeagueMeta
      ? sleeper.getLeagueMeta(leagueId, { ttl: 60 * 5 })
      : null);
  } catch (e) {
    leagueMeta = null;
  }

  // 2) roster map with owners
  let rosterMap = {};
  try {
    rosterMap = (typeof sleeper.getRosterMapWithOwners === 'function'
      ? await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 60 })
      : typeof sleeper.getRosters === 'function'
      ? (await sleeper.getRosters(leagueId, { ttl: 60 * 60 })) || {}
      : {});
  } catch (e) {
    rosterMap = {};
  }

  // Determine number of weeks to aggregate: try leagueMeta.settings.matchup_count or settings.max_week, fallback to 17
  let maxWeeks = 17;
  try {
    const s = leagueMeta?.settings ?? {};
    maxWeeks = Number(s.matchup_count ?? s.max_week ?? s.maxWeek ?? leagueMeta?.max_week ?? leagueMeta?.settings?.regular_season_length ?? 17) || 17;
    // don't exceed a reasonable upper bound
    if (maxWeeks < 1 || maxWeeks > 30) maxWeeks = 17;
  } catch (e) {
    maxWeeks = 17;
  }

  // tally wins/losses/ties and points
  const table = {}; // rosterId -> stats
  for (let wk = 1; wk <= maxWeeks; wk++) {
    let matchups = [];
    try {
      matchups = await sleeper.getMatchupsForWeek(leagueId, wk, { ttl: 60 * 30 });
    } catch (e) {
      matchups = [];
    }
    if (!Array.isArray(matchups) || matchups.length === 0) continue;

    for (const m of matchups) {
      // match may contain participants or roster_id + points pairs
      const participants = m.participants ?? m.entries ?? m.rosters ?? null;
      if (Array.isArray(participants) && participants.length >= 2) {
        // head-to-head pair(s)
        // treat every participant as separate row
        for (const p of participants) {
          const rid = String(p.roster_id ?? p.rosterId ?? p.owner_id ?? p.ownerId ?? p.roster ?? 'unknown');
          const pts = Number(p.points ?? p.points_for ?? p.pts ?? p.score ?? 0) || 0;
          if (!table[rid]) table[rid] = { rosterId: rid, wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };
          table[rid].points_for += pts;
        }
        // determine pairwise results: some match objects include "matchup_id" and two participant scores; others have nested.
        if (participants.length === 2) {
          const a = participants[0];
          const b = participants[1];
          const ra = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? a.roster ?? 'a');
          const rb = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? b.roster ?? 'b');
          const pa = Number(a.points ?? a.points_for ?? a.pts ?? a.score ?? 0) || 0;
          const pb = Number(b.points ?? b.points_for ?? b.pts ?? b.score ?? 0) || 0;
          if (!table[ra]) table[ra] = { rosterId: ra, wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };
          if (!table[rb]) table[rb] = { rosterId: rb, wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };
          table[ra].points_for += 0; // already added above
          table[rb].points_for += 0;
          table[ra].points_against += pb;
          table[rb].points_against += pa;
          if (pa > pb) {
            table[ra].wins += 1;
            table[rb].losses += 1;
          } else if (pb > pa) {
            table[rb].wins += 1;
            table[ra].losses += 1;
          } else {
            table[ra].ties += 1;
            table[rb].ties += 1;
          }
        } else {
          // multi-way matchup: skip pairwise wins/losses (or optionally compute using ranking)
        }
      } else {
        // fallback shapes: maybe match object itself is a roster score
        const rid = String(m.roster_id ?? m.rosterId ?? m.owner_id ?? m.ownerId ?? 'unknown');
        const pts = Number(m.points ?? m.points_for ?? m.pts ?? 0) || 0;
        if (!table[rid]) table[rid] = { rosterId: rid, wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };
        table[rid].points_for += pts;
      }
    }
  }

  // Convert table to standings array
  const standings = Object.values(table).map((r) => {
    const meta = rosterMap && rosterMap[r.rosterId] ? rosterMap[r.rosterId] : {};
    return {
      rosterId: r.rosterId,
      team_name: meta.team_name ?? meta.team ?? meta.nickname ?? null,
      owner_name: meta.owner_name ?? meta.owner ?? null,
      team_avatar: meta.team_avatar ?? meta.avatar ?? null,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      points_for: Math.round((r.points_for || 0) * 100) / 100,
      points_against: Math.round((r.points_against || 0) * 100) / 100
    };
  });

  // Sort by wins desc, then points_for desc as a tiebreaker
  standings.sort((a, b) => {
    const aw = Number(a.wins || 0);
    const bw = Number(b.wins || 0);
    if (aw !== bw) return bw - aw;
    const ap = Number(a.points_for || 0);
    const bp = Number(b.points_for || 0);
    return bp - ap;
  });

  const out = { leagueId: String(leagueId), standings, meta: { leagueMeta, rosterMap } };

  // cache
  try {
    await cache.set(cacheKey, JSON.stringify(out), { ttl: STANDINGS_TTL_SECONDS });
  } catch (e) {}

  return out;
}

/**
 * Compute champion for a league. Prefer high-level client method if available,
 * otherwise compute using same heuristic as earlier: sum playoff points across playoff weeks.
 *
 * Returned: { leagueId, champion: { rosterId, team_name, owner_name, team_avatar }, playoffTotals, playoffStart }
 */
async function getChampionForLeague(leagueId) {
  const cacheKey = 'honor:champion:' + String(leagueId);

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return typeof cached === 'string' ? JSON.parse(cached) : cached;
  } catch (e) {}

  // If sleeper client has a high-level champion helper, call it
  if (typeof sleeper.getChampionForLeague === 'function') {
    try {
      const remote = await sleeper.getChampionForLeague(leagueId, { ttl: CHAMPION_TTL_SECONDS });
      if (remote) {
        try {
          await cache.set(cacheKey, JSON.stringify(remote), { ttl: CHAMPION_TTL_SECONDS });
        } catch (e) {}
        return remote;
      }
    } catch (e) {
      // fallthrough
    }
  }

  // Otherwise compute locally but using sleeper helper functions
  // league metadata
  let leagueMeta = null;
  try {
    leagueMeta = await (typeof sleeper.getLeague === 'function' ? sleeper.getLeague(leagueId, { ttl: 60 * 5 }) : null);
  } catch (e) {
    leagueMeta = null;
  }

  // determine playoff start
  let pstart = null;
  try {
    const s = leagueMeta?.settings ?? {};
    pstart = Number(s.playoff_week_start ?? s.playoffStart ?? s.playoff_start ?? s.playoffStartWeek ?? leagueMeta?.playoff_start ?? leagueMeta?.playoffStart ?? null);
    if (!pstart || isNaN(pstart)) pstart = 15;
  } catch (e) {
    pstart = 15;
  }

  const playoffWeeks = [pstart, pstart + 1, pstart + 2];

  // roster map
  let rosterMap = {};
  try {
    rosterMap = typeof sleeper.getRosterMapWithOwners === 'function'
      ? await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 60 })
      : {};
  } catch (e) {
    rosterMap = {};
  }

  const totals = {}; // rosterId -> points
  for (const wk of playoffWeeks) {
    let matchups = [];
    try {
      matchups = await sleeper.getMatchupsForWeek(leagueId, wk, { ttl: 60 * 30 });
    } catch (e) {
      matchups = [];
    }
    if (!Array.isArray(matchups)) continue;

    for (const m of matchups) {
      const parts = m.participants ?? m.entries ?? m.rosters ?? m.users ?? null;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          const rid = String(p.roster_id ?? p.rosterId ?? p.owner_id ?? p.ownerId ?? p.roster ?? 'unknown');
          const pts = Number(p.points ?? p.points_for ?? p.pts ?? p.score ?? 0) || 0;
          totals[rid] = (totals[rid] || 0) + pts;
        }
      } else {
        const rid = String(m.roster_id ?? m.rosterId ?? m.owner_id ?? m.ownerId ?? 'unknown');
        const pts = Number(m.points ?? m.points_for ?? m.pts ?? 0) || 0;
        totals[rid] = (totals[rid] || 0) + pts;
      }
    }
  }

  let topId = null;
  let topPts = -Infinity;
  for (const k of Object.keys(totals)) {
    if (totals[k] > topPts) {
      topPts = totals[k];
      topId = k;
    }
  }

  const championMeta =
    (topId && rosterMap && rosterMap[topId]) || {
      rosterId: topId,
      team_name: rosterMap?.[topId]?.team_name ?? 'Roster ' + topId,
      owner_name: rosterMap?.[topId]?.owner_name ?? null,
      team_avatar: rosterMap?.[topId]?.team_avatar ?? null
    };

  const out = {
    leagueId: String(leagueId),
    champion: championMeta,
    playoffTotals: totals,
    playoffStart: pstart
  };

  try {
    await cache.set(cacheKey, JSON.stringify(out), { ttl: CHAMPION_TTL_SECONDS });
  } catch (e) {}

  return out;
}

/**
 * The page loader: returns finalStandings array (season descriptors) and a map
 * finalStandingsBySeason: { "<leagueId>": { standings, champion, ... } }
 *
 * This preserves the original idea: finalStandings contains season metadata and
 * finalStandingsBySeason provides computed/cached standings/champion info per league.
 */
export async function load({ url }) {
  // Build season list (try local mapping -> env BASE_LEAGUE_ID -> empty)
  const finalStandings = [];

  if (SEASONS_BY_KEY && typeof SEASONS_BY_KEY === 'object') {
    for (const [seasonKey, meta] of Object.entries(SEASONS_BY_KEY)) {
      finalStandings.push({
        seasonKey,
        leagueId: String(meta.leagueId),
        label: meta.label ?? seasonKey,
        finalStandings: meta.finalStandings ?? []
      });
    }
  } else if (process.env.BASE_LEAGUE_ID) {
    finalStandings.push({
      seasonKey: String(process.env.BASE_LEAGUE_ID),
      leagueId: String(process.env.BASE_LEAGUE_ID),
      label: 'League ' + String(process.env.BASE_LEAGUE_ID),
      finalStandings: []
    });
  } else {
    // Attempt to discover a current league id via an env var used by the project (VITE_LEAGUE_ID / PUBLIC_LEAGUE_ID)
    const possible = process.env.VITE_LEAGUE_ID || process.env.PUBLIC_LEAGUE_ID || process.env.LEAGUE_ID;
    if (possible) {
      finalStandings.push({
        seasonKey: String(possible),
        leagueId: String(possible),
        label: 'League ' + String(possible),
        finalStandings: []
      });
    }
  }

  const leagueIds = Array.from(new Set(finalStandings.map((s) => s.leagueId).filter(Boolean)));

  // For each league, fetch standings and champions using bounded concurrency
  const [standingsResults, championResults] = await Promise.all([
    mapWithConcurrency(
      leagueIds,
      async (lid) => {
        try {
          const res = await getFinalStandingsForLeague(lid);
          return res;
        } catch (e) {
          return null;
        }
      },
      DEFAULT_CONCURRENCY
    ),
    mapWithConcurrency(
      leagueIds,
      async (lid) => {
        try {
          const res = await getChampionForLeague(lid);
          return res;
        } catch (e) {
          return null;
        }
      },
      Math.min(4, DEFAULT_CONCURRENCY)
    )
  ]);

  const finalStandingsBySeason = {};
  for (let i = 0; i < leagueIds.length; i++) {
    const lid = leagueIds[i];
    finalStandingsBySeason[lid] = {
      standings: standingsResults[i] ? standingsResults[i].standings : [],
      champion: championResults[i] ? championResults[i].champion : null,
      playoffTotals: championResults[i] ? championResults[i].playoffTotals : null,
      playoffStart: championResults[i] ? championResults[i].playoffStart : null,
      meta: standingsResults[i] ? standingsResults[i].meta : null
    };
  }

  return {
    finalStandings,
    finalStandingsBySeason
  };
}
