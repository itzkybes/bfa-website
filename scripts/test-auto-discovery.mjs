// scripts/test-auto-discovery.mjs
//
// Runs the forward-auto-discovery logic against the live Sleeper API and
// prints the discovered seasons. Used as a manual sanity check after changes
// to getSeasonsChain. Run with:
//
//   node scripts/test-auto-discovery.mjs
//

// Polyfill localStorage so the cache helper doesn't blow up under Node.
globalThis.window = globalThis.window || { localStorage: undefined };
const _mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (_mem.has(k) ? _mem.get(k) : null),
  setItem: (k, v) => _mem.set(k, v),
  removeItem: (k) => _mem.delete(k),
  key: (i) => Array.from(_mem.keys())[i] || null,
  get length() { return _mem.size; }
};

// We have to import via file URL because the project uses $lib aliases.
// Resolve manually since this script runs outside vite.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const sleeperPath = resolve('src/lib/sleeperClient.client.js');
// The lib imports $lib/cache — we need to rewrite that to a relative path.
// Simplest: just inline a minimal getSeasonsChain that hits the API directly.

const BASE = 'https://api.sleeper.app/v1';
const BASE_LEAGUE_ID = '1219816671624048640';

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function getSeasonsChain(baseLeagueId, maxSteps = 50) {
  const seasons = [];
  const prevChain = [];
  let mainLeague = null;
  try { mainLeague = await getJson(`${BASE}/league/${baseLeagueId}`); }
  catch (e) { return { seasons, prevChain, error: e?.message }; }
  if (!mainLeague) return { seasons, prevChain };

  seasons.push({ league_id: String(mainLeague.league_id), season: mainLeague.season, name: mainLeague.name });
  prevChain.push(String(mainLeague.league_id));

  // Back walk
  let curr = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
  let steps = 0;
  while (curr && steps < maxSteps) {
    steps++;
    try {
      const prev = await getJson(`${BASE}/league/${curr}`);
      if (!prev) break;
      seasons.push({ league_id: String(prev.league_id), season: prev.season, name: prev.name });
      prevChain.push(String(prev.league_id));
      curr = prev.previous_league_id ? String(prev.previous_league_id) : null;
    } catch (e) { break; }
  }

  // Forward walk
  let seedUserIds = [];
  try {
    const anchorUsers = await getJson(`${BASE}/league/${baseLeagueId}/users`);
    seedUserIds = (anchorUsers || []).map(u => u.user_id).filter(Boolean).slice(0, 4);
  } catch (e) {}

  if (seedUserIds.length > 0) {
    const anchorSeasonNum = Number(mainLeague.season);
    const startYear = !isNaN(anchorSeasonNum) && anchorSeasonNum > 0 ? anchorSeasonNum : new Date().getUTCFullYear();
    const maxYear = Math.max(startYear, new Date().getUTCFullYear()) + 5;
    let latestId = String(mainLeague.league_id);

    for (let yr = startYear + 1; yr <= maxYear; yr++) {
      const lists = await Promise.all(
        seedUserIds.map(uid => getJson(`${BASE}/user/${uid}/leagues/nba/${yr}`).catch(() => []))
      );
      const flat = [];
      const seen = new Set();
      for (const list of lists) {
        for (const lg of (list || [])) {
          if (!lg?.league_id) continue;
          const id = String(lg.league_id);
          if (seen.has(id)) continue;
          seen.add(id);
          flat.push(lg);
        }
      }
      const next = flat.find(lg => String(lg.previous_league_id || '') === latestId);
      if (!next) break;
      seasons.push({ league_id: String(next.league_id), season: next.season || String(yr), name: next.name });
      prevChain.push(String(next.league_id));
      latestId = String(next.league_id);
    }
  }

  seasons.sort((a, b) => {
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return 0;
  });

  return { seasons, prevChain };
}

(async () => {
  console.log('Running getSeasonsChain against the LIVE Sleeper API…\n');
  const { seasons, error } = await getSeasonsChain(BASE_LEAGUE_ID);
  if (error) {
    console.error('FAILED:', error);
    process.exit(1);
  }
  console.log(`Discovered ${seasons.length} season(s):\n`);
  for (const s of seasons) {
    console.log(`  ${s.season}  → ${s.league_id}   (${s.name})`);
  }
  console.log('');
  // Sanity check: 2026 must be in here, and it must be after 2025.
  const has2025 = seasons.some(s => String(s.season) === '2025');
  const has2026 = seasons.some(s => String(s.season) === '2026');
  console.log('Sanity:');
  console.log(`  2025 present?  ${has2025}`);
  console.log(`  2026 present?  ${has2026}  ← forward-discovery result`);
  if (!has2026) process.exit(1);
})();
