// src/routes/honor-hall/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import fs from 'fs/promises';
import path from 'path';

/**
 * Minimal loader:
 * - Try to read src/lib/data/seasons.json at runtime (avoid static import so build won't fail)
 * - Fall back to env vars for a single league id
 * - For each leagueId call sleeper.getFinalStandingsForLeague and getChampionForLeague
 * - Return { finalStandings, finalStandingsBySeason }
 */

async function tryLoadSeasonsJson() {
  try {
    const p = path.join(process.cwd(), 'src', 'lib', 'data', 'seasons.json');
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(raw);
    // Expect shape: { "<seasonKey>": { leagueId: "...", label: "..." }, ... }
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch (e) {
    // file missing or unreadable -> return null (no build-time failure)
    return null;
  }
}

export async function load() {
  // discover seasons mapping either from runtime file or env
  const seasonsMap = (await tryLoadSeasonsJson()) || null;

  const finalStandings = [];

  if (seasonsMap) {
    for (const [seasonKey, meta] of Object.entries(seasonsMap)) {
      finalStandings.push({
        seasonKey,
        leagueId: String(meta.leagueId),
        label: meta.label ?? seasonKey,
        finalStandings: meta.finalStandings ?? []
      });
    }
  } else {
    // fallback to environment variables (support several common names)
    const possible = process.env.BASE_LEAGUE_ID || process.env.VITE_LEAGUE_ID || process.env.PUBLIC_LEAGUE_ID || process.env.LEAGUE_ID;
    if (possible) {
      finalStandings.push({
        seasonKey: String(possible),
        leagueId: String(possible),
        label: 'League ' + String(possible),
        finalStandings: []
      });
    }
  }

  // If still empty, return gracefully with empty payload (UI shows helpful message)
  if (finalStandings.length === 0) {
    return { finalStandings: [], finalStandingsBySeason: {} };
  }

  // Build unique list of league ids
  const leagueIds = Array.from(new Set(finalStandings.map((s) => s.leagueId).filter(Boolean)));

  // create sleeper client (uses concurrency/caching defined in the client)
  const sleeper = createSleeperClient();

  // For each league, call the two high-level helpers. Use Promise.allSettled so one failure doesn't kill everything.
  const standingsPromises = leagueIds.map((lid) =>
    (async () => {
      try {
        if (typeof sleeper.getFinalStandingsForLeague === 'function') {
          return await sleeper.getFinalStandingsForLeague(lid);
        }
        return null;
      } catch (e) {
        return null;
      }
    })()
  );

  const championPromises = leagueIds.map((lid) =>
    (async () => {
      try {
        if (typeof sleeper.getChampionForLeague === 'function') {
          return await sleeper.getChampionForLeague(lid);
        }
        return null;
      } catch (e) {
        return null;
      }
    })()
  );

  const standingsResults = await Promise.allSettled(standingsPromises);
  const championResults = await Promise.allSettled(championPromises);

  const finalStandingsBySeason = {};

  for (let i = 0; i < leagueIds.length; i++) {
    const lid = leagueIds[i];
    const stRes = standingsResults[i];
    const chRes = championResults[i];

    const standingsPayload = stRes.status === 'fulfilled' && stRes.value ? stRes.value.standings ?? stRes.value : [];
    const championPayload = chRes.status === 'fulfilled' && chRes.value ? chRes.value.champion ?? chRes.value : null;
    const playoffTotals = chRes.status === 'fulfilled' && chRes.value ? chRes.value.playoffTotals ?? null : null;
    const playoffStart = chRes.status === 'fulfilled' && chRes.value ? chRes.value.playoffStart ?? null : null;
    const meta = stRes.status === 'fulfilled' && stRes.value ? stRes.value.meta ?? null : null;

    finalStandingsBySeason[lid] = {
      standings: standingsPayload,
      champion: championPayload,
      playoffTotals,
      playoffStart,
      meta
    };
  }

  return {
    finalStandings,
    finalStandingsBySeason
  };
}
