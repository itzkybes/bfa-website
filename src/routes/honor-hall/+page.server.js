// src/routes/honor-hall/+page.server.js
// Honor Hall loader + bracket simulation (JSON-first loading for season_matchups, with player-level MVP computation when JSON present)

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

export async function load(event) {
  // caching header for outer CDN
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const incomingSeasonParam = url.searchParams.get('season') || null;

  const messages = [];
  const prevChain = [];

  // --- build seasons chain ---
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

  // dedupe seasons by league_id
  const byId = {};
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);

  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  // choose selected season param (defaults to latest season in chain)
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = String(BASE_LEAGUE_ID);
    }
  }

  // map selectedSeason to league id
  let selectedLeagueId = null;
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selectedSeasonParam || BASE_LEAGUE_ID);

  // fetch league meta (used to find playoff week start default)
  let leagueMeta = null;
  try { leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }); }
  catch (e) { leagueMeta = null; messages.push('Failed fetching league meta for ' + selectedLeagueId + ' — ' + (e?.message ?? e)); }

  // default playoff start detection
  let playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : null;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
    playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      playoffStart = 15;
      messages.push('Playoff start not found in metadata — defaulting to week ' + playoffStart);
    }
  }
  // playoffEnd will be adjusted later if JSON indicates different playoff span, otherwise assume +2
  let playoffEnd = playoffStart + 2;

  // roster map
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
  } catch (e) {
    rosterMap = {};
    messages.push('Failed fetching rosters for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }

  // --- compute regular-season standings (for tiebreaks) ---
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

  // If JSON is present we will build matchups from JSON and also use player-level data from JSON.
  // Attempt to load season_matchups JSON first (try selectedSeasonParam as year, and fallback to leagueMeta.season)
  let seasonJson = null;
  let seasonJsonKeyTried = [];
  const tryKeys = [];
  if (selectedSeasonParam) tryKeys.push(String(selectedSeasonParam));
  if (leagueMeta && leagueMeta.season != null) tryKeys.push(String(leagueMeta.season));
  // ensure unique
  const uniq = [...new Set(tryKeys)];
  for (const k of uniq) {
    try {
      seasonJsonKeyTried.push(`/season_matchups/${k}.json`);
      const res = await event.fetch(`/season_matchups/${k}.json`);
      if (res && res.ok) {
        seasonJson = await res.json();
        messages.push(`Loaded season JSON: ${k}`);
        // if JSON contains playoff_week_start override server detected value
        if (seasonJson && typeof seasonJson.playoff_week_start !== 'undefined') {
          const pj = Number(seasonJson.playoff_week_start);
          if (!isNaN(pj) && pj >= 1) {
            playoffStart = pj;
            messages.push(`Processed season JSON ${k} (playoff_week_start=${playoffStart})`);
            playoffEnd = playoffStart + 2;
          }
        }
        break;
      }
    } catch (e) {
      // ignore fetch fail - continue trying other keys
    }
  }

  // helper to ingest matchups either from JSON or from API (we'll produce normalized rawMatchups array)
  const rawMatchups = [];

  // player-level totals for overall MVP (when JSON present)
  const playerTotals = {}; // playerId -> { total: number, appearances: number }
  // player-level totals limited to championship matchup (for Finals MVP)
  const finalsPlayerTotals = {}; // playerId -> total in finals

  // If seasonJson exists, build rawMatchups from it (JSON format expected like example)
  if (seasonJson) {
    // JSON has weeks as numeric string keys (e.g. "1": [matchups...]) and may also have "playoff_week_start"
    for (const k in seasonJson) {
      if (!Object.prototype.hasOwnProperty.call(seasonJson, k)) continue;
      if (k === 'playoff_week_start') continue;
      // only numeric keys are weeks
      const weekNum = Number(k);
      if (isNaN(weekNum)) continue;
      const arr = Array.isArray(seasonJson[k]) ? seasonJson[k] : [];
      for (const m of arr) {
        // normalize each matchup into two team entries (similar shape to sleeper matchups per-team object)
        const wk = Number(m.week ?? weekNum);
        const mid = m.matchup_id ?? m.matchupId ?? null;

        // teamA
        if (m.teamA) {
          const teamA = m.teamA;
          const pts = safeNum(m.teamAScore ?? m.teamAScore ?? teamA.score ?? teamA.points ?? null);
          const entryA = {
            matchup_id: mid,
            week: wk,
            roster_id: String(teamA.rosterId ?? teamA.roster_id ?? teamA.ownerId ?? teamA.owner_id ?? ''),
            points: pts,
            // pass-through player-level arrays (if present)
            starters: Array.isArray(teamA.starters) ? teamA.starters : (teamA.player_ids || null),
            starters_points: Array.isArray(teamA.starters_points) ? teamA.starters_points : (teamA.player_points || null),
            team_name: teamA.name ?? teamA.teamName ?? null,
            owner_name: teamA.ownerName ?? teamA.owner_name ?? null
          };
          rawMatchups.push(entryA);

          // accumulate player totals (overall MVP)
          if (Array.isArray(entryA.starters) && Array.isArray(entryA.starters_points)) {
            for (let i = 0; i < entryA.starters.length; i++) {
              const pid = String(entryA.starters[i] ?? '');
              if (!pid || pid === '0' || pid === 'null') continue;
              const ppts = safeNum(entryA.starters_points[i] ?? 0);
              playerTotals[pid] = playerTotals[pid] || { total: 0, appearances: 0 };
              playerTotals[pid].total += ppts;
              playerTotals[pid].appearances += 1;
              // if this is in championship week, accumulate finals totals
              if (wk === playoffEnd) {
                finalsPlayerTotals[pid] = (finalsPlayerTotals[pid] || 0) + ppts;
              }
            }
          }
        }

        // teamB
        if (m.teamB) {
          const teamB = m.teamB;
          const pts = safeNum(m.teamBScore ?? m.teamBScore ?? teamB.score ?? teamB.points ?? null);
          const entryB = {
            matchup_id: mid,
            week: wk,
            roster_id: String(teamB.rosterId ?? teamB.roster_id ?? teamB.ownerId ?? teamB.owner_id ?? ''),
            points: pts,
            starters: Array.isArray(teamB.starters) ? teamB.starters : (teamB.player_ids || null),
            starters_points: Array.isArray(teamB.starters_points) ? teamB.starters_points : (teamB.player_points || null),
            team_name: teamB.name ?? teamB.teamName ?? null,
            owner_name: teamB.ownerName ?? teamB.owner_name ?? null
          };
          rawMatchups.push(entryB);

          if (Array.isArray(entryB.starters) && Array.isArray(entryB.starters_points)) {
            for (let i = 0; i < entryB.starters.length; i++) {
              const pid = String(entryB.starters[i] ?? '');
              if (!pid || pid === '0' || pid === 'null') continue;
              const ppts = safeNum(entryB.starters_points[i] ?? 0);
              playerTotals[pid] = playerTotals[pid] || { total: 0, appearances: 0 };
              playerTotals[pid].total += ppts;
              playerTotals[pid].appearances += 1;
              if (wk === playoffEnd) {
                finalsPlayerTotals[pid] = (finalsPlayerTotals[pid] || 0) + ppts;
              }
            }
          }
        }
      }
    }

    // if JSON gives an explicit playoff span (like playoff weeks present), compute playoffEnd as max playoff week found
    try {
      // find max week present that is >= playoffStart
      const weeksSeen = new Set();
      for (const e of rawMatchups) if (typeof e.week !== 'undefined' && Number(e.week) >= playoffStart) weeksSeen.add(Number(e.week));
      if (weeksSeen.size) {
        const arr = Array.from(weeksSeen).sort((a,b)=>a-b);
        playoffEnd = arr[arr.length-1];
      }
    } catch (e) {
      // ignore
    }

  } else {
    // no JSON found — fall back to fetching matchups from Sleeper API for playoff weeks only.
    for (let wk = playoffStart; wk <= playoffEnd; wk++) {
      try {
        const wkMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, wk, { ttl: 60 * 5 });
        if (Array.isArray(wkMatchups) && wkMatchups.length) {
          for (const m of wkMatchups) {
            if (m && (m.week == null && m.w == null)) m.week = wk;
            // push entries (Sleeper returns in a format we already handle later - push whole objects)
            rawMatchups.push(m);
          }
        }
      } catch (we) {
        messages.push('Failed to fetch matchups for week ' + wk + ': ' + (we?.message ?? String(we)));
      }
    }
  }

  // --- normalize rawMatchups into matchupsRows (group by matchup_id + week) ---
  const byMatch = {};
  for (let i = 0; i < rawMatchups.length; i++) {
    const e = rawMatchups[i];
    // For rows coming from JSON we created 'roster_id' and 'points' and 'week' etc.
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
      const aName = a.team_name || aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const aPlacement = (placementMap && placementMap[aId]) ? placementMap[aId] : null;
      matchupsRows.push({
        matchup_id: mkeys[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement, starters: a.starters ?? null, starters_points: a.starters_points ?? null },
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
      const aPlacement = (placementMap && placementMap[aId]) ? placementMap[aId] : null;
      const bPlacement = (placementMap && placementMap[bId]) ? placementMap[bId] : null;
      matchupsRows.push({
        matchup_id: mkeys[ki],
        season: leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: a.team_name || aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts, placement: aPlacement, starters: a.starters ?? null, starters_points: a.starters_points ?? null },
        teamB: { rosterId: bId, name: b.team_name || bMeta.team_name || bMeta.owner_name || ('Roster ' + bId), avatar: bMeta.team_avatar || bMeta.owner_avatar || null, points: bPts, placement: bPlacement, starters: b.starters ?? null, starters_points: b.starters_points ?? null },
        participantsCount: 2
      });
      continue;
    }

    // More than two participants: keep combinedParticipants
    const participants = entries.map(ent => {
      const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
      const meta = rosterMap[pid] || {};
      return {
        rosterId: pid,
        name: ent.team_name || meta.team_name || meta.owner_name || ('Roster ' + pid),
        avatar: meta.team_avatar || meta.owner_avatar || null,
        points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0),
        placement: (placementMap && placementMap[pid]) ? placementMap[pid] : null,
        starters: ent.starters ?? null,
        starters_points: ent.starters_points ?? null
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

  // --- compute regular-season trackers if JSON included regular weeks too ---
  // If seasonJson was present we should also accumulate regular-season pf & W/L for tiebreaks using the starter totals we already collected.
  // For simplicity and stability we'll still iterate reg weeks via Sleeper API if JSON absent; if JSON present we will attempt to use JSON week entries for reg weeks.
  if (seasonJson) {
    // collect json matchups for reg weeks (1..regEnd) and accumulate pf & W/L using per-week comparisons
    const jsonWeeks = [];
    for (const k in seasonJson) {
      if (!Object.prototype.hasOwnProperty.call(seasonJson, k)) continue;
      if (k === 'playoff_week_start') continue;
      const wk = Number(k);
      if (!isNaN(wk)) jsonWeeks.push(wk);
    }
    // process each regular week
    for (let week = regStart; week <= regEnd; week++) {
      const arr = Array.isArray(seasonJson[String(week)]) ? seasonJson[String(week)] : [];
      if (!arr || !arr.length) continue;
      for (const m of arr) {
        // ensure both teamA and teamB exist
        if (!m.teamA || !m.teamB) continue;
        const aId = String(m.teamA.rosterId ?? m.teamA.roster_id ?? '');
        const bId = String(m.teamB.rosterId ?? m.teamB.roster_id ?? '');
        const aPts = safeNum(m.teamAScore ?? m.teamA.score ?? 0);
        const bPts = safeNum(m.teamBScore ?? m.teamB.score ?? 0);
        if (!statsByRosterRegular[aId]) statsByRosterRegular[aId] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
        if (!statsByRosterRegular[bId]) statsByRosterRegular[bId] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
        statsByRosterRegular[aId].pf += aPts;
        statsByRosterRegular[bId].pf += bPts;
        // head-to-head W/L/T using simple comparison vs opponent
        if (aPts > bPts + 1e-9) { statsByRosterRegular[aId].wins += 1; statsByRosterRegular[bId].losses += 1; resultsByRosterRegular[aId].push('W'); resultsByRosterRegular[bId].push('L'); }
        else if (bPts > aPts + 1e-9) { statsByRosterRegular[bId].wins += 1; statsByRosterRegular[aId].losses += 1; resultsByRosterRegular[bId].push('W'); resultsByRosterRegular[aId].push('L'); }
        else { statsByRosterRegular[aId].ties += 1; statsByRosterRegular[bId].ties += 1; resultsByRosterRegular[aId].push('T'); resultsByRosterRegular[bId].push('T'); }
      }
    }
  } else {
    // JSON absent: existing logic to compute regular-season trackers via API across reg weeks
    for (let week = regStart; week <= regEnd; week++) {
      let matchups = null;
      try {
        matchups = await sleeper.getMatchupsForWeek(selectedLeagueId, week, { ttl: 60 * 5 });
      } catch (errWeek) {
        messages.push('Error fetching matchups for league ' + selectedLeagueId + ' week ' + week + ' — ' + (errWeek && errWeek.message ? errWeek.message : String(errWeek)));
        continue;
      }
      if (!matchups || !matchups.length) continue;

      const byMatchLocal = {};
      for (let mi = 0; mi < matchups.length; mi++) {
        const e = matchups[mi];
        const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
        const wk = e.week ?? e.w ?? week;
        const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
        if (!byMatchLocal[key]) byMatchLocal[key] = [];
        byMatchLocal[key].push(e);
      }

      const keysLocal = Object.keys(byMatchLocal);
      for (let k = 0; k < keysLocal.length; k++) {
        const entries = byMatchLocal[keysLocal[k]];
        if (!entries || entries.length === 0) continue;

        if (entries.length === 1) {
          const only = entries[0];
          const ridOnly = String(only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId ?? 'unknown');
          const ptsOnly = safeNum(only.points ?? only.points_for ?? only.pts ?? 0);
          if (!statsByRosterRegular[ridOnly]) statsByRosterRegular[ridOnly] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
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
          statsByRosterRegular[pid].pf += ppts;
          if (!resultsByRosterRegular[pid]) resultsByRosterRegular[pid] = [];
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
    }
  } // end regular-season accumulation

  // helper to build final standings from trackers (same as before)
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

  // mapping placement <-> rosterId
  const placementMap = {};
  for (let i = 0; i < regularStandings.length; i++) placementMap[String(regularStandings[i].rosterId)] = i + 1;
  const placementToRoster = {};
  for (const k in placementMap) placementToRoster[ placementMap[k] ] = k;

  // --- helper functions reused from previous iteration (findMatchForPair, decideWinnerFromMatch, runMatch) ---
  function findMatchForPair(rA, rB, preferredWeeks = [playoffStart, playoffStart+1, playoffStart+2]) {
    if (!rA || !rB) return null;
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

  function decideWinnerFromMatch(matchRow, aId, bId) {
    const a = String(aId), b = String(bId);
    if (!matchRow) return null;
    let aPts = null, bPts = null;
    if (matchRow.participantsCount === 2) {
      const pA = String(matchRow.teamA.rosterId), pB = String(matchRow.teamB.rosterId);
      if (pA === a) { aPts = matchRow.teamA.points; bPts = matchRow.teamB.points; }
      else { aPts = matchRow.teamB.points; bPts = matchRow.teamA.points; }
    } else if (matchRow.combinedParticipants) {
      const pAobj = matchRow.combinedParticipants.find(p => String(p.rosterId) === a);
      const pBobj = matchRow.combinedParticipants.find(p => String(p.rosterId) === b);
      aPts = pAobj?.points ?? 0;
      bPts = pBobj?.points ?? 0;
    }

    if (aPts == null || bPts == null) return null;
    if (aPts > bPts + 1e-9) return { winner: a, loser: b, reason: 'matchup' };
    if (bPts > aPts + 1e-9) return { winner: b, loser: a, reason: 'matchup' };

    const aPF = (regularStandings.find(s => String(s.rosterId) === a)?.pf) ?? 0;
    const bPF = (regularStandings.find(s => String(s.rosterId) === b)?.pf) ?? 0;
    if (aPF > bPF) return { winner: a, loser: b, reason: 'tiebreak-pf' };
    if (bPF > aPF) return { winner: b, loser: a, reason: 'tiebreak-pf' };

    const aW = (regularStandings.find(s => String(s.rosterId) === a)?.wins) ?? 0;
    const bW = (regularStandings.find(s => String(s.rosterId) === b)?.wins) ?? 0;
    if (aW > bW) return { winner: a, loser: b, reason: 'tiebreak-wins' };
    if (bW > aW) return { winner: b, loser: a, reason: 'tiebreak-wins' };

    const aPl = placementMap[a] ?? 999;
    const bPl = placementMap[b] ?? 999;
    if (aPl < bPl) return { winner: a, loser: b, reason: 'tiebreak-placement' };
    if (bPl < aPl) return { winner: b, loser: a, reason: 'tiebreak-placement' };

    return { winner: a, loser: b, reason: 'fallback' };
  }

  const trace = [];
  trace.push(`Loaded rosters (${Object.keys(rosterMap).length})`);

  function seedToRoster(seed) {
    const rid = placementToRoster[seed] ?? null;
    const meta = rid ? rosterMap[rid] : null;
    return { rosterId: rid, name: meta?.team_name ?? meta?.owner_name ?? ('Roster ' + rid) };
  }

  // --- determine winners bracket size dynamically ---
  // per requirement:
  // - 2022: winners bracket size is 6
  // - all other seasons: winners bracket size is 8
  let winnersBracketSize = 8;
  try {
    const seasonStr = selectedSeasonParam != null ? String(selectedSeasonParam) : (leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null);
    if (seasonStr === '2022') winnersBracketSize = 6;
    else winnersBracketSize = 8;
  } catch (e) {
    winnersBracketSize = 8;
  }
  trace.push(`Winners bracket size: ${winnersBracketSize}`);

  // Build seeds using dynamic winnersBracketSize
  const winnersSeeds = [];
  const losersSeeds = [];
  for (let s = 1; s <= 14; s++) {
    const rid = placementToRoster[s] ?? null;
    if (!rid) continue;
    if (s <= winnersBracketSize) winnersSeeds.push({ seed: s, rosterId: rid });
    else losersSeeds.push({ seed: s, rosterId: rid });
  }

  function runMatch(seedA, seedB, label, preferredWeeks = [playoffStart, playoffStart+1, playoffStart+2]) {
    const a = seedA.rosterId, b = seedB.rosterId;
    const matchRow = findMatchForPair(a, b, preferredWeeks);
    const decision = decideWinnerFromMatch(matchRow, a, b);
    if (!decision) {
      const winner = Number(seedA.seed) <= Number(seedB.seed) ? seedA.rosterId : seedB.rosterId;
      const loser = winner === seedA.rosterId ? seedB.rosterId : seedA.rosterId;
      trace.push(`${label} ${seedA.seed}v${seedB.seed} -> ${ placementMap[winner] ?? winner } (fallback-no-match)`);
      return { winner, loser, row: matchRow, reason: 'fallback-no-match' };
    }
    const winner = decision.winner;
    const loser = decision.loser;
    const wSeed = placementMap[winner] ?? winner;
    trace.push(`${label} ${seedA.seed}v${seedB.seed} -> ${ wSeed } (${decision.reason})`);
    return { winner, loser, row: matchRow, reason: decision.reason };
  }

  // -------------------------
  // Winners bracket (dynamic)
  // -------------------------
  const wR1Pairs = [];
  if (winnersBracketSize === 8) {
    wR1Pairs.push([1,8],[2,7],[3,6],[4,5]);
  } else if (winnersBracketSize === 6) {
    wR1Pairs.push([3,6],[4,5]); // seeds 1 & 2 have byes
  } else {
    const ws = winnersBracketSize;
    for (let i = 1; i <= Math.floor(ws/2); i++) {
      wR1Pairs.push([i, ws - i + 1]);
    }
  }

  const wR1Results = [];
  for (const p of wR1Pairs) {
    const sA = p[0], sB = p[1];
    const aObj = { seed: sA, rosterId: placementToRoster[sA] ?? null };
    const bObj = { seed: sB, rosterId: placementToRoster[sB] ?? null };
    if (!aObj.rosterId || !bObj.rosterId) {
      trace.push(`W1 ${sA}v${sB} -> missing-roster`);
      wR1Results.push({ winner: aObj.rosterId || bObj.rosterId, loser: aObj.rosterId ? bObj.rosterId : aObj.rosterId, reason: 'missing-roster' });
      continue;
    }
    const res = runMatch(aObj, bObj, `W1`);
    wR1Results.push(res);
  }

  // include byes (6-team bracket)
  const wR1Winners = [];
  if (winnersBracketSize === 6) {
    if (placementToRoster[1]) wR1Winners.push({ seed: 1, rosterId: placementToRoster[1] });
    if (placementToRoster[2]) wR1Winners.push({ seed: 2, rosterId: placementToRoster[2] });
  }
  for (const r of wR1Results) {
    wR1Winners.push({ seed: placementMap[r.winner] ?? null, rosterId: r.winner, loserSeed: placementMap[r.loser] ?? null, loserId: r.loser });
  }
  wR1Winners.sort((a,b) => (a.seed || 999) - (b.seed || 999));

  // semifinals / later pairing
  const wSemiPairs = [];
  if (wR1Winners.length >= 2) {
    const len = wR1Winners.length;
    wSemiPairs.push([wR1Winners[0], wR1Winners[len-1]]);
    if (len >= 4) wSemiPairs.push([wR1Winners[1], wR1Winners[len-2]]);
    if (len > 4) {
      for (let i = 2; i < Math.floor(len/2); i++) {
        wSemiPairs.push([wR1Winners[i], wR1Winners[len - 1 - i]]);
      }
    }
  }

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

  const finalRes = (wSemiResults.length >= 2) ? runMatch({seed: placementMap[wSemiResults[0].winner], rosterId: wSemiResults[0].winner}, {seed: placementMap[wSemiResults[1].winner], rosterId: wSemiResults[1].winner}, `Final`) : (wSemiResults.length === 1 ? wSemiResults[0] : null);
  const thirdRes = (wSemiResults.length >= 2) ? runMatch({seed: placementMap[wSemiResults[0].loser], rosterId: wSemiResults[0].loser}, {seed: placementMap[wSemiResults[1].loser], rosterId: wSemiResults[1].loser}, `3rd`) : null;

  // Consolation from R1 losers
  const wR1Losers = wR1Results.map((r, idx) => ({ seed: placementMap[r.loser] ?? null, rosterId: r.loser, winnerSeed: placementMap[r.winner] ?? null, winnerId: r.winner }));
  wR1Losers.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const cR1Pairs = [];
  if (wR1Losers.length >= 2) {
    cR1Pairs.push([wR1Losers[0], wR1Losers[wR1Losers.length-1]]);
    if (wR1Losers.length >= 4) cR1Pairs.push([wR1Losers[1], wR1Losers[wR1Losers.length-2]]);
  }
  const cR1Results = [];
  for (const pair of cR1Pairs) {
    if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) {
      trace.push(`Consolation R1 missing -> skipping`);
      cR1Results.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[0]?.rosterId ? pair[1]?.rosterId : pair[0]?.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}, `Consolation R1`);
    cR1Results.push(res);
  }

  const fifthRes = (cR1Results.length >= 2) ? runMatch({seed: placementMap[cR1Results[0].winner], rosterId: cR1Results[0].winner}, {seed: placementMap[cR1Results[1].winner], rosterId: cR1Results[1].winner}, `5th`) : (cR1Results.length === 1 ? cR1Results[0] : null);
  const seventhRes = (cR1Results.length >= 2) ? runMatch({seed: placementMap[cR1Results[0].loser], rosterId: cR1Results[0].loser}, {seed: placementMap[cR1Results[1].loser], rosterId: cR1Results[1].loser}, `7th`) : null;

  // -------------------------
  // Losers bracket (generalized)
  // -------------------------
  const lPairsSeedNums = [[9,12],[10,11]];
  const lR1Results = [];
  const lBySeed = {};
  for (const s of losersSeeds) lBySeed[s.seed] = s;

  for (const [s1,s2] of lPairsSeedNums) {
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

  const lWinners = lR1Results.map(r => ({ rosterId: r.winner, seed: placementMap[r.winner] ?? null }));
  const lLosers = lR1Results.map(r => ({ rosterId: r.loser, seed: placementMap[r.loser] ?? null }));

  const bye13 = { seed: 13, rosterId: placementToRoster[13] ?? null };
  const bye14 = { seed: 14, rosterId: placementToRoster[14] ?? null };

  lLosers.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const lrSemiPairs = [];
  if (lLosers.length >= 1) {
    const loserA = lLosers[0];
    lrSemiPairs.push([ loserA, bye14 ]);
  }
  if (lLosers.length >= 2) {
    const loserB = lLosers[1];
    lrSemiPairs.push([ loserB, bye13 ]);
  }

  const lSemiResults = [];
  for (const pair of lrSemiPairs) {
    const left = pair[0];
    const right = pair[1];
    if (!left || !right || !left.rosterId || !right.rosterId) {
      trace.push(`LRaceSemi ${left?.seed ?? '?'}v${right?.seed ?? '?'} -> missing`);
      lSemiResults.push({ winner: left?.rosterId || right?.rosterId, loser: right?.rosterId || left?.rosterId, reason: 'missing' });
      continue;
    }
    const res = runMatch({seed: left.seed, rosterId: left.rosterId}, {seed: right.seed, rosterId: right.rosterId}, `LRaceSemi`);
    lSemiResults.push(res);
  }

  let lFinalRes = null;
  if (lWinners.length >= 2) {
    lFinalRes = runMatch({seed: lWinners[0].seed, rosterId: lWinners[0].rosterId}, {seed: lWinners[1].seed, rosterId: lWinners[1].rosterId}, `9th`);
  } else if (lWinners.length === 1) {
    lFinalRes = { winner: lWinners[0].rosterId, loser: null, reason: 'auto' };
    trace.push(`9th auto -> ${placementMap[lWinners[0].rosterId] ?? lWinners[0].rosterId} (single-winner)`);
  }

  let l11Res = null, l13Res = null;
  if (lSemiResults.length >= 2) {
    const semiWinners = lSemiResults.map(r => ({ rosterId: r.winner, seed: placementMap[r.winner] ?? null }));
    const semiLosers = lSemiResults.map(r => ({ rosterId: r.loser, seed: placementMap[r.loser] ?? null }));
    if (semiWinners.length >= 2) {
      l11Res = runMatch({seed: semiWinners[0].seed, rosterId: semiWinners[0].rosterId}, {seed: semiWinners[1].seed, rosterId: semiWinners[1].rosterId}, `11th`);
    } else if (semiWinners.length === 1) {
      l11Res = { winner: semiWinners[0].rosterId, loser: null, reason: 'auto' };
      trace.push(`11th auto -> ${placementMap[semiWinners[0].rosterId] ?? semiWinners[0].rosterId} (single-semi-winner)`);
    }
    if (semiLosers.length >= 2) {
      l13Res = runMatch({seed: semiLosers[0].seed, rosterId: semiLosers[0].rosterId}, {seed: semiLosers[1].seed, rosterId: semiLosers[1].rosterId}, `13th`);
    } else if (semiLosers.length === 1) {
      l13Res = { winner: semiLosers[0].rosterId, loser: null, reason: 'auto' };
      trace.push(`13th auto -> ${placementMap[semiLosers[0].rosterId] ?? semiLosers[0].rosterId} (single-semi-loser)`);
    }
  } else if (lSemiResults.length === 1) {
    l11Res = { winner: lSemiResults[0].winner, loser: null, reason: 'only-semi' };
    l13Res = { winner: lSemiResults[0].loser, loser: null, reason: 'only-semi' };
    trace.push(`LRaceSemi single -> 11th ${placementMap[lSemiResults[0].winner] ?? lSemiResults[0].winner} , 13th ${placementMap[lSemiResults[0].loser] ?? lSemiResults[0].loser}`);
  }

  // -------------------------
  // Build final ordered placement list
  // -------------------------
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

  function pushResultPair(resObj) {
    if (!resObj) return;
    pushIfNotAssigned(resObj.winner);
    if (resObj.loser) pushIfNotAssigned(resObj.loser);
  }

  pushResultPair(finalRes);
  pushResultPair(thirdRes);
  pushResultPair(fifthRes);
  pushResultPair(seventhRes);

  pushResultPair(lFinalRes);
  pushResultPair(l11Res);
  pushResultPair(l13Res);

  // include any playoff match rows not yet assigned
  for (const r of matchupsRows) {
    if (r.participantsCount === 2) {
      pushIfNotAssigned(r.teamA.rosterId);
      pushIfNotAssigned(r.teamB.rosterId);
    } else if (Array.isArray(r.combinedParticipants)) {
      for (const p of r.combinedParticipants) pushIfNotAssigned(p.rosterId);
    } else if (r.teamA && r.teamA.rosterId) pushIfNotAssigned(r.teamA.rosterId);
  }

  // include remaining rosterMap entries
  for (const rk in rosterMap) pushIfNotAssigned(rk);

  const totalTeams = Object.keys(rosterMap).length || placementFinal.length;
  if (placementFinal.length < totalTeams) {
    for (const rk in rosterMap) {
      if (!assigned.has(String(rk))) {
        placementFinal.push(String(rk));
        assigned.add(String(rk));
      }
    }
  }
  while (placementFinal.length > totalTeams) placementFinal.pop();

  const finalStandings = [];
  for (let i = 0; i < placementFinal.length; i++) {
    const rid = String(placementFinal[i]);
    const meta = rosterMap[rid] || {};
    finalStandings.push({
      rank: i + 1,
      rosterId: rid,
      team_name: meta.team_name || meta.owner_name || ('Roster ' + rid),
      avatar: meta.team_avatar || meta.owner_avatar || null,
      seed: placementMap[rid] ?? null,
      pf: regularStandings.find(s => String(s.rosterId) === rid)?.pf ?? 0,
      wins: regularStandings.find(s => String(s.rosterId) === rid)?.wins ?? 0,
      owner_name: meta.owner_name ?? meta.owner?.display_name ?? meta.owner?.username ?? null,
      roster_meta: meta
    });
  }

  finalStandings.sort((a,b) => {
    if ((a.rank || 0) !== (b.rank || 0)) return (a.rank || 0) - (b.rank || 0);
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    if ((b.pf || 0) !== (a.pf || 0)) return (b.pf || 0) - (a.pf || 0);
    return (a.seed || 999) - (b.seed || 999);
  });
  for (let i = 0; i < finalStandings.length; i++) finalStandings[i].rank = i + 1;

  const champion = finalStandings[0] ?? null;
  const biggestLoser = finalStandings[finalStandings.length - 1] ?? null;

  // --- compute MVPs: prefer JSON-derived totals if JSON present, otherwise fall back to Sleeper client helpers ---
  let finalsMvp = null;
  let overallMvp = null;

  if (seasonJson) {
    // overallMvp: highest total in playerTotals
    let topPid = null, topPts = -Infinity;
    for (const pid in playerTotals) {
      if (!Object.prototype.hasOwnProperty.call(playerTotals, pid)) continue;
      const tot = playerTotals[pid].total || 0;
      if (tot > topPts) { topPid = pid; topPts = tot; }
    }
    if (topPid) {
      overallMvp = {
        playerId: topPid,
        points: Math.round((topPts || 0) * 100) / 100
      };
      // attempt to find roster affiliation (topRosterId) by searching which roster had this player most often or highest points
      // scan matchupsRows for the roster that had the highest cumulative points with this player
      const rosterAgg = {};
      for (const r of matchupsRows) {
        if (r.participantsCount === 2) {
          for (const side of ['teamA','teamB']) {
            const t = r[side];
            if (!t) continue;
            if (!Array.isArray(t.starters) || !Array.isArray(t.starters_points)) continue;
            for (let i = 0; i < t.starters.length; i++) {
              if (String(t.starters[i]) === String(topPid)) {
                rosterAgg[t.rosterId] = (rosterAgg[t.rosterId] || 0) + safeNum(t.starters_points[i] ?? 0);
              }
            }
          }
        } else if (Array.isArray(r.combinedParticipants)) {
          for (const t of r.combinedParticipants) {
            if (!Array.isArray(t.starters) || !Array.isArray(t.starters_points)) continue;
            for (let i = 0; i < t.starters.length; i++) {
              if (String(t.starters[i]) === String(topPid)) {
                rosterAgg[t.rosterId] = (rosterAgg[t.rosterId] || 0) + safeNum(t.starters_points[i] ?? 0);
              }
            }
          }
        }
      }
      let topRoster = null, topRosterPts = -Infinity;
      for (const rk in rosterAgg) {
        if (rosterAgg[rk] > topRosterPts) { topRoster = rk; topRosterPts = rosterAgg[rk]; }
      }
      if (topRoster) overallMvp.topRosterId = topRoster;
      // attach roster_meta if available
      if (overallMvp.topRosterId && rosterMap && rosterMap[String(overallMvp.topRosterId)]) overallMvp.roster_meta = rosterMap[String(overallMvp.topRosterId)];
    }

    // finalsMvp: top scorer (player) within the championship matchup (week === playoffEnd)
    // Find the championship matchup rows: week === playoffEnd and participantsCount === 2 and teams are the finalist rosters (if possible)
    // We'll take the matchupsRows for week playoffEnd and look for the matchup that has the highest combined points (or a match between expected finalists).
    const finalsCandidates = matchupsRows.filter(r => Number(r.week) === Number(playoffEnd) && r.participantsCount === 2);
    let championshipRow = null;
    if (finalsCandidates.length === 1) championshipRow = finalsCandidates[0];
    else if (finalsCandidates.length > 1) {
      // pick the matchup with the highest combined points
      let bestSum = -Infinity;
      for (const c of finalsCandidates) {
        const s = (safeNum(c.teamA.points) + safeNum(c.teamB.points));
        if (s > bestSum) { bestSum = s; championshipRow = c; }
      }
    }

    if (championshipRow) {
      // gather starters and starters_points from both sides
      const perPlayer = {};
      for (const side of ['teamA','teamB']) {
        const t = championshipRow[side];
        if (!t) continue;
        const rid = t.rosterId;
        if (Array.isArray(t.starters) && Array.isArray(t.starters_points)) {
          for (let i = 0; i < t.starters.length; i++) {
            const pid = String(t.starters[i] ?? '');
            if (!pid || pid === '0' || pid === 'null') continue;
            const ppts = safeNum(t.starters_points[i] ?? 0);
            perPlayer[pid] = perPlayer[pid] || { total: 0, rosterId: rid };
            perPlayer[pid].total += ppts;
          }
        }
      }
      let bestPid = null, bestPts = -Infinity, bestRoster = null;
      for (const pid in perPlayer) {
        if (perPlayer[pid].total > bestPts) {
          bestPid = pid;
          bestPts = perPlayer[pid].total;
          bestRoster = perPlayer[pid].rosterId;
        }
      }
      if (bestPid) {
        finalsMvp = {
          playerId: bestPid,
          points: Math.round(bestPts * 100) / 100,
          rosterId: bestRoster
        };
        if (finalsMvp.rosterId && rosterMap && rosterMap[String(finalsMvp.rosterId)]) finalsMvp.roster_meta = rosterMap[String(finalsMvp.rosterId)];
      }
    }

  } else {
    // no JSON — fallback to Sleeper client helpers (best effort)
    try {
      finalsMvp = await sleeper.getFinalsMVP(selectedLeagueId, { season: selectedSeasonParam || (leagueMeta && leagueMeta.season) || null, championshipWeek: playoffEnd, maxWeek: playoffEnd, playersEndpoint: '/players/nba' });
    } catch (e) {
      messages.push('Failed computing Finals MVP: ' + (e?.message ?? e));
      finalsMvp = null;
    }
    try {
      overallMvp = await sleeper.getOverallMVP(selectedLeagueId, { season: selectedSeasonParam || (leagueMeta && leagueMeta.season) || null, maxWeek: playoffEnd, playersEndpoint: '/players/nba' });
    } catch (e) {
      messages.push('Failed computing Overall MVP: ' + (e?.message ?? e));
      overallMvp = null;
    }
    // enrich with roster metadata if possible
    if (finalsMvp && typeof finalsMvp.rosterId !== 'undefined' && rosterMap && rosterMap[String(finalsMvp.rosterId)]) finalsMvp.roster_meta = rosterMap[String(finalsMvp.rosterId)];
    if (overallMvp && typeof overallMvp.topRosterId !== 'undefined' && rosterMap && rosterMap[String(overallMvp.topRosterId)]) overallMvp.roster_meta = rosterMap[String(overallMvp.topRosterId)];
  }

  // attach any roster_meta to champion/biggestLoser (if present)
  try {
    if (champion && champion.rosterId && rosterMap && rosterMap[String(champion.rosterId)]) champion.roster_meta = rosterMap[String(champion.rosterId)];
    if (biggestLoser && biggestLoser.rosterId && rosterMap && rosterMap[String(biggestLoser.rosterId)]) biggestLoser.roster_meta = rosterMap[String(biggestLoser.rosterId)];
  } catch (e) {
    // noop
  }

  // final return payload
  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    matchupsRows,
    regularStandings,
    finalStandings,
    debug: trace,
    messages,
    prevChain,
    finalsMvp,
    overallMvp,
    champion,
    biggestLoser,
    winnersBracketSize,
    // expose which JSON path was tried/loaded for debugging
    seasonJsonLoaded: seasonJson ? true : false,
    seasonJsonPathsTried: seasonJsonKeyTried
  };
}
