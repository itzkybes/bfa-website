// Shared Honor Hall bracket classification and empty layout template.
// Every season from 2023 onward uses the same 2025-style bracket sections.

function bracketFeed(match, side) {
  const source = match?.[side === 't1' ? 't1_from' : 't2_from'];
  if (!source || typeof source !== 'object') return null;
  if (source.w != null) return { matchId: String(source.w), outcome: 'winner' };
  if (source.l != null) return { matchId: String(source.l), outcome: 'loser' };
  return null;
}

function isWinnersPlacementMatch(match, matches) {
  const round = Number(match.r) || 1;
  if (round === 1) return false;
  if (typeof match.__placement === 'boolean') return match.__placement;

  const roundOneMatches = matches.filter((candidate) => (Number(candidate.r) || 1) === 1);
  const roundOneLosers = new Set(
    roundOneMatches
      .map((candidate) => candidate.l)
      .filter((rosterId) => rosterId != null)
      .map(String)
  );

  if (round === 2) {
    const feeds = [bracketFeed(match, 't1'), bracketFeed(match, 't2')];
    if (feeds.every(Boolean)) return feeds.every((feed) => feed.outcome === 'loser');

    const teams = [match.t1, match.t2];
    if (teams.every((rosterId) => rosterId != null) && roundOneLosers.size) {
      return teams.every((rosterId) => roundOneLosers.has(String(rosterId)));
    }
    return false;
  }

  if (round >= 3) {
    const roundTwoMatches = matches.filter((candidate) => (Number(candidate.r) || 1) === 2);
    const roundTwoPlacementMatches = roundTwoMatches.filter((candidate) => {
      if (typeof candidate.__placement === 'boolean') return candidate.__placement;

      const feeds = [bracketFeed(candidate, 't1'), bracketFeed(candidate, 't2')];
      if (feeds.every(Boolean)) return feeds.every((feed) => feed.outcome === 'loser');

      const teams = [candidate.t1, candidate.t2];
      if (teams.every((rosterId) => rosterId != null) && roundOneLosers.size) {
        return teams.every((rosterId) => roundOneLosers.has(String(rosterId)));
      }
      return false;
    });

    const placementTeams = new Set(
      roundTwoPlacementMatches
        .flatMap((candidate) => [candidate.t1, candidate.t2])
        .filter((rosterId) => rosterId != null)
        .map(String)
    );
    if ([match.t1, match.t2].some(
      (rosterId) => rosterId != null && placementTeams.has(String(rosterId))
    )) return true;

    const placementMatchIds = new Set(
      roundTwoPlacementMatches
        .map((candidate) => candidate.m)
        .filter((matchId) => matchId != null)
        .map(String)
    );
    const feeds = [bracketFeed(match, 't1'), bracketFeed(match, 't2')];
    if (feeds.some((feed) => feed && placementMatchIds.has(feed.matchId))) return true;
  }

  return false;
}

function isToiletBowlPlacementMatch(match, matches, season) {
  const round = Number(match.r) || 1;
  if (typeof match.__placement === 'boolean') return match.__placement;

  if (Number(season) === 2022 && round === 2) {
    const roundOneWinners = new Set(
      matches
        .filter((candidate) => (Number(candidate.r) || 1) === 1)
        .map((candidate) => candidate.w)
        .filter((rosterId) => rosterId != null)
        .map(String)
    );
    return ![match.t1, match.t2].every(
      (rosterId) => rosterId != null && roundOneWinners.has(String(rosterId))
    );
  }
  return round > 1 && Number(match.p) > 1;
}

/**
 * Returns true when a matchup belongs in the placement/consolation area.
 */
export function isBracketPlacementMatch(match, bracketType, matches = [], season = null) {
  if (!match) return false;
  const allMatches = Array.isArray(matches) ? matches : [];
  if ((Number(match.r) || 1) === 1) return false;

  if (bracketType === 'winners') {
    return isWinnersPlacementMatch(match, allMatches);
  }
  return isToiletBowlPlacementMatch(match, allMatches, season);
}

function groupBracketRounds(matches) {
  const grouped = new Map();
  for (const match of matches) {
    const round = Number(match.r) || 1;
    if (!grouped.has(round)) grouped.set(round, []);
    grouped.get(round).push(match);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, roundMatches]) => ({
      round,
      matches: roundMatches.slice().sort((a, b) => (Number(a.m) || 0) - (Number(b.m) || 0)),
    }));
}

/**
 * Split a bracket into the two shared 2023–2025 display areas.
 * This is the single source of truth for both the rendered columns and
 * their connector calculations, regardless of season.
 */
