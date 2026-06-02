// src/lib/leagueCompute.client.js
// Browser-safe helpers ported from the previous server-side load functions.
// Keep these as pure functions so we can reuse them across +page.svelte components.

import { safeNum, getLeague, getRosterMapWithOwners, getMatchupsForWeek, getSeasonsChain, getPlayersNba, getWinnersBracket, getLosersBracket } from './sleeperClient.client';

const BASE_LEAGUE_ID = '1219816671624048640';
const MAX_WEEKS = 25;

function computeStreaks(resultsArray) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  if (!Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
  for (const r of resultsArray) {
    if (r === 'W') { curW += 1; curL = 0; if (curW > maxW) maxW = curW; }
    else if (r === 'L') { curL += 1; curW = 0; if (curL > maxL) maxL = curL; }
    else { curW = 0; curL = 0; }
  }
  return { maxW, maxL };
}

function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  const arrayKeys = ['starters_points', 'starter_points', 'startersPoints', 'starterPoints'];
  for (const k of arrayKeys) {
    if (Array.isArray(entry[k]) && entry[k].length) {
      let s = 0;
      for (const v of entry[k]) s += safeNum(v);
      return Math.round(s * 100) / 100;
    }
  }
  if (Array.isArray(entry.starters) && entry.player_points && typeof entry.player_points === 'object') {
    let s = 0;
    for (const st of entry.starters) s += safeNum(entry.player_points[String(st)] ?? entry.player_points[st]);
    return Math.round(s * 100) / 100;
  }
  const fallback = safeNum(entry.points ?? entry.points_for ?? entry.pts ?? entry.score ?? 0);
  return Math.round(fallback * 100) / 100;
}

