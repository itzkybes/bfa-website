// /app/src/lib/leagueStore.js
//
// Centralized, lazily-loaded cache for everything every route needs about
// the league. Previously each +page.svelte re-fetched the seasons chain,
// the latest league's roster map, and the players map — duplicating both
// the boilerplate AND the network round-trips.
//
// Usage:
//   import { ensureLeagueLoaded, leagueState, latestMetaFor } from '$lib/leagueStore';
//   await ensureLeagueLoaded();
//   $: state = $leagueState;     // reactive — { seasons, activeLeague, ... }
//
// The store is a singleton — every consumer shares the same promises and
// the same caches. `ensureLeagueLoaded()` is idempotent; only the first
// call triggers the network.

import { writable, get } from 'svelte/store';
import {
  BASE_LEAGUE_ID,
  getSeasonsChain,
  pickActiveLeague,
  getRosterMapWithOwners,
  getPlayersNba
} from './sleeperClient.client';

const initial = {
  loaded: false,
  loading: false,
  error: null,
  seasons: [],            // [{ league_id, season, name, status, previous_league_id, ... }]
  activeLeague: null,     // pickActiveLeague(seasons)
  latestLeague: null,     // active OR newest in chain
  latestRosterMap: {},    // { rosterId: meta }  for the latest league
  latestByOwnerKey: {},   // owner_username (lower) → meta  for the latest league
  playersMap: {}          // /players/nba payload
};

export const leagueState = writable(initial);
let _loadPromise = null;

/**
 * Fire-and-forget warmup for the app shell. Called once from `+layout.svelte`
 * onMount so the seasons chain, the latest league's roster map, and the NBA
 * players map (~5MB) start downloading the instant the user hits ANY page.
 * Every route's own `ensureLeagueLoaded()` call then resolves immediately
 * from the cache instead of triggering a fresh fetch.
 *
 * Safe to call multiple times — internally just hands back the singleton
 * `_loadPromise` from `ensureLeagueLoaded()`.
 */
export function warmupLeagueData() {
  return ensureLeagueLoaded();
}

/**
 * Resolve every league-wide artifact (seasons chain, latest meta lookup,
 * NBA players map) and stash them in `leagueState`. Safe to call from any
 * onMount handler — concurrent callers all share the same promise. The
 * fetched data is memoized; subsequent calls resolve instantly.
 */
export function ensureLeagueLoaded() {
  if (get(leagueState).loaded) return Promise.resolve(get(leagueState));
  if (_loadPromise) return _loadPromise;

  leagueState.update((s) => ({ ...s, loading: true, error: null }));

  _loadPromise = (async () => {
    try {
      const { seasons } = await getSeasonsChain(BASE_LEAGUE_ID);
      const active = pickActiveLeague(seasons);
      const latest = active || (seasons.length ? seasons[seasons.length - 1] : null);

      // Fetch the latest league's roster map and the NBA players map in
      // parallel — both are large and only need to be requested once.
      const [latestRosterMap, playersMap] = await Promise.all([
        latest?.league_id ? getRosterMapWithOwners(latest.league_id).catch(() => ({})) : Promise.resolve({}),
        getPlayersNba().catch(() => ({}))
      ]);

      // Build a lowercased-username lookup for `latestMetaFor()` so every
      // historic roster meta can be mapped to its current franchise.
      const latestByOwnerKey = {};
      for (const rid of Object.keys(latestRosterMap)) {
        const m = latestRosterMap[rid];
        const k = (m?.owner_username || m?.owner_name || m?.owner_id);
        if (k) latestByOwnerKey[String(k).toLowerCase()] = m;
      }

      const next = {
        loaded: true,
        loading: false,
        error: null,
        seasons,
        activeLeague: active,
        latestLeague: latest,
        latestRosterMap,
        latestByOwnerKey,
        playersMap
      };
      leagueState.set(next);
      return next;
    } catch (e) {
      leagueState.update((s) => ({ ...s, loading: false, error: e }));
      _loadPromise = null;     // allow retry
      throw e;
    }
  })();

  return _loadPromise;
}

/**
 * Given any historic roster-meta object, return the latest meta for that
 * SAME owner — so every page renders today's franchise logo + team name
 * even when displaying historic records. Falls back to the input if the
 * owner can't be matched (e.g. someone who left the league).
 */
export function latestMetaFor(meta) {
  if (!meta) return null;
  const k = meta.owner_username || meta.owner_name || meta.owner_id;
  if (!k) return meta;
  const map = get(leagueState).latestByOwnerKey || {};
  return map[String(k).toLowerCase()] || meta;
}

/**
 * Resolve a season-or-leagueId URL param (`?season=2025` OR `?season=<lid>`)
 * to the actual league object from the chain. Returns the active league if
 * the param is missing/empty. Useful for every route that exposes a season
 * dropdown — replaces ~7 lines of duplicated logic per page.
 */
export function resolveSeasonFromUrl(urlParam) {
  const state = get(leagueState);
  if (!urlParam) return state.activeLeague || state.latestLeague;
  const match = state.seasons.find((s) =>
    String(s.season) === String(urlParam) || String(s.league_id) === String(urlParam)
  );
  return match || state.activeLeague || state.latestLeague;
}

/** Player-name lookup that handles all the fallback variants Sleeper sends. */
export function playerName(pid) {
  if (!pid) return null;
  const map = get(leagueState).playersMap || {};
  const p = map[pid];
  if (!p) return String(pid);
  return p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.display_name || String(pid);
}

/**
 * Common pattern across every dropdown-driven page:
 * "Read ?season=X from URL, otherwise default to the active league's
 * season, otherwise the newest league's season". Returns a STRING that
 * the page can bind directly to `<select bind:value>`. Pass the season
 * chain so this works before `ensureLeagueLoaded()` resolves.
 *
 * Pulled out of 7 near-identical inline copies — each page had its own
 * subtle variant of `urlParam || active?.season || latest?.season`. Now
 * they all call this helper.
 */
export function defaultSeasonIdFromChain(chain, urlParam) {
  if (urlParam) return String(urlParam);
  const list = Array.isArray(chain) ? chain : [];
  // The chain is ordered OLDEST → NEWEST, so to default to the newest
  // active/complete league we have to walk the list from the end. Sleeper
  // marks every past league as `complete`, so a forward .find() would
  // always return the oldest one (e.g. 2022 instead of 2026).
  let active = null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.status === 'in_season') { active = list[i]; break; }
  }
  if (!active) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.status === 'complete') { active = list[i]; break; }
    }
  }
  if (!active) active = list[list.length - 1] || null;
  if (!active) return '';
  if (active.season != null) return String(active.season);
  return String(active.league_id || '');
}
