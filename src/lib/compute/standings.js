// src/lib/compute/standings.js
//
// The big one. Given a Sleeper league_id, produce the full standings payload
// the UI consumes (regular standings, playoff standings, bracket-derived
// final standings, championship game, weekly PF series, etc.).
//
// Static-vs-live decision:
//   · For COMPLETED seasons that have a `/static/season_matchups/{year}.json`
//     snapshot, every week is synthesized from the snapshot. This is instant
//     and pinning a score is as simple as editing `teamAScore` / `teamBScore`
//     in the JSON — the static path passes those values through as
//     `__final_score` and `computeParticipantPoints` honors that first.
//   · For IN-PROGRESS seasons (or if no snapshot exists), every week falls
//     back to a live Sleeper API call.

import {
  getLeague, getRosterMapWithOwners, getMatchupsForWeek,
  getWinnersBracket, getLosersBracket, safeNum
} from '$lib/api/sleeper';
import { fetchStaticJson, loadSeasonMatchups } from '$lib/api/staticSeasons';
import { computeParticipantPoints } from './scoring';
import { computeStreaks } from './streaks';
import {
  resolveFinalStandingsFromBrackets,
  getChampionshipGame,
  HARDCODED_CHAMPIONS
} from './brackets';
import { getLatestOwnerAvatars, applyLatestAvatars } from './avatars';

// Sleeper "season" runs for ~24 weeks; we scan a couple extra for safety.
const MAX_WEEKS = 25;

// ─────────────────────────────────────────────────────────────────────────
// Static-JSON → live-entry adapter
// ─────────────────────────────────────────────────────────────────────────

/**
 * Turn one matchup row from `/static/season_matchups/{year}.json` into
 * the shape Sleeper's live `/matchups` endpoint produces (one entry per
 * roster). Carries `teamAScore` / `teamBScore` through as `__final_score`
 * so it remains authoritative downstream.
 *
 * Returns an array of up to 2 entries (BYE / missing-team weeks return 1).
 */
