// src/lib/cache.js
//
// Tiny localStorage cache so Sleeper's public endpoints stay cheap and snappy
// on repeat visits. Every entry stores `{ data, timestamp, ttl }` under a
// `bfa_cache_` prefix; reads check the timestamp and skip anything stale.
//
// All functions are no-ops during SSR (where `window` doesn't exist) — the
// production deploy is pure CSR anyway, but this keeps the build clean.

const CACHE_PREFIX = 'bfa_cache_';
const DEFAULT_TTL = 5 * 60 * 1000;

/** Return cached data for `key` if still within TTL, otherwise `null`. */
function getCached(key) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, timestamp, ttl } = JSON.parse(raw);
    if (Date.now() - timestamp < ttl) return data;
    localStorage.removeItem(CACHE_PREFIX + key);
    return null;
  } catch (err) {
    console.warn('[Cache] read failed:', err);
    return null;
  }
}

/** Persist `data` under `key` with a TTL in ms. */
function setCache(key, data, ttl = DEFAULT_TTL) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ data, timestamp: Date.now(), ttl })
    );
  } catch (err) {
    // If we hit the localStorage quota, sweep expired entries and bail.
    if (err && err.name === 'QuotaExceededError') clearExpired();
    else console.warn('[Cache] write failed:', err);
  }
}

/** Drop every cache entry whose TTL has elapsed. Called on quota errors. */
function clearExpired() {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(CACHE_PREFIX)) continue;
      try {
        const { timestamp, ttl } = JSON.parse(localStorage.getItem(k));
        if (now - timestamp >= ttl) localStorage.removeItem(k);
      } catch (_) {
        localStorage.removeItem(k);
      }
    }
  } catch (e) { /* noop */ }
}

/**
 * `fetch` + JSON parse + cache, all in one. Cache key is just the URL, so
 * different query strings get distinct entries automatically.
 *
 * Includes an in-flight deduplication map: if the same URL is requested
 * concurrently before either response lands, we hand back the SAME promise
 * to every caller. This kills the most common "cold-start" waste pattern
 * where the layout warmup + the page's own onMount both ask for
 * `/players/nba` (a 5MB payload) at the same instant.
 */
const inFlight = new Map(); // url -> Promise

export async function fetchWithCache(url, options = {}, ttl = DEFAULT_TTL) {
  const cached = getCached(url);
  if (cached) return cached;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();
      setCache(url, data, ttl);
      return data;
    } finally {
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, promise);
  return promise;
}
