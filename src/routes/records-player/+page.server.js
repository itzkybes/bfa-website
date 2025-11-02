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

  // helper: compute playoff start & championship week like honor-hall did
  async function determinePlayoffWindow(leagueId) {
    let playoffStart = null;
    if (!leagueId) return { playoffStart: 15, playoffEnd: 17 };
    try {
      const meta = await sleeper.getLeague(String(leagueId), { ttl: 60 * 5 });
      if (meta && meta.settings) {
        const raw = meta.settings.playoff_week_start ?? meta.settings.playoff_start_week ?? meta.settings.playoffStartWeek;
        const ps = Number(raw);
        if (ps && !isNaN(ps) && ps >= 1) playoffStart = ps;
      }
    } catch (e) {
      // ignore; fallback below
    }
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      playoffStart = 15;
      messages.push(`Playoff start not found for league ${leagueId} — defaulting to week ${playoffStart}`);
    }
    const playoffEnd = playoffStart + 2;
    return { playoffStart, playoffEnd };
  }

  // helper to compute mvps from a matchups array (expected shape matches season_matchups JSON or normalized API)
  function computeMvpsFromMatchups(matchups, championshipWeek /* number or null */) {
    // overall totals (sum of starters_points / player_points)
    const overallTotals = {};
    // build map week -> list
    const byWeek = {};
    let maxWeekFound = 0;
    for (const m of matchups || []) {
      const wk = Number(m.week ?? m.w ?? 0);
      if (wk > maxWeekFound) maxWeekFound = wk;
      if (!byWeek[wk]) byWeek[wk] = [];
      byWeek[wk].push(m);

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

      // also handle the case where multi / combined participants are present (flatten)
      if (m.combinedParticipants && Array.isArray(m.combinedParticipants)) {
        for (const p of m.combinedParticipants) {
          const starters = Array.isArray(p.starters) ? p.starters : (p.rosterId ? [p.rosterId] : []);
          const pts = Array.isArray(p.starters_points) ? p.starters_points : (typeof p.points !== 'undefined' ? [p.points] : []);
          for (let i = 0; i < starters.length; i++) {
            const pid = String(starters[i] ?? '').trim();
            if (!pid || pid === '0') continue;
            const ppts = safeNum(pts[i] ?? 0);
            overallTotals[pid] = (overallTotals[pid] || 0) + ppts;
          }
          if (p.player_points && typeof p.player_points === 'object') {
            for (const pidKey of Object.keys(p.player_points || {})) {
              const ppts = safeNum(p.player_points[pidKey]);
              overallTotals[String(pidKey)] = (overallTotals[String(pidKey)] || 0) + ppts;
            }
          }
        }
      }
    }

    // overall MVP
    let overallMvp = null;
    for (const pid of Object.keys(overallTotals)) {
      const pts = overallTotals[pid] || 0;
      if (!overallMvp || pts > overallMvp.points) overallMvp = { playerId: pid, points: pts };
    }

    // finals MVP:
    // choose championshipWeek if passed, otherwise fallback to maxWeekFound.
    const champWeek = (typeof championshipWeek === 'number' && championshipWeek >= 1) ? championshipWeek : maxWeekFound;
    let finalsMvp = null;
    if (champWeek && byWeek[champWeek] && byWeek[champWeek].length) {
      // **NEW stricter logic**: identify championship matchup(s) (must have both teamA and teamB)
      const championshipMatchups = (byWeek[champWeek] || []).filter(m => (m.teamA && m.teamB));
      const champPlayersPoints = {}; // pid -> points in that championship matchup(s)

      if (championshipMatchups.length) {
        // collect only players who are starters / present on the two teams in those matchup(s)
        for (const m of championshipMatchups) {
          ['teamA','teamB'].forEach(side => {
            const t = m[side];
            if (!t) return;
            const starters = Array.isArray(t.starters) ? t.starters : [];
            const pts = Array.isArray(t.starters_points) ? t.starters_points : [];
            for (let i = 0; i < starters.length; i++) {
              const pid = String(starters[i] ?? '').trim();
              if (!pid || pid === '0') continue;
              const ppts = safeNum(pts[i] ?? 0);
              champPlayersPoints[pid] = (champPlayersPoints[pid] || 0) + ppts;
            }
            if (t.player_points && typeof t.player_points === 'object') {
              for (const pidKey of Object.keys(t.player_points || {})) {
                const ppts = safeNum(t.player_points[pidKey]);
                champPlayersPoints[String(pidKey)] = (champPlayersPoints[String(pidKey)] || 0) + ppts;
              }
            }
          });
        }

        // Now pick the highest scorer among champPlayersPoints (if any)
        for (const pid of Object.keys(champPlayersPoints)) {
          const pts = champPlayersPoints[pid] || 0;
          if (!finalsMvp || pts > finalsMvp.points) finalsMvp = { playerId: pid, points: pts, championshipWeek: champWeek };
        }
      } else {
        // fallback: no matchups with both teams found in championship week — revert to older behavior:
        // pick top single-game scorer among players in the championship week (across all matchups)
        const weekMap = {};
        for (const m of byWeek[champWeek]) {
          ['teamA','teamB'].forEach(side => {
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
          if (!finalsMvp || pts > finalsMvp.points) finalsMvp = { playerId: pid, points: pts, championshipWeek: champWeek };
        }
      }
    }

    // final fallback: if still no finalsMvp, try latest-week top performer (previous fallback)
    if (!finalsMvp && maxWeekFound > 0 && byWeek[maxWeekFound]) {
      const weekMap = {};
      for (const m of byWeek[maxWeekFound]) {
        ['teamA','teamB'].forEach(side => {
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
        if (!finalsMvp || pts > finalsMvp.points) finalsMvp = { playerId: pid, points: pts, championshipWeek: maxWeekFound };
      }
    }

    return { overallMvp, finalsMvp, championshipWeek: (finalsMvp?.championshipWeek || null) };
  }

  // iterate seasonsToProcess and attempt to compute MVPs for each
  for (const s of seasonsToProcess) {
    const seasonLabel = s.season != null ? String(s.season) : (s.leagueId ? String(s.leagueId) : null);
    let matchups = null;
    let usedJson = null;

    // determine playoff window using league metadata (honor-hall style)
    const leagueIdToUse = s.leagueId || BASE_LEAGUE_ID;
    let playoffStart = 15, playoffEnd = 17;
    try {
      const win = await determinePlayoffWindow(leagueIdToUse);
      playoffStart = win.playoffStart;
      playoffEnd = win.playoffEnd;
    } catch (e) {
      // ignore
    }

    // try local JSON for historical seasons
    if (seasonLabel) {
      const maybeYear = String(seasonLabel).replace(/[^0-9]/g, '').slice(0,4); // best-effort
      if (maybeYear) {
        const loaded = await tryLoadSeasonMatchups(maybeYear, origin);
        if (loaded) {
          // normalize various JSON shapes into an array of matchups
          let arr = null;
          if (Array.isArray(loaded)) arr = loaded;
          else if (Array.isArray(loaded.matchups)) arr = loaded.matchups;
          else if (Array.isArray(loaded.matchups_flat)) arr = loaded.matchups_flat;
          else {
            // detect structure like { "2022": { "1": [...], ... } }
            if (loaded[maybeYear]) {
              const flat = [];
              const yearObj = loaded[maybeYear];
              for (const wk of Object.keys(yearObj || {})) {
                const weekArr = yearObj[wk];
                if (Array.isArray(weekArr)) {
                  for (const m of weekArr) {
                    if (m && (m.week == null)) m.week = Number(wk);
                    flat.push(m);
                  }
                }
              }
              if (flat.length) arr = flat;
            } else {
              // top-level keys that look like week numbers
              const keys = Object.keys(loaded || {});
              const weekish = keys.filter(k => /^\d+$/.test(k));
              if (weekish.length) {
                const flat = [];
                for (const wk of weekish) {
                  const weekArr = loaded[wk];
                  if (Array.isArray(weekArr)) {
                    for (const m of weekArr) {
                      if (m && (m.week == null)) m.week = Number(wk);
                      flat.push(m);
                    }
                  }
                }
                if (flat.length) arr = flat;
              }
            }
          }

          if (arr && arr.length) {
            matchups = arr;
            usedJson = maybeYear;
            messages.push(`Loaded local season_matchups JSON for ${maybeYear}.`);
            jsonLinks.push({ title: `season_matchups/${maybeYear}.json`, url: origin ? `${origin}/season_matchups/${maybeYear}.json` : `season_matchups/${maybeYear}.json` });
          }
        } else {
          messages.push(`No local season_matchups JSON found for ${maybeYear} — will attempt API fallback for MVPs.`);
        }
      }
    }

    // if no matchups from JSON, fetch via API (normalize)
    if (!matchups) {
      const aggregated = [];
      for (let wk = 1; wk <= MAX_WEEKS; wk++) {
        try {
          const wkMatchups = await sleeper.getMatchupsForWeek(leagueIdToUse, wk, { ttl: 60 * 5 });
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
        // normalize by grouping by matchup id/week
        const byMatch = {};
        for (let i = 0; i < aggregated.length; i++) {
          const e = aggregated[i];
          const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
          const wk = e.week ?? e.w ?? null;
          const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + i));
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(e);
        }
        const mkArr = [];
        for (const k of Object.keys(byMatch)) {
          const entries = byMatch[k];
          if (!entries || entries.length === 0) continue;
          if (entries.length === 2) {
            const a = entries[0], b = entries[1];
            mkArr.push({
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
            });
          } else {
            // many-to-many entries: flatten into pseudo matchups (each entry becomes its own teamA row)
            for (const ent of entries) {
              mkArr.push({
                week: ent.week ?? ent.w ?? null,
                teamA: {
                  rosterId: String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? ''),
                  name: ent.team_name ?? null,
                  starters: Array.isArray(ent.starters) ? ent.starters : null,
                  starters_points: Array.isArray(ent.starters_points) ? ent.starters_points : null,
                  player_points: ent.player_points ?? null
                },
                teamAScore: (typeof ent.points !== 'undefined') ? ent.points : (ent.points_for ?? ent.pts ?? null)
              });
            }
          }
        }
        matchups = mkArr;
        messages.push(`Loaded ${matchups.length} matchups via API fallback for season ${seasonLabel} (league ${leagueIdToUse}).`);
      } else {
        messages.push(`No API matchups found for league ${leagueIdToUse} (season ${seasonLabel}).`);
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

    // compute MVPs using championshipWeek derived from league's playoff start (honor-hall style)
    const championshipWeek = playoffEnd; // prefer playoffEnd (playoffStart + 2) as championship, matches honor-hall
    const { overallMvp, finalsMvp, championshipWeek: computedChampWeek } = computeMvpsFromMatchups(matchups, championshipWeek);

    // attach player names by looking up playersMap
    function attachName(mvpObj) {
      if (!mvpObj || !mvpObj.playerId) return mvpObj;
      const pid = String(mvpObj.playerId);
      const pObj = (playersMap && (playersMap[pid] || playersMap[pid.toUpperCase()] || playersMap[Number(pid)])) || null;
      const name = pObj ? (pObj.full_name || (pObj.first_name ? (pObj.first_name + (pObj.last_name ? ' ' + pObj.last_name : '')) : null) || pObj.display_name || pObj.player_name || null) : null;
      return { ...mvpObj, playerName: name ?? null, playerObj: pObj ?? null };
    }

    const attachedOverall = attachName(overallMvp);
    const attachedFinals = attachName(finalsMvp);

    messages.push(`Season ${seasonLabel}: computed MVPs via local matchups logic (champWeek ${attachedFinals?.championshipWeek ?? computedChampWeek ?? 'N/A'}).`);

    seasonsResults.push({
      season: seasonLabel,
      leagueId: s.leagueId || null,
      championshipWeek: attachedFinals?.championshipWeek ?? computedChampWeek ?? null,
      finalsMvp: attachedFinals ?? null,
      overallMvp: attachedOverall ?? null,
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