function synthesizeWeekFromStatic(week, weekRows) {
  const out = [];
  for (const m of weekRows) {
    if (m.teamA) {
      const ridA = String(m.teamA.rosterId ?? m.teamA.roster_id ?? '');
      if (ridA) out.push({
        week,
        roster_id: ridA,
        matchup_id: m.matchup_id ?? null,
        // `__final_score` is the authoritative team total. Editing `teamAScore`
        // / `teamBScore` in the JSON flows through everywhere.
        __final_score: safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? 0),
        // Per-player figures from `starters_points` (the only authoritative
        // source for per-player scoring — `player_points` is intentionally
        // not propagated since manual game-selection corrupts it).
        starters: Array.isArray(m.teamA.starters) ? m.teamA.starters : null,
        starters_points: Array.isArray(m.teamA.starters_points) ? m.teamA.starters_points : null,
        __team_name: m.teamA.name ?? null,
        __owner_name: m.teamA.ownerName ?? null
      });
    }
    if (m.teamB) {
      const ridB = String(m.teamB.rosterId ?? m.teamB.roster_id ?? '');
      if (ridB) out.push({
        week,
        roster_id: ridB,
        matchup_id: m.matchup_id ?? null,
        __final_score: safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? 0),
        starters: Array.isArray(m.teamB.starters) ? m.teamB.starters : null,
        starters_points: Array.isArray(m.teamB.starters_points) ? m.teamB.starters_points : null,
        __team_name: m.teamB.name ?? null,
        __owner_name: m.teamB.ownerName ?? null
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// early2023 manual scoring patch
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a `{ 'owner:foo' | 'team:bar' → points }` map for one week of the
 * 2023 early-season patch JSON. Returns `null` if the week isn't covered.
 */
function buildEarly2023Override(earlyData, week) {
  if (!earlyData || !earlyData['2023'] || !earlyData['2023'][String(week)]) return null;
  if (week < 1 || week > 3) return null;
  const map = {};
  for (const e of earlyData['2023'][String(week)]) {
    const aOwner = e.teamA?.ownerName ? String(e.teamA.ownerName).toLowerCase() : null;
    const bOwner = e.teamB?.ownerName ? String(e.teamB.ownerName).toLowerCase() : null;
    const aTeam = e.teamA?.name ? String(e.teamA.name).toLowerCase() : null;
    const bTeam = e.teamB?.name ? String(e.teamB.name).toLowerCase() : null;
    if (aOwner) map['owner:' + aOwner] = safeNum(e.teamAScore ?? 0);
    if (bOwner) map['owner:' + bOwner] = safeNum(e.teamBScore ?? 0);
    if (aTeam) map['team:' + aTeam] = safeNum(e.teamAScore ?? 0);
    if (bTeam) map['team:' + bTeam] = safeNum(e.teamBScore ?? 0);
  }
  return map;
}

/** Look up an early-2023 override score for a given roster. */
function lookupEarlyScore(earlyWeekMap, meta) {
  if (!earlyWeekMap || !meta) return null;
  const ownerLow = (meta.owner_name || meta.owner_username) ? String(meta.owner_name || meta.owner_username).toLowerCase() : null;
  const teamLow = meta.team_name ? String(meta.team_name).toLowerCase() : null;
  if (ownerLow && earlyWeekMap['owner:' + ownerLow] != null) return earlyWeekMap['owner:' + ownerLow];
  if (teamLow && earlyWeekMap['team:' + teamLow] != null) return earlyWeekMap['team:' + teamLow];
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────

/**
 * Given a Sleeper league_id, fetch everything we need (league metadata,
 * rosters, brackets, historical JSON for old seasons) and produce the full
 * standings payload the UI consumes:
 *
 *   {
 *     regularStandings: [...],   // sorted by wins then PF
 *     playoffStandings: [...],   // same but only counting playoff weeks
 *     finalStandings: [...],     // 1st → last derived from the brackets
 *     bracketChampionId,         // roster_id of the champion (or null)
 *     bracketComplete,           // true if a real championship game has a winner
 *     championshipGame,          // { week, rosterIds, ... } for Finals MVP
 *     rosterMap,                 // { rosterId: {team_name, owner_name, avatars} }
 *     playoffStart, playoffEnd,  // week numbers
 *     playoffTeams,              // # of teams in the playoff bracket
 *     winnersBracket, losersBracket,
 *     weeklyPfByRoster,          // { rosterId: [{week, pf}, ...] }
 *     collectedMatchups          // { week: [entries] } — reusable
 *   }
 */
export async function computeStandingsForLeague(leagueId) {
  // 1. Fetch league + rosters + brackets + LATEST owner avatars in parallel.
  const [leagueMeta, rosterMap, winnersBracket, losersBracket, latestAvatars] = await Promise.all([
    getLeague(leagueId).catch(() => null),
    getRosterMapWithOwners(leagueId).catch(() => ({})),
    getWinnersBracket(leagueId).catch(() => []),
    getLosersBracket(leagueId).catch(() => []),
    getLatestOwnerAvatars().catch(() => ({}))
  ]);

  // Overlay each roster's logo + team_name with the OWNER'S CURRENT branding
  // so historical seasons display the most recent team art.
  applyLatestAvatars(rosterMap, latestAvatars);

  // 2. League-level config.
  const leagueSeason = leagueMeta?.season ? String(leagueMeta.season) : null;
  const leagueName = leagueMeta?.name ?? null;
  const playoffTeams = leagueMeta?.settings?.playoff_teams ? Number(leagueMeta.settings.playoff_teams) : 8;

  let playoffStart = (leagueMeta?.settings?.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 20;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 20;
  // League policy: playoffs are always 4 weeks (2 single-elim rounds + a
  // 2-week merged championship final).
  let playoffEnd = playoffStart + 2;
  let finalsLeg2Week = playoffEnd;

  // 3. Per-roster stats accumulators.
  const statsByRosterRegular = {}, resultsByRosterRegular = {}, paByRosterRegular = {};
  const statsByRosterPlayoff = {}, resultsByRosterPlayoff = {}, paByRosterPlayoff = {};
  const weeklyPfByRoster = {};       // for the standings trends sparkline

  for (const rk of Object.keys(rosterMap)) {
    statsByRosterRegular[rk] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk].roster_raw || null };
    resultsByRosterRegular[rk] = [];
    paByRosterRegular[rk] = 0;
    statsByRosterPlayoff[rk] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk].roster_raw || null };
    resultsByRosterPlayoff[rk] = [];
    paByRosterPlayoff[rk] = 0;
    weeklyPfByRoster[rk] = [];
  }

  // 4. Decide static vs live and load any historical patches.
  const isLeagueComplete = leagueMeta?.status === 'complete';
  const [seasonMatchups, earlyData] = await Promise.all([
    (isLeagueComplete && leagueSeason) ? loadSeasonMatchups(leagueSeason) : Promise.resolve(null),
    leagueSeason === '2023' ? fetchStaticJson('/early2023.json') : Promise.resolve(null)
  ]);

  if (seasonMatchups && Number.isFinite(seasonMatchups.playoff_week_end)) {
    playoffEnd = Number(seasonMatchups.playoff_week_end);
    finalsLeg2Week = playoffEnd;
  }

  // 5. Fetch ALL weeks in parallel — static where available, live otherwise.
  const weekFetches = [];
  for (let week = 1; week <= MAX_WEEKS; week++) {
    const staticRows = seasonMatchups?.[String(week)];
    if (Array.isArray(staticRows)) {
      weekFetches.push(Promise.resolve({ week, matchups: synthesizeWeekFromStatic(week, staticRows) }));
    } else {
      weekFetches.push(
        getMatchupsForWeek(leagueId, week).then(
          (m) => ({ week, matchups: m }),
          () => ({ week, matchups: null })
        )
      );
    }
  }
  const allWeekResults = await Promise.all(weekFetches);

  // 6. Process week by week.
  const collectedMatchups = {};          // week -> entries (for downstream MVP aggregators)
  const finalsLeg1Outcomes = {};         // matchup_id -> leg-1 snapshot (for 2-week final merge)

  for (const { week, matchups } of allWeekResults) {
    if (!matchups || !matchups.length) continue;
    collectedMatchups[week] = matchups;

    const isRegularWeek = (week >= 1 && week < playoffStart);
    const isPlayoffWeek = (week >= playoffStart && week <= playoffEnd);
    if (!isRegularWeek && !isPlayoffWeek) continue;

    const statsByRoster = isPlayoffWeek ? statsByRosterPlayoff : statsByRosterRegular;
    const resultsByRoster = isPlayoffWeek ? resultsByRosterPlayoff : resultsByRosterRegular;
    const paByRoster = isPlayoffWeek ? paByRosterPlayoff : paByRosterRegular;
    const earlyWeekMap = buildEarly2023Override(earlyData, week);

    // Group entries by matchup id. Backfill rosterMap from any static
    // `__team_name` / `__owner_name` for rosters not in the live map.
    const byMatch = {};
    for (let mi = 0; mi < matchups.length; mi++) {
      const e = matchups[mi];
      const possibleRid = e.roster_id ?? e.rosterId ?? e.owner_id ?? null;
      const pidStr = possibleRid != null ? String(possibleRid) : null;
      if (pidStr && !rosterMap[pidStr] && (e.__team_name || e.__owner_name)) {
        rosterMap[pidStr] = {
          roster_id: pidStr, team_name: e.__team_name, owner_name: e.__owner_name,
          team_avatar: null, owner_avatar: null, owner_username: null, owner_id: null, roster_raw: null
        };
      }
      const mid = e.matchup_id ?? e.matchupId ?? null;
      const wk = e.week ?? week;
      const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(e);
    }

    for (const key of Object.keys(byMatch)) {
      const entries = byMatch[key];
      if (!entries || entries.length === 0) continue;

      // Single-entry "BYE" — score it but skip H2H accounting.
      if (entries.length === 1) {
        const only = entries[0];
        const ridOnly = String(only.roster_id ?? only.rosterId ?? '');
        ensureRoster(statsByRoster, resultsByRoster, paByRoster, ridOnly);
        const pts = lookupEarlyScore(earlyWeekMap, rosterMap[ridOnly]) ?? computeParticipantPoints(only);
        statsByRoster[ridOnly].pf += pts;
        if (isRegularWeek) {
          weeklyPfByRoster[ridOnly] = weeklyPfByRoster[ridOnly] || [];
          weeklyPfByRoster[ridOnly].push({ week, pf: Math.round(pts * 100) / 100 });
        }
        continue;
      }

      // Normal H2H (or multi-team) matchup.
      const participants = [];
      for (const en of entries) {
        const pid = String(en.roster_id ?? en.rosterId ?? '');
        const ppts = lookupEarlyScore(earlyWeekMap, rosterMap[pid]) ?? computeParticipantPoints(en);
        participants.push({ rosterId: pid, points: ppts });
        ensureRoster(statsByRoster, resultsByRoster, paByRoster, pid);
        statsByRoster[pid].pf += ppts;
        if (isRegularWeek) {
          weeklyPfByRoster[pid] = weeklyPfByRoster[pid] || [];
          weeklyPfByRoster[pid].push({ week, pf: Math.round(ppts * 100) / 100 });
        }
      }

      // W/L vs opponent average (matters for multi-team weeks).
      for (let pi = 0; pi < participants.length; pi++) {
        const part = participants[pi];
        const others = participants.filter((_, i) => i !== pi);
        const oppAvg = others.length ? others.reduce((s, o) => s + o.points, 0) / others.length : 0;
        paByRoster[part.rosterId] += oppAvg;
        if (part.points > oppAvg + 1e-9) { resultsByRoster[part.rosterId].push('W'); statsByRoster[part.rosterId].wins += 1; }
        else if (part.points < oppAvg - 1e-9) { resultsByRoster[part.rosterId].push('L'); statsByRoster[part.rosterId].losses += 1; }
        else { resultsByRoster[part.rosterId].push('T'); statsByRoster[part.rosterId].ties += 1; }
      }

      // Merged 2-week championship handling — see helper for the strategy.
      if (isPlayoffWeek && participants.length === 2) {
        const mid = entries[0]?.matchup_id ?? entries[0]?.matchupId ?? null;
        if (mid != null) {
          handleMergedFinal({
            week, finalsLeg2Week, midKey: String(mid),
            participants, resultsByRoster, statsByRoster, finalsLeg1Outcomes
          });
        }
      }
    }
  }

  // 7. Build the regular + playoff tables.
  const regularStandings = buildStandingsTable(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular, rosterMap);
  const playoffStandings = buildStandingsTable(statsByRosterPlayoff, resultsByRosterPlayoff, paByRosterPlayoff, rosterMap);

  // 8. Bracket-derived final standings + champion stamp.
  const { finalRanking, champion: bracketChampionId, bracketComplete } = resolveFinalStandingsFromBrackets(
    winnersBracket, losersBracket, regularStandings, playoffTeams
  );

  const finalStandings = finalRanking.map((entry) => {
    const meta = rosterMap[entry.rosterId] || {};
    const reg = regularStandings.find((r) => r.rosterId === entry.rosterId) || {};
    const seedIdx = regularStandings.findIndex((r) => r.rosterId === entry.rosterId);
    return {
      rosterId: entry.rosterId,
      rank: entry.rank,
      seed: seedIdx >= 0 ? seedIdx + 1 : null,
      team_name: meta.team_name || ('Roster ' + entry.rosterId),
      owner_name: meta.owner_name || null,
      owner_username: meta.owner_username || null,
      avatar: meta.team_avatar || meta.owner_avatar || null,
      isChampion: entry.rank === 1,
      isPlayoff: entry.rank <= playoffTeams,
      wins: reg.wins ?? 0,
      losses: reg.losses ?? 0,
      pf: reg.pf ?? 0
    };
  });

  stampChampion(playoffStandings, bracketComplete, bracketChampionId, leagueSeason, rosterMap);

  // 9. Sort each weekly PF series chronologically before returning.
  for (const rid of Object.keys(weeklyPfByRoster)) {
    weeklyPfByRoster[rid].sort((a, b) => a.week - b.week);
  }

  return {
    leagueId: String(leagueId),
    season: leagueSeason,
    leagueName,
    regularStandings,
    playoffStandings,
    finalStandings,
    bracketChampionId,
    bracketComplete,
    championshipGame: getChampionshipGame(winnersBracket, playoffStart),
    rosterMap,
    playoffStart,
    playoffEnd,
    playoffTeams,
    winnersBracket,
    losersBracket,
    weeklyPfByRoster,
    collectedMatchups
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

function ensureRoster(statsByRoster, resultsByRoster, paByRoster, rid) {
  statsByRoster[rid] = statsByRoster[rid] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
  resultsByRoster[rid] = resultsByRoster[rid] || [];
  paByRoster[rid] = paByRoster[rid] || 0;
}

/**
 * Build one sorted standings table (regular OR playoff) out of the
 * accumulated stats. Sorted by wins desc, then PF desc.
 */
function buildStandingsTable(stats, results, pa, rosterMap) {
  const out = [];
  const keys = Object.keys(results).length ? Object.keys(results) : Object.keys(rosterMap);
  for (const rid of keys) {
    stats[rid] = stats[rid] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
    const meta = rosterMap[rid] || {};
    const streaks = computeStreaks(results[rid] || []);
    out.push({
      rosterId: rid,
      owner_id: meta.owner_id || null,
      team_name: meta.team_name || ('Roster ' + rid),
      owner_name: meta.owner_name || null,
      avatar: meta.team_avatar || meta.owner_avatar || null,
      wins: stats[rid].wins || 0,
      losses: stats[rid].losses || 0,
      ties: stats[rid].ties || 0,
      pf: Math.round((stats[rid].pf || 0) * 100) / 100,
      pa: Math.round((pa[rid] || 0) * 100) / 100,
      champion: false,
      maxWinStreak: streaks.maxW,
      maxLoseStreak: streaks.maxL
    });
  }
  out.sort((a, b) => {
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    return (b.pf || 0) - (a.pf || 0);
  });
  return out;
}

/**
 * Merged 2-week championship handling.
 *
 * The league plays the FINAL as one matchup spanning the last two playoff
 * weeks (owners pick one game from each week; total score = sum of both
 * weeks' starters_points). For W/L accounting we need to count that as ONE
 * game, not two.
 *
 * Strategy:
 *  · On leg-1 week: remember each participant's leg-1 points and their
 *    result-array index for later rollback.
 *  · On leg-2 week: undo BOTH legs' per-week W/L (each leg already counted
 *    1 W/L per participant), then push a single MERGED W/L per participant
 *    based on the sum of leg-1 + leg-2 scores.
 *
 * PF/PA are intentionally untouched — both weeks DO contribute to playoff
 * PF/PA, so summing them per-week is already correct.
 */
function handleMergedFinal({ week, finalsLeg2Week, midKey, participants, resultsByRoster, statsByRoster, finalsLeg1Outcomes }) {
  if (week === finalsLeg2Week - 1) {
    finalsLeg1Outcomes[midKey] = participants.map((p) => ({
      rosterId: p.rosterId,
      points: p.points,
      resultIndex: resultsByRoster[p.rosterId].length - 1
    }));
    return;
  }
  if (week !== finalsLeg2Week) return;

  const leg1 = finalsLeg1Outcomes[midKey];
  if (!leg1 || leg1.length !== 2) return;

  // 1. Roll back leg-1's contribution.
  for (const l of leg1) {
    const arr = resultsByRoster[l.rosterId];
    const idx = l.resultIndex;
    if (idx >= 0 && idx < arr.length) {
      const r = arr[idx];
      if (r === 'W') statsByRoster[l.rosterId].wins -= 1;
      else if (r === 'L') statsByRoster[l.rosterId].losses -= 1;
      else if (r === 'T') statsByRoster[l.rosterId].ties -= 1;
      arr.splice(idx, 1);
    }
  }
  // 2. Roll back leg-2's contribution that was just pushed.
  for (const p of participants) {
    const arr = resultsByRoster[p.rosterId];
    const popped = arr.pop();
    if (popped === 'W') statsByRoster[p.rosterId].wins -= 1;
    else if (popped === 'L') statsByRoster[p.rosterId].losses -= 1;
    else if (popped === 'T') statsByRoster[p.rosterId].ties -= 1;
  }
  // 3. Push the single MERGED result based on combined scores.
  const totals = {};
  for (const p of participants) totals[p.rosterId] = (totals[p.rosterId] ?? 0) + p.points;
  for (const l of leg1) totals[l.rosterId] = (totals[l.rosterId] ?? 0) + l.points;
  const [pa, pb] = participants;
  const aTotal = totals[pa.rosterId] ?? 0;
  const bTotal = totals[pb.rosterId] ?? 0;
  let aRes, bRes;
  if (aTotal > bTotal + 1e-9) { aRes = 'W'; bRes = 'L'; }
  else if (aTotal < bTotal - 1e-9) { aRes = 'L'; bRes = 'W'; }
  else { aRes = 'T'; bRes = 'T'; }
  resultsByRoster[pa.rosterId].push(aRes);
  resultsByRoster[pb.rosterId].push(bRes);
  bumpStat(statsByRoster, pa.rosterId, aRes);
  bumpStat(statsByRoster, pb.rosterId, bRes);
}

function bumpStat(statsByRoster, rid, res) {
  if (res === 'W') statsByRoster[rid].wins += 1;
  else if (res === 'L') statsByRoster[rid].losses += 1;
  else statsByRoster[rid].ties += 1;
}

/**
 * Stamp `champion: true` onto the matching playoffStandings row. Uses the
 * bracket champion first; falls back to the hardcoded list for seasons
 * whose brackets endpoint comes back empty.
 */
function stampChampion(playoffStandings, bracketComplete, bracketChampionId, leagueSeason, rosterMap) {
  if (bracketComplete && bracketChampionId) {
    for (const r of playoffStandings) {
      if (String(r.rosterId) === String(bracketChampionId)) { r.champion = true; break; }
    }
    return;
  }
  if (!leagueSeason || !HARDCODED_CHAMPIONS[leagueSeason]) return;
  const championOwner = String(HARDCODED_CHAMPIONS[leagueSeason]).toLowerCase();
  for (const r of playoffStandings) {
    const meta = rosterMap[r.rosterId] || {};
    if (String(meta.owner_username || '').toLowerCase() === championOwner ||
        String(meta.owner_name || '').toLowerCase() === championOwner) {
      r.champion = true; break;
    }
  }
}
