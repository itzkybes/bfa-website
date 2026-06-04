// src/lib/compute/brackets.js
//
// Final-standings computation from Sleeper's bracket payloads + the
// championship-game lookup used for Finals MVP.

// Last-resort champion fallback for historical seasons where the Sleeper
// brackets endpoint comes back incomplete. Keys are season year, values are
// the Sleeper username of the actual champion.
export const HARDCODED_CHAMPIONS = {
  '2022': 'riguy506',
  '2023': 'armyjunior',
  '2024': 'riguy506'
};

/**
 * Resolve the full 1st → last final standings using Sleeper's bracket data.
 *
 * Two brackets are consulted:
 *   - winners bracket: standard logic. `w` (winner) takes placement `p`,
 *     `l` (loser) takes `p + 1`.
 *   - losers bracket (the Toilet Bowl): INVERTED — the team that keeps WINNING
 *     in this bracket is the "Toilet Bowl Champion" = absolute LAST place.
 *     So `w` takes the WORSE rank and `l` takes the BETTER rank.
 *
 * Anything the brackets don't cover (typical for in-progress seasons) falls
 * back to regular-season order so the table is never empty.
 *
 * Returns `{ finalRanking, champion, bracketComplete, championshipMatch }`.
 * `bracketComplete` is true only when a real `p === 1` match has a winner —
 * we never crown a champion mid-season.
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
 * Locate the championship game in a winners bracket — that's the single match
 * tagged with `p === 1`. We use this for the "Finals MVP" calculation, which is
 * just the top scorer in this one game (across BOTH finalists), not the
 * champion's top scorer across the entire playoff window.
 *
 * Returns `null` if the bracket hasn't reached a championship match yet.
 */
export function getChampionshipGame(winnersBracket, playoffStart) {
  const wb = Array.isArray(winnersBracket) ? winnersBracket : [];
  const champMatch = wb.find((m) => m && Number(m.p) === 1 && m.w != null);
  if (!champMatch) return null;

  // Sleeper rounds: round 1 = first playoff week, so week = playoffStart + (r - 1).
  const round = Number(champMatch.r);
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
