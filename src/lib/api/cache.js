// src/lib/api/cache.js
//
// Browser-side cache and resilient fetch wrapper for Sleeper's public API.
// Small responses persist in localStorage; large responses use IndexedDB.
// All cache functions are no-ops during SSR (where `window` does not exist).

const CACHE_PREFIX = 'bfa_cache_';
const DEFAULT_TTL = 5 * 60 * 1000;
const MAX_PERSISTED_ENTRY_CHARS = 1_500_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const memoryCache = new Map();
const inFlightRequests = new Map();
const DB_NAME = 'bfa-api-cache';
const DB_VERSION = 1;
const DB_STORE = 'responses';
let databasePromise;

function getCached(key) {
  if (typeof window === 'undefined') return { hit: false };
  const now = Date.now();
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry) {
    if (now - memoryEntry.timestamp < memoryEntry.ttl) return { hit: true, data: memoryEntry.data };
    memoryCache.delete(key);
  }
  try {
    const storageKey = CACHE_PREFIX + key;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { hit: false };
    const entry = JSON.parse(raw);
    if (entry && Number.isFinite(entry.timestamp) && Number.isFinite(entry.ttl) &&
      entry.ttl > 0 && now - entry.timestamp < entry.ttl &&
      Object.prototype.hasOwnProperty.call(entry, 'data')) {
      memoryCache.set(key, entry);
      return { hit: true, data: entry.data };
    }
    localStorage.removeItem(storageKey);
  } catch (err) {
    console.warn('[Cache] read failed:', err);
  }
  return { hit: false };
}

function openDatabase() {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null);
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { databasePromise = null; resolve(null); };
    request.onblocked = () => { databasePromise = null; resolve(null); };
  });
  return databasePromise;
}

async function readPersistentCache(key) {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
      request.onsuccess = () => {
        const entry = request.result;
        if (entry && Number.isFinite(entry.timestamp) && Number.isFinite(entry.ttl) &&
          entry.ttl > 0 && Date.now() - entry.timestamp < entry.ttl &&
          Object.prototype.hasOwnProperty.call(entry, 'data')) {
          resolve(entry);
          return;
        }
        if (entry) {
          try { db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).delete(key); } catch (_) {}
        }
        resolve(null);
      };
      request.onerror = () => resolve(null);
    } catch (_) { resolve(null); }
  });
}

async function writePersistentCache(key, entry) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const transaction = db.transaction(DB_STORE, 'readwrite');
      transaction.objectStore(DB_STORE).put(entry, key);
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
      transaction.onabort = resolve;
    } catch (_) { resolve(); }
  });
}

function setCache(key, data, ttl = DEFAULT_TTL) {
  if (typeof window === 'undefined') return;
  const entry = { data, timestamp: Date.now(), ttl };
  memoryCache.set(key, entry);
  try {
    // The NBA directory is several megabytes. Avoid serializing it a second
    // time just to measure its size; IndexedDB stores structured data.
    if (key.endsWith('/players/nba')) {
      writePersistentCache(key, entry);
      return;
    }
    const serialized = JSON.stringify(entry);
    if (serialized.length > MAX_PERSISTED_ENTRY_CHARS) {
      writePersistentCache(key, entry);
      return;
    }
    const storageKey = CACHE_PREFIX + key;
    try { localStorage.setItem(storageKey, serialized); }
    catch (err) {
      if (!err || err.name !== 'QuotaExceededError') throw err;
      clearExpired();
      localStorage.setItem(storageKey, serialized);
    }
  } catch (err) {
    if (!err || err.name !== 'QuotaExceededError') console.warn('[Cache] write failed:', err);
  }
}

function clearExpired() {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(key);
        const entry = raw ? JSON.parse(raw) : null;
        if (!entry || !Number.isFinite(entry.timestamp) || !Number.isFinite(entry.ttl) ||
          now - entry.timestamp >= entry.ttl) localStorage.removeItem(key);
      } catch (_) { localStorage.removeItem(key); }
    }
  } catch (_) { /* Storage can be disabled by browser privacy settings. */ }
}

function makeAbortError() {
  const error = new Error('Request was cancelled');
  error.name = 'AbortError';
  return error;
}

function retryDelay(response, attempt) {
  const retryAfter = response?.headers?.get('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const dateDelay = Number.isNaN(seconds) ? Date.parse(retryAfter) - Date.now() : seconds * 1000;
    if (Number.isFinite(dateDelay) && dateDelay > 0) return Math.min(dateDelay, 5_000);
  }
  return 350 * 2 ** (attempt - 1);
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(makeAbortError()); return; }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(makeAbortError());
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function requestJson(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const attempts = method === 'GET' || method === 'HEAD' ? MAX_ATTEMPTS : 1;
  const externalSignal = options.signal;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (externalSignal?.aborted) throw makeAbortError();
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', forwardAbort);
      if (externalSignal?.aborted) throw makeAbortError();
      lastError = timedOut ? new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`) : err;
      if (attempt >= attempts) throw new Error(`Unable to reach Sleeper API: ${lastError?.message || 'Network error'}`);
      await wait(350 * 2 ** (attempt - 1), externalSignal);
      continue;
    }
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
    if (response.ok) {
      try { return await response.json(); }
      catch (err) { throw new Error(`Sleeper API returned invalid JSON: ${err?.message || 'Parse error'}`); }
    }
    const error = new Error(`Sleeper API request failed (HTTP ${response.status} ${response.statusText || ''})`.trim());
    error.status = response.status;
    lastError = error;
    if (!RETRYABLE_STATUSES.has(response.status) || attempt >= attempts) throw error;
    await wait(retryDelay(response, attempt), externalSignal);
  }
  throw lastError || new Error('Sleeper API request failed');
}

/** Fetch, parse and cache JSON; concurrent callers for one URL share a request. */
export async function fetchWithCache(url, options = {}, ttl = DEFAULT_TTL) {
  const cached = getCached(url);
  if (cached.hit) return cached.data;
  const pending = inFlightRequests.get(url);
  if (pending) return pending;
  const request = (async () => {
    const persistent = await readPersistentCache(url);
    if (persistent) {
      memoryCache.set(url, persistent);
      return persistent.data;
    }
    const data = await requestJson(url, options);
    setCache(url, data, ttl);
    return data;
  })();
  inFlightRequests.set(url, request);
  try { return await request; }
  finally {
    if (inFlightRequests.get(url) === request) inFlightRequests.delete(url);
  }
}
