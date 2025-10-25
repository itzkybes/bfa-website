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

export async function load(event) {
  // cache for edge
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];
  const debug = [];

  // build season chain (same approach as records page)
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { mainLeague = null; messages.push('Failed to fetch base league: ' + (e?.message ?? e)); }

    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id), season: mainLeague.season ?? null, name: mainLeague.name ?? null });
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prev = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prev) break;
          seasons.push({ league_id: String(prev.league_id), season: prev.season ?? null, name: prev.name ?? null });
          currPrev = prev.previous_league_id ? String(prev.previous_league_id) : null;
        } catch (err) { messages.push('Error fetching prev league ' + currPrev + ' — ' + (err?.message ?? err)); break; }
      }
    }
  } catch (err) {
    messages.push('Season chain error: ' + (err?.message ?? err));
  }

  // de-dupe + sort ascending by season
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  seasons = Object.values(byId);
  seasons.sort((a,b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return (a.season < b.season ? -1 : (a.season > b.season ? 1 : 0));
  });

  // choose season param or default to most recent
  const url = event.url;
  const seasonParam = url.searchParams.get('season') ?? null;
  let selectedSeason = seasonParam;
  if (!selectedSeason) {
    // pick the last season in the sorted array (most recent)
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
  // fallback - use BASE_LEAGUE_ID
  if (!selectedLeagueId && seasons.length) selectedLeagueId = seasons[seasons.length - 1].league_id;

  // load league metadata to determine playoff start
  let leagueMeta = null;
  try {
    leagueMeta = selectedLeagueId ? await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }) : null;
  } catch (e) {
    leagueMeta = null;
    messages.push('Failed fetching league meta for selected season: ' + (e?.message ?? e));
  }

  let playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  // regular season weeks: 1 .. playoffStart - 1
  const weeks = [];
  const lastRegularWeek = Math.max(1, playoffStart - 1);
  for (let w = 1; w <= lastRegularWeek; w++) weeks.push(w);

  // Build playoff weeks: playoffStart .. (playoffStart + 2) clamped by MAX_WEEKS
  const playoffWeeks = [];
  const playoffEnd = Math.min(MAX_WEEKS, playoffStart + 2);
  for (let w = playoffStart; w <= playoffEnd; w++) playoffWeeks.push(w);

  // selected week param (or default to latest regular week if not provided)
  const weekParamRaw = url.searchParams.get('week');
  let selectedWeek = null;
  if (weekParamRaw != null) {
    const wp = Number(weekParamRaw);
    selectedWeek = Number.isFinite(wp) && wp >= 1 ? wp : null;
  }
  // If no user week provided, default to last regular week
  if (!selectedWeek) selectedWeek = lastRegularWeek;
  // Clamp selectedWeek to the server-side MAX_WEEKS upper bound
  if (selectedWeek > MAX_WEEKS) selectedWeek = MAX_WEEKS;
  // (do not clamp selectedWeek down to lastRegularWeek — allow playoff weeks to be selected)

  // fetch roster map for selected league (to use latest team names/avatars)
  let rosterMap = {};
  try {
    if (selectedLeagueId) rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    else rosterMap = {};
  } catch (e) { rosterMap = {}; messages.push('Failed to fetch roster map: ' + (e?.message ?? e)); }

  // Build owner->roster mapping to help normalize early JSON ownerName -> rosterId
  const ownerToRoster = {};
  if (rosterMap && Object.keys(rosterMap).length) {
    for (const rk of Object.keys(rosterMap)) {
      try {
        const meta = rosterMap[rk] || {};
        if (meta.owner_name) ownerToRoster[String(meta.owner_name)] = rk;
        if (meta.owner_username) ownerToRoster[String(meta.owner_username)] = rk;
      } catch (e) {}
    }
  }

  // --- Attempt early2023 override if season=2023 and week 1..3 ---
  let earlyOverrideEntries = null;
  let usedEarlyOverride = false;
  try {
    const seasonStr = String(selectedSeason);
    if (seasonStr === '2023' && selectedWeek >= 1 && selectedWeek <= 3) {
      // Build absolute URL to the static asset using request url origin
      const earlyUrl = new URL('/early2023.json', url).toString();
      debug.push(`Attempting to load early2023.json from ${earlyUrl}`);
      try {
        // Use global fetch (event.fetch may not exist in this runtime)
        const r = await fetch(earlyUrl, { cache: 'no-store' });
        if (r && r.ok) {
          const json = await r.json().catch(e => { throw new Error('invalid json: ' + (e?.message ?? e)); });
          if (json && json['2023'] && json['2023'][String(selectedWeek)]) {
            earlyOverrideEntries = json['2023'][String(selectedWeek)];
            usedEarlyOverride = true;
            messages.push(`early2023.json override loaded for 2023 week ${selectedWeek}`);
            debug.push('Override: early2023.json loaded and will be used.');
          } else {
            messages.push('early2023.json fetched but missing expected structure for 2023 -> week ' + selectedWeek);
            debug.push('early2023.json fetched but missing expected structure.');
          }
        } else {
          messages.push('Failed fetching early2023.json: HTTP ' + (r ? r.status : 'no response'));
          debug.push('Fetch returned non-ok response for early2023.json');
        }
      } catch (fetchErr) {
        // network/fetch error
        messages.push('Fetch early2023.json failed: ' + (fetchErr?.message ?? fetchErr));
        debug.push('Fetch early2023.json threw: ' + (fetchErr?.message ?? fetchErr));
        // Do not attempt disk read by default on serverless (may not exist)
      }
    }
  } catch (e) {
    messages.push('early2023 override check error: ' + (e?.message ?? e));
    debug.push('early override general error: ' + (e?.message ?? e));
  }

  // fetch matchups for the selected week (regular season or playoff) — but if early override present, skip remote matchups and use override
  let rawMatchups = [];
  if (!usedEarlyOverride) {
    try {
      if (selectedLeagueId && selectedWeek >= 1) {
        rawMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, selectedWeek, { ttl: 60 * 5 }) || [];
      }
    } catch (e) {
      rawMatchups = [];
      messages.push('Failed to fetch matchups: ' + (e?.message ?? e));
    }
  } else {
    // We'll build rows from earlyOverrideEntries below; keep rawMatchups empty to avoid duplicate logic
    rawMatchups = [];
  }

  // group matchups by matchup id / week
  const byMatch = {};
  for (let i = 0; i < rawMatchups.length; i++) {
    const e = rawMatchups[i];
    const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
    const wk = e.week ?? e.w ?? selectedWeek;
    const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  // Build rows for UI: when pair (2 participants) => Team A vs Team B; when single => Bye; otherwise multi-team combined
  const matchupsRows = [];

  // If early override present, use it to build rows first
  if (usedEarlyOverride && Array.isArray(earlyOverrideEntries)) {
    try {
      for (const m of earlyOverrideEntries) {
        // expected shape in your JSON (teamA, teamB, teamAScore, teamBScore)
        const aName = (m.teamA && (m.teamA.name || m.teamA.ownerName)) ? (m.teamA.name || m.teamA.ownerName) : 'Roster A';
        const bName = (m.teamB && (m.teamB.name || m.teamB.ownerName)) ? (m.teamB.name || m.teamB.ownerName) : 'Roster B';

        // try mapping ownerName -> rosterId if available (ownerName field in JSON)
        const aOwnerName = (m.teamA && m.teamA.ownerName) ? String(m.teamA.ownerName) : null;
        const bOwnerName = (m.teamB && m.teamB.ownerName) ? String(m.teamB.ownerName) : null;

        const aRosterId = aOwnerName && ownerToRoster[aOwnerName] ? String(ownerToRoster[aOwnerName]) : (m.teamA && m.teamA.rosterId ? String(m.teamA.rosterId) : null);
        const bRosterId = bOwnerName && ownerToRoster[bOwnerName] ? String(ownerToRoster[bOwnerName]) : (m.teamB && m.teamB.rosterId ? String(m.teamB.rosterId) : null);

        const aMeta = (aRosterId && rosterMap[aRosterId]) ? rosterMap[aRosterId] : {};
        const bMeta = (bRosterId && rosterMap[bRosterId]) ? rosterMap[bRosterId] : {};

        const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
        const bAvatar = bMeta.team_avatar || bMeta.owner_avatar || null;

        // ensure points are numbers and always present
        const aPts = safeNum(m.teamAScore ?? m.teamAPoints ?? m.teamA?.score ?? 0);
        const bPts = safeNum(m.teamBScore ?? m.teamBPoints ?? m.teamB?.score ?? 0);

        matchupsRows.push({
          matchup_id: `early2023|${selectedWeek}|${matchupsRows.length}`,
          season: selectedSeason ?? null,
          week: selectedWeek,
          teamA: {
            rosterId: aRosterId ?? null,
            name: aName,
            ownerName: aOwnerName ?? aMeta.owner_name ?? aMeta.owner_username ?? null,
            avatar: aAvatar,
            points: aPts
          },
          teamB: {
            rosterId: bRosterId ?? null,
            name: bName,
            ownerName: bOwnerName ?? bMeta.owner_name ?? bMeta.owner_username ?? null,
            avatar: bAvatar,
            points: bPts
          },
          participantsCount: 2,
          __earlyOverride: true
        });
      }
      debug.push(`Built ${matchupsRows.length} matchup rows from early2023.json for 2023 week ${selectedWeek}`);
    } catch (e) {
      messages.push('Error building rows from early2023.json: ' + (e?.message ?? e));
      debug.push('Error while mapping early override to rows: ' + (e?.message ?? e));
    }
  }

  // Next: if no early override rows were created, produce rows from actual matchups fetched via Sleeper
  if (!matchupsRows.length) {
    const keys = Object.keys(byMatch);
    for (const k of keys) {
      const entries = byMatch[k];
      if (!entries || entries.length === 0) continue;

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
        // compute points using starter points where available; fallback to points fields present in entry
        const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? a.starter_points ?? 0);
        const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? b.starter_points ?? 0);
        matchupsRows.push({
          matchup_id: k,
          season: selectedSeason ?? null,
          week: selectedWeek,
          teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts },
          teamB: { rosterId: bId, name: bName, avatar: bAvatar, points: bPts },
          participantsCount: 2
        });
      } else if (entries.length === 1) {
        const a = entries[0];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
        const aMeta = rosterMap[aId] || {};
        const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
        const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
        const aPts = (a.points != null || a.points_for != null || a.pts != null) ? safeNum(a.points ?? a.points_for ?? a.pts ?? 0) : null;
        matchupsRows.push({
          matchup_id: k,
          season: selectedSeason ?? null,
          week: selectedWeek,
          teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts },
          teamB: null,
          participantsCount: 1,
          isBye: true
        });
      } else {
        const participants = entries.map(ent => {
          const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
          const meta = rosterMap[pid] || {};
          return {
            rosterId: pid,
            name: meta.team_name || meta.owner_name || ('Roster ' + pid),
            avatar: meta.team_avatar || meta.owner_avatar || null,
            points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? ent.starter_points ?? 0)
          };
        });
        const combinedNames = participants.map(p => p.name).join(' / ');
        matchupsRows.push({
          matchup_id: k,
          season: selectedSeason ?? null,
          week: selectedWeek,
          combinedParticipants: participants,
          combinedLabel: combinedNames,
          participantsCount: participants.length
        });
      }
    }
  }

  // sort rows by teamA.points desc when possible
  matchupsRows.sort((x,y) => {
    const ax = (x.teamA && x.teamA.points != null) ? x.teamA.points : (x.combinedParticipants ? (x.combinedParticipants[0]?.points || 0) : 0);
    const by = (y.teamA && y.teamA.points != null) ? y.teamA.points : (y.combinedParticipants ? (y.combinedParticipants[0]?.points || 0) : 0);
    return (by - ax);
  });

  // Build week options object for UI (regular + playoff groups)
  const weekOptions = {
    regular: weeks,
    playoffs: playoffWeeks
  };

  // Expose debug info to client explicitly (so client can show whether override was used)
  if (usedEarlyOverride) {
    messages.push(`Override active: using static early2023.json for season 2023 week ${selectedWeek}.`);
    debug.push(`Override active: early2023.json used for 2023 week ${selectedWeek}`);
  }

  return {
    seasons,
    weeks,
    playoffWeeks,
    weekOptions,
    selectedSeason,
    selectedWeek,
    matchupsRows,
    messages,
    debug
  };
}
