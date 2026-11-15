import { getSeasonFormat } from './seasonFormat.js';

function ownerKey(rosterMap, rosterId) {
  const meta = rosterMap[String(rosterId)] || {};
  const name = meta.owner_username || meta.owner_name;
  return name ? String(name).toLowerCase() : null;
}

function scoreOf(entry) {
  const score = Number(entry?.__final_score ?? entry?.points ?? 0);
  return Number.isFinite(score) ? score : 0;
}

function ensureOpponent(hub, key, name) {
  hub.headToHead ||= {};
  if (!hub.headToHead[key]) hub.headToHead[key] = { owner: name || key, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
  return hub.headToHead[key];
}

export function addAdvancedOwnerStats(hubs, allSeasonResults, chain) {
  const seasonStats = {};
  for (let i = 0; i < allSeasonResults.length; i++) {
    const result = allSeasonResults[i];
    if (!result?.regularStandings) continue;
    const season = String(chain[i]?.season ?? result.leagueSeason ?? chain[i]?.league_id ?? '');
    const rosterMap = result.rosterMap || {};
    const rows = Object.entries(hubs).map(([key, hub]) => ({ key, hub, pf: 0, wins: 0, games: 0 }));
    const rowByKey = Object.fromEntries(rows.map((row) => [row.key, row]));

    for (const standing of result.regularStandings) {
      const key = ownerKey(rosterMap, standing.rosterId);
      const row = key ? rowByKey[key] : null;
      if (!row) continue;
      row.pf += Number(standing.pf || 0);
      row.wins += Number(standing.wins || 0);
      row.games += Number(standing.wins || 0) + Number(standing.losses || 0) + Number(standing.ties || 0);
    }

    const pfLeader = Math.max(-Infinity, ...rows.map((row) => row.pf));
    const recordLeaderWins = Math.max(-Infinity, ...rows.map((row) => row.wins));
    const recordLeaderPf = Math.max(-Infinity, ...rows.filter((row) => row.wins === recordLeaderWins).map((row) => row.pf));
    const collected = result.collectedMatchups || {};
    const format = getSeasonFormat(season);
    const playoffStart = Number(result.playoffStart) || format?.playoffStart || 19;
    const playoffEnd = Number(result.playoffEnd) || format?.playoffEnd || playoffStart + 2;
    const weeklyByOwner = {};

    for (const [weekText, entries] of Object.entries(collected)) {
      const week = Number(weekText);
      if (!Number.isInteger(week) || week < 1) continue;
      const matches = {};
      for (const entry of entries || []) {
        const key = ownerKey(rosterMap, entry.roster_id ?? entry.rosterId);
        if (!key || !hubs[key]) continue;
        const points = scoreOf(entry);
        if (week < playoffStart) {
          weeklyByOwner[key] ||= [];
          weeklyByOwner[key].push(points);
        }
        if (week > playoffEnd) continue;
        const matchup = String(entry.matchup_id ?? 'unmatched-' + String(entry.roster_id ?? entry.rosterId));
        matches[matchup] ||= [];
        matches[matchup].push({ key, points });
      }

      if (week < playoffStart) {
        for (const participants of Object.values(matches)) {
          const byOwner = {};
          for (const participant of participants) byOwner[participant.key] = (byOwner[participant.key] || 0) + participant.points;
          const keys = Object.keys(byOwner);
          for (const key of keys) {
            for (const opponentKey of keys) {
              if (key === opponentKey) continue;
              const record = ensureOpponent(hubs[key], opponentKey, hubs[opponentKey]?.owner_username);
              const pf = byOwner[key], pa = byOwner[opponentKey];
              record.pf += pf;
              record.pa += pa;
              if (pf > pa) record.wins++;
              else if (pf < pa) record.losses++;
              else record.ties++;
            }
          }
        }
      }
    }

    for (const row of rows) {
      const weekly = weeklyByOwner[row.key] || [];
      if (weekly.length) {
        const total = weekly.reduce((sum, value) => sum + value, 0);
        const scoring = row.hub.weeklyScoring ||= { totalWeeks: 0, highest: null, lowest: null, average: 0, _sumSquares: 0, _sum: 0 };
        const priorCount = scoring.totalWeeks;
        scoring.totalWeeks += weekly.length;
        scoring.average = (scoring.average * priorCount + total) / scoring.totalWeeks;
        scoring.highest = scoring.highest == null ? Math.max(...weekly) : Math.max(scoring.highest, ...weekly);
        scoring.lowest = scoring.lowest == null ? Math.min(...weekly) : Math.min(scoring.lowest, ...weekly);
        scoring._sumSquares += weekly.reduce((sum, value) => sum + value * value, 0);
        scoring._sum += total;
      }
    }

    const means = rows.map((row) => ({
      key: row.key,
      mean: (weeklyByOwner[row.key] || []).length
        ? weeklyByOwner[row.key].reduce((sum, value) => sum + value, 0) / weeklyByOwner[row.key].length
        : null,
    })).filter((row) => row.mean != null);
    const topAverage = Math.max(-Infinity, ...means.map((row) => row.mean));

    for (const row of rows) {
      const stat = seasonStats[row.key] ||= { topPfSeasons: 0, bestRecordSeasons: 0, topScoringAverageSeasons: 0, topFourFinishes: 0, completedFinishes: [] };
      if (row.pf === pfLeader && row.pf > 0) stat.topPfSeasons++;
      if (row.wins === recordLeaderWins && row.pf === recordLeaderPf && row.games > 0) stat.bestRecordSeasons++;
      const mean = means.find((item) => item.key === row.key)?.mean;
      if (mean != null && mean === topAverage) stat.topScoringAverageSeasons++;
      if (Array.isArray(result.finalStandings) && result.bracketComplete) {
        const finish = result.finalStandings.find((entry) => ownerKey(rosterMap, entry.rosterId) === row.key)?.rank;
        if (Number.isInteger(finish)) {
          stat.completedFinishes.push(finish);
          if (finish <= 4) stat.topFourFinishes++;
        }
      }
      for (const entry of (result.playoffStandings || []).filter((item) => ownerKey(rosterMap, item.rosterId) === row.key)) {
        row.hub.playoffWins = (row.hub.playoffWins || 0) + Number(entry.wins || 0);
        row.hub.playoffLosses = (row.hub.playoffLosses || 0) + Number(entry.losses || 0);
        row.hub.playoffTies = (row.hub.playoffTies || 0) + Number(entry.ties || 0);
      }
    }
  }

  for (const [key, hub] of Object.entries(hubs)) {
    const stats = seasonStats[key] || {};
    const scoring = hub.weeklyScoring;
    if (scoring) {
      const count = scoring.totalWeeks;
      scoring.standardDeviation = Math.sqrt(Math.max(0, scoring._sumSquares / count - (scoring._sum / count) ** 2));
      delete scoring._sumSquares;
      delete scoring._sum;
    }
    const opponents = Object.entries(hub.headToHead || {}).map(([opponentKey, record]) => ({
      key: opponentKey, ...record, games: record.wins + record.losses + record.ties,
      winPct: (record.wins + record.ties * 0.5) / Math.max(1, record.wins + record.losses + record.ties),
    })).filter((record) => record.games > 0);
    hub.headToHeadRecords = [...opponents].sort((a, b) => b.games - a.games);
    hub.toughestOpponent = [...opponents].sort((a, b) => a.winPct - b.winPct || b.games - a.games)[0] || null;
    hub.favorableOpponent = [...opponents].sort((a, b) => b.winPct - a.winPct || b.games - a.games)[0] || null;
    hub.playoffRecord = { wins: hub.playoffWins || 0, losses: hub.playoffLosses || 0, ties: hub.playoffTies || 0 };
    hub.topFourFinishes = stats.topFourFinishes || 0;
    hub.averageFinalFinish = stats.completedFinishes?.length
      ? stats.completedFinishes.reduce((sum, finish) => sum + finish, 0) / stats.completedFinishes.length
      : null;
    hub.leagueLeaders = {
      mostPointsForSeasons: stats.topPfSeasons || 0,
      bestRecordSeasons: stats.bestRecordSeasons || 0,
      highestScoringAverageSeasons: stats.topScoringAverageSeasons || 0,
    };
  }
  return hubs;
}
