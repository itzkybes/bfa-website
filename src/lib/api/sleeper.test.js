import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecentTransactions } from './sleeper.js';

test('recent transactions retain recent trades even when other activity is more frequent', async () => {
  const originalFetch = globalThis.fetch;
  const weekOne = [
    { transaction_id: 'trade-old', type: 'trade', status: 'complete', status_updated: 100 },
    { transaction_id: 'trade-new', type: 'trade', status: 'complete', status_updated: 200 },
    { transaction_id: 'waiver-old', type: 'waiver', status: 'complete', status_updated: 150 }
  ];
  const weekTwo = [
    ...Array.from({ length: 8 }, (_, index) => ({
      transaction_id: 'waiver-' + index,
      type: 'waiver',
      status: 'complete',
      status_updated: 300 + index
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      transaction_id: 'free-agent-' + index,
      type: 'free_agent',
      status: 'complete',
      status_updated: 400 + index
    })),
    { transaction_id: 'pending-trade', type: 'trade', status: 'pending', status_updated: 999 }
  ];

  globalThis.fetch = async (url) => {
    const week = Number(String(url).split('/').pop());
    const payload = week === 1 ? weekOne : weekTwo;
    return { ok: true, json: async () => payload };
  };

  try {
    const result = await getRecentTransactions('test-league', {
      weekFrom: 1,
      weekTo: 2,
      limit: 2
    });

    assert.equal(result.filter((item) => item.type === 'trade').length, 2);
    assert.equal(result.filter((item) => item.type === 'waiver').length, 2);
    assert.equal(result.filter((item) => item.type === 'free_agent').length, 2);
    assert.ok(!result.some((item) => item.transaction_id === 'pending-trade'));
    assert.deepEqual(
      result.map((item) => item.status_updated),
      [...result.map((item) => item.status_updated)].sort((a, b) => b - a)
    );
    assert.equal(result.find((item) => item.transaction_id === 'trade-new')._week, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
