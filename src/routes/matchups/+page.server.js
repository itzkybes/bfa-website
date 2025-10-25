// src/routes/matchups/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { readFile } from 'fs/promises';
import path from 'path';

// pick cache: prefer global KV if available, otherwise memory cache
var cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) cache = createKVCache(globalThis.KV);
  else cache = createMemoryCache();
} catch (e) {
  cache = createMemoryCache();
}

// create client singleton
var SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
var sleeper = createSleeperClient({ cache: cache, concurrency: SLEEPER_CONCURRENCY });

// config
var BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID)
  ? process.env.BASE_LEAGUE_ID
  : '1219816671624048640';
var MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

// Attempt to load /early2023.json from static folder.
// Tries event.fetch (if present), then global fetch, then reading from disk.
async function loadEarly2023Json(event, debug) {
  const attempts = [];
  // prefer absolute url via event.url root (served static files are available at /early2023.json)
  try {
    const fetchFn = (event && typeof event.fetch === 'function') ? event.fetch : (typeof fetch !== 'undefined' ? fetch : null);
    if (fetchFn) {
      const url = new URL('/early2023.json', event.url).toString();
      attempts.push(`Attempting fetch url: ${url}`);
      try {
        const res = await fetchFn(url);
        if (res && res.ok) {
          const json = await res.json();
          debug.push('Loaded early2023.json via fetch');
          return json;
        } else {
          attempts.push(`fetch returned ${res && res.status ? res.status : 'no response'}`);
        }
      } catch (ferr) {
        attempts.push('fetch attempt failed: ' + (ferr && ferr.message ? ferr.message : String(ferr)));
      }
    } else {
      attempts.push('no fetch available in runtime');
    }
  } catch (e) {
    attempts.push('fetch attempt threw: ' + (e && e.message ? e.message : String(e)));
  }

  // fallback: read from disk relative to process.cwd() / static/early2023.json
  try {
    const fp = path.resolve(process.cwd(), 'static', 'early2023.json');
    attempts.push(`Attempting readFile path: ${fp}`);
    const txt = await readFile(fp, 'utf8');
    const json = JSON.parse(txt);
    debug.push('Loaded early2023.json from disk');
    return json;
  } catch (rerr) {
    attempts.push('readFile attempt failed: ' + (rerr && rerr.message ? rerr.message : String(rerr)));
  }

  debug.push('No valid early2023.json found. Attempts: ' + attempts.join(' | '));
  return null;
}

// normalize avatar id/token to a usable URL where possible
function normalizeAvatarUrl(av) {
  if (!av) return null;
  try {
    const s = String(av);
    if (s.startsWith('http')) return s;
    // common Sleeper avatar token -> CDN path
    if (/^[0-9a-fA-F]{6,}$/.test(s) || s.indexOf('/') === -1) return 'https://sleepercdn.com/avatars/' + s;
    return s;
  } catch (e) {
    return null;
  }
}

