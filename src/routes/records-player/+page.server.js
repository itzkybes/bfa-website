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

/**
 * Compute MVPs from a flattened matchups array.
 * - overall: season-long accumulation of starters_points (and player_points fallback)
 * - finals: the highest single-game scorer in the given championshipWeek (if provided).
 *
 * matchups: array of matchup objects (teamA/teamB with starters + starters_points or player_points)
 * championshipWeek: number | null — prefer this week when computing finals MVP; if null, fallback to maxWeek
 */
function computeMvpsFromMatchups(matchups, championshipWeek = null) {
  // maps playerId -> totalPoints (accumulate across season)
  const overallTotals = {};
  // find highest week number to treat as fallback championshipWeek if needed
  let maxWeek = 0;
  const byWeek = {};
  for (const m of matchups || []) {
    const wk = Number(m.week ?? m.w ?? 0);
    if (wk > maxWeek) maxWeek = wk;
    if (!byWeek[wk]) byWeek[wk] = [];
    byWeek[wk].push(m);

    // accumulate starters and player_points for overall totals
    ['teamA', 'teamB'].forEach(side => {
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

  // decide which week to treat as championshipWeek: prefer provided championshipWeek, else fallback to maxWeek
  let useChampWeek = (typeof championshipWeek === 'number' && championshipWeek > 0) ? championshipWeek : maxWeek;

  // compute finals MVP ONLY from matchups in useChampWeek
  let finalsMvp = null;
  if (useChampWeek > 0 && byWeek[useChampWeek] && byWeek[useChampWeek].length) {
    // Scan ONLY the matchups that happened in the championship week and pick the highest single-game scorer
    const weekMap = {};
    for (const m of byWeek[useChampWeek]) {
      ['teamA', 'teamB'].forEach(side => {
        const t = m[side];
        if (!t) return;
        const starters = Array.isArray(t.starters) ? t.starters : [];
        const pts = Array.isArray(t.starters_points) ? t.starters_points : [];
        for (let i = 0; i < starters.length; i++) {
          const pid = String(starters[i] ?? '').trim();
          if (!pid || pid === '0') continue;
          const ppts = safeNum(pts[i] ?? 0);
          // finals MVP should be highest single-game scorer, so use Math.max
          weekMap[pid] = Math.max(weekMap[pid] || 0, ppts);
        }
        if (t.player_points && typeof t.player_points === 'object') {
          for (const pidKey of Object.keys(t.player_points || {})) {
            const ppts = safeNum(t.player_points[pidKey]);
            weekMap[String(pidKey)] = Math.max(weekMap[String(pidKey)] || 0, ppts);
          }
        }
      });
    }
    // pick highest single-game scorer in the championship week
    for (const pid of Object.keys(weekMap)) {
      const pts = weekMap[pid] || 0;
      if (!finalsMvp || pts > finalsMvp.points) finalsMvp = { playerId: pid, points: pts, championshipWeek: useChampWeek };
    }
  } else {
    // no matchups in championship week — no finals mvp (or fallback to previous logic: maxWeek)
    if (maxWeek > 0 && byWeek[maxWeek] && byWeek[maxWeek].length) {
      // fallback to maxWeek (preserve older behavior)
      const weekMap = {};
      for (const m of byWeek[maxWeek]) {
        ['teamA', 'teamB'].forEach(side => {
          const t = m[side];
          if (!t) return;
          const starters = Array.isArray(t.starters) ? t.starters : [];
          const pts = Array.isArray(t.starters_points) ? t.starters_points : [];
          for (let i = 0; i < starters.length; i++) {
            const pid = String(starters[i] ?? '').trim();
            if (!pid || pid === '0') continue;
            const ppts = safeNum(pts[i] ?? 0);
            weekMap[pid] = Math.max(weekMap[pid] || 0, ppts);
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
  }

  return { overallMvp, finalsMvp, championshipWeek: (finalsMvp ? finalsMvp.championshipWeek : (useChampWeek || null)) };
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
  const seasonsToProcess = seasons.map(s => ({ leagueId: s.league_id, season: s.season }));

  if (!seasonsToProcess.length) {
    // best-effort fallback
    const likelyYears = [2022,2023,2024,2025];
    for (const y of likelyYears) seasonsToProcess.push({ leagueId: null, season: String(y) });
  }

  // Pre-fetch player map (heavy) — to resolve names for MVPs
  const playersMap = await fetchPlayersMap();

  const seasonsResults = [];

  // iterate seasonsToProcess and attempt to compute MVPs for each
  for (const s of seasonsToProcess) {
    const seasonLabel = s.season != null ? String(s.season) : (s.leagueId ? String(s.leagueId) : null);
    let matchups = null;
    let usedJson = null;

    // Determine championshipWeek by consulting league metadata when possible
    let championshipWeekFromLeague = null;
    if (s.leagueId) {
      try {
        const leagueMeta = await sleeper.getLeague(String(s.leagueId), { ttl: 60 * 5 });
        let playoffStart = null;
        if (leagueMeta && leagueMeta.settings) {
          playoffStart = Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek);
        }
        if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
        championshipWeekFromLeague = playoffStart + 2;
        messages.push(`Season ${seasonLabel}: determined playoff start ${playoffStart}, championship week ${championshipWeekFromLeague} from league ${s.leagueId}.`);
      } catch (e) {
        // ignore — we'll fallback later
        messages.push(`Season ${seasonLabel}: failed to fetch league metadata for ${s.leagueId} — will fallback to data-derived championship week.`);
      }
    }

    // try local JSON for historical seasons
    if (seasonLabel) {
      const maybeYear = String(seasonLabel).replace(/[^0-9]/g, '').slice(0,4); // best-effort
      if (maybeYear) {
        const loaded = await tryLoadSeasonMatchups(maybeYear, origin);
        if (loaded) {
          // try to extract matchups in flexible shapes
          if (Array.isArray(loaded)) matchups = loaded;
          else if (Array.isArray(loaded.matchups)) matchups = loaded.matchups;
          else if (Array.isArray(loaded.matchups_flat)) matchups = loaded.matchups_flat;
          else {
            // detect structure like { "2022": { "1": [...], ... } } or { "1": [...] }
            if (loaded[maybeYear]) {
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

          if (matchups && matchups.length) {
            usedJson = maybeYear;
            jsonLinks.push({ title: `season_matchups/${maybeYear}.json`, url: origin ? `${origin}/season_matchups/${maybeYear}.json` : `season_matchups/${maybeYear}.json` });
            messages.push(`Loaded local season_matchups JSON for ${maybeYear}.`);
          } else {
            messages.push(`Loaded JSON for ${maybeYear} but could not extract matchups — skipping JSON for this season.`);
          }
        } else {
          messages.push(`No local season_matchups JSON found for ${maybeYear} — will attempt API fallback for MVPs.`);
        }
      }
    }

    // if no matchups from JSON, try using API (use leagueId when available)
    if (!matchups) {
      const leagueId = s.leagueId || BASE_LEAGUE_ID;
      const aggregated = [];
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
        // normalize api matchups to a shape compatible with computeMvpsFromMatchups
        matchups = [];
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
            // many-to-many: synthesize single-team entries so computeMvps can still process starters/points
            for (const ent of entries) {
              matchups.push({
                week: ent.week ?? ent.w ?? null,
                teamA: {
                  rosterId: String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r'),
                  starters: Array.isArray(ent.starters) ? ent.starters : null,
                  starters_points: Array.isArray(ent.starters_points) ? ent.starters_points : null,
                  player_points: ent.player_points ?? null
                },
                teamAScore: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0)
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

    // compute MVPs, preferring the championshipWeek from league metadata if present
    const { overallMvp, finalsMvp, championshipWeek } = computeMvpsFromMatchups(matchups, championshipWeekFromLeague);

    // attach player names by looking up playersMap
    function attachName(mvpObj) {
      if (!mvpObj || !mvpObj.playerId) return mvpObj;
      const pid = String(mvpObj.playerId);
      const pObj = (playersMap && (playersMap[pid] || playersMap[pid.toUpperCase()] || playersMap[Number(pid)])) || null;
      const name = pObj ? (pObj.full_name || (pObj.first_name ? (pObj.first_name + (pObj.last_name ? ' ' + pObj.last_name : '')) : pObj.display_name || pObj.player_name)) : null;
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
