// Pure helpers for the Trends page. These consume the completed regular-season
// weekly score series returned by computeStandingsForLeague, so they inherit
// starter-only scoring and historical score overrides from the shared pipeline.

function scoreRecord(rosterId, row, meta) {
  return {
    rosterId: String(rosterId),
    week: Number(row.week),
    score: Number(row.pf),
    teamName: meta?.team_name || `Roster ${rosterId}`,
    ownerName: meta?.owner_name || meta?.owner_username || null,
    avatar: meta?.team_avatar || meta?.owner_avatar || null,
  };
}

/**
 * Summarize completed regular-season team scores into week-by-week averages
 * and season single-week scoring records.
 *
 * Zero totals are omitted because the standings scorer uses zero when a
 * week's starter scoring is unavailable; treating that as a real low score
 * would create a misleading record.
 */
export function buildWeeklyScoringTrends(weeklyPfByRoster = {}, rosterMap = {}) {
  const byWeek = new Map();
  const scoredEntries = [];

  for (const [rosterId, rows] of Object.entries(weeklyPfByRoster || {})) {
    const meta = rosterMap?.[rosterId] || {};
    for (const row of Array.isArray(rows) ? rows : []) {
      const week = Number(row?.week);
      const score = Number(row?.pf);
      if (!Number.isInteger(week) || week < 1 || !Number.isFinite(score) || score <= 0) continue;

      const entry = scoreRecord(rosterId, { ...row, week, pf: score }, meta);
      if (!byWeek.has(week)) byWeek.set(week, []);
      byWeek.get(week).push(entry);
      scoredEntries.push(entry);
    }
  }

  const compareScore = (a, b) => b.score - a.score || a.rosterId.localeCompare(b.rosterId);
  const weeks = [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, entries]) => {
      const sorted = [...entries].sort(compareScore);
      const total = entries.reduce((sum, entry) => sum + entry.score, 0);
      return {
        week,
        averageScore: total / entries.length,
        teamCount: entries.length,
        highScore: sorted[0],
        lowScore: sorted[sorted.length - 1],
      };
    });

  const highOrder = [...scoredEntries].sort((a, b) =>
    b.score - a.score || a.week - b.week || a.rosterId.localeCompare(b.rosterId)
  );
  const lowOrder = [...scoredEntries].sort((a, b) =>
    a.score - b.score || a.week - b.week || a.rosterId.localeCompare(b.rosterId)
  );

  return {
    weeks,
    seasonHigh: highOrder[0] || null,
    seasonLow: lowOrder[0] || null,
  };
}

function getScoredRows(weeklyPfByRoster = {}, rosterMap = {}) {
  const entries = [];
  for (const [rosterId, rows] of Object.entries(weeklyPfByRoster || {})) {
    const meta = rosterMap?.[rosterId] || {};
    for (const row of Array.isArray(rows) ? rows : []) {
      const week = Number(row?.week);
      const score = Number(row?.pf);
      if (!Number.isInteger(week) || week < 1 || !Number.isFinite(score) || score <= 0) continue;
      entries.push(scoreRecord(rosterId, { week, pf: score }, meta));
    }
  }
  return entries;
}

/**
 * Summarize each team's completed regular-season scores. Unavailable zero
 * scores are omitted, matching the Weekly Scoring Pulse treatment.
 */
export function buildTeamScoringProfiles(weeklyPfByRoster = {}, rosterMap = {}) {
  const grouped = new Map();
  for (const entry of getScoredRows(weeklyPfByRoster, rosterMap)) {
    if (!grouped.has(entry.rosterId)) grouped.set(entry.rosterId, []);
    grouped.get(entry.rosterId).push(entry);
  }

  return [...grouped.entries()].map(([rosterId, entries]) => {
    const scores = entries.map((entry) => entry.score);
    const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const highScore = Math.max(...scores);
    const lowScore = Math.min(...scores);
    const variance = scores.reduce((sum, score) => sum + (score - averageScore) ** 2, 0) / scores.length;
    const first = entries[0];
    return {
      rosterId,
      teamName: first.teamName,
      ownerName: first.ownerName,
      avatar: first.avatar,
      weeksPlayed: scores.length,
      averageScore,
      highScore,
      lowScore,
      range: highScore - lowScore,
      standardDeviation: Math.sqrt(variance),
    };
  }).sort((a, b) => a.standardDeviation - b.standardDeviation || a.teamName.localeCompare(b.teamName));
}

