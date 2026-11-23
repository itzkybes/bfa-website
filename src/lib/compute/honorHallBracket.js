// Shared Honor Hall bracket classification and empty layout template.
// Every season from 2023 onward uses the same 2025-style bracket sections.

function bracketFeed(match, side) {
  const source = match?.[side === 't1' ? 't1_from' : 't2_from'];
  if (!source || typeof source !== 'object') return null;
  if (source.w != null) return { matchId: String(source.w), outcome: 'winner' };
  if (source.l != null) return { matchId: String(source.l), outcome: 'loser' };
  return null;
}

function isWinnersPlacementMatch(match, matches, season) {
  const round = Number(match.r) || 1;
  if (round === 1) return false;
  if (typeof match.__placement === 'boolean') return match.__placement;

  // Sleeper's p field is the finishing-place number. For an eight-team
  // playoff, p=5 and p=7 are the 5th/6th and 7th/8th placement games.
  // Keep p=3 (the 3rd/4th-place game) in the main championship bracket.
  // This identifies unplayed placement matchups before team IDs exist.
  // The 2026+ league data uses round-two placement markers above 1 for the
  // two games that decide 5th–8th. Keep the round-three p=3 game (3rd/4th)
  // in the championship bracket; only p=5/p=7 are round-three placements.
  if (Number(season) >= 2026 && round === 2 && Number(match.p) > 1) return true;
  if (Number(season) >= 2023 && Number(match.p) >= 5) return true;

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
      if (Number(season) >= 2026 && Number(candidate.r) === 2 && Number(candidate.p) > 1) return true;
      if (Number(season) >= 2023 && Number(candidate.p) >= 5) return true;

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
    return isWinnersPlacementMatch(match, allMatches, season);
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
 * Split every bracket into the same planned main and placement sections.
 * For 2023 onward, complete missing matchup slots with empty cards from the
 * standard template. This keeps every round and the placement section
 * visible while future games have not yet been played or published.
 */
export function getBracketDisplaySections(matches = [], bracketType = 'winners', season = null) {
  const allMatches = Array.isArray(matches) ? matches : [];
  let mainMatches = allMatches.filter(
    (match) => !isBracketPlacementMatch(match, bracketType, allMatches, season)
  );
  let placementMatches = allMatches.filter(
    (match) => isBracketPlacementMatch(match, bracketType, allMatches, season)
  );

  if (Number(season) >= 2023) {
    const template = createEmptyBracketTemplate(bracketType);
    const expectedMain = template.filter(
      (match) => !isBracketPlacementMatch(match, bracketType, template, season)
    );
    const expectedPlacement = template.filter(
      (match) => isBracketPlacementMatch(match, bracketType, template, season)
    );

    const countRounds = (list) => {
      const counts = new Map();
      for (const match of list) {
        const round = Number(match.r) || 1;
        counts.set(round, (counts.get(round) || 0) + 1);
      }
      return counts;
    };
    const mainCounts = countRounds(expectedMain);
    const placementCounts = countRounds(expectedPlacement);
    const rounds = [...new Set([...mainCounts.keys(), ...placementCounts.keys()])]
      .sort((a, b) => a - b);
    const byMatchId = (a, b) => {
      const left = Number(a.m), right = Number(b.m);
      if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
      return String(a.m ?? '').localeCompare(String(b.m ?? ''));
    };

    const completedMain = [];
    const completedPlacement = [];

    for (const round of rounds) {
      const mainLimit = mainCounts.get(round) || 0;
      const placementLimit = placementCounts.get(round) || 0;
      let roundMain = mainMatches
        .filter((match) => (Number(match.r) || 1) === round)
        .slice()
        .sort(byMatchId);
      let roundPlacement = placementMatches
        .filter((match) => (Number(match.r) || 1) === round)
        .slice()
        .sort(byMatchId);

      // Sleeper can publish empty round-two / round-three matchup shells
      // without p or feeder metadata. In that case the simple classifier
      // cannot distinguish them, so more than the expected number of games
      // can land in the main bracket. Cap each section to the shared 2025
      // structure and move overflow into the corresponding placement slots.
      const overflowMain = roundMain.splice(mainLimit);
      const overflowPlacement = roundPlacement.splice(placementLimit);

      while (roundMain.length < mainLimit && overflowPlacement.length) {
        roundMain.push(overflowPlacement.shift());
      }
      while (roundPlacement.length < placementLimit && overflowMain.length) {
        roundPlacement.push(overflowMain.shift());
      }

      // Fill any remaining missing slots with blank template cards. This
      // keeps partial API responses visually identical to complete brackets.
      const mainSlots = expectedMain.filter((match) => (Number(match.r) || 1) === round);
      while (roundMain.length < mainLimit) {
        const index = roundMain.length;
        const slot = mainSlots[index];
        if (!slot) break;
        roundMain.push({
          ...slot,
          m: `empty-${bracketType}-main-r${round}-${index + 1}`,
          t1: null,
          t2: null,
          w: null,
          l: null,
        });
      }

      const placementSlots = expectedPlacement.filter((match) => (Number(match.r) || 1) === round);
      while (roundPlacement.length < placementLimit) {
        const index = roundPlacement.length;
        const slot = placementSlots[index];
        if (!slot) break;
        roundPlacement.push({
          ...slot,
          m: `empty-${bracketType}-placement-r${round}-${index + 1}`,
          t1: null,
          t2: null,
          w: null,
          l: null,
        });
      }

      completedMain.push(...roundMain.slice(0, mainLimit));
      completedPlacement.push(...roundPlacement.slice(0, placementLimit));
    }

    mainMatches = completedMain;
    placementMatches = completedPlacement;
  }

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
      createMatch(2, 7, true, { l: 1 }, { l: 2 }, 5),
      createMatch(2, 8, true, { l: 3 }, { l: 4 }, 7),
    ];
    const roundThree = [
      createMatch(3, 9, false, { w: 5 }, { w: 6 }, 1),
      createMatch(3, 10, false, { l: 5 }, { l: 6 }, 3),
      createMatch(3, 11, true, { w: 7 }, { w: 8 }, 5),
      createMatch(3, 12, true, { l: 7 }, { l: 8 }, 7),
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
  if (Number(season) >= 2023) {
    const hasAssignedTeams = matches.some((match) =>
      match.t1 != null || match.t2 != null || match.w != null || match.l != null
    );

    // Keep any matchup data Sleeper has already published. The display
    // section builder fills missing slots without throwing away results.
    // Only use the full blank scaffold when there is no assigned team data.
    if (!hasAssignedTeams) {
      return createEmptyBracketTemplate(bracketType, playoffTeams, toiletBowlTeams);
    }
  }
  return matches;
}
