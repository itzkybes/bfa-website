// src/routes/honor-hall/+page.server.js
// Honor Hall loader + bracket simulation (updated losers-bracket logic)


import { createSleeperClient, getHonorHallData, getFinalsMVP, getOverallMVP, safeNum, computeStreaks } from '$lib/server/sleeperClient';
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


export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const incomingSeasonParam = url.searchParams.get('season') || null;

  const messages = [];
  const prevChain = [];

  // --- build seasons chain ---
  let seasons = [];
  let mainLeague = null;
  try {
    mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 });
  } catch (e) {
    messages.push('Failed fetching base league ' + BASE_LEAGUE_ID + ' — ' + (e && e.message ? e.message : String(e)));
  }

  if (mainLeague) {
    seasons.push({
      league_id: String(mainLeague.league_id || BASE_LEAGUE_ID),
      season: mainLeague.season ?? null,
      name: mainLeague.name ?? null
    });
    prevChain.push(String(mainLeague.league_id || BASE_LEAGUE_ID));

    // Use the new helper to get all honor hall data
    const honorData = await getHonorHallData({
      sleeper,
      BASE_LEAGUE_ID,
      selectedSeasonParam: incomingSeasonParam,
      MAX_WEEKS,
      messages,
      prevChain
    });

    // Also fetch MVPs for the selected league/season
    let finalsMvp = null, overallMvp = null;
    try {
      finalsMvp = await sleeper.getFinalsMVP(honorData.selectedLeagueId, { maxWeek: MAX_WEEKS });
    } catch (e) { finalsMvp = null; }
    try {
      overallMvp = await sleeper.getOverallMVP(honorData.selectedLeagueId, { maxWeek: MAX_WEEKS });
    } catch (e) { overallMvp = null; }

    // Build finalStandingsBySeason keyed by selectedSeason
    const finalStandingsBySeason = {};
    if (honorData.selectedSeason) {
      finalStandingsBySeason[String(honorData.selectedSeason)] = {
        finalStandings: Array.isArray(honorData.finalStandings) ? honorData.finalStandings : [],
        debug: Array.isArray(honorData.debug) ? honorData.debug : []
      };
    }
    return {
      ...honorData,
      selectedSeason: honorData.selectedSeason, // always use computed, not raw param
      finalsMvp,
      overallMvp,
      finalStandingsBySeason
    };
  }

  // fallback: always return a valid selectedSeason and structure for Svelte page
  return {
    seasons: [
      { league_id: String(BASE_LEAGUE_ID), season: null, name: null }
    ],
    selectedSeason: String(BASE_LEAGUE_ID),
    selectedLeagueId: String(BASE_LEAGUE_ID),
    playoffStart: null,
    playoffEnd: null,
    matchupsRows: [],
    regularStandings: [],
    finalStandings: [],
    debug: [],
    messages,
    prevChain: [],
    finalsMvp: null,
    overallMvp: null,
    finalStandingsBySeason: {
      [String(BASE_LEAGUE_ID)]: { finalStandings: [], debug: [] }
    }
  };
