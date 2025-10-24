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

const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function sumArray(arr) {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((a, b) => a + safeNum(b), 0);
}

// Try to determine a sensible "starter points" total for an entry.
// Prefer explicit starter arrays (starters_points etc.), fall back to points / points_for.
function starterPointsFromEntry(entry) {
  if (!entry) return 0;

  // common keys that may contain starter-level points (array or number)
  const candidates = [
    'starters_points', 'startersPoints', 'starter_points', 'starterPoints',
    'starters_points_total', 'starters_points_total', 'starters_points_sum'
  ];

  for (const k of candidates) {
    if (Object.prototype.hasOwnProperty.call(entry, k)) {
      const v = entry[k];
      if (Array.isArray(v)) return sumArray(v);
      if (typeof v === 'number') return safeNum(v);
      // sometimes it's an object mapping or string; ignore
    }
  }

  // fallback to points fields
  if (entry.points != null) return safeNum(entry.points);
  if (entry.points_for != null) return safeNum(entry.points_for);
  if (entry.pts != null) return safeNum(entry.pts);

  // ultimate fallback 0
  return 0;
}

export async function load(event) {
  // CDN caching
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const messages = [];
  const prevChain = [];

  // Build seasons chain (walk previous_league_id from BASE_LEAGUE_ID)
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

  // dedupe by league id & sort by season (old -> new)
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

  // selected season: param or latest
  let selectedSeasonParam = url.searchParams.get('season') || null;
  if (!selectedSeasonParam) {
    if (seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = 'all';
    }
  }

  // selected week: param or default 1
  let selectedWeek = Number(url.searchParams.get('week') ?? 1);
  if (!selectedWeek || isNaN(selectedWeek) || selectedWeek < 1) selectedWeek = 1;

  // decide league id to process for selectedSeasonParam
  let leagueIdToProcess = null;
  if (!selectedSeasonParam || selectedSeasonParam === 'all') {
    leagueIdToProcess = seasons.length ? String(seasons[seasons.length - 1].league_id) : String(BASE_LEAGUE_ID);
  } else {
    // try match by league_id
    let matched = false;
    for (let i = 0; i < seasons.length; i++) {
      if (String(seasons[i].league_id) === String(selectedSeasonParam)) { leagueIdToProcess = String(seasons[i].league_id); matched = true; break; }
    }
    if (!matched) {
      // try match by season value
      for (let j = 0; j < seasons.length; j++) {
        if (seasons[j].season != null && String(seasons[j].season) === String(selectedSeasonParam)) { leagueIdToProcess = String(seasons[j].league_id); matched = true; break; }
      }
    }
    if (!matched) leagueIdToProcess = String(selectedSeasonParam);
  }

  // prepare week lists: we'll attempt to get playoff start from league meta
  let weekOptions = { regular: [], playoffs: [] };
  let weeks = Array.from({ length: MAX_WEEKS }, (_, i) => i + 1);
  let playoffWeeks = [];

  let leagueMeta = null;
  try {
    leagueMeta = await sleeper.getLeague(leagueIdToProcess, { ttl: 60 * 5 });
  } catch (e) {
    leagueMeta = null;
  }

  let playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  const playoffEnd = playoffStart + 2;

  weekOptions.regular = Array.from({ length: Math.max(0, playoffStart - 1) }, (_, i) => i + 1);
  weekOptions.playoffs = Array.from({ length: Math.max(0, playoffEnd - playoffStart + 1) }, (_, i) => playoffStart + i);
  playoffWeeks = weekOptions.playoffs;

  // fetch roster map (for enrichment)
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(leagueIdToProcess, { ttl: 60 * 5 });
    if (!rosterMap || Object.keys(rosterMap).length === 0) {
      // fallback to getRostersWithOwners
      const arr = await sleeper.getRostersWithOwners(leagueIdToProcess, { ttl: 60 * 5 });
      if (Array.isArray(arr) && arr.length) {
        rosterMap = {};
        for (const e of arr) if (e && e.roster_id != null) rosterMap[String(e.roster_id)] = e;
      } else {
        // deeper fallback -> raw rosters & users
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

  // fetch matchups for the selected week and normalize into rows
  let matchupsRows = [];
  try {
    const rawMatchups = await sleeper.getMatchupsForWeek(leagueIdToProcess, selectedWeek, { ttl: 60 * 5 });
    // group entries by matchup_id (or synthetic key) so pairs are identified
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

    // convert groups to match rows (teamA/teamB)
    const keys = Object.keys(groups);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      const bucket = groups[key];
      if (!bucket || bucket.length === 0) continue;

      // if bucket has 2 entries, treat as a head-to-head; otherwise handle multi-team or single participant (bye)
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
        // sort deterministically so teamA/teamB are stable (by rosterId)
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

        // If bucket length is exactly 2, map to teamA/teamB
        if (parts.length === 2) {
          // preserve the order as given by Sleeper (bucket array order), but ensure stable assignment
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
          // multi-team matchup: create a combinedParticipants list and include participantsCount
          const combined = parts;
          const wk = selectedWeek;
          matchupsRows.push({
            week: wk,
            season: selectedSeasonParam,
            participantsCount: combined.length,
            combinedParticipants: combined,
            // compute combined winner points for highlighting
            combinedWinnerPoints: combined.reduce((max, p) => Math.max(max, p.points || 0), 0),
            matchupId: key
          });
        }
      }
    }
  } catch (err) {
    messages.push('Error fetching matchups for week ' + selectedWeek + ': ' + (err && err.message ? err.message : String(err)));
  }

  // --- override early2023.json for season 2023 weeks 1-3 if present ---
  try {
    const useSeason = String(selectedSeasonParam ?? '').trim();
    const useWeek = Number(selectedWeek);
    const isEarly2023 = (useSeason === '2023' && [1, 2, 3].includes(useWeek));

    if (isEarly2023) {
      // server-side fetch of static asset (works when static files are served at root)
      const ovRes = await event.fetch('/static/early2023.json');
      if (ovRes && ovRes.ok) {
        let ovJson = null;
        try { ovJson = await ovRes.json(); } catch (e) { ovJson = null; messages.push('early2023.json parse failed: ' + (e && e.message ? e.message : e)); }

        if (ovJson && ovJson['2023'] && Array.isArray(ovJson['2023'][String(useWeek)])) {
          const overrides = ovJson['2023'][String(useWeek)];

          const mapped = overrides.map((m, idx) => {
            const tA = m.teamA || {};
            const tB = m.teamB || {};

            // Determine ownerName keys: allow ownerName or owner_name
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
          messages.push(`Applied early2023.json overrides for season ${useSeason} week ${useWeek} (${mapped.length} matchups)`);
        } else {
          messages.push(`early2023.json present but no entry for season 2023 week ${useWeek}`);
        }
      } else {
        messages.push('No early2023.json found (fetch failed)');
      }
    }
  } catch (ovErr) {
    console.error('Error applying early2023 overrides:', ovErr);
    messages.push('Error applying early2023 overrides: ' + (ovErr && ovErr.message ? ovErr.message : String(ovErr)));
  }

  // Return payload expected by client page
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
