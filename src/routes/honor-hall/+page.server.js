// src/routes/honor-hall/+page.server.js
import { readFile } from 'fs/promises';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { createSleeperClient } from '$lib/server/sleeperClient';

let cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) {
    cache = createKVCache(globalThis.KV);
  } else {
    cache = createMemoryCache();
  }
} catch (e) {
  cache = createMemoryCache();
}

const SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
const sleeper = createSleeperClient({ cache: cache, concurrency: SLEEPER_CONCURRENCY });

const SEASON_MATCHUP_YEARS = [2022, 2023, 2024]; // extend as needed
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 23; // user requested max weeks 23

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// compute participant points (robust)
function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== 'object') return 0;

  const arrayKeys = ['starters_points', 'starter_points', 'startersPoints', 'starterPoints', 'starters_points_list'];
  for (const k of arrayKeys) {
    if (Array.isArray(entry[k]) && entry[k].length) {
      let s = 0;
      for (const v of entry[k]) s += safeNum(v);
      return Math.round(s * 100) / 100;
    }
  }

  if (Array.isArray(entry.starters) && entry.player_points && typeof entry.player_points === 'object') {
    let s = 0;
    for (const st of entry.starters) {
      const pval = entry.player_points[String(st)] ?? entry.player_points[st];
      s += safeNum(pval);
    }
    return Math.round(s * 100) / 100;
  }

  if (Array.isArray(entry.starters) && entry.starters.length && typeof entry.starters[0] === 'object') {
    let s = 0;
    for (const obj of entry.starters) {
      s += safeNum(obj.points ?? obj.p);
    }
    return Math.round(s * 100) / 100;
  }

  const fallback = safeNum(entry.points ?? entry.points_for ?? entry.pts ?? entry.score ?? 0);
  return Math.round(fallback * 100) / 100;
}

// next-week explicit zero detection (used to avoid current in-progress weeks)
function nextWeekContainsExplicitZero(matchupsArr) {
  if (!Array.isArray(matchupsArr) || matchupsArr.length === 0) return false;

  for (const m of matchupsArr) {
    if (Object.prototype.hasOwnProperty.call(m, 'teamAScore') && Number(m.teamAScore) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'teamBScore') && Number(m.teamBScore) === 0) return true;

    if (m.teamA && Object.prototype.hasOwnProperty.call(m.teamA, 'score') && Number(m.teamA.score) === 0) return true;
    if (m.teamB && Object.prototype.hasOwnProperty.call(m.teamB, 'score') && Number(m.teamB.score) === 0) return true;
    if (m.teamA && Object.prototype.hasOwnProperty.call(m.teamA, 'points') && Number(m.teamA.points) === 0) return true;
    if (m.teamB && Object.prototype.hasOwnProperty.call(m.teamB, 'points') && Number(m.teamB.points) === 0) return true;

    if (Object.prototype.hasOwnProperty.call(m, 'points') && Number(m.points) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'points_for') && Number(m.points_for) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'pts') && Number(m.pts) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'score') && Number(m.score) === 0) return true;
  }
  return false;
}

// load season_matchups JSON files (origin fetch then static fallback)
async function tryLoadSeasonMatchups(years, origin) {
  const map = {};
  const jsonLinks = [];
  for (const y of years) {
    let loaded = null;
    if (origin && typeof origin === 'string') {
      try {
        const url = origin.replace(/\/$/, '') + `/season_matchups/${String(y)}.json`;
        const res = await fetch(url, { method: 'GET' });
        if (res && res.ok) {
          const txt = await res.text();
          loaded = JSON.parse(txt);
          jsonLinks.push(url);
        }
      } catch (e) {
        loaded = null;
      }
    }

    if (!loaded) {
      try {
        const fileUrl = new URL(`../../../static/season_matchups/${String(y)}.json`, import.meta.url);
        const txt = await readFile(fileUrl, 'utf8');
        loaded = JSON.parse(txt);
        jsonLinks.push(`/season_matchups/${String(y)}.json`);
      } catch (e) {
        loaded = null;
      }
    }

    if (loaded) map[String(y)] = loaded;
  }
  return { map, jsonLinks };
}

