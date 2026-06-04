// src/lib/api/staticSeasons.js
//
// Helpers for reading the locked-in historical JSON snapshots from
// `/static/season_matchups/{year}.json`. We keep an in-flight promise map
// so two parallel callers asking for the same file share one network fetch.

const _inflight = new Map();
const _cache = new Map();

/**
 * Fetch a static JSON asset. Returns `null` on any error / 404 so callers
 * can graceful-fall-back to the live Sleeper API.
 *
 * Identical concurrent calls for the same path share one network request.
 */
export async function fetchStaticJson(path) {
  if (_cache.has(path)) return _cache.get(path);
  if (_inflight.has(path)) return _inflight.get(path);

  const p = (async () => {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      const data = await res.json();
      _cache.set(path, data);
      return data;
    } catch (e) {
      return null;
    } finally {
      _inflight.delete(path);
    }
  })();

  _inflight.set(path, p);
  return p;
}

/** Convenience wrapper: load the matchup snapshot for one season year. */
export function loadSeasonMatchups(season) {
  if (!season) return Promise.resolve(null);
  return fetchStaticJson(`/season_matchups/${season}.json`);
}