/** Try fetching a static asset (relative URL). Returns parsed JSON or null. */
async function fetchStaticJson(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

export const HARDCODED_CHAMPIONS = {
  '2022': 'riguy506',
  '2023': 'armyjunior',
  '2024': 'riguy506'
};

/**
 * Resolve final standings (1st → last) using the Sleeper winners + losers brackets.
 * Each bracket entry has `p` (the placement determined by that match) and `w` (winner roster_id).
 *
 * Returns { finalRanking, champion, bracketComplete }
 *   - bracketComplete: true only if a real championship match (p === 1 with a winner) exists.
 *     Used to avoid counting an in-progress season's "leader" as a champion.
 *   - For unresolved positions, falls back to regular-season order.
 */
export function resolveFinalStandingsFromBrackets(winnersBracket, losersBracket, regularStandings, playoffTeamCount) {
  const ranking = new Map(); // rosterId -> rank
  const wbBrackets = Array.isArray(winnersBracket) ? winnersBracket : [];
  const lbBrackets = Array.isArray(losersBracket) ? losersBracket : [];

  // A season is "complete" if the championship match (p === 1) exists AND has a winner.
  let championshipMatch = null;
  for (const m of wbBrackets) {
    if (m && Number(m.p) === 1 && m.w != null) { championshipMatch = m; break; }
  }
  const bracketComplete = championshipMatch != null;

  function placeFromMatch(match) {
    if (!match || match.p == null) return;
    const p = Number(match.p);
    if (!isFinite(p) || p < 1) return;
    if (match.w != null && !ranking.has(String(match.w))) ranking.set(String(match.w), p);
    if (match.l != null && !ranking.has(String(match.l))) ranking.set(String(match.l), p + 1);
  }

  for (const m of wbBrackets) placeFromMatch(m);

  // Losers bracket = Toilet Bowl.
  // In a Toilet Bowl, the team that WINS the bracket is the "Toilet Bowl Champion"
  // — i.e., the absolute LAST place team in the league. Whichever team keeps
  // advancing through the losers bracket (game-winner each round) ends up at the
  // bottom; the team eliminated FIRST (the game-loser) gets the BEST losers-bracket
  // placement. So we INVERT placement assignment compared to the winners bracket.
  //
  // Sleeper's `p` for the losers bracket: relative (1 = championship of toilet bowl
  // = absolute last place; higher `p` = consolation games closer to playoff cutoff).
  const totalRosters = Array.isArray(regularStandings) ? regularStandings.length : (playoffTeamCount + lbBrackets.length);
  const lbPs = lbBrackets.map((x) => Number(x.p)).filter((n) => isFinite(n) && n >= 1);
  const lbIsRelative = lbPs.length === 0 || Math.min(...lbPs) <= 2;
  for (const m of lbBrackets) {
    if (!m || m.p == null) continue;
    const pRaw = Number(m.p);
    if (!isFinite(pRaw)) continue;
    // Two adjacent placements determined by this match (worsePlace > betterPlace).
    let worsePlace, betterPlace;
    if (lbIsRelative) {
      // pRaw=1 → covers (last, 2nd-to-last); pRaw=3 → covers (3rd-to-last, 4th-to-last); etc.
      worsePlace = totalRosters - pRaw + 1;
      betterPlace = totalRosters - pRaw;
    } else {
      // Absolute placement label. The match still flips winner ↔ loser under
      // toilet-bowl rules: game-loser gets the better label (pRaw), game-winner
      // gets the worse label (pRaw + 1).
      betterPlace = pRaw;
      worsePlace = pRaw + 1;
    }
    // Game-winner (`w`) gets the WORSE placement (continues advancing through
    // the toilet bowl). Game-loser (`l`) gets the BETTER placement (escapes).
    if (m.w != null && !ranking.has(String(m.w))) ranking.set(String(m.w), worsePlace);
    if (m.l != null && !ranking.has(String(m.l))) ranking.set(String(m.l), betterPlace);
  }

  // Fallback for any roster the brackets didn't cover — use regular-season order.
  const remainingRanks = [];
  for (let i = 1; i <= regularStandings.length; i++) {
    if (![...ranking.values()].includes(i)) remainingRanks.push(i);
  }
  let fallbackIdx = 0;
  for (const row of regularStandings) {
    if (!ranking.has(String(row.rosterId))) {
      const rank = remainingRanks[fallbackIdx++] ?? (regularStandings.length + 1);
      ranking.set(String(row.rosterId), rank);
    }
  }

  const finalRanking = [...ranking.entries()]
    .map(([rosterId, rank]) => ({ rosterId, rank }))
    .sort((a, b) => a.rank - b.rank);

  // Champion is only valid if the bracket actually crowned one (championshipMatch.w),
  // not just whoever is currently leading the regular season.
  const champion = bracketComplete ? String(championshipMatch.w) : null;
  return { finalRanking, champion, bracketComplete, championshipMatch };
}

/**
 * Identify the championship game (the single bracket match where `p === 1`)
 * and return:
 *   - week: the week number that match was played (derived from the round `r`,
 *           assuming each playoff round = one week)
 *   - rosterIds: [t1, t2] — the two finalists' roster ids as strings
 *   - winnerRosterId / loserRosterId
 * Returns null if no such match exists (bracket incomplete).
 *
 * Finals MVP = top scorer in this single championship game (across BOTH finalists),
 * NOT the champion's top scorer across the whole playoff window.
 */
export function getChampionshipGame(winnersBracket, playoffStart) {
  const wb = Array.isArray(winnersBracket) ? winnersBracket : [];
  const champMatch = wb.find((m) => m && Number(m.p) === 1 && m.w != null);
  if (!champMatch) return null;
  const round = Number(champMatch.r);
  // Sleeper convention: round 1 = first playoff week. round N = playoffStart + (N-1).
  const week = isFinite(round) && round >= 1 ? (playoffStart + (round - 1)) : null;
  const t1 = champMatch.t1 != null ? String(champMatch.t1) : (champMatch.w != null ? String(champMatch.w) : null);
  const t2 = champMatch.t2 != null ? String(champMatch.t2) : (champMatch.l != null ? String(champMatch.l) : null);
  return {
    week,
    rosterIds: [t1, t2].filter(Boolean),
    winnerRosterId: champMatch.w != null ? String(champMatch.w) : null,
    loserRosterId: champMatch.l != null ? String(champMatch.l) : null,
    match: champMatch
  };
}

/* ============================================================
 *   LATEST OWNER AVATARS (memoized)
 *   Build a {owner_username: {team_avatar, team_name}} map from
 *   the CURRENT base league so historical seasons can display
 *   each owner's most recent logo / team name.
 * ============================================================ */
let _latestAvatarsPromise = null;
export function getLatestOwnerAvatars() {
  if (_latestAvatarsPromise) return _latestAvatarsPromise;
  _latestAvatarsPromise = (async () => {
    try {
      const map = await getRosterMapWithOwners(BASE_LEAGUE_ID);
      const out = {};
      for (const rid of Object.keys(map)) {
        const m = map[rid] || {};
        const key = (m.owner_username || m.owner_name || '').toLowerCase();
        if (!key) continue;
        out[key] = {
          team_avatar: m.team_avatar || null,
          owner_avatar: m.owner_avatar || null,
          team_name: m.team_name || null
        };
      }
      return out;
    } catch (e) {
      return {};
    }
  })();
  return _latestAvatarsPromise;
}

/* ============================================================
 *   STANDINGS (per league)
 * ============================================================ */
export async function computeStandingsForLeague(leagueId) {
  // Fetch league + rosters + brackets + LATEST owner avatars in parallel.
  const [leagueMeta, rosterMap, winnersBracket, losersBracket, latestAvatars] = await Promise.all([
    getLeague(leagueId).catch(() => null),
    getRosterMapWithOwners(leagueId).catch(() => ({})),
    getWinnersBracket(leagueId).catch(() => []),
    getLosersBracket(leagueId).catch(() => []),
    getLatestOwnerAvatars().catch(() => ({}))
  ]);

  // Overlay each roster's logo + team_name with the OWNER'S CURRENT (BASE_LEAGUE_ID)
  // values so historical seasons display the most recent branding.
  // Matched by owner_username (Sleeper user identity is stable across seasons).
  for (const rid of Object.keys(rosterMap)) {
    const meta = rosterMap[rid];
    if (!meta) continue;
    const key = (meta.owner_username || meta.owner_name || '').toLowerCase();
    if (!key) continue;
    const latest = latestAvatars[key];
    if (!latest) continue;
    if (latest.team_avatar) meta.team_avatar = latest.team_avatar;
    if (latest.owner_avatar && !meta.owner_avatar) meta.owner_avatar = latest.owner_avatar;
    // Prefer latest team_name only if it looks "personal" (not a generic "Roster N").
    if (latest.team_name && !String(latest.team_name).startsWith('Roster ')) {
      meta.team_name = latest.team_name;
    }
  }

  const leagueSeason = leagueMeta?.season ? String(leagueMeta.season) : null;
  const leagueName = leagueMeta?.name ?? null;
  const playoffTeams = leagueMeta?.settings?.playoff_teams ? Number(leagueMeta.settings.playoff_teams) : 8;

  let playoffStart = (leagueMeta?.settings?.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  const playoffEnd = playoffStart + 2;

  const statsByRosterRegular = {}, resultsByRosterRegular = {}, paByRosterRegular = {};
  const statsByRosterPlayoff = {}, resultsByRosterPlayoff = {}, paByRosterPlayoff = {};

  for (const rk of Object.keys(rosterMap)) {
    statsByRosterRegular[rk] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk].roster_raw || null };
    resultsByRosterRegular[rk] = []; paByRosterRegular[rk] = 0;
    statsByRosterPlayoff[rk] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk].roster_raw || null };
    resultsByRosterPlayoff[rk] = []; paByRosterPlayoff[rk] = 0;
  }

  // Try seasonMatchups + early2023 in parallel
  const [seasonMatchups, earlyData] = await Promise.all([
    leagueSeason && ['2022', '2023', '2024'].includes(leagueSeason)
      ? fetchStaticJson(`/season_matchups/${leagueSeason}.json`)
      : Promise.resolve(null),
    leagueSeason === '2023' ? fetchStaticJson('/early2023.json') : Promise.resolve(null)
  ]);

  // Fetch ALL weeks in parallel (instead of sequential)
  const weekFetches = [];
  for (let week = 1; week <= MAX_WEEKS; week++) {
    if (seasonMatchups && seasonMatchups[String(week)] && Array.isArray(seasonMatchups[String(week)])) {
      // synthesize from static JSON
      const transformed = [];
      for (const m of seasonMatchups[String(week)]) {
        if (m.teamA) {
          const ridA = String(m.teamA.rosterId ?? m.teamA.roster_id ?? '');
          if (ridA) transformed.push({
            week, roster_id: ridA, matchup_id: m.matchup_id ?? null,
            points: safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? 0),
            // Pass starters + per-player points through so MVP aggregator
            // (records-player / honor-hall) can break down by player for
            // historical seasons sourced from the static JSON.
            starters: Array.isArray(m.teamA.starters) ? m.teamA.starters : null,
            starters_points: Array.isArray(m.teamA.starters_points) ? m.teamA.starters_points : null,
            player_points: m.teamA.player_points ?? null,
            __team_name: m.teamA.name ?? null, __owner_name: m.teamA.ownerName ?? null
          });
        }
        if (m.teamB) {
          const ridB = String(m.teamB.rosterId ?? m.teamB.roster_id ?? '');
          if (ridB) transformed.push({
            week, roster_id: ridB, matchup_id: m.matchup_id ?? null,
            points: safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? 0),
            starters: Array.isArray(m.teamB.starters) ? m.teamB.starters : null,
            starters_points: Array.isArray(m.teamB.starters_points) ? m.teamB.starters_points : null,
            player_points: m.teamB.player_points ?? null,
            __team_name: m.teamB.name ?? null, __owner_name: m.teamB.ownerName ?? null
          });
        }
      }
      weekFetches.push(Promise.resolve({ week, matchups: transformed }));
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

  // Process week by week using fetched data
  const collectedMatchups = {}; // week -> matchup entries
  for (const { week, matchups } of allWeekResults) {
    if (!matchups || !matchups.length) continue;
    collectedMatchups[week] = matchups;

    const isRegularWeek = (week >= 1 && week < playoffStart);
    const isPlayoffWeek = (week >= playoffStart && week <= playoffEnd);
    if (!isRegularWeek && !isPlayoffWeek) continue;

    const statsByRoster = isPlayoffWeek ? statsByRosterPlayoff : statsByRosterRegular;
    const resultsByRoster = isPlayoffWeek ? resultsByRosterPlayoff : resultsByRosterRegular;
    const paByRoster = isPlayoffWeek ? paByRosterPlayoff : paByRosterRegular;

    // build early-week override map
    let earlyWeekMap = null;
    if (earlyData && earlyData['2023'] && earlyData['2023'][String(week)] && week >= 1 && week <= 3) {
      earlyWeekMap = {};
      for (const e of earlyData['2023'][String(week)]) {
        const aOwner = e.teamA?.ownerName ? String(e.teamA.ownerName).toLowerCase() : null;
        const bOwner = e.teamB?.ownerName ? String(e.teamB.ownerName).toLowerCase() : null;
        const aTeam = e.teamA?.name ? String(e.teamA.name).toLowerCase() : null;
        const bTeam = e.teamB?.name ? String(e.teamB.name).toLowerCase() : null;
        if (aOwner) earlyWeekMap['owner:' + aOwner] = safeNum(e.teamAScore ?? 0);
        if (bOwner) earlyWeekMap['owner:' + bOwner] = safeNum(e.teamBScore ?? 0);
        if (aTeam) earlyWeekMap['team:' + aTeam] = safeNum(e.teamAScore ?? 0);
        if (bTeam) earlyWeekMap['team:' + bTeam] = safeNum(e.teamBScore ?? 0);
      }
    }

    // group entries by matchup id
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

      if (entries.length === 1) {
        const only = entries[0];
        const ridOnly = String(only.roster_id ?? only.rosterId ?? '');
        statsByRoster[ridOnly] = statsByRoster[ridOnly] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
        resultsByRoster[ridOnly] = resultsByRoster[ridOnly] || [];
        paByRoster[ridOnly] = paByRoster[ridOnly] || 0;
        let pts = null;
        if (earlyWeekMap) {
          const meta = rosterMap[ridOnly] || {};
          const ownerLow = (meta.owner_name || meta.owner_username) ? String(meta.owner_name || meta.owner_username).toLowerCase() : null;
          const teamLow = meta.team_name ? String(meta.team_name).toLowerCase() : null;
          if (ownerLow && earlyWeekMap['owner:' + ownerLow] != null) pts = earlyWeekMap['owner:' + ownerLow];
          else if (teamLow && earlyWeekMap['team:' + teamLow] != null) pts = earlyWeekMap['team:' + teamLow];
        }
        if (pts == null) pts = computeParticipantPoints(only);
        statsByRoster[ridOnly].pf += pts;
        continue;
      }

      const participants = [];
      for (const en of entries) {
        const pid = String(en.roster_id ?? en.rosterId ?? '');
        let ppts = null;
        if (earlyWeekMap) {
          const meta = rosterMap[pid] || {};
          const ownerLow = (meta.owner_name || meta.owner_username) ? String(meta.owner_name || meta.owner_username).toLowerCase() : null;
          const teamLow = meta.team_name ? String(meta.team_name).toLowerCase() : null;
          if (ownerLow && earlyWeekMap['owner:' + ownerLow] != null) ppts = earlyWeekMap['owner:' + ownerLow];
          else if (teamLow && earlyWeekMap['team:' + teamLow] != null) ppts = earlyWeekMap['team:' + teamLow];
        }
        if (ppts == null) ppts = computeParticipantPoints(en);
        participants.push({ rosterId: pid, points: ppts });
        statsByRoster[pid] = statsByRoster[pid] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
        resultsByRoster[pid] = resultsByRoster[pid] || [];
        paByRoster[pid] = paByRoster[pid] || 0;
        statsByRoster[pid].pf += ppts;
      }

      for (let pi = 0; pi < participants.length; pi++) {
        const part = participants[pi];
        const others = participants.filter((_, i) => i !== pi);
        const oppAvg = others.length ? others.reduce((s, o) => s + o.points, 0) / others.length : 0;
        paByRoster[part.rosterId] += oppAvg;
        if (part.points > oppAvg + 1e-9) { resultsByRoster[part.rosterId].push('W'); statsByRoster[part.rosterId].wins += 1; }
        else if (part.points < oppAvg - 1e-9) { resultsByRoster[part.rosterId].push('L'); statsByRoster[part.rosterId].losses += 1; }
        else { resultsByRoster[part.rosterId].push('T'); statsByRoster[part.rosterId].ties += 1; }
      }
    }
  }

  function build(stats, results, pa) {
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

  const regularStandings = build(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular);
  const playoffStandings = build(statsByRosterPlayoff, resultsByRosterPlayoff, paByRosterPlayoff);

  // -----------------------------------------------------------
  // FINAL STANDINGS — derived from Sleeper's winners + losers brackets.
  // -----------------------------------------------------------
  const { finalRanking, champion: bracketChampionId, bracketComplete } = resolveFinalStandingsFromBrackets(
    winnersBracket,
    losersBracket,
    regularStandings,
    playoffTeams
  );

  // Build a unified finalStandings array, enriched with stats + meta
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

  // Stamp `champion: true` onto the matching playoffStandings row (only for completed brackets)
  if (bracketComplete && bracketChampionId) {
    for (const r of playoffStandings) {
      if (String(r.rosterId) === String(bracketChampionId)) { r.champion = true; break; }
    }
  } else if (!bracketComplete && leagueSeason && HARDCODED_CHAMPIONS[leagueSeason]) {
    // Fallback only if brackets weren't reachable AND we have a hardcoded fallback
    const championOwner = String(HARDCODED_CHAMPIONS[leagueSeason]).toLowerCase();
    for (const r of playoffStandings) {
      const meta = rosterMap[r.rosterId] || {};
      if (String(meta.owner_username || '').toLowerCase() === championOwner ||
          String(meta.owner_name || '').toLowerCase() === championOwner) {
        r.champion = true; break;
      }
    }
  }

  // Identify the championship game once so callers can compute Finals MVP
  // from just that single match.
  const championshipGame = getChampionshipGame(winnersBracket, playoffStart);

  return {
    leagueId: String(leagueId),
    season: leagueSeason,
    leagueName,
    regularStandings,
    playoffStandings,
    finalStandings,
    bracketChampionId,
    bracketComplete,
    championshipGame,
    rosterMap,
    playoffStart,
    playoffEnd,
    playoffTeams,
    winnersBracket,
    losersBracket,
    collectedMatchups // expose so callers can avoid re-fetching
  };
}

