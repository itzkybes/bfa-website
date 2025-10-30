// src/routes/standings/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { readFile } from 'fs/promises';

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
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;
// list of years to attempt loading (you can extend this)
const SEASON_MATCHUP_YEARS = [2022, 2023, 2024];

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// compute streaks from results array (array of 'W'/'L'/'T')
function computeStreaks(resultsArray) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  if (!resultsArray || !Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
  for (let i = 0; i < resultsArray.length; i++) {
    const r = resultsArray[i];
    if (r === 'W') {
      curW += 1; curL = 0; if (curW > maxW) maxW = curW;
    } else if (r === 'L') {
      curL += 1; curW = 0; if (curL > maxL) maxL = curL;
    } else {
      curW = 0; curL = 0;
    }
  }
  return { maxW, maxL };
}

async function tryLoadEarly2023(origin) {
  if (origin && typeof origin === 'string') {
    try {
      const url = origin.replace(/\/$/, '') + '/early2023.json';
      const res = await fetch(url, { method: 'GET' });
      if (res && res.ok) {
        const txt = await res.text();
        try {
          return JSON.parse(txt);
        } catch (e) {}
      }
    } catch (e) {}
  }
  try {
    const fileUrl = new URL('../../../static/early2023.json', import.meta.url);
    const txt = await readFile(fileUrl, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

// Try to load per-year season_matchups JSON (fetch origin first, then static file)
async function tryLoadSeasonMatchups(years, origin) {
  const map = {};
  const jsonLinks = [];
  for (const y of years) {
    let loaded = null;
    // remote fetch first if origin given
    if (origin && typeof origin === 'string') {
      try {
        const url = origin.replace(/\/$/, '') + `/season_matchups/${String(y)}.json`;
        const res = await fetch(url, { method: 'GET' });
        if (res && res.ok) {
          const txt = await res.text();
          loaded = JSON.parse(txt);
          jsonLinks.push(url);
        }
      } catch (e) {
        loaded = null;
      }
    }

    // static file fallback
    if (!loaded) {
      try {
        const fileUrl = new URL(`../../../static/season_matchups/${String(y)}.json`, import.meta.url);
        const txt = await readFile(fileUrl, 'utf8');
        loaded = JSON.parse(txt);
        jsonLinks.push(`/season_matchups/${String(y)}.json`);
      } catch (e) {
        loaded = null;
      }
    }

    if (loaded) map[String(y)] = loaded;
  }
  return { map, jsonLinks };
}

// robust participant points extractor — prefers starters-only values if present
function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== 'object') return 0;

  const arrayKeys = ['starters_points', 'starter_points', 'startersPoints', 'starterPoints', 'starters_points_list'];
  for (const k of arrayKeys) {
    if (Array.isArray(entry[k]) && entry[k].length) {
      let s = 0;
      for (const v of entry[k]) s += safeNum(v);
      return Math.round(s * 100) / 100;
    }
  }

  if (Array.isArray(entry.starters) && entry.player_points && typeof entry.player_points === 'object') {
    let s = 0;
    for (const st of entry.starters) {
      const pval = entry.player_points[String(st)] ?? entry.player_points[st];
      s += safeNum(pval);
    }
    return Math.round(s * 100) / 100;
  }

  if (Array.isArray(entry.starters) && entry.starters.length && typeof entry.starters[0] === 'object') {
    let s = 0;
    for (const obj of entry.starters) {
      s += safeNum(obj.points ?? obj.p);
    }
    return Math.round(s * 100) / 100;
  }

  const fallback = safeNum(entry.points ?? entry.points_for ?? entry.pts ?? entry.score ?? 0);
  return Math.round(fallback * 100) / 100;
}

// Build a standings list from maps (reused)
function buildStandingsFromMaps(statsByRoster, resultsByRoster, paByRoster, rosterMap) {
  const standings = [];
  let iterationKeys = Object.keys(resultsByRoster);
  if (iterationKeys.length === 0 && rosterMap && Object.keys(rosterMap).length) iterationKeys = Object.keys(rosterMap);

  for (let idx = 0; idx < iterationKeys.length; idx++) {
    const ridK = iterationKeys[idx];
    if (!Object.prototype.hasOwnProperty.call(statsByRoster, ridK)) {
      statsByRoster[ridK] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: (rosterMap && rosterMap[ridK] ? rosterMap[ridK].roster_raw : null) };
    }
    const s = statsByRoster[ridK];
    const wins = s.wins || 0;
    const losses = s.losses || 0;
    const ties = s.ties || 0;
    const pfVal = Math.round((s.pf || 0) * 100) / 100;
    const paVal = Math.round((paByRoster[ridK] || s.pa || 0) * 100) / 100;

    const meta = (rosterMap && rosterMap[ridK]) ? rosterMap[ridK] : {};
    const team_name = meta.team_name ? meta.team_name : ((s.roster && s.roster.metadata && s.roster.metadata.team_name) ? s.roster.metadata.team_name : ('Roster ' + ridK));
    const owner_name = meta.owner_name || (s.roster && s.roster.metadata && s.roster.metadata.owner_name) || null;
    const team_avatar = meta.team_avatar || null;
    const owner_avatar = meta.owner_avatar || null;
    const avatar = team_avatar || owner_avatar || null;

    const resArr = resultsByRoster && resultsByRoster[ridK] ? resultsByRoster[ridK] : [];
    const streaks = computeStreaks(resArr);

    standings.push({
      rosterId: ridK,
      owner_id: meta.owner_id || null,
      team_name: team_name,
      owner_name: owner_name,
      avatar: avatar,
      wins: wins,
      losses: losses,
      ties: ties,
      pf: pfVal,
      pa: paVal,
      champion: false,
      maxWinStreak: streaks.maxW,
      maxLoseStreak: streaks.maxL
    });
  }

  standings.sort(function (a, b) {
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    return (b.pf || 0) - (a.pf || 0);
  });

  return standings;
}

// ---------- helper to detect explicit zero scores in next-week matchups ----------
function nextWeekContainsExplicitZero(matchupsArr) {
  if (!Array.isArray(matchupsArr) || matchupsArr.length === 0) return false;

  for (const m of matchupsArr) {
    if (Object.prototype.hasOwnProperty.call(m, 'teamAScore') && Number(m.teamAScore) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'teamBScore') && Number(m.teamBScore) === 0) return true;

    if (m.teamA && Object.prototype.hasOwnProperty.call(m.teamA, 'score') && Number(m.teamA.score) === 0) return true;
    if (m.teamB && Object.prototype.hasOwnProperty.call(m, 'score') && Number(m.teamB.score) === 0) return true;
    if (m.teamA && Object.prototype.hasOwnProperty.call(m.teamA, 'points') && Number(m.teamA.points) === 0) return true;
    if (m.teamB && Object.prototype.hasOwnProperty.call(m.teamB, 'points') && Number(m.teamB.points) === 0) return true;

    if (Object.prototype.hasOwnProperty.call(m, 'points') && Number(m.points) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'points_for') && Number(m.points_for) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'pts') && Number(m.pts) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'score') && Number(m.score) === 0) return true;
  }
  return false;
}