// Compute starter-based points for a participant entry.
// Tries many common fields and structures; prefer summing explicit starter points (mapping or keyed by starter ids).
function computeStarterPointsForEntry(entry) {
  if (!entry) return 0;
  // 1) direct starter points fields
  const directCandidates = [
    'starter_points',
    'starterPoints',
    'starters_points',
    'startersPoints',
    'starters_points_total',
    'startersPointsTotal',
    'starters_total_points'
  ];
  for (const k of directCandidates) {
    if (entry[k] != null && !isNaN(Number(entry[k]))) return Number(entry[k]);
  }

  // 2) entry.starters_points as an object mapping playerId -> points
  // or entry.starters_points_map etc
  const mapCandidates = [
    'starters_points_map',
    'startersPointsMap',
    'starters_points_map',
    'starters_points_by_player',
    'players_points', // sometimes present
    'player_points'
  ];
  for (const k of mapCandidates) {
    if (entry[k] && typeof entry[k] === 'object') {
      try {
        let sum = 0;
        for (const key in entry[k]) {
          const v = entry[k][key];
          const n = Number(v);
          if (!isNaN(n)) sum += n;
        }
        if (sum !== 0) return sum;
      } catch (e) { /* ignore */ }
    }
  }

  // 3) If entry has starters array and a players_points mapping in same object -> sum those ids
  try {
    const starters = entry.starters || entry.starting_lineup || entry.starting || [];
    const pointsMap = entry.players_points || entry.player_points || entry.players_points_map || entry.player_points_map || null;
    if (Array.isArray(starters) && pointsMap && typeof pointsMap === 'object') {
      let sum = 0;
      for (const pid of starters) {
        const v = pointsMap[pid] ?? pointsMap[String(pid).toUpperCase()] ?? pointsMap[String(pid).toLowerCase()];
        const n = Number(v);
        if (!isNaN(n)) sum += n;
      }
      if (sum !== 0) return sum;
    }
  } catch (e) {}

  // 4) If starters array and 'player_points' nested array of {player_id, points}
  try {
    const starters = entry.starters || entry.starting_lineup || entry.starting || [];
    const playersPointsArr = entry.players_points_array || entry.player_points_array || entry.player_points_list;
    if (Array.isArray(starters) && Array.isArray(playersPointsArr)) {
      const byId = {};
      for (const item of playersPointsArr) {
        const pid = item.player_id ?? item.pid ?? item.id;
        const val = item.points ?? item.pts ?? item.value;
        if (pid != null) byId[String(pid)] = Number(val) || 0;
      }
      let sum = 0;
      for (const pid of starters) {
        sum += byId[String(pid)] || 0;
      }
      if (sum !== 0) return sum;
    }
  } catch (e) {}

  // 5) fallback to any 'points' or 'points_for' or 'pts' on the participant
  const fallbackCandidates = ['points', 'points_for', 'pts', 'total_points', 'points_total'];
  for (const k of fallbackCandidates) {
    if (entry[k] != null && !isNaN(Number(entry[k]))) return Number(entry[k]);
  }

  // final fallback: 0
  return 0;
}

