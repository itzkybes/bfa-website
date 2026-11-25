// src/lib/compute/matchups.js
//
// Per-week matchup rows for the `/matchups` page.
// Saved year JSON is the sole source for scores and player performances.
// Live Sleeper data is context-only when a saved week is unavailable.

import { getLeague, getRosterMapWithOwners, getMatchupsForWeek } from '$lib/api/sleeper';
import { loadSeasonMatchups } from '$lib/api/staticSeasons';
import { buildTeamFromLive, buildTeamFromStatic } from './matchupTeams';
import { getLatestOwnerAvatars, applyLatestAvatars } from './avatars';
import { getSeasonFormat } from './seasonFormat';
import { getCompletedWeekForLeague } from './weekCutoff';

/**
 * Build the matchup rows for one league + week. This is the data the
 * `/matchups` page renders.
 *
 * Source-of-truth rule:
 *   · If the requested week exists in `/static/season_matchups/{year}.json`,
 *     use that snapshot for team scores and selected-starter player scoring.
 *   · Otherwise, live Sleeper data may supply team names and matchup pairing
 *     only. Scores and player-stat fields remain unavailable.
 *
 * Each row is one of:
 *   - `{ teamA, teamB, participantsCount: 2 }` — normal head-to-head
 *   - `{ teamA, teamB: BYE, participantsCount: 1 }` — bye week
 *   - `{ combinedParticipants: [...], participantsCount: N }` — multi-team game
 */
export async function computeMatchupsForLeagueWeek(leagueId, week, rosterMap = null) {
  if (!rosterMap) {
    // Build the roster map AND latest-avatars overlay in parallel, mirroring
    // `computeStandingsForLeague` so the two paths stay visually identical.
    const [rmap, latestAvatars] = await Promise.all([
      getRosterMapWithOwners(leagueId).catch(() => ({})),
      getLatestOwnerAvatars().catch(() => ({})),
    ]);
    rosterMap = rmap;
    applyLatestAvatars(rosterMap, latestAvatars);
  }

  const leagueMeta = await getLeague(leagueId, 0).catch(() => null);
  const leagueSeason = leagueMeta?.season ? String(leagueMeta.season) : null;
  const seasonFormat =
    getSeasonFormat(leagueSeason, leagueMeta?.settings) ?? getSeasonFormat(2026);
  const { playoffStart, playoffEnd } = seasonFormat;
  const completedThroughWeek = getCompletedWeekForLeague(leagueMeta, playoffEnd);

  // Direct URL requests and stale cached selections must not reveal the
  // active week before its Monday 3:00 a.m. Eastern close.
  const requestedWeek = Number(week);
  if (!Number.isInteger(requestedWeek) || requestedWeek < 1 || requestedWeek > playoffEnd || requestedWeek > completedThroughWeek) {
    return { week, playoffStart, playoffEnd, leagueSeason, completedThroughWeek, matchupsRows: [] };
  }

  // Use the saved matchup snapshot for active and completed seasons alike.
  // It supplies team-score overrides and the per-player starter arrays.
  let seasonMatchups = null;
  if (leagueSeason) {
    seasonMatchups = await loadSeasonMatchups(leagueSeason);
  }
  if (seasonMatchups && Array.isArray(seasonMatchups[String(week)])) {
    const arr = seasonMatchups[String(week)];
    return {
      week,
      playoffStart,
      playoffEnd,
      leagueSeason,
      completedThroughWeek,
      matchupsRows: arr.map((m) => ({
        matchup_id: m.matchup_id ?? null,
        week,
        season: leagueSeason,
        teamA: m.teamA ? buildTeamFromStatic(m.teamA, m.teamAScore, rosterMap) : null,
        teamB: m.teamB ? buildTeamFromStatic(m.teamB, m.teamBScore, rosterMap) : null,
        participantsCount: (m.teamA ? 1 : 0) + (m.teamB ? 1 : 0),
      })),
    };
  }

  // Live fallback is context-only. buildTeamFromLive deliberately omits
  // scores and all starter fields so recap leaderboards never switch away
  // from the saved year JSON.
  let raw = null;
  try {
    raw = await getMatchupsForWeek(leagueId, week);
  } catch (e) {
    raw = [];
  }
  if (!Array.isArray(raw)) raw = [];

  // Group entries by matchup id to pair them into rows.
  const byMatch = {};
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    const mid = e.matchup_id ?? e.matchupId ?? null;
    const wk = e.week ?? week;
    const key = String(mid != null ? mid + '|' + wk : 'auto|' + wk + '|' + i);
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  const rows = [];
  for (const k of Object.keys(byMatch)) {
    const entries = byMatch[k];
    if (entries.length === 1) {
      const a = entries[0];
      const aId = String(a.roster_id ?? a.rosterId ?? 'unknown');
      rows.push({
        matchup_id: k,
        week,
        season: leagueSeason,
        teamA: buildTeamFromLive(aId, rosterMap, a),
        teamB: {
          rosterId: null,
          name: 'BYE',
          avatar: null,
          points: null,
          starters: null,
          starters_points: null,
        },
        participantsCount: 1,
      });
    } else if (entries.length === 2) {
      const [a, b] = entries;
      rows.push({
        matchup_id: k,
        week,
        season: leagueSeason,
        teamA: buildTeamFromLive(String(a.roster_id ?? a.rosterId ?? ''), rosterMap, a),
        teamB: buildTeamFromLive(String(b.roster_id ?? b.rosterId ?? ''), rosterMap, b),
        participantsCount: 2,
      });
    } else {
      rows.push({
        matchup_id: k,
        week,
        season: leagueSeason,
        combinedParticipants: entries.map((en) =>
          buildTeamFromLive(String(en.roster_id ?? en.rosterId ?? ''), rosterMap, en)
        ),
        participantsCount: entries.length,
      });
    }
  }
  return { week, playoffStart, playoffEnd, leagueSeason, completedThroughWeek, matchupsRows: rows };
}

