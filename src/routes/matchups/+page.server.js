// src/routes/matchups/+page.server.js
// Loader for matchups page — fetches matchups for a selected season/week,
// normalizes rows for the UI, and supports an override via static/early2023.json
// (disk-based lookup similar to how client-side fetch('/week-ranges.json') would resolve).
//
// Returns:
// {
//   seasons, selectedSeason, weeks, weekOptions, playoffWeeks,
//   selectedWeek, matchupsRows, messages
// }

import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// pick cache: prefer global KV if available, otherwise memory cache
let cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) cache = createKVCache(globalThis.KV);
  else cache = createMemoryCache();
} catch (e) {
  cache = createMemoryCache();
}

// create client singleton
const SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
const sleeper = createSleeperClient({ cache: cache, concurrency: SLEEPER_CONCURRENCY });

const BASE_LEAGUE_ID = process.env.BASE_LEAGUE_ID || '1219816671624048640';
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// simple avatar helper (used for normalized rows)
function avatarOrPlaceholder(url, name, size = 64) {
  if (url) return url;
  const letter = name ? String(name)[0] : 'T';
  return `https://via.placeholder.com/${size}?text=${encodeURIComponent(letter)}`;
}

// Try to load early2023.json from disk using a set of candidate paths.
// Returns parsed JSON or null and pushes debug messages into `messages` array.
async function tryLoadEarlyJsonFromDisk(messages) {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), 'static', 'early2023.json'),
    path.join(process.cwd(), 'public', 'early2023.json'),
    path.join(process.cwd(), 'bfa-website', 'static', 'early2023.json'),
    path.join(process.cwd(), 'bfa-website', 'public', 'early2023.json'),
    path.resolve(moduleDir, '..', '..', '..', '..', 'static', 'early2023.json'),
    path.resolve(moduleDir, '..', '..', '..', '..', 'public', 'early2023.json')
  ];

  for (const c of candidates) {
    try {
      messages.push(`Attempting to read from disk: ${c}`);
      const raw = await fs.readFile(c, 'utf8');
      try {
        const parsed = JSON.parse(raw);
        messages.push(`Read and parsed early2023.json from disk: ${c}`);
        return parsed;
      } catch (pe) {
        messages.push(`Parsing failed for ${c}: ${pe && pe.message ? pe.message : String(pe)}`);
      }
    } catch (re) {
      messages.push(`Reading ${c} failed: ${re && re.message ? re.message : String(re)}`);
    }
  }
  return null;
}

