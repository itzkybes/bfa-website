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
 * Compute MVPs from an array of matchups.
 * Improvements vs prior: Finals MVP is computed only from the single championship matchup
 * (identified as the matchup in the championship week that contains the two finalists).
 * If semis can be detected (week = championshipWeek - 1) winners are used to identify final pairing.
 */
function computeMvpsFromMatchups(matchups) {
  // maps playerId -> totalPoints (accumulate across season)
  const overallTotals = {};
  // find highest week number to treat as championshipWeek if needed
  let maxWeek = 0;
  const byWeek = {};
  for (const m of matchups || []) {
    const wk = Number(m.week ?? m.w ?? 0) || 0;
    if (wk > maxWeek) maxWeek = wk;
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
  }

  // compute overall MVP (highest overallTotals)
  let overallMvp = null;
  for (const pid of Object.keys(overallTotals)) {
    const pts = overallTotals[pid] || 0;
    if (!overallMvp || pts > overallMvp.points) overallMvp = { playerId: pid, points: pts };
  }

  // Finals MVP: find the championship matchup row and pick the top single-game scorer from that game only.
  let finalsMvp = null;
  if (maxWeek > 0) {
    const championshipWeek = maxWeek;
    // candidate final rows in championshipWeek
    const finalsCandidates = (byWeek[championshipWeek] || []).filter(r => r && (r.participantsCount === 2 || Array.isArray(r.combinedParticipants)));
    let finalsRow = null;

    // If exactly one candidate, use it
    if (finalsCandidates.length === 1) {
      finalsRow = finalsCandidates[0];
    } else if (finalsCandidates.length > 1) {
      // Attempt to detect finalists from semis (championshipWeek - 1)
      const semisWeek = championshipWeek - 1;
      const semis = (byWeek[semisWeek] || []).filter(r => r && r.participantsCount === 2);
      const semisWinners = [];
      for (const s of semis) {
        try {
          const aId = String(s.teamA?.rosterId ?? '');
          const bId = String(s.teamB?.rosterId ?? '');
          const aPts = safeNum(s.teamA?.points ?? s.teamA?.teamAScore ?? s.teamAScore);
          const bPts = safeNum(s.teamB?.points ?? s.teamB?.teamBScore ?? s.teamBScore);
          if (aId && bId) {
            if (aPts > bPts + 1e-9) semisWinners.push(aId);
            else if (bPts > aPts + 1e-9) semisWinners.push(bId);
            // ties fall through and we won't have a guaranteed winner from that semis
          }
        } catch (e) { /* ignore */ }
      }
      if (semisWinners.length >= 2) {
        // find candidate finalsRow that contains both semis winners
        for (const cand of finalsCandidates) {
          if (!cand) continue;
          if (cand.participantsCount === 2) {
            const a = String(cand.teamA?.rosterId ?? '');
            const b = String(cand.teamB?.rosterId ?? '');
            if (semisWinners.includes(a) && semisWinners.includes(b)) {
              finalsRow = cand;
              break;
            }
          } else if (Array.isArray(cand.combinedParticipants)) {
            const ids = cand.combinedParticipants.map(p => String(p.rosterId));
            if (semisWinners.every(w => ids.includes(w))) {
              finalsRow = cand;
              break;
            }
          }
        }
      }
      // fallback: if no match, pick the candidate with participantsCount===2 and highest combined points (best guess)
      if (!finalsRow) {
        let best = null;
        let bestSum = -Infinity;
        for (const cand of finalsCandidates) {
          if (!cand) continue;
          let sum = 0;
          if (cand.participantsCount === 2) {
            sum = safeNum(cand.teamA?.points ?? 0) + safeNum(cand.teamB?.points ?? 0);
          } else if (Array.isArray(cand.combinedParticipants)) {
            sum = cand.combinedParticipants.reduce((acc, p) => acc + safeNum(p.points), 0);
          }
          if (sum > bestSum) {
            bestSum = sum;
            best = cand;
          }
        }
        finalsRow = best || finalsCandidates[0];
      }
    }

    // Compute top scorer only from finalsRow
    if (finalsRow) {
      const localPoints = {};
      // helper to note points
      const notePoints = (pid, pts) => {
        if (!pid || pid === '0') return;
        const id = String(pid);
        localPoints[id] = (localPoints[id] || 0) + Number(pts || 0);
      };

      for (const side of ['teamA','teamB']) {
        const t = finalsRow[side];
        if (!t) continue;
        if (Array.isArray(t.starters) && Array.isArray(t.starters_points) && t.starters.length === t.starters_points.length) {
          for (let i = 0; i < t.starters.length; i++) {
            notePoints(String(t.starters[i]), safeNum(t.starters_points[i]));
          }
        } else if (Array.isArray(t.player_points)) {
          for (const pp of t.player_points) {
            const pid = String(pp.player_id ?? pp.playerId ?? '');
            const ppts = Number(pp.points ?? pp.pts ?? 0);
            notePoints(pid, ppts);
          }
        } else if (t.player_points && typeof t.player_points === 'object') {
          for (const pidKey of Object.keys(t.player_points || {})) {
            notePoints(String(pidKey), safeNum(t.player_points[pidKey]));
          }
        }
      }

      for (const pid of Object.keys(localPoints)) {
        const pts = localPoints[pid] || 0;
        if (!finalsMvp || pts > finalsMvp.points) finalsMvp = { playerId: pid, points: pts, championshipWeek: championshipWeek };
      }
    } else {
      // no identified finalsRow — fall back to top scorer across the championship week (less ideal)
      const weekMap = {};
      for (const m of (byWeek[maxWeek] || [])) {
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
        if (!finalsMvp || pts > finalsMvp.points) finalsMvp = { playerId: pid, points: pts, championshipWeek: maxWeek };
      }
    }
  }

  return { overallMvp, finalsMvp, championshipWeek: maxWeek };
}

