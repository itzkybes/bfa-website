// src/routes/honor-hall/+page.server.js
// Honor Hall loader + bracket simulation (JSON-first for historical seasons; API for current)

import fs from 'fs/promises';
import path from 'path';
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';

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

// small local in-memory JSON cache (key -> parsed object)
const localJsonCache = new Map();

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function computeStreaks(resultsArray) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  if (!resultsArray || !Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
  for (let i = 0; i < resultsArray.length; i++) {
    const r = resultsArray[i];
    if (r === 'W') {
      curW += 1;
      curL = 0;
      if (curW > maxW) maxW = curW;
    } else if (r === 'L') {
      curL += 1;
      curW = 0;
      if (curL > maxL) maxL = curL;
    } else {
      curW = 0;
      curL = 0;
    }
  }
  return { maxW, maxL };
}

// Try to find season_matchups JSON files in common locations (project root / static)
async function loadAllSeasonMatchupsJSON() {
  // Look in two likely places: "./season_matchups" and "./static/season_matchups"
  const candidates = [
    path.resolve(process.cwd(), 'season_matchups'),
    path.resolve(process.cwd(), 'static', 'season_matchups'),
    path.resolve(process.cwd(), 'src', 'season_matchups'),
  ];

  const found = {};
  const jsonLinks = [];

  for (const dir of candidates) {
    try {
      const entries = await fs.readdir(dir);
      for (const e of entries) {
        if (!e.endsWith('.json')) continue;
        const full = path.join(dir, e);
        const keyName = e.replace(/\.json$/, '');
        // use cache if present
        if (localJsonCache.has(full)) {
          found[keyName] = localJsonCache.get(full);
          jsonLinks.push(full);
          continue;
        }
        try {
          const raw = await fs.readFile(full, 'utf8');
          const parsed = JSON.parse(raw);
          localJsonCache.set(full, parsed);
          found[keyName] = parsed;
          jsonLinks.push(full);
        } catch (err) {
          // ignore parse/read errors but log below
        }
      }
      // if we've found at least one file in this directory, stop searching others
      if (jsonLinks.length) break;
    } catch (err) {
      // directory doesn't exist or no permission - try next
      continue;
    }
  }

  return { found, jsonLinks };
}

// Build a roster-like map from season JSON (rosterId -> meta object)
function buildRosterMapFromSeasonJson(seasonJson) {
  const map = {};
  if (!seasonJson || typeof seasonJson !== 'object') return map;
  // season JSON contains numeric week keys and each week an array of matchups
  for (const k of Object.keys(seasonJson)) {
    if (k === 'playoff_week_start') continue;
    const arr = seasonJson[k];
    if (!Array.isArray(arr)) continue;
    for (const m of arr) {
      if (m?.teamA) {
        const ta = m.teamA;
        if (ta.rosterId) {
          map[String(ta.rosterId)] = map[String(ta.rosterId)] || {
            team_name: ta.name || ta.team_name || null,
            owner_name: ta.ownerName || ta.owner_name || null,
            team_avatar: ta.team_avatar || ta.avatar || null,
            roster_raw: null
          };
        }
      }
      if (m?.teamB) {
        const tb = m.teamB;
        if (tb.rosterId) {
          map[String(tb.rosterId)] = map[String(tb.rosterId)] || {
            team_name: tb.name || tb.team_name || null,
            owner_name: tb.ownerName || tb.owner_name || null,
            team_avatar: tb.team_avatar || tb.avatar || null,
            roster_raw: null
          };
        }
      }
    }
  }
  return map;
}

// normalize owner combination: combine Bellooshio and cholybevv into JakePratt
function applyOwnerCombinesToRosterMap(rosterMap) {
  if (!rosterMap || typeof rosterMap !== 'object') return;
  const combineSet = new Set(['Bellooshio', 'bellooshio', 'cholybevv', 'Cholybevv']);
  // We'll normalize to 'JakePratt'
  for (const rid of Object.keys(rosterMap)) {
    const meta = rosterMap[rid];
    if (!meta) continue;
    const on = meta.owner_name;
    if (!on) continue;
    if (combineSet.has(on) || combineSet.has(String(on).toLowerCase())) {
      meta.owner_name = 'JakePratt';
      // optionally don't change team_name, but if team_name is one of the combined names, set to JakePratt
      if (meta.team_name && combineSet.has(meta.team_name)) meta.team_name = 'JakePratt';
    }
  }
}

// compute overall / finals MVPs from season JSON (if available)
function computeMVPsFromSeasonJson(seasonJson, playoffStart, playoffEnd) {
  // overallMvp: player with most total starter points across the season
  // finalsMvp: player with most points in the championship (week === playoffEnd)
  const playerTotals = {}; // playerId -> total points
  let finalsCandidates = []; // will be array of { playerId, points, rosterId, rosterName }

  if (!seasonJson) return { overallMvp: null, finalsMvp: null };

  for (const weekKey of Object.keys(seasonJson)) {
    if (weekKey === 'playoff_week_start') continue;
    const wk = Number(weekKey);
    if (!Array.isArray(seasonJson[weekKey])) continue;
    for (const matchup of seasonJson[weekKey]) {
      // teamA starters_points and starters arrays
      const parts = [
        { side: 'teamA', obj: matchup.teamA },
        { side: 'teamB', obj: matchup.teamB }
      ];
      for (const p of parts) {
        const t = p.obj;
        if (!t) continue;
        const starters = Array.isArray(t.starters) ? t.starters : [];
        const starterPts = Array.isArray(t.starters_points) ? t.starters_points : [];
        for (let i = 0; i < starters.length; i++) {
          const pid = String(starters[i] ?? '0');
          const pts = safeNum(starterPts[i] ?? 0);
          playerTotals[pid] = (playerTotals[pid] || 0) + pts;
          if (wk === Number(playoffEnd)) {
            finalsCandidates.push({ playerId: pid, points: pts, rosterId: String(t.rosterId), rosterName: t.name || t.ownerName });
          }
        }
      }
    }
  }

  // pick overall max (exclude '0' placeholder)
  let overallMvp = null;
  for (const pid of Object.keys(playerTotals)) {
    if (!pid || pid === '0') continue;
    const total = playerTotals[pid];
    if (!overallMvp || total > overallMvp.points) {
      overallMvp = { playerId: pid, points: Math.round(total * 100) / 100 };
    }
  }

  // pick finalsMvp (max points in finals week)
  let finalsMvp = null;
  for (const c of finalsCandidates) {
    if (!c.playerId || c.playerId === '0') continue;
    if (!finalsMvp || c.points > finalsMvp.points) {
      finalsMvp = { playerId: c.playerId, points: Math.round(c.points * 100) / 100, rosterId: c.rosterId, rosterName: c.rosterName };
    }
  }

  return { overallMvp, finalsMvp };
}