export function getBracketDisplaySections(matches = [], bracketType = 'winners', season = null) {
  const allMatches = Array.isArray(matches) ? matches : [];
  const mainMatches = allMatches.filter(
    (match) => !isBracketPlacementMatch(match, bracketType, allMatches, season)
  );
  const placementMatches = allMatches.filter(
    (match) => isBracketPlacementMatch(match, bracketType, allMatches, season)
  );

  return {
    mainMatches,
    placementMatches,
    mainRounds: groupBracketRounds(mainMatches),
    placementRounds: groupBracketRounds(placementMatches),
  };
}

function createMatch(round, matchId, placement, t1From = null, t2From = null, placementNumber = 1) {
  return {
    r: round,
    m: matchId,
    p: placementNumber,
    t1: null,
    t2: null,
    w: null,
    l: null,
    t1_from: t1From,
    t2_from: t2From,
    __placement: placement,
  };
}

/**
 * Build blank bracket games with the same 2025 structure:
 * - Championship: 4 first-round games, 2 semifinals + 2 placement games,
 *   then championship/third-place + 5th/6th and 7th/8th placement games.
 * - Six-team Toilet Bowl: 2 opening games (two byes), 2 semifinals + a
 *   5th/6th game, then Toilet Bowl championship + 3rd/4th placement game.
 *
 * Feed references preserve the bracket paths and connector lines even when
 * team IDs, winners, and scores have not been published by Sleeper yet.
 */
export function createEmptyBracketTemplate(bracketType, playoffTeams = 8, toiletBowlTeams = 6) {
  if (bracketType === 'winners') {
    const roundOne = [
      createMatch(1, 1, false),
      createMatch(1, 2, false),
      createMatch(1, 3, false),
      createMatch(1, 4, false),
    ];
    const roundTwo = [
      createMatch(2, 5, false, { w: 1 }, { w: 2 }, 1),
      createMatch(2, 6, false, { w: 3 }, { w: 4 }, 1),
      createMatch(2, 7, true, { l: 1 }, { l: 2 }, 3),
      createMatch(2, 8, true, { l: 3 }, { l: 4 }, 4),
    ];
    const roundThree = [
      createMatch(3, 9, false, { w: 5 }, { w: 6 }, 1),
      createMatch(3, 10, false, { l: 5 }, { l: 6 }, 2),
      createMatch(3, 11, true, { w: 7 }, { w: 8 }, 3),
      createMatch(3, 12, true, { l: 7 }, { l: 8 }, 4),
    ];
    return [...roundOne, ...roundTwo, ...roundThree];
  }

  if (bracketType === 'losers') {
    return [
      // Four lowest seeds open the Toilet Bowl; two higher seeds receive byes.
      createMatch(1, 1, false),
      createMatch(1, 2, false),
      // Two Toilet Bowl semifinals and the Round 1 losers' placement game.
      createMatch(2, 3, false, null, { w: 1 }, 1),
      createMatch(2, 4, false, null, { w: 2 }, 1),
      createMatch(2, 5, true, { l: 1 }, { l: 2 }, 3),
      // Toilet Bowl championship and the semifinal-losers placement game.
      createMatch(3, 6, false, { w: 3 }, { w: 4 }, 1),
      createMatch(3, 7, true, { l: 3 }, { l: 4 }, 3),
    ];
  }

  return [];
}

/**
 * Use the exact same three-round bracket structure for every season from
 * 2023 onward. If Sleeper has not published a complete bracket yet, provide
 * the shared empty structure rather than rendering a season-specific layout.
 * The 2022 season keeps its historical data handling.
 */
export function getBracketMatchesForDisplay(
  season,
  bracketType,
  savedMatches = [],
  playoffTeams = 8,
  toiletBowlTeams = 6
) {
  const matches = Array.isArray(savedMatches) ? savedMatches : [];
  const hasAssignedTeams = matches.some((match) =>
    match.t1 != null || match.t2 != null || match.w != null || match.l != null
  );
  const expectedRoundCounts = bracketType === 'winners' ? [4, 4, 4] : [2, 3, 2];
  const actualRoundCounts = [1, 2, 3].map((round) =>
    matches.filter((match) => (Number(match.r) || 1) === round).length
  );
  const hasSharedStructure = expectedRoundCounts.every(
    (count, index) => actualRoundCounts[index] === count
  );

  if (Number(season) >= 2023 && (!hasAssignedTeams || !hasSharedStructure)) {
    return createEmptyBracketTemplate(bracketType, playoffTeams, toiletBowlTeams);
  }
  return matches;
}