/* ============================================================
 *   MATCHUPS (per league + week)
 * ============================================================ */
export async function computeMatchupsForLeagueWeek(leagueId, week, rosterMap = null) {
  if (!rosterMap) rosterMap = await getRosterMapWithOwners(leagueId).catch(() => ({}));
  const leagueMeta = await getLeague(leagueId).catch(() => null);
  const leagueSeason = leagueMeta?.season ? String(leagueMeta.season) : null;
  let playoffStart = leagueMeta?.settings?.playoff_week_start ? Number(leagueMeta.settings.playoff_week_start) : 15;
  if (isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
  const playoffEnd = playoffStart + 2;

  // Try seasonMatchups static JSON first
  let seasonMatchups = null;
  if (leagueSeason && ['2022', '2023', '2024'].includes(leagueSeason)) {
    seasonMatchups = await fetchStaticJson(`/season_matchups/${leagueSeason}.json`);
  }
  let earlyData = null;
  if (leagueSeason === '2023' && week >= 1 && week <= 3) {
    earlyData = await fetchStaticJson('/early2023.json');
  }

  let raw = null;
  let usedStatic = false;
  if (seasonMatchups && seasonMatchups[String(week)] && Array.isArray(seasonMatchups[String(week)])) {
    usedStatic = true;
    const arr = seasonMatchups[String(week)];
    // Build matchupsRows directly from JSON
    return {
      week, playoffStart, playoffEnd, leagueSeason,
      matchupsRows: arr.map(m => ({
        matchup_id: m.matchup_id ?? null,
        week,
        season: leagueSeason,
        teamA: m.teamA ? normalizeTeamFromStatic(m.teamA, m.teamAScore, rosterMap) : null,
        teamB: m.teamB ? normalizeTeamFromStatic(m.teamB, m.teamBScore, rosterMap) : null,
        participantsCount: (m.teamA ? 1 : 0) + (m.teamB ? 1 : 0)
      }))
    };
  }

  try { raw = await getMatchupsForWeek(leagueId, week); } catch (e) { raw = []; }
  if (!Array.isArray(raw)) raw = [];

  // group by matchup_id
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
        teamA: makeTeam(aId, rosterMap, a),
        teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, starters: null, starters_points: null },
        participantsCount: 1
      });
      continue;
    }
    if (entries.length === 2) {
      const a = entries[0], b = entries[1];
      rows.push({
        matchup_id: k, week, season: leagueSeason,
        teamA: makeTeam(String(a.roster_id ?? a.rosterId ?? ''), rosterMap, a),
        teamB: makeTeam(String(b.roster_id ?? b.rosterId ?? ''), rosterMap, b),
        participantsCount: 2
      });
      continue;
    }
    // multi
    rows.push({
      matchup_id: k, week, season: leagueSeason,
      combinedParticipants: entries.map(en => makeTeam(String(en.roster_id ?? en.rosterId ?? ''), rosterMap, en)),
      participantsCount: entries.length
    });
  }
  return { week, playoffStart, playoffEnd, leagueSeason, matchupsRows: rows };
}

function makeTeam(rid, rosterMap, entry) {
  const meta = rosterMap[rid] || {};
  return {
    rosterId: rid,
    name: meta.team_name || meta.owner_name || ('Roster ' + rid),
    ownerName: meta.owner_name || null,
    avatar: meta.team_avatar || meta.owner_avatar || null,
    points: computeParticipantPoints(entry),
    starters: entry?.starters ?? null,
    starters_points: entry?.starters_points ?? null,
    player_points: entry?.player_points ?? null
  };
}

function normalizeTeamFromStatic(t, score, rosterMap) {
  const rid = String(t.rosterId ?? t.roster_id ?? '');
  const meta = rid && rosterMap[rid] ? rosterMap[rid] : {};
  return {
    rosterId: rid,
    name: t.name ?? meta.team_name ?? null,
    ownerName: t.ownerName ?? meta.owner_name ?? null,
    avatar: t.avatar ?? meta.team_avatar ?? null,
    points: safeNum(score ?? t.score ?? t.points ?? 0),
    starters: t.starters ?? null,
    starters_points: t.starters_points ?? null,
    player_points: t.player_points ?? null
  };
}

export { computeStreaks, computeParticipantPoints, fetchStaticJson, BASE_LEAGUE_ID, MAX_WEEKS };