/**
 * Compare a team's average across all completed weeks with its average over
 * the latest N completed scoring weeks. Both averages omit unavailable zeros.
 */
export function buildRecentVsSeasonComparison(weeklyPfByRoster = {}, rosterMap = {}, recentWeekCount = 4) {
  const entries = getScoredRows(weeklyPfByRoster, rosterMap);
  const allWeeks = [...new Set(entries.map((entry) => entry.week))].sort((a, b) => a - b);
  const count = Math.max(1, Math.floor(Number(recentWeekCount) || 4));
  const recentWeeks = allWeeks.slice(-count);
  const recentSet = new Set(recentWeeks);
  const grouped = new Map();

  for (const entry of entries) {
    if (!grouped.has(entry.rosterId)) grouped.set(entry.rosterId, []);
    grouped.get(entry.rosterId).push(entry);
  }

  const teams = [...grouped.entries()].map(([rosterId, rows]) => {
    const recentRows = rows.filter((row) => recentSet.has(row.week));
    const seasonAverage = rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
    const recentAverage = recentRows.length
      ? recentRows.reduce((sum, row) => sum + row.score, 0) / recentRows.length
      : null;
    const first = rows[0];
    return {
      rosterId,
      teamName: first.teamName,
      ownerName: first.ownerName,
      avatar: first.avatar,
      seasonAverage,
      recentAverage,
      difference: recentAverage == null ? null : recentAverage - seasonAverage,
      weeksPlayed: rows.length,
      recentWeeksPlayed: recentRows.length,
    };
  }).filter((team) => team.recentAverage != null)
    .sort((a, b) => b.difference - a.difference || a.teamName.localeCompare(b.teamName));

  return { recentWeeks, teams };
}

/**
 * Reduce each season's completed regular-season scores to one league-wide
 * average team score. Each valid team-week score has equal weight.
 */
export function buildLeagueScoringHistory(seasons = []) {
  return (Array.isArray(seasons) ? seasons : [])
    .map((season) => {
      const entries = getScoredRows(season?.weeklyPfByRoster || {}, season?.rosterMap || {});
      if (!entries.length) return null;
      const total = entries.reduce((sum, entry) => sum + entry.score, 0);
      return {
        season: String(season.season ?? season.year ?? ''),
        averageScore: total / entries.length,
        scoreCount: entries.length,
        teamCount: new Set(entries.map((entry) => entry.rosterId)).size,
        weekCount: new Set(entries.map((entry) => entry.week)).size,
      };
    })
    .filter((season) => season && season.season)
    .sort((a, b) => Number(a.season) - Number(b.season));
}

/**
 * Prepare completed weekly standings snapshots as chart-ready team series.
 * Rank 1 is the top seed; missing ranks remain null rather than being guessed.
 */
export function buildStandingsMovementSeries(snapshots = [], rosterMap = {}) {
  const validSnapshots = (Array.isArray(snapshots) ? snapshots : [])
    .filter((snapshot) => Number.isInteger(Number(snapshot?.week)) && snapshot?.ranks && typeof snapshot.ranks === 'object')
    .sort((a, b) => Number(a.week) - Number(b.week));
  const rosterIds = [...new Set(validSnapshots.flatMap((snapshot) => Object.keys(snapshot.ranks || {})))];

  return {
    weeks: validSnapshots.map((snapshot) => Number(snapshot.week)),
    teams: rosterIds.map((rosterId) => {
      const meta = rosterMap?.[rosterId] || {};
      return {
        rosterId,
        teamName: meta.team_name || `Roster ${rosterId}`,
        ownerName: meta.owner_name || meta.owner_username || null,
        avatar: meta.team_avatar || meta.owner_avatar || null,
        ranks: validSnapshots.map((snapshot) => {
          const rank = Number(snapshot.ranks?.[rosterId]);
          return Number.isInteger(rank) && rank > 0 ? rank : null;
        }),
      };
    }).sort((a, b) => a.teamName.localeCompare(b.teamName)),
  };
}
