// Shared Honor Hall bracket classification and empty layout template.
// The template mirrors the BFA 2025 bracket shape for future seasons before
// Sleeper has created/populated its bracket matchups.

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

  // Synthetic empty slots carry an explicit placement flag. This is the
  // source of truth when an upcoming season has no Sleeper bracket payload.
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

/**
 * Create empty BFA bracket slots when Sleeper has not published a future
 * season's brackets yet. The returned objects use the same round and match
 * structure as populated brackets, so the existing UI renders identical
 * columns and placement groups with blank team rows.
 */
export function createEmptyBracketTemplate(bracketType, playoffTeams = 8, toiletBowlTeams = 6) {
  const teamCount = bracketType === 'winners' ? Number(playoffTeams) : Number(toiletBowlTeams);
  const gameCount = Math.ceil(teamCount / 2);
  if (!Number.isInteger(teamCount) || teamCount < 2 || gameCount < 1) return [];

  const mainGames = bracketType === 'winners' ? 2 : 1;
  const matches = [];

  for (let round = 1; round <= 3; round += 1) {
    for (let index = 0; index < gameCount; index += 1) {
      matches.push({
        r: round,
        m: index + 1,
        p: index + 1,
        t1: null,
        t2: null,
        w: null,
        l: null,
        __placement: round > 1 && index >= mainGames,
      });
    }
  }

  return matches;
}
