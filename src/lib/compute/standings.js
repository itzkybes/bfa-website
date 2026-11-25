// src/lib/compute/standings.js
//
// The big one. Given a Sleeper league_id, produce the full standings payload
// the UI consumes (regular standings, playoff standings, bracket-derived
// final standings, championship game, weekly PF series, etc.).
//
// Scoring-source policy:
//   · All team scores and player-level scoring are read from the saved
 //     `/static/season_matchups/{year}.json` snapshot.
//   · Explicit `teamAScore` / `teamBScore` values in that file are
 //     authoritative overrides and flow through as `__final_score`.
//   · A missing snapshot week is omitted; it never falls back to live
 //     Sleeper matchup stats. Live API calls below provide league, roster,
 //     and bracket metadata only.

import {
  getLeague,
  getRosterMapWithOwners,
  getWinnersBracket,
  getLosersBracket,
  safeNum,
} from '$lib/api/sleeper';
import { fetchStaticJson, loadSeasonMatchups } from '$lib/api/staticSeasons';
import { computeParticipantPoints } from './scoring';
import { computeStreaks } from './streaks';
import { compareStandings } from './standingsSort';
import { getStandingsMovementFromSnapshots } from './standingsMovement';
import {
  resolveFinalStandingsFromBrackets,
  getChampionshipGame,
  HARDCODED_CHAMPIONS,
} from './brackets';
import { getLatestOwnerAvatars, applyLatestAvatars } from './avatars';
import { getSeasonFormat } from './seasonFormat';
import { getCompletedWeekForLeague } from './weekCutoff';
import { filterPlayoffMatchups } from './playoffEligibility';

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
      if (ridA)
        out.push({
          week,
          roster_id: ridA,
          matchup_id: m.matchup_id ?? null,
          // `__final_score` is the authoritative team total. Editing `teamAScore`
          // / `teamBScore` in the JSON flows through everywhere.
          ...(m.teamAScore != null || m.teamA?.custom_points != null || m.teamA?.points != null || m.teamA?.score != null
            ? { __final_score: safeNum(m.teamAScore ?? m.teamA?.custom_points ?? m.teamA?.points ?? m.teamA?.score) }
            : {}),
          // Per-player figures from `starters_points` (the only authoritative
          // source for per-player scoring — `player_points` is intentionally
          // not propagated since manual game-selection corrupts it).
          starters: Array.isArray(m.teamA.starters) ? m.teamA.starters : null,
          starters_points: Array.isArray(m.teamA.starters_points) ? m.teamA.starters_points : null,
          __team_name: m.teamA.name ?? null,
          __owner_name: m.teamA.ownerName ?? null,
        });
    }
    if (m.teamB) {
      const ridB = String(m.teamB.rosterId ?? m.teamB.roster_id ?? '');
      if (ridB)
        out.push({
          week,
          roster_id: ridB,
          matchup_id: m.matchup_id ?? null,
          ...(m.teamBScore != null || m.teamB?.custom_points != null || m.teamB?.points != null || m.teamB?.score != null
            ? { __final_score: safeNum(m.teamBScore ?? m.teamB?.custom_points ?? m.teamB?.points ?? m.teamB?.score) }
            : {}),
          starters: Array.isArray(m.teamB.starters) ? m.teamB.starters : null,
          starters_points: Array.isArray(m.teamB.starters_points) ? m.teamB.starters_points : null,
          __team_name: m.teamB.name ?? null,
          __owner_name: m.teamB.ownerName ?? null,
        });
    }
  }
  return out;
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
    getLeague(leagueId, 0).catch(() => null),
    getRosterMapWithOwners(leagueId).catch(() => ({})),
    getWinnersBracket(leagueId).catch(() => []),
    getLosersBracket(leagueId).catch(() => []),
    getLatestOwnerAvatars().catch(() => ({})),
  ]);

  // Overlay each roster's logo + team_name with the OWNER'S CURRENT branding
  // so historical seasons display the most recent team art.
  applyLatestAvatars(rosterMap, latestAvatars);

  // 2. League-level config.
  const leagueSeason = leagueMeta?.season ? String(leagueMeta.season) : null;
  const leagueName = leagueMeta?.name ?? null;
  const seasonFormat =
    getSeasonFormat(leagueSeason, leagueMeta?.settings) ?? getSeasonFormat(2026);
  const { playoffStart, playoffEnd, playoffTeams, toiletBowlTeams, regularSeasonWeeks, playoffWeeks } =
    seasonFormat;
  const completedThroughWeek = getCompletedWeekForLeague(leagueMeta, playoffEnd);

  // 3. Per-roster stats accumulators.
  const statsByRosterRegular = {},
    resultsByRosterRegular = {},
    paByRosterRegular = {};
  const statsByRosterPlayoff = {},
    resultsByRosterPlayoff = {},
    paByRosterPlayoff = {};
  const weeklyPfByRoster = {}; // for the standings trends sparkline

  for (const rk of Object.keys(rosterMap)) {
    statsByRosterRegular[rk] = {
      wins: 0,
      losses: 0,
      ties: 0,
      pf: 0,
      pa: 0,
      roster: rosterMap[rk].roster_raw || null,
    };
    resultsByRosterRegular[rk] = [];
    paByRosterRegular[rk] = 0;
    statsByRosterPlayoff[rk] = {
      wins: 0,
      losses: 0,
      ties: 0,
      pf: 0,
      pa: 0,
      roster: rosterMap[rk].roster_raw || null,
    };
    resultsByRosterPlayoff[rk] = [];
    paByRosterPlayoff[rk] = 0;
    weeklyPfByRoster[rk] = [];
  }

  // 4. Load the saved year JSON used as the authoritative scoring source.
  const seasonMatchups = leagueSeason ? await loadSeasonMatchups(leagueSeason) : null;

  // 5. Adapt every available week in the saved snapshot. Missing weeks stay unavailable.
  const weekFetches = [];
  for (let week = 1; week <= MAX_WEEKS; week++) {
    const staticRows = seasonMatchups?.[String(week)];
    weekFetches.push(
      Promise.resolve({
        week,
        matchups: Array.isArray(staticRows) ? synthesizeWeekFromStatic(week, staticRows) : null,
      })
    );
  }
  const allWeekResults = await Promise.all(weekFetches);

  // 6. Process week by week.
  const collectedMatchups = {}; // week -> entries (for downstream MVP aggregators)
  const regularWeekRankSnapshots = [];
  let playoffRosterSet = null;

  for (const { week, matchups } of allWeekResults) {
    // Do not expose or aggregate the active scoring week for the live season.
    if (week > completedThroughWeek || week > playoffEnd) continue;
    if (!matchups || !matchups.length) continue;
    collectedMatchups[week] = matchups;

    const isRegularWeek = week >= 1 && week < playoffStart;
    const isPlayoffWeek = week >= playoffStart && week <= playoffEnd;
    if (!isRegularWeek && !isPlayoffWeek) continue;

    // Seed the championship field from the completed regular-season standings.
    // Every playoff round and its consolation games belong to this same field;
    // the separate Toilet Bowl field is deliberately excluded.
    if (isPlayoffWeek && !playoffRosterSet) {
      playoffRosterSet = new Set(
        Object.entries(statsByRosterRegular)
          .sort(([, a], [, b]) => compareStandings(a, b))
          .slice(0, playoffTeams)
          .map(([rosterId]) => String(rosterId))
      );
    }

    const statsByRoster = isPlayoffWeek ? statsByRosterPlayoff : statsByRosterRegular;
    const resultsByRoster = isPlayoffWeek ? resultsByRosterPlayoff : resultsByRosterRegular;
    const paByRoster = isPlayoffWeek ? paByRosterPlayoff : paByRosterRegular;

    // Group entries by matchup id. Backfill rosterMap from any static
    // `__team_name` / `__owner_name` for rosters not in the live map.
    const byMatch = {};
    for (let mi = 0; mi < matchups.length; mi++) {
      const e = matchups[mi];
      const possibleRid = e.roster_id ?? e.rosterId ?? e.owner_id ?? null;
      const pidStr = possibleRid != null ? String(possibleRid) : null;
      if (pidStr && !rosterMap[pidStr] && (e.__team_name || e.__owner_name)) {
        rosterMap[pidStr] = {
          roster_id: pidStr,
          team_name: e.__team_name,
          owner_name: e.__owner_name,
          team_avatar: null,
          owner_avatar: null,
          owner_username: null,
          owner_id: null,
          roster_raw: null,
        };
      }
      const mid = e.matchup_id ?? e.matchupId ?? null;
      const wk = e.week ?? week;
      const key = String(mid != null ? mid + '|' + wk : 'auto|' + wk + '|' + mi);
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(e);
    }

    for (const key of Object.keys(byMatch)) {
      const entries = byMatch[key];
      if (!entries || entries.length === 0) continue;
      // Do not count Toilet Bowl games (including its consolation rounds) as
      // playoff statistics. Keep only complete matchups inside the seeded
      // championship playoff field, including its own consolation matches.
      if (isPlayoffWeek && entries.some((entry) =>
        !playoffRosterSet?.has(String(entry.roster_id ?? entry.rosterId ?? ''))
      )) continue;

      // Single-entry "BYE" — score it but skip H2H accounting.
      if (entries.length === 1) {
        const only = entries[0];
        const ridOnly = String(only.roster_id ?? only.rosterId ?? '');
        ensureRoster(statsByRoster, resultsByRoster, paByRoster, ridOnly);
        const pts = computeParticipantPoints(only);
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
        const ppts = computeParticipantPoints(en);
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
        if (part.points > oppAvg + 1e-9) {
          resultsByRoster[part.rosterId].push('W');
          statsByRoster[part.rosterId].wins += 1;
        } else if (part.points < oppAvg - 1e-9) {
          resultsByRoster[part.rosterId].push('L');
          statsByRoster[part.rosterId].losses += 1;
        } else {
          resultsByRoster[part.rosterId].push('T');
          statsByRoster[part.rosterId].ties += 1;
        }
      }

    }

    // Capture the cumulative table after this completed regular-season week.
    // These are the same scored totals used for final standings, including
    // historical score overrides and opponent-average matchup outcomes.
    if (isRegularWeek) {
      const ranked = Object.entries(statsByRosterRegular).sort(([, a], [, b]) =>
        compareStandings(a, b)
      );
      regularWeekRankSnapshots.push({
        week,
        ranks: Object.fromEntries(ranked.map(([rosterId], index) => [rosterId, index + 1])),
      });
    }
  }

  // 7. Build the regular + playoff tables.
  const regularStandings = buildStandingsTable(
    statsByRosterRegular,
    resultsByRosterRegular,
    paByRosterRegular,
    rosterMap
  );
  const playoffStandings = buildStandingsTable(
    statsByRosterPlayoff,
    resultsByRosterPlayoff,
    paByRosterPlayoff,
    rosterMap
  ).filter((row) => playoffRosterSet?.has(String(row.rosterId)));

  const standingsMovement = getStandingsMovementFromSnapshots(regularWeekRankSnapshots);

  // 8. Bracket-derived final standings + champion stamp.
  const {
    finalRanking,
    champion: bracketChampionId,
    bracketComplete,
  } = resolveFinalStandingsFromBrackets(
    winnersBracket,
    losersBracket,
    regularStandings,
    playoffTeams
  );

  const finalStandings = finalRanking.map((entry) => {
    const meta = rosterMap[entry.rosterId] || {};
    const reg = regularStandings.find((r) => r.rosterId === entry.rosterId) || {};
    const seedIdx = regularStandings.findIndex((r) => r.rosterId === entry.rosterId);
    return {
      rosterId: entry.rosterId,
      rank: entry.rank,
      seed: seedIdx >= 0 ? seedIdx + 1 : null,
      team_name: meta.team_name || 'Roster ' + entry.rosterId,
      owner_name: meta.owner_name || null,
      owner_username: meta.owner_username || null,
      avatar: meta.team_avatar || meta.owner_avatar || null,
      isChampion: entry.rank === 1,
      isPlayoff: entry.rank <= playoffTeams,
      wins: reg.wins ?? 0,
      losses: reg.losses ?? 0,
      pf: reg.pf ?? 0,
    };
  });

  stampChampion(playoffStandings, bracketComplete, bracketChampionId, leagueSeason, rosterMap);

  // Keep the complete matchup collection available for bracket and schedule
  // display, but expose a postseason-only collection for statistics. This
  // includes every round and placement game involving the seeded playoff
  // field, while excluding all Toilet Bowl / non-qualifier matchups.
  const playoffRosterIds = [...(playoffRosterSet || [])];
  const playoffMatchups = filterPlayoffMatchups(
    collectedMatchups,
    playoffRosterIds,
    playoffStart,
    playoffEnd
  );

  // 9. Sort each weekly PF series chronologically before returning.
  for (const rid of Object.keys(weeklyPfByRoster)) {
    weeklyPfByRoster[rid].sort((a, b) => a.week - b.week);
  }

  return {
    leagueId: String(leagueId),
    season: leagueSeason,
    seasonStatus: leagueMeta?.status || null,
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
    toiletBowlTeams,
    regularSeasonWeeks,
    playoffWeeks,
    completedThroughWeek,
    winnersBracket,
    losersBracket,
    weeklyPfByRoster,
    collectedMatchups,
    playoffRosterIds,
    playoffMatchups,
    standingsMovement,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

function ensureRoster(statsByRoster, resultsByRoster, paByRoster, rid) {
  statsByRoster[rid] = statsByRoster[rid] || {
    wins: 0,
    losses: 0,
    ties: 0,
    pf: 0,
    pa: 0,
    roster: null,
  };
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
      team_name: meta.team_name || 'Roster ' + rid,
      owner_name: meta.owner_name || null,
      avatar: meta.team_avatar || meta.owner_avatar || null,
      wins: stats[rid].wins || 0,
      losses: stats[rid].losses || 0,
      ties: stats[rid].ties || 0,
      pf: Math.round((stats[rid].pf || 0) * 100) / 100,
      pa: Math.round((pa[rid] || 0) * 100) / 100,
      champion: false,
      maxWinStreak: streaks.maxW,
      maxLoseStreak: streaks.maxL,
    });
  }
  out.sort(compareStandings);
  return out;
}

/**
 * Stamp `champion: true` onto the matching playoffStandings row. Uses the
 * bracket champion first; falls back to the hardcoded list for seasons
 * whose brackets endpoint comes back empty.
 */
function stampChampion(
  playoffStandings,
  bracketComplete,
  bracketChampionId,
  leagueSeason,
  rosterMap
) {
  if (bracketComplete && bracketChampionId) {
    for (const r of playoffStandings) {
      if (String(r.rosterId) === String(bracketChampionId)) {
        r.champion = true;
        break;
      }
    }
    return;
  }
  if (!leagueSeason || !HARDCODED_CHAMPIONS[leagueSeason]) return;
  const championOwner = String(HARDCODED_CHAMPIONS[leagueSeason]).toLowerCase();
  for (const r of playoffStandings) {
    const meta = rosterMap[r.rosterId] || {};
    if (
      String(meta.owner_username || '').toLowerCase() === championOwner ||
      String(meta.owner_name || '').toLowerCase() === championOwner
    ) {
      r.champion = true;
      break;
    }
  }
}
