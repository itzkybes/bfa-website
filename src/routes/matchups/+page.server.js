// src/routes/matchups/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import fs from 'fs/promises';
import path from 'path';

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

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function sumArray(arr) {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((a, b) => a + safeNum(b), 0);
}

function starterPointsFromEntry(entry) {
  if (!entry) return 0;

  const candidates = [
    'starters_points', 'startersPoints', 'starter_points', 'starterPoints',
    'starter_points_total', 'starters_points_sum', 'starter_points_sum'
  ];

  for (const k of candidates) {
    if (Object.prototype.hasOwnProperty.call(entry, k)) {
      const v = entry[k];
      if (Array.isArray(v)) return sumArray(v);
      if (typeof v === 'number') return safeNum(v);
    }
  }

  if (entry.points != null) return safeNum(entry.points);
  if (entry.points_for != null) return safeNum(entry.points_for);
  if (entry.pts != null) return safeNum(entry.pts);

  return 0;
}

export async function load(event) {
  // set CDN caching
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  // We'll collect messages; note: we'll clear these before the override step as requested.
  let messages = [];
  const prevChain = [];

  // Build seasons chain (walk previous_league_id)
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
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err && err.message ? err.message : err));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error building seasons chain: ' + (err && err.message ? err.message : String(err)));
  }

  // dedupe & sort seasons
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = s;
  seasons = Object.keys(byId).map(k => byId[k]);
  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : 1;
  });

  // selected season default to latest
  let selectedSeasonParam = url.searchParams.get('season') || null;
  if (!selectedSeasonParam) {
    if (seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = 'all';
    }
  }

  // selected week default to 1 (per request)
  let selectedWeek = Number(url.searchParams.get('week') ?? 1);
  if (!selectedWeek || isNaN(selectedWeek) || selectedWeek < 1) selectedWeek = 1;

  // determine league id to process
  let leagueIdToProcess = null;
  if (!selectedSeasonParam || selectedSeasonParam === 'all') {
    leagueIdToProcess = seasons.length ? String(seasons[seasons.length - 1].league_id) : String(BASE_LEAGUE_ID);
  } else {
    let matched = false;
    for (let i = 0; i < seasons.length; i++) {
      if (String(seasons[i].league_id) === String(selectedSeasonParam)) { leagueIdToProcess = String(seasons[i].league_id); matched = true; break; }
    }
    if (!matched) {
      for (let j = 0; j < seasons.length; j++) {
        if (seasons[j].season != null && String(seasons[j].season) === String(selectedSeasonParam)) { leagueIdToProcess = String(seasons[j].league_id); matched = true; break; }
      }
    }
    if (!matched) leagueIdToProcess = String(selectedSeasonParam);
  }

  // build week options using league meta (playoff start)
  let leagueMeta = null;
  try { leagueMeta = await sleeper.getLeague(leagueIdToProcess, { ttl: 60 * 5 }); } catch (e) { leagueMeta = null; }
  let playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  const playoffEnd = playoffStart + 2;
  const weekOptions = {
    regular: Array.from({ length: Math.max(0, playoffStart - 1) }, (_, i) => i + 1),
    playoffs: Array.from({ length: Math.max(0, playoffEnd - playoffStart + 1) }, (_, i) => playoffStart + i)
  };
  const weeks = Array.from({ length: MAX_WEEKS }, (_, i) => i + 1);
  const playoffWeeks = weekOptions.playoffs;

  // fetch roster map (enrichment)
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(leagueIdToProcess, { ttl: 60 * 5 });
    if (!rosterMap || Object.keys(rosterMap).length === 0) {
      const arr = await sleeper.getRostersWithOwners(leagueIdToProcess, { ttl: 60 * 5 }).catch(()=>[]);
      if (Array.isArray(arr) && arr.length) {
        rosterMap = {};
        for (const e of arr) if (e && e.roster_id != null) rosterMap[String(e.roster_id)] = e;
      } else {
        const rawRosters = await sleeper.getRosters(leagueIdToProcess, { ttl: 60 * 5 }).catch(()=>[]);
        const rawUsers = await sleeper.getUsers(leagueIdToProcess, { ttl: 60 * 5 }).catch(()=>[]);
        const usersById = {};
        if (Array.isArray(rawUsers)) for (const u of rawUsers) { const id = u.user_id ?? u.id ?? u.userId; if (id != null) usersById[String(id)] = u; }
        if (Array.isArray(rawRosters)) {
          for (const r of rawRosters) {
            const rid = r.roster_id ?? r.id ?? r.rosterId;
            const ownerId = r.owner_id ?? r.ownerId ?? null;
            const u = ownerId != null ? usersById[String(ownerId)] : null;
            const teamName = (r && r.metadata && r.metadata.team_name) ? r.metadata.team_name : (u ? (u.display_name || u.username || `Roster ${rid}`) : (`Roster ${rid}`));
            rosterMap[String(rid)] = {
              roster_id: String(rid),
              owner_id: ownerId != null ? String(ownerId) : null,
              team_name: teamName,
              owner_name: u ? (u.display_name || u.username || null) : null,
              roster_raw: r,
              user_raw: u || null
            };
          }
        }
      }
    }
  } catch (e) {
    messages.push('Error obtaining roster map: ' + (e && e.message ? e.message : String(e)));
    rosterMap = rosterMap || {};
  }

  // fetch matchups for selected week and normalize
  let matchupsRows = [];
  try {
    const rawMatchups = await sleeper.getMatchupsForWeek(leagueIdToProcess, selectedWeek, { ttl: 60 * 5 });
    const groups = {};
    if (Array.isArray(rawMatchups)) {
      for (let i = 0; i < rawMatchups.length; i++) {
        const e = rawMatchups[i];
        const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
        const wk = e.week ?? e.w ?? selectedWeek;
        const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(e);
      }
    }

    const keys = Object.keys(groups);
    for (let k = 0; k < keys.length; k++) {
      const bucket = groups[keys[k]];
      if (!bucket || bucket.length === 0) continue;

      if (bucket.length === 1) {
        const only = bucket[0];
        const rid = String(only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId ?? '');
        const pts = starterPointsFromEntry(only);
        const meta = rosterMap[rid] || {};
        matchupsRows.push({
          week: selectedWeek,
          season: selectedSeasonParam,
          participantsCount: 1,
          teamA: {
            rosterId: rid,
            name: meta.team_name || (meta.roster_raw && (meta.roster_raw.name || meta.roster_raw.team_name)) || `Roster ${rid}`,
            ownerName: meta.owner_name || null,
            avatar: meta.team_avatar || meta.owner_avatar || null,
            points: pts,
            matchup_id: only.matchup_id ?? only.matchup ?? null
          },
          teamB: {
            rosterId: null,
            name: 'Bye',
            ownerName: null,
            avatar: null,
            points: null,
            matchup_id: null
          }
        });
      } else if (bucket.length >= 2) {
        const parts = bucket.map(e => {
          const rid = String(e.roster_id ?? e.rosterId ?? e.owner_id ?? e.ownerId ?? '');
          const pts = starterPointsFromEntry(e);
          const meta = rosterMap[rid] || {};
          return {
            rosterId: rid,
            name: meta.team_name || (meta.roster_raw && (meta.roster_raw.name || meta.roster_raw.team_name)) || `Roster ${rid}`,
            ownerName: meta.owner_name || null,
            avatar: meta.team_avatar || meta.owner_avatar || null,
            points: pts,
            matchup_id: e.matchup_id ?? e.matchup ?? null,
            raw: e
          };
        });

        if (parts.length === 2) {
          const a = parts[0];
          const b = parts[1];
          matchupsRows.push({
            week: selectedWeek,
            season: selectedSeasonParam,
            participantsCount: 2,
            teamA: { ...a },
            teamB: { ...b }
          });
        } else {
          const combined = parts;
          const wk = selectedWeek;
          matchupsRows.push({
            week: wk,
            season: selectedSeasonParam,
            participantsCount: combined.length,
            combinedParticipants: combined,
            combinedWinnerPoints: combined.reduce((max, p) => Math.max(max, p.points || 0), 0),
            matchupId: keys[k]
          });
        }
      }
    }
  } catch (err) {
    messages.push('Error fetching matchups for week ' + selectedWeek + ': ' + (err && err.message ? err.message : String(err)));
  }

  // --- OVERRIDE: early2023.json for season 2023 weeks 1-3 ---
  // Clear previous debug messages as requested so only override debug is returned.
  messages = [];

  try {
    const useSeason = String(selectedSeasonParam ?? '').trim();
    const useWeek = Number(selectedWeek);
    const isEarly2023 = (useSeason === '2023' && [1, 2, 3].includes(useWeek));

    messages.push(`Override debug: season=${useSeason} week=${useWeek} isEarly2023=${isEarly2023}`);

    if (isEarly2023) {
      // 1) Try event.fetch (served static)
      let ovJson = null;
      try {
        const ovRes = await event.fetch('/early2023.json');
        messages.push(`fetch('/early2023.json') status=${ovRes.status} ok=${ovRes.ok}`);
        const txt = await ovRes.text();
        if (!ovRes.ok) {
          messages.push(`fetch returned non-ok status ${ovRes.status}; response text (first 400 chars): ${txt.slice(0,400)}`);
        } else {
          // attempt parse
          try {
            ovJson = JSON.parse(txt);
            messages.push(`Parsed early2023.json via event.fetch — top-level keys: ${Object.keys(ovJson).slice(0,20).join(', ')}`);
          } catch (pe) {
            messages.push('JSON.parse failed for fetch text: ' + (pe && pe.message ? pe.message : String(pe)));
            messages.push('Fetched body (first 1000 chars): ' + txt.slice(0,1000));
            ovJson = null;
          }
        }
      } catch (fetchErr) {
        messages.push('event.fetch("/early2023.json") threw: ' + (fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr)));
        ovJson = null;
      }

      // 2) If fetch didn't produce JSON, try reading from disk (useful in dev/build)
      if (!ovJson) {
        try {
          const staticPath = path.join(process.cwd(), 'static', 'early2023.json');
          messages.push('Attempting to read from disk: ' + staticPath);
          const raw = await fs.readFile(staticPath, 'utf8');
          try {
            ovJson = JSON.parse(raw);
            messages.push('Parsed early2023.json from disk successfully.');
          } catch (pe2) {
            messages.push('JSON.parse failed for disk file: ' + (pe2 && pe2.message ? pe2.message : String(pe2)));
            messages.push('Disk file body (first 1000 chars): ' + raw.slice(0,1000));
            ovJson = null;
          }
        } catch (fsErr) {
          messages.push('Reading static/early2023.json from disk failed: ' + (fsErr && fsErr.message ? fsErr.message : String(fsErr)));
        }
      }

      // 3) If we have JSON, validate shape and map to matchupsRows
      if (ovJson) {
        if (ovJson['2023'] && ovJson['2023'][String(useWeek)] && Array.isArray(ovJson['2023'][String(useWeek)])) {
          const overrides = ovJson['2023'][String(useWeek)];
          messages.push(`early2023.json contains ${overrides.length} entries for 2023 week ${useWeek}. Mapping...`);
          const mapped = overrides.map((m, idx) => {
            const tA = m.teamA || {};
            const tB = m.teamB || {};
            const ownerA = tA.ownerName ?? tA.owner_name ?? null;
            const ownerB = tB.ownerName ?? tB.owner_name ?? null;
            return {
              week: useWeek,
              season: useSeason,
              participantsCount: 2,
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
              matchupId: m.matchupId ?? m.matchup_id ?? `hardcoded-2023-${useWeek}-${idx}`
            };
          });

          matchupsRows = mapped;
          messages.push(`Applied early2023 override: ${mapped.length} matchups replaced for season ${useSeason} week ${useWeek}`);
        } else {
          // present but missing the exact key — show top-level keys for debugging
          const topKeys = Object.keys(ovJson).slice(0,50);
          messages.push(`early2023.json parsed but missing key '2023' or week '${useWeek}'. top-level keys: ${topKeys.join(', ')}`);
        }
      } else {
        messages.push('No valid early2023.json found (fetch + disk attempts failed or produced invalid JSON).');
      }
    } else {
      messages.push('Override conditions not met — not applying early2023.json (season/week mismatch).');
    }
  } catch (ovErr) {
    messages.push('Unexpected error during override processing: ' + (ovErr && ovErr.message ? ovErr.message : String(ovErr)));
    console.error('early2023 override error', ovErr);
  }

  // return payload
  return {
    seasons,
    weeks,
    weekOptions,
    playoffWeeks,
    selectedSeason: selectedSeasonParam,
    selectedWeek,
    matchupsRows,
    messages,
    prevChain
  };
}
