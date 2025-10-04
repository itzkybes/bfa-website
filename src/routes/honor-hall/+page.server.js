// src/routes/honor-hall/+page.server.js
// Honor Hall loader: fetch playoff matchups and compute placements by scrubbing regular-season matchups,
// then simulate the playoff bracket to produce a definitive finalStandings (1..N).

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
    if (r === 'W') { curW += 1; curL = 0; if (curW > maxW) maxW = curW; }
    else if (r === 'L') { curL += 1; curW = 0; if (curL > maxL) maxL = curL; }
    else { curW = 0; curL = 0; }
  }
  return { maxW, maxL };
}

// fallback mapping for seasons -> champion owner username (only if detection fails)
const HARDCODED_CHAMPIONS = {
  '2022': 'riguy506',
  '2023': 'armyjunior',
  '2024': 'riguy506'
};

export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const incomingSeasonParam = url.searchParams.get('season') || null;

  const messages = [];
  const prevChain = [];

  // build seasons chain
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); }
    catch (e) { messages.push('Failed fetching base league ' + BASE_LEAGUE_ID + ' — ' + (e?.message ?? String(e))); }

    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id || BASE_LEAGUE_ID), season: mainLeague.season ?? null, name: mainLeague.name ?? null });
      prevChain.push(String(mainLeague.league_id || BASE_LEAGUE_ID));
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) { messages.push('Could not fetch league for previous_league_id ' + currPrev); break; }
          seasons.push({ league_id: String(prevLeague.league_id || currPrev), season: prevLeague.season ?? null, name: prevLeague.name ?? null });
          prevChain.push(String(prevLeague.league_id || currPrev));
          currPrev = prevLeague.previous_league_id ? String(prevLeague.previous_league_id) : null;
        } catch (err) { messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err?.message ?? String(err))); break; }
      }
    }
  } catch (err) {
    messages.push('Error while building seasons chain: ' + (err?.message ?? String(err)));
  }

  // dedupe + sort seasons
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  seasons = Object.values(byId);
  seasons.sort((a,b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  // determine selected season/league
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else selectedSeasonParam = String(BASE_LEAGUE_ID);
  }

  let selectedLeagueId = null;
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selectedSeasonParam || BASE_LEAGUE_ID);

  // fetch league meta (playoff weeks)
  let leagueMeta = null;
  try { leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }); }
  catch (e) { leagueMeta = null; messages.push('Failed fetching league meta for ' + selectedLeagueId + ' — ' + (e?.message ?? e)); }

  let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : null;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
    playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      playoffStart = 15;
      messages.push('Playoff start not found — defaulting to week ' + playoffStart);
    }
  }
  const playoffEnd = playoffStart + 2;

  // roster map
  let rosterMap = {};
  try { rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 }); messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')'); }
  catch (e) { rosterMap = {}; messages.push('Failed fetching rosters for ' + selectedLeagueId + ' — ' + (e?.message ?? e)); }

  // build username->roster map
  const usernameToRoster = {};
  for (const rk in rosterMap) {
    if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
    const meta = rosterMap[rk] || {};
    if (meta.user_raw && meta.user_raw.username) usernameToRoster[String(meta.user_raw.username).toLowerCase()] = String(rk);
    if (meta.owner_username) usernameToRoster[String(meta.owner_username).toLowerCase()] = String(rk);
  }

  // ---------- compute regular season standings by scrubbing weeks 1..playoffStart-1 ----------
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
    try { matchups = await sleeper.getMatchupsForWeek(selectedLeagueId, week, { ttl: 60 * 5 }); }
    catch (errWeek) { messages.push('Error fetching matchups for week ' + week + ' — ' + (errWeek?.message ?? String(errWeek))); continue; }
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
        if (opponents.length) oppAvg = opponents.reduce((acc,o)=>acc+o.points,0)/opponents.length;
        paByRosterRegular[part.rosterId] = (paByRosterRegular[part.rosterId] || 0) + oppAvg;
        if (part.points > oppAvg + 1e-9) { resultsByRosterRegular[part.rosterId].push('W'); statsByRosterRegular[part.rosterId].wins += 1; }
        else if (part.points < oppAvg - 1e-9) { resultsByRosterRegular[part.rosterId].push('L'); statsByRosterRegular[part.rosterId].losses += 1; }
        else { resultsByRosterRegular[part.rosterId].push('T'); statsByRosterRegular[part.rosterId].ties += 1; }
      }
    }
  }

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

  // placement map roster -> seed (1-based)
  const placementMap = {};
  for (let i = 0; i < regularStandings.length; i++) placementMap[String(regularStandings[i].rosterId)] = i + 1;

  // ---------- fetch playoff matchups (playoffStart..playoffEnd) and build matchupsRows ----------
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

  // group by matchup id+week
  const byMatch = {};
  for (let i = 0; i < rawMatchups.length; i++) {
    const e = rawMatchups[i];
    const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
    const wk = e.week ?? e.w ?? null;
    const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + i));
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  // build matchupsRows (pairs or combined)
  const matchupsRows = [];
  const keysMatch = Object.keys(byMatch);
  for (let ki = 0; ki < keysMatch.length; ki++) {
    const entries = byMatch[keysMatch[ki]];
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
        matchup_id: keysMatch[ki],
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
        matchup_id: keysMatch[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement },
        teamB: { rosterId: bId, name: bName, avatar: bAvatar, points: bPts, placement: bPlacement },
        participantsCount: 2
      });
      continue;
    }

    // multi participant
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
      matchup_id: keysMatch[ki],
      season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
      week: entries[0].week ?? entries[0].w ?? null,
      combinedParticipants: participants,
      combinedLabel,
      participantsCount: participants.length
    });
  }

  // build result map keyed by sorted roster ids ("a|b") -> { winner, loser, aPts, bPts, week }
  const resultMap = {};
  for (const row of matchupsRows) {
    if (!row.participantsCount || row.participantsCount !== 2) continue;
    const a = row.teamA, b = row.teamB;
    if (!a || !b || !a.rosterId || !b.rosterId) continue;
    const ra = String(a.rosterId), rb = String(b.rosterId);
    const key = ra < rb ? `${ra}|${rb}` : `${rb}|${ra}`;
    const aPts = safeNum(a.points ?? 0), bPts = safeNum(b.points ?? 0);
    let winner = null, loser = null;
    if (aPts >= bPts) { winner = ra; loser = rb; } else { winner = rb; loser = ra; }
    resultMap[key] = { winner, loser, aPts, bPts, week: row.week };
  }

  // helper to get seed -> roster and roster -> seed
  const seedToRoster = {};
  const rosterToSeed = {};
  // we want seeds 1..N from placementMap; ensure we map all rosters present
  for (const rk in rosterMap) {
    const seed = placementMap[String(rk)] ?? null;
    if (seed != null) { seedToRoster[seed] = String(rk); rosterToSeed[String(rk)] = seed; }
  }

  // helper to lookup a result between two roster ids or fallback decision
  function findResult(aId, bId) {
    if (!aId || !bId) return null;
    const ra = String(aId), rb = String(bId);
    const key = ra < rb ? `${ra}|${rb}` : `${rb}|${ra}`;
    if (resultMap[key]) return { winner: resultMap[key].winner, loser: resultMap[key].loser, method: 'matchup' };

    // fallback: check if they ever appeared in any combinedParticipants entries as multi; try to find any row where both exist
    for (const r of matchupsRows) {
      if (!r.participantsCount || r.participantsCount < 2) continue;
      // combined participants
      if (r.combinedParticipants) {
        const ids = r.combinedParticipants.map(p => String(p.rosterId));
        if (ids.includes(String(ra)) && ids.includes(String(rb))) {
          // pick higher points from participants array
          const pa = r.combinedParticipants.find(p => String(p.rosterId) === String(ra));
          const pb = r.combinedParticipants.find(p => String(p.rosterId) === String(rb));
          if (pa && pb) {
            if (pa.points >= pb.points) return { winner: ra, loser: rb, method: 'matchup-multi' };
            else return { winner: rb, loser: ra, method: 'matchup-multi' };
          }
        }
      } else if (r.teamA && r.teamB && ((String(r.teamA.rosterId) === ra && String(r.teamB.rosterId) === rb) || (String(r.teamA.rosterId) === rb && String(r.teamB.rosterId) === ra))) {
        // already handled by resultMap loop, but keep parity
        const aPts = safeNum(r.teamA.points ?? 0), bPts = safeNum(r.teamB.points ?? 0);
        if (aPts >= bPts) return { winner: String(r.teamA.rosterId), loser: String(r.teamB.rosterId), method: 'matchup' };
        else return { winner: String(r.teamB.rosterId), loser: String(r.teamA.rosterId), method: 'matchup' };
      }
    }

    // last-resort tie-breaker: compare regular-season wins, then pf, then seed (lower seed number wins)
    const aStats = regularStandings.find(s => String(s.rosterId) === String(ra));
    const bStats = regularStandings.find(s => String(s.rosterId) === String(rb));
    const aWins = aStats ? (aStats.wins || 0) : 0;
    const bWins = bStats ? (bStats.wins || 0) : 0;
    if (aWins !== bWins) return (aWins > bWins) ? { winner: ra, loser: rb, method: 'tiebreak-wins' } : { winner: rb, loser: ra, method: 'tiebreak-wins' };
    const aPf = aStats ? (aStats.pf || 0) : 0;
    const bPf = bStats ? (bStats.pf || 0) : 0;
    if (aPf !== bPf) return (aPf > bPf) ? { winner: ra, loser: rb, method: 'tiebreak-pf' } : { winner: rb, loser: ra, method: 'tiebreak-pf' };
    const aSeed = rosterToSeed[ra] ?? Infinity;
    const bSeed = rosterToSeed[rb] ?? Infinity;
    if (aSeed !== bSeed) return (aSeed < bSeed) ? { winner: ra, loser: rb, method: 'tiebreak-seed' } : { winner: rb, loser: ra, method: 'tiebreak-seed' };

    // if everything else fails, pick ra as winner to keep deterministic
    return { winner: ra, loser: rb, method: 'tiebreak-default' };
  }

  // ---------- bracket simulation ----------
  // Seeds: 1..14 (some seeds may be missing if rosterMap incomplete)
  const seeds = [];
  for (let s = 1; s <= 14; s++) {
    const rid = seedToRoster[s] ?? null;
    seeds.push({ seed: s, rosterId: rid });
  }

  // winners bracket: seeds 1..8
  function getRosterForSeed(s) { return seedToRoster[s] ?? null; }

  // Round 1 winners bracket: 1v8, 2v7, 3v6, 4v5
  const winnersRound1Pairs = [
    [1,8],
    [2,7],
    [3,6],
    [4,5]
  ];

  const winnersRound1 = []; // rosterIds of winners
  const losersRound1 = []; // rosterIds of losers

  for (const p of winnersRound1Pairs) {
    const aSeed = p[0], bSeed = p[1];
    const aRid = getRosterForSeed(aSeed), bRid = getRosterForSeed(bSeed);
    if (!aRid && !bRid) continue;
    if (!aRid) { winnersRound1.push(bRid); losersRound1.push(null); continue; }
    if (!bRid) { winnersRound1.push(aRid); losersRound1.push(null); continue; }
    const res = findResult(aRid, bRid);
    if (res) { winnersRound1.push(res.winner); losersRound1.push(res.loser); messages.push(`W1 ${aSeed}v${bSeed} -> ${res.winner} (${res.method})`); }
    else { winnersRound1.push(aRid); losersRound1.push(bRid); }
  }

  // Winners semifinals: highest seed plays lowest seed among winners
  function seedOf(rid) { return rosterToSeed[String(rid)] ?? Infinity; }
  const winnersForSemis = winnersRound1.slice(); // rosterIds
  winnersForSemis.sort((a,b) => seedOf(a) - seedOf(b)); // ascending seed number (1 best)
  // pair [0] vs [3], [1] vs [2] (highest vs lowest)
  const semisPairs = [];
  if (winnersForSemis.length === 4) {
    semisPairs.push([winnersForSemis[0], winnersForSemis[3]]);
    semisPairs.push([winnersForSemis[1], winnersForSemis[2]]);
  } else {
    // if number differs, pair sequentially
    for (let i = 0; i < Math.floor(winnersForSemis.length / 2); i++) semisPairs.push([winnersForSemis[i], winnersForSemis[winnersForSemis.length - 1 - i]]);
  }

  const semisWinners = [];
  const semisLosers = [];
  for (const pair of semisPairs) {
    const aRid = pair[0], bRid = pair[1];
    if (!aRid && !bRid) continue;
    if (!aRid) { semisWinners.push(bRid); semisLosers.push(null); continue; }
    if (!bRid) { semisWinners.push(aRid); semisLosers.push(null); continue; }
    const res = findResult(aRid, bRid);
    if (res) { semisWinners.push(res.winner); semisLosers.push(res.loser); messages.push(`Semi ${aRid}v${bRid} -> ${res.winner} (${res.method})`); }
    else { semisWinners.push(aRid); semisLosers.push(bRid); }
  }

  // Championship: winners of semis
  let championRosterId = null;
  let runnerUpRosterId = null;
  if (semisWinners.length >= 1) {
    const aRid = semisWinners[0], bRid = semisWinners[1] ?? null;
    if (aRid && bRid) {
      const res = findResult(aRid, bRid);
      if (res) { championRosterId = res.winner; runnerUpRosterId = res.loser; messages.push(`Final ${aRid}v${bRid} -> ${res.winner} (${res.method})`); }
      else { championRosterId = aRid; runnerUpRosterId = bRid; }
    } else if (aRid && !bRid) { championRosterId = aRid; runnerUpRosterId = null; }
  }

  // 3rd place: losers of semis play (if both present)
  let thirdPlaceRid = null;
  let fourthPlaceRid = null;
  if (semisLosers.length >= 1) {
    const aRid = semisLosers[0], bRid = semisLosers[1] ?? null;
    if (aRid && bRid) {
      const res = findResult(aRid, bRid);
      if (res) { thirdPlaceRid = res.winner; fourthPlaceRid = res.loser; messages.push(`3rd ${aRid}v${bRid} -> ${res.winner} (${res.method})`); }
      else { thirdPlaceRid = aRid; fourthPlaceRid = bRid; }
    } else if (aRid && !bRid) { thirdPlaceRid = aRid; fourthPlaceRid = null; }
  }

  // Consolation for 5th/7th: losers of winners round1 play each other
  const losersRound1Filtered = losersRound1.filter(x => x != null);
  // sort by seed and pair highest vs lowest
  losersRound1Filtered.sort((a,b) => seedOf(a) - seedOf(b));
  const consolationRoundPairs = [];
  if (losersRound1Filtered.length === 4) {
    consolationRoundPairs.push([losersRound1Filtered[0], losersRound1Filtered[3]]);
    consolationRoundPairs.push([losersRound1Filtered[1], losersRound1Filtered[2]]);
  } else {
    for (let i = 0; i < Math.floor(losersRound1Filtered.length / 2); i++) consolationRoundPairs.push([losersRound1Filtered[i], losersRound1Filtered[losersRound1Filtered.length - 1 - i]]);
  }

  const consolationWinners = [];
  const consolationLosers = [];
  for (const pair of consolationRoundPairs) {
    const aRid = pair[0], bRid = pair[1];
    if (!aRid && !bRid) continue;
    if (!aRid) { consolationWinners.push(bRid); consolationLosers.push(null); continue; }
    if (!bRid) { consolationWinners.push(aRid); consolationLosers.push(null); continue; }
    const res = findResult(aRid, bRid);
    if (res) { consolationWinners.push(res.winner); consolationLosers.push(res.loser); messages.push(`Consolation R1 ${aRid}v${bRid} -> ${res.winner} (${res.method})`); }
    else { consolationWinners.push(aRid); consolationLosers.push(bRid); }
  }

  // 5th place: winners of consolationWinners play each other
  let fifthRid = null;
  let sixthRid = null;
  if (consolationWinners.length >= 1) {
    const aRid = consolationWinners[0], bRid = consolationWinners[1] ?? null;
    if (aRid && bRid) {
      const res = findResult(aRid, bRid);
      if (res) { fifthRid = res.winner; sixthRid = res.loser; messages.push(`5th ${aRid}v${bRid} -> ${res.winner} (${res.method})`); }
      else { fifthRid = aRid; sixthRid = bRid; }
    } else if (aRid && !bRid) { fifthRid = aRid; sixthRid = null; }
  }

  // 7th place: losers of consolation play each other (consolationLosers)
  let seventhRid = null;
  let eighthRid = null;
  if (consolationLosers.length >= 1) {
    const aRid = consolationLosers[0], bRid = consolationLosers[1] ?? null;
    if (aRid && bRid) {
      const res = findResult(aRid, bRid);
      if (res) { seventhRid = res.winner; eighthRid = res.loser; messages.push(`7th ${aRid}v${bRid} -> ${res.winner} (${res.method})`); }
      else { seventhRid = aRid; eighthRid = bRid; }
    } else if (aRid && !bRid) { seventhRid = aRid; eighthRid = null; }
  }

  // ---------- losers bracket (9..14) ----------
  // initial pairs: 9v12, 10v11, 13 & 14 bye
  const losersPairs = [
    [9,12],
    [10,11]
  ];
  const losersWinners = [];
  const losersLosers = [];

  for (const p of losersPairs) {
    const aRid = getRosterForSeed(p[0]), bRid = getRosterForSeed(p[1]);
    if (!aRid && !bRid) continue;
    if (!aRid) { losersWinners.push(bRid); losersLosers.push(null); continue; }
    if (!bRid) { losersWinners.push(aRid); losersLosers.push(null); continue; }
    const res = findResult(aRid, bRid);
    if (res) { losersWinners.push(res.winner); losersLosers.push(res.loser); messages.push(`LRace ${p[0]}v${p[1]} -> ${res.winner} (${res.method})`); }
    else { losersWinners.push(aRid); losersLosers.push(bRid); }
  }

  // Now place 9th/10th etc:
  // if we have two winners from above, they play for 9th/10th
  let ninthRid = null, tenthRid = null;
  if (losersWinners.length >= 2) {
    const aRid = losersWinners[0], bRid = losersWinners[1];
    const res = findResult(aRid, bRid);
    if (res) { ninthRid = res.winner; tenthRid = res.loser; messages.push(`9th ${aRid}v${bRid} -> ${res.winner} (${res.method})`); }
    else { ninthRid = aRid; tenthRid = bRid; }
  } else if (losersWinners.length === 1) {
    ninthRid = losersWinners[0];
  }

  // 11th/12th: losers from initial losers pairs (losersLosers) play for 11th/12th
  let eleventhRid = null, twelfthRid = null;
  if (losersLosers.length >= 2) {
    const aRid = losersLosers[0], bRid = losersLosers[1];
    const res = findResult(aRid, bRid);
    if (res) { eleventhRid = res.winner; twelfthRid = res.loser; messages.push(`11th ${aRid}v${bRid} -> ${res.winner} (${res.method})`); }
    else { eleventhRid = aRid; twelfthRid = bRid; }
  } else if (losersLosers.length === 1) {
    eleventhRid = losersLosers[0];
  }

  // 13/14 seeds: if they had a bye, determine their internal order via any direct matchup or fallback to seed
  const seed13Rid = getRosterForSeed(13);
  const seed14Rid = getRosterForSeed(14);
  let thirteenthRid = null, fourteenthRid = null;
  if (seed13Rid && seed14Rid) {
    const res = findResult(seed13Rid, seed14Rid);
    if (res) { thirteenthRid = res.winner; fourteenthRid = res.loser; messages.push(`13th ${seed13Rid}v${seed14Rid} -> ${res.winner} (${res.method})`); }
    else { thirteenthRid = seed13Rid; fourteenthRid = seed14Rid; }
  } else if (seed13Rid && !seed14Rid) { thirteenthRid = seed13Rid; }
  else if (!seed13Rid && seed14Rid) { thirteenthRid = seed14Rid; }

  // ---------- combine everything into final order 1..14 ----------
  // We'll build a list with explicit slots when available (1..14).
  // Start with champion/runner-up/3rd/4th/5th.. then fill in remaining seeds not yet placed by reasonable defaults.

  const placed = new Set();
  const placedOrder = [];

  function pushIfUnique(rid) {
    if (!rid) return;
    const s = String(rid);
    if (!placed.has(s)) { placed.add(s); placedOrder.push(s); }
  }

  pushIfUnique(championRosterId);
  pushIfUnique(runnerUpRosterId);
  pushIfUnique(thirdPlaceRid);
  pushIfUnique(fourthPlaceRid);
  pushIfUnique(fifthRid);
  pushIfUnique(sixthRid);
  pushIfUnique(seventhRid);
  pushIfUnique(eighthRid);
  pushIfUnique(ninthRid);
  pushIfUnique(tenthRid);
  pushIfUnique(eleventhRid);
  pushIfUnique(twelfthRid);
  pushIfUnique(thirteenthRid);
  pushIfUnique(fourteenthRid);

  // ensure every roster from seedToRoster appears once (defensive)
  for (let s = 1; s <= 14; s++) {
    const rid = getRosterForSeed(s);
    if (rid) pushIfUnique(rid);
  }

  // finally, any roster present in rosterMap but not placed — append sorted by seed -> name fallback
  for (const rk in rosterMap) {
    pushIfUnique(String(rk));
  }

  // produce finalStandings array with unique ranks 1..N
  const finalStandings = [];
  for (let i = 0; i < placedOrder.length; i++) {
    const rid = placedOrder[i];
    const meta = rosterMap[rid] || {};
    finalStandings.push({
      rosterId: rid,
      team_name: meta.team_name || meta.owner_name || ('Roster ' + rid),
      avatar: meta.team_avatar || meta.owner_avatar || null,
      seed: placementMap[String(rid)] ?? null,
      finalRank: i + 1
    });
  }

  // champion/biggest loser
  if (!championRosterId && finalStandings.length) championRosterId = finalStandings[0].rosterId;
  let biggestLoserRosterId = null;
  if (finalStandings.length) biggestLoserRosterId = finalStandings[finalStandings.length - 1].rosterId;

  // return payload
  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    matchupsRows,
    regularStandings,
    finalStandings,
    championRosterId,
    biggestLoserRosterId,
    messages,
    prevChain
  };
}
