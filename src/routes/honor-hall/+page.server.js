// src/routes/honor-hall/+page.server.js
// Honor Hall loader + bracket simulation
// - scrubs regular-season matchups (1..playoffStart-1) to compute regularStandings (wins/pf) used for tie-breaks
// - fetches playoff matchups (playoffStart..playoffStart+2)
// - simulates both winner's race (seeds 1..8) and loser's race (9..14) using actual matchup scores where possible
// - produces a debug trace and a finalStandings array (unique ranks 1..N)
//
// Note: this attempts to be defensive when matchups are missing and makes best-effort tiebreaking:
// 1) compare points in that matchup
// 2) if tied, compare regular-season PF
// 3) if still tied, compare regular-season wins
// 4) if still tied, compare placement (lower numeric placement => better seed)

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
  // edge cache
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const incomingSeasonParam = url.searchParams.get('season') || null;

  const messages = [];
  const prevChain = [];

  // --- build seasons chain (previous_league_id) ---
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
          if (!prevLeague) { messages.push('Could not fetch league for previous_league_id ' + currPrev); break; }
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

  // dedupe + sort
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

  // selected season param
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = String(BASE_LEAGUE_ID);
    }
  }

  // map selectedSeasonParam to league id
  let selectedLeagueId = null;
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selectedSeasonParam || BASE_LEAGUE_ID);

  // league meta
  let leagueMeta = null;
  try { leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }); }
  catch (e) { leagueMeta = null; messages.push('Failed fetching league meta for ' + selectedLeagueId + ' — ' + (e?.message ?? e)); }

  // playoff weeks
  let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek))
    ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)
    : null;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
    playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      playoffStart = 15;
      messages.push('Playoff start not found in metadata — defaulting to week ' + playoffStart);
    }
  }
  const playoffEnd = playoffStart + 2;

  // roster map
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
  } catch (e) {
    rosterMap = {};
    messages.push('Failed fetching rosters for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }

  // -------------------------
  // compute regular-season standings (for tiebreaks)
  // weeks 1..playoffStart-1
  // -------------------------
  const statsByRosterRegular = {};
  const resultsByRosterRegular = {};
  const paByRosterRegular = {};

  for (const rk in rosterMap) {
    if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
    statsByRosterRegular[String(rk)] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: rosterMap[rk].roster_raw ?? null };
    resultsByRosterRegular[String(rk)] = [];
    paByRosterRegular[String(rk)] = 0;
  }

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

    // group by matchup id|week
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
        continue;
      }

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
        if (opponents.length) oppAvg = opponents.reduce((acc,o) => acc + o.points, 0) / opponents.length;
        paByRosterRegular[part.rosterId] = (paByRosterRegular[part.rosterId] || 0) + oppAvg;
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
  } // end regular loop

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
      const owner_name = meta.owner_name || null;
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
    out.sort((a,b) => {
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      return (b.pf || 0) - (a.pf || 0);
    });
    return out;
  }

  const regularStandings = buildStandingsFromTrackers(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular);

  // build placement maps (regular-season placement)
  const placementMap = {};
  for (let i = 0; i < regularStandings.length; i++) placementMap[String(regularStandings[i].rosterId)] = i + 1;
  const placementToRoster = {};
  for (const k in placementMap) placementToRoster[ placementMap[k] ] = k;

  // -------------------------
  // fetch playoff matchups (playoffStart..playoffEnd) and normalize into rows
  // -------------------------
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
  const mkeys = Object.keys(byMatch);
  for (let ki = 0; ki < mkeys.length; ki++) {
    const entries = byMatch[mkeys[ki]];
    if (!entries || entries.length === 0) continue;

    if (entries.length === 1) {
      const a = entries[0];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const aMeta = rosterMap[aId] || {};
      const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const aPlacement = placementMap[aId] ?? null;
      matchupsRows.push({
        matchup_id: mkeys[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement },
        teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, placement: null },
        participantsCount: 1
      });
      continue;
    }

    if (entries.length === 2) {
      const a = entries[0];
      const b = entries[1];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
      const aMeta = rosterMap[aId] || {};
      const bMeta = rosterMap[bId] || {};
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? null);
      const aPlacement = placementMap[aId] ?? null;
      const bPlacement = placementMap[bId] ?? null;
      matchupsRows.push({
        matchup_id: mkeys[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts, placement: aPlacement },
        teamB: { rosterId: bId, name: bMeta.team_name || bMeta.owner_name || ('Roster ' + bId), avatar: bMeta.team_avatar || bMeta.owner_avatar || null, points: bPts, placement: bPlacement },
        participantsCount: 2
      });
      continue;
    }

    // multi -> aggregate
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
      matchup_id: mkeys[ki],
      season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
      week: entries[0].week ?? entries[0].w ?? null,
      combinedParticipants: participants,
      combinedLabel,
      participantsCount: participants.length
    });
  }

  // helper: find matchup row for two roster IDs across playoff weeks (prefer exact week ordering)
  function findMatchForPair(rA, rB, preferredWeeks = [playoffStart, playoffStart+1, playoffStart+2]) {
    if (!rA || !rB) return null;
    // normalize to strings
    const a = String(rA), b = String(rB);
    for (const wk of preferredWeeks) {
      for (const r of matchupsRows) {
        if (!r.week) continue;
        if (Number(r.week) !== Number(wk)) continue;
        if (r.participantsCount === 2) {
          const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
          if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) return r;
        } else if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
          const ids = r.combinedParticipants.map(p => String(p.rosterId));
          if (ids.includes(a) && ids.includes(b)) return r;
        }
      }
    }
    // fallback: any week
    for (const r of matchupsRows) {
      if (r.participantsCount === 2) {
        const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
        if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) return r;
      } else if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
        const ids = r.combinedParticipants.map(p => String(p.rosterId));
        if (ids.includes(a) && ids.includes(b)) return r;
      }
    }
    return null;
  }

  // tiebreak: if matchup points equal, consult regularStandings pf -> wins -> placement
  function decideWinnerFromMatch(matchRow, aId, bId) {
    const a = String(aId), b = String(bId);
    // try to get points from the matchRow
    let aPts = null, bPts = null;
    if (!matchRow) return null;
    if (matchRow.participantsCount === 2) {
      const pA = String(matchRow.teamA.rosterId), pB = String(matchRow.teamB.rosterId);
      if (pA === a) { aPts = matchRow.teamA.points; bPts = matchRow.teamB.points; }
      else { aPts = matchRow.teamB.points; bPts = matchRow.teamA.points; }
    } else if (matchRow.combinedParticipants) {
      // attempt to pull participant objects
      const pAobj = matchRow.combinedParticipants.find(p => String(p.rosterId) === a);
      const pBobj = matchRow.combinedParticipants.find(p => String(p.rosterId) === b);
      aPts = pAobj?.points ?? 0;
      bPts = pBobj?.points ?? 0;
    }

    if (aPts == null || bPts == null) return null;
    if (aPts > bPts + 1e-9) return { winner: a, loser: b, reason: 'matchup' };
    if (bPts > aPts + 1e-9) return { winner: b, loser: a, reason: 'matchup' };

    // tie -> tiebreak using regular-season pf
    const aPF = (regularStandings.find(s => String(s.rosterId) === a)?.pf) ?? 0;
    const bPF = (regularStandings.find(s => String(s.rosterId) === b)?.pf) ?? 0;
    if (aPF > bPF) return { winner: a, loser: b, reason: 'tiebreak-pf' };
    if (bPF > aPF) return { winner: b, loser: a, reason: 'tiebreak-pf' };

    // next tiebreak: wins
    const aW = (regularStandings.find(s => String(s.rosterId) === a)?.wins) ?? 0;
    const bW = (regularStandings.find(s => String(s.rosterId) === b)?.wins) ?? 0;
    if (aW > bW) return { winner: a, loser: b, reason: 'tiebreak-wins' };
    if (bW > aW) return { winner: b, loser: a, reason: 'tiebreak-wins' };

    // last resort: placement (lower numeric = better)
    const aPl = placementMap[a] ?? 999;
    const bPl = placementMap[b] ?? 999;
    if (aPl < bPl) return { winner: a, loser: b, reason: 'tiebreak-placement' };
    if (bPl < aPl) return { winner: b, loser: a, reason: 'tiebreak-placement' };

    // fallback: pick a
    return { winner: a, loser: b, reason: 'fallback' };
  }

  // debug trace
  const trace = [];
  trace.push(`Loaded rosters (${Object.keys(rosterMap).length})`);

  // helper to format seed -> rosterId & name
  function seedToRoster(seed) {
    const rid = placementToRoster[seed] ?? null;
    const meta = rid ? rosterMap[rid] : null;
    return { rosterId: rid, name: meta?.team_name ?? meta?.owner_name ?? ('Roster ' + rid) };
  }

  // Build winners race seeds 1..8 and losers race 9..14 (by placement)
  const winnersSeeds = [];
  const losersSeeds = [];
  for (let s = 1; s <= 14; s++) {
    const rid = placementToRoster[s] ?? null;
    if (!rid) continue;
    if (s <= 8) winnersSeeds.push({ seed: s, rosterId: rid });
    else losersSeeds.push({ seed: s, rosterId: rid });
  }

  // utility: run a matchup between two seeds (seed objects {seed, rosterId}) at a recommended week list
  function runMatch(seedA, seedB, label, preferredWeeks = [playoffStart, playoffStart+1, playoffStart+2]) {
    const a = seedA.rosterId, b = seedB.rosterId;
    const matchRow = findMatchForPair(a, b, preferredWeeks);
    const decision = decideWinnerFromMatch(matchRow, a, b);
    if (!decision) {
      // best-effort fallback: prefer higher seed (lower numeric) as winner if nothing available
      const winner = Number(seedA.seed) <= Number(seedB.seed) ? seedA.rosterId : seedB.rosterId;
      const loser = winner === seedA.rosterId ? seedB.rosterId : seedA.rosterId;
      trace.push(`${label} ${seedA.seed}v${seedB.seed} -> ${ placementMap[winner] ? placementMap[winner] : winner } (fallback-no-match)`);
      return { winner, loser, row: matchRow, reason: 'fallback-no-match' };
    }
    // we have a decision object
    const winner = decision.winner;
    const loser = decision.loser;
    // convert winners' seed numeric (if available)
    const wSeed = placementMap[winner] ?? winner;
    trace.push(`${label} ${seedA.seed}v${seedB.seed} -> ${ wSeed } (${decision.reason})`);
    return { winner, loser, row: matchRow, reason: decision.reason };
  }

  // Begin simulation
  // WINNERS BRACKET
  // Round 1: 1v8, 2v7, 3v6, 4v5 (week playoffStart)
  const wR1Pairs = [
    [1,8],[2,7],[3,6],[4,5]
  ].map(([s1,s2]) => ({ a: {seed: s1, rosterId: placementToRoster[s1]}, b: {seed: s2, rosterId: placementToRoster[s2]} }));

  const wR1Results = [];
  for (const p of wR1Pairs) {
    if (!p.a.rosterId || !p.b.rosterId) {
      // if missing roster, push a fallback
      trace.push(`W1 ${p.a.seed}v${p.b.seed} -> missing-roster`);
      wR1Results.push({ winner: p.a.rosterId || p.b.rosterId, loser: p.a.rosterId ? p.b.rosterId : p.a.rosterId, reason: 'missing-roster' });
      continue;
    }
    const res = runMatch(p.a, p.b, `W1`);
    wR1Results.push(res);
  }

  // produce arrays of winners / losers with their original seeds
  const wR1Winners = wR1Results.map((r, idx) => {
    const pair = wR1Pairs[idx];
    const winSeed = placementMap[r.winner] ?? null;
    const loseSeed = placementMap[r.loser] ?? null;
    return { seed: winSeed, rosterId: r.winner, loserSeed: loseSeed, loserId: r.loser };
  });
  const wR1Losers = wR1Results.map((r, idx) => {
    const pair = wR1Pairs[idx];
    const winSeed = placementMap[r.winner] ?? null;
    const loseSeed = placementMap[r.loser] ?? null;
    return { seed: loseSeed, rosterId: r.loser, winnerSeed: winSeed, winnerId: r.winner };
  });

  // Winners semi: pair highest seed with lowest seed from winners
  // sort by seed ascending (1 best) -> [low,...,high]
  wR1Winners.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const wSemiPairs = [
    [ wR1Winners[0], wR1Winners[wR1Winners.length-1] ],
    [ wR1Winners[1], wR1Winners[wR1Winners.length-2] ]
  ];

  const wSemiResults = [];
  for (const pair of wSemiPairs) {
    if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) {
      trace.push(`Semi missing participant -> skipping`);
      wSemiResults.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[1]?.rosterId || pair[0]?.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}, `Semi`);
    wSemiResults.push(res);
  }

  // Final & 3rd
  const finalRes = (wSemiResults.length >= 2)
    ? runMatch({seed: placementMap[wSemiResults[0].winner], rosterId: wSemiResults[0].winner}, {seed: placementMap[wSemiResults[1].winner], rosterId: wSemiResults[1].winner}, `Final`)
    : null;
  const thirdRes = (wSemiResults.length >= 2)
    ? runMatch({seed: placementMap[wSemiResults[0].loser], rosterId: wSemiResults[0].loser}, {seed: placementMap[wSemiResults[1].loser], rosterId: wSemiResults[1].loser}, `3rd`)
    : null;

  // Consolation bracket from winners-round losers
  // losers R1: sort by seed ascending (best -> worst) and pair highest vs lowest
  wR1Losers.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const cR1Pairs = [
    [wR1Losers[0], wR1Losers[wR1Losers.length-1]],
    [wR1Losers[1], wR1Losers[wR1Losers.length-2]]
  ];

  const cR1Results = [];
  for (const pair of cR1Pairs) {
    if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) {
      trace.push(`Consolation R1 missing -> skipping`);
      cR1Results.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[1]?.rosterId || pair[0]?.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}, `Consolation R1`);
    cR1Results.push(res);
  }

  // 5th (winners of consolation R1) and 7th (losers)
  const fifthRes = (cR1Results.length >= 1)
    ? runMatch({seed: placementMap[cR1Results[0].winner], rosterId: cR1Results[0].winner}, {seed: placementMap[cR1Results[1].winner], rosterId: cR1Results[1].winner}, `5th`)
    : null;
  const seventhRes = (cR1Results.length >= 2)
    ? runMatch({seed: placementMap[cR1Results[0].loser], rosterId: cR1Results[0].loser}, {seed: placementMap[cR1Results[1].loser], rosterId: cR1Results[1].loser}, `7th`)
    : null;

  // -------------------------
  // Losers bracket (seeds 9..14)
  // - initial: 9v12, 10v11, 13 & 14 may be byes
  // - winners join semis with byes; simulate similarly with available matchups
  // -------------------------
  // build array of loser seeds with rosterIds
  const lSeeds = losersSeeds.slice().sort((a,b) => (a.seed || 999) - (b.seed || 999)); // ascending placement
  // find mapping seed->object for convenience
  const lBySeed = {};
  for (const s of lSeeds) lBySeed[s.seed] = s;

  // initial pairs
  const lR1PairsSeedNums = [[9,12],[10,11]]; // 13 & 14 bye
  const lR1Results = [];
  for (const [s1,s2] of lR1PairsSeedNums) {
    const objA = lBySeed[s1] || {seed:s1, rosterId: placementToRoster[s1]};
    const objB = lBySeed[s2] || {seed:s2, rosterId: placementToRoster[s2]};
    if (!objA.rosterId || !objB.rosterId) {
      trace.push(`LRace ${s1}v${s2} -> missing-roster`);
      lR1Results.push({ winner: objA.rosterId || objB.rosterId, loser: objA.rosterId ? objB.rosterId : objA.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: objA.seed, rosterId: objA.rosterId}, {seed: objB.seed, rosterId: objB.rosterId}, `LRace`);
    lR1Results.push(res);
  }

  // include byes as automatic advances
  const lAfterR1 = [];
  // winners of these two and the byes 13 & 14
  for (const r of lR1Results) lAfterR1.push({ rosterId: r.winner, seed: placementMap[r.winner] ?? null });
  // byes:
  if (placementToRoster[13]) lAfterR1.push({ rosterId: placementToRoster[13], seed:13 });
  if (placementToRoster[14]) lAfterR1.push({ rosterId: placementToRoster[14], seed:14 });

  // now make two semifinal pairs from these 4 entrants: sort by seed ascending and pair 1v4 and 2v3
  lAfterR1.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const lSemiPairs = [
    [lAfterR1[0], lAfterR1[3]],
    [lAfterR1[1], lAfterR1[2]]
  ];
  const lSemiResults = [];
  for (const p of lSemiPairs) {
    if (!p[0] || !p[1] || !p[0].rosterId || !p[1].rosterId) {
      trace.push(`LRaceSemi missing -> skipping`);
      lSemiResults.push({ winner: p[0]?.rosterId || p[1]?.rosterId, loser: p[1]?.rosterId || p[0]?.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: p[0].seed, rosterId: p[0].rosterId}, {seed: p[1].seed, rosterId: p[1].rosterId}, `LRaceSemi`);
    lSemiResults.push(res);
  }

  // determine final positions inside losers pool:
  // - 9th = winner of winners of semis
  // - 11th = loser of winners of semis (or tie-break)
  // - 13th/14th decided by remaining consolation match among losers and by tiebreaks
  const lFinalRes = (lSemiResults.length >= 2)
    ? runMatch({seed: placementMap[lSemiResults[0].winner], rosterId: lSemiResults[0].winner}, {seed: placementMap[lSemiResults[1].winner], rosterId: lSemiResults[1].winner}, `9th`)
    : null;
  const lThirdRes = (lSemiResults.length >= 2)
    ? runMatch({seed: placementMap[lSemiResults[0].loser], rosterId: lSemiResults[0].loser}, {seed: placementMap[lSemiResults[1].loser], rosterId: lSemiResults[1].loser}, `11th`)
    : null;

  // now collect final placements based on winners & losers
  // We'll build an ordered array of rosterIds -> final rank
  // Proposed assignments:
  // rank1: finalRes.winner
  // rank2: finalRes.loser
  // rank3: thirdRes.winner
  // rank4: thirdRes.loser
  // rank5: fifthRes.winner
  // rank6: fifthRes.loser
  // rank7: seventhRes.winner
  // rank8: seventhRes.loser
  // rank9: lFinalRes.winner
  // rank10: lFinalRes.loser
  // rank11: lThirdRes.winner
  // rank12: lThirdRes.loser
  // rank13/14: remaining two rosters that haven't been assigned yet — assign via tiebreak (pf/wins) to ensure a unique ordering.

  const assigned = new Set();
  const placementFinal = [];

  function pushIfNotAssigned(rosterId) {
    if (!rosterId) return;
    const r = String(rosterId);
    if (!assigned.has(r)) {
      placementFinal.push(r);
      assigned.add(r);
    }
  }

  // helper to unpack result object from runMatch
  function pushResultPair(resObj) {
    if (!resObj) return;
    pushIfNotAssigned(resObj.winner);
    pushIfNotAssigned(resObj.loser);
  }

  pushResultPair(finalRes);
  pushResultPair(thirdRes);
  pushResultPair(fifthRes);
  pushResultPair(seventhRes);
  pushResultPair(lFinalRes);
  pushResultPair(lThirdRes);

  // after pushing known outcomes, if we still don't have all rosters, push any playoffs match participants in descending preference
  // push all participants from matchupsRows (playoff participants)
  for (const r of matchupsRows) {
    if (r.participantsCount === 2) {
      pushIfNotAssigned(r.teamA.rosterId);
      pushIfNotAssigned(r.teamB.rosterId);
    } else if (r.combinedParticipants) {
      for (const p of r.combinedParticipants) pushIfNotAssigned(p.rosterId);
    } else if (r.teamA && r.teamA.rosterId) pushIfNotAssigned(r.teamA.rosterId);
  }

  // finally push any rosterIds from rosterMap that are still missing
  for (const rk in rosterMap) pushIfNotAssigned(rk);

  // Now ensure we have unique ranks 1..N and total equals roster count
  const finalStandings = [];
  const totalTeams = Object.keys(rosterMap).length || placementFinal.length;
  // If placementFinal has fewer than totalTeams, add missing rosterIds
  if (placementFinal.length < totalTeams) {
    for (const rk in rosterMap) {
      if (!assigned.has(String(rk))) {
        placementFinal.push(String(rk));
        assigned.add(String(rk));
      }
    }
  }

  // If still more than totalTeams (shouldn't) trim
  while (placementFinal.length > totalTeams) placementFinal.pop();

  // Build finalStandings array with metadata and enforce uniqueness
  for (let i = 0; i < placementFinal.length; i++) {
    const rid = String(placementFinal[i]);
    const meta = rosterMap[rid] || {};
    finalStandings.push({
      rank: i + 1,
      rosterId: rid,
      team_name: meta.team_name || meta.owner_name || ('Roster ' + rid),
      avatar: meta.team_avatar || meta.owner_avatar || null,
      seed: placementMap[rid] ?? null, // regular-season placement used as seed
      pf: regularStandings.find(s => String(s.rosterId) === rid)?.pf ?? 0,
      wins: regularStandings.find(s => String(s.rosterId) === rid)?.wins ?? 0
    });
  }

  // If somehow duplicates of rank or missing, re-order using deterministic tiebreak: wins -> pf -> seed
  finalStandings.sort((a,b) => {
    if ((a.rank || 0) !== (b.rank || 0)) return (a.rank || 0) - (b.rank || 0);
    // fallback stable sort by wins/pf/seed
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    if ((b.pf || 0) !== (a.pf || 0)) return (b.pf || 0) - (a.pf || 0);
    return (a.seed || 999) - (b.seed || 999);
  });
  // reassign rank positions 1..N to guarantee unique ranks
  for (let i = 0; i < finalStandings.length; i++) finalStandings[i].rank = i + 1;

  // season outcomes
  const champion = finalStandings[0] ?? null;
  const biggestLoser = finalStandings[finalStandings.length - 1] ?? null;

  // debug messages are in trace (already appended) — expose both trace and messages
  const debug = trace;

  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    matchupsRows,
    regularStandings,
    finalStandings,
    debug,
    messages,
    prevChain
  };
}
