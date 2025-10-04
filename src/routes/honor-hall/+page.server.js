// src/routes/honor-hall/+page.server.js
// Honor Hall loader: final-standings logic preserved, add MVP player metadata (name + avatar)

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

/**
 * simulateBracket: original preserved bracket simulation used to compute finalStandings.
 * Returns { finalStandings, placeMap, debugLog }.
 *
 * Important: do NOT modify this function's bracket/assignment logic if you want the exact
 * same final standings as before. The function below is restored to the original behavior.
 */
function simulateBracket({ matchupsRows, placementMap, rosterMap, regularStandings, seasonKey, playoffStart, playoffEnd }) {
  const debugLog = [];
  debugLog.push(`Loaded rosters (${Object.keys(rosterMap || {}).length})`);

  // Build seed->roster mapping from placementMap (placementMap: rosterId -> placement)
  const seedToRoster = {};
  for (const rid of Object.keys(placementMap || {})) {
    const seed = Number(placementMap[rid]);
    if (!isNaN(seed)) seedToRoster[seed] = String(rid);
  }

  // Ensure at least N=14 mapping; fill holes with rosterMap entries deterministically
  const allRosterIds = Object.keys(rosterMap || {}).map(String);
  const N = Math.max(14, allRosterIds.length || 14);
  for (let s = 1; s <= N; s++) {
    if (!seedToRoster[s]) {
      const candidate = allRosterIds.find(id => !Object.values(seedToRoster).includes(id));
      if (candidate) seedToRoster[s] = candidate;
    }
  }

  function metaFor(rid) {
    const m = (rosterMap && rosterMap[String(rid)]) ? rosterMap[String(rid)] : {};
    return {
      rosterId: String(rid),
      team_name: m.team_name || m.owner_name || ('Roster ' + String(rid)),
      avatar: m.team_avatar || m.owner_avatar || null,
      seed: (placementMap && placementMap[String(rid)]) ? Number(placementMap[String(rid)]) : null,
      owner_name: m.owner_name || null
    };
  }

  // locate an actual matchup result (uses matchupsRows entries). returns object or null
  function findMatchupResult(aRid, bRid) {
    aRid = String(aRid); bRid = String(bRid);
    for (const r of (matchupsRows || [])) {
      if (r.participantsCount === 2) {
        const a = String(r.teamA?.rosterId ?? '');
        const b = String(r.teamB?.rosterId ?? '');
        if ((a === aRid && b === bRid) || (a === bRid && b === aRid)) {
          const aPts = Number(r.teamA?.points ?? 0);
          const bPts = Number(r.teamB?.points ?? 0);
          if (!isNaN(aPts) && !isNaN(bPts) && Math.abs(aPts - bPts) > 1e-9) {
            if (aPts > bPts) return { winnerRosterId: a, loserRosterId: b, kind: 'matchup' };
            return { winnerRosterId: b, loserRosterId: a, kind: 'matchup' };
          }
          return null;
        }
      }
    }
    return null;
  }

  // build PF map from regularStandings for tiebreaks
  const pfMap = {};
  if (Array.isArray(regularStandings)) {
    for (const r of regularStandings) {
      pfMap[String(r.rosterId)] = Number(r.pf ?? 0);
    }
  }

  function decideWinnerFallback(aRid, bRid) {
    aRid = String(aRid); bRid = String(bRid);
    const aPf = pfMap[aRid] ?? 0;
    const bPf = pfMap[bRid] ?? 0;
    if (Math.abs(aPf - bPf) > 1e-9) return aPf > bPf ? aRid : bRid;
    const aSeed = Number(placementMap && placementMap[aRid] ? placementMap[aRid] : 999);
    const bSeed = Number(placementMap && placementMap[bRid] ? placementMap[bRid] : 999);
    if (aSeed !== bSeed) return aSeed < bSeed ? aRid : bRid;
    return aRid < bRid ? aRid : bRid;
  }

  function resolveMatch(aSeed, bSeed, label) {
    const aRid = seedToRoster[aSeed];
    const bRid = seedToRoster[bSeed];
    if (!aRid || !bRid) {
      debugLog.push(`${label} ${aSeed}v${bSeed} -> fallback-missing`);
      return { winner: aRid || bRid || null, loser: aRid && bRid ? (aRid === (aRid||bRid) ? bRid : aRid) : null, method: 'missing' };
    }
    const m = findMatchupResult(aRid, bRid);
    if (m) {
      const winSeed = (m.winnerRosterId === aRid) ? aSeed : bSeed;
      debugLog.push(`${label} ${aSeed}v${bSeed} -> ${winSeed} (matchup)`);
      return { winner: m.winnerRosterId, loser: m.loserRosterId, method: 'matchup' };
    }
    const winRid = decideWinnerFallback(aRid, bRid);
    const method = (pfMap[aRid] || pfMap[bRid]) ? 'tiebreak-pf' : 'tiebreak-seed';
    const winSeed = (winRid === aRid) ? aSeed : bSeed;
    debugLog.push(`${label} ${aSeed}v${bSeed} -> ${winSeed} (${method})`);
    return { winner: winRid, loser: (winRid === aRid ? bRid : aRid), method };
  }

  const placeMap = {};
  const assigned = new Set();

  function assignPlace(rosterId, place, note = '') {
    rosterId = String(rosterId);
    if (!rosterId) return;
    let p = Number(place);
    const used = new Set(Object.values(placeMap).map(x => Number(x)));
    while (used.has(p)) p++;
    placeMap[rosterId] = p;
    assigned.add(rosterId);
    debugLog.push(`Assign place ${p} -> ${metaFor(rosterId).team_name}${note ? ' ('+note+')' : ''}`);
  }

  function seedForRoster(rid) {
    rid = String(rid);
    for (const s of Object.keys(seedToRoster)) {
      if (String(seedToRoster[s]) === rid) return Number(s);
    }
    if (placementMap && placementMap[rid]) return Number(placementMap[rid]);
    return null;
  }

  // Full original bracket logic preserved:
  if (String(seasonKey) === '2022') {
    // 2022 special-case branch (exact mapping requested)
    const r_w1_4v5 = resolveMatch(4, 5, 'W1 4v5');
    const r_w1_3v6 = resolveMatch(3, 6, 'W1 3v6');

    const semi1OpponentSeed = (r_w1_4v5.winner === seedToRoster[4]) ? 4 : 5;
    const semi2OpponentSeed = (r_w1_3v6.winner === seedToRoster[3]) ? 3 : 6;

    const r_semi1 = resolveMatch(1, semi1OpponentSeed, 'Semi 1v4');
    const r_semi2 = resolveMatch(2, semi2OpponentSeed, 'Semi 2v6');

    const finalSeedA = seedForRoster(r_semi1.winner) || 1;
    const finalSeedB = seedForRoster(r_semi2.winner) || 2;
    const r_final = resolveMatch(finalSeedA, finalSeedB, 'Final 1v2');

    const semiLoserSeedA = seedForRoster(r_semi1.loser);
    const semiLoserSeedB = seedForRoster(r_semi2.loser);
    if (semiLoserSeedA && semiLoserSeedB) {
      const r_3rd = resolveMatch(semiLoserSeedA, semiLoserSeedB, '3rd ' + semiLoserSeedA + 'v' + semiLoserSeedB);
      assignPlace(r_3rd.winner, 3, '3rd (matchup)');
      assignPlace(r_3rd.loser, 4, '4th (matchup)');
    } else {
      const loserA = r_semi1.loser, loserB = r_semi2.loser;
      const w = decideWinnerFallback(loserA, loserB);
      assignPlace(w, 3, '3rd (fallback)');
      assignPlace(w === loserA ? loserB : loserA, 4, '4th (fallback)');
    }

    assignPlace(r_final.winner, 1, 'champion (final)');
    assignPlace(r_final.loser, 2, 'runner-up (final)');

    const r_5th = resolveMatch(5, 3, '5th 5v3');
    assignPlace(r_5th.winner, 5, '5th (consolation)');
    assignPlace(r_5th.loser, 6, '6th (consolation)');

    const lr1 = resolveMatch(9, 12, 'LRace 9v12');
    const lr2 = resolveMatch(10, 11, 'LRace 10v11');
    const lr3 = resolveMatch(7, 14, 'LRace 7v14');
    const lr4 = resolveMatch(8, 13, 'LRace 8v13');

    const cl1 = resolveMatch(7, 10, 'Consolation LRace1 7v10');
    const cl2 = resolveMatch(8, 9, 'Consolation LRace1 8v9');

    const lrsemi1 = resolveMatch(11, 14, 'LRaceSemi 11v14');
    const lrsemi2 = resolveMatch(12, 13, 'LRaceSemi 12v13');

    const r7 = resolveMatch(10, 9, '7th 10v9');
    assignPlace(r7.winner, 7, '7th (matchup)');
    assignPlace(r7.loser, 8, '8th (matchup)');

    const r9 = resolveMatch(7, 8, '9th 7v8');
    assignPlace(r9.winner, 9, '9th (matchup)');
    assignPlace(r9.loser, 10, '10th (matchup)');

    const r11 = resolveMatch(11, 13, '11th 11v13');
    assignPlace(r11.winner, 11, '11th (matchup/fallback)');
    assignPlace(r11.loser, 12, '12th (matchup/fallback)');

    const r13 = resolveMatch(14, 12, '13th 14v12');
    assignPlace(r13.winner, 13, '13th (matchup)');
    assignPlace(r13.loser, 14, '14th (matchup)');
  } else {
    // default branch preserved
    const w1 = resolveMatch(1, 8, 'W1 1v8');
    const w2 = resolveMatch(2, 7, 'W1 2v7');
    const w3 = resolveMatch(3, 6, 'W1 3v6');
    const w4 = resolveMatch(4, 5, 'W1 4v5');

    const mapWinnerSeed = (r) => seedForRoster(r.winner) || null;
    const mapLoserSeed = (r) => seedForRoster(r.loser) || null;

    const winnersSeeds = [mapWinnerSeed(w1), mapWinnerSeed(w2), mapWinnerSeed(w3), mapWinnerSeed(w4)].filter(Boolean);
    const losersSeeds = [mapLoserSeed(w1), mapLoserSeed(w2), mapLoserSeed(w3), mapLoserSeed(w4)].filter(Boolean);

    winnersSeeds.sort((a,b) => a - b);
    const semiA_seedA = winnersSeeds[0];
    const semiA_seedB = winnersSeeds[winnersSeeds.length - 1];
    const semiB_seedA = winnersSeeds[1];
    const semiB_seedB = winnersSeeds[2];

    const semiA = resolveMatch(semiA_seedA, semiA_seedB, `Semi ${semiA_seedA}v${semiA_seedB}`);
    const semiB = resolveMatch(semiB_seedA, semiB_seedB, `Semi ${semiB_seedA}v${semiB_seedB}`);

    const finalSeedA = seedForRoster(semiA.winner) || semiA_seedA;
    const finalSeedB = seedForRoster(semiB.winner) || semiB_seedA;
    const finalMatch = resolveMatch(finalSeedA, finalSeedB, `Final ${finalSeedA}v${finalSeedB}`);

    const thirdSeedA = seedForRoster(semiA.loser) || semiA_seedB;
    const thirdSeedB = seedForRoster(semiB.loser) || semiB_seedB;
    const thirdMatch = resolveMatch(thirdSeedA, thirdSeedB, `3rd ${thirdSeedA}v${thirdSeedB}`);

    assignPlace(finalMatch.winner, 1, 'champion (final)');
    assignPlace(finalMatch.loser, 2, 'runner-up (final)');
    assignPlace(thirdMatch.winner, 3, '3rd (matchup)');
    assignPlace(thirdMatch.loser, 4, '4th (matchup)');

    losersSeeds.sort((a,b) => a - b);
    const c1 = resolveMatch(losersSeeds[0], losersSeeds[losersSeeds.length - 1], `Consolation R1 ${losersSeeds[0]}v${losersSeeds[losersSeeds.length - 1]}`);
    const c2 = resolveMatch(losersSeeds[1], losersSeeds[2], `Consolation R1 ${losersSeeds[1]}v${losersSeeds[2]}`);

    const c5 = resolveMatch(seedForRoster(c1.winner) || losersSeeds[0], seedForRoster(c2.winner) || losersSeeds[1], `5th ${seedForRoster(c1.winner)||''}v${seedForRoster(c2.winner)||''}`);
    assignPlace(c5.winner, 5, '5th (consolation)');
    assignPlace(c5.loser, 6, '6th (consolation)');

    const c7 = resolveMatch(seedForRoster(c1.loser) || losersSeeds[2], seedForRoster(c2.loser) || losersSeeds[3], `7th ${seedForRoster(c1.loser)||''}v${seedForRoster(c2.loser)||''}`);
    assignPlace(c7.winner, 7, '7th (consolation)');
    assignPlace(c7.loser, 8, '8th (consolation)');

    const lr1 = resolveMatch(9, 12, 'LRace 9v12');
    const lr2 = resolveMatch(10, 11, 'LRace 10v11');

    const lrsemiA = resolveMatch(seedForRoster(lr1.winner) || 9, 14, `LRaceSemi ${seedForRoster(lr1.winner)||9}v14`);
    const lrsemiB = resolveMatch(seedForRoster(lr2.winner) || 10, 13, `LRaceSemi ${seedForRoster(lr2.winner)||10}v13`);

    const match9 = resolveMatch(seedForRoster(lrsemiA.winner) || seedForRoster(lr1.winner), seedForRoster(lrsemiB.winner) || seedForRoster(lr2.winner), '9th final');
    assignPlace(match9.winner, 9, '9th (l-race)');
    assignPlace(match9.loser, 10, '10th (l-race)');

    const match11 = resolveMatch(seedForRoster(lrsemiA.loser) || seedForRoster(lr1.loser), seedForRoster(lrsemiB.loser) || seedForRoster(lr2.loser), '11th final');
    assignPlace(match11.winner, 11, '11th (l-race)');
    assignPlace(match11.loser, 12, '12th (l-race)');

    const remaining = allRosterIds.filter(id => !assigned.has(String(id)));
    remaining.sort((a,b) => (placementMap[a]||999) - (placementMap[b]||999));
    if (remaining.length >= 2) {
      const r13 = resolveMatch(placementMap[remaining[0]] || 13, placementMap[remaining[1]] || 14, '13th final');
      assignPlace(r13.winner, 13, '13th (final)');
      assignPlace(r13.loser, 14, '14th (final)');
    } else {
      for (let i = 0; i < remaining.length; i++) assignPlace(remaining[i], 13 + i, 'final fill');
    }
  }

  // Ensure all rosters get a unique place
  const usedPlaces = new Set(Object.values(placeMap).map(p => Number(p)));
  const freePlaces = [];
  for (let p = 1; p <= N; p++) if (!usedPlaces.has(p)) freePlaces.push(p);
  const stillUnassigned = Object.keys(rosterMap || {}).map(String).filter(rid => !Object.prototype.hasOwnProperty.call(placeMap, rid));
  stillUnassigned.sort((a,b) => (placementMap[a]||999) - (placementMap[b]||999));
  for (let i = 0; i < stillUnassigned.length; i++) {
    const rid = stillUnassigned[i];
    const p = freePlaces[i] || (N - i);
    placeMap[rid] = p;
    debugLog.push(`Fallback assign ${p} -> ${metaFor(rid).team_name}`);
  }

  // Now build finalStandings[] sorted ascending by place
  const finalEntries = Object.keys(placeMap).map(rid => ({ rosterId: String(rid), place: Number(placeMap[rid]) }));
  finalEntries.sort((a,b) => a.place - b.place);
  const finalStandings = finalEntries.map(e => {
    const m = metaFor(e.rosterId);
    return {
      rank: e.place,
      rosterId: e.rosterId,
      team_name: m.team_name,
      owner_name: m.owner_name || null,
      avatar: m.avatar,
      seed: placementMap && placementMap[e.rosterId] ? Number(placementMap[e.rosterId]) : null
    };
  });

  return { finalStandings, placeMap, debugLog };
}