// Build standings from season JSON (simplified — used to determine a playoff winner)
function buildStandingsFromSeasonMatchupsJson(matchupsByWeek, playoffStart = 15) {
  const statsByRosterPlayoff = {};
  const resultsByRosterPlayoff = {};
  const paByRosterPlayoff = {};

  for (let week = 1; week <= MAX_WEEKS; week++) {
    const matchups = (matchupsByWeek && matchupsByWeek[String(week)]) ? matchupsByWeek[String(week)] : [];
    if (!matchups || !matchups.length) continue;

    const effectivePlayoffStart = playoffStart || 15;
    const playoffEnd = effectivePlayoffStart + 2;
    const isPlayoffWeek = (week >= effectivePlayoffStart && week <= playoffEnd);
    if (!isPlayoffWeek) continue;

    // do not apply next-week-zero check for final playoff week
    if (week !== playoffEnd) {
      const nextMatchups = matchupsByWeek[String(week + 1)];
      if (nextMatchups && nextMatchups.length && nextWeekContainsExplicitZero(nextMatchups)) {
        // skip current in-progress week
        continue;
      }
    }

    for (const m of matchups) {
      const a = m.teamA ?? null;
      const b = m.teamB ?? null;
      if (a && b) {
        const ridA = String(a.rosterId ?? a.roster_id ?? a.id ?? a.roster ?? a.ownerId ?? a.owner_id);
        const ridB = String(b.rosterId ?? b.roster_id ?? b.id ?? b.roster ?? b.ownerId ?? b.owner_id);
        const ptsA = safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? m.points ?? 0);
        const ptsB = safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? 0);

        paByRosterPlayoff[ridA] = paByRosterPlayoff[ridA] || 0;
        paByRosterPlayoff[ridB] = paByRosterPlayoff[ridB] || 0;
        resultsByRosterPlayoff[ridA] = resultsByRosterPlayoff[ridA] || [];
        resultsByRosterPlayoff[ridB] = resultsByRosterPlayoff[ridB] || [];
        statsByRosterPlayoff[ridA] = statsByRosterPlayoff[ridA] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
        statsByRosterPlayoff[ridB] = statsByRosterPlayoff[ridB] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };

        statsByRosterPlayoff[ridA].pf += ptsA;
        statsByRosterPlayoff[ridB].pf += ptsB;

        const oppAvgA = ptsB;
        const oppAvgB = ptsA;
        paByRosterPlayoff[ridA] += oppAvgA;
        paByRosterPlayoff[ridB] += oppAvgB;

        if (ptsA > oppAvgA + 1e-9) { resultsByRosterPlayoff[ridA].push('W'); statsByRosterPlayoff[ridA].wins += 1; }
        else if (ptsA < oppAvgA - 1e-9) { resultsByRosterPlayoff[ridA].push('L'); statsByRosterPlayoff[ridA].losses += 1; }
        else { resultsByRosterPlayoff[ridA].push('T'); statsByRosterPlayoff[ridA].ties += 1; }

        if (ptsB > oppAvgB + 1e-9) { resultsByRosterPlayoff[ridB].push('W'); statsByRosterPlayoff[ridB].wins += 1; }
        else if (ptsB < oppAvgB - 1e-9) { resultsByRosterPlayoff[ridB].push('L'); statsByRosterPlayoff[ridB].losses += 1; }
        else { resultsByRosterPlayoff[ridB].push('T'); statsByRosterPlayoff[ridB].ties += 1; }

        if (!statsByRosterPlayoff[ridA].roster) statsByRosterPlayoff[ridA].roster = { metadata: { team_name: a.name ?? null, owner_name: a.ownerName ?? null } };
        else statsByRosterPlayoff[ridA].roster.metadata = { team_name: statsByRosterPlayoff[ridA].roster.metadata?.team_name || a.name || null, owner_name: statsByRosterPlayoff[ridA].roster.metadata?.owner_name || a.ownerName || null };

        if (!statsByRosterPlayoff[ridB].roster) statsByRosterPlayoff[ridB].roster = { metadata: { team_name: b.name ?? null, owner_name: b.ownerName ?? null } };
        else statsByRosterPlayoff[ridB].roster.metadata = { team_name: statsByRosterPlayoff[ridB].roster.metadata?.team_name || b.name || null, owner_name: statsByRosterPlayoff[ridB].roster.metadata?.owner_name || b.ownerName || null };
      }
    }
  }

  // convert to array and sort by wins -> pf
  const out = [];
  const keys = Object.keys(statsByRosterPlayoff);
  for (const k of keys) {
    const s = statsByRosterPlayoff[k];
    const meta = s.roster && s.roster.metadata ? s.roster.metadata : {};
    out.push({
      rosterId: k,
      team_name: meta.team_name || ('Roster ' + k),
      owner_name: meta.owner_name || null,
      wins: s.wins || 0,
      pf: Math.round((s.pf || 0) * 100) / 100
    });
  }
  out.sort((a,b) => {
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    return (b.pf || 0) - (a.pf || 0);
  });
  return out;
}

