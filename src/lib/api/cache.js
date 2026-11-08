// src/lib/api/cache.js
//
// Small browser cache for Sleeper's public API. Normal responses persist in
// localStorage; large responses stay in memory so they do not repeatedly
// trigger storage-quota errors during in-app navigation.
//
// All cache functions are no-ops during SSR (where `window` does not exist).

const CACHE_PREFIX = 'bfa_cache_';
const DEFAULT_TTL = 5 * 60 * 1000;
// localStorage is commonly limited to roughly 5 MB per origin. Keep a
// conservative per-entry ceiling because values are stored as JSON strings.
const MAX_PERSISTED_ENTRY_CHARS = 1_500_000;
const memoryCache = new Map();

/** Return cached data and distinguish a cache miss from a cached null value. */
function getCached(key) {
  if (typeof window === 'undefined') return { hit: false };

  const now = Date.now();
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry) {
    if (now - memoryEntry.timestamp < memoryEntry.ttl) {
      return { hit: true, data: memoryEntry.data };
    }
    memoryCache.delete(key);
  }

  try {
    const storageKey = CACHE_PREFIX + key;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { hit: false };

    const entry = JSON.parse(raw);
    if (
      entry &&
      Number.isFinite(entry.timestamp) &&
      Number.isFinite(entry.ttl) &&
      entry.ttl > 0 &&
      now - entry.timestamp < entry.ttl &&
      Object.prototype.hasOwnProperty.call(entry, 'data')
    ) {
      memoryCache.set(key, entry);
      return { hit: true, data: entry.data };
    }

    localStorage.removeItem(storageKey);
  } catch (err) {
    console.warn('[Cache] read failed:', err);
  }

  return { hit: false };
}

/** Persist data in memory and, when reasonably small, in localStorage. */
function setCache(key, data, ttl = DEFAULT_TTL) {
  if (typeof window === 'undefined') return;

  const entry = { data, timestamp: Date.now(), ttl };
  memoryCache.set(key, entry);

  try {
    const serialized = JSON.stringify(entry);
    // The full Sleeper NBA player map is several megabytes. Avoid attempting
    // to put it in localStorage; the in-memory copy still serves page changes.
    if (serialized.length > MAX_PERSISTED_ENTRY_CHARS) return;

    const storageKey = CACHE_PREFIX + key;
    try {
      localStorage.setItem(storageKey, serialized);
    } catch (err) {
      if (!err || err.name !== 'QuotaExceededError') throw err;
      clearExpired();
      // Retry once after removing stale entries. If storage is still full,
      // the in-memory cache remains available for this browser session.
      localStorage.setItem(storageKey, serialized);
    }
  } catch (err) {
    if (!err || err.name !== 'QuotaExceededError') {
      console.warn('[Cache] write failed:', err);
    }
  }
}

/** Remove expired or malformed entries from persistent storage. */
function clearExpired() {
  if (typeof window === 'undefined') return;

  try {
    const now = Date.now();
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(key);
        const entry = raw ? JSON.parse(raw) : null;
        if (
          !entry ||
          !Number.isFinite(entry.timestamp) ||
          !Number.isFinite(entry.ttl) ||
          now - entry.timestamp >= entry.ttl
        ) {
          localStorage.removeItem(key);
        }
      } catch (_) {
        localStorage.removeItem(key);
      }
    }
  } catch (_) {
    // Storage can be disabled by browser privacy settings.
  }
}

/**
 * Fetch + JSON parse + cache. Cache key is the URL, so query strings remain
 * distinct. A failed request is never cached.
 */
export async function fetchWithCache(url, options = {}, ttl = DEFAULT_TTL) {
  const cached = getCached(url);
  if (cached.hit) return cached.data;

  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const data = await res.json();
  setCache(url, data, ttl);
  return data;
}
