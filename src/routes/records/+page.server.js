// src/routes/admin/generate-season-json/+page.server.js
// Generate season_matchups/<year>.json files by fetching matchups and rosters from Sleeper
// Includes starter ids and starter points for each team in each matchup.

import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { mkdir, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

let cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) {
    cache = createKVCache(globalThis.KV);
  } else {
    cache = createMemoryCache();
  }
} catch (e) {
  cache = createMemoryCache();
}

const SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
const sleeper = createSleeperClient({ cache: cache, concurrency: SLEEPER_CONCURRENCY });

const BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID)
  ? process.env.BASE_LEAGUE_ID
  : '1219816671624048640';

// <- CHANGED: default MAX_WEEKS fallback is now 23
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 23;

// safe numeric conversion
function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// attempt to extract starters array (ids) from participant object
function extractStarters(part) {
  if (!part) return null;
  if (Array.isArray(part.starters) && part.starters.length) return part.starters.map(s => String(s));
  // sometimes starters appear as 'starters_points_list' or other forms are not starter ids — ignore
  if (Array.isArray(part.starter_points) && part.starter_points.length && Array.isArray(part.starters)) {
    return part.starters.map(s => String(s));
  }
  // sometimes starters are objects (unlikely in sleeper matchups) but try:
  if (Array.isArray(part.starters) && part.starters.length && typeof part.starters[0] === 'object') {
    // try to pick id field if present
    return part.starters.map(s => (s.player_id ?? s.playerId ?? s.id ?? s).toString());
  }
  return null;
}

// attempt to extract starter points array
function extractStarterPoints(part) {
  if (!part) return null;
  // common array-key forms for starters points
  const arrayKeys = ['starters_points', 'starter_points', 'startersPoints', 'starterPoints', 'starters_points_list'];
  for (const k of arrayKeys) {
    if (Array.isArray(part[k]) && part[k].length) {
      return part[k].map(v => Math.round(safeNum(v) * 100) / 100);
    }
  }

  // if we have player_points mapping and starters list, map them
  if (part.player_points && typeof part.player_points === 'object' && Array.isArray(part.starters) && part.starters.length) {
    const out = [];
    for (const st of part.starters) {
      const val = part.player_points[String(st)] ?? part.player_points[st];
      out.push(Math.round(safeNum(val) * 100) / 100);
    }
    return out;
  }

  // some APIs return starters as array of objects with points field
  if (Array.isArray(part.starters) && part.starters.length && typeof part.starters[0] === 'object') {
    const out = [];
    for (const obj of part.starters) {
      out.push(Math.round(safeNum(obj.points ?? obj.p) * 100) / 100);
    }
    return out;
  }

  // fallback: if there is a single numeric 'points' or 'pts' field, treat it as total (not starters)
  return null;
}

// compute total from starters_points if present, else fallback to points fields
function computeTotalFromParticipant(part) {
  const sp = extractStarterPoints(part);
  if (Array.isArray(sp) && sp.length) {
    return Math.round(sp.reduce((s, x) => s + safeNum(x), 0) * 100) / 100;
  }
  // fallback fields
  const fallback = safeNum(part.points ?? part.points_for ?? part.pts ?? part.score ?? part.total ?? 0);
  return Math.round(fallback * 100) / 100;
}

