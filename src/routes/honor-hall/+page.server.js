// src/routes/honor-hall/+page.server.js
// Honor Hall loader: fetch playoff matchups and compute placements by scrubbing regular-season matchups
// Mirrors the approach used in src/routes/standings/+page.server.js for consistency.

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

  const messages = [];
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

  // -------------------------
  // Bracket simulator -> finalStandings (1..14)
  // -------------------------
  function findMatchupBetween(aRosterId, bRosterId) {
    // find a matchup row where both rosterIds match (order-insensitive)
    for (const r of matchupsRows) {
      if (r.participantsCount !== 2) continue;
      const A = r.teamA?.rosterId;
      const B = r.teamB?.rosterId;
      if (!A || !B) continue;
      if ((String(A) === String(aRosterId) && String(B) === String(bRosterId)) ||
          (String(A) === String(bRosterId) && String(B) === String(aRosterId))) {
        return r;
      }
      // also try matching by placement if roster ids are not present
      if (r.teamA?.placement && r.teamB?.placement) {
        const ap = r.teamA.placement, bp = r.teamB.placement;
        const aSeed = placementMap[String(aRosterId)], bSeed = placementMap[String(bRosterId)];
        if (aSeed && bSeed && ((ap === aSeed && bp === bSeed) || (ap === bSeed && bp === aSeed))) return r;
      }
    }
    return null;
  }

  // decide winner / loser from a match row (prefer points)
  function decideFromRow(r) {
    if (!r || r.participantsCount !== 2) return null;
    const a = r.teamA, b = r.teamB;
    if (a.points != null && b.points != null) {
      if (Number(a.points) >= Number(b.points)) return { winner: a.rosterId, loser: b.rosterId, winnerPts: a.points, loserPts: b.points };
      else return { winner: b.rosterId, loser: a.rosterId, winnerPts: b.points, loserPts: a.points };
    }
    // fallback: if points missing, prefer higher seed (lower placement number)
    const ap = a.placement || 999, bp = b.placement || 999;
    if (ap < bp) return { winner: a.rosterId, loser: b.rosterId, winnerPts: null, loserPts: null };
    if (bp < ap) return { winner: b.rosterId, loser: a.rosterId, winnerPts: null, loserPts: null };
    // ultimate fallback: pick by rosterId lexicographic (deterministic)
    if (String(a.rosterId) <= String(b.rosterId)) return { winner: a.rosterId, loser: b.rosterId, winnerPts: null, loserPts: null };
    return { winner: b.rosterId, loser: a.rosterId, winnerPts: null, loserPts: null };
  }

  // create teams map seeded by regularStandings
  const teams = {};
  for (let i = 0; i < regularStandings.length; i++) {
    const t = regularStandings[i];
    teams[String(t.rosterId)] = {
      rosterId: String(t.rosterId),
      team_name: t.team_name,
      avatar: t.avatar,
      seed: i + 1,
      finalRank: null
    };
  }

  // helper: ensure any roster present in playoffs but not in regularStandings is added
  for (const r of matchupsRows) {
    if (r.participantsCount === 2) {
      const aId = String(r.teamA?.rosterId), bId = String(r.teamB?.rosterId);
      if (aId && !teams[aId]) teams[aId] = { rosterId: aId, team_name: r.teamA.name || ('Roster ' + aId), avatar: r.teamA.avatar || null, seed: placementMap[aId] || 99, finalRank: null };
      if (bId && !teams[bId]) teams[bId] = { rosterId: bId, team_name: r.teamB.name || ('Roster ' + bId), avatar: r.teamB.avatar || null, seed: placementMap[bId] || 99, finalRank: null };
    } else if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
      for (const p of r.combinedParticipants) {
        const pid = String(p.rosterId);
        if (pid && !teams[pid]) teams[pid] = { rosterId: pid, team_name: p.name || ('Roster ' + pid), avatar: p.avatar || null, seed: placementMap[pid] || 99, finalRank: null };
      }
    }
  }

  // Helper to mark final rank if not already assigned (no overwrites)
  function assignRank(rosterId, rank) {
    if (!rosterId) return;
    rosterId = String(rosterId);
    if (!teams[rosterId]) teams[rosterId] = { rosterId, team_name: ('Roster ' + rosterId), avatar: null, seed: placementMap[rosterId] || 99, finalRank: null };
    if (teams[rosterId].finalRank == null) teams[rosterId].finalRank = rank;
  }

  // --- Simulate winners bracket (seeds 1..8) ---
  const seedsWinners = [];
  for (let s = 1; s <= 8; s++) {
    // find roster with seed s
    const found = Object.values(teams).find(t => Number(t.seed) === s);
    if (found) seedsWinners.push(found.rosterId);
    else seedsWinners.push(null);
  }

  // Round 1 winners pairings: 1v8, 2v7, 3v6, 4v5
  const winnersR1Pairs = [
    [seedsWinners[0], seedsWinners[7]],
    [seedsWinners[1], seedsWinners[6]],
    [seedsWinners[2], seedsWinners[5]],
    [seedsWinners[3], seedsWinners[4]]
  ];

  const winnersR1Results = []; // {winner, loser, pair}
  for (const pair of winnersR1Pairs) {
    const [aId,bId] = pair;
    if (!aId && !bId) continue;
    if (!bId) { // bye
      assignRank(aId, null); // leave to later rounds
      winnersR1Results.push({ winner: aId, loser: bId, pair });
      continue;
    }
    if (!aId) { winnersR1Results.push({ winner: bId, loser: aId, pair }); continue; }
    const m = findMatchupBetween(aId,bId);
    const dec = decideFromRow(m);
    if (dec) winnersR1Results.push({ winner: dec.winner, loser: dec.loser, pair, row: m });
    else winnersR1Results.push({ winner: aId, loser: bId, pair, row: m });
  }

  // Semifinals for winners: winners of R1 -> reseed highest vs lowest
  const winnersFromR1 = winnersR1Results.map(r => r.winner).filter(Boolean);
  // sort by seed ascending (1 highest)
  winnersFromR1.sort((A,B) => (Number(teams[A].seed || 99) - Number(teams[B].seed || 99)));
  // pair highest vs lowest, second highest vs second lowest
  const winnersSemiPairs = [];
  if (winnersFromR1.length >= 2) {
    winnersSemiPairs.push([winnersFromR1[0], winnersFromR1[winnersFromR1.length-1]]);
  }
  if (winnersFromR1.length >= 4) {
    winnersSemiPairs.push([winnersFromR1[1], winnersFromR1[winnersFromR1.length-2]]);
  } else if (winnersFromR1.length === 3) {
    winnersSemiPairs.push([winnersFromR1[1], winnersFromR1[2]]);
  }

  const winnersSemiResults = [];
  for (const pair of winnersSemiPairs) {
    const [aId,bId] = pair;
    if (!aId || !bId) {
      winnersSemiResults.push({ winner: aId || bId, loser: aId ? null : bId, pair });
      continue;
    }
    const m = findMatchupBetween(aId,bId);
    const dec = decideFromRow(m);
    if (dec) winnersSemiResults.push({ winner: dec.winner, loser: dec.loser, pair, row: m });
    else winnersSemiResults.push({ winner: aId, loser: bId, pair, row: m });
  }

  // Championship: winners of semis (usually 2 winners)
  const winnersForFinal = winnersSemiResults.map(r => r.winner).filter(Boolean);
  let champion = null, runnerUp = null;
  if (winnersForFinal.length === 1) {
    champion = winnersForFinal[0];
  } else if (winnersForFinal.length >= 2) {
    const [aId,bId] = [winnersForFinal[0], winnersForFinal[1]];
    const m = findMatchupBetween(aId,bId);
    const dec = decideFromRow(m);
    if (dec) {
      champion = dec.winner;
      runnerUp = dec.loser;
    } else {
      // fallback to seed
      champion = (teams[aId].seed < teams[bId].seed) ? aId : bId;
      runnerUp = champion === aId ? bId : aId;
    }
  }

  // assign champion and runner-up
  if (champion) assignRank(champion, 1);
  if (runnerUp) assignRank(runnerUp, 2);

  // Decide 3rd/4th: losers of semis (if two semis exist)
  const semisLosers = winnersSemiResults.map(r => r.loser).filter(Boolean);
  if (semisLosers.length === 1) {
    // single loser gets 3rd
    assignRank(semisLosers[0], 3);
  } else if (semisLosers.length >= 2) {
    const [aId, bId] = [semisLosers[0], semisLosers[1]];
    const m = findMatchupBetween(aId,bId);
    const dec = decideFromRow(m);
    if (dec) {
      assignRank(dec.winner, 3);
      assignRank(dec.loser, 4);
    } else {
      // fallback by seed
      if (teams[aId].seed < teams[bId].seed) {
        assignRank(aId, 3); assignRank(bId, 4);
      } else {
        assignRank(bId, 3); assignRank(aId, 4);
      }
    }
  }

  // --- Consolation within winners bracket for 5-8 places ---
  // Losers of R1 play each other: collect losers from winnersR1Results
  const losersFromR1 = winnersR1Results.map(r => r.loser).filter(Boolean);
  losersFromR1.sort((A,B) => (Number(teams[A].seed || 99) - Number(teams[B].seed || 99))); // highest seed first
  // pair highest vs lowest, next highest vs next lowest
  const consPairs = [];
  if (losersFromR1.length >= 2) consPairs.push([losersFromR1[0], losersFromR1[losersFromR1.length-1]]);
  if (losersFromR1.length >= 4) consPairs.push([losersFromR1[1], losersFromR1[losersFromR1.length-2]]);
  const consResults = [];
  for (const pair of consPairs) {
    const [aId,bId] = pair;
    if (!aId || !bId) { if (aId) consResults.push({ winner: aId, loser: bId, pair }); else if (bId) consResults.push({ winner: bId, loser: aId, pair }); continue; }
    const m = findMatchupBetween(aId,bId);
    const dec = decideFromRow(m);
    if (dec) consResults.push({ winner: dec.winner, loser: dec.loser, pair, row: m });
    else consResults.push({ winner: aId, loser: bId, pair, row: m });
  }
  // winners of consResults -> play for 5th/6th; losers play for 7th/8th
  const consWinners = consResults.map(r => r.winner).filter(Boolean);
  const consLosers = consResults.map(r => r.loser).filter(Boolean);

  if (consWinners.length === 1) {
    assignRank(consWinners[0], 5);
  } else if (consWinners.length >= 2) {
    const [aId,bId] = [consWinners[0], consWinners[1]];
    const m = findMatchupBetween(aId,bId);
    const dec = decideFromRow(m);
    if (dec) { assignRank(dec.winner, 5); assignRank(dec.loser, 6); }
    else { if (teams[aId].seed < teams[bId].seed) { assignRank(aId,5); assignRank(bId,6); } else { assignRank(bId,5); assignRank(aId,6); } }
  }

  if (consLosers.length === 1) {
    assignRank(consLosers[0], 7);
  } else if (consLosers.length >= 2) {
    const [aId,bId] = [consLosers[0], consLosers[1]];
    const m = findMatchupBetween(aId,bId);
    const dec = decideFromRow(m);
    if (dec) { assignRank(dec.winner, 7); assignRank(dec.loser, 8); }
    else { if (teams[aId].seed < teams[bId].seed) { assignRank(aId,7); assignRank(bId,8); } else { assignRank(bId,7); assignRank(aId,8); } }
  }

  // --- Second playoff race (seeds 9..14) ---
  // Race pairing rules: 9v12, 10v11, 13 & 14 have bye initially
  const seedsLower = [];
  for (let s = 9; s <= 14; s++) {
    const found = Object.values(teams).find(t => Number(t.seed) === s);
    seedsLower.push(found ? found.rosterId : null);
  }
  const lowerPairsR1 = [
    [seedsLower[0], seedsLower[3]], // 9v12
    [seedsLower[1], seedsLower[2]]  // 10v11
    // 13 (seedsLower[4]) and 14 (seedsLower[5]) bye
  ];
  const lowerR1Results = [];
  for (const pair of lowerPairsR1) {
    const [aId,bId] = pair;
    if (!aId && !bId) continue;
    if (!bId) { lowerR1Results.push({ winner: aId, loser: bId, pair }); continue; }
    if (!aId) { lowerR1Results.push({ winner: bId, loser: aId, pair }); continue; }
    const m = findMatchupBetween(aId,bId);
    const dec = decideFromRow(m);
    if (dec) lowerR1Results.push({ winner: dec.winner, loser: dec.loser, pair, row: m });
    else lowerR1Results.push({ winner: aId, loser: bId, pair, row: m });
  }

  // winners of the two lower matches play for 9th/10th; losers play for 11th/12th.
  const lowerWinners = lowerR1Results.map(r => r.winner).filter(Boolean);
  const lowerLosers = lowerR1Results.map(r => r.loser).filter(Boolean);
  // include byes (13/14) into later rounds as needed
  const possibleBye = [seedsLower[4], seedsLower[5]]; // 13,14

  if (lowerWinners.length === 1) {
    // that winner likely gets 9th (if no further match)
    assignRank(lowerWinners[0], 9);
  } else if (lowerWinners.length >= 2) {
    const [aId,bId] = [lowerWinners[0], lowerWinners[1]];
    const m = findMatchupBetween(aId,bId);
    const dec = decideFromRow(m);
    if (dec) { assignRank(dec.winner, 9); assignRank(dec.loser, 10); }
    else { if (teams[aId].seed < teams[bId].seed) { assignRank(aId,9); assignRank(bId,10);} else { assignRank(bId,9); assignRank(aId,10);} }
  }

  if (lowerLosers.length === 1) {
    assignRank(lowerLosers[0], 11);
  } else if (lowerLosers.length >= 2) {
    const [aId,bId] = [lowerLosers[0], lowerLosers[1]];
    const m = findMatchupBetween(aId,bId);
    const dec = decideFromRow(m);
    if (dec) { assignRank(dec.winner, 11); assignRank(dec.loser, 12); }
    else { if (teams[aId].seed < teams[bId].seed) { assignRank(aId,11); assignRank(bId,12);} else { assignRank(bId,11); assignRank(aId,12);} }
  }

  // 13/14 maybe byes or have matches - if they played a match, it should be in matchupsRows; otherwise assign by seed order (13th then 14th)
  // If either 13/14 have not got finalRank, try to find their matches vs others
  for (const byeId of possibleBye) {
    if (!byeId) continue;
    if (teams[byeId].finalRank == null) {
      // try find a match where they appear in matchupsRows
      const match = matchupsRows.find(r => r.participantsCount === 2 && (String(r.teamA.rosterId) === String(byeId) || String(r.teamB.rosterId) === String(byeId)));
      if (match) {
        const dec = decideFromRow(match);
        if (dec) {
          assignRank(dec.winner, dec.winner === byeId ? 13 : 14);
          assignRank(dec.loser, dec.loser === byeId ? 13 : 14);
        }
      }
    }
  }

  // Fill remaining ranks (1..14) deterministically if any teams still unranked
  const assigned = new Set();
  for (const k in teams) {
    if (teams[k].finalRank != null) assigned.add(Number(teams[k].finalRank));
  }
  // start filling from 1 .. 14
  let nextRankToFill = 1;
  function nextAvailableRank() {
    while (assigned.has(nextRankToFill)) nextRankToFill++;
    return nextRankToFill;
  }

  // produce an array of all rosters we know (prefer seeds 1..14 ordering)
  const allRosterIds = Object.values(teams).sort((a,b) => (Number(a.seed || 999) - Number(b.seed || 999))).map(t => t.rosterId);

  for (const rid of allRosterIds) {
    if (teams[rid].finalRank == null) {
      const r = nextAvailableRank();
      teams[rid].finalRank = r;
      assigned.add(r);
    }
  }

  // build finalStandings array sorted by rank (1..14)
  const finalStandings = Object.values(teams)
    .sort((a,b) => (Number(a.finalRank || 999) - Number(b.finalRank || 999)))
    .map(t => ({
      rosterId: t.rosterId,
      team_name: t.team_name,
      avatar: t.avatar,
      seed: t.seed,
      finalRank: t.finalRank
    }));

  // return all data
  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    matchupsRows,
    regularStandings,
    finalStandings,
    messages,
    prevChain
  };
}