// canonicalization helper for H2H keys / avatar / display
function canonicalFromParticipant(obj, rosterMap) {
  // return { key, teamName, ownerName, avatar }
  if (!obj || typeof obj !== 'object') return null;

  // prefer roster id if present
  const rid = obj.rosterId ?? obj.roster_id ?? obj.id ?? obj.roster ?? obj.ownerId ?? obj.owner_id ?? null;
  // owner name fields
  const ownerName = obj.ownerName ?? obj.owner_name ?? obj.owner ?? obj.owner_username ?? null;
  const teamName = obj.name ?? obj.team_name ?? obj.team ?? null;

  // if rosterMap provided and rid found, prefer its metadata (and avatar)
  if (rid != null && rosterMap && rosterMap[String(rid)]) {
    const meta = rosterMap[String(rid)];
    const key = meta.owner_username ? ('owner:' + String(meta.owner_username).toLowerCase()) : ('roster:' + String(rid));
    const avatar = meta.team_avatar || meta.owner_avatar || null;
    return { key, teamName: meta.team_name || teamName || null, ownerName: meta.owner_name || ownerName || null, avatar };
  }

  // fallback to owner-based key if we have owner name (lowercased)
  if (ownerName && typeof ownerName === 'string') {
    const key = 'owner:' + String(ownerName).toLowerCase();
    // avatar may be on object (teamAvatar, avatar)
    const avatar = obj.teamAvatar ?? obj.team_avatar ?? obj.ownerAvatar ?? obj.owner_avatar ?? obj.avatar ?? null;
    return { key, teamName: teamName || null, ownerName: ownerName || null, avatar };
  }

  // fallback to roster:id key if we have an id
  if (rid != null) {
    const key = 'roster:' + String(rid);
    const avatar = obj.teamAvatar ?? obj.team_avatar ?? obj.ownerAvatar ?? obj.owner_avatar ?? obj.avatar ?? null;
    return { key, teamName: teamName || null, ownerName: ownerName || null, avatar };
  }

  // last resort: use team name as key (lowercased)
  if (teamName && typeof teamName === 'string') {
    const key = 'team:' + String(teamName).toLowerCase();
    const avatar = obj.teamAvatar ?? obj.team_avatar ?? obj.avatar ?? null;
    return { key, teamName: teamName, ownerName: ownerName, avatar };
  }

  return null;
}

