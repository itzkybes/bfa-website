// src/lib/compute/matchups.js
//
// Per-week matchup rows for the `/matchups` page. Two paths:
//   · Static snapshot when the league is complete AND a JSON exists.
//   · Live Sleeper API otherwise.

import {
  getLeague, getRosterMapWithOwners, getMatchupsForWeek, safeNum
} from '$lib/api/sleeper';
import { loadSeasonMatchups } from '$lib/api/staticSeasons';
import { computeParticipantPoints } from './scoring';
import { getLatestOwnerAvatars, applyLatestAvatars } from './avatars';

/**
 * Build the matchup rows for one league + week. This is the data the
 * `/matchups` page renders.
 *
 * Source-of-truth rule:
 *   · If the league has `status === 'complete'` AND a static snapshot exists
 *     at `/static/season_matchups/{year}.json`, use the snapshot —
 *     `teamAScore` / `teamBScore` are the authoritative final scores.
 *   · Otherwise (in-progress season, or no snapshot yet), call Sleeper.
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
      getLatestOwnerAvatars().catch(() => ({}))
    ]);
    rosterMap = rmap;
    applyLatestAvatars(rosterMap, latestAvatars);
  }

  const leagueMeta = await getLeague(leagueId).catch(() => null);
  const leagueSeason = leagueMeta?.season ? String(leagueMeta.season) : null;
  let playoffStart = leagueMeta?.settings?.playoff_week_start ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  // League policy: 4-week playoffs (last 2 weeks are the merged final).
  let playoffEnd = playoffStart + 3;

  // Static-snapshot path (completed seasons only).
  const isLeagueComplete = leagueMeta?.status === 'complete';
  let seasonMatchups = null;
  if (isLeagueComplete && leagueSeason) {
    seasonMatchups = await loadSeasonMatchups(leagueSeason);
  }
  if (seasonMatchups && Number.isFinite(seasonMatchups.playoff_week_end)) {
    playoffEnd = Number(seasonMatchups.playoff_week_end);
  }

  if (seasonMatchups && Array.isArray(seasonMatchups[String(week)])) {
    const arr = seasonMatchups[String(week)];
    return {
      week, playoffStart, playoffEnd, leagueSeason,
      matchupsRows: arr.map((m) => ({
        matchup_id: m.matchup_id ?? null,
        week,
        season: leagueSeason,
        teamA: m.teamA ? buildTeamFromStatic(m.teamA, m.teamAScore, rosterMap) : null,
        teamB: m.teamB ? buildTeamFromStatic(m.teamB, m.teamBScore, rosterMap) : null,
        participantsCount: (m.teamA ? 1 : 0) + (m.teamB ? 1 : 0)
      }))
    };
  }

  // Live API path.
  let raw = null;
  try { raw = await getMatchupsForWeek(leagueId, week); } catch (e) { raw = []; }
  if (!Array.isArray(raw)) raw = [];

  // Group entries by matchup id to pair them into rows.
  const byMatch = {};
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    const mid = e.matchup_id ?? e.matchupId ?? null;
    const wk = e.week ?? week;
    const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + i));
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
        matchup_id: k, week, season: leagueSeason,
        teamA: buildTeamFromLive(aId, rosterMap, a),
        teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, starters: null, starters_points: null },
        participantsCount: 1
      });
    } else if (entries.length === 2) {
      const [a, b] = entries;
      rows.push({
        matchup_id: k, week, season: leagueSeason,
        teamA: buildTeamFromLive(String(a.roster_id ?? a.rosterId ?? ''), rosterMap, a),
        teamB: buildTeamFromLive(String(b.roster_id ?? b.rosterId ?? ''), rosterMap, b),
        participantsCount: 2
      });
    } else {
      rows.push({
        matchup_id: k, week, season: leagueSeason,
        combinedParticipants: entries.map((en) => buildTeamFromLive(String(en.roster_id ?? en.rosterId ?? ''), rosterMap, en)),
        participantsCount: entries.length
      });
    }
  }
  return { week, playoffStart, playoffEnd, leagueSeason, matchupsRows: rows };
}

/**
 * Shape one live Sleeper matchup entry into the row format the UI expects.
 * Carries through `starters` + `starters_points` only — `player_points`
 * is deliberately omitted (project policy: starters_points is the sole
 * source of truth for per-player scoring).
 */
function buildTeamFromLive(rid, rosterMap, entry) {
  const meta = rosterMap[rid] || {};
  return {
    rosterId: rid,
    name: meta.team_name || meta.owner_name || ('Roster ' + rid),
    ownerName: meta.owner_name || null,
    avatar: meta.team_avatar || meta.owner_avatar || null,
    points: computeParticipantPoints(entry),
    starters: entry?.starters ?? null,
    starters_points: entry?.starters_points ?? null
  };
}

/** Same as `buildTeamFromLive`, but the entry comes from a static JSON. */
function buildTeamFromStatic(t, score, rosterMap) {
  const rid = String(t.rosterId ?? t.roster_id ?? '');
  const meta = rid && rosterMap[rid] ? rosterMap[rid] : {};
  return {
    rosterId: rid,
    name: t.name ?? meta.team_name ?? null,
    ownerName: t.ownerName ?? meta.owner_name ?? null,
    // Same fallback ladder as `buildTeamFromLive`.
    avatar: t.avatar ?? meta.team_avatar ?? meta.owner_avatar ?? null,
    points: safeNum(score ?? t.score ?? t.points ?? 0),
    starters: t.starters ?? null,
    starters_points: t.starters_points ?? null
  };
}
