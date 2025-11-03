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
 * Try to load a season_matchups JSON by year (origin then disk).
 */
async function tryLoadSeasonMatchups(year, origin) {
  try {
    if (typeof fetch === 'function' && origin) {
      const url = origin.replace(/\/$/, '') + `/season_matchups/${year}.json`;
      const res = await fetch(url, { method: 'GET' }).catch(() => null);
      if (res && res.ok) {
        const txt = await res.text();
        return JSON.parse(txt);
      }
    }
  } catch (e) {
    // fallback to disk
  }

  try {
    const fileUrl = new URL(`../../../static/season_matchups/${year}.json`, import.meta.url);
    const txt = await readFile(fileUrl, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

/**
 * Fetch players map from Sleeper public API as fallback (NBA).
 */
async function fetchPlayersMap() {
  try {
    // prefer client helper if available on sleeper, otherwise do fetch
    if (sleeper && typeof sleeper.getPlayers === 'function') {
      const map = await sleeper.getPlayers('nba', { ttl: 60 * 60 }).catch(() => null);
      if (map && typeof map === 'object') return map;
    }
  } catch (e) {}
  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nba');
    if (!res || !res.ok) return {};
    const obj = await res.json();
    return obj || {};
  } catch (e) {
    return {};
  }
}

/**
 * computeMvpsFromMatchups:
 * - overallMvp: sum of starter points (and any player_points) across fullSeasonMatchupsRows (weeks 1..playoffEnd)
 * - finalsMvp: must be a player who appeared in the championship matchup(s) (week == playoffEnd), pick highest single-game points among those players.
 *
 * Input shapes accepted:
 * - each matchup may have teamA/teamB objects with starters (array) and starters_points (array) and/or player_points (object or array)
 */
function computeMvpsFromMatchups(matchups, playoffStart, playoffEnd, fullSeasonMatchupsRows = null) {
  const overallTotals = {}; // pid -> total
  const byWeek = {}; // week -> [matchups]
  let maxWeek = 0;

  const pushPts = (map, pid, pts) => {
    if (!pid || pid === '0' || pid === 0) return;
    const id = String(pid);
    map[id] = (map[id] || 0) + Number(pts || 0);
  };

  for (const m of matchups || []) {
    const wk = Number(m.week ?? m.w ?? 0);
    if (wk > maxWeek) maxWeek = wk;
    if (!byWeek[wk]) byWeek[wk] = [];
    byWeek[wk].push(m);
  }

  // overall totals: prefer fullSeasonMatchupsRows (weeks 1..playoffEnd) if provided, else fallback to 'matchups' and sum what we have
  const seasonRows = fullSeasonMatchupsRows && fullSeasonMatchupsRows.length ? fullSeasonMatchupsRows : matchups;

  for (const m of seasonRows || []) {
    const wk = Number(m.week ?? m.w ?? 0);
    // only sum weeks from 1..playoffEnd if playoffEnd meaningful; if not provided, include all
    if (playoffEnd && wk > playoffEnd) continue;

    for (const side of ['teamA','teamB']) {
      const t = m[side];
      if (!t) continue;

      if (Array.isArray(t.starters) && Array.isArray(t.starters_points)) {
        for (let i = 0; i < t.starters.length; i++) {
          const pid = String(t.starters[i] ?? '').trim();
          if (!pid || pid === '0') continue;
          pushPts(overallTotals, pid, t.starters_points[i] ?? 0);
        }
      }
      // handle object mapping player_id -> points
      if (t.player_points && typeof t.player_points === 'object') {
        // could be array of { player_id, points } or object mapping
        if (Array.isArray(t.player_points)) {
          for (const pp of t.player_points) {
            const pid = pp.player_id ?? pp.playerId ?? pp.id ?? null;
            const pts = pp.points ?? pp.pts ?? 0;
            pushPts(overallTotals, pid, pts);
          }
        } else {
          for (const pidKey of Object.keys(t.player_points || {})) {
            const ppts = safeNum(t.player_points[pidKey]);
            pushPts(overallTotals, pidKey, ppts);
          }
        }
      }
    }
  }

  // determine overall MVP
  let overallMvp = null;
  for (const pid of Object.keys(overallTotals)) {
    const pts = overallTotals[pid] || 0;
    if (!overallMvp || pts > overallMvp.points) overallMvp = { playerId: pid, points: pts };
  }

  // finals MVP: find championship matchup(s) for playoffEnd (must have both teams)
  let finalsMvp = null;
  const champWeek = Number(playoffEnd || maxWeek);
  const weekMatchups = byWeek[champWeek] || [];

  // identify championship matchups (those with both teamA & teamB)
  const championshipMatchups = weekMatchups.filter(m => m && m.teamA && m.teamB);

  // collect points only for players who appear in those matchup teams
  const champPlayersPoints = {}; // pid -> points (in that matchup)
  if (championshipMatchups.length) {
    for (const m of championshipMatchups) {
      for (const side of ['teamA','teamB']) {
        const t = m[side];
        if (!t) continue;
        if (Array.isArray(t.starters) && Array.isArray(t.starters_points)) {
          for (let i = 0; i < t.starters.length; i++) {
            const pid = String(t.starters[i] ?? '').trim();
            if (!pid || pid === '0') continue;
            const ppts = safeNum(t.starters_points[i] ?? 0);
            champPlayersPoints[pid] = Math.max(champPlayersPoints[pid] || 0, ppts);
          }
        }
        // player_points object/array
        if (t.player_points && typeof t.player_points === 'object') {
          if (Array.isArray(t.player_points)) {
            for (const pp of t.player_points) {
              const pid = pp.player_id ?? pp.playerId ?? pp.id ?? null;
              const pts = safeNum(pp.points ?? pp.pts ?? 0);
              if (!pid || pid === '0') continue;
              champPlayersPoints[String(pid)] = Math.max(champPlayersPoints[String(pid)] || 0, pts);
            }
          } else {
            for (const pidKey of Object.keys(t.player_points || {})) {
              const ppts = safeNum(t.player_points[pidKey]);
              champPlayersPoints[pidKey] = Math.max(champPlayersPoints[pidKey] || 0, ppts);
            }
          }
        }
      }
    }

    // pick top
    for (const pid of Object.keys(champPlayersPoints)) {
      const pts = champPlayersPoints[pid] || 0;
      if (!finalsMvp || pts > finalsMvp.points) finalsMvp = { playerId: pid, points: pts, championshipWeek: champWeek };
    }
  } else {
    // fallback: if we can't find pair-style matchups for that week, fall back to picking best single-game scorer in the championship week (but only among participants that week)
    const weekMap = {};
    for (const m of weekMatchups) {
      for (const side of ['teamA','teamB']) {
        const t = m[side];
        if (!t) continue;
        if (Array.isArray(t.starters) && Array.isArray(t.starters_points)) {
          for (let i = 0; i < t.starters.length; i++) {
            const pid = String(t.starters[i] ?? '').trim();
            if (!pid || pid === '0') continue;
            const ppts = safeNum(t.starters_points[i] ?? 0);
            weekMap[pid] = Math.max(weekMap[pid] || 0, ppts);
          }
        }
        if (t.player_points && typeof t.player_points === 'object') {
          if (Array.isArray(t.player_points)) {
            for (const pp of t.player_points) {
              const pid = pp.player_id ?? pp.playerId ?? pp.id ?? null;
              const pts = safeNum(pp.points ?? pp.pts ?? 0);
              if (!pid || pid === '0') continue;
              weekMap[String(pid)] = Math.max(weekMap[String(pid)] || 0, pts);
            }
          } else {
            for (const pidKey of Object.keys(t.player_points || {})) {
              const ppts = safeNum(t.player_points[pidKey]);
              weekMap[pidKey] = Math.max(weekMap[pidKey] || 0, ppts);
            }
          }
        }
      }
    }
    for (const pid of Object.keys(weekMap)) {
      const pts = weekMap[pid] || 0;
      if (!finalsMvp || pts > finalsMvp.points) finalsMvp = { playerId: pid, points: pts, championshipWeek: champWeek };
    }
  }

  return { overallMvp, finalsMvp, championshipWeek: (finalsMvp?.championshipWeek ?? null) };
}

export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const url = event.url;
  const origin = url?.origin ?? null;

  const messages = [];
  const jsonLinks = [];

  // build seasons chain (like other pages)
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { mainLeague = null; messages.push('Failed loading base league: ' + (e?.message ?? e)); }
    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id), season: mainLeague.season ?? null, name: mainLeague.name ?? null });
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prev = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prev) break;
          seasons.push({ league_id: String(prev.league_id), season: prev.season ?? null, name: prev.name ?? null });
          currPrev = prev.previous_league_id ? String(prev.previous_league_id) : null;
        } catch (err) { break; }
      }
    }
  } catch (e) {
    messages.push('Error building seasons chain: ' + (e?.message ?? e));
  }

  // dedupe + sort ascending
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

  // Pre-fetch players map for name resolution / images
  const playersMap = await fetchPlayersMap();

  const seasonsResults = [];

  // We'll process each season candidate (either from seasons or fallback numeric years)
  const seasonsToProcess = seasons.length ? seasons.map(s => ({ leagueId: s.league_id, season: s.season })) : [{ leagueId: BASE_LEAGUE_ID, season: new Date().getFullYear() }];

  for (const s of seasonsToProcess) {
    const seasonLabel = s.season != null ? String(s.season) : (s.leagueId ? String(s.leagueId) : null);
    let matchups = null;
    let usedJson = null;

    // Determine playoffStart/playoffEnd from league meta (preferred)
    let leagueIdToUse = s.leagueId || BASE_LEAGUE_ID;
    let playoffStart = 15;
    try {
      const meta = await sleeper.getLeague(leagueIdToUse, { ttl: 60 * 5 });
      const raw = meta?.settings?.playoff_week_start ?? meta?.settings?.playoff_start_week ?? meta?.settings?.playoffStartWeek;
      const ps = Number(raw);
      if (ps && !isNaN(ps) && ps >= 1) playoffStart = ps;
      else messages.push(`Season ${seasonLabel}: playoff_week_start not found in league meta — using default ${playoffStart}.`);
    } catch (e) {
      messages.push(`Season ${seasonLabel}: failed to fetch league meta for ${leagueIdToUse} — ${e?.message ?? e}. Defaulting playoff start ${playoffStart}.`);
    }
    const playoffEnd = playoffStart + 2;

    // Attempt to load local JSON first
    if (seasonLabel) {
      const maybeYear = String(seasonLabel).replace(/[^0-9]/g, '').slice(0,4);
      if (maybeYear) {
        const loaded = await tryLoadSeasonMatchups(maybeYear, origin);
        if (loaded) {
          // normalize loaded into array of matchups
          let arr = null;
          if (Array.isArray(loaded)) arr = loaded;
          else if (Array.isArray(loaded.matchups)) arr = loaded.matchups;
          else if (Array.isArray(loaded.matchups_flat)) arr = loaded.matchups_flat;
          else if (loaded[maybeYear]) { // shape { "2022": { "1": [...] } }
            const flat = [];
            const yearObj = loaded[maybeYear];
            for (const wk of Object.keys(yearObj || {})) {
              const arrwk = yearObj[wk];
              if (Array.isArray(arrwk)) {
                for (const m of arrwk) {
                  if (m && (m.week == null)) m.week = Number(wk);
                  flat.push(m);
                }
              }
            }
            if (flat.length) arr = flat;
          } else {
            // flatten keys that look numeric
            const keys = Object.keys(loaded || {});
            const weekish = keys.filter(k => /^\d+$/.test(k));
            if (weekish.length) {
              const flat = [];
              for (const wk of weekish) {
                const arrwk = loaded[wk];
                if (Array.isArray(arrwk)) {
                  for (const m of arrwk) {
                    if (m && (m.week == null)) m.week = Number(wk);
                    flat.push(m);
                  }
                }
              }
              if (flat.length) arr = flat;
            }
          }

          if (arr && arr.length) {
            matchups = arr;
            usedJson = maybeYear;
            jsonLinks.push({ title: `season_matchups/${maybeYear}.json`, url: origin ? `${origin}/season_matchups/${maybeYear}.json` : `season_matchups/${maybeYear}.json` });
            messages.push(`Loaded local season_matchups JSON for ${maybeYear}.`);
          } else {
            messages.push(`Found season_matchups/${maybeYear}.json but couldn't normalize its structure — will attempt API fallback.`);
          }
        } else {
          messages.push(`No local season_matchups JSON found for ${maybeYear} — will attempt API fallback for MVPs.`);
        }
      }
    }

    // If no JSON, fetch matchups via API for weeks 1..playoffEnd (full-season) and for all available weeks to compute overall totals
    let fullSeasonMatchupsRows = null;
    if (!matchups) {
      // aggregated raw from API for weeks 1..playoffEnd (full season)
      const rawAll = [];
      for (let wk = 1; wk <= Math.min(playoffEnd, MAX_WEEKS); wk++) {
        try {
          const wkMatchups = await sleeper.getMatchupsForWeek(leagueIdToUse, wk, { ttl: 60 * 5 });
          if (Array.isArray(wkMatchups) && wkMatchups.length) {
            for (const m of wkMatchups) {
              if (m && (m.week == null && m.w == null)) m.week = wk;
              rawAll.push(m);
            }
          }
        } catch (e) {
          // ignore
        }
      }

      // normalize rawAll into teamA/teamB/teamAScore etc.
      if (rawAll.length) {
        const byMatch = {};
        for (let i = 0; i < rawAll.length; i++) {
          const e = rawAll[i];
          const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
          const wk = e.week ?? e.w ?? null;
          const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + i));
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(e);
        }
        const mk = [];
        for (const key of Object.keys(byMatch)) {
          const entries = byMatch[key];
          if (!entries || !entries.length) continue;
          if (entries.length === 2) {
            const a = entries[0], b = entries[1];
            mk.push({
              week: a.week ?? a.w ?? null,
              teamA: { rosterId: String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? ''), starters: a.starters ?? null, starters_points: a.starters_points ?? null, player_points: a.player_points ?? null },
              teamB: { rosterId: String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? ''), starters: b.starters ?? null, starters_points: b.starters_points ?? null, player_points: b.player_points ?? null },
              teamAScore: (typeof a.points !== 'undefined') ? a.points : (a.points_for ?? a.pts ?? null),
              teamBScore: (typeof b.points !== 'undefined') ? b.points : (b.points_for ?? b.pts ?? null)
            });
          } else {
            // flatten many-to-many into separate pseudo matchups (teamA only)
            for (const ent of entries) {
              mk.push({
                week: ent.week ?? ent.w ?? null,
                teamA: { rosterId: String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? ''), starters: ent.starters ?? null, starters_points: ent.starters_points ?? null, player_points: ent.player_points ?? null },
                teamAScore: (typeof ent.points !== 'undefined') ? ent.points : (ent.points_for ?? ent.pts ?? null)
              });
            }
          }
        }
        fullSeasonMatchupsRows = mk;
        messages.push(`Loaded ${mk.length} matchups via API for season ${seasonLabel} (league ${leagueIdToUse}).`);
      } else {
        messages.push(`No matchups returned from API for season ${seasonLabel} (league ${leagueIdToUse}).`);
      }
    } else {
      // we used JSON; treat that as fullSeasonMatchupsRows
      fullSeasonMatchupsRows = matchups.slice();
    }

    // If no fullSeasonMatchupsRows at this point, skip season
    if (!fullSeasonMatchupsRows || !fullSeasonMatchupsRows.length) {
      messages.push(`Skipping season ${seasonLabel} — no matchups data available.`);
      seasonsResults.push({
        season: seasonLabel,
        leagueId: leagueIdToUse,
        finalsMvp: null,
        overallMvp: null,
        _sourceJson: usedJson ?? null
      });
      continue;
    }

    // compute MVPs (we look at fullSeasonMatchupsRows for overall and matchups subset for finals)
    const { overallMvp, finalsMvp, championshipWeek } = computeMvpsFromMatchups(fullSeasonMatchupsRows, playoffStart, playoffEnd, fullSeasonMatchupsRows);

    // attach player objects from playersMap (for images/names)
    function attach(mvpObj) {
      if (!mvpObj || !mvpObj.playerId) return null;
      const pid = String(mvpObj.playerId);
      const pObj = playersMap && (playersMap[pid] || playersMap[pid.toUpperCase()] || playersMap[Number(pid)]) ? (playersMap[pid] || playersMap[pid.toUpperCase()] || playersMap[Number(pid)]) : null;
      return { ...mvpObj, playerObj: pObj ?? null, playerName: (mvpObj.playerName ?? (pObj ? (pObj.full_name || (pObj.first_name ? (pObj.first_name + (pObj.last_name ? ' ' + pObj.last_name : '')) : pObj.display_name || pObj.player_name) ) : null) ) };
    }

    const attachedOverall = attach(overallMvp);
    const attachedFinals = attach(finalsMvp);

    messages.push(`Season ${seasonLabel}: computed MVPs (champWeek ${championshipWeek ?? playoffEnd}).`);

    seasonsResults.push({
      season: seasonLabel,
      leagueId: leagueIdToUse,
      championshipWeek: championshipWeek ?? playoffEnd,
      finalsMvp: attachedFinals ?? null,
      overallMvp: attachedOverall ?? null,
      _sourceJson: usedJson ?? null
    });
  } // end seasons loop

  return {
    seasons,
    seasonsResults,
    jsonLinks,
    messages
  };
}
