// Shared Honor Hall bracket classification used for every season from 2023 onward.
// Sleeper's feeder metadata is used first so future/unplayed brackets render
// the same placement split as completed historical brackets.

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

    // Sleeper assigns the 5th–8th place qualifiers placements 5 and 7.
    // This fallback also covers unplayed brackets without feeder metadata.
    return Number(match.p) >= 5;
  }

  if (round >= 3) {
    const roundTwoMatches = matches.filter((candidate) => (Number(candidate.r) || 1) === 2);
    const roundTwoPlacementMatches = roundTwoMatches.filter((candidate) => {
      const feeds = [bracketFeed(candidate, 't1'), bracketFeed(candidate, 't2')];
      if (feeds.every(Boolean)) return feeds.every((feed) => feed.outcome === 'loser');

      const teams = [candidate.t1, candidate.t2];
      if (teams.every((rosterId) => rosterId != null) && roundOneLosers.size) {
        return teams.every((rosterId) => roundOneLosers.has(String(rosterId)));
      }
      return Number(candidate.p) >= 5;
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

    // If the future round's feeder references are not included, the same
    // 5th/7th placement numbering identifies those final placement matchups.
    if (!feeds.some(Boolean)) return Number(match.p) >= 5;
  }

  return false;
}

function isToiletBowlPlacementMatch(match, matches, season) {
  const round = Number(match.r) || 1;
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
 * Returns true when a matchup belongs in the placement/consolation area
 * instead of the championship or Toilet Bowl advancement track.
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