// write JSON to static/season_matchups/<year>.json if possible
async function tryWriteJson(year, obj) {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // static/season_matchups relative to project
    const dirPath = path.join(__dirname, '../../../static/season_matchups');
    await mkdir(dirPath, { recursive: true });
    const filePath = path.join(dirPath, `${year}.json`);
    await writeFile(filePath, JSON.stringify(obj, null, 2), 'utf8');
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

export async function load(event) {
  // set cache headers
  event.setHeaders({
    'cache-control': 's-maxage=60, stale-while-revalidate=300'
  });

  const messages = [];
  const outputs = [];
  const jsonLinks = [];

  // Build seasons chain (same approach)
  let seasons = [];
  try {
    let mainLeague = null;
    try {
      mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 });
    } catch (e) {
      messages.push('Failed fetching base league ' + BASE_LEAGUE_ID + ' — ' + (e && e.message ? e.message : String(e)));
    }

    if (mainLeague) {
      seasons.push({
        league_id: String(mainLeague.league_id || BASE_LEAGUE_ID),
        season: mainLeague.season || null,
        name: mainLeague.name || null
      });

      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) {
            messages.push('Could not fetch league for previous_league_id ' + currPrev);
            break;
          }
          seasons.push({
            league_id: String(prevLeague.league_id || currPrev),
            season: prevLeague.season || null,
            name: prevLeague.name || null
          });
          if (prevLeague.previous_league_id) currPrev = String(prevLeague.previous_league_id);
          else currPrev = null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err && err.message ? err.message : String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error while building seasons chain: ' + (err && err.message ? err.message : String(err)));
  }

  // dedupe & sort seasons by season numeric if available
  const byId = {};
  for (const s of seasons) {
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = Object.keys(byId).map(k => byId[k]);
  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    return Number(a.season) - Number(b.season);
  });

  // choose years to process: numeric seasons discovered -> use those years; else fallback
  const discoveredYears = seasons.filter(s => s.season != null).map(s => String(s.season));
  const YEARS = discoveredYears.length ? discoveredYears : ['2022', '2023', '2024'];

  // For each year, we will attempt to fetch matchups for weeks 1..MAX_WEEKS and roster map
  for (const year of YEARS) {
    const result = { meta: { year }, weeks: {} };

    // Try to find a league object with that season (we looked up seasons earlier)
    // We'll attempt to find one league from the 'seasons' list that matches this season value
    const matching = seasons.find(s => String(s.season) === String(year) || String(s.league_id) === String(year));
    const leagueId = matching ? matching.league_id : null;

    // If we have a leagueId, try to fetch roster map and settings
    let rosterMap = {};
    let playoff_week_start = 15;
    if (leagueId) {
      try {
        rosterMap = (await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 })) || {};
      } catch (e) {
        messages.push(`Failed to fetch roster map for league ${leagueId} (season ${year}) — ${e?.message ?? e}`);
        rosterMap = {};
      }
      try {
        const meta = await sleeper.getLeague(leagueId, { ttl: 60 * 5 });
        if (meta && meta.settings && meta.settings.playoff_week_start) playoff_week_start = Number(meta.settings.playoff_week_start);
      } catch (e) {
        // ignore
      }
    }

    result.meta.playoff_week_start = playoff_week_start;

    // weeks loop
    for (let week = 1; week <= MAX_WEEKS; week++) {
      try {
        // fetch matchups for leagueId if available, otherwise skip (we can't fetch global season matchups without a league id)
        let matchups = [];
        if (leagueId) {
          matchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 }) || [];
        } else {
          // If no leagueId found, we won't be able to fetch from sleeper — leave empty
          matchups = [];
        }

        if (!matchups || !matchups.length) {
          // nothing for this week
          continue;
        }

        // group by matchup id (if present) and build normalized objects
        const byMatch = {};
        for (let i = 0; i < matchups.length; i++) {
          const entry = matchups[i];
          const mid = entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? null;
          const key = mid != null ? String(mid) : `auto-${week}-${i}`;
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(entry);
        }

        // normalize groups into objects like your example (teamA/teamB)
        const normalized = [];
        const groupKeys = Object.keys(byMatch);
        for (const k of groupKeys) {
          const group = byMatch[k];
          // If group has 1 entry: single participant; if 2: head-to-head
          if (group.length === 1) {
            const e = group[0];
            // build single participant object (teamA only)
            const pid = e.roster_id ?? e.rosterId ?? e.owner_id ?? e.ownerId ?? null;
            const rosterMeta = pid && rosterMap[String(pid)] ? rosterMap[String(pid)] : null;
            const teamA = {
              rosterId: pid != null ? String(pid) : null,
              name: rosterMeta?.team_name ?? rosterMeta?.name ?? (e.team_name ?? e.teamName ?? null),
              ownerName: rosterMeta?.owner_username ?? rosterMeta?.owner_name ?? e.owner_name ?? e.owner ?? null,
              starters: extractStarters(e) || null,
              starters_points: extractStarterPoints(e) || null,
              player_points: (e.player_points && typeof e.player_points === 'object') ? e.player_points : null
            };
            const teamAScore = computeTotalFromParticipant(e);
            normalized.push({
              matchup_id: mid,
              teamA,
              teamAScore
            });
          } else {
            // pick first two as A/B
            const aRaw = group[0];
            const bRaw = group[1];
            const aPid = aRaw.roster_id ?? aRaw.rosterId ?? aRaw.owner_id ?? aRaw.ownerId ?? null;
            const bPid = bRaw.roster_id ?? bRaw.rosterId ?? bRaw.owner_id ?? bRaw.ownerId ?? null;
            const aMeta = aPid && rosterMap[String(aPid)] ? rosterMap[String(aPid)] : null;
            const bMeta = bPid && rosterMap[String(bPid)] ? rosterMap[String(bPid)] : null;

            const teamA = {
              rosterId: aPid != null ? String(aPid) : null,
              name: aMeta?.team_name ?? aMeta?.name ?? (aRaw.team_name ?? aRaw.teamName ?? null),
              ownerName: aMeta?.owner_username ?? aMeta?.owner_name ?? aRaw.owner_name ?? aRaw.owner ?? null,
              starters: extractStarters(aRaw) || null,
              starters_points: extractStarterPoints(aRaw) || null,
              player_points: (aRaw.player_points && typeof aRaw.player_points === 'object') ? aRaw.player_points : null
            };
            const teamB = {
              rosterId: bPid != null ? String(bPid) : null,
              name: bMeta?.team_name ?? bMeta?.name ?? (bRaw.team_name ?? bRaw.teamName ?? null),
              ownerName: bMeta?.owner_username ?? bMeta?.owner_name ?? bRaw.owner_name ?? bRaw.owner ?? null,
              starters: extractStarters(bRaw) || null,
              starters_points: extractStarterPoints(bRaw) || null,
              player_points: (bRaw.player_points && typeof bRaw.player_points === 'object') ? bRaw.player_points : null
            };

            const teamAScore = computeTotalFromParticipant(aRaw);
            const teamBScore = computeTotalFromParticipant(bRaw);

            normalized.push({
              matchup_id: mid,
              teamA,
              teamB,
              teamAScore,
              teamBScore
            });
          }
        } // end grouping

        // attach to result.weeks[week] as array
        if (normalized.length) {
          // preserve numeric-key style like your example: week number -> array of matchups
          result.weeks[week] = normalized;
        }
      } catch (wkErr) {
        messages.push(`Error fetching/processing week ${week} for season ${year}: ${wkErr?.message ?? wkErr}`);
        continue;
      }
    } // end weeks loop

    // Try writing to static/season_matchups/<year>.json
    const writeOutcome = await tryWriteJson(year, result.weeks);
    if (writeOutcome.ok) {
      messages.push(`Wrote season_matchups/${year}.json -> ${writeOutcome.path}`);
      jsonLinks.push(`/season_matchups/${year}.json`);
      outputs.push({ year, path: writeOutcome.path, weeks: Object.keys(result.weeks).length });
    } else {
      // cannot write — expose payload instead
      messages.push(`Could not write season_matchups/${year}.json to disk: ${writeOutcome.error}. Returning JSON payload in response.`);
      outputs.push({ year, path: null, weeks: Object.keys(result.weeks).length, payload: result.weeks });
    }
  } // end YEARS

  return {
    messages,
    jsonLinks,
    outputs
  };
}
