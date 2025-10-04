// src/routes/honor-hall/+page.server.js
// Honor Hall loader: fetch playoff matchups and compute placements by scrubbing regular-season matchups
// Includes bracket simulation and semicandidates safeguard.

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

// compute streaks (copied from standings loader style)
function computeStreaks(resultsArray) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  if (!resultsArray || !Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
  for (let i = 0; i < resultsArray.length; i++) {
    const r = resultsArray[i];
    if (r === 'W') {
      curW += 1;
      curL = 0;
      if (curW > maxW) maxW = curW;
    } else if (r === 'L') {
      curL += 1;
      curW = 0;
      if (curL > maxL) maxL = curL;
    } else {
      curW = 0;
      curL = 0;
    }
  }
  return { maxW, maxL };
}

export async function load(event) {
  // edge cache header
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const incomingSeasonParam = url.searchParams.get('season') || null;

  const messages = []; // general messages
  const debugLog = []; // trace of bracket decisions (returned separately too)
  const prevChain = [];

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
        season: mainLeague.season ?? null,
        name: mainLeague.name ?? null
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
            season: prevLeague.season ?? null,
            name: prevLeague.name ?? null
          });
          prevChain.push(String(prevLeague.league_id || currPrev));
          currPrev = prevLeague.previous_league_id ? String(prevLeague.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err && err.message ? err.message : String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error while building seasons chain: ' + (err && err.message ? err.message : String(err)));
  }

  // dedupe by league id
  const byId = {};
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);

  // sort by season (old -> new)
  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  // selected season param (default to latest)
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = String(BASE_LEAGUE_ID);
    }
  }

  // determine leagueIdsToProcess (we only need the selected league for honor-hall)
  let selectedLeagueId = null;
  // try to match season or league_id in seasons array
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selectedSeasonParam || BASE_LEAGUE_ID);

  // Fetch league meta to determine playoff weeks
  let leagueMeta = null;
  try {
    leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 });
  } catch (e) {
    leagueMeta = null;
    messages.push('Failed fetching league meta for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }

  // determine playoff start/end using same fields as standings loader (fallback to 15)
  let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : null;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
    // fallback: try some known fields then set default
    playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      // fallback default (match standings' fallback behavior)
      playoffStart = 15;
      messages.push('Playoff start not found in metadata — defaulting to week ' + playoffStart);
    }
  }
  const playoffEnd = playoffStart + 2;

  // fetch roster map
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
  } catch (e) {
    rosterMap = {};
    messages.push('Failed fetching rosters for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }

  // --- compute regular-season standings by scrubbing matchups 1..(playoffStart-1) ---
  const statsByRosterRegular = {};
  const resultsByRosterRegular = {};
  const paByRosterRegular = {};

  // seed from rosterMap
  for (const rk in rosterMap) {
    if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
    statsByRosterRegular[String(rk)] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk].roster_raw ?? null };
    resultsByRosterRegular[String(rk)] = [];
    paByRosterRegular[String(rk)] = 0;
  }

  // regular weeks: 1 .. (playoffStart - 1)
  const regStart = 1;
  const regEnd = Math.max(1, playoffStart - 1);

  for (let week = regStart; week <= regEnd; week++) {
    let matchups = null;
    try {
      matchups = await sleeper.getMatchupsForWeek(selectedLeagueId, week, { ttl: 60 * 5 });
    } catch (errWeek) {
      messages.push('Error fetching matchups for league ' + selectedLeagueId + ' week ' + week + ' — ' + (errWeek && errWeek.message ? errWeek.message : String(errWeek)));
      continue;
    }
    if (!matchups || !matchups.length) continue;

    // group by matchup id | week
    const byMatch = {};
    for (let mi = 0; mi < matchups.length; mi++) {
      const e = matchups[mi];
      const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
      const wk = e.week ?? e.w ?? week;
      const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(e);
    }

    const keys = Object.keys(byMatch);
    for (let k = 0; k < keys.length; k++) {
      const entries = byMatch[keys[k]];
      if (!entries || entries.length === 0) continue;

      if (entries.length === 1) {
        const only = entries[0];
        const ridOnly = String(only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId ?? 'unknown');
        const ptsOnly = safeNum(only.points ?? only.points_for ?? only.pts ?? 0);
        if (!statsByRosterRegular[ridOnly]) statsByRosterRegular[ridOnly] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
        if (!resultsByRosterRegular[ridOnly]) resultsByRosterRegular[ridOnly] = [];
        if (!paByRosterRegular[ridOnly]) paByRosterRegular[ridOnly] = 0;
        statsByRosterRegular[ridOnly].pf += ptsOnly;
        // single-entry matches don't produce W/L in this schema
        continue;
      }

      // multi-entry: compute each participant's points and compare against opponents' average
      const participants = [];
      for (let i = 0; i < entries.length; i++) {
        const ent = entries[i];
        const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? ('r' + i));
        const ppts = safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0);
        participants.push({ rosterId: pid, points: ppts });
        if (!statsByRosterRegular[pid]) statsByRosterRegular[pid] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
        if (!resultsByRosterRegular[pid]) resultsByRosterRegular[pid] = [];
        if (!paByRosterRegular[pid]) paByRosterRegular[pid] = 0;
        statsByRosterRegular[pid].pf += ppts;
      }

      for (let i = 0; i < participants.length; i++) {
        const part = participants[i];
        const opponents = participants.filter((_, idx) => idx !== i);
        let oppAvg = 0;
        if (opponents.length) {
          oppAvg = opponents.reduce((acc, o) => acc + o.points, 0) / opponents.length;
        }
        paByRosterRegular[part.rosterId] = (paByRosterRegular[part.rosterId] || 0) + oppAvg;
        // determine result
        if (part.points > oppAvg + 1e-9) {
          resultsByRosterRegular[part.rosterId].push('W');
          statsByRosterRegular[part.rosterId].wins += 1;
        } else if (part.points < oppAvg - 1e-9) {
          resultsByRosterRegular[part.rosterId].push('L');
          statsByRosterRegular[part.rosterId].losses += 1;
        } else {
          resultsByRosterRegular[part.rosterId].push('T');
          statsByRosterRegular[part.rosterId].ties += 1;
        }
      }
    }
  } // end regular weeks loop

  // Build sorted regular standings (same scheme as standings route)
  function buildStandingsFromTrackers(statsByRoster, resultsByRoster, paByRoster) {
    const keys = Object.keys(resultsByRoster).length ? Object.keys(resultsByRoster) : (rosterMap ? Object.keys(rosterMap) : []);
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      const rid = keys[i];
      if (!Object.prototype.hasOwnProperty.call(statsByRoster, rid)) {
        statsByRoster[rid] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: (rosterMap && rosterMap[rid] ? rosterMap[rid].roster_raw : null) };
      }
      const s = statsByRoster[rid];
      const wins = s.wins || 0;
      const losses = s.losses || 0;
      const ties = s.ties || 0;
      const pfVal = Math.round((s.pf || 0) * 100) / 100;
      const paVal = Math.round((paByRoster[rid] || s.pa || 0) * 100) / 100;
      const meta = rosterMap && rosterMap[rid] ? rosterMap[rid] : {};
      const team_name = meta.team_name ? meta.team_name : ((s.roster && s.roster.metadata && s.roster.metadata.team_name) ? s.roster.metadata.team_name : ('Roster ' + rid));
      const owner_name = meta.owner_name || meta.owner_username || null;
      const avatar = meta.team_avatar || meta.owner_avatar || null;
      const resArr = resultsByRoster && resultsByRoster[rid] ? resultsByRoster[rid] : [];
      const streaks = computeStreaks(resArr);
      out.push({
        rosterId: rid,
        team_name,
        owner_name,
        avatar,
        wins,
        losses,
        ties,
        pf: pfVal,
        pa: paVal,
        maxWinStreak: streaks.maxW,
        maxLoseStreak: streaks.maxL
      });
    }
    // sort by wins desc, then pf desc (same as standings)
    out.sort((a,b) => {
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      return (b.pf || 0) - (a.pf || 0);
    });
    return out;
  }

  const regularStandings = buildStandingsFromTrackers(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular);

  // Build placement map rosterId -> placement (1-based)
  const placementMap = {};
  for (let i = 0; i < regularStandings.length; i++) {
    placementMap[String(regularStandings[i].rosterId)] = i + 1;
  }

  // --- fetch playoff matchups (playoffStart .. playoffEnd) and build matchupsRows ---
  const rawMatchups = [];
  for (let wk = playoffStart; wk <= playoffEnd; wk++) {
    try {
      const wkMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, wk, { ttl: 60 * 5 });
      if (Array.isArray(wkMatchups) && wkMatchups.length) {
        for (const m of wkMatchups) {
          if (m && (m.week == null && m.w == null)) m.week = wk;
          rawMatchups.push(m);
        }
      }
    } catch (we) {
      messages.push('Failed to fetch matchups for week ' + wk + ': ' + (we?.message ?? String(we)));
    }
  }

  // group by matchup id + week
  const byMatch = {};
  for (let i = 0; i < rawMatchups.length; i++) {
    const e = rawMatchups[i];
    const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
    const wk = e.week ?? e.w ?? null;
    const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + i));
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  const matchupsRows = [];
  const keys = Object.keys(byMatch);
  for (let ki = 0; ki < keys.length; ki++) {
    const entries = byMatch[keys[ki]];
    if (!entries || entries.length === 0) continue;

    // single participant -> bye
    if (entries.length === 1) {
      const a = entries[0];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const aMeta = rosterMap[aId] || {};
      const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const aPlacement = placementMap[aId] ?? null;

      matchupsRows.push({
        matchup_id: keys[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement },
        teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, placement: null },
        participantsCount: 1
      });
      continue;
    }

    // two participants -> normal row
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
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? null);
      const aPlacement = placementMap[aId] ?? null;
      const bPlacement = placementMap[bId] ?? null;

      matchupsRows.push({
        matchup_id: keys[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement },
        teamB: { rosterId: bId, name: bName, avatar: bAvatar, points: bPts, placement: bPlacement },
        participantsCount: 2
      });
      continue;
    }

    // multi-participant: aggregate
    const participants = entries.map(ent => {
      const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
      const meta = rosterMap[pid] || {};
      return {
        rosterId: pid,
        name: meta.team_name || meta.owner_name || ('Roster ' + pid),
        avatar: meta.team_avatar || meta.owner_avatar || null,
        points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0),
        placement: placementMap[pid] ?? null
      };
    });
    const combinedLabel = participants.map(p => p.name).join(' / ');
    matchupsRows.push({
      matchup_id: keys[ki],
      season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
      week: entries[0].week ?? entries[0].w ?? null,
      combinedParticipants: participants,
      combinedLabel,
      participantsCount: participants.length
    });
  }

  // sort rows by week desc then placement ascending (so finals / higher rounds first)
  matchupsRows.sort((x,y) => {
    const wx = Number(x.week ?? 0), wy = Number(y.week ?? 0);
    if (wy !== wx) return wy - wx;
    // prefer matches involving higher-placed teams earlier
    const ax = x.teamA?.placement ?? (x.combinedParticipants ? (x.combinedParticipants[0]?.placement ?? 999) : 999);
    const by = y.teamA?.placement ?? (y.combinedParticipants ? (y.combinedParticipants[0]?.placement ?? 999) : 999);
    return (ax - by);
  });

  //
  // --- BRACKET SIMULATION SECTION ---
  // This block uses matchupsRows (playoff matches) and placementMap + regularStandings pf
  // to simulate each bracket match and compute finalStandings (unique rank 1..14).
  //

  // Helper utilities for reading match rows + winners/losers
  function getParticipantIdFromTeam(team) {
    if (!team) return null;
    return String(team.rosterId ?? team.roster_id ?? team.owner_id ?? team.ownerId ?? '');
  }
  function getPtsFromTeam(team) {
    if (!team) return 0;
    return safeNum(team.points ?? team.points_for ?? team.pts ?? 0);
  }

  // find a recorded playoff matchup between two rosterIds (either order)
  function findMatchRow(aRid, bRid) {
    if (!aRid || !bRid) return null;
    for (const r of matchupsRows) {
      if (r.participantsCount !== 2) continue;
      const a = getParticipantIdFromTeam(r.teamA);
      const b = getParticipantIdFromTeam(r.teamB);
      if ((String(a) === String(aRid) && String(b) === String(bRid)) || (String(a) === String(bRid) && String(b) === String(aRid))) {
        return r;
      }
    }
    return null;
  }

  // Determine winner given two roster ids:
  // 1) prefer recorded playoff match result if found
  // 2) else prefer higher regular-season PF
  // 3) else prefer better seed (lower placement number)
  function decideWinner(aRid, bRid) {
    if (!aRid && !bRid) return null;
    if (aRid && !bRid) return aRid;
    if (!aRid && bRid) return bRid;

    // try to find a direct playoff matchup
    const row = findMatchRow(aRid, bRid);
    if (row) {
      const a = getParticipantIdFromTeam(row.teamA);
      const b = getParticipantIdFromTeam(row.teamB);
      const aPts = getPtsFromTeam(row.teamA);
      const bPts = getPtsFromTeam(row.teamB);
      // tie leaning to PF (but here PF is already points)
      if (Math.abs(aPts - bPts) > 1e-9) return (aPts > bPts ? a : b);
      // exact tie: fallback to placement if present on the row objects
      const aPlace = row.teamA && row.teamA.placement ? row.teamA.placement : (placementMap[a] || 999);
      const bPlace = row.teamB && row.teamB.placement ? row.teamB.placement : (placementMap[b] || 999);
      if (aPlace !== bPlace) return (aPlace < bPlace ? a : b);
      // last resort: choose aRid
      return a;
    }

    // no recorded match: fallback to regular-season PF
    const aPF = (statsByRosterRegular[aRid] && statsByRosterRegular[aRid].pf) ? statsByRosterRegular[aRid].pf : 0;
    const bPF = (statsByRosterRegular[bRid] && statsByRosterRegular[bRid].pf) ? statsByRosterRegular[bRid].pf : 0;
    if (Math.abs(aPF - bPF) > 1e-9) return (aPF > bPF ? aRid : bRid);

    // fallback to seed/placement (lower is better)
    const aPlace = placementMap[aRid] || 999;
    const bPlace = placementMap[bRid] || 999;
    if (aPlace !== bPlace) return (aPlace < bPlace ? aRid : bRid);

    // final fallback: pick aRid
    return aRid;
  }

  // Build inverse map: seed -> rosterId
  const rosterBySeed = {};
  for (const rid in placementMap) {
    const seed = placementMap[rid];
    rosterBySeed[seed] = rid;
  }

  // semicandidates safety: declare up front so any earlier reference doesn't blow up
  // (this is the "perk" you asked for)
  let semicandidates = [];

  // Helper to push debug lines
  function dlog(line) {
    debugLog.push(line);
    // also include in messages for page display (optional)
    // messages.push(line);
  }

  // Start simulation trace
  dlog('Loaded rosters (' + Object.keys(rosterMap).length + ')');

  // SPECIAL CASE: 2022 has a different winner/loser bracket setup (as you've specified)
  const seasonKey = leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null;
  const is2022Exception = (seasonKey === '2022');

  // We'll compute bracket outcomes and final placements using either the standard
  // flow or the 2022 exception flow.

  // Utility to record a matchup evaluation for debug
  function evalMatchDebug(label, aSeed, bSeed, winnerRid, reason) {
    const aRid = rosterBySeed[aSeed] ?? null;
    const bRid = rosterBySeed[bSeed] ?? null;
    const aName = aRid ? (rosterMap[aRid]?.team_name ?? rosterMap[aRid]?.owner_name ?? ('Roster ' + aRid)) : ('#' + aSeed);
    const bName = bRid ? (rosterMap[bRid]?.team_name ?? rosterMap[bRid]?.owner_name ?? ('Roster ' + bRid)) : ('#' + bSeed);
    const winnerLabel = winnerRid ? (rosterMap[winnerRid]?.team_name ?? rosterMap[winnerRid]?.owner_name ?? ('Roster ' + winnerRid)) : 'unknown';
    dlog(`${label} ${aSeed}v${bSeed} -> ${winnerLabel} (${reason})`);
  }

  // small helper to safe-get roster owner name
  function ownerNameFor(rid) {
    if (!rid) return null;
    const meta = rosterMap[rid] || {};
    return meta.owner_name ?? meta.owner_username ?? meta.team_name ?? ('Roster ' + rid);
  }

  // We will build a map finalPlace -> rosterId (1-based ranks)
  const placeToRoster = {}; // e.g. placeToRoster[1] = rosterId that finished 1st

  if (is2022Exception) {
    // --- 2022 exception flow as provided by user ---
    // According to the user's specific sequence, produce debug lines and use decideWinner
    // Example mapping based on your requested debug sequence:

    // First round (special ordering: top 6 in winners bracket)
    // The user-provided sequence for 2022: W1 4v5 -> 4, W1 3v6 -> 6
    // Then semis: Semi 1v4 -> 1, Semi 2v6 -> 2, Final 1v2 -> 1, 3rd 4v6 -> 4
    // 5th 5v3 -> 3
    // ... lower bracket logic as user listed

    // We'll interpret seeds and pick winners using decideWinner when possible.

    // Round 1 (winners bracket): matches as per the 2022 exception
    // Pairing examples (must match user's rule): W1: 4v5 and 3v6
    const w1_pairs_2022 = [
      [4,5],
      [3,6]
    ];
    for (const [aSeed, bSeed] of w1_pairs_2022) {
      const aRid = rosterBySeed[aSeed] ?? null;
      const bRid = rosterBySeed[bSeed] ?? null;
      const winner = decideWinner(aRid, bRid);
      evalMatchDebug('W1', aSeed, bSeed, winner, 'matchup');
      // store winners into semicandidates (these winners advance to semis)
      if (winner) semicandidates.push(winner);
    }

    // Semifinals mapping (user specified): Semi 1v4 and Semi 2v6
    // Seeds 1 and 2 presumably had byes into semis for 2022
    const semi_pairs_2022 = [
      [1, 4],
      [2, 6]
    ];
    const semiWinners = [];
    const semiLosers = [];
    for (const [aSeed, bSeed] of semi_pairs_2022) {
      const aRid = rosterBySeed[aSeed] ?? null;
      const bRid = rosterBySeed[bSeed] ?? null;
      const winner = decideWinner(aRid, bRid);
      evalMatchDebug('Semi', aSeed, bSeed, winner, 'matchup');
      if (winner) semiWinners.push(winner);
      const loser = (String(winner) === String(aRid)) ? bRid : aRid;
      if (loser) semiLosers.push(loser);
    }

    // Final: winner of the two semis
    const finalWinner = decideWinner(semiWinners[0], semiWinners[1]);
    evalMatchDebug('Final', 'semiW1', 'semiW2', finalWinner, 'matchup');
    const finalRunner = (String(finalWinner) === String(semiWinners[0])) ? semiWinners[1] : semiWinners[0];

    // 3rd place: semifinal losers
    const thirdWinner = decideWinner(semiLosers[0], semiLosers[1]);
    evalMatchDebug('3rd', 'semiloser1', 'semiloser2', thirdWinner, 'matchup');

    // 5th place: user-specified 5th 5v3 -> 3 (matchup)
    const a5 = rosterBySeed[5] ?? null;
    const b5 = rosterBySeed[3] ?? null;
    const winner5 = decideWinner(a5, b5);
    evalMatchDebug('5th', 5, 3, winner5, 'matchup');

    // Lower-race + consolation logic for 2022: follow the user's sequence.
    // LRace pairs: 9v12, 10v11, 7v14, 8v13
    const lPairs = [[9,12],[10,11],[7,14],[8,13]];
    const lWinners = [];
    const lLosers = [];
    for (const [aSeed,bSeed] of lPairs) {
      const aRid = rosterBySeed[aSeed] ?? null;
      const bRid = rosterBySeed[bSeed] ?? null;
      const winner = decideWinner(aRid,bRid);
      evalMatchDebug('LRace', aSeed, bSeed, winner, 'matchup');
      if (winner) lWinners.push(winner);
      const loser = (String(winner) === String(aRid)) ? bRid : aRid;
      if (loser) lLosers.push(loser);
    }

    // Consolation LRace1: 7v10 -> (user said) 10 (matchup)
    const consA = rosterBySeed[7] ?? null;
    const consB = rosterBySeed[10] ?? null;
    const consWinner1 = decideWinner(consA, consB);
    evalMatchDebug('Consolation LRace1', 7, 10, consWinner1, 'matchup');

    const consC = rosterBySeed[8] ?? null;
    const consD = rosterBySeed[9] ?? null;
    const consWinner2 = decideWinner(consC, consD);
    evalMatchDebug('Consolation LRace1', 8, 9, consWinner2, 'matchup');

    // LRaceSemi fallbacks — if no matchup recorded we log fallback-no-match and use PF/seed
    // (simulated above by decideWinner which used PF/seed fallbacks)

    // After evaluating matches place final assignments
    // Use these winners to assign final places as user specified.
    // Place 1: finalWinner
    if (finalWinner) placeToRoster[1] = finalWinner;
    // Place 2: finalRunner
    if (finalRunner) placeToRoster[2] = finalRunner;
    // Place 3: thirdWinner
    if (thirdWinner) placeToRoster[3] = thirdWinner;
    // Place 4: the other semifinal loser not in place 3
    const semLosAll = [...semiLosers];
    const place4Candidate = semLosAll.find(r => String(r) !== String(thirdWinner));
    if (place4Candidate) placeToRoster[4] = place4Candidate;
    // Place 5: winner5
    if (winner5) placeToRoster[5] = winner5;

    // Use remaining seeds / losers to populate the rest of places (6..14)
    // We'll make a deterministic assignment using:
    // - known losers/winners we computed in arrays
    // - then remaining roster ids sorted by placement (seed) as final fallback

    // Collect all roster ids
    const allRosterIds = Object.keys(rosterMap).map(k => String(k));
    // remove those already assigned
    const assigned = new Set(Object.values(placeToRoster).filter(Boolean).map(String));

    // Helper to assign next available place using prefer array of candidates
    function assignIfFree(place, candidateRid) {
      if (!candidateRid) return;
      if (!placeToRoster[place]) {
        placeToRoster[place] = candidateRid;
        assigned.add(String(candidateRid));
      }
    }

    // try to fill 6..14 with sensible choices:
    // use lWinners/lLosers arrays, remaining semi losers/winners, then seeds by placement
    // candidate lists in order of priority:
    const candidates = [
      ...lWinners,
      ...lLosers,
      ...semiWinners || [],
      ...semiLosers || [],
      ...Object.keys(rosterBySeed).map(s => rosterBySeed[s]).filter(Boolean)
    ];

    let nextPlace = 6;
    for (const c of candidates) {
      if (nextPlace > 14) break;
      if (!c) continue;
      if (assigned.has(String(c))) continue;
      placeToRoster[nextPlace] = c;
      assigned.add(String(c));
      nextPlace++;
    }

    // if still places left, fill by placement order (1..14)
    for (let s = 1; s <= 14 && nextPlace <= 14; s++) {
      const r = rosterBySeed[s] ?? null;
      if (!r) continue;
      if (assigned.has(String(r))) continue;
      placeToRoster[nextPlace] = r;
      assigned.add(String(r));
      nextPlace++;
    }

    // Done exception flow

  } else {
    // --- Standard flow (not 2022) ---
    // Standard winners bracket: top 8 seeds
    // First round pairings: 1v8, 2v7, 3v6, 4v5
    const seededWinners = [];
    const seededLosers = [];

    // W1 pairs
    const w1Pairs = [[1,8],[2,7],[3,6],[4,5]];
    for (const [aSeed,bSeed] of w1Pairs) {
      const aRid = rosterBySeed[aSeed] ?? null;
      const bRid = rosterBySeed[bSeed] ?? null;
      const winner = decideWinner(aRid, bRid);
      evalMatchDebug('W1', aSeed, bSeed, winner, 'matchup');
      if (winner) seededWinners.push(winner);
      const loser = (String(winner) === String(aRid)) ? bRid : aRid;
      if (loser) seededLosers.push(loser);
    }

    // semicandidates (winners of W1) declared/defined
    semicandidates = seededWinners.slice();
    dlog('semicandidates: ' + semicandidates.map(r => rosterMap[r]?.team_name ?? rosterMap[r]?.owner_name ?? r).join(', '));

    // Semifinal pair-ups: highest seed vs lowest seed among semifinalists
    // To determine seed value for each semifinalist, read placementMap
    function seedOf(rid) { return placementMap[rid] || 999; }
    semicandidates.sort((a,b) => seedOf(a) - seedOf(b)); // ascending seed (1 best)
    // Now seeds: prev order yields low->high; highest seed plays lowest seed = reverse pairing
    const semiPairs = [
      [semicandidates[0], semicandidates[3]],
      [semicandidates[1], semicandidates[2]]
    ];
    const semiWinners = [];
    const semiLosers = [];
    for (const [aRid,bRid] of semiPairs) {
      const winner = decideWinner(aRid,bRid);
      const aSeed = placementMap[aRid] ?? 'n';
      const bSeed = placementMap[bRid] ?? 'n';
      evalMatchDebug('Semi', aSeed, bSeed, winner, 'matchup');
      if (winner) semiWinners.push(winner);
      const loser = (String(winner) === String(aRid)) ? bRid : aRid;
      if (loser) semiLosers.push(loser);
    }

    // Final
    const finalWinner = decideWinner(semiWinners[0], semiWinners[1]);
    const finalRunner = (String(finalWinner) === String(semiWinners[0])) ? semiWinners[1] : semiWinners[0];
    evalMatchDebug('Final', placementMap[semiWinners[0]] ?? 'n', placementMap[semiWinners[1]] ?? 'n', finalWinner, 'matchup');

    // 3rd place (losers of semis play)
    const thirdWinner = decideWinner(semiLosers[0], semiLosers[1]);
    evalMatchDebug('3rd', placementMap[semiLosers[0]] ?? 'n', placementMap[semiLosers[1]] ?? 'n', thirdWinner, 'matchup');

    // Consolation among first-round losers for 5th..8th:
    // seededLosers currently holds the four losers from W1 (order corresponds to W1 pairs order)
    // Per your rules: losers of first round play highest seed vs lowest seed,
    // winners of those play for 5th, losers play for 7th.
    // Determine the two "loser-round" matchups:
    const losersSortedBySeed = seededLosers.slice().sort((x,y) => (placementMap[x]||999) - (placementMap[y]||999));
    // highest seed (lowest placement number) vs lowest seed (highest placement number)
    const lPairA = [losersSortedBySeed[0], losersSortedBySeed[3]];
    const lPairB = [losersSortedBySeed[1], losersSortedBySeed[2]];
    const lWinners = [];
    const lLosers = [];
    for (const [aRid,bRid] of [lPairA, lPairB]) {
      const aSeed = placementMap[aRid] ?? 'n';
      const bSeed = placementMap[bRid] ?? 'n';
      const winner = decideWinner(aRid,bRid);
      evalMatchDebug('Consolation R1', aSeed, bSeed, winner, 'matchup');
      if (winner) lWinners.push(winner);
      const loser = (String(winner) === String(aRid)) ? bRid : aRid;
      if (loser) lLosers.push(loser);
    }

    // 5th place: winners of above loser-round
    const fifthWinner = decideWinner(lWinners[0], lWinners[1]);
    evalMatchDebug('5th', placementMap[lWinners[0]] ?? 'n', placementMap[lWinners[1]] ?? 'n', fifthWinner, 'matchup');
    // 7th place: losers of above loser-round
    const seventhWinner = decideWinner(lLosers[0], lLosers[1]);
    evalMatchDebug('7th', placementMap[lLosers[0]] ?? 'n', placementMap[lLosers[1]] ?? 'n', seventhWinner, 'matchup');

    // Lower bracket (seeds 9..14)
    const lowerSeeds = [9,10,11,12,13,14];
    const lowerRosterIds = lowerSeeds.map(s => rosterBySeed[s] ?? null);
    // The "first race" in lower bracket as user asked: 9v12 and 10v11 and 13/14 bye or other rules.
    // We'll pair 9v12 and 10v11, leaving 13 & 14 maybe with byes depending on presence
    const lrPairA = [rosterBySeed[9] ?? null, rosterBySeed[12] ?? null];
    const lrPairB = [rosterBySeed[10] ?? null, rosterBySeed[11] ?? null];
    // 13 & 14 may have bye into later round — we'll handle gracefully
    const lrWinnerA = decideWinner(lrPairA[0], lrPairA[1]); evalMatchDebug('LRace', 9, 12, lrWinnerA, 'matchup');
    const lrWinnerB = decideWinner(lrPairB[0], lrPairB[1]); evalMatchDebug('LRace', 10, 11, lrWinnerB, 'matchup');

    // LRace semifinal: winners vs 13/14 (if present) — pairing rules may vary; try to follow user earlier guidance:
    // We'll attempt pairing winnerA vs seed 14 and winnerB vs seed 13 (if present), else fallback.
    const seed13Rid = rosterBySeed[13] ?? null;
    const seed14Rid = rosterBySeed[14] ?? null;
    const lrSemiA = decideWinner(lrWinnerA, seed14Rid); evalMatchDebug('LRaceSemi', 'winner9v12', 14, lrSemiA, 'matchup/fallback');
    const lrSemiB = decideWinner(lrWinnerB, seed13Rid); evalMatchDebug('LRaceSemi', 'winner10v11', 13, lrSemiB, 'matchup/fallback');

    // 9th place final: winners of LRace semi (or winners from previous)
    const ninthWinner = decideWinner(lrWinnerA, lrWinnerB); evalMatchDebug('9th', 'lrA', 'lrB', ninthWinner, 'matchup');

    // 11th place: winner of remaining LRaceSemis (or fallback logic)
    const eleventhWinner = decideWinner(lrSemiA, lrSemiB); evalMatchDebug('11th', 'lrSemiA', 'lrSemiB', eleventhWinner, 'matchup/fallback');

    // Now assign finalPlaces deterministically using all the winners we computed
    if (finalWinner) placeToRoster[1] = finalWinner;
    if (finalRunner) placeToRoster[2] = finalRunner;
    if (thirdWinner) placeToRoster[3] = thirdWinner;
    // place 4: the remaining semifinal loser
    const remainingSemiLoser = semiLosers.find(r => String(r) !== String(thirdWinner));
    if (remainingSemiLoser) placeToRoster[4] = remainingSemiLoser;
    if (fifthWinner) placeToRoster[5] = fifthWinner;
    if (seventhWinner) placeToRoster[7] = seventhWinner;
    // 6th: the other consolation loser/winner that isn't in 5th/7th
    // we will fill gaps below using priorities

    // collect computed winners to prefer when assigning remaining ranks
    const computedCandidates = [
      finalWinner, finalRunner, thirdWinner, remainingSemiLoser,
      fifthWinner, seventhWinner,
      lrWinnerA, lrWinnerB, lrSemiA, lrSemiB, ninthWinner, eleventhWinner
    ].filter(Boolean);

    // mark assigned set
    const assigned = new Set(Object.values(placeToRoster).filter(Boolean).map(String));

    // function to safely assign next place(s) from candidate arrays
    function fillRemainingPlacesFromCandidates(startPlace, candidatesArr) {
      let p = startPlace;
      for (const c of candidatesArr) {
        if (p > 14) break;
        if (!c) continue;
        if (assigned.has(String(c))) continue;
        placeToRoster[p] = c;
        assigned.add(String(c));
        p++;
      }
      return p;
    }

    // Fill places 6..14 using computedCandidates then remaining seeds
    let nextP = 6;
    nextP = fillRemainingPlacesFromCandidates(nextP, computedCandidates);

    // Finally, use seeds by placement to fill any leftover places
    for (let s = 1; s <= 14 && nextP <= 14; s++) {
      const rid = rosterBySeed[s] ?? null;
      if (!rid) continue;
      if (assigned.has(String(rid))) continue;
      placeToRoster[nextP] = rid;
      assigned.add(String(rid));
      nextP++;
    }
  }

  // Ensure finalStandings array 1..14 created in order and unique
  const finalStandings = [];
  const assignedSetFinal = new Set();
  for (let p = 1; p <= 14; p++) {
    let rid = placeToRoster[p] ?? null;
    // If somehow not assigned, pick next unassigned roster by placement order
    if (!rid) {
      for (let s = 1; s <= 14; s++) {
        const cand = rosterBySeed[s] ?? null;
        if (!cand) continue;
        if (!assignedSetFinal.has(String(cand))) {
          rid = cand;
          break;
        }
      }
    }
    if (!rid) {
      // last resort: any roster not used
      const allIds = Object.keys(rosterMap);
      for (const cand of allIds) {
        if (!assignedSetFinal.has(String(cand))) {
          rid = cand;
          break;
        }
      }
    }

    if (rid) assignedSetFinal.add(String(rid));

    const meta = rosterMap[rid] || {};
    // Guarantee owner_name exists: use owner_name || owner_username || display_name || 'Roster X'
    const ownerName = meta.owner_name ?? meta.owner_username ?? (meta.user_raw && (meta.user_raw.display_name || meta.user_raw.username)) ?? (meta.team_name ?? ('Roster ' + (rid || '?')));
    const teamName = meta.team_name ?? ownerName ?? ('Roster ' + (rid || '?'));
    const avatar = meta.team_avatar ?? meta.owner_avatar ?? meta.owner_avatar ?? null;
    const seedDisplay = placementMap[rid] ? ('#' + placementMap[rid]) : null;

    finalStandings.push({
      rank: p,
      rosterId: rid,
      owner_name: ownerName,
      team_name: teamName,
      avatar,
      seed: seedDisplay
    });
  }

  // debug: push representational assignment lines (optional verbose)
  for (let p = 1; p <= finalStandings.length; p++) {
    const entry = finalStandings[p-1];
    dlog(`Assign place ${p} -> ${entry.team_name} (${entry.owner_name})`);
  }

  // Season outcomes box data: champion & biggest loser
  const champion = finalStandings.length ? finalStandings[0] : null;
  const biggestLoser = finalStandings.length ? finalStandings[finalStandings.length - 1] : null;

  // final messages summary
  messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
  // do not spam messages with all debugLog lines; debugLog is returned separately

  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    // core outputs
    matchupsRows,
    regularStandings,
    finalStandings,
    debugLog,
    // season outcomes for UI convenience
    champion,
    biggestLoser,
    messages,
    prevChain
  };
}
