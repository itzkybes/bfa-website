// src/routes/records-player/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { readFile } from 'fs/promises';

let cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) cache = createKVCache(globalThis.KV);
  else cache = createMemoryCache();
} catch (e) {
  cache = createMemoryCache();
}

const SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
const sleeper = createSleeperClient({ cache, concurrency: SLEEPER_CONCURRENCY });

const BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID)
  ? process.env.BASE_LEAGUE_ID
  : '1219816671624048640';
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Try to load a season_matchups JSON by year.
 * First try fetch from origin (useful on deployed site where static assets are served),
 * then fall back to reading static files on disk.
 */
async function tryLoadSeasonMatchups(year, origin) {
  // try origin
  try {
    if (typeof fetch === 'function' && origin) {
      const url = origin.replace(/\/$/, '') + `/season_matchups/${year}.json`;
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res && res.ok) {
          const txt = await res.text();
          try {
            return JSON.parse(txt);
          } catch (e) {
            // fallthrough to disk fallback
          }
        }
      } catch (e) {
        // fallback to disk
      }
    }
  } catch (e) {
    // ignore
  }

  // try disk (static folder)
  try {
    const fileUrl = new URL(`../../../static/season_matchups/${year}.json`, import.meta.url);
    const txt = await readFile(fileUrl, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

/**
 * Fetch player meta from Sleeper players endpoint (nba).
 * Returns a map id -> playerObj (may be heavy, but requested).
 */
async function fetchPlayersMap() {
  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nba', { method: 'GET' });
    if (!res || !res.ok) return {};
    const all = await res.json();
    // API returns object keyed by player_id
    return all || {};
  } catch (e) {
    return {};
  }
}

export async function load(event) {
  // small edge cache
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const url = event.url;
  const origin = url?.origin ?? null;

  const messages = [];
  const jsonLinks = [];

  // --- build seasons chain (same approach you use elsewhere) ---
  let seasons = [];
  try {
    let mainLeague = null;
    try {
      mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 });
    } catch (e) {
      messages.push('Failed fetching base league ' + BASE_LEAGUE_ID + ' — ' + (e?.message ?? String(e)));
    }

    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id || BASE_LEAGUE_ID), season: mainLeague.season ?? null, name: mainLeague.name ?? null });
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prev = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prev) {
            messages.push('Could not fetch league for previous id ' + currPrev);
            break;
          }
          seasons.push({ league_id: String(prev.league_id), season: prev.season ?? null, name: prev.name ?? null });
          currPrev = prev.previous_league_id ? String(prev.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching previous league ' + currPrev + ' — ' + (err?.message ?? String(err)));
          break;
        }
      }
    }
  } catch (e) {
    messages.push('Error building seasons chain: ' + (e?.message ?? String(e)));
  }

  // dedupe and sort ascending
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  seasons = Object.values(byId);
  seasons.sort((a,b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  // which seasons to compute? use seasons array; also include fallback for recent numeric years found in static files if seasons empty
  // We'll compute MVPs for each season that we can (from seasons list). If seasons is empty, still attempt to read static files present.
  const seasonsToProcess = seasons.map(s => ({ leagueId: s.league_id, season: s.season }));

  // If no seasons from API, try to inspect static folder for season_matchups/*.json (best-effort)
  if (!seasonsToProcess.length) {
    try {
      // best-effort: attempt to load a few likely years
      const likelyYears = [2022,2023,2024,2025];
      for (const y of likelyYears) seasonsToProcess.push({ leagueId: null, season: String(y) });
    } catch (e) {
      // ignore
    }
  }

  // Pre-fetch player map (heavy) — to resolve names for MVPs
  const playersMap = await fetchPlayersMap();

  const seasonsResults = [];

  // helper to compute mvps from a matchups array (expected shape matches season_matchups JSON)
  function computeMvpsFromMatchups(matchups) {
    // maps playerId -> totalPoints (accumulate across season)
    const overallTotals = {};
    // find highest week number to treat as championshipWeek if needed
    let maxWeek = 0;
    const byWeek = {};
    for (const m of matchups || []) {
      const wk = (m.week ?? m.w ?? 0);
      if (wk > maxWeek) maxWeek = wk;
      if (!byWeek[wk]) byWeek[wk] = [];
      byWeek[wk].push(m);
      // teamA/teamB starters arrays
      ['teamA','teamB'].forEach(side => {
        const t = m[side];
        if (!t) return;
        const starters = Array.isArray(t.starters) ? t.starters : [];
        const pts = Array.isArray(t.starters_points) ? t.starters_points : [];
        for (let i = 0; i < starters.length; i++) {
          const pid = String(starters[i] ?? '').trim();
          if (!pid || pid === '0') continue;
          const ppts = safeNum(pts[i] ?? 0);
          overallTotals[pid] = (overallTotals[pid] || 0) + ppts;
        }
        // fallback: if player_points is an object mapping id->points
        if (t.player_points && typeof t.player_points === 'object') {
          for (const pidKey of Object.keys(t.player_points || {})) {
            const ppts = safeNum(t.player_points[pidKey]);
            overallTotals[String(pidKey)] = (overallTotals[String(pidKey)] || 0) + ppts;
          }
        }
      });
    }

    // compute overall MVP (highest overallTotals)
    let overallMvp = null;
    for (const pid of Object.keys(overallTotals)) {
      const pts = overallTotals[pid] || 0;
      if (!overallMvp || pts > overallMvp.points) overallMvp = { playerId: pid, points: pts };
    }

    // compute finals MVP: use highest week number (championshipWeek) and pick top single-game point scorer that week
    let finalsMvp = null;
    if (maxWeek > 0 && byWeek[maxWeek] && byWeek[maxWeek].length) {
      const weekMap = {};
      for (const m of byWeek[maxWeek]) {
        ['teamA','teamB'].forEach(side => {
          const t = m[side];
          if (!t) return;
          const starters = Array.isArray(t.starters) ? t.starters : [];
          const pts = Array.isArray(t.starters_points) ? t.starters_points : [];
          for (let i = 0; i < starters.length; i++) {
            const pid = String(starters[i] ?? '').trim();
            if (!pid || pid === '0') continue;
            const ppts = safeNum(pts[i] ?? 0);
            weekMap[pid] = Math.max(weekMap[pid] || 0, ppts); // take single-game value (should be just one)
            // we can also sum if multiple entries for same player in week; but starters_points should be per-game
          }
          if (t.player_points && typeof t.player_points === 'object') {
            for (const pidKey of Object.keys(t.player_points || {})) {
              const ppts = safeNum(t.player_points[pidKey]);
              weekMap[String(pidKey)] = Math.max(weekMap[String(pidKey)] || 0, ppts);
            }
          }
        });
      }
      for (const pid of Object.keys(weekMap)) {
        const pts = weekMap[pid] || 0;
        if (!finalsMvp || pts > finalsMvp.points) finalsMvp = { playerId: pid, points: pts, championshipWeek: maxWeek };
      }
    }

    return { overallMvp, finalsMvp, championshipWeek: maxWeek };
  }

  // iterate seasonsToProcess and attempt to compute MVPs for each
  for (const s of seasonsToProcess) {
    const seasonLabel = s.season != null ? String(s.season) : (s.leagueId ? String(s.leagueId) : null);
    let matchups = null;
    let usedJson = null;

    // try local JSON for historical seasons
    if (seasonLabel) {
      const maybeYear = String(seasonLabel).replace(/[^0-9]/g, '').slice(0,4); // best-effort
      if (maybeYear) {
        const loaded = await tryLoadSeasonMatchups(maybeYear, origin);
        if (loaded) {
          matchups = Array.isArray(loaded) ? loaded : (Array.isArray(loaded.matchups) ? loaded.matchups : (loaded.matchups_flat || null));
          // some JSONs may be shaped as { week: [...], ... } or like earlier season_matchups structure (array)
          // Try flexible extraction: if loaded has top-level object keyed by weeks, flatten
          if (!matchups) {
            // detect structure like { "2022": { "1": [...], ... } }
            if (loaded[maybeYear]) {
              // flatten into array of matchups
              const flat = [];
              const yearObj = loaded[maybeYear];
              for (const wk of Object.keys(yearObj || {})) {
                const arr = yearObj[wk];
                if (Array.isArray(arr)) {
                  for (const m of arr) {
                    if (m && (m.week == null)) m.week = Number(wk);
                    flat.push(m);
                  }
                }
              }
              if (flat.length) matchups = flat;
            } else {
              // if loaded is an object with keys that look like numbers => treat as weeks map
              const keys = Object.keys(loaded || {});
              const weekish = keys.filter(k => /^\d+$/.test(k));
              if (weekish.length) {
                const flat = [];
                for (const wk of weekish) {
                  const arr = loaded[wk];
                  if (Array.isArray(arr)) {
                    for (const m of arr) {
                      if (m && (m.week == null)) m.week = Number(wk);
                      flat.push(m);
                    }
                  }
                }
                if (flat.length) matchups = flat;
              }
            }
          }
          usedJson = maybeYear;
          jsonLinks.push({ title: `season_matchups/${maybeYear}.json`, url: origin ? `${origin}/season_matchups/${maybeYear}.json` : `season_matchups/${maybeYear}.json` });
          messages.push(`Loaded local season_matchups JSON for ${maybeYear}.`);
        } else {
          messages.push(`No local season_matchups JSON found for ${maybeYear} — will attempt API fallback for MVPs.`);
        }
      }
    }

    // if no matchups from JSON and this season is the latest (or we want to fall back), try using API
    if (!matchups) {
      // attempt to determine a league id to use — prefer s.leagueId, else BASE_LEAGUE_ID for latest
      const leagueId = s.leagueId || BASE_LEAGUE_ID;
      const aggregated = [];
      // iterate weeks 1..MAX_WEEKS
      for (let wk = 1; wk <= MAX_WEEKS; wk++) {
        try {
          const wkMatchups = await sleeper.getMatchupsForWeek(leagueId, wk, { ttl: 60 * 5 });
          if (Array.isArray(wkMatchups) && wkMatchups.length) {
            for (const m of wkMatchups) {
              if (m && (m.week == null && m.w == null)) m.week = wk;
              aggregated.push(m);
            }
          }
        } catch (e) {
          // ignore single-week failures
        }
      }
      if (aggregated.length) {
        // normalize to shape similar to JSON (teamA/teamB with starters arrays if present)
        matchups = [];
        // raw api matchups are entries per roster; group by matchup id / week
        const byMatch = {};
        for (let i = 0; i < aggregated.length; i++) {
          const e = aggregated[i];
          const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
          const wk = e.week ?? e.w ?? null;
          const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + i));
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(e);
        }
        for (const k of Object.keys(byMatch)) {
          const entries = byMatch[k];
          if (!entries || entries.length === 0) continue;
          if (entries.length === 2) {
            const a = entries[0], b = entries[1];
            // map API fields to expected shape: teamA/teamB with starters and starters_points if present in API
            const mk = {
              week: a.week ?? a.w ?? null,
              teamA: {
                rosterId: String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? ''),
                name: a.team_name ?? null,
                starters: Array.isArray(a.starters) ? a.starters : (Array.isArray(a.player_ids) ? a.player_ids : null),
                starters_points: Array.isArray(a.starters_points) ? a.starters_points : (Array.isArray(a.player_points_arr) ? a.player_points_arr : null),
                player_points: a.player_points ?? null
              },
              teamB: {
                rosterId: String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? ''),
                name: b.team_name ?? null,
                starters: Array.isArray(b.starters) ? b.starters : (Array.isArray(b.player_ids) ? b.player_ids : null),
                starters_points: Array.isArray(b.starters_points) ? b.starters_points : (Array.isArray(b.player_points_arr) ? b.player_points_arr : null),
                player_points: b.player_points ?? null
              },
              teamAScore: (typeof a.points !== 'undefined') ? a.points : (a.points_for ?? a.pts ?? null),
              teamBScore: (typeof b.points !== 'undefined') ? b.points : (b.points_for ?? b.pts ?? null)
            };
            matchups.push(mk);
          } else {
            // many-to-many: try to synthesize combined participants
            const flat = entries.map(ent => {
              return {
                rosterId: String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r'),
                starters: Array.isArray(ent.starters) ? ent.starters : null,
                starters_points: Array.isArray(ent.starters_points) ? ent.starters_points : null,
                player_points: ent.player_points ?? null,
                points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0)
              };
            });
            // create multi-match item with teamA/teamB omitted
            // but our computeMvpsFromMatchups understands teamA/teamB only — to support multi we convert into pseudo team slots
            for (const p of flat) {
              matchups.push({
                week: entries[0]?.week ?? entries[0]?.w ?? null,
                teamA: {
                  rosterId: p.rosterId,
                  starters: p.starters,
                  starters_points: p.starters_points,
                  player_points: p.player_points
                },
                teamAScore: p.points
              });
            }
          }
        }
        if (matchups && matchups.length) {
          messages.push(`Loaded ${matchups.length} matchups via API fallback for season ${seasonLabel} (league ${leagueId}).`);
        }
      } else {
        messages.push(`No API matchups found for league ${leagueId} (season ${seasonLabel}).`);
      }
    }

    // If still no matchups, skip this season
    if (!matchups || !matchups.length) {
      messages.push(`Skipping season ${seasonLabel} — no matchups data available.`);
      seasonsResults.push({
        season: seasonLabel,
        leagueId: s.leagueId || null,
        finalsMvp: null,
        overallMvp: null,
        note: 'no-data'
      });
      continue;
    }

    // compute MVPs from matchups
    const { overallMvp, finalsMvp, championshipWeek } = computeMvpsFromMatchups(matchups);

    // attach player names by looking up playersMap
    function attachName(mvpObj) {
      if (!mvpObj || !mvpObj.playerId) return mvpObj;
      const pid = String(mvpObj.playerId);
      const pObj = (playersMap && (playersMap[pid] || playersMap[pid.toUpperCase()] || playersMap[Number(pid)])) || null;
      const name = pObj ? (pObj.full_name || pObj.first_name ? ((pObj.first_name ? pObj.first_name + (pObj.last_name ? ' ' + pObj.last_name : '') : pObj.full_name)) : (pObj.display_name || pObj.player_name || null)) : null;
      return { ...mvpObj, playerName: name ?? null };
    }

    const attachedOverall = attachName(overallMvp);
    const attachedFinals = attachName(finalsMvp);

    seasonsResults.push({
      season: seasonLabel,
      leagueId: s.leagueId || null,
      championshipWeek: championshipWeek || null,
      finalsMvp: attachedFinals,
      overallMvp: attachedOverall,
      _sourceJson: usedJson || null
    });
  } // end seasons loop

  return {
    seasons,
    seasonsResults,
    jsonLinks,
    messages
  };
}
