/**
 * Keep only postseason matchups involving teams seeded into the championship
 * playoff field. Toilet Bowl games remain available in collectedMatchups for
 * bracket/history presentation, but must not feed playoff statistics.
 *
 * A matchup is included only when every participant is playoff-eligible. This
 * keeps a malformed or mixed-field matchup from assigning playoff stats to a
 * non-qualifier.
 */
export function filterPlayoffMatchups(collectedMatchups, playoffRosterIds, playoffStart, playoffEnd) {
  const eligibleRosterIds = new Set((playoffRosterIds || []).map(String));
  if (!eligibleRosterIds.size) return {};

  const filtered = {};
  for (const [weekText, entries] of Object.entries(collectedMatchups || {})) {
    const week = Number(weekText);
    if (!Number.isInteger(week) || week < playoffStart || week > playoffEnd || !Array.isArray(entries)) {
      continue;
    }

    const byMatchup = {};
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (!entry || typeof entry !== 'object') continue;
      const matchupId = entry.matchup_id ?? entry.matchupId;
      const key = matchupId != null ? String(matchupId) : `auto-${week}-${index}`;
      (byMatchup[key] ||= []).push(entry);
    }

    const eligibleEntries = [];
    for (const participants of Object.values(byMatchup)) {
      if (!participants.length) continue;
      const everyTeamQualified = participants.every((entry) => {
        const rosterId = entry.roster_id ?? entry.rosterId;
        return rosterId != null && eligibleRosterIds.has(String(rosterId));
      });
      if (everyTeamQualified) eligibleEntries.push(...participants);
    }

    if (eligibleEntries.length) filtered[weekText] = eligibleEntries;
  }
  return filtered;
}