export async function load(event) {
  // set CDN caching
  event.setHeaders({
    'cache-control': 's-maxage=120, stale-while-revalidate=300'
  });

  const url = event.url;
  const origin = url?.origin || null;
  const incomingSeasonParam = url.searchParams.get('season') || null;
  const messages = [];
  const prevChain = [];

  // Ownership remapping: combine Bellooshio & cholybevv into JakePratt
  const OWNER_REPARENT = {
    'bellooshio': 'jakepratt',
    'cholybevv': 'jakepratt'
  };
  // canonical display names for mapped owners
  const OWNER_DISPLAY = {
    'jakepratt': 'JakePratt'
  };
  const ownershipNotes = [];

  // Load season_matchups JSONs (server-side). We'll process them into per-year standings.
  let seasonMatchupsMap = {};
  let jsonLinks = [];
  try {
    const loaded = await tryLoadSeasonMatchups(SEASON_MATCHUP_YEARS, origin);
    seasonMatchupsMap = loaded.map || {};
    jsonLinks = loaded.jsonLinks || [];
    if (Object.keys(seasonMatchupsMap).length) {
      messages.push('Loaded season_matchups JSON for years: ' + Object.keys(seasonMatchupsMap).join(', ') + '.');
    } else {
      messages.push('No season_matchups JSON files found for configured years: ' + SEASON_MATCHUP_YEARS.join(', ') + '.');
    }
  } catch (e) {
    messages.push('Error loading season_matchups JSON: ' + (e?.message ?? String(e)));
    seasonMatchupsMap = {};
  }

  // Build seasons chain via previous_league_id starting from BASE_LEAGUE_ID
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
      prevChain.push(String(mainLeague.league_id || BASE_LEAGUE_ID));

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
          prevChain.push(String(prevLeague.league_id || currPrev));
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

  // dedupe by league id and sort
  const byId = {};
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);

  seasons.sort(function (a, b) {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  // Determine selectedSeasonParam (kept for compatibility though we will aggregate across all season JSONs)
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = 'all';
    }
  }

  // choose league ids to process (existing behavior)
  const leagueIdsToProcess = [];
  if (!selectedSeasonParam || selectedSeasonParam === 'all') {
    if (seasons.length === 0) leagueIdsToProcess.push(BASE_LEAGUE_ID);
    else for (let ii = 0; ii < seasons.length; ii++) leagueIdsToProcess.push(String(seasons[ii].league_id));
  } else {
    let matched = false;
    for (let jj = 0; jj < seasons.length; jj++) {
      if (String(seasons[jj].league_id) === String(selectedSeasonParam)) {
        leagueIdsToProcess.push(String(seasons[jj].league_id));
        matched = true;
        break;
      }
    }
    if (!matched) {
      for (let kk = 0; kk < seasons.length; kk++) {
        if (seasons[kk].season != null && String(seasons[kk].season) === String(selectedSeasonParam)) {
          leagueIdsToProcess.push(String(seasons[kk].league_id));
          matched = true;
          break;
        }
      }
    }
    if (!matched) leagueIdsToProcess.push(String(selectedSeasonParam));
  }

  const seasonsResults = [];
  let anyDataFound = false;

  // Hardcoded champions by season-year -> owner username (owner_username)
  const HARDCODED_CHAMPIONS = {
    '2022': 'riguy506',
    '2023': 'armyjunior',
    '2024': 'riguy506'
  };

  // Helper: build roster maps for quick lookups
  function buildRosterLookup(rosterMap) {
    const usernameToRoster = {};
    const ownerNameToRoster = {};
    const teamNameToRoster = {};
    for (const rk in rosterMap) {
      if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
      const meta = rosterMap[rk] || {};
      if (meta.owner_username) usernameToRoster[String(meta.owner_username).toLowerCase()] = String(rk);
      if (meta.owner_name) ownerNameToRoster[String(meta.owner_name).toLowerCase()] = String(rk);
      if (meta.team_name) teamNameToRoster[String(meta.team_name).toLowerCase()] = String(rk);
    }
    return { usernameToRoster, ownerNameToRoster, teamNameToRoster };
  }

  // We'll collect match-level margin candidates while processing both JSONs and API matchups
  const marginCandidates = [];
  // H2H records map (pairKey -> aggregated record)
  const h2hRecords = {};

  // helper to update h2h record given two canonical participants and points
  function updateH2H(aCanon, bCanon, ptsA, ptsB, season, week) {
    if (!aCanon || !bCanon) return;
    const keyA = aCanon.key;
    const keyB = bCanon.key;
    if (!keyA || !keyB) return;
    // apply owner reparent mapping to keys (if owner mapped)
    let ka = keyA;
    let kb = keyB;

    // if owner keys and mapped, replace
    if (ka.startsWith('owner:')) {
      const o = ka.slice(6);
      if (OWNER_REPARENT[o]) ka = 'owner:' + OWNER_REPARENT[o];
    }
    if (kb.startsWith('owner:')) {
      const o2 = kb.slice(6);
      if (OWNER_REPARENT[o2]) kb = 'owner:' + OWNER_REPARENT[o2];
    }

    // keep deterministic ordering
    const ordered = ka < kb ? [ka, kb] : [kb, ka];
    const pairKey = ordered[0] + '|' + ordered[1];
    const isAis1 = (ka === ordered[0]); // whether A maps to team1 in stored record

    if (!h2hRecords[pairKey]) {
      h2hRecords[pairKey] = {
        team1Key: ordered[0],
        team2Key: ordered[1],
        team1Name: (isAis1 ? (aCanon.teamName || aCanon.ownerName) : (bCanon.teamName || bCanon.ownerName)) || null,
        team2Name: (isAis1 ? (bCanon.teamName || bCanon.ownerName) : (aCanon.teamName || aCanon.ownerName)) || null,
        team1Owner: (isAis1 ? aCanon.ownerName : bCanon.ownerName) || null,
        team2Owner: (isAis1 ? bCanon.ownerName : aCanon.ownerName) || null,
        team1Avatar: (isAis1 ? aCanon.avatar : bCanon.avatar) || null,
        team2Avatar: (isAis1 ? bCanon.avatar : aCanon.avatar) || null,
        wins1: 0,
        wins2: 0,
        pf1: 0,
        pf2: 0,
        ties: 0,
        meetings: 0
      };
    }

    const rec = h2hRecords[pairKey];
    // points must be oriented to stored ordering
    let pf1 = isAis1 ? ptsA : ptsB;
    let pf2 = isAis1 ? ptsB : ptsA;
    rec.pf1 += Number(pf1 || 0);
    rec.pf2 += Number(pf2 || 0);
    rec.meetings = (rec.meetings || 0) + 1;
    if (Math.abs((ptsA || 0) - (ptsB || 0)) < 1e-9) {
      rec.ties = (rec.ties || 0) + 1;
    } else if ((ptsA || 0) > (ptsB || 0)) {
      if (isAis1) rec.wins1 = (rec.wins1 || 0) + 1;
      else rec.wins2 = (rec.wins2 || 0) + 1;
    } else {
      if (isAis1) rec.wins2 = (rec.wins2 || 0) + 1;
      else rec.wins1 = (rec.wins1 || 0) + 1;
    }
    // Optionally update names/avatars if null
    if (!rec.team1Name) rec.team1Name = (isAis1 ? aCanon.teamName : bCanon.teamName) || null;
    if (!rec.team2Name) rec.team2Name = (isAis1 ? bCanon.teamName : aCanon.teamName) || null;
    if (!rec.team1Avatar) rec.team1Avatar = (isAis1 ? aCanon.avatar : bCanon.avatar) || null;
    if (!rec.team2Avatar) rec.team2Avatar = (isAis1 ? bCanon.avatar : aCanon.avatar) || null;
    if (!rec.team1Owner) rec.team1Owner = (isAis1 ? aCanon.ownerName : bCanon.ownerName) || null;
    if (!rec.team2Owner) rec.team2Owner = (isAis1 ? bCanon.ownerName : aCanon.ownerName) || null;
  }

  // 1) First: process any season_matchups JSON *as their own seasons*
  for (const yearKey of Object.keys(seasonMatchupsMap)) {
    try {
      const matchupsByWeek = seasonMatchupsMap[yearKey];
      if (!matchupsByWeek) continue;

      // grab playoff_week_start from JSON if present (support top-level or _meta)
      const playoffStartFromJson = (typeof matchupsByWeek.playoff_week_start === 'number') ? Number(matchupsByWeek.playoff_week_start)
        : (matchupsByWeek._meta && typeof matchupsByWeek._meta.playoff_week_start === 'number') ? Number(matchupsByWeek._meta.playoff_week_start)
        : 15;

      // When building per-week for this JSON, we must avoid using the current in-progress week.
      // Rule: for week W, if matchupsByWeek[W+1] exists and contains explicit numeric zero(s), treat W as current and skip it.
      const statsByRosterRegular = {}, resultsByRosterRegular = {}, paByRosterRegular = {};
      const statsByRosterPlayoff = {}, resultsByRosterPlayoff = {}, paByRosterPlayoff = {};

      for (let week = 1; week <= MAX_WEEKS; week++) {
        const matchups = matchupsByWeek[String(week)] || [];
        if (!matchups || !matchups.length) continue;

        const effectivePlayoffStart = playoffStartFromJson || 15;
        const playoffEnd = effectivePlayoffStart + 2;
        const isRegularWeek = (week >= 1 && week < effectivePlayoffStart);
        const isPlayoffWeek = (week >= effectivePlayoffStart && week <= playoffEnd);
        if (!isRegularWeek && !isPlayoffWeek) continue;

        // DON'T apply "next-week-zero" check for final playoff week
        if (week !== playoffEnd) {
          const nextMatchups = matchupsByWeek[String(week + 1)];
          if (nextMatchups && nextMatchups.length && nextWeekContainsExplicitZero(nextMatchups)) {
            // detected in-progress (current) week — skip this week entirely
            continue;
          }
        }

        const statsByRoster = isPlayoffWeek ? statsByRosterPlayoff : statsByRosterRegular;
        const resultsByRoster = isPlayoffWeek ? resultsByRosterPlayoff : resultsByRosterRegular;
        const paByRoster = isPlayoffWeek ? paByRosterPlayoff : paByRosterRegular;

        for (const m of matchups) {
          const a = m.teamA ?? null;
          const b = m.teamB ?? null;

          if (a && b) {
            const ridA = String(a.rosterId ?? a.roster_id ?? a.id ?? a.roster ?? a.ownerId ?? a.owner_id);
            const ridB = String(b.rosterId ?? b.roster_id ?? b.id ?? b.roster ?? b.ownerId ?? b.owner_id);
            const ptsA = safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? m.points ?? 0);
            const ptsB = safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? 0);

            // record margin candidate for this matchup, include avatars when present
            try {
              const margin = Math.abs(ptsA - ptsB);
              // prefer explicit avatar fields on entries, else fallback to any nested avatar fields
              const avatarA = a.avatar ?? a.teamAvatar ?? a.team_avatar ?? a.ownerAvatar ?? a.owner_avatar ?? null;
              const avatarB = b.avatar ?? b.teamAvatar ?? b.team_avatar ?? b.ownerAvatar ?? b.owner_avatar ?? null;
              marginCandidates.push({
                margin: margin,
                season: String(yearKey),
                week: Number(week),
                teamA: a.name ?? null,
                ownerA: a.ownerName ?? null,
                teamB: b.name ?? null,
                ownerB: b.ownerName ?? null,
                pfA: ptsA,
                pfB: ptsB,
                avatarA: avatarA,
                avatarB: avatarB
              });
            } catch (e) {}

            // update H2H from these JSON-style participants (no rosterMap available here)
            try {
              const aCanon = canonicalFromParticipant(a, null);
              const bCanon = canonicalFromParticipant(b, null);
              updateH2H(aCanon, bCanon, ptsA, ptsB, yearKey, week);
            } catch (e) {}

            paByRoster[ridA] = paByRoster[ridA] || 0;
            paByRoster[ridB] = paByRoster[ridB] || 0;
            resultsByRoster[ridA] = resultsByRoster[ridA] || [];
            resultsByRoster[ridB] = resultsByRoster[ridB] || [];
            statsByRoster[ridA] = statsByRoster[ridA] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
            statsByRoster[ridB] = statsByRoster[ridB] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };

            statsByRoster[ridA].pf += ptsA;
            statsByRoster[ridB].pf += ptsB;

            const oppAvgA = ptsB;
            const oppAvgB = ptsA;
            paByRoster[ridA] += oppAvgA;
            paByRoster[ridB] += oppAvgB;

            if (ptsA > oppAvgA + 1e-9) { resultsByRoster[ridA].push('W'); statsByRoster[ridA].wins += 1; }
            else if (ptsA < oppAvgA - 1e-9) { resultsByRoster[ridA].push('L'); statsByRoster[ridA].losses += 1; }
            else { resultsByRoster[ridA].push('T'); statsByRoster[ridA].ties += 1; }

            if (ptsB > oppAvgB + 1e-9) { resultsByRoster[ridB].push('W'); statsByRoster[ridB].wins += 1; }
            else if (ptsB < oppAvgB - 1e-9) { resultsByRoster[ridB].push('L'); statsByRoster[ridB].losses += 1; }
            else { resultsByRoster[ridB].push('T'); statsByRoster[ridB].ties += 1; }

            if (!statsByRoster[ridA].roster) statsByRoster[ridA].roster = { metadata: { team_name: a.name ?? null, owner_name: a.ownerName ?? null } };
            else statsByRoster[ridA].roster.metadata = { team_name: statsByRoster[ridA].roster.metadata?.team_name || a.name || null, owner_name: statsByRoster[ridA].roster.metadata?.owner_name || a.ownerName || null };

            if (!statsByRoster[ridB].roster) statsByRoster[ridB].roster = { metadata: { team_name: b.name ?? null, owner_name: b.ownerName ?? null } };
            else statsByRoster[ridB].roster.metadata = { team_name: statsByRoster[ridB].roster.metadata?.team_name || b.name || null, owner_name: statsByRoster[ridB].roster.metadata?.owner_name || b.ownerName || null };
          } else if (a) {
            const ridOnly = String(a.rosterId ?? a.roster_id ?? a.id ?? a.roster ?? a.ownerId ?? a.owner_id);
            const ptsOnly = safeNum(m.teamAScore ?? m.teamA?.score ?? m.points ?? 0);
            paByRoster[ridOnly] = paByRoster[ridOnly] || 0;
            resultsByRoster[ridOnly] = resultsByRoster[ridOnly] || [];
            statsByRoster[ridOnly] = statsByRoster[ridOnly] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
            statsByRoster[ridOnly].pf += ptsOnly;
            if (!statsByRoster[ridOnly].roster) statsByRoster[ridOnly].roster = { metadata: { team_name: a.name ?? null, owner_name: a.ownerName ?? null } };
            else statsByRoster[ridOnly].roster.metadata = { team_name: statsByRoster[ridOnly].roster.metadata?.team_name || a.name || null, owner_name: statsByRoster[ridOnly].roster.metadata?.owner_name || a.ownerName || null };
          }
        }
      }

      const regularStandings = buildStandingsFromMaps(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular, {});
      const playoffStandings = buildStandingsFromMaps(statsByRosterPlayoff, resultsByRosterPlayoff, paByRosterPlayoff, {});
      seasonsResults.push({
        leagueId: 'season_json_' + String(yearKey),
        season: String(yearKey),
        leagueName: 'Season ' + String(yearKey) + ' (JSON)',
        playoff_week_start: playoffStartFromJson,
        regularStandings: regularStandings,
        playoffStandings: playoffStandings,
        _fromJson: true
      });
      anyDataFound = true;
      messages.push('Processed season_matchups JSON for year ' + String(yearKey) + ' (playoff_week_start=' + playoffStartFromJson + ').');
    } catch (e) {
      messages.push('Error processing season_matchups JSON for year ' + yearKey + ' — ' + (e?.message ?? String(e)));
    }
  }

  // 2) Then: process leagues discovered via API (existing behavior) — this will add more seasonsResults entries
  for (let li = 0; li < leagueIdsToProcess.length; li++) {
    const leagueId = leagueIdsToProcess[li];
    try {
      let leagueMeta = null;
      try { leagueMeta = await sleeper.getLeague(leagueId, { ttl: 60 * 5 }); } catch (e) { leagueMeta = null; }

      const leagueSeason = leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null;
      const leagueName = leagueMeta && leagueMeta.name ? leagueMeta.name : null;

      // Get enriched roster map from client
      let rosterMap = {};
      try {
        rosterMap = await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 }) || {};
      } catch (e) {
        rosterMap = {};
      }

      const { usernameToRoster, ownerNameToRoster, teamNameToRoster } = buildRosterLookup(rosterMap);

      // Determine playoff week boundaries (fallback to 15 if missing)
      let playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
      if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
      const playoffEnd = playoffStart + 2;

      // trackers for regular vs playoffs
      const statsByRosterRegular = {}, resultsByRosterRegular = {}, paByRosterRegular = {};
      const statsByRosterPlayoff = {}, resultsByRosterPlayoff = {}, paByRosterPlayoff = {};

      // seed keys from rosterMap if available
      if (rosterMap && Object.keys(rosterMap).length) {
        for (const rk2 in rosterMap) {
          if (!Object.prototype.hasOwnProperty.call(rosterMap, rk2)) continue;
          statsByRosterRegular[String(rk2)] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk2].roster_raw || null };
          resultsByRosterRegular[String(rk2)] = [];
          paByRosterRegular[String(rk2)] = 0;

          statsByRosterPlayoff[String(rk2)] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk2].roster_raw || null };
          resultsByRosterPlayoff[String(rk2)] = [];
          paByRosterPlayoff[String(rk2)] = 0;
        }
      }

      // Try loading early2023.json once per league loop (we'll use it for weeks 1..3 when season === 2023)
      let earlyData = null;
      try {
        if (String(leagueSeason) === '2023') {
          earlyData = await tryLoadEarly2023(origin);
          if (!earlyData) messages.push('early2023.json not available for 2023; will use API values.');
        }
      } catch (err) {
        earlyData = null;
        messages.push('Error loading early2023.json: ' + (err?.message ?? String(err)));
      }

      // If we have season_matchups JSON for this leagueSeason, prefer it for week data (but keep API fallback)
      const seasonMatchupsForLeague = (leagueSeason && seasonMatchupsMap[String(leagueSeason)]) ? seasonMatchupsMap[String(leagueSeason)] : null;
      let seasonJsonPlayoffStart = null;
      if (seasonMatchupsForLeague) {
        // check JSON for a playoff_week_start override
        seasonJsonPlayoffStart = (typeof seasonMatchupsForLeague.playoff_week_start === 'number') ? Number(seasonMatchupsForLeague.playoff_week_start)
          : (seasonMatchupsForLeague._meta && typeof seasonMatchupsForLeague._meta.playoff_week_start === 'number') ? Number(seasonMatchupsForLeague._meta.playoff_week_start)
          : null;
        messages.push(`Using season_matchups JSON for season ${String(leagueSeason)}${seasonJsonPlayoffStart ? ' (playoff_week_start=' + seasonJsonPlayoffStart + ')' : ''}.`);
      }

      // weeks loop
      for (let week = 1; week <= MAX_WEEKS; week++) {
        let matchups = null;
        let isFromSeasonJSON = false;

        if (seasonMatchupsForLeague) {
          matchups = seasonMatchupsForLeague[String(week)] || [];
          isFromSeasonJSON = true;
        } else {
          try {
            matchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 }) || [];
          } catch (errWeek) {
            messages.push('Error fetching matchups for league ' + leagueId + ' week ' + week + ' — ' + (errWeek && errWeek.message ? errWeek.message : String(errWeek)));
            continue;
          }
        }

        if (!matchups || !matchups.length) continue;

        // compute effective playoffStart to use for this season:
        // priority: JSON per-season override -> leagueMeta.settings -> default 15
        const effectivePlayoffStart = seasonJsonPlayoffStart || (leagueMeta && leagueMeta.settings && Number(leagueMeta.settings.playoff_week_start)) || 15;
        const effectivePlayoffEnd = effectivePlayoffStart + 2;
        const isRegularWeek = (week >= 1 && week < effectivePlayoffStart);
        const isPlayoffWeek = (week >= effectivePlayoffStart && week <= effectivePlayoffEnd);
        if (!isRegularWeek && !isPlayoffWeek) continue;

        // --- NEW: detect current/in-progress week by inspecting next-week matchups for explicit zeros
        // Do NOT apply this detection when the current week is the final playoff week
        if (week !== effectivePlayoffEnd) {
          try {
            let nextMatchups = null;
            if (isFromSeasonJSON) {
              nextMatchups = seasonMatchupsForLeague[String(week + 1)] || [];
            } else {
              try {
                nextMatchups = await sleeper.getMatchupsForWeek(leagueId, week + 1, { ttl: 60 * 5 }) || [];
              } catch (e) {
                nextMatchups = null;
              }
            }
            if (nextMatchups && nextMatchups.length && nextWeekContainsExplicitZero(nextMatchups)) {
              // it's the in-progress (current) week — skip using this week
              continue;
            }
          } catch (e) {}
        }

        const statsByRoster = isPlayoffWeek ? statsByRosterPlayoff : statsByRosterRegular;
        const resultsByRoster = isPlayoffWeek ? resultsByRosterPlayoff : resultsByRosterRegular;
        const paByRoster = isPlayoffWeek ? paByRosterPlayoff : paByRosterRegular;

        // If JSON-provided week entries, process them with a straightforward conversion (and attach owner/team metadata)
        if (isFromSeasonJSON) {
          for (const m of matchups) {
            const a = m.teamA ?? null;
            const b = m.teamB ?? null;
            if (a && b) {
              const ridA = String(a.rosterId ?? a.roster_id ?? a.id ?? a.roster ?? a.ownerId ?? a.owner_id);
              const ridB = String(b.rosterId ?? b.roster_id ?? b.id ?? b.roster ?? b.ownerId ?? b.owner_id);
              const ptsA = safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? 0);
              const ptsB = safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? 0);

              // record margin candidate with avatar if present — prefer rosterMap avatars if we can map roster ids
              try {
                const margin = Math.abs(ptsA - ptsB);
                let avatarA = a.avatar ?? a.teamAvatar ?? a.team_avatar ?? null;
                let avatarB = b.avatar ?? b.teamAvatar ?? b.team_avatar ?? null;
                if (!avatarA && ridA && rosterMap && rosterMap[String(ridA)]) {
                  avatarA = rosterMap[String(ridA)].team_avatar || rosterMap[String(ridA)].owner_avatar || null;
                }
                if (!avatarB && ridB && rosterMap && rosterMap[String(ridB)]) {
                  avatarB = rosterMap[String(ridB)].team_avatar || rosterMap[String(ridB)].owner_avatar || null;
                }
                marginCandidates.push({
                  margin: margin,
                  season: leagueSeason || String(leagueId),
                  week: Number(week),
                  teamA: a.name ?? null,
                  ownerA: a.ownerName ?? null,
                  teamB: b.name ?? null,
                  ownerB: b.ownerName ?? null,
                  pfA: ptsA,
                  pfB: ptsB,
                  avatarA,
                  avatarB
                });
              } catch (e) {}

              // update H2H with JSON participants (prefer rosterMap when available)
              try {
                const aCanon = canonicalFromParticipant(a, rosterMap);
                const bCanon = canonicalFromParticipant(b, rosterMap);
                updateH2H(aCanon, bCanon, ptsA, ptsB, leagueSeason, week);
              } catch (e) {}

              paByRoster[ridA] = paByRoster[ridA] || 0;
              paByRoster[ridB] = paByRoster[ridB] || 0;
              resultsByRoster[ridA] = resultsByRoster[ridA] || [];
              resultsByRoster[ridB] = resultsByRoster[ridB] || [];
              statsByRoster[ridA] = statsByRoster[ridA] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
              statsByRoster[ridB] = statsByRoster[ridB] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };

              statsByRoster[ridA].pf += ptsA;
              statsByRoster[ridB].pf += ptsB;

              const oppAvgA = ptsB;
              const oppAvgB = ptsA;
              paByRoster[ridA] += oppAvgA;
              paByRoster[ridB] += oppAvgB;

              if (ptsA > oppAvgA + 1e-9) { resultsByRoster[ridA].push('W'); statsByRoster[ridA].wins += 1; }
              else if (ptsA < oppAvgA - 1e-9) { resultsByRoster[ridA].push('L'); statsByRoster[ridA].losses += 1; }
              else { resultsByRoster[ridA].push('T'); statsByRoster[ridA].ties += 1; }

              if (ptsB > oppAvgB + 1e-9) { resultsByRoster[ridB].push('W'); statsByRoster[ridB].wins += 1; }
              else if (ptsB < oppAvgB - 1e-9) { resultsByRoster[ridB].push('L'); statsByRoster[ridB].losses += 1; }
              else { resultsByRoster[ridB].push('T'); statsByRoster[ridB].ties += 1; }

              if (!statsByRoster[ridA].roster) statsByRoster[ridA].roster = { metadata: { team_name: a.name ?? null, owner_name: a.ownerName ?? null } };
              else {
                statsByRoster[ridA].roster.metadata.team_name = statsByRoster[ridA].roster.metadata.team_name || a.name || null;
                statsByRoster[ridA].roster.metadata.owner_name = statsByRoster[ridA].roster.metadata.owner_name || a.ownerName || null;
              }

              if (!statsByRoster[ridB].roster) statsByRoster[ridB].roster = { metadata: { team_name: b.name ?? null, owner_name: b.ownerName ?? null } };
              else {
                statsByRoster[ridB].roster.metadata.team_name = statsByRoster[ridB].roster.metadata.team_name || b.name || null;
                statsByRoster[ridB].roster.metadata.owner_name = statsByRoster[ridB].roster.metadata.owner_name || b.ownerName || null;
              }
            } else if (a) {
              const ridOnly = String(a.rosterId ?? a.roster_id ?? a.id ?? a.roster ?? a.ownerId ?? a.owner_id);
              const ptsOnly = safeNum(m.teamAScore ?? m.teamA?.score ?? m.points ?? 0);
              paByRoster[ridOnly] = paByRoster[ridOnly] || 0;
              resultsByRoster[ridOnly] = resultsByRoster[ridOnly] || [];
              statsByRoster[ridOnly] = statsByRoster[ridOnly] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
              statsByRoster[ridOnly].pf += ptsOnly;
              if (!statsByRoster[ridOnly].roster) statsByRoster[ridOnly].roster = { metadata: { team_name: a.name ?? null, owner_name: a.ownerName ?? null } };
              else {
                statsByRoster[ridOnly].roster.metadata.team_name = statsByRoster[ridOnly].roster.metadata.team_name || a.name || null;
                statsByRoster[ridOnly].roster.metadata.owner_name = statsByRoster[ridOnly].roster.metadata.owner_name || a.ownerName || null;
              }
            }
          }

          // ----- fallback API processing (unchanged from original logic) -----
        }

        if (!isFromSeasonJSON) {
          const byMatch = {};
          for (let mi = 0; mi < matchups.length; mi++) {
            const entry = matchups[mi];
            const mid = entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? null;
            const wk = entry.week ?? entry.w ?? week;
            const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
            if (!byMatch[key]) byMatch[key] = [];
            byMatch[key].push(entry);
          }

          const mids = Object.keys(byMatch);
          for (let mii = 0; mii < mids.length; mii++) {
            const mid = mids[mii];
            const entries = byMatch[mid];
            if (!entries || entries.length === 0) continue;

            if (entries.length === 1) {
              const only = entries[0];
              const ridOnly = only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId;
              const keyRid = String(ridOnly);
              paByRoster[keyRid] = paByRoster[keyRid] || 0;
              resultsByRoster[keyRid] = resultsByRoster[keyRid] || [];
              statsByRoster[keyRid] = statsByRoster[keyRid] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };

              let ptsOnly = null;
              try {
                // earlyData override handling (only for 2023 early weeks)
                if (earlyData) {
                  const meta = rosterMap[String(ridOnly)] || {};
                  const ownerLow = (meta.owner_name || meta.owner_username) ? String((meta.owner_name || meta.owner_username)).toLowerCase() : null;
                  const teamLow = meta.team_name ? String(meta.team_name).toLowerCase() : null;
                  if (ownerLow && earlyData['2023'] && earlyData['2023'][String(week)]) {
                    const arr = earlyData['2023'][String(week)];
                    const found = (arr || []).find(e => (e.teamA && e.teamA.ownerName && String(e.teamA.ownerName).toLowerCase() === ownerLow) || (e.teamB && e.teamB.ownerName && String(e.teamB.ownerName).toLowerCase() === ownerLow) || (e.teamA && e.teamA.name && String(e.teamA.name).toLowerCase() === teamLow) || (e.teamB && e.teamB.name && String(e.teamB.name).toLowerCase() === teamLow));
                    if (found) {
                      if (found.teamA && found.teamA.ownerName && String(found.teamA.ownerName).toLowerCase() === ownerLow) ptsOnly = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                      else if (found.teamB && found.teamB.ownerName && String(found.teamB.ownerName).toLowerCase() === ownerLow) ptsOnly = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                      else if (found.teamA && found.teamA.name && String(found.teamA.name).toLowerCase() === teamLow) ptsOnly = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                      else if (found.teamB && found.teamB.name && String(found.teamB.name).toLowerCase() === teamLow) ptsOnly = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                    }
                  }
                }
              } catch (e) { ptsOnly = null; }
              if (ptsOnly == null) ptsOnly = computeParticipantPoints(only);
              statsByRoster[keyRid].pf += ptsOnly;
              continue;
            }

            const participants = [];
            for (let e = 0; e < entries.length; e++) {
              const en = entries[e];
              const pid = en.roster_id ?? en.rosterId ?? en.owner_id ?? en.ownerId;
              const pidStr = String(pid);
              let ppts = null;
              if (earlyData) {
                try {
                  const meta = rosterMap[pidStr] || {};
                  const ownerLow = (meta.owner_name || meta.owner_username) ? String((meta.owner_name || meta.owner_username)).toLowerCase() : null;
                  const teamLow = meta.team_name ? String(meta.team_name).toLowerCase() : null;
                  if (ownerLow && earlyData['2023'] && earlyData['2023'][String(week)]) {
                    const arr = earlyData['2023'][String(week)];
                    const found = (arr || []).find(e2 => (e2.teamA && e2.teamA.ownerName && String(e2.teamA.ownerName).toLowerCase() === ownerLow) || (e2.teamB && e2.teamB.ownerName && String(e2.teamB.ownerName).toLowerCase() === ownerLow) || (e2.teamA && e2.teamA.name && String(e2.teamA.name).toLowerCase() === teamLow) || (e2.teamB && e2.teamB.name && String(e2.teamB.name).toLowerCase() === teamLow));
                    if (found) {
                      if (found.teamA && found.teamA.ownerName && String(found.teamA.ownerName).toLowerCase() === ownerLow) ppts = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                      else if (found.teamB && found.teamB.ownerName && String(found.teamB.ownerName).toLowerCase() === ownerLow) ppts = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                      else if (found.teamA && found.teamA.name && String(found.teamA.name).toLowerCase() === teamLow) ppts = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                      else if (found.teamB && found.teamB.name && String(found.teamB.name).toLowerCase() === teamLow) ppts = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                    }
                  }
                } catch (e) { ppts = null; }
              }
              if (ppts == null) ppts = computeParticipantPoints(en);
              participants.push({ rosterId: String(pid), points: ppts, rawEntry: en });
              paByRoster[String(pid)] = paByRoster[String(pid)] || 0;
              resultsByRoster[String(pid)] = resultsByRoster[String(pid)] || [];
              statsByRoster[String(pid)] = statsByRoster[String(pid)] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
              statsByRoster[String(pid)].pf += ppts;
            }

            // If this matchup has at least two participants, compute margin between first two (commonly 1v1)
            if (participants.length >= 2) {
              try {
                const p0 = participants[0];
                const p1 = participants[1];
                const margin = Math.abs((p0.points || 0) - (p1.points || 0));
                // attempt to resolve team names/owners/avatars from rosterMap if available
                const meta0 = rosterMap && rosterMap[p0.rosterId] ? rosterMap[p0.rosterId] : {};
                const meta1 = rosterMap && rosterMap[p1.rosterId] ? rosterMap[p1.rosterId] : {};
                marginCandidates.push({
                  margin: margin,
                  season: leagueSeason || String(leagueId),
                  week: Number(week),
                  teamA: meta0.team_name || null,
                  ownerA: meta0.owner_name || null,
                  teamB: meta1.team_name || null,
                  ownerB: meta1.owner_name || null,
                  pfA: p0.points || 0,
                  pfB: p1.points || 0,
                  avatarA: meta0.team_avatar || meta0.owner_avatar || null,
                  avatarB: meta1.team_avatar || meta1.owner_avatar || null
                });
              } catch (e) {}
            }

            // Update H2H for multi-entry matchups (pairwise between first two participants)
            if (participants.length >= 2) {
              try {
                const p0 = participants[0];
                const p1 = participants[1];
                const aCanon = canonicalFromParticipant({ rosterId: p0.rosterId, name: rosterMap[p0.rosterId]?.team_name, ownerName: rosterMap[p0.rosterId]?.owner_name, avatar: rosterMap[p0.rosterId]?.team_avatar || rosterMap[p0.rosterId]?.owner_avatar }, rosterMap);
                const bCanon = canonicalFromParticipant({ rosterId: p1.rosterId, name: rosterMap[p1.rosterId]?.team_name, ownerName: rosterMap[p1.rosterId]?.owner_name, avatar: rosterMap[p1.rosterId]?.team_avatar || rosterMap[p1.rosterId]?.owner_avatar }, rosterMap);
                updateH2H(aCanon, bCanon, p0.points, p1.points, leagueSeason, week);
              } catch (e) {}
            }

            for (let pi = 0; pi < participants.length; pi++) {
              const part = participants[pi];
              const opponents = [];
              for (let oi = 0; oi < participants.length; oi++) {
                if (oi === pi) continue;
                opponents.push(participants[oi]);
              }
              let oppAvg = 0;
              if (opponents.length) {
                for (let oa = 0; oa < opponents.length; oa++) oppAvg += opponents[oa].points;
                oppAvg = oppAvg / opponents.length;
              }
              paByRoster[part.rosterId] = paByRoster[part.rosterId] || 0;
              paByRoster[part.rosterId] += oppAvg;
              if (part.points > oppAvg + 1e-9) { resultsByRoster[part.rosterId].push('W'); statsByRoster[part.rosterId].wins += 1; }
              else if (part.points < oppAvg - 1e-9) { resultsByRoster[part.rosterId].push('L'); statsByRoster[part.rosterId].losses += 1; }
              else { resultsByRoster[part.rosterId].push('T'); statsByRoster[part.rosterId].ties += 1; }
            }
          }
        }
      } // end weeks loop

      const regularStandings = buildStandingsFromMaps(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular, rosterMap);
      const playoffStandings = buildStandingsFromMaps(statsByRosterPlayoff, resultsByRosterPlayoff, paByRosterPlayoff, rosterMap);

      // Hardcoded champion overrides
      try {
        if (leagueSeason != null) {
          const seasonKey = String(leagueSeason);
          if (HARDCODED_CHAMPIONS.hasOwnProperty(seasonKey)) {
            const championOwner = String(HARDCODED_CHAMPIONS[seasonKey]);
            const low = championOwner.toLowerCase();
            let rosterId = null;
            if (usernameToRoster[low]) rosterId = usernameToRoster[low];
            else if (ownerNameToRoster[low]) rosterId = ownerNameToRoster[low];
            if (rosterId) {
              const matchingRow = (playoffStandings || []).find(function(r) { return String(r.rosterId) === String(rosterId); });
              if (matchingRow) {
                matchingRow.champion = true;
                messages.push('Hardcoded champion applied for season ' + seasonKey + ': owner "' + championOwner + '" -> roster ' + rosterId);
              } else {
                messages.push('Hardcoded champion owner "' + championOwner + '" mapped to roster ' + rosterId + ' but roster not present in playoffStandings for season ' + seasonKey + '.');
              }
            } else {
              messages.push('Hardcoded champion owner "' + championOwner + '" could not be mapped to a roster for season ' + seasonKey + '.');
            }
          }
        }
      } catch (hcErr) {
        messages.push('Error applying hardcoded champion for league ' + leagueId + ' — ' + (hcErr && hcErr.message ? hcErr.message : String(hcErr)));
      }

      if ((regularStandings && regularStandings.length) || (playoffStandings && playoffStandings.length)) anyDataFound = true;

      seasonsResults.push({
        leagueId: String(leagueId),
        season: leagueSeason,
        leagueName: leagueName,
        regularStandings: regularStandings,
        playoffStandings: playoffStandings
      });
    } catch (err) {
      messages.push('Error processing league ' + leagueId + ' — ' + (err && err.message ? err.message : String(err)));
      seasonsResults.push({ leagueId: String(leagueId), error: (err && err.message ? err.message : String(err)) });
    }
  } // end league loop

  if (!anyDataFound && messages.length === 0) messages.push('No data found for requested seasons.');

  const finalError = !anyDataFound ? 'No roster/matchup data found for requested seasons. Details: ' + (messages.length ? messages.join(' | ') : 'no details') : null;

  // ---------- aggregation across seasons: prefer owner_name as merge key ----------
  function aggregateStandingsList(list, map) {
    if (!list || !Array.isArray(list)) return;
    for (const row of list) {
      if (!row) continue;

      // owner remapping logic (combine Bellooshio + cholybevv into JakePratt)
      let ownerLow = row.owner_name ? String(row.owner_name).toLowerCase() : null;
      if (ownerLow && OWNER_REPARENT[ownerLow]) {
        const mapped = OWNER_REPARENT[ownerLow]; // e.g. 'jakepratt'
        // overwrite ownerLow so the aggregated key is the mapped owner
        ownerLow = mapped;
        // ensure row.owner_name becomes the canonical display name if available
        row.owner_name = OWNER_DISPLAY[mapped] || mapped;
      }

      let key = null;
      if (ownerLow) key = 'owner:' + String(ownerLow).toLowerCase();
      else if (row.owner_id) key = 'ownerid:' + String(row.owner_id);
      else if (row.rosterId) key = 'roster:' + String(row.rosterId);
      else if (row.team_name) key = 'team:' + String(row.team_name).toLowerCase();
      if (!key) continue;

      if (!map[key]) {
        map[key] = {
          rosterId: row.rosterId ?? row.roster_id ?? null,
          team_name: row.team_name ?? null,
          owner_name: row.owner_name ?? null,
          avatar: row.avatar ?? null,
          wins: 0,
          losses: 0,
          ties: 0,
          pf: 0,
          pa: 0,
          maxWinStreak: 0,
          maxLoseStreak: 0,
          seasonsCount: 0,
          championCount: 0
        };
      }

      const dest = map[key];
      dest.wins += Number(row.wins || 0);
      dest.losses += Number(row.losses || 0);
      dest.ties += Number(row.ties || 0);
      dest.pf += Number(row.pf || 0);
      dest.pa += Number(row.pa || 0);
      if (row.team_name) dest.team_name = row.team_name;
      if (row.owner_name) dest.owner_name = row.owner_name;
      if (row.avatar) dest.avatar = row.avatar;
      dest.maxWinStreak = Math.max(dest.maxWinStreak || 0, Number(row.maxWinStreak || 0));
      dest.maxLoseStreak = Math.max(dest.maxLoseStreak || 0, Number(row.maxLoseStreak || 0));
      if (row.champion === true) dest.championCount = (dest.championCount || 0) + 1;
      dest.seasonsCount = (dest.seasonsCount || 0) + 1;
    }
  }

  const regMap = {};
  const poMap = {};
  for (const sr of seasonsResults) {
    if (!sr) continue;
    const regular = sr.regularStandings ?? sr.regular ?? sr.standings ?? [];
    aggregateStandingsList(regular, regMap);
    const playoffs = sr.playoffStandings ?? sr.playoffs ?? [];
    aggregateStandingsList(playoffs, poMap);
  }

  // If any remapping occurred, add a note to ownershipNotes and messages
  // Detect by checking whether any of the repartnered keys are present in regMap/poMap
  const repartneredOwners = Object.keys(OWNER_REPARENT).map(k => OWNER_REPARENT[k]);
  const uniqueRepartnered = [...new Set(repartneredOwners)];
  let repartnerApplied = false;
  for (const mapped of uniqueRepartnered) {
    const key = 'owner:' + String(mapped).toLowerCase();
    if (regMap[key] || poMap[key]) {
      repartnerApplied = true;
      break;
    }
  }
  if (repartnerApplied) {
    const note = 'Owners Bellooshio and cholybevv have been combined into JakePratt for aggregation.';
    ownershipNotes.push(note);
    messages.push(note);
  }

  const aggregatedRegular = Object.keys(regMap).map(k => {
    const r = regMap[k];
    r.pf = Math.round((r.pf || 0) * 100) / 100;
    r.pa = Math.round((r.pa || 0) * 100) / 100;
    r.champion = (r.championCount || 0) > 0;
    return r;
  });

  const aggregatedPlayoff = Object.keys(poMap).map(k => {
    const r = poMap[k];
    r.pf = Math.round((r.pf || 0) * 100) / 100;
    r.pa = Math.round((r.pa || 0) * 100) / 100;
    r.champion = (r.championCount || 0) > 0;
    return r;
  });

  aggregatedRegular.sort((a,b) => {
    const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
    if (wb !== wa) return wb - wa;
    return (b.pf || 0) - (a.pf || 0);
  });

  aggregatedPlayoff.sort((a,b) => {
    const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
    if (wb !== wa) return wb - wa;
    return (b.pf || 0) - (a.pf || 0);
  });

  // Build top-10 largest and smallest margin lists from marginCandidates
  const sanitized = (marginCandidates || []).filter(m => m && typeof m.margin === 'number' && !isNaN(m.margin));
  // largest
  const topLargestMargins = sanitized.slice().sort((a,b) => (b.margin || 0) - (a.margin || 0)).slice(0, 10).map((x, idx) => ({
    rank: idx + 1,
    season: x.season,
    week: x.week,
    margin: Math.round((x.margin || 0) * 100) / 100,
    teamA: x.teamA || null,
    ownerA: x.ownerA || null,
    teamB: x.teamB || null,
    ownerB: x.ownerB || null,
    pfA: Math.round((x.pfA || 0) * 100) / 100,
    pfB: Math.round((x.pfB || 0) * 100) / 100,
    avatarA: x.avatarA || null,
    avatarB: x.avatarB || null
  }));

  // smallest > 0
  const filteredSmall = sanitized.filter(m => (m.margin || 0) > 0);
  const topSmallestMargins = filteredSmall.slice().sort((a,b) => (a.margin || 0) - (b.margin || 0)).slice(0, 10).map((x, idx) => ({
    rank: idx + 1,
    season: x.season,
    week: x.week,
    margin: Math.round((x.margin || 0) * 100) / 100,
    teamA: x.teamA || null,
    ownerA: x.ownerA || null,
    teamB: x.teamB || null,
    ownerB: x.ownerB || null,
    pfA: Math.round((x.pfA || 0) * 100) / 100,
    pfB: Math.round((x.pfB || 0) * 100) / 100,
    avatarA: x.avatarA || null,
    avatarB: x.avatarB || null
  }));

  // attach the h2hRecords map directly (server returns aggregated H2H)
  // ensure pf & wins fields are normalized numbers
  for (const k in h2hRecords) {
    if (!Object.prototype.hasOwnProperty.call(h2hRecords, k)) continue;
    h2hRecords[k].wins1 = Number(h2hRecords[k].wins1 || 0);
    h2hRecords[k].wins2 = Number(h2hRecords[k].wins2 || 0);
    h2hRecords[k].pf1 = Math.round((h2hRecords[k].pf1 || 0) * 100) / 100;
    h2hRecords[k].pf2 = Math.round((h2hRecords[k].pf2 || 0) * 100) / 100;
    h2hRecords[k].ties = Number(h2hRecords[k].ties || 0);
    h2hRecords[k].meetings = Number(h2hRecords[k].meetings || 0);
  }

  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    seasonsResults,
    aggregatedRegular,
    aggregatedPlayoff,
    jsonLinks,
    ownershipNotes,
    error: finalError,
    messages,
    prevChain,
    // new fields
    topLargestMargins,
    topSmallestMargins,
    h2h: h2hRecords
  };
}