export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  const url = event.url;
  const incomingSeasonParam = url.searchParams.get('season') || null;

  const messages = [];
  const prevChain = [];

  // --- build seasons chain (same as original) ---
  let seasons = [];
  try {
    let mainLeague = null;
    try {
      mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 });
    } catch (e) {
      messages.push('Failed fetching base league ' + BASE_LEAGUE_ID + ' — ' + (e && e.message ? e.message : String(e)));
    }

    if (mainLeague) {
      seasons.push({
        league_id: String(mainLeague.league_id || BASE_LEAGUE_ID),
        season: mainLeague.season ?? null,
        name: mainLeague.name ?? null
      });
      prevChain.push(String(mainLeague.league_id || BASE_LEAGUE_ID));

      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) {
            messages.push('Could not fetch league for previous_league_id ' + currPrev);
            break;
          }
          seasons.push({
            league_id: String(prevLeague.league_id || currPrev),
            season: prevLeague.season ?? null,
            name: prevLeague.name ?? null
          });
          prevChain.push(String(prevLeague.league_id || currPrev));
          currPrev = prevLeague.previous_league_id ? String(prevLeague.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err && err.message ? err.message : String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error while building seasons chain: ' + (err && err.message ? err.message : String(err)));
  }

  // dedupe
  const byId = {};
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);

  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = String(BASE_LEAGUE_ID);
    }
  }

  let selectedLeagueId = null;
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    if (String(s.league_id) === String(selectedSeasonParam) || (s.season != null && String(s.season) === String(selectedSeasonParam))) {
      selectedLeagueId = String(s.league_id);
      break;
    }
  }
  if (!selectedLeagueId) selectedLeagueId = String(selectedSeasonParam || BASE_LEAGUE_ID);

  // Load available season_matchups JSON files (if any)
  const { found: seasonJsons, jsonLinks } = await loadAllSeasonMatchupsJSON();
  if (jsonLinks.length) {
    messages.push('Loaded season_matchups JSON for years: ' + Object.keys(seasonJsons).join(', ') + '.');
  }

  // --- selected league metadata ---
  let leagueMeta = null;
  try { leagueMeta = await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }); }
  catch (e) { leagueMeta = null; messages.push('Failed fetching league meta for ' + selectedLeagueId + ' — ' + (e?.message ?? e)); }

  // determine if selectedSeasonParam maps to a JSON file key (prefers season number string)
  // selectedSeasonParam might be a year (e.g., '2023') or a league_id; try both
  function findSeasonJsonForParam(param) {
    if (!param) return null;
    // try season key exact
    if (seasonJsons[String(param)]) return seasonJsons[String(param)];
    // try by numeric year part if param looks like league_id
    for (const k of Object.keys(seasonJsons)) {
      if (String(k) === String(param)) return seasonJsons[k];
      // also try if seasons array contains a match
    }
    // fallback null
    return null;
  }

  // If league metadata contains a season field, prefer that numeric season in JSON lookup
  const ledgerSeasonKey = leagueMeta && leagueMeta.season != null ? String(leagueMeta.season) : null;
  const selectedSeasonJson = findSeasonJsonForParam(selectedSeasonParam) || (ledgerSeasonKey ? findSeasonJsonForParam(ledgerSeasonKey) : null);

  // --- helper: fetch rosterMap for a given league id (cached via sleeper client) ---
  let rosterMap = {};
  try {
    rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
    messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
  } catch (e) {
    rosterMap = {};
    messages.push('Failed fetching rosters for ' + selectedLeagueId + ' — ' + (e?.message ?? e));
  }

  // if selected season uses JSON, build rosterMapFromJson for that season (so we have metadata for that season)
  let rosterMapForSelectedSeason = rosterMap;
  if (selectedSeasonJson) {
    try {
      const jsonRoster = buildRosterMapFromSeasonJson(selectedSeasonJson);
      // prefer sleeper rosterMap fields if rosterMap has the same rosterId; otherwise use json roster metadata
      rosterMapForSelectedSeason = { ...(jsonRoster || {}) };
      for (const rid of Object.keys(rosterMap || {})) {
        rosterMapForSelectedSeason[rid] = rosterMapForSelectedSeason[rid] || rosterMap[rid];
      }
      applyOwnerCombinesToRosterMap(rosterMapForSelectedSeason);
      messages.push('Processed season_matchups JSON for selected season (used local JSON).');
    } catch (e) {
      messages.push('Error building roster map from JSON: ' + (e?.message ?? e));
      rosterMapForSelectedSeason = rosterMap;
    }
  } else {
    // still apply combine mapping to rosterMap (if available)
    applyOwnerCombinesToRosterMap(rosterMapForSelectedSeason);
  }

  // compute playoffStart / playoffEnd - if JSON provides playoff_week_start, prefer it
  let playoffStart = null;
  if (selectedSeasonJson && typeof selectedSeasonJson.playoff_week_start !== 'undefined') {
    playoffStart = Number(selectedSeasonJson.playoff_week_start || selectedSeasonJson.playoffStartWeek || selectedSeasonJson.playoff_start_week);
    messages.push(`Processed season_matchups JSON for selected season (playoff_week_start=${playoffStart}).`);
  } else {
    playoffStart = (leagueMeta && leagueMeta.settings && (leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek)) ? Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek) : null;
    if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
      playoffStart = (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) ? Number(leagueMeta.settings.playoff_week_start) : null;
      if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) {
        playoffStart = 15;
        messages.push('Playoff start not found in metadata — defaulting to week ' + playoffStart);
      }
    }
  }
  const playoffEnd = playoffStart + 2;

  // --- Build regular-season trackers (we will use JSON if present, otherwise API for weeks) ---
  const statsByRosterRegular = {};
  const resultsByRosterRegular = {};
  const paByRosterRegular = {};

  // initialize trackers from rosterMapForSelectedSeason (ensures all rosters present)
  for (const rk in rosterMapForSelectedSeason) {
    if (!Object.prototype.hasOwnProperty.call(rosterMapForSelectedSeason, rk)) continue;
    statsByRosterRegular[String(rk)] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: rosterMapForSelectedSeason[rk].roster_raw ?? null };
    resultsByRosterRegular[String(rk)] = [];
    paByRosterRegular[String(rk)] = 0;
  }

  const regStart = 1;
  const regEnd = Math.max(1, playoffStart - 1);

  // Helper to process a single matchup entry (normalized)
  function processMatchupEntryForRegular(entry, week) {
    // entry expected to be object containing teamA/teamB or roster_id/points style
    // Normalize to participants array: { rosterId, points }
    if (!entry) return;
    if (entry.teamA || entry.teamB) {
      // structure coming from season JSON normalized earlier
      const a = entry.teamA;
      const b = entry.teamB;
      if (!a || !b) {
        // single participant case
        const only = a || b;
        const ridOnly = String(only.rosterId ?? only.roster_id ?? only.owner_id ?? only.ownerId ?? 'unknown');
        const ptsOnly = safeNum(only.points ?? only.teamAScore ?? only.teamBScore ?? only.teamAScore ?? only.points_for ?? 0);
        if (!statsByRosterRegular[ridOnly]) statsByRosterRegular[ridOnly] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
        if (!resultsByRosterRegular[ridOnly]) resultsByRosterRegular[ridOnly] = [];
        if (!paByRosterRegular[ridOnly]) paByRosterRegular[ridOnly] = 0;
        statsByRosterRegular[ridOnly].pf += ptsOnly;
        return;
      }
      const aId = String(a.rosterId ?? a.roster_id ?? a.owner_id ?? a.ownerId ?? 'a');
      const bId = String(b.rosterId ?? b.roster_id ?? b.owner_id ?? b.ownerId ?? 'b');
      const aPts = safeNum(a.points ?? a.teamAScore ?? a.teamScore ?? 0);
      const bPts = safeNum(b.points ?? b.teamBScore ?? b.teamScore ?? 0);
      // ensure keys
      if (!statsByRosterRegular[aId]) statsByRosterRegular[aId] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
      if (!statsByRosterRegular[bId]) statsByRosterRegular[bId] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
      if (!resultsByRosterRegular[aId]) resultsByRosterRegular[aId] = [];
      if (!resultsByRosterRegular[bId]) resultsByRosterRegular[bId] = [];
      if (!paByRosterRegular[aId]) paByRosterRegular[aId] = 0;
      if (!paByRosterRegular[bId]) paByRosterRegular[bId] = 0;

      statsByRosterRegular[aId].pf += aPts;
      statsByRosterRegular[bId].pf += bPts;

      // compute opponents average (binary matchup -> opponent points)
      const aOpp = bPts;
      const bOpp = aPts;
      paByRosterRegular[aId] += aOpp;
      paByRosterRegular[bId] += bOpp;

      if (aPts > bOpp + 1e-9) {
        resultsByRosterRegular[aId].push('W');
        statsByRosterRegular[aId].wins += 1;
      } else if (aPts < bOpp - 1e-9) {
        resultsByRosterRegular[aId].push('L');
        statsByRosterRegular[aId].losses += 1;
      } else {
        resultsByRosterRegular[aId].push('T');
        statsByRosterRegular[aId].ties += 1;
      }

      if (bPts > aOpp + 1e-9) {
        resultsByRosterRegular[bId].push('W');
        statsByRosterRegular[bId].wins += 1;
      } else if (bPts < aOpp - 1e-9) {
        resultsByRosterRegular[bId].push('L');
        statsByRosterRegular[bId].losses += 1;
      } else {
        resultsByRosterRegular[bId].push('T');
        statsByRosterRegular[bId].ties += 1;
      }
      return;
    }

    // fallback: handle sleeper API raw matchup objects
    if (entry.roster_id || entry.rosterId || entry.owner_id || entry.ownerId) {
      // This function expects to be passed grouped matchups (pairs). However for safety, we skip handling raw single entries here.
    }
  }

  // If selectedSeasonJson exists, use it to process reg weeks rather than calling API per-week
  if (selectedSeasonJson) {
    try {
      // selectedSeasonJson structure: keys are week numbers (strings) -> arrays of matchups
      // iterate weeks 1..regEnd and process arrays
      for (let wk = regStart; wk <= regEnd; wk++) {
        const wkKey = String(wk);
        const arr = Array.isArray(selectedSeasonJson[wkKey]) ? selectedSeasonJson[wkKey] : [];
        for (const m of arr) {
          // normalize m into a form processMatchupEntryForRegular understands:
          // JSON example uses teamA.teamAScore/teamBScore keys as teamAScore/teamBScore plus teamA/teamB object with starters
          // Build normalized entry with teamA/teamB { rosterId, points }
          const norm = {};
          if (m.teamA || m.teamB) {
            norm.teamA = {
              rosterId: String(m.teamA?.rosterId ?? m.teamA?.roster_id ?? m.teamA?.owner_id ?? m.teamA?.ownerId ?? ''),
              points: safeNum(m.teamAScore ?? m.teamA?.points ?? m.teamA?.score ?? m.teamA?.teamAScore ?? 0)
            };
            norm.teamB = {
              rosterId: String(m.teamB?.rosterId ?? m.teamB?.roster_id ?? m.teamB?.owner_id ?? m.teamB?.ownerId ?? ''),
              points: safeNum(m.teamBScore ?? m.teamB?.points ?? m.teamB?.score ?? m.teamB?.teamBScore ?? 0)
            };
          } else {
            // if structure differs, try simple mapping
            if (m.roster_id && typeof m.points !== 'undefined') {
              // single entry - skip for regular table (only pf accounted)
              const ridOnly = String(m.roster_id ?? m.rosterId ?? m.owner_id ?? m.ownerId ?? 'unknown');
              if (!statsByRosterRegular[ridOnly]) statsByRosterRegular[ridOnly] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
              statsByRosterRegular[ridOnly].pf += safeNum(m.points);
            } else {
              continue;
            }
          }
          processMatchupEntryForRegular(norm, wk);
        }
      }
      messages.push(`Aggregated regular season from local JSON for selected season.`);
    } catch (e) {
      messages.push('Error processing regular season from JSON: ' + (e?.message ?? e));
    }
  } else {
    // Use Sleeper API for weekly matchups
    for (let week = regStart; week <= regEnd; week++) {
      let matchups = null;
      try {
        matchups = await sleeper.getMatchupsForWeek(selectedLeagueId, week, { ttl: 60 * 5 });
      } catch (errWeek) {
        messages.push('Error fetching matchups for league ' + selectedLeagueId + ' week ' + week + ' — ' + (errWeek && errWeek.message ? errWeek.message : String(errWeek)));
        continue;
      }
      if (!matchups || !matchups.length) continue;

      // group by matchup id similar to previous logic and process pairs
      const byMatch = {};
      for (let mi = 0; mi < matchups.length; mi++) {
        const e = matchups[mi];
        const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
        const wk = e.week ?? e.w ?? week;
        const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + mi));
        if (!byMatch[key]) byMatch[key] = [];
        byMatch[key].push(e);
      }
      const keys = Object.keys(byMatch);
      for (let k = 0; k < keys.length; k++) {
        const entries = byMatch[keys[k]];
        if (!entries || !entries.length) continue;
        if (entries.length === 1) {
          const only = entries[0];
          const ridOnly = String(only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId ?? 'unknown');
          const ptsOnly = safeNum(only.points ?? only.points_for ?? only.pts ?? 0);
          if (!statsByRosterRegular[ridOnly]) statsByRosterRegular[ridOnly] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
          if (!resultsByRosterRegular[ridOnly]) resultsByRosterRegular[ridOnly] = [];
          if (!paByRosterRegular[ridOnly]) paByRosterRegular[ridOnly] = 0;
          statsByRosterRegular[ridOnly].pf += ptsOnly;
          continue;
        }

        const participants = [];
        for (let i = 0; i < entries.length; i++) {
          const ent = entries[i];
          const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? ('r' + i));
          const ppts = safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0);
          participants.push({ rosterId: pid, points: ppts });
          if (!statsByRosterRegular[pid]) statsByRosterRegular[pid] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
          if (!resultsByRosterRegular[pid]) resultsByRosterRegular[pid] = [];
          if (!paByRosterRegular[pid]) paByRosterRegular[pid] = 0;
          statsByRosterRegular[pid].pf += ppts;
        }

        for (let i = 0; i < participants.length; i++) {
          const part = participants[i];
          const opponents = participants.filter((_, idx) => idx !== i);
          let oppAvg = 0;
          if (opponents.length) oppAvg = opponents.reduce((acc,o) => acc + o.points, 0) / opponents.length;
          paByRosterRegular[part.rosterId] = (paByRosterRegular[part.rosterId] || 0) + oppAvg;
          if (part.points > oppAvg + 1e-9) {
            resultsByRosterRegular[part.rosterId].push('W');
            statsByRosterRegular[part.rosterId].wins += 1;
          } else if (part.points < oppAvg - 1e-9) {
            resultsByRosterRegular[part.rosterId].push('L');
            statsByRosterRegular[part.rosterId].losses += 1;
          } else {
            resultsByRosterRegular[part.rosterId].push('T');
            statsByRosterRegular[part.rosterId].ties += 1;
          }
        }
      }
    }
    messages.push(`Aggregated regular season from Sleeper API for selected season.`);
  }

  // buildStandingsFromTrackers helper (same as original)
  function buildStandingsFromTrackers(statsByRoster, resultsByRoster, paByRoster, rosterMapArg) {
    const keys = Object.keys(resultsByRoster).length ? Object.keys(resultsByRoster) : (rosterMapArg ? Object.keys(rosterMapArg) : []);
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      const rid = keys[i];
      if (!Object.prototype.hasOwnProperty.call(statsByRoster, rid)) {
        statsByRoster[rid] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: (rosterMapArg && rosterMapArg[rid] ? rosterMapArg[rid].roster_raw : null) };
      }
      const s = statsByRoster[rid];
      const wins = s.wins || 0;
      const losses = s.losses || 0;
      const ties = s.ties || 0;
      const pfVal = Math.round((s.pf || 0) * 100) / 100;
      const paVal = Math.round((paByRoster[rid] || s.pa || 0) * 100) / 100;
      const meta = rosterMapArg && rosterMapArg[rid] ? rosterMapArg[rid] : {};
      const team_name = meta.team_name ? meta.team_name : ((s.roster && s.roster.metadata && s.roster.metadata.team_name) ? s.roster.metadata.team_name : ('Roster ' + rid));
      const owner_name = meta.owner_name || null;
      const avatar = meta.team_avatar || meta.owner_avatar || null;
      const resArr = resultsByRoster && resultsByRoster[rid] ? resultsByRoster[rid] : [];
      const streaks = computeStreaks(resArr);
      out.push({
        rosterId: rid,
        team_name,
        owner_name,
        avatar,
        wins,
        losses,
        ties,
        pf: pfVal,
        pa: paVal,
        maxWinStreak: streaks.maxW,
        maxLoseStreak: streaks.maxL
      });
    }
    out.sort((a,b) => {
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      return (b.pf || 0) - (a.pf || 0);
    });
    return out;
  }

  const regularStandings = buildStandingsFromTrackers(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular, rosterMapForSelectedSeason);

  // build placement maps
  const placementMap = {};
  for (let i = 0; i < regularStandings.length; i++) placementMap[String(regularStandings[i].rosterId)] = i + 1;
  const placementToRoster = {};
  for (const k in placementMap) placementToRoster[ placementMap[k] ] = k;

  // --- fetch / build playoff matchups (JSON-first) ---
  const matchupsRows = [];

  if (selectedSeasonJson) {
    try {
      // gather weeks in playoff window
      for (let wk = playoffStart; wk <= playoffEnd; wk++) {
        const wkKey = String(wk);
        const wkArr = Array.isArray(selectedSeasonJson[wkKey]) ? selectedSeasonJson[wkKey] : [];
        for (let mi = 0; mi < wkArr.length; mi++) {
          const m = wkArr[mi];
          // Normalize to the same shape as original matchupsRows expectations
          const a = m.teamA;
          const b = m.teamB;
          if (!a && !b) continue;
          const aId = a ? String(a.rosterId ?? a.roster_id ?? a.ownerId ?? a.owner) : null;
          const bId = b ? String(b.rosterId ?? b.roster_id ?? b.ownerId ?? b.owner) : null;
          const aPts = safeNum(m.teamAScore ?? a?.points ?? a?.teamAScore ?? 0);
          const bPts = safeNum(m.teamBScore ?? b?.points ?? b?.teamBScore ?? 0);
          const aMeta = rosterMapForSelectedSeason[aId] || {};
          const bMeta = rosterMapForSelectedSeason[bId] || {};
          if (!bId) {
            matchupsRows.push({
              matchup_id: `json|${wk}|${mi}`,
              season: ledgerSeasonKey,
              week: wk,
              teamA: { rosterId: aId, name: a?.name ?? aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts, placement: placementMap[aId] ?? null },
              teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, placement: null },
              participantsCount: 1
            });
          } else {
            matchupsRows.push({
              matchup_id: `json|${wk}|${mi}`,
              season: ledgerSeasonKey,
              week: wk,
              teamA: { rosterId: aId, name: a?.name ?? aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts, placement: placementMap[aId] ?? null },
              teamB: { rosterId: bId, name: b?.name ?? bMeta.team_name || bMeta.owner_name || ('Roster ' + bId), avatar: bMeta.team_avatar || bMeta.owner_avatar || null, points: bPts, placement: placementMap[bId] ?? null },
              participantsCount: 2,
              // include starters for possible MVP resolution
              teamA_starters: a?.starters ?? null,
              teamA_starters_points: a?.starters_points ?? null,
              teamB_starters: b?.starters ?? null,
              teamB_starters_points: b?.starters_points ?? null
            });
          }
        }
      }
      messages.push(`Built playoff matchups from local JSON for selected season.`);
    } catch (e) {
      messages.push('Error building playoff matchups from JSON: ' + (e?.message ?? e));
    }
  } else {
    // Use the Sleeper API to fetch playoff weeks
    for (let wk = playoffStart; wk <= playoffEnd; wk++) {
      try {
        const wkMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, wk, { ttl: 60 * 5 });
        if (Array.isArray(wkMatchups) && wkMatchups.length) {
          for (const m of wkMatchups) {
            if (m && (m.week == null && m.w == null)) m.week = wk;
            // push raw object; later logic will normalize groups into matchupsRows structure
            matchupsRows.push(m);
          }
        }
      } catch (we) {
        messages.push('Failed to fetch matchups for week ' + wk + ': ' + (we?.message ?? String(we)));
      }
    }

    // Normalize matchupsRows grouping for API-sourced rows to match existing format
    // We'll re-run grouping similar to former logic
    const byMatch = {};
    for (let i = 0; i < matchupsRows.length; i++) {
      const e = matchupsRows[i];
      const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
      const wk = e.week ?? e.w ?? null;
      const key = String(mid != null ? (mid + '|' + wk) : ('auto|' + wk + '|' + i));
      if (!byMatch[key]) byMatch[key] = [];
      byMatch[key].push(e);
    }
    const apiNormalized = [];
    const mkeys = Object.keys(byMatch);
    for (let ki = 0; ki < mkeys.length; ki++) {
      const entries = byMatch[mkeys[ki]];
      if (!entries || entries.length === 0) continue;

      if (entries.length === 1) {
        const a = entries[0];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
        const aMeta = rosterMapForSelectedSeason[aId] || {};
        const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
        const aPlacement = placementMap[aId] ?? null;
        apiNormalized.push({
          matchup_id: mkeys[ki],
          season: ledgerSeasonKey,
          week: a.week ?? a.w ?? null,
          teamA: { rosterId: aId, name: aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts, placement: aPlacement },
          teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, placement: null },
          participantsCount: 1
        });
        continue;
      }

      if (entries.length === 2) {
        const a = entries[0];
        const b = entries[1];
        const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
        const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
        const aMeta = rosterMapForSelectedSeason[aId] || {};
        const bMeta = rosterMapForSelectedSeason[bId] || {};
        const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
        const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? null);
        const aPlacement = placementMap[aId] ?? null;
        const bPlacement = placementMap[bId] ?? null;
        apiNormalized.push({
          matchup_id: mkeys[ki],
          season: ledgerSeasonKey,
          week: a.week ?? a.w ?? null,
          teamA: { rosterId: aId, name: aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts, placement: aPlacement },
          teamB: { rosterId: bId, name: bMeta.team_name || bMeta.owner_name || ('Roster ' + bId), avatar: bMeta.team_avatar || bMeta.owner_avatar || null, points: bPts, placement: bPlacement },
          participantsCount: 2
        });
        continue;
      }

      // multiplayer entries -> flatten participants array
      const participants = entries.map(ent => {
        const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
        const meta = rosterMapForSelectedSeason[pid] || {};
        return {
          rosterId: pid,
          name: meta.team_name || meta.owner_name || ('Roster ' + pid),
          avatar: meta.team_avatar || meta.owner_avatar || null,
          points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0),
          placement: placementMap[pid] ?? null
        };
      });
      const combinedLabel = participants.map(p => p.name).join(' / ');
      apiNormalized.push({
        matchup_id: mkeys[ki],
        season: ledgerSeasonKey,
        week: entries[0].week ?? entries[0].w ?? null,
        combinedParticipants: participants,
        combinedLabel,
        participantsCount: participants.length
      });
    }

    // replace matchupsRows with normalized API rows
    matchupsRows.length = 0;
    matchupsRows.push(...apiNormalized);
    messages.push('Built playoff matchups from Sleeper API for selected season.');
  }

  // helper to find a playoff matchup between two rosterIds across playoff weeks
  function findMatchForPair(rA, rB, preferredWeeks = [playoffStart, playoffStart+1, playoffStart+2]) {
    if (!rA || !rB) return null;
    const a = String(rA), b = String(rB);
    for (const wk of preferredWeeks) {
      for (const r of matchupsRows) {
        if (!r.week) continue;
        if (Number(r.week) !== Number(wk)) continue;
        if (r.participantsCount === 2) {
          const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
          if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) return r;
        } else if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
          const ids = r.combinedParticipants.map(p => String(p.rosterId));
          if (ids.includes(a) && ids.includes(b)) return r;
        }
      }
    }
    for (const r of matchupsRows) {
      if (r.participantsCount === 2) {
        const p1 = String(r.teamA.rosterId), p2 = String(r.teamB.rosterId);
        if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) return r;
      } else if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
        const ids = r.combinedParticipants.map(p => String(p.rosterId));
        if (ids.includes(a) && ids.includes(b)) return r;
      }
    }
    return null;
  }

  function decideWinnerFromMatch(matchRow, aId, bId) {
    const a = String(aId), b = String(bId);
    if (!matchRow) return null;
    let aPts = null, bPts = null;
    if (matchRow.participantsCount === 2) {
      const pA = String(matchRow.teamA.rosterId), pB = String(matchRow.teamB.rosterId);
      if (pA === a) { aPts = matchRow.teamA.points; bPts = matchRow.teamB.points; }
      else { aPts = matchRow.teamB.points; bPts = matchRow.teamA.points; }
    } else if (matchRow.combinedParticipants) {
      const pAobj = matchRow.combinedParticipants.find(p => String(p.rosterId) === a);
      const pBobj = matchRow.combinedParticipants.find(p => String(p.rosterId) === b);
      aPts = pAobj?.points ?? 0;
      bPts = pBobj?.points ?? 0;
    }

    if (aPts == null || bPts == null) return null;
    if (aPts > bPts + 1e-9) return { winner: a, loser: b, reason: 'matchup' };
    if (bPts > aPts + 1e-9) return { winner: b, loser: a, reason: 'matchup' };

    const aPF = (regularStandings.find(s => String(s.rosterId) === a)?.pf) ?? 0;
    const bPF = (regularStandings.find(s => String(s.rosterId) === b)?.pf) ?? 0;
    if (aPF > bPF) return { winner: a, loser: b, reason: 'tiebreak-pf' };
    if (bPF > aPF) return { winner: b, loser: a, reason: 'tiebreak-pf' };

    const aW = (regularStandings.find(s => String(s.rosterId) === a)?.wins) ?? 0;
    const bW = (regularStandings.find(s => String(s.rosterId) === b)?.wins) ?? 0;
    if (aW > bW) return { winner: a, loser: b, reason: 'tiebreak-wins' };
    if (bW > aW) return { winner: b, loser: a, reason: 'tiebreak-wins' };

    const aPl = placementMap[a] ?? 999;
    const bPl = placementMap[b] ?? 999;
    if (aPl < bPl) return { winner: a, loser: b, reason: 'tiebreak-placement' };
    if (bPl < aPl) return { winner: b, loser: a, reason: 'tiebreak-placement' };

    return { winner: a, loser: b, reason: 'fallback' };
  }

  const trace = [];
  trace.push(`Loaded rosters (${Object.keys(rosterMapForSelectedSeason).length})`);

  function seedToRoster(seed) {
    const rid = placementToRoster[seed] ?? null;
    const meta = rid ? rosterMapForSelectedSeason[rid] : null;
    return { rosterId: rid, name: meta?.team_name ?? meta?.owner_name ?? ('Roster ' + rid) };
  }

  // Build winnersSeeds / losersSeeds for bracket simulation using placement list
  const winnersSeeds = [];
  const losersSeeds = [];
  for (let s = 1; s <= 14; s++) {
    const rid = placementToRoster[s] ?? null;
    if (!rid) continue;
    if (s <= 8) winnersSeeds.push({ seed: s, rosterId: rid });
    else losersSeeds.push({ seed: s, rosterId: rid });
  }

  function runMatch(seedA, seedB, label, preferredWeeks = [playoffStart, playoffStart+1, playoffStart+2]) {
    const a = seedA.rosterId, b = seedB.rosterId;
    const matchRow = findMatchForPair(a, b, preferredWeeks);
    const decision = decideWinnerFromMatch(matchRow, a, b);
    if (!decision) {
      const winner = Number(seedA.seed) <= Number(seedB.seed) ? seedA.rosterId : seedB.rosterId;
      const loser = winner === seedA.rosterId ? seedB.rosterId : seedA.rosterId;
      trace.push(`${label} ${seedA.seed}v${seedB.seed} -> ${ placementMap[winner] ?? winner } (fallback-no-match)`);
      return { winner, loser, row: matchRow, reason: 'fallback-no-match' };
    }
    const winner = decision.winner;
    const loser = decision.loser;
    const wSeed = placementMap[winner] ?? winner;
    trace.push(`${label} ${seedA.seed}v${seedB.seed} -> ${ wSeed } (${decision.reason})`);
    return { winner, loser, row: matchRow, reason: decision.reason };
  }

  // -------------------------
  // Winners bracket simulation (logic preserved from original)
  // -------------------------
  const wR1Pairs = [
    [1,8],[2,7],[3,6],[4,5]
  ].map(([s1,s2]) => ({ a: {seed: s1, rosterId: placementToRoster[s1]}, b: {seed: s2, rosterId: placementToRoster[s2]} }));

  const wR1Results = [];
  for (const p of wR1Pairs) {
    if (!p.a.rosterId || !p.b.rosterId) {
      trace.push(`W1 ${p.a.seed}v${p.b.seed} -> missing-roster`);
      wR1Results.push({ winner: p.a.rosterId || p.b.rosterId, loser: p.a.rosterId ? p.b.rosterId : p.a.rosterId, reason: 'missing-roster' });
      continue;
    }
    const res = runMatch(p.a, p.b, `W1`);
    wR1Results.push(res);
  }

  const wR1Winners = wR1Results.map((r, idx) => ({ seed: placementMap[r.winner] ?? null, rosterId: r.winner, loserSeed: placementMap[r.loser] ?? null, loserId: r.loser }));
  const wR1Losers = wR1Results.map((r, idx) => ({ seed: placementMap[r.loser] ?? null, rosterId: r.loser, winnerSeed: placementMap[r.winner] ?? null, winnerId: r.winner }));

  wR1Winners.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const wSemiPairs = [
    [ wR1Winners[0], wR1Winners[wR1Winners.length-1] ],
    [ wR1Winners[1], wR1Winners[wR1Winners.length-2] ]
  ];

  const wSemiResults = [];
  for (const pair of wSemiPairs) {
    if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) {
      trace.push(`Semi missing participant -> skipping`);
      wSemiResults.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[1]?.rosterId || pair[0]?.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}, `Semi`);
    wSemiResults.push(res);
  }

  const finalRes = (wSemiResults.length >= 2) ? runMatch({seed: placementMap[wSemiResults[0].winner], rosterId: wSemiResults[0].winner}, {seed: placementMap[wSemiResults[1].winner], rosterId: wSemiResults[1].winner}, `Final`) : null;
  const thirdRes = (wSemiResults.length >= 2) ? runMatch({seed: placementMap[wSemiResults[0].loser], rosterId: wSemiResults[0].loser}, {seed: placementMap[wSemiResults[1].loser], rosterId: wSemiResults[1].loser}, `3rd`) : null;

  // Consolation from R1 losers
  wR1Losers.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const cR1Pairs = [
    [wR1Losers[0], wR1Losers[wR1Losers.length-1]],
    [wR1Losers[1], wR1Losers[wR1Losers.length-2]]
  ];
  const cR1Results = [];
  for (const pair of cR1Pairs) {
    if (!pair[0] || !pair[1] || !pair[0].rosterId || !pair[1].rosterId) {
      trace.push(`Consolation R1 missing -> skipping`);
      cR1Results.push({ winner: pair[0]?.rosterId || pair[1]?.rosterId, loser: pair[1]?.rosterId || pair[0]?.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: pair[0].seed, rosterId: pair[0].rosterId}, {seed: pair[1].seed, rosterId: pair[1].rosterId}, `Consolation R1`);
    cR1Results.push(res);
  }

  const fifthRes = (cR1Results.length >= 2) ? runMatch({seed: placementMap[cR1Results[0].winner], rosterId: cR1Results[0].winner}, {seed: placementMap[cR1Results[1].winner], rosterId: cR1Results[1].winner}, `5th`) : null;
  const seventhRes = (cR1Results.length >= 2) ? runMatch({seed: placementMap[cR1Results[0].loser], rosterId: cR1Results[0].loser}, {seed: placementMap[cR1Results[1].loser], rosterId: cR1Results[1].loser}, `7th`) : null;

  // -------------------------
  // Losers bracket (corrected)
  // -------------------------
  const lPairsSeedNums = [[9,12],[10,11]];
  const lR1Results = [];
  const lBySeed = {};
  for (const s of losersSeeds) lBySeed[s.seed] = s;

  for (const [s1,s2] of lPairsSeedNums) {
    const objA = lBySeed[s1] || {seed:s1, rosterId: placementToRoster[s1]};
    const objB = lBySeed[s2] || {seed:s2, rosterId: placementToRoster[s2]};
    if (!objA.rosterId || !objB.rosterId) {
      trace.push(`LRace ${s1}v${s2} -> missing-roster`);
      lR1Results.push({ winner: objA.rosterId || objB.rosterId, loser: objA.rosterId ? objB.rosterId : objA.rosterId, reason:'missing' });
      continue;
    }
    const res = runMatch({seed: objA.seed, rosterId: objA.rosterId}, {seed: objB.seed, rosterId: objB.rosterId}, `LRace`);
    lR1Results.push(res);
  }

  const lWinners = lR1Results.map(r => ({ rosterId: r.winner, seed: placementMap[r.winner] ?? null }));
  const lLosers = lR1Results.map(r => ({ rosterId: r.loser, seed: placementMap[r.loser] ?? null }));

  const bye13 = { seed: 13, rosterId: placementToRoster[13] ?? null };
  const bye14 = { seed: 14, rosterId: placementToRoster[14] ?? null };

  lLosers.sort((a,b) => (a.seed || 999) - (b.seed || 999));
  const lrSemiPairs = [];
  if (lLosers.length >= 1) {
    const loserA = lLosers[0];
    lrSemiPairs.push([ loserA, bye14 ]);
  }
  if (lLosers.length >= 2) {
    const loserB = lLosers[1];
    lrSemiPairs.push([ loserB, bye13 ]);
  }

  const lSemiResults = [];
  for (const pair of lrSemiPairs) {
    const left = pair[0];
    const right = pair[1];
    if (!left || !right || !left.rosterId || !right.rosterId) {
      trace.push(`LRaceSemi ${left?.seed ?? '?'}v${right?.seed ?? '?'} -> missing`);
      lSemiResults.push({ winner: left?.rosterId || right?.rosterId, loser: right?.rosterId || left?.rosterId, reason: 'missing' });
      continue;
    }
    const res = runMatch({seed: left.seed, rosterId: left.rosterId}, {seed: right.seed, rosterId: right.rosterId}, `LRaceSemi`);
    lSemiResults.push(res);
  }

  let lFinalRes = null;
  if (lWinners.length >= 2) {
    lFinalRes = runMatch({seed: lWinners[0].seed, rosterId: lWinners[0].rosterId}, {seed: lWinners[1].seed, rosterId: lWinners[1].rosterId}, `9th`);
  } else if (lWinners.length === 1) {
    lFinalRes = { winner: lWinners[0].rosterId, loser: null, reason: 'auto' };
    trace.push(`9th auto -> ${placementMap[lWinners[0].rosterId] ?? lWinners[0].rosterId} (single-winner)`);
  }

  let l11Res = null, l13Res = null;
  if (lSemiResults.length >= 2) {
    const semiWinners = lSemiResults.map(r => ({ rosterId: r.winner, seed: placementMap[r.winner] ?? null }));
    const semiLosers = lSemiResults.map(r => ({ rosterId: r.loser, seed: placementMap[r.loser] ?? null }));

    if (semiWinners.length >= 2) {
      l11Res = runMatch({seed: semiWinners[0].seed, rosterId: semiWinners[0].rosterId}, {seed: semiWinners[1].seed, rosterId: semiWinners[1].rosterId}, `11th`);
    } else if (semiWinners.length === 1) {
      l11Res = { winner: semiWinners[0].rosterId, loser: null, reason: 'auto' };
      trace.push(`11th auto -> ${placementMap[semiWinners[0].rosterId] ?? semiWinners[0].rosterId} (single-semi-winner)`);
    }

    if (semiLosers.length >= 2) {
      l13Res = runMatch({seed: semiLosers[0].seed, rosterId: semiLosers[0].rosterId}, {seed: semiLosers[1].seed, rosterId: semiLosers[1].rosterId}, `13th`);
    } else if (semiLosers.length === 1) {
      l13Res = { winner: semiLosers[0].rosterId, loser: null, reason: 'auto' };
      trace.push(`13th auto -> ${placementMap[semiLosers[0].rosterId] ?? semiLosers[0].rosterId} (single-semi-loser)`);
    }
  } else if (lSemiResults.length === 1) {
    l11Res = { winner: lSemiResults[0].winner, loser: null, reason: 'only-semi' };
    l13Res = { winner: lSemiResults[0].loser, loser: null, reason: 'only-semi' };
    trace.push(`LRaceSemi single -> 11th ${placementMap[lSemiResults[0].winner] ?? lSemiResults[0].winner} , 13th ${placementMap[lSemiResults[0].loser] ?? lSemiResults[0].loser}`);
  }

  // -------------------------
  // Build final ordered placement list
  // -------------------------
  const assigned = new Set();
  const placementFinal = [];

  function pushIfNotAssigned(rosterId) {
    if (!rosterId) return;
    const r = String(rosterId);
    if (!assigned.has(r)) {
      placementFinal.push(r);
      assigned.add(r);
    }
  }

  function pushResultPair(resObj) {
    if (!resObj) return;
    pushIfNotAssigned(resObj.winner);
    if (resObj.loser) pushIfNotAssigned(resObj.loser);
  }

  pushResultPair(finalRes);
  pushResultPair(thirdRes);
  pushResultPair(fifthRes);
  pushResultPair(seventhRes);

  pushResultPair(lFinalRes);
  pushResultPair(l11Res);
  pushResultPair(l13Res);

  for (const r of matchupsRows) {
    if (r.participantsCount === 2) {
      pushIfNotAssigned(r.teamA.rosterId);
      pushIfNotAssigned(r.teamB.rosterId);
    } else if (Array.isArray(r.combinedParticipants)) {
      for (const p of r.combinedParticipants) pushIfNotAssigned(p.rosterId);
    } else if (r.teamA && r.teamA.rosterId) pushIfNotAssigned(r.teamA.rosterId);
  }

  for (const rk in rosterMapForSelectedSeason) pushIfNotAssigned(rk);

  const totalTeams = Object.keys(rosterMapForSelectedSeason).length || placementFinal.length;
  if (placementFinal.length < totalTeams) {
    for (const rk in rosterMapForSelectedSeason) {
      if (!assigned.has(String(rk))) {
        placementFinal.push(String(rk));
        assigned.add(String(rk));
      }
    }
  }
  while (placementFinal.length > totalTeams) placementFinal.pop();

  const finalStandings = [];
  for (let i = 0; i < placementFinal.length; i++) {
    const rid = String(placementFinal[i]);
    const meta = rosterMapForSelectedSeason[rid] || {};
    finalStandings.push({
      rank: i + 1,
      rosterId: rid,
      team_name: meta.team_name || meta.owner_name || ('Roster ' + rid),
      avatar: meta.team_avatar || meta.owner_avatar || null,
      seed: placementMap[rid] ?? null,
      pf: regularStandings.find(s => String(s.rosterId) === rid)?.pf ?? 0,
      wins: regularStandings.find(s => String(s.rosterId) === rid)?.wins ?? 0,
      owner_name: meta.owner_name ?? meta.owner?.display_name ?? meta.owner?.username ?? null,
      roster_meta: meta
    });
  }

  finalStandings.sort((a,b) => {
    if ((a.rank || 0) !== (b.rank || 0)) return (a.rank || 0) - (b.rank || 0);
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    if ((b.pf || 0) !== (a.pf || 0)) return (b.pf || 0) - (a.pf || 0);
    return (a.seed || 999) - (b.seed || 999);
  });
  for (let i = 0; i < finalStandings.length; i++) finalStandings[i].rank = i + 1;

  const champion = finalStandings[0] ?? null;
  const biggestLoser = finalStandings[finalStandings.length - 1] ?? null;

  // --- compute MVPs ---
  let finalsMvp = null;
  let overallMvp = null;

  if (selectedSeasonJson) {
    try {
      // compute from JSON (we already have playoffStart/playoffEnd)
      const mvps = computeMVPsFromSeasonJson(selectedSeasonJson, playoffStart, playoffEnd);
      if (mvps.finalsMvp) {
        finalsMvp = { playerId: mvps.finalsMvp.playerId, points: mvps.finalsMvp.points, rosterId: mvps.finalsMvp.rosterId, rosterName: mvps.finalsMvp.rosterName };
      } else finalsMvp = null;
      if (mvps.overallMvp) {
        overallMvp = { playerId: mvps.overallMvp.playerId, points: mvps.overallMvp.points };
      } else overallMvp = null;
      messages.push('Computed MVPs from local season JSON.');
    } catch (e) {
      messages.push('Failed computing MVPs from JSON: ' + (e?.message ?? e));
    }
  } else {
    try {
      finalsMvp = await sleeper.getFinalsMVP(selectedLeagueId, { season: selectedSeasonParam || (leagueMeta && leagueMeta.season) || null, championshipWeek: playoffEnd, maxWeek: playoffEnd, playersEndpoint: '/players/nba' });
    } catch (e) {
      messages.push('Failed computing Finals MVP: ' + (e?.message ?? e));
      finalsMvp = null;
    }
    try {
      overallMvp = await sleeper.getOverallMVP(selectedLeagueId, { season: selectedSeasonParam || (leagueMeta && leagueMeta.season) || null, maxWeek: playoffEnd, playersEndpoint: '/players/nba' });
    } catch (e) {
      messages.push('Failed computing Overall MVP: ' + (e?.message ?? e));
      overallMvp = null;
    }
    // attempt to attach roster_meta if rosterMap available
    try {
      if (finalsMvp && typeof finalsMvp.rosterId !== 'undefined' && rosterMapForSelectedSeason && rosterMapForSelectedSeason[String(finalsMvp.rosterId)]) {
        finalsMvp.roster_meta = rosterMapForSelectedSeason[String(finalsMvp.rosterId)];
      }
      if (overallMvp && typeof overallMvp.topRosterId !== 'undefined' && rosterMapForSelectedSeason && rosterMapForSelectedSeason[String(overallMvp.topRosterId)]) {
        overallMvp.roster_meta = rosterMapForSelectedSeason[String(overallMvp.topRosterId)];
      }
    } catch (e) {
      // non-fatal
    }
  }

  // Build finalStandingsBySeason so the client can switch seasons client-side when JSONs are present
  const finalStandingsBySeason = {};
  // include the selected season
  const selectedSeasonKey = String(selectedSeasonParam);
  finalStandingsBySeason[selectedSeasonKey] = { finalStandings, debug: trace.slice() };

  // Also include any loaded JSON seasons into the mapping (so UI can switch to them)
  for (const key of Object.keys(seasonJsons)) {
    try {
      // process season JSON into finalStandings and debug similarly (reuse logic but lighter)
      const seasonJson = seasonJsons[key];
      // build roster map from JSON
      const rm = buildRosterMapFromSeasonJson(seasonJson);
      applyOwnerCombinesToRosterMap(rm);

      // compute regular stats for that season (simple approach)
      const sStatsByRoster = {};
      const sResultsByRoster = {};
      const sPaByRoster = {};
      for (const rk in rm) {
        sStatsByRoster[rk] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
        sResultsByRoster[rk] = [];
        sPaByRoster[rk] = 0;
      }
      // determine playoff start for that JSON season (if provided)
      const sPlayoffStart = Number(seasonJson.playoff_week_start ?? seasonJson.playoffStartWeek ?? seasonJson.playoff_start_week ?? playoffStart);
      const sRegEnd = Math.max(1, sPlayoffStart - 1);

      // aggregate regular weeks
      for (let wk = 1; wk <= sRegEnd; wk++) {
        const arr = Array.isArray(seasonJson[String(wk)]) ? seasonJson[String(wk)] : [];
        for (const m of arr) {
          const aId = String(m.teamA?.rosterId ?? m.teamA?.roster_id ?? '');
          const bId = String(m.teamB?.rosterId ?? m.teamB?.roster_id ?? '');
          const aPts = safeNum(m.teamAScore ?? m.teamA?.points ?? 0);
          const bPts = safeNum(m.teamBScore ?? m.teamB?.points ?? 0);
          if (!aId || !bId) {
            // single participant
            const onlyId = aId || bId;
            if (!sStatsByRoster[onlyId]) sStatsByRoster[onlyId] = { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
            sStatsByRoster[onlyId].pf += (aPts || bPts);
            continue;
          }
          sStatsByRoster[aId] = sStatsByRoster[aId] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
          sStatsByRoster[bId] = sStatsByRoster[bId] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
          sResultsByRoster[aId] = sResultsByRoster[aId] || [];
          sResultsByRoster[bId] = sResultsByRoster[bId] || [];
          sPaByRoster[aId] = sPaByRoster[aId] || 0;
          sPaByRoster[bId] = sPaByRoster[bId] || 0;

          sStatsByRoster[aId].pf += aPts;
          sStatsByRoster[bId].pf += bPts;

          sPaByRoster[aId] += bPts;
          sPaByRoster[bId] += aPts;

          if (aPts > bPts + 1e-9) {
            sResultsByRoster[aId].push('W');
            sStatsByRoster[aId].wins += 1;
            sResultsByRoster[bId].push('L');
            sStatsByRoster[bId].losses += 1;
          } else if (bPts > aPts + 1e-9) {
            sResultsByRoster[bId].push('W');
            sStatsByRoster[bId].wins += 1;
            sResultsByRoster[aId].push('L');
            sStatsByRoster[aId].losses += 1;
          } else {
            sResultsByRoster[aId].push('T');
            sResultsByRoster[bId].push('T');
            sStatsByRoster[aId].ties += 1;
            sStatsByRoster[bId].ties += 1;
          }
        }
      }

      const sRegularStandings = buildStandingsFromTrackers(sStatsByRoster, sResultsByRoster, sPaByRoster, rm);

      // lightweight playoff ordering: collect playoff matchups (playoffStart..playoffStart+2) and simulate bracket like earlier
      const sMatchups = [];
      for (let wk = sPlayoffStart; wk <= (sPlayoffStart + 2); wk++) {
        const arr = Array.isArray(seasonJson[String(wk)]) ? seasonJson[String(wk)] : [];
        for (let mi = 0; mi < arr.length; mi++) {
          const m = arr[mi];
          const aId = String(m.teamA?.rosterId ?? '');
          const bId = String(m.teamB?.rosterId ?? '');
          const aPts = safeNum(m.teamAScore ?? m.teamA?.points ?? 0);
          const bPts = safeNum(m.teamBScore ?? m.teamB?.points ?? 0);
          const aMeta = rm[aId] || {};
          const bMeta = rm[bId] || {};
          if (!bId) {
            sMatchups.push({
              matchup_id: `json|${key}|${wk}|${mi}`,
              season: key,
              week: wk,
              teamA: { rosterId: aId, name: aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts, placement: null },
              teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, placement: null },
              participantsCount: 1
            });
          } else {
            sMatchups.push({
              matchup_id: `json|${key}|${wk}|${mi}`,
              season: key,
              week: wk,
              teamA: { rosterId: aId, name: aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: aPts, placement: null },
              teamB: { rosterId: bId, name: bMeta.team_name || bMeta.owner_name || ('Roster ' + bId), avatar: bMeta.team_avatar || bMeta.owner_avatar || null, points: bPts, placement: null },
              participantsCount: 2
            });
          }
        }
      }

      // derive placements via simple bracket ordering heuristic: winners bracket seeds = 1..8; losers seeds = 9..14
      // We'll build a simple finalStandings ordering using playoff winners first (attempt to find champion)
      // For the purposes of client-side preview we'll sort by wins descending then PF
      const sFinal = sRegularStandings.slice().sort((a,b) => {
        if ((b.wins||0) !== (a.wins||0)) return (b.wins||0) - (a.wins||0);
        return (b.pf||0) - (a.pf||0);
      }).map((r, idx) => ({
        rank: idx + 1,
        rosterId: r.rosterId,
        team_name: r.team_name,
        avatar: r.avatar,
        seed: null,
        pf: r.pf,
        wins: r.wins,
        owner_name: r.owner_name
      }));

      finalStandingsBySeason[String(key)] = { finalStandings: sFinal, debug: [`Loaded from local JSON (${key})`] };
    } catch (err) {
      // continue on JSON parse errors
      messages.push(`Failed to build finalStandingsBySeason for JSON ${key}: ${err?.message ?? err}`);
    }
  }

  // also add debug trace
  const debug = trace.slice();

  // summary debug messages
  const summary = `Debug summary: seasonsResults=${seasons.length}, seasonsJSONLoaded=${Object.keys(seasonJsons).length}, jsonLinks=${jsonLinks.length}, leagueIdsToProcess=1, aggregatedRegular=${regularStandings.length}, aggregatedPlayoff=${matchupsRows.length}`;
  messages.push(summary);

  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    matchupsRows,
    regularStandings,
    finalStandings,
    finalStandingsBySeason,
    debug,
    messages,
    prevChain,
    jsonLinks,
    finalsMvp,
    overallMvp,
    champion,
    biggestLoser,
  };
}
