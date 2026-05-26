/**
 * Client-side caching utility for API responses.
 * Uses localStorage with TTL (time to live) support.
 */

const CACHE_PREFIX = 'bfa_cache_';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

/** Get cached data if still valid */
export function getCached(key) {
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

/** Set cached data with TTL (ms) */
export function setCache(key, data, ttl = DEFAULT_TTL) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ data, timestamp: Date.now(), ttl })
    );
  } catch (err) {
    console.warn('[Cache] write failed:', err);
    if (err && err.name === 'QuotaExceededError') clearOldCache();
  }
}

export function clearCache(key) {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(CACHE_PREFIX + key); } catch (e) { /* noop */ }
}

export function clearAllCache() {
  if (typeof window === 'undefined') return;
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    }
  } catch (e) { /* noop */ }
}

export function clearOldCache() {
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

/** Fetch JSON with localStorage cache */
export async function fetchWithCache(url, options = {}, ttl = DEFAULT_TTL) {
  const cached = getCached(url);
  if (cached) return cached;

  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  setCache(url, data, ttl);
  return data;
}

export function getCacheStats() {
  if (typeof window === 'undefined') return { count: 0, sizeKB: '0.00' };
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX));
    let total = 0;
    for (const k of keys) total += (localStorage.getItem(k) || '').length;
    return { count: keys.length, size: total, sizeKB: (total / 1024).toFixed(2) };
  } catch (e) {
    return { count: 0, sizeKB: '0.00' };
  }
}
