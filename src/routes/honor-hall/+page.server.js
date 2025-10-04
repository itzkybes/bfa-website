// src/routes/honor-hall/+page.server.js
// Honor Hall loader: fetch playoff matchups and compute final standings by simulating playoff bracket progressions.
// Includes special-case behavior for 2022 (top 6 in winners bracket).

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
  const debugLog = []; // debug lines describing bracket decisions
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

  // determine selectedLeagueId
  let selectedLeagueId = null;
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selectedSeasonParam || BASE_LEAGUE_ID);

  // Fetch league metadata to determine playoff weeks
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
    playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
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
    debugLog.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
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
        if (opponents.length) {
          oppAvg = opponents.reduce((acc, o) => acc + o.points, 0) / opponents.length;
        }
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
  } // end regular weeks loop

  // Build sorted regular standings
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
    // sort by wins desc, then pf desc
    out.sort((a,b) => {
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      return (b.pf || 0) - (a.pf || 0);
    });
    return out;
  }

  const regularStandings = buildStandingsFromTrackers(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular);

  // placementMap (1-based seed)
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
  const keysB = Object.keys(byMatch);
  for (let ki = 0; ki < keysB.length; ki++) {
    const entries = byMatch[keysB[ki]];
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
        matchup_id: keysB[ki],
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
      const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
      const bName = bMeta.team_name || bMeta.owner_name || ('Roster ' + bId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
      const bAvatar = bMeta.team_avatar || bMeta.owner_avatar || null;
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? null);
      const aPlacement = placementMap[aId] ?? null;
      const bPlacement = placementMap[bId] ?? null;

      matchupsRows.push({
        matchup_id: keysB[ki],
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
      matchup_id: keysB[ki],
      season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
      week: entries[0].week ?? entries[0].w ?? null,
      combinedParticipants: participants,
      combinedLabel,
      participantsCount: participants.length
    });
  }

  // helper: find a recorded playoff matchup result between two rosterIds (order-agnostic)
  function findRecordedMatch(aId, bId) {
    if (!aId || !bId) return null;
    aId = String(aId); bId = String(bId);
    for (const r of matchupsRows) {
      if (r.participantsCount !== 2) continue;
      const ra = String(r.teamA?.rosterId);
      const rb = String(r.teamB?.rosterId);
      if ((ra === aId && rb === bId) || (ra === bId && rb === aId)) {
        return r;
      }
    }
    return null;
  }

  // fallback winner (no recorded matchup) - use playoff PF if we have it else regular season PF then seed
  function fallbackWinnerByPfOrSeed(aId, bId) {
    const aMeta = regularStandings.find(s => String(s.rosterId) === String(aId));
    const bMeta = regularStandings.find(s => String(s.rosterId) === String(bId));
    const aPf = aMeta ? (aMeta.pf || 0) : 0;
    const bPf = bMeta ? (bMeta.pf || 0) : 0;
    if (aPf !== bPf) return (aPf > bPf) ? aId : bId;
    const aSeed = placementMap[String(aId)] || 999;
    const bSeed = placementMap[String(bId)] || 999;
    return (aSeed < bSeed) ? aId : bId;
  }

  // returns { winnerId, loserId, method } where method is 'matchup' or 'fallback' or 'tiebreak'
  function resolvePair(aId, bId) {
    const recorded = findRecordedMatch(aId, bId);
    if (recorded) {
      const ra = String(recorded.teamA.rosterId);
      const rb = String(recorded.teamB.rosterId);
      const aPts = safeNum(recorded.teamA.points ?? recorded.teamA.points_for ?? recorded.teamA.pts ?? 0);
      const bPts = safeNum(recorded.teamB.points ?? recorded.teamB.points_for ?? recorded.teamB.pts ?? 0);
      if (Math.abs(aPts - bPts) > 1e-9) {
        if (aPts > bPts) return { winnerId: ra, loserId: rb, method: 'matchup' , recorded};
        return { winnerId: rb, loserId: ra, method: 'matchup', recorded};
      }
      // exact tie: use PF then seed
      const fallback = fallbackWinnerByPfOrSeed(ra, rb);
      return { winnerId: fallback, loserId: fallback === ra ? rb : ra, method: 'tiebreak-pf', recorded};
    }
    // no recorded matchup
    const fallback = fallbackWinnerByPfOrSeed(aId, bId);
    return { winnerId: fallback, loserId: fallback === String(aId) ? String(bId) : String(aId), method: 'fallback-no-match' };
  }

  // bracket simulation
  // special-case: winnersSize is 6 for season 2022, otherwise 8
  const seasonKey = leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null;
  const winnersSize = (seasonKey === '2022') ? 6 : 8;

  // Build seed arrays from placementMap sorted ascending (1..N)
  const seedPairs = Object.keys(placementMap).map(k => ({ rosterId: k, seed: placementMap[k] }));
  seedPairs.sort((a,b) => a.seed - b.seed); // seed ascending

  // map seed -> rosterId and rosterId->seed
  const seedToRoster = {};
  const rosterToSeed = {};
  for (const s of seedPairs) {
    seedToRoster[s.seed] = s.rosterId;
    rosterToSeed[s.rosterId] = s.seed;
  }

  // winners bracket teams
  const winnersSeeds = [];
  for (let s = 1; s <= winnersSize; s++) {
    if (seedToRoster[s]) winnersSeeds.push(seedToRoster[s]);
  }
  // losers bracket teams = remaining seeds (seed winnersSize+1 ..)
  const losersSeeds = [];
  for (let s = winnersSize + 1; s <= Math.max(14, Object.keys(seedToRoster).length); s++) {
    if (seedToRoster[s]) losersSeeds.push(seedToRoster[s]);
  }

  // Utility to format "1v8" style strings
  function labelPairBySeed(aId, bId) {
    const sa = rosterToSeed[aId] || '?';
    const sb = rosterToSeed[bId] || '?';
    return `${sa}v${sb}`;
  }

  // Now simulate winners bracket depending on winnersSize
  // We'll record all placements temporarily into a map: rosterId -> finalPlace (1..14)
  const placeMap = {}; // rosterId -> place (number)
  const usedForPlace = new Set();

  // Track a set of generated simulation lines for debug
  // The simulation below tries to mirror the flow you described.
  // For winnersSize === 8: Quarterfinals (1v8,2v7,3v6,4v5) -> Semis -> Final -> 3rd/Consolation
  // For winnersSize === 6 (2022): Quarter round only for seeds 3-6 (3v6,4v5), seeds 1&2 bye to semis.

  // helper: mark place for a roster if not already set
  function assignPlace(rosterId, place, reason) {
    rosterId = String(rosterId);
    if (!placeMap[rosterId]) {
      placeMap[rosterId] = place;
      usedForPlace.add(rosterId);
    } else {
      // if place already assigned, prefer the lower number (better rank) if conflict
      if (place < placeMap[rosterId]) placeMap[rosterId] = place;
    }
    // push debug note if reason provided
    if (reason) debugLog.push(reason);
  }

  // convenience: get name/avatar/seed for finalStandings later
  function metaForRoster(rid) {
    const meta = rosterMap[rid] || {};
    return {
      rosterId: String(rid),
      name: meta.team_name || meta.owner_name || ('Roster ' + String(rid)),
      avatar: meta.team_avatar || meta.owner_avatar || null,
      seed: rosterToSeed[rid] || null
    };
  }

  // simulate winners bracket:
  let winnersRound1 = []; // pairs result {a,b,winner,loser,method}
  let winnersSemis = [];
  let winnersFinal = null;
  let winnersThird = null;

  if (winnersSize === 8) {
    // quarterfinal pairs
    const pairs = [
      [seedToRoster[1], seedToRoster[8]],
      [seedToRoster[2], seedToRoster[7]],
      [seedToRoster[3], seedToRoster[6]],
      [seedToRoster[4], seedToRoster[5]]
    ];
    // round1
    for (const [a,b] of pairs) {
      if (!a || !b) continue;
      const res = resolvePair(a,b);
      winnersRound1.push({ a, b, ...res });
      debugLog.push(`W1 ${labelPairBySeed(a,b)} -> ${rosterToSeed[res.winnerId] || res.winnerId} (${res.method === 'matchup' ? 'matchup' : res.method})`);
    }
    // semis: highest seed winner plays lowest seed winner (determine by seed value)
    const winners1 = winnersRound1.map(r => ({ id: r.winnerId, seed: rosterToSeed[r.winnerId] || 999 }));
    winners1.sort((x,y) => x.seed - y.seed);
    if (winners1.length >= 2) {
      // pair best vs worst and middle two -> but to match the "highest seed plays the lowest seed" phrasing:
      const semiPairs = [
        [winners1[0].id, winners1[winners1.length - 1].id],
        [winners1[1].id, winners1[2].id]
      ];
      for (const [a,b] of semiPairs) {
        const res = resolvePair(a,b);
        winnersSemis.push({ a, b, ...res });
        debugLog.push(`Semi ${labelPairBySeed(a,b)} -> ${rosterToSeed[res.winnerId] || res.winnerId} (${res.method === 'matchup' ? 'matchup' : res.method})`);
      }
    }

    // final
    if (winnersSemis.length >= 2) {
      const f = resolvePair(winnersSemis[0].winnerId, winnersSemis[1].winnerId);
      winnersFinal = { a: winnersSemis[0].winnerId, b: winnersSemis[1].winnerId, ...f };
      debugLog.push(`Final ${labelPairBySeed(winnersFinal.a,winnersFinal.b)} -> ${rosterToSeed[winnersFinal.winnerId] || winnersFinal.winnerId} (${winnersFinal.method === 'matchup' ? 'matchup' : winnersFinal.method})`);
      // 3rd place: losers of semis play
      const thirdRes = resolvePair(winnersSemis[0].loserId, winnersSemis[1].loserId);
      winnersThird = { a: winnersSemis[0].loserId, b: winnersSemis[1].loserId, ...thirdRes };
      debugLog.push(`3rd ${labelPairBySeed(winnersThird.a,winnersThird.b)} -> ${rosterToSeed[winnersThird.winnerId] || winnersThird.winnerId} (${winnersThird.method === 'matchup' ? 'matchup' : winnersThird.method})`);
    }
    // consolation among losers of quarterfinals:
    // losers from quarterfinals: produce consolation semis & 5th/7th placements
    const qLosers = winnersRound1.map(r => ({ id: r.loserId, seed: rosterToSeed[r.loserId] || 999 }));
    qLosers.sort((x,y) => x.seed - y.seed); // ascending seed
    if (qLosers.length >= 4) {
      // highest vs lowest and middle two
      const consPairs = [
        [qLosers[0].id, qLosers[qLosers.length - 1].id],
        [qLosers[1].id, qLosers[2].id]
      ];
      // winners of consPairs play for 5th, losers for 7th
      const consWinners = [];
      const consLosers = [];
      for (const [a,b] of consPairs) {
        const r = resolvePair(a,b);
        debugLog.push(`Consolation R1 ${labelPairBySeed(a,b)} -> ${rosterToSeed[r.winnerId] || r.winnerId} (${r.method === 'matchup' ? 'matchup' : r.method})`);
        consWinners.push(r.winnerId);
        consLosers.push(r.loserId);
      }
      if (consWinners.length === 2) {
        const r5 = resolvePair(consWinners[0], consWinners[1]);
        debugLog.push(`5th ${labelPairBySeed(consWinners[0],consWinners[1])} -> ${rosterToSeed[r5.winnerId] || r5.winnerId} (${r5.method === 'matchup' ? 'matchup' : r5.method})`);
        assignPlace(r5.winnerId, 5, null);
        assignPlace(r5.loserId, 6, null);
      }
      if (consLosers.length === 2) {
        const r7 = resolvePair(consLosers[0], consLosers[1]);
        debugLog.push(`7th ${labelPairBySeed(consLosers[0],consLosers[1])} -> ${rosterToSeed[r7.winnerId] || r7.winnerId} (${r7.method === 'matchup' ? 'matchup' : r7.method})`);
        assignPlace(r7.winnerId, 7, null);
        assignPlace(r7.loserId, 8, null);
      }
    }

    // assign top 4 places from winners bracket results
    if (winnersFinal) {
      assignPlace(winnersFinal.winnerId, 1, null);
      assignPlace(winnersFinal.loserId, 2, null);
    }
    if (winnersThird) {
      assignPlace(winnersThird.winnerId, 3, null);
      assignPlace(winnersThird.loserId, 4, null);
    }

  } else if (winnersSize === 6) {
    // 2022 style: seeds 1 & 2 get semis bye; 3v6,4v5 play quarterfinals.
    // Quarterfinals
    const qPairs = [];
    if (seedToRoster[3] && seedToRoster[6]) qPairs.push([seedToRoster[3], seedToRoster[6]]);
    if (seedToRoster[4] && seedToRoster[5]) qPairs.push([seedToRoster[4], seedToRoster[5]]);
    const qResults = [];
    for (const [a,b] of qPairs) {
      const r = resolvePair(a,b);
      qResults.push(r);
      debugLog.push(`W1 ${labelPairBySeed(a,b)} -> ${rosterToSeed[r.winnerId] || r.winnerId} (${r.method === 'matchup' ? 'matchup' : r.method})`);
    }
    // Semis: 1 plays winner of 4v5, 2 plays winner of 3v6 (this matches user's 2022 desired sequence)
    const semiPairs = [];
    if (seedToRoster[1]) {
      const winner45 = (qResults.find(rr => rosterToSeed[rr.winnerId] === 4 || rosterToSeed[rr.winnerId] === 5) || {}).winnerId;
      if (winner45) semiPairs.push([seedToRoster[1], winner45]);
    }
    if (seedToRoster[2]) {
      const winner36 = (qResults.find(rr => rosterToSeed[rr.winnerId] === 3 || rosterToSeed[rr.winnerId] === 6) || {}).winnerId;
      if (winner36) semiPairs.push([seedToRoster[2], winner36]);
    }
    const semiRes = [];
    for (const [a,b] of semiPairs) {
      if (!a || !b) continue;
      const r = resolvePair(a,b);
      semiRes.push(r);
      debugLog.push(`Semi ${labelPairBySeed(a,b)} -> ${rosterToSeed[r.winnerId] || r.winnerId} (${r.method === 'matchup' ? 'matchup' : r.method})`);
    }
    // Final: winners of semis
    if (semiRes.length === 2) {
      const f = resolvePair(semiRes[0].winnerId, semiRes[1].winnerId);
      winnersFinal = { a: semiRes[0].winnerId, b: semiRes[1].winnerId, ...f };
      debugLog.push(`Final ${labelPairBySeed(winnersFinal.a,winnersFinal.b)} -> ${rosterToSeed[winnersFinal.winnerId] || winnersFinal.winnerId} (${winnersFinal.method === 'matchup' ? 'matchup' : winnersFinal.method})`);
      // 3rd place: losers of semis
      const thirdRes = resolvePair(semiRes[0].loserId, semiRes[1].loserId);
      winnersThird = { a: semiRes[0].loserId, b: semiRes[1].loserId, ...thirdRes };
      debugLog.push(`3rd ${labelPairBySeed(winnersThird.a,winnersThird.b)} -> ${rosterToSeed[winnersThird.winnerId] || winnersThird.winnerId} (${winnersThird.method === 'matchup' ? 'matchup' : winnersThird.method})`);
    }

    // Consolation for quarterfinal losers:
    // Quarter losers are seeds among {3,4,5,6} who lost qPairs
    const qLosers = qResults.map(r => r.loserId);
    if (qLosers.length === 2) {
      const rCon1 = resolvePair(qLosers[0], qLosers[1]);
      debugLog.push(`Consolation R1 ${labelPairBySeed(qLosers[0], qLosers[1])} -> ${rosterToSeed[rCon1.winnerId] || rCon1.winnerId} (${rCon1.method === 'matchup' ? 'matchup' : rCon1.method})`);
      // Winner plays for 5th (vs someone from losers bracket? but per your described flow, winner gets 5th, loser gets 6th)
      assignPlace(rCon1.winnerId, 5, null);
      assignPlace(rCon1.loserId, 6, null);
    }

    // assign top 4 places
    if (winnersFinal) {
      assignPlace(winnersFinal.winnerId, 1, null);
      assignPlace(winnersFinal.loserId, 2, null);
    }
    if (winnersThird) {
      assignPlace(winnersThird.winnerId, 3, null);
      assignPlace(winnersThird.loserId, 4, null);
    }
  }

  // --- Losers bracket / lower race simulation ---
  // General approach: pair remaining seeds per your described rules:
  // For non-2022 (winnersSize=8): losers are seeds 9..14 (and 13/14 may have BYE), initial LRace pairs are 9v12 and 10v11, with 13 & 14 maybe bye.
  // For 2022 we use the explicit mapping you provided.
  function simulateLosersRace() {
    const lr = []; // record steps
    let lWinners = []; // winners of LRace round
    let lLosers = [];  // losers -> will become part of LRaceSemi
    if (seasonKey === '2022') {
      // per your requested 2022 mapping:
      // initial LRace pairs: 9v12, 10v11, 7v14, 8v13
      const pairs = [];
      if (seedToRoster[9] && seedToRoster[12]) pairs.push([seedToRoster[9], seedToRoster[12]]);
      if (seedToRoster[10] && seedToRoster[11]) pairs.push([seedToRoster[10], seedToRoster[11]]);
      if (seedToRoster[7] && seedToRoster[14]) pairs.push([seedToRoster[7], seedToRoster[14]]);
      if (seedToRoster[8] && seedToRoster[13]) pairs.push([seedToRoster[8], seedToRoster[13]]);
      for (const [a,b] of pairs) {
        const r = resolvePair(a,b);
        lWinners.push(r.winnerId);
        lLosers.push(r.loserId);
        debugLog.push(`LRace ${labelPairBySeed(a,b)} -> ${rosterToSeed[r.winnerId] || r.winnerId} (${r.method === 'matchup' ? 'matchup' : r.method})`);
      }
      // Consolation LRace1: pairs among (7..14) losers winners? you provided explicit mapping:
      // Consolation LRace1 7v10 -> 10 (matchup)
      // Consolation LRace1 8v9 -> 9 (matchup)
      // The rest become LRaceSemi / 7th/9th/11th/13th matches...
      // We'll attempt to replicate the sequence:
      // The losers/winners above will step through LRaceSemi (winners of LRace advance to play other winners)
      // If any LRaceSemi missing we fallback.
      // We'll do two LRaceSemi matches pairing winners appropriately:
      if (lWinners.length >= 4) {
        const semiPairs = [
          [lWinners[0], lWinners[1]],
          [lWinners[2], lWinners[3]]
        ];
        const semiRes = [];
        for (const [a,b] of semiPairs) {
          const r = resolvePair(a,b);
          semiRes.push(r);
          debugLog.push(`LRaceSemi ${labelPairBySeed(a,b)} -> ${rosterToSeed[r.winnerId] || r.winnerId} (${r.method === 'matchup' ? 'matchup' : r.method})`);
        }
        // winners of semiRes play for 9th, losers play for 11th/13th depending
        if (semiRes.length >= 2) {
          const r9 = resolvePair(semiRes[0].winnerId, semiRes[1].winnerId);
          debugLog.push(`9th ${labelPairBySeed(semiRes[0].winnerId,semiRes[1].winnerId)} -> ${rosterToSeed[r9.winnerId] || r9.winnerId} (${r9.method === 'matchup' ? 'matchup' : r9.method})`);
          assignPlace(r9.winnerId, 9, null);
          assignPlace(r9.loserId, 10, null);
          // losers of semis:
          const r11 = resolvePair(semiRes[0].loserId, semiRes[1].loserId);
          debugLog.push(`11th ${labelPairBySeed(semiRes[0].loserId,semiRes[1].loserId)} -> ${rosterToSeed[r11.winnerId] || r11.winnerId} (${r11.method === 'matchup' ? 'matchup' : r11.method})`);
          assignPlace(r11.winnerId, 11, null);
          assignPlace(r11.loserId, 12, null);
        }
      } else {
        // fallback: assign based on LRace winners and seeds
        lWinners.forEach((id, idx) => {
          const place = 9 + idx;
          assignPlace(id, place, `LRace-fallback assigned ${place}`);
        });
      }
    } else {
      // general non-2022 flow:
      // initial LRace pairs: 9v12, 10v11; 13/14 may have byes
      const pairA = seedToRoster[9] && seedToRoster[12] ? [seedToRoster[9], seedToRoster[12]] : null;
      const pairB = seedToRoster[10] && seedToRoster[11] ? [seedToRoster[10], seedToRoster[11]] : null;
      if (pairA) {
        const r = resolvePair(pairA[0], pairA[1]);
        lWinners.push(r.winnerId);
        lLosers.push(r.loserId);
        debugLog.push(`LRace ${labelPairBySeed(pairA[0],pairA[1])} -> ${rosterToSeed[r.winnerId] || r.winnerId} (${r.method === 'matchup' ? 'matchup' : r.method})`);
      }
      if (pairB) {
        const r = resolvePair(pairB[0], pairB[1]);
        lWinners.push(r.winnerId);
        lLosers.push(r.loserId);
        debugLog.push(`LRace ${labelPairBySeed(pairB[0],pairB[1])} -> ${rosterToSeed[r.winnerId] || r.winnerId} (${r.method === 'matchup' ? 'matchup' : r.method})`);
      }
      // If 13/14 exist they may play or be BYE; we will then do a LRace semi (winners play one another) and final placement.
      if (lWinners.length >= 2) {
        const r9 = resolvePair(lWinners[0], lWinners[1]);
        debugLog.push(`9th ${labelPairBySeed(lWinners[0],lWinners[1])} -> ${rosterToSeed[r9.winnerId] || r9.winnerId} (${r9.method === 'matchup' ? 'matchup' : r9.method})`);
        assignPlace(r9.winnerId, 9, null);
        assignPlace(r9.loserId, 10, null);
      } else {
        // fallback assign
        lWinners.forEach((id, idx) => assignPlace(id, 9 + idx, null));
      }
      // place remaining 11/12 from lLosers or by seed
      if (lLosers.length >= 2) {
        const r11 = resolvePair(lLosers[0], lLosers[1]);
        debugLog.push(`11th ${labelPairBySeed(lLosers[0],lLosers[1])} -> ${rosterToSeed[r11.winnerId] || r11.winnerId} (${r11.method === 'matchup' ? 'matchup' : r11.method})`);
        assignPlace(r11.winnerId, 11, null);
        assignPlace(r11.loserId, 12, null);
      }
    }
  }

  simulateLosersRace();

  // ensure all places 1..14 are assigned uniquely
  // build list of all rosterIds we know about (from rosterMap)
  const allRosterIds = Object.keys(rosterMap).map(k => String(k));
  // fill with remaining (unassigned) rosterIds and assign places descending from 14 downwards
  const assigned = Object.keys(placeMap).map(k => String(k));
  const unassigned = allRosterIds.filter(rid => !assigned.includes(String(rid)));
  // find missing place numbers (1..N)
  const N = Math.max(14, allRosterIds.length || 14);
  const usedPlaces = new Set(Object.values(placeMap).map(p => Number(p)));
  let nextPlace = 1;
  // produce a sorted list of free places
  const freePlaces = [];
  for (let p = 1; p <= N; p++) if (!usedPlaces.has(p)) freePlaces.push(p);
  // assign unassigned rosters to freePlaces from best to worst by regularStanding seed fallback
  // sort unassigned by their seed (best seed first)
  unassigned.sort((a,b) => {
    const sa = placementMap[a] || 999;
    const sb = placementMap[b] || 999;
    return sa - sb;
  });
  for (let i = 0; i < unassigned.length; i++) {
    const rid = unassigned[i];
    const place = freePlaces[i] || (N - i);
    placeMap[rid] = place;
  }

  // Build finalStandings array sorted by place asc (1..N)
  const finalStandings = [];
  const entries = Object.keys(placeMap).map(r => ({ rosterId: r, place: placeMap[r] }));
  entries.sort((a,b) => a.place - b.place);
  for (const e of entries) {
    const m = metaForRoster(e.rosterId);
    finalStandings.push({
      rank: e.place,
      rosterId: e.rosterId,
      name: m.name,
      avatar: m.avatar,
      seed: m.seed
    });
  }

  // push debugLog summary to messages so page shows it
  if (debugLog && debugLog.length) {
    for (const d of debugLog) messages.push(d);
  }

  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    matchupsRows,
    regularStandings,
    finalStandings,
    debugLog,
    messages,
    prevChain
  };
}