export async function load(event) {
  // caching header
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const selectedSeasonParam = url.searchParams.get('season') || 'current';
  const selectedWeekParam = url.searchParams.get('week') ? Number(url.searchParams.get('week')) : null;

  const debug = [];
  const messages = [];
  const prevChain = [];

  // Build seasons chain (same style as other loaders so UI can render seasons)
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { debug.push('Failed fetching base league: ' + (e && e.message ? e.message : String(e))); }
    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id || BASE_LEAGUE_ID), season: mainLeague.season || null, name: mainLeague.name || null });
      prevChain.push(String(mainLeague.league_id || BASE_LEAGUE_ID));
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) { debug.push('Could not fetch previous_league_id ' + currPrev); break; }
          seasons.push({ league_id: String(prevLeague.league_id || currPrev), season: prevLeague.season || null, name: prevLeague.name || null });
          prevChain.push(String(prevLeague.league_id || currPrev));
          currPrev = prevLeague.previous_league_id ? String(prevLeague.previous_league_id) : null;
        } catch (err) { debug.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err && err.message ? err.message : String(err))); break; }
      }
    }
  } catch (err) {
    debug.push('Error building seasons chain: ' + (err && err.message ? err.message : String(err)));
  }

  // dedupe & sort seasons
  const byId = {};
  for (let i = 0; i < seasons.length; i++) byId[String(seasons[i].league_id)] = seasons[i];
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);
  seasons.sort(function (a, b) {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : 1;
  });

  // choose leagueId to process
  let leagueIdToProcess = null;
  if (!selectedSeasonParam || selectedSeasonParam === 'current' || selectedSeasonParam === 'all') {
    if (seasons.length === 0) leagueIdToProcess = BASE_LEAGUE_ID;
    else leagueIdToProcess = String(seasons[seasons.length - 1].league_id);
  } else {
    let matched = false;
    for (let i = 0; i < seasons.length; i++) {
      if (String(seasons[i].league_id) === String(selectedSeasonParam)) { leagueIdToProcess = String(seasons[i].league_id); matched = true; break; }
    }
    if (!matched) {
      for (let j = 0; j < seasons.length; j++) {
        if (String(seasons[j].season) === String(selectedSeasonParam)) { leagueIdToProcess = String(seasons[j].league_id); matched = true; break; }
      }
    }
    if (!matched) leagueIdToProcess = String(selectedSeasonParam);
  }

  // Load roster map with owners for enrichment
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(leagueIdToProcess, { ttl: 60 * 5 }) || {};
    debug.push('Loaded rosterMapWithOwners (' + Object.keys(rosterMap).length + ' entries)');
  } catch (e) {
    rosterMap = {};
    debug.push('Failed to load rosterMapWithOwners: ' + (e && e.message ? e.message : String(e)));
  }

  // Build lookup: owner_username -> rosterId, owner_name -> rosterId
  const usernameToRoster = {};
  const ownerNameToRoster = {};
  for (const rk in rosterMap) {
    if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
    const meta = rosterMap[rk] || {};
    if (meta.owner_username) usernameToRoster[String(meta.owner_username).toLowerCase()] = String(rk);
    if (meta.owner_name) ownerNameToRoster[String(meta.owner_name).toLowerCase()] = String(rk);
  }

  // Prepare weeksParticipants object
  const weeksParticipants = {}; // week -> [ participant objects ]
  const weeks = []; // list of weeks discovered
  const weekOptions = { regular: [], playoffs: [] };

  // Attempt to load early2023 JSON (we will use it to override weeks 1..3 for 2023)
  let early2023Json = null;
  try {
    early2023Json = await loadEarly2023Json(event, debug);
  } catch (e) {
    debug.push('early2023 load error: ' + (e && e.message ? e.message : String(e)));
    early2023Json = null;
  }

  // Determine league metadata (season name)
  let leagueMeta = null;
  try { leagueMeta = await sleeper.getLeague(leagueIdToProcess, { ttl: 60 * 5 }); } catch (e) { leagueMeta = null; }
  const leagueSeason = (leagueMeta && leagueMeta.season) ? String(leagueMeta.season) : null;

  // Loop weeks and collect participants
  for (let week = 1; week <= MAX_WEEKS; week++) {
    // only collect weeks that actually have matchups; we'll skip empty weeks
    let matchups = null;
    try {
      matchups = await sleeper.getMatchupsForWeek(leagueIdToProcess, week, { ttl: 60 * 5 });
    } catch (e) {
      debug.push('Error fetching matchups for week ' + week + ': ' + (e && e.message ? e.message : String(e)));
      // continue to next week (do not break)
      continue;
    }
    if (!matchups || !matchups.length) continue;

    // record week
    weeks.push(week);
    // bucket options: naive split: regular 1..15, playoffs afterwards (we keep simple)
    if (week <= 16) weekOptions.regular.push(week);
    else weekOptions.playoffs.push(week);

    // Build participants list for this week
    const participants = [];

    // matchups is an array of participant entries (Sleeper returns an array where each object is one participant in a matchup)
    // group them by matchup identifier (matchup_id | matchup) so we can process pairings
    const byMatch = {};
    for (let mi = 0; mi < matchups.length; mi++) {
      const e = matchups[mi];
      const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
      const key = mid != null ? String(mid) : 'AUTO|' + week + '|' + mi;
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(e);
    }

    // For each group, create normalized participant objects
    const matchKeys = Object.keys(byMatch);
    for (let kIdx = 0; kIdx < matchKeys.length; kIdx++) {
      const mk = matchKeys[kIdx];
      const group = byMatch[mk];
      // each item in group is a participant record
      for (let pIdx = 0; pIdx < group.length; pIdx++) {
        const raw = group[pIdx] || {};
        const rosterId = raw.roster_id ?? raw.rosterId ?? raw.owner_id ?? raw.ownerId ?? raw.owner ?? raw.id ?? null;
        // compute starter-only points where possible
        const starterPoints = computeStarterPointsForEntry(raw);
        // fallback total points if starterPoints === 0 (but prefer starters)
        let pts = starterPoints;
        if ((pts === 0 || pts == null) && raw.points != null) pts = safeNum(raw.points);
        if ((pts === 0 || pts == null) && raw.points_for != null) pts = safeNum(raw.points_for);
        if ((pts === 0 || pts == null) && raw.pts != null) pts = safeNum(raw.pts);

        // enrich with roster meta
        const meta = rosterMap && rosterMap[String(rosterId)] ? rosterMap[String(rosterId)] : null;
        const team_name = meta ? (meta.team_name || meta.user_raw?.metadata?.team_name || null) : (raw.team_name || raw.team || raw.name || null);
        const owner_name = meta ? (meta.owner_name || meta.user_raw?.display_name || meta.user_raw?.username || null) : (raw.owner_name || raw.owner || raw.user?.display_name || raw.user?.username || null);
        const avatar = normalizeAvatarUrl(meta ? (meta.team_avatar || meta.owner_avatar || meta.user_raw?.avatar || meta.user_raw?.metadata?.avatar) : (raw.team_avatar || raw.owner_avatar || raw.user?.avatar || raw.user?.metadata?.avatar));

        participants.push({
          raw: raw,
          week,
          matchup_id: mk,
          rosterId: rosterId != null ? String(rosterId) : null,
          points: safeNum(pts),
          team_name: team_name || null,
          owner_name: owner_name || null,
          avatar: avatar || null
        });
      }
    }

    weeksParticipants[week] = participants;
  } // end weeks loop

  // If season is 2023 and we have early2023.json and weeks 1..3, override those weeks
  try {
    if (leagueSeason === '2023' && early2023Json && early2023Json['2023']) {
      debug.push(`Override check: season=2023, early2023Json present`);
      const seasonObj = early2023Json['2023'] || {};
      for (const wkStr of ['1', '2', '3']) {
        const wk = Number(wkStr);
        const arr = seasonObj[wkStr];
        if (!Array.isArray(arr)) { debug.push(`early2023.json missing week ${wkStr}`); continue; }

        // create a new participants list for this week from static JSON entries
        const newParts = [];
        for (let i = 0; i < arr.length; i++) {
          const item = arr[i];
          try {
            // teamA / teamB objects
            const ta = item.teamA || item.home || null;
            const tb = item.teamB || item.away || null;
            const aName = ta && (ta.name ?? ta.team_name) ? String(ta.name ?? ta.team_name) : null;
            const aOwner = ta && (ta.ownerName ?? ta.owner_name ?? ta.ownerUsername ?? ta.owner) ? String(ta.ownerName ?? ta.owner_name ?? ta.ownerUsername ?? ta.owner) : null;
            const bName = tb && (tb.name ?? tb.team_name) ? String(tb.name ?? tb.team_name) : null;
            const bOwner = tb && (tb.ownerName ?? tb.owner_name ?? tb.ownerUsername ?? tb.owner) ? String(tb.ownerName ?? tb.owner_name ?? tb.ownerUsername ?? tb.owner) : null;
            const aScore = safeNum(item.teamAScore ?? item.homeScore ?? item.scoreA ?? item.scoreA ?? item.aScore);
            const bScore = safeNum(item.teamBScore ?? item.awayScore ?? item.scoreB ?? item.bScore);

            // find rosterId from rosterMap by owner username or owner_name
            let aRosterId = null;
            let bRosterId = null;
            if (aOwner) {
              const low = String(aOwner).toLowerCase();
              if (usernameToRoster[low]) aRosterId = usernameToRoster[low];
              else if (ownerNameToRoster[low]) aRosterId = ownerNameToRoster[low];
            }
            if (bOwner) {
              const lowb = String(bOwner).toLowerCase();
              if (usernameToRoster[lowb]) bRosterId = usernameToRoster[lowb];
              else if (ownerNameToRoster[lowb]) bRosterId = ownerNameToRoster[lowb];
            }

            const matchupId = `early2023-${wk}-${i}`;

            const metaA = (aRosterId && rosterMap && rosterMap[aRosterId]) ? rosterMap[aRosterId] : null;
            const metaB = (bRosterId && rosterMap && rosterMap[bRosterId]) ? rosterMap[bRosterId] : null;

            newParts.push({
              raw: item.teamA,
              week: wk,
              matchup_id: matchupId,
              rosterId: aRosterId != null ? String(aRosterId) : null,
              points: aScore,
              team_name: metaA ? (metaA.team_name || aName) : (aName || null),
              owner_name: metaA ? (metaA.owner_name || aOwner) : (aOwner || null),
              avatar: normalizeAvatarUrl(metaA ? (metaA.team_avatar || metaA.owner_avatar) : null)
            });

            newParts.push({
              raw: item.teamB,
              week: wk,
              matchup_id: matchupId,
              rosterId: bRosterId != null ? String(bRosterId) : null,
              points: bScore,
              team_name: metaB ? (metaB.team_name || bName) : (bName || null),
              owner_name: metaB ? (metaB.owner_name || bOwner) : (bOwner || null),
              avatar: normalizeAvatarUrl(metaB ? (metaB.team_avatar || metaB.owner_avatar) : null)
            });
          } catch (inner) {
            debug.push('Error processing early2023 item: ' + (inner && inner.message ? inner.message : String(inner)));
          }
        }

        // replace in weeksParticipants
        weeksParticipants[wk] = newParts;
        if (!weeks.includes(wk)) weeks.push(wk);
        debug.push(`Applied early2023 override for week ${wk} with ${newParts.length} participants`);
      }
    }
  } catch (e) {
    debug.push('Failed applying early2023 override: ' + (e && e.message ? e.message : String(e)));
  }

  // ensure weeks list is sorted unique
  const uniqWeeks = Array.from(new Set(weeks)).sort((a,b) => a - b);

  // choose selectedWeek fallback if not provided in query
  const selectedWeek = selectedWeekParam && Number.isFinite(Number(selectedWeekParam)) ? Number(selectedWeekParam) : (uniqWeeks.length ? uniqWeeks[0] : 1);

  // build a simple matchupsRows fallback (for clients expecting the old shape)
  const matchupsRows = [];
  for (const wk of uniqWeeks) {
    // group participants by matchup_id to create rows
    const participants = weeksParticipants[wk] || [];
    const byMatch = {};
    for (const p of participants) {
      const mid = p.matchup_id ?? ('auto|' + wk + '|' + (p.rosterId || Math.random()));
      if (!byMatch[mid]) byMatch[mid] = [];
      byMatch[mid].push(p);
    }
    const keys = Object.keys(byMatch);
    for (const mk of keys) {
      const parts = byMatch[mk] || [];
      // build teamA/teamB shapes if there are 2 participants
      if (parts.length === 2) {
        matchupsRows.push({
          week: wk,
          matchup_id: mk,
          participantsCount: 2,
          teamA: { rosterId: parts[0].rosterId, name: parts[0].team_name, ownerName: parts[0].owner_name, avatar: parts[0].avatar, points: parts[0].points },
          teamB: { rosterId: parts[1].rosterId, name: parts[1].team_name, ownerName: parts[1].owner_name, avatar: parts[1].avatar, points: parts[1].points }
        });
      } else if (parts.length === 1) {
        matchupsRows.push({
          week: wk,
          matchup_id: mk,
          participantsCount: 1,
          teamA: { rosterId: parts[0].rosterId, name: parts[0].team_name, ownerName: parts[0].owner_name, avatar: parts[0].avatar, points: parts[0].points }
        });
      } else if (parts.length > 2) {
        // multi-team match
        matchupsRows.push({
          week: wk,
          matchup_id: mk,
          participantsCount: parts.length,
          combinedParticipants: parts.map(p => ({ rosterId: p.rosterId, name: p.team_name, avatar: p.avatar, points: p.points }))
        });
      }
    }
  }

  // return payload for client
  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    weeks: uniqWeeks,
    weekOptions,
    selectedWeek,
    weeksParticipants, // main new data structure client asked for
    matchupsRows,
    debug,
    messages,
    prevChain
  };
}
