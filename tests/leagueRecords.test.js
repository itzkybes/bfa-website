import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeagueRecordBook } from '../src/lib/compute/leagueRecords.js';

const rosterMap = {
  '1': { team_name: 'Badgers', owner_name: 'Alex' },
  '2': { team_name: 'Wolves', owner_name: 'Blair' },
};

test('record book separates regular season and playoff weeks', () => {
  const records = buildLeagueRecordBook([{
    season: '2025',
    playoffStart: 20,
    playoffEnd: 22,
    rosterMap,
    regularStandings: [
      { rosterId: '1', team_name: 'Badgers', wins: 15, losses: 4, pf: 2100 },
      { rosterId: '2', team_name: 'Wolves', wins: 12, losses: 7, pf: 1980 },
    ],
    collectedMatchups: {
      19: [
        { roster_id: '1', matchup_id: 1, __final_score: 150 },
        { roster_id: '2', matchup_id: 1, __final_score: 120 },
      ],
      20: [
        { roster_id: '1', matchup_id: 2, __final_score: 180 },
        { roster_id: '2', matchup_id: 2, __final_score: 175 },
      ],
    },
  }]);

  assert.equal(records.highestRegularWeek[0].points, 150);
  assert.equal(records.highestRegularWeek[0].team, 'Badgers');
  assert.equal(records.highestPlayoffWeek[0].points, 180);
  assert.equal(records.largestRegularMargins[0].margin, 30);
  assert.equal(records.highestCombinedRegular[0].combined, 270);
  assert.equal(records.mostRegularSeasonWins[0].wins, 15);
  assert.equal(records.mostRegularSeasonPoints[0].pf, 2100);
});

test('record book honors pinned scores and sums starter points as fallback', () => {
  const records = buildLeagueRecordBook([{
    season: '2024',
    playoffStart: 21,
    playoffEnd: 23,
    rosterMap,
    collectedMatchups: {
      1: [
        { roster_id: '1', matchup_id: 1, __final_score: 88, starters_points: [100] },
        { roster_id: '2', matchup_id: 1, starters_points: [40, 35] },
      ],
    },
  }]);

  assert.equal(records.highestRegularWeek[0].points, 88);
  assert.equal(records.highestRegularWeek[1].points, 75);
  assert.equal(records.highestCombinedRegular[0].combined, 163);
});

test('incomplete brackets do not fabricate champions and unmatched entries are ignored', () => {
  const records = buildLeagueRecordBook([{
    season: '2026',
    playoffStart: 19,
    playoffEnd: 21,
    rosterMap,
    bracketComplete: false,
    bracketChampionId: '1',
    collectedMatchups: {
      1: [{ roster_id: '1', matchup_id: 7, points: 99 }],
    },
  }]);

  assert.deepEqual(records.champions, []);
  assert.deepEqual(records.highestRegularWeek, []);
});