// Normalize raw matchups array returned by Sleeper into rows with teamA/teamB
function normalizeMatchupsRawToRows(matchupsRaw, rosterMap, selectedWeek, selectedSeason, messages) {
  // group by matchup_id|week (robust)
  const byMatch = {};
  for (let i = 0; i < (matchupsRaw || []).length; i++) {
    const e = matchupsRaw[i];
    const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
    const wk = e.week ?? e.w ?? selectedWeek;
    const key = String(mid != null ? (`${mid}|${wk}`) : (`auto|${wk}|${i}`));
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  const keys = Object.keys(byMatch);
  const rows = [];
  for (let k = 0; k < keys.length; k++) {
    const bucket = byMatch[keys[k]];
    if (!bucket || bucket.length === 0) continue;

    // For 2-participant matchups, create teamA/teamB
    if (bucket.length >= 2) {
      // If more than 2, pair first two (UI code can handle multi-matchup separately)
      const a = bucket[0];
      const b = bucket[1];
      const pidA = a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? null;
      const pidB = b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? null;
      const ptsA = safeNum(a.starter_points ?? a.starters_points ?? a.starters_points_for ?? a.points ?? a.points_for ?? 0);
      const ptsB = safeNum(b.starter_points ?? b.starters_points ?? b.starters_points_for ?? b.points ?? b.points_for ?? 0);

      const metaA = rosterMap && rosterMap[pidA] ? rosterMap[pidA] : {};
      const metaB = rosterMap && rosterMap[pidB] ? rosterMap[pidB] : {};

      rows.push({
        week: selectedWeek,
        season: selectedSeason,
        participantsCount: 2,
        matchupId: midToString(a.matchup_id ?? a.matchupId ?? a.matchup ?? keys[k]),
        teamA: {
          rosterId: pidA != null ? String(pidA) : null,
          name: metaA.team_name ?? metaA.teamName ?? metaA.team ?? metaA.name ?? (a.team_name ?? a.name ?? `Roster ${pidA}`),
          ownerName: metaA.owner_name ?? metaA.ownerName ?? metaA.owner ?? (a.owner_name ?? a.owner ?? null),
          avatar: metaA.team_avatar ?? metaA.owner_avatar ?? null,
          points: ptsA,
          matchup_id: a.matchup_id ?? a.matchupId ?? a.matchup ?? null
        },
        teamB: {
          rosterId: pidB != null ? String(pidB) : null,
          name: metaB.team_name ?? metaB.teamName ?? metaB.team ?? metaB.name ?? (b.team_name ?? b.name ?? `Roster ${pidB}`),
          ownerName: metaB.owner_name ?? metaB.ownerName ?? metaB.owner ?? (b.owner_name ?? b.owner ?? null),
          avatar: metaB.team_avatar ?? metaB.owner_avatar ?? null,
          points: ptsB,
          matchup_id: b.matchup_id ?? b.matchupId ?? b.matchup ?? null
        },
        // keep raw participants for debug if needed
        participants: bucket.map(x => ({
          rosterId: x.roster_id ?? x.rosterId ?? x.owner_id ?? x.ownerId,
          points: safeNum(x.starter_points ?? x.starters_points ?? x.starters_points_for ?? x.points ?? x.points_for ?? 0),
          matchup_id: x.matchup_id ?? x.matchupId ?? x.matchup ?? null,
          raw: x
        }))
      });
    } else if (bucket.length === 1) {
      const only = bucket[0];
      const pid = only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId ?? null;
      const pts = safeNum(only.starter_points ?? only.starters_points ?? only.starters_points_for ?? only.points ?? only.points_for ?? 0);
      const meta = rosterMap && rosterMap[pid] ? rosterMap[pid] : {};
      rows.push({
        week: selectedWeek,
        season: selectedSeason,
        participantsCount: 1,
        matchupId: midToString(only.matchup_id ?? only.matchupId ?? only.matchup ?? keys[k]),
        teamA: {
          rosterId: pid != null ? String(pid) : null,
          name: meta.team_name ?? meta.teamName ?? meta.team ?? meta.name ?? (only.team_name ?? only.name ?? `Roster ${pid}`),
          ownerName: meta.owner_name ?? meta.ownerName ?? meta.owner ?? (only.owner_name ?? only.owner ?? null),
          avatar: meta.team_avatar ?? meta.owner_avatar ?? null,
          points: pts,
          matchup_id: only.matchup_id ?? only.matchupId ?? only.matchup ?? null
        },
        teamB: {
          rosterId: null,
          name: 'Bye',
          ownerName: null,
          avatar: null,
          points: null,
          matchup_id: null
        },
        participants: bucket.map(x => ({
          rosterId: x.roster_id ?? x.rosterId ?? x.owner_id ?? x.ownerId,
          points: safeNum(x.starter_points ?? x.starters_points ?? x.starters_points_for ?? x.points ?? x.points_for ?? 0),
          matchup_id: x.matchup_id ?? x.matchupId ?? x.matchup ?? null,
          raw: x
        }))
      });
    }
  }

  return rows;

  function midToString(mid) {
    if (mid == null) return String(Math.random()).slice(2, 10);
    return String(mid);
  }
}

export async function load(event) {
  // Cloud CDN caching
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const messages = [];
  const prevChain = [];

  // Build seasons chain (similar approach as other loaders)
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { messages.push('Failed fetching base league: ' + (e && e.message ? e.message : e)); }
    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id || BASE_LEAGUE_ID), season: mainLeague.season || null, name: mainLeague.name || null });
      prevChain.push(String(mainLeague.league_id || BASE_LEAGUE_ID));
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) { messages.push('Could not fetch previous_league_id ' + currPrev); break; }
          seasons.push({ league_id: String(prevLeague.league_id || currPrev), season: prevLeague.season || null, name: prevLeague.name || null });
          prevChain.push(String(prevLeague.league_id || currPrev));
          currPrev = prevLeague.previous_league_id ? String(prevLeague.previous_league_id) : null;
        } catch (err) { messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err && err.message ? err.message : err)); break; }
      }
    }
  } catch (err) {
    messages.push('Error building seasons chain: ' + (err && err.message ? err.message : err));
  }

  // dedupe & sort
  const byId = {};
  for (let i = 0; i < seasons.length; i++) byId[String(seasons[i].league_id)] = seasons[i];
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);
  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : 1;
  });

  // determine selectedSeason and selectedWeek from query params
  const incomingSeasonParam = url.searchParams.get('season') || null;
  let selectedSeason = incomingSeasonParam;
  if (!selectedSeason) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeason = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeason = 'all';
    }
  }

  const incomingWeekParam = url.searchParams.get('week') || null;
  let selectedWeek = incomingWeekParam ? Number(incomingWeekParam) : 1;
  if (!selectedWeek || isNaN(selectedWeek) || selectedWeek < 1) selectedWeek = 1;

  // Compose week options (attempt to use league metadata if present; fallback to 1..MAX_WEEKS)
  const weekOptions = { regular: [], playoffs: [] };
  const weeks = [];
  const playoffWeeks = [];

  for (let w = 1; w <= MAX_WEEKS; w++) {
    weeks.push(w);
  }

  // fetch rosterMap for enrichment
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(BASE_LEAGUE_ID, { ttl: 60 * 5 }) || {};
    messages.push('Loaded rosterMap with ' + Object.keys(rosterMap).length + ' entries.');
  } catch (e) {
    rosterMap = {};
    messages.push('Failed to load rosterMap: ' + (e && e.message ? e.message : e));
  }

  // Default: fetch matchups for selectedWeek from Sleeper
  let matchupsRaw = null;
  try {
    matchupsRaw = await sleeper.getMatchupsForWeek(BASE_LEAGUE_ID, selectedWeek, { ttl: 60 * 5 });
    if (!matchupsRaw) matchupsRaw = [];
    messages.push('Fetched ' + matchupsRaw.length + ' raw matchup entries from Sleeper for week ' + selectedWeek + '.');
  } catch (e) {
    matchupsRaw = [];
    messages.push('Error fetching matchups for week ' + selectedWeek + ': ' + (e && e.message ? e.message : e));
  }

  // Normalize into rows
  let matchupsRows = normalizeMatchupsRawToRows(matchupsRaw, rosterMap, selectedWeek, selectedSeason, messages);

  // --- OVERRIDE: early2023.json for season 2023 weeks 1-3 ---
  // Clear previous debug messages so override debug is focused and easy to read.
  try {
    messages.length = 0; // clear prior debug

    const useSeason = String(selectedSeason ?? '').trim();
    const useWeek = Number(selectedWeek);
    const isEarly2023 = (useSeason === '2023' && [1, 2, 3].includes(useWeek));
    messages.push(`Override debug: season=${useSeason} week=${useWeek} isEarly2023=${isEarly2023}`);

    if (isEarly2023) {
      // Try to load early2023.json from disk (multiple candidate locations)
      let ovJson = null;
      try {
        ovJson = await tryLoadEarlyJsonFromDisk(messages);
      } catch (err) {
        messages.push('Unexpected error while attempting disk load of early2023.json: ' + (err && err.message ? err.message : String(err)));
      }

      if (!ovJson) {
        messages.push('No valid early2023.json found (disk attempts failed or produced invalid JSON).');
      } else {
        // ensure structure and map into matchupsRows
        const seasonKey = '2023';
        const wkKey = String(useWeek);
        if (ovJson[seasonKey] && Array.isArray(ovJson[seasonKey][wkKey])) {
          const overrides = ovJson[seasonKey][wkKey];
          messages.push(`early2023.json contains ${overrides.length} entries for ${seasonKey} week ${wkKey}. Applying override...`);
          const mapped = overrides.map((m, idx) => {
            const tA = m.teamA || {};
            const tB = m.teamB || {};
            const ownerA = tA.ownerName ?? tA.owner_name ?? null;
            const ownerB = tB.ownerName ?? tB.owner_name ?? null;
            return {
              week: useWeek,
              season: useSeason,
              participantsCount: 2,
              matchupId: m.matchupId ?? m.matchup_id ?? `hardcoded-2023-${useWeek}-${idx}`,
              teamA: {
                rosterId: null,
                name: (typeof tA.name === 'string') ? tA.name : (tA.team_name || ''),
                ownerName: ownerA,
                avatar: tA.avatar ?? null,
                points: safeNum(m.teamAScore ?? m.homeScore ?? (tA.score ?? NaN)),
                matchup_id: m.matchupId ?? m.matchup_id ?? `hardcoded-2023-${useWeek}-${idx}`
              },
              teamB: {
                rosterId: null,
                name: (typeof tB.name === 'string') ? tB.name : (tB.team_name || ''),
                ownerName: ownerB,
                avatar: tB.avatar ?? null,
                points: safeNum(m.teamBScore ?? m.awayScore ?? (tB.score ?? NaN)),
                matchup_id: m.matchupId ?? m.matchup_id ?? `hardcoded-2023-${useWeek}-${idx}`
              },
              participants: [
                {
                  rosterId: null,
                  points: safeNum(m.teamAScore ?? m.homeScore ?? 0),
                  matchup_id: m.matchupId ?? m.matchup_id ?? `hardcoded-2023-${useWeek}-${idx}`,
                  raw: m
                },
                {
                  rosterId: null,
                  points: safeNum(m.teamBScore ?? m.awayScore ?? 0),
                  matchup_id: m.matchupId ?? m.matchup_id ?? `hardcoded-2023-${useWeek}-${idx}`,
                  raw: m
                }
              ]
            };
          });

          matchupsRows = mapped;
          messages.push(`Applied early2023 override: ${mapped.length} matchups replaced for season ${useSeason} week ${useWeek}`);
        } else {
          messages.push(`early2023.json parsed but missing expected key '${seasonKey}' or week '${wkKey}'. Top-level keys: ${Object.keys(ovJson).slice(0,50).join(', ')}`);
        }
      }
    } else {
      messages.push('Override conditions not met — not applying early2023.json (season/week mismatch).');
    }
  } catch (ovErr) {
    messages.push('Unexpected error during override processing: ' + (ovErr && ovErr.message ? ovErr.message : String(ovErr)));
    console.error('early2023 override error', ovErr);
  }

  // Return shape used by client-side page:
  return {
    seasons,
    prevChain,
    selectedSeason,
    weeks,
    weekOptions,
    playoffWeeks,
    selectedWeek,
    matchupsRows,
    messages
  };
}
