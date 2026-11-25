import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTeamFromLive, buildTeamFromStatic } from '../src/lib/compute/matchupTeams.js';
import { starterPointsByPid } from '../src/lib/compute/scoring.js';

test('saved season JSON adapter preserves selected-starter player scores', () => {
  const team = buildTeamFromStatic({
    rosterId: '1',
    name: 'Snapshot Team',
    starters: ['player-a', 'player-b'],
    starters_points: [26.25, 0],
  }, 101.75, {});

  assert.equal(team.points, 101.75);
  assert.deepEqual(starterPointsByPid(team), {
    'player-a': 26.25,
    'player-b': 0,
  });
});

test('live matchup fallback cannot supply team scores or player-stat arrays', () => {
  const team = buildTeamFromLive('1', {
    1: { team_name: 'Live Team', owner_name: 'Manager', team_avatar: 'avatar-url' },
  }, {
    points: 999,
    starters: ['player-a'],
    starters_points: [999],
    player_points: { 'player-a': 999 },
  });

  assert.equal(team.name, 'Live Team');
  assert.equal(team.points, null);
  assert.equal(team.starters, null);
  assert.equal(team.starters_points, null);
  assert.equal(starterPointsByPid(team), null);
});

test('every saved year JSON file contains starter-aligned player scoring', async () => {
  for (const year of ['2022', '2023', '2024', '2025', '2026']) {
    const url = new URL(`../static/season_matchups/${year}.json`, import.meta.url);
    const snapshot = JSON.parse(await readFile(url, 'utf8'));
    const weeks = Object.keys(snapshot).filter((key) => Number.isInteger(Number(key)));
    assert.ok(weeks.length > 0, `${year} snapshot has no weeks`);

    let teamsChecked = 0;
    for (const week of weeks) {
      for (const matchup of snapshot[week] || []) {
        for (const side of ['teamA', 'teamB']) {
          const team = matchup[side];
          if (!team) continue;
          assert.ok(Array.isArray(team.starters), `${year} week ${week} ${side} has no starters`);
          assert.ok(Array.isArray(team.starters_points), `${year} week ${week} ${side} has no starters_points`);
          assert.equal(
            team.starters_points.length,
            team.starters.length,
            `${year} week ${week} ${side} starter scores are misaligned`
          );
          teamsChecked++;
        }
      }
    }
    assert.ok(teamsChecked > 0, `${year} snapshot has no team scoring rows`);
  }
});
