/**
 * Build an all-time league record book from the same completed matchup and
 * standings payloads used by the rest of the site.
 *
 * The current in-progress week is already excluded by computeStandingsForLeague.
 * Regular-season and playoff single-week records are kept separate.
 */
function score(entry) {
  if (entry?.__final_score != null) return round(Number(entry.__final_score) || 0);
  if (Array.isArray(entry?.starters_points)) {
    return round(entry.starters_points.reduce((sum, value) => sum + (Number(value) || 0), 0));
  }
  return round(Number(entry?.points ?? 0) || 0);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function teamInfo(entry, rosterMap, season, week) {
  const rosterId = String(entry?.roster_id ?? entry?.rosterId ?? '');
  const meta = rosterMap?.[rosterId] || {};
  return {
    rosterId,
    team: meta.team_name || entry?.__team_name || `Roster ${rosterId || '—'}`,
    owner: meta.owner_name || entry?.__owner_name || null,
    avatar: meta.team_avatar || meta.owner_avatar || null,
    season,
    week: Number(week),
    points: score(entry),
  };
}

export function buildLeagueRecordBook(seasonResults) {
  const regularScores = [];
  const playoffScores = [];
  const regularMargins = [];
  const regularCombined = [];
  const seasonWins = [];
  const seasonPointsFor = [];
  const champions = [];

  for (const result of Array.isArray(seasonResults) ? seasonResults : []) {
    if (!result) continue;
    const season = String(result.season ?? result.leagueSeason ?? '—');
    const rosterMap = result.rosterMap || {};
    const playoffStart = Number(result.playoffStart) || 19;
    const playoffEnd = Number(result.playoffEnd) || playoffStart + 2;

    for (const row of result.regularStandings || []) {
      const record = {
        team: row.team_name || 'Unknown team',
        owner: row.owner_name || rosterMap[row.rosterId]?.owner_name || null,
        avatar: row.avatar || rosterMap[row.rosterId]?.team_avatar || null,
        season,
        wins: Number(row.wins) || 0,
        losses: Number(row.losses) || 0,
        pf: round(Number(row.pf) || 0),
      };
      seasonWins.push(record);
      seasonPointsFor.push(record);
    }

    if (result.bracketComplete && result.bracketChampionId) {
      const meta = rosterMap[String(result.bracketChampionId)] || {};
      champions.push({
        season,
        team: meta.team_name || `Roster ${result.bracketChampionId}`,
        owner: meta.owner_name || null,
        avatar: meta.team_avatar || meta.owner_avatar || null,
      });
    }

    for (const [weekKey, entries] of Object.entries(result.collectedMatchups || {})) {
      const week = Number(weekKey);
      if (!Number.isInteger(week) || !Array.isArray(entries)) continue;
      const isRegular = week >= 1 && week < playoffStart;
      const isPlayoff = week >= playoffStart && week <= playoffEnd;
      if (!isRegular && !isPlayoff) continue;

      const byMatchup = {};
      for (const entry of entries) {
        const id = entry?.matchup_id ?? entry?.matchupId;
        if (id == null) continue;
        (byMatchup[String(id)] ||= []).push(entry);
      }

      for (const matchupEntries of Object.values(byMatchup)) {
        if (matchupEntries.length !== 2) continue;
        const [a, b] = matchupEntries;
        const teamA = teamInfo(a, rosterMap, season, week);
        const teamB = teamInfo(b, rosterMap, season, week);
        if (!teamA.rosterId || !teamB.rosterId) continue;
        const combined = round(teamA.points + teamB.points);
        if (isRegular) {
          regularScores.push(teamA, teamB);
          regularCombined.push({
            season, week, combined,
            teamA: teamA.team, teamB: teamB.team,
            scoreA: teamA.points, scoreB: teamB.points,
          });
          if (teamA.points !== teamB.points) {
            const winner = teamA.points > teamB.points ? teamA : teamB;
            const loser = teamA.points > teamB.points ? teamB : teamA;
            regularMargins.push({
              season, week, margin: round(winner.points - loser.points),
              winner: winner.team, loser: loser.team,
              winnerScore: winner.points, loserScore: loser.points,
            });
          }
        } else {
          playoffScores.push(teamA, teamB);
        }
      }
    }
  }

  const descending = (key) => (a, b) => b[key] - a[key];
  const ascending = (key) => (a, b) => a[key] - b[key];
  return {
    highestRegularWeek: regularScores.slice().sort(descending('points')).slice(0, 10),
    lowestRegularWeek: regularScores.filter((row) => row.points > 0).sort(ascending('points')).slice(0, 10),
    highestPlayoffWeek: playoffScores.slice().sort(descending('points')).slice(0, 10),
    largestRegularMargins: regularMargins.slice().sort(descending('margin')).slice(0, 10),
    closestRegularMargins: regularMargins.slice().sort(ascending('margin')).slice(0, 10),
    highestCombinedRegular: regularCombined.sort(descending('combined')).slice(0, 10),
    mostRegularSeasonWins: seasonWins.slice().sort(descending('wins')).slice(0, 10),
    mostRegularSeasonPoints: seasonPointsFor.slice().sort(descending('pf')).slice(0, 10),
    champions: champions.sort((a, b) => Number(b.season) - Number(a.season)),
  };
}
