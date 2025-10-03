// src/lib/server/cache.js
// Small pluggable cache adapters for server usage.
// Exports createMemoryCache() and createKVCache(kvNamespace).

/**
 * Memory cache for local/dev usage.
 * Methods:
 *  - get(key) -> returns stored string or null
 *  - set(key, value, ttlSeconds) -> stores string
 *  - del(key) -> deletes
 */
export function createMemoryCache() {
  const store = new Map();

  return {
    async get(key) {
      const rec = store.get(key);
      if (!rec) return null;
      const { value, expiresAt } = rec;
      if (expiresAt && Date.now() > expiresAt) {
        store.delete(key);
        return null;
      }
      return value;
    },

    async set(key, value, ttlSeconds = 60) {
      const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expiresAt });
    },

    async del(key) {
      store.delete(key);
    }
  };
}

/**
 * Adapter for Vercel KV (or other KV-like global). Accepts the KV namespace object.
 * Vercel KV typically exposes get/set/delete (or get/put) depending on runtime — this
 * wrapper tries common methods. If your provider uses different method names, adapt here.
 *
 * Example usage:
 *  import { createKVCache } from '$lib/server/cache';
 *  const cache = createKVCache(globalThis.KV); // if KV is available globally
 */
export function createKVCache(kvNamespace) {
  if (!kvNamespace) {
    throw new Error('createKVCache requires a kvNamespace object');
  }

  // helper to detect available operations
  const hasGet = typeof kvNamespace.get === 'function';
  const hasPut = typeof kvNamespace.put === 'function' || typeof kvNamespace.set === 'function' || typeof kvNamespace.setItem === 'function';
  const hasDel = typeof kvNamespace.delete === 'function' || typeof kvNamespace.del === 'function' || typeof kvNamespace.remove === 'function';

  // map to appropriate functions
  const getFn = hasGet ? kvNamespace.get.bind(kvNamespace) : null;
  const putFn = (typeof kvNamespace.put === 'function')
    ? kvNamespace.put.bind(kvNamespace)
    : (typeof kvNamespace.set === 'function' ? kvNamespace.set.bind(kvNamespace) : null);

  const delFn = (typeof kvNamespace.delete === 'function')
    ? kvNamespace.delete.bind(kvNamespace)
    : (typeof kvNamespace.del === 'function' ? kvNamespace.del.bind(kvNamespace) : (typeof kvNamespace.remove === 'function' ? kvNamespace.remove.bind(kvNamespace) : null));

  if (!getFn || !putFn) {
    // best-effort: if provider doesn't expose get/put, throw to surface config issue
    throw new Error('KV namespace missing required methods (get/put). Adapt createKVCache to your KV provider.');
  }

  return {
    async get(key) {
      // Most KV get returns null or string/Uint8Array
      const v = await getFn(key);
      if (v == null) return null;
      // ensure string
      if (typeof v === 'string') return v;
      if (v instanceof Uint8Array) return new TextDecoder().decode(v);
      return String(v);
    },

    async set(key, value, ttlSeconds = 60) {
      // Vercel KV supports expirationTtl on put
      const opts = {};
      if (typeof ttlSeconds === 'number' && ttlSeconds > 0) {
        opts.expirationTtl = ttlSeconds;
      }
      // use put/set API depending on provider
      // put usually is (key, value, options)
      await putFn(key, value, opts);
    },

    async del(key) {
      if (!delFn) return;
      await delFn(key);
    }
  };
}
