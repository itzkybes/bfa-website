// src/routes/records-player/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { readFile } from 'fs/promises';
import { stat } from 'fs/promises';

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

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

async function tryReadJson(pathUrl) {
  try {
    const txt = await readFile(pathUrl, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

export async function load(event) {
  // cache for edge
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];
  const jsonLinks = [];

  // build seasons chain (league + previous chain)
  let seasons = [];
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { mainLeague = null; messages.push('Failed fetching base league metadata: ' + (e?.message ?? e)); }
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
        } catch (err) {
          messages.push('Error fetching previous league ' + currPrev + ' — ' + (err?.message ?? err));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error building seasons chain: ' + (err?.message ?? err));
  }

  // dedupe + sort ascending by season (same as other pages)
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

  // selected season param from URL
  const url = event.url;
  const seasonParam = url.searchParams.get('season') ?? null;
  let selectedSeasonParam = seasonParam;
  if (!selectedSeasonParam) {
    if (seasons.length) selectedSeasonParam = seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id;
  }

  // find matching league id for selectedSeason (either season value or league_id)
  let selectedLeagueId = null;
  for (const s of seasons) {
    if (String(s.season) === String(selectedSeasonParam) || String(s.league_id) === String(selectedSeasonParam)) {
      selectedLeagueId = String(s.league_id);
      selectedSeasonParam = s.season ?? selectedSeasonParam;
      break;
    }
  }
  if (!selectedLeagueId && seasons.length) selectedLeagueId = seasons[seasons.length - 1].league_id;

  // try to load season_matchups JSON files from static/season_matchups/{season}.json for each season
  // path relative to this file: ../../../static/season_matchups/{season}.json
  const mvpBySeason = {};
  const loadedFiles = [];

  for (const s of seasons) {
    const key = s.season != null ? String(s.season) : String(s.league_id);
    let foundJson = null;
    if (s.season != null) {
      // attempt to read static file
      try {
        const fileUrl = new URL(`../../../static/season_matchups/${s.season}.json`, import.meta.url);
        // check existence
        try {
          await stat(fileUrl);
          const parsed = await tryReadJson(fileUrl);
          if (parsed) {
            foundJson = parsed;
            jsonLinks.push({ title: `season_matchups/${s.season}.json`, url: `/season_matchups/${s.season}.json` });
            loadedFiles.push(`season_matchups/${s.season}.json`);
            messages.push(`Loaded local season_matchups JSON for ${s.season}.`);
          }
        } catch (e) {
          // file not present locally — skip
        }
      } catch (e) {
        // ignore
      }
    }

    if (!foundJson) {
      messages.push(`No local season_matchups JSON found for ${s.season ?? s.league_id} — will attempt API fallback for MVPs.`);
    }

    // compute MVPs if we have JSON
    if (Array.isArray(foundJson)) {
      try {
        // flatten matchups for the season (some JSONs may be nested by week)
        const flatMatchups = [];
        // if first element looks like a week object { week: N, ... } treat as flat
        if (foundJson.length && typeof foundJson[0] === 'object' && (foundJson[0].week != null || foundJson[0].teamA || foundJson[0].teamB)) {
          // assume array of matchups
          for (const m of foundJson) flatMatchups.push(m);
        } else {
          // else assume object keyed by week: { "1": [...], "2": [...] }
          for (const wkKey of Object.keys(foundJson)) {
            const arr = foundJson[wkKey];
            if (Array.isArray(arr)) {
              for (const m of arr) {
                // patch week if missing
                if (!m.week) m.week = Number(wkKey);
                flatMatchups.push(m);
              }
            }
          }
        }

        // determine playoff week end: find max week of playoffs by looking at league if possible
        let playoffStart = 15;
        try {
          const meta = await sleeper.getLeague(s.league_id, { ttl: 60 * 5 });
          playoffStart = (meta && meta.settings && (meta.settings.playoff_week_start ?? meta.settings.playoff_start_week ?? meta.settings.playoffStartWeek)) ? Number(meta.settings.playoff_week_start ?? meta.settings.playoff_start_week ?? meta.settings.playoffStartWeek) : playoffStart;
        } catch (e) {
          // ignore
        }
        const playoffEnd = playoffStart + 2;

        // --- Finals MVP: find matchups at championship week (playoffEnd) and scan starters/starter_points ---
        let finalsMvp = null;
        const championshipRows = flatMatchups.filter(m => Number(m.week) === Number(playoffEnd));
        // If there are direct matchup rows with teamA/teamB, they will be in championshipRows
        for (const row of championshipRows) {
          const participants = [];
          if (row.teamA && row.teamA.starters && Array.isArray(row.teamA.starters)) {
            for (let i = 0; i < row.teamA.starters.length; i++) {
              const pid = row.teamA.starters[i];
              const pts = safeNum((row.teamA.starters_points && row.teamA.starters_points[i] != null) ? row.teamA.starters_points[i] : 0);
              if (!pid || pid === '0') continue;
              participants.push({ playerId: String(pid), points: pts, rosterId: row.teamA.rosterId ?? row.teamA.rosterId });
            }
          }
          if (row.teamB && row.teamB.starters && Array.isArray(row.teamB.starters)) {
            for (let i = 0; i < row.teamB.starters.length; i++) {
              const pid = row.teamB.starters[i];
              const pts = safeNum((row.teamB.starters_points && row.teamB.starters_points[i] != null) ? row.teamB.starters_points[i] : 0);
              if (!pid || pid === '0') continue;
              participants.push({ playerId: String(pid), points: pts, rosterId: row.teamB.rosterId ?? row.teamB.rosterId });
            }
          }

          for (const p of participants) {
            if (!finalsMvp || p.points > finalsMvp.points) {
              finalsMvp = { playerId: p.playerId, points: p.points, rosterId: p.rosterId ?? null };
            }
          }
        }

        // --- Overall MVP: sum starters_points across entire season (regular + playoffs)
        const totals = {};
        for (const row of flatMatchups) {
          const teamObjs = [];
          if (row.teamA) teamObjs.push(row.teamA);
          if (row.teamB) teamObjs.push(row.teamB);
          if (row.combinedParticipants && Array.isArray(row.combinedParticipants)) {
            // some JSONs use combinedParticipants (already have points)
            for (const p of row.combinedParticipants) {
              if (!p || !p.rosterId) continue;
              // combinedParticipants points are roster points, not player-level — skip here
            }
          }
          for (const t of teamObjs) {
            if (!t || !Array.isArray(t.starters)) continue;
            for (let i = 0; i < t.starters.length; i++) {
              const pid = t.starters[i];
              const pts = safeNum((t.starters_points && t.starters_points[i] != null) ? t.starters_points[i] : 0);
              if (!pid || pid === '0') continue;
              const keyp = String(pid);
              totals[keyp] = (totals[keyp] || 0) + pts;
            }
          }
        }

        // pick top overall player
        let overallMvp = null;
        for (const pid of Object.keys(totals)) {
          const pts = totals[pid];
          if (!overallMvp || pts > overallMvp.points) {
            overallMvp = { playerId: pid, points: Math.round(pts * 10) / 10 };
          }
        }

        // attach to mapping (we will not attempt to resolve player names here; UI will lazy-load headshots/names or show placeholders)
        mvpBySeason[key] = {
          season: s.season,
          leagueId: s.league_id,
          finalsMvp: finalsMvp ? { playerId: finalsMvp.playerId, points: finalsMvp.points, rosterId: finalsMvp.rosterId } : null,
          overallMvp: overallMvp ? { playerId: overallMvp.playerId, points: overallMvp.points } : null
        };
      } catch (e) {
        messages.push(`Failed computing MVPs for ${s.season}: ${e?.message ?? e}`);
      }
    } else {
      // no JSON -> leave placeholder; we'll attempt API fallback for current season only
      mvpBySeason[key] = {
        season: s.season,
        leagueId: s.league_id,
        finalsMvp: null,
        overallMvp: null
      };
    }
  } // end seasons loop

  // If selected season is current and mvp data missing, attempt lightweight API fallback
  try {
    const selKey = selectedSeasonParam != null ? String(selectedSeasonParam) : null;
    if (selKey && mvpBySeason[selKey] && (!mvpBySeason[selKey].finalsMvp || !mvpBySeason[selKey].overallMvp)) {
      // Attempt to fetch matchups from API for this league and compute player-level MVPs only if matchups include starters (rare)
      let wkMatchups = [];
      try {
        // determine playoff start for selected league
        let playoffStart = 15;
        try {
          const meta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 });
          playoffStart = (meta && meta.settings && (meta.settings.playoff_week_start ?? meta.settings.playoff_start_week ?? meta.settings.playoffStartWeek)) ? Number(meta.settings.playoff_week_start ?? meta.settings.playoff_start_week ?? meta.settings.playoffStartWeek) : playoffStart;
        } catch (e) { /* ignore */ }
        const playoffEnd = playoffStart + 2;
        // try to fetch matchups across all weeks up to playoffEnd (may not contain starters)
        for (let w = 1; w <= playoffEnd; w++) {
          try {
            const wk = await sleeper.getMatchupsForWeek(selectedLeagueId, w, { ttl: 60 * 5 }) || [];
            if (wk && wk.length) {
              // some API responses won't have starters arrays — we still push
              wkMatchups.push(...wk);
            }
          } catch (e) {
            // ignore per-week errors
          }
        }
      } catch (e) {
        // swallow fallback errors
      }

      // Try to extract starters/starter_points from API matchups (if present)
      if (wkMatchups.length) {
        // normalize flatten and try same logic as JSON parsing
        const flat = [];
        for (const m of wkMatchups) {
          // the API typically does not provide starters arrays — so this will likely not produce player-level MVPs
          flat.push(m);
        }

        // attempt to find championship week rows (playoffEnd) by week property if present
        // if we can locate starters, recompute finals/overall similar to above
        // NOTE: most Sleeper public API matchup rows do not include player-level starters — so this is best-effort
        const totals = {};
        let finalsMvp = null;
        for (const row of flat) {
          // attempt to find participants' starters arrays if present (fallback)
          for (const side of ['teamA','teamB']) {
            const t = row[side];
            if (!t) continue;
            // if the API included 'starters' keys like our JSON, handle them
            if (Array.isArray(t.starters) && Array.isArray(t.starters_points)) {
              for (let i = 0; i < t.starters.length; i++) {
                const pid = t.starters[i];
                const pts = safeNum(t.starters_points[i]);
                if (!pid || pid === '0') continue;
                totals[pid] = (totals[pid] || 0) + pts;
                // finals check if this is championship week (row.week matches)
                if (Number(row.week) && Number(row.week) === (playoffEnd)) {
                  if (!finalsMvp || pts > finalsMvp.points) finalsMvp = { playerId: pid, points: pts, rosterId: t.rosterId ?? null };
                }
              }
            }
          }
        }

        // assign if we got any totals/finals
        let overallMvp = null;
        for (const pid of Object.keys(totals)) {
          const pts = totals[pid];
          if (!overallMvp || pts > overallMvp.points) overallMvp = { playerId: pid, points: Math.round(pts * 10) / 10 };
        }

        if (finalsMvp) mvpBySeason[selKey].finalsMvp = finalsMvp;
        if (overallMvp) mvpBySeason[selKey].overallMvp = overallMvp;
        if (!finalsMvp && !overallMvp) {
          messages.push(`sleeper.getFinalsMVP / getOverallMVP not available for API fallback; no player-level data for ${selKey}.`);
        } else {
          messages.push(`Computed MVPs via API fallback for ${selKey}.`);
        }
      } else {
        messages.push(`No matchups from API usable for player-level MVP computation for ${selectedSeasonParam}.`);
      }
    }
  } catch (e) {
    messages.push('Error during API fallback for MVPs: ' + (e?.message ?? e));
  }

  // expose which JSON files we loaded for UI visibility
  const uniqueLoaded = Array.from(new Set(loadedFiles));

  // return data for page
  return {
    seasons,
    selectedSeason: String(selectedSeasonParam ?? ''),
    mvpBySeason,
    jsonLinks,
    messages,
    loadedFiles: uniqueLoaded
  };
}
