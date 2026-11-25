import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('2023 early-season BFA score corrections live in the 2023 year snapshot', async () => {
  const url = new URL('../static/season_matchups/2023.json', import.meta.url);
  const snapshot = JSON.parse(await readFile(url, 'utf8'));

  for (const week of ['1', '2', '3']) {
    const rows = snapshot[week] || [];
    assert.equal(rows.length, 7, `2023 week ${week} should contain all seven matchups`);

    const teams = rows.flatMap((row) => [
      { team: row.teamA, score: row.teamAScore, source: row.teamAScoreSource },
      { team: row.teamB, score: row.teamBScore, source: row.teamBScoreSource },
    ]);
    assert.equal(teams.length, 14);
    for (const entry of teams) {
      assert.ok(Number.isFinite(entry.score), `2023 week ${week} ${entry.team?.ownerName} has a saved score`);
      assert.equal(entry.source, 'bfa_historical_override');
    }
  }

  const kybesWeekOne = (snapshot['1'] || [])
    .flatMap((row) => [
      { owner: row.teamA?.ownerName, score: row.teamAScore },
      { owner: row.teamB?.ownerName, score: row.teamBScore },
    ])
    .find((entry) => entry.owner === 'Kybes');

  assert.equal(kybesWeekOne?.score, 131.69);
});

test('2026 week five BFA final score override takes precedence over starter totals', async () => {
  const url = new URL('../static/season_matchups/2026.json', import.meta.url);
  const snapshot = JSON.parse(await readFile(url, 'utf8'));
  const emperors = (snapshot['5'] || []).find((row) =>
    row.teamA?.name === 'The Emperors' || row.teamB?.name === 'The Emperors'
  );

  assert.ok(emperors, '2026 week 5 includes The Emperors');
  if (emperors.teamA?.name === 'The Emperors') {
    assert.equal(emperors.teamAScore, 262.18);
    assert.equal(emperors.teamAScoreSource, 'bfa_historical_override');
  } else {
    assert.equal(emperors.teamBScore, 262.18);
    assert.equal(emperors.teamBScoreSource, 'bfa_historical_override');
  }
});
