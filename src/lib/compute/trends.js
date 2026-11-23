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