export async function load(event) {
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

  // select season param
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = String(BASE_LEAGUE_ID);
    }
  }

  // resolve selectedLeagueId
  let selectedLeagueId = null;
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selectedSeasonParam || BASE_LEAGUE_ID);

  // fetch league meta
  let leagueMeta = null;
  try {
    leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 });
  } catch (e) {
    leagueMeta = null;
    messages.push('Failed fetching league meta for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }

  // playoff start/end
  let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : null;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
    playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      playoffStart = 15;
      messages.push('Playoff start not found in metadata — defaulting to week ' + playoffStart);
    }
  }
  const playoffEnd = playoffStart + 2;

  // roster map with owners
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
  } catch (e) {
    rosterMap = {};
    messages.push('Failed fetching rosters for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }

  // regular-season scrub (used for tiebreaks) and gather all matchups for MVPs
  const statsByRosterRegular = {};
  const resultsByRosterRegular = {};
  const paByRosterRegular = {};
  const allMatchups = [];

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

    for (const m of matchups) allMatchups.push(m);

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
          allMatchups.push(m); // include playoff entries in allMatchups for MVP logic
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
  const keysM = Object.keys(byMatch);
  for (let ki = 0; ki < keysM.length; ki++) {
    const entries = byMatch[keysM[ki]];
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
        matchup_id: keysM[ki],
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
        matchup_id: keysM[ki],
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
      matchup_id: keysM[ki],
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
    const ax = x.teamA?.placement ?? (x.combinedParticipants ? (x.combinedParticipants[0]?.placement ?? 999) : 999);
    const by = y.teamA?.placement ?? (y.combinedParticipants ? (y.combinedParticipants[0]?.placement ?? 999) : 999);
    return (ax - by);
  });

  // Now call simulateBracket to produce finalStandings/placeMap/debugLog
  const simulationResult = simulateBracket({
    matchupsRows,
    placementMap,
    rosterMap,
    regularStandings,
    seasonKey: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : selectedSeasonParam,
    playoffStart,
    playoffEnd
  });

  const finalStandings = simulationResult.finalStandings || [];
  const placeMap = simulationResult.placeMap || {};
  const debugLog = simulationResult.debugLog || [];

  // -----------------------
  // MVP computation (finalsMvp & overallMvp)
  // -----------------------
  // Helper: points for a player id in a roster entry object m
  function pointsForPlayerInEntry(m, pid) {
    if (!m || !pid) return 0;
    const candidates = m.player_points ?? m.playerPoints ?? m.players_points ?? m.playersPoints ?? null;
    if (candidates && typeof candidates === 'object' && Object.prototype.hasOwnProperty.call(candidates, pid)) {
      return safeNum(candidates[pid]);
    }
    const startersPoints = m.starters_points ?? m.startersPoints ?? null;
    if (startersPoints && typeof startersPoints === 'object' && Object.prototype.hasOwnProperty.call(startersPoints, pid)) {
      return safeNum(startersPoints[pid]);
    }
    if (Array.isArray(m.players)) {
      const found = m.players.find(p => String(p.player_id ?? p.playerId ?? p.id) === String(pid));
      if (found) return safeNum(found.points ?? found.player_points ?? found.pts ?? 0);
    }
    return 0;
  }

  // Build overall starter points map across allMatchups
  const overallStarterPoints = {}; // pid -> total starter points
  const playerRosterForPid = {}; // pid -> rosterId
  for (const m of allMatchups) {
    const rid = String(m.roster_id ?? m.rosterId ?? m.owner_id ?? m.ownerId ?? '');
    const starters = Array.isArray(m.starters) ? m.starters : (Array.isArray(m.starter) ? m.starter : []);
    if (!Array.isArray(starters)) continue;
    for (const pidRaw of starters) {
      const pid = String(pidRaw);
      const pts = pointsForPlayerInEntry(m, pid);
      overallStarterPoints[pid] = (overallStarterPoints[pid] || 0) + safeNum(pts);
      if (!playerRosterForPid[pid]) playerRosterForPid[pid] = rid;
    }
  }

  // Finals MVP: find the championship row (highest-week 2-participant matchup)
  let finalsMvp = null;
  try {
    const weeks = matchupsRows.map(r => Number(r.week || 0)).filter(n => !isNaN(n));
    const maxWeek = weeks.length ? Math.max(...weeks) : null;
    let finalMatchRow = null;
    if (maxWeek != null) {
      finalMatchRow = matchupsRows.find(r => Number(r.week) === Number(maxWeek) && r.participantsCount === 2);
    }
    if (!finalMatchRow) {
      const twoRows = matchupsRows.filter(r => r.participantsCount === 2 && r.week != null);
      if (twoRows.length) {
        twoRows.sort((a,b) => Number(b.week || 0) - Number(a.week || 0));
        finalMatchRow = twoRows[0];
      }
    }

    if (finalMatchRow) {
      const wk = Number(finalMatchRow.week || 0);
      const rA = String(finalMatchRow.teamA?.rosterId ?? '');
      const rB = String(finalMatchRow.teamB?.rosterId ?? '');

      const entries = allMatchups.filter(m => Number(m.week ?? m.w ?? 0) === wk)
        .filter(m => {
          const rid = String(m.roster_id ?? m.rosterId ?? m.owner_id ?? m.ownerId ?? '');
          return rid === rA || rid === rB;
        });

      const candidates = [];
      for (const e of entries) {
        const rid = String(e.roster_id ?? e.rosterId ?? e.owner_id ?? e.ownerId ?? '');
        const starters = Array.isArray(e.starters) ? e.starters : (Array.isArray(e.starter) ? e.starter : []);
        for (const pid of starters) {
          const pts = pointsForPlayerInEntry(e, String(pid));
          candidates.push({ playerId: String(pid), pts: safeNum(pts), rosterId: rid });
        }
      }

      if (candidates.length) {
        candidates.sort((a,b) => (b.pts - a.pts) || (a.playerId < b.playerId ? -1 : 1));
        const top = candidates[0];
        finalsMvp = {
          playerId: top.playerId,
          playerName: null,
          playerAvatar: null,
          points: Math.round(top.pts * 100) / 100,
          rosterId: top.rosterId
        };
      }
    }
  } catch (err) {
    messages.push('Finals MVP error: ' + (err?.message ?? String(err)));
    finalsMvp = null;
  }

  // Overall MVP: highest overallStarterPoints
  let overallMvp = null;
  try {
    const pids = Object.keys(overallStarterPoints);
    if (pids.length) {
      pids.sort((a,b) => {
        const pa = overallStarterPoints[a] || 0;
        const pb = overallStarterPoints[b] || 0;
        if (pb !== pa) return pb - pa;
        return a < b ? -1 : 1;
      });
      const top = pids[0];
      overallMvp = {
        playerId: top,
        playerName: null,
        playerAvatar: null,
        points: Math.round((overallStarterPoints[top] || 0) * 100) / 100,
        rosterId: playerRosterForPid[top] || null
      };
    }
  } catch (err) {
    messages.push('Overall MVP error: ' + (err?.message ?? String(err)));
    overallMvp = null;
  }

  // Resolve player metadata (names + avatars) like Records tab
  const playerIdsToResolve = new Set();
  if (finalsMvp && finalsMvp.playerId) playerIdsToResolve.add(finalsMvp.playerId);
  if (overallMvp && overallMvp.playerId) playerIdsToResolve.add(overallMvp.playerId);

  if (playerIdsToResolve.size) {
    const ids = Array.from(playerIdsToResolve);
    try {
      let playersMap = null;
      if (typeof sleeper.getPlayers === 'function') {
        // Ideally getPlayers accepts array and returns map
        playersMap = await sleeper.getPlayers(ids, { ttl: 60 * 60 });
      } else if (typeof sleeper.getPlayer === 'function') {
        playersMap = {};
        for (const id of ids) {
          try {
            playersMap[id] = await sleeper.getPlayer(id, { ttl: 60 * 60 });
          } catch (e) {
            playersMap[id] = null;
          }
        }
      }
      if (playersMap) {
        function resolveNameAvatar(p) {
          if (!p) return { name: null, avatar: null };
          const name = p.full_name ?? p.fullName ?? p.player_name ?? p.name ?? ((p.first_name && p.last_name) ? `${p.first_name} ${p.last_name}` : null);
          const avatar = p.avatar ?? p.image ?? p.photo ?? p.headshot ?? p.headshot_url ?? p.photo_url ?? p.img ?? null;
          return { name, avatar };
        }
        if (finalsMvp && finalsMvp.playerId && playersMap[finalsMvp.playerId]) {
          const r = resolveNameAvatar(playersMap[finalsMvp.playerId]);
          finalsMvp.playerName = r.name;
          finalsMvp.playerAvatar = r.avatar;
        }
        if (overallMvp && overallMvp.playerId && playersMap[overallMvp.playerId]) {
          const r = resolveNameAvatar(playersMap[overallMvp.playerId]);
          overallMvp.playerName = r.name;
          overallMvp.playerAvatar = r.avatar;
        }
      }
    } catch (err) {
      messages.push('Could not resolve MVP player metadata: ' + (err?.message ?? String(err)));
    }
  }

  // for convenience pick champion & biggestLoser for UI (do not alter finalStandings)
  const champion = finalStandings[0] ?? null;
  const biggestLoser = finalStandings[finalStandings.length - 1] ?? null;

  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    matchupsRows,
    regularStandings,
    finalStandings,
    placeMap,
    debugLog,
    finalsMvp,
    overallMvp,
    champion,
    biggestLoser,
    messages,
    prevChain
  };
}