export async function load(event) {
  // set CDN caching
  event.setHeaders({
    'cache-control': 's-maxage=120, stale-while-revalidate=300'
  });

  const origin = event.url?.origin || null;
  const messages = [];
  let seasonMatchupsMap = {};
  let jsonLinks = [];

  try {
    const loaded = await tryLoadSeasonMatchups(SEASON_MATCHUP_YEARS, origin);
    seasonMatchupsMap = loaded.map || {};
    jsonLinks = loaded.jsonLinks || [];
    messages.push('Loaded season JSONs: ' + Object.keys(seasonMatchupsMap).join(', '));
  } catch (e) {
    messages.push('Error loading season JSONs: ' + (e?.message ?? String(e)));
    seasonMatchupsMap = {};
  }

  // Build honors array from JSON content. Prefer explicit _meta.honor_hall entries when present.
  const honors = []; // each: { season, source: 'json', champion: { team_name, owner_name }, hallEntries: [...] }

  for (const y of Object.keys(seasonMatchupsMap)) {
    try {
      const json = seasonMatchupsMap[y];
      const meta = (json && json._meta) ? json._meta : {};
      const playoffStart = (typeof json.playoff_week_start === 'number') ? Number(json.playoff_week_start)
                          : (meta && typeof meta.playoff_week_start === 'number') ? Number(meta.playoff_week_start)
                          : 15;

      // explicit hall entries
      const explicitHall = meta.honor_hall || meta.hall_of_fame || meta.honors || null;

      // champion: prefer explicit in meta, else compute from playoffs
      let champion = null;
      if (meta && meta.champion) {
        champion = meta.champion; // allow object or simple string
      } else {
        // compute playoff standings and take top as champion if available
        const playoffStandings = buildStandingsFromSeasonMatchupsJson(json, playoffStart);
        if (playoffStandings && playoffStandings.length) {
          champion = { team_name: playoffStandings[0].team_name, owner_name: playoffStandings[0].owner_name };
        }
      }

      honors.push({
        season: String(y),
        source: 'json',
        champion,
        hallEntries: Array.isArray(explicitHall) ? explicitHall : []
      });
    } catch (e) {
      messages.push('Error processing season ' + y + ' — ' + (e?.message ?? String(e)));
    }
  }

  // Provide a sorted seasons list for dropdown (by year ascending)
  const seasons = Object.keys(seasonMatchupsMap).map(k => ({ season: String(k) })).sort((a,b) => Number(a.season) - Number(b.season));

  return {
    seasons,
    honors,
    jsonLinks,
    messages
  };
}
