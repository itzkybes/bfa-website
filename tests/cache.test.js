import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithCache } from '../src/lib/api/cache.js';

test('deduplicates concurrent GETs and keeps oversized payloads in memory', async () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  let fetchCount = 0;

  globalThis.window = {};
  globalThis.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); }
  };
  globalThis.fetch = async () => {
    fetchCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      ok: true,
      json: async () => ({ players: 'x'.repeat(1_500_100) })
    };
  };

  try {
    const url = 'https://unit.test/large-player-map';
    const [first, second] = await Promise.all([
      fetchWithCache(url),
      fetchWithCache(url)
    ]);

    assert.equal(fetchCount, 1);
    assert.strictEqual(first, second);
    assert.equal(storage.size, 0, 'large payload should not be written to localStorage');

    const third = await fetchWithCache(url);
    assert.strictEqual(third, first);
    assert.equal(fetchCount, 1, 'the in-memory cache should serve subsequent reads');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});