export async function load(event) {
  // small edge cache
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const url = event.url;
  const origin = url?.origin ?? null;

  // read incoming season param so server can honor the dropdown selection
  const seasonParam = url.searchParams.get('season') ?? null;

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
  } catch (err) {
    messages.push('Error building seasons chain: ' + (err?.message ?? String(err)));
  }

  // de-dupe + sort ascending by season
  const byId = {};
  for (const s of seasons) byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  seasons = Object.values(byId);
  seasons.sort((a,b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return (a.season < b.season ? -1 : (a.season > b.season ? 1 : 0));
  });

  // determine server-side selectedSeason (honor incoming season param if present)
  let selectedSeason = seasonParam;
  if (!selectedSeason) {
    if (seasons.length) selectedSeason = seasons[seasons.length - 1].season != null ? String(seasons[seasons.length - 1].season) : String(seasons[seasons.length - 1].league_id);
  }

  // which seasons to compute? use seasons array; also include fallback for recent numeric years found in static files if seasons empty
  const seasonsToProcess = seasons.map(s => ({ leagueId: s.league_id, season: s.season }));

  if (!seasonsToProcess.length) {
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

    // try local JSON for historical seasons
    if (seasonLabel) {
      const maybeYear = String(seasonLabel).replace(/[^0-9]/g, '').slice(0,4); // best-effort
      if (maybeYear) {
        const loaded = await tryLoadSeasonMatchups(maybeYear, origin);
        if (loaded) {
          matchups = Array.isArray(loaded) ? loaded : (Array.isArray(loaded.matchups) ? loaded.matchups : (loaded.matchups_flat || null));
          // some JSONs may be shaped as { week: [...], ... } or like earlier season_matchups structure (array)
          if (!matchups) {
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
        // normalize to shape similar to JSON (teamA/teamB with starters arrays if present in API)
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
                player_points: a.player_points ?? null,
                points: (typeof a.points !== 'undefined') ? a.points : (a.points_for ?? a.pts ?? null)
              },
              teamB: {
                rosterId: String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? ''),
                name: b.team_name ?? null,
                starters: Array.isArray(b.starters) ? b.starters : (Array.isArray(b.player_ids) ? b.player_ids : null),
                starters_points: Array.isArray(b.starters_points) ? b.starters_points : (Array.isArray(b.player_points_arr) ? b.player_points_arr : null),
                player_points: b.player_points ?? null,
                points: (typeof b.points !== 'undefined') ? b.points : (b.points_for ?? b.pts ?? null)
              },
              teamAScore: (typeof a.points !== 'undefined') ? a.points : (a.points_for ?? a.pts ?? null),
              teamBScore: (typeof b.points !== 'undefined') ? b.points : (b.points_for ?? b.pts ?? null)
            };
            matchups.push(mk);
          } else {
            // many-to-many -> convert to pseudo single-team matchups so compute function can still sum starters
            for (const ent of entries) {
              matchups.push({
                week: ent.week ?? ent.w ?? null,
                teamA: {
                  rosterId: String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r'),
                  starters: Array.isArray(ent.starters) ? ent.starters : (Array.isArray(ent.player_ids) ? ent.player_ids : null),
                  starters_points: Array.isArray(ent.starters_points) ? ent.starters_points : (Array.isArray(ent.player_points_arr) ? ent.player_points_arr : null),
                  player_points: ent.player_points ?? null,
                  points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0)
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

    // compute MVPs from matchups
    const { overallMvp, finalsMvp, championshipWeek } = computeMvpsFromMatchups(matchups);

    // attach player names by looking up playersMap
    function attachName(mvpObj) {
      if (!mvpObj || !mvpObj.playerId) return mvpObj;
      const pid = String(mvpObj.playerId);
      const pObj = (playersMap && (playersMap[pid] || playersMap[pid.toUpperCase()] || playersMap[Number(pid)])) || null;
      const name = pObj ? (pObj.full_name || (pObj.first_name ? (pObj.first_name + (pObj.last_name ? ' ' + pObj.last_name : '')) : pObj.display_name || pObj.player_name || null)) : null;
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
    messages,
    selectedSeason
  };
}
