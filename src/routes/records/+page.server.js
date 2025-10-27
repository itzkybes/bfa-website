// src/routes/records/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { readFile, readdir } from 'fs/promises';
import path from 'path';

let cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) cache = createKVCache(globalThis.KV);
  else cache = createMemoryCache();
} catch (e) {
  cache = createMemoryCache();
}

const SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
const sleeper = createSleeperClient({ cache, concurrency: SLEEPER_CONCURRENCY });

// CONFIG
const BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID)
  ? process.env.BASE_LEAGUE_ID
  : '1219816671624048640'; // league for 2025
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;
const DEFAULT_PLAYOFF_START = Number(process.env.DEFAULT_PLAYOFF_START || 15);
const PLAYOFF_FINAL_WEEK = Number(process.env.PLAYOFF_FINAL_WEEK || 23);

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

async function readAllSeasonMatchupFiles(messages = []) {
  const out = {};
  try {
    const folderUrl = new URL('../../../static/season_matchups', import.meta.url);
    const folderPath = folderUrl.pathname;
    let files;
    try {
      files = await readdir(folderPath);
    } catch (e) {
      messages.push(`No override dir found in candidates: ${folderPath}`);
      return out;
    }
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.json')) continue;
      const full = path.join(folderPath, f);
      try {
        const txt = await readFile(full, 'utf8');
        const parsed = JSON.parse(txt);
        // guess season key from filename like 2023.json or season_2023.json
        const m = f.match(/(20\d{2})/);
        const seasonKey = m ? m[1] : f.replace(/\.json$/i, '');
        out[seasonKey] = { file: f, path: full, json: parsed };
        messages.push(`Loaded override file for season=${seasonKey} from ${full}`);
      } catch (err) {
        messages.push(`Failed to read/parse ${full}: ${err?.message ?? err}`);
      }
    }
    return out;
  } catch (err) {
    messages.push(`Error locating season_matchups folder: ${err?.message ?? err}`);
    return out;
  }
}

function normalizeSeasonJson(payload) {
  const weeks = {};
  if (!payload) return weeks;
  // if payload already keyed by week strings
  if (Array.isArray(payload)) {
    // try to bucket by "week" in objects
    for (const m of payload) {
      const wk = Number(m.week ?? m.w ?? m.week_number ?? 0) || 0;
      if (!weeks[wk]) weeks[wk] = [];
      weeks[wk].push(m);
    }
    return weeks;
  }
  for (const [k, v] of Object.entries(payload)) {
    const wk = Number(k);
    if (!Number.isNaN(wk)) weeks[wk] = Array.isArray(v) ? v : [];
  }
  return weeks;
}

function findBestScoreFromRow(row) {
  if (!row) return 0;
  // prefer starters_points if present anywhere
  if (typeof row.starters_points === 'number') return row.starters_points;
  if (typeof row.starters_points_total === 'number') return row.starters_points_total;
  if (typeof row.points === 'number') return row.points;
  if (typeof row.points_for === 'number') return row.points_for;
  if (typeof row.pts === 'number') return row.pts;
  if (typeof row.score === 'number') return row.score;
  // if nested participant object
  for (const v of Object.values(row)) {
    if (v && typeof v === 'object') {
      if (typeof v.starters_points === 'number') return v.starters_points;
      if (typeof v.points === 'number') return v.points;
      if (typeof v.points_for === 'number') return v.points_for;
    }
  }
  return 0;
}

function teamIdentityKey(team) {
  // prefer rosterId, then ownerName, then team name
  if (!team) return null;
  if (team.rosterId) return `r:${team.rosterId}`;
  if (team.roster_id) return `r:${team.roster_id}`;
  if (team.ownerName) return `o:${String(team.ownerName).toLowerCase()}`;
  if (team.owner_name) return `o:${String(team.owner_name).toLowerCase()}`;
  if (team.name) return `t:${String(team.name).toLowerCase()}`;
  return null;
}

function mergeTeamMeta(dest, src) {
  if (!src) return dest;
  dest.team = dest.team || src.name || src.team || src.team_name || null;
  dest.owner_name = dest.owner_name || src.ownerName || src.owner_name || null;
  dest.rosterId = dest.rosterId || src.rosterId || src.roster_id || null;
  dest.avatar = dest.avatar || src.avatar || src.team_avatar || src.owner_avatar || null;
  return dest;
}

// compute streaks given chronological results array of 'W'|'L'|'T'
function maxStreak(results, kind = 'W') {
  let max = 0, cur = 0;
  for (const r of results) {
    if ((kind === 'W' && r === 'W') || (kind === 'L' && r === 'L')) {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

export async function load() {
  const messages = [];
  const seasonMatchups = {}; // season -> week -> [matchups]
  const importSummary = {};

  // 1) read override files
  const files = await readAllSeasonMatchupFiles(messages);

  // normalize into seasonMatchups
  for (const s of Object.keys(files)) {
    const meta = files[s];
    const norm = normalizeSeasonJson(meta.json);
    seasonMatchups[String(s)] = {};
    for (const [wkStr, arr] of Object.entries(norm)) {
      const wk = Number(wkStr);
      if (Number.isNaN(wk) || wk <= 0) continue;
      seasonMatchups[String(s)][wk] = (Array.isArray(arr) ? arr : []).map((m, idx) => {
        // normalize common shapes
        const teamA = m.teamA || m.home || m.team1 || {};
        const teamB = m.teamB || m.away || m.team2 || {};
        const aPts = (typeof m.teamAScore === 'number') ? m.teamAScore : safeNum(teamA.score ?? teamA.points ?? m.teamAScore ?? 0);
        const bPts = (typeof m.teamBScore === 'number') ? m.teamBScore : safeNum(teamB.score ?? teamB.points ?? m.teamBScore ?? 0);
        const aRosterId = teamA.rosterId ?? teamA.roster_id ?? teamA.roster ?? null;
        const bRosterId = teamB.rosterId ?? teamB.roster_id ?? teamB.roster ?? null;

        return {
          matchup_id: m.matchup_id ?? m.matchupId ?? m.id ?? `override-${s}-${wk}-${idx}`,
          season: Number(s),
          week: wk,
          teamA: { rosterId: aRosterId, name: teamA.name || teamA.team || teamA.team_name || null, ownerName: teamA.ownerName || teamA.owner_name || teamA.owner || null, avatar: teamA.avatar || teamA.team_avatar || null, points: aPts },
          teamB: { rosterId: bRosterId, name: teamB.name || teamB.team || teamB.team_name || null, ownerName: teamB.ownerName || teamB.owner_name || teamB.owner || null, avatar: teamB.avatar || teamB.team_avatar || null, points: bPts },
          _source: meta.file || 'override'
        };
      });
    }
    importSummary[String(s)] = { weeks: Object.keys(seasonMatchups[String(s)]).length, matchups: Object.values(seasonMatchups[String(s)]).reduce((a,b)=>a+(Array.isArray(b)?b.length:0),0), file: meta.file };
    messages.push(`Imported season=${s}: weeks=${importSummary[String(s)].weeks} matchups=${importSummary[String(s)].matchups}`);
  }

  // ensure default seasons if none present
  for (const s of ['2022','2023','2024','2025']) {
    if (!seasonMatchups[String(s)]) seasonMatchups[String(s)] = {};
    if (!importSummary[String(s)]) importSummary[String(s)] = { weeks: 0, matchups: 0 };
  }

  // 2) discover league chain to map seasons -> league_id (so we can fetch playoff_week_start when possible)
  const seasonToLeague = {}; // season -> league_id
  try {
    let mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { mainLeague = null; }
    if (mainLeague) {
      const push = (league) => {
        if (!league) return;
        const s = league.season ? String(league.season) : null;
        if (s) seasonToLeague[s] = String(league.league_id);
      };
      push(mainLeague);
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prev = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prev) break;
          push(prev);
          currPrev = prev.previous_league_id ? String(prev.previous_league_id) : null;
        } catch (err) { break; }
      }
    }
  } catch (err) {
    messages.push(`Error discovering league chain: ${err?.message ?? err}`);
  }

  // 3) fetch matchups for 2025 via sleeper.getMatchupsForWeek and store in seasonMatchups['2025'] if not skipped
  messages.push(`Fetching matchups for current season 2025 from Sleeper for league ${BASE_LEAGUE_ID}`);
  for (let wk = 1; wk <= MAX_WEEKS; wk++) {
    try {
      const raw = await sleeper.getMatchupsForWeek(BASE_LEAGUE_ID, wk, { ttl: 60 * 5 }).catch(e => { throw e; }) || [];
      // group by matchup
      const byMatch = {};
      for (let i = 0; i < raw.length; i++) {
        const e = raw[i];
        const mid = (e.matchup_id ?? e.matchupId ?? e.matchup) ?? `auto-${i}`;
        const weekNum = e.week ?? wk;
        const key = `${mid}|${weekNum}`;
        if (!byMatch[key]) byMatch[key] = [];
        byMatch[key].push(e);
      }
      const normalized = [];
      for (const [k, entries] of Object.entries(byMatch)) {
        if (entries.length === 2) {
          const a = entries[0], b = entries[1];
          const aPts = findBestScoreFromRow(a);
          const bPts = findBestScoreFromRow(b);
          const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
          const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
          // try to resolve names via roster map later on the client; keep roster ids and points
          normalized.push({
            matchup_id: `${k}`,
            season: 2025,
            week: wk,
            teamA: { rosterId: aId, name: null, ownerName: null, avatar: null, points: safeNum(aPts) },
            teamB: { rosterId: bId, name: null, ownerName: null, avatar: null, points: safeNum(bPts) },
            _source: 'sleeper'
          });
        } else if (entries.length === 1) {
          const e = entries[0];
          const pts = findBestScoreFromRow(e);
          const id = String(e.roster_id ?? e.rosterId ?? e.owner_id ?? e.ownerId ?? 'unknown');
          normalized.push({
            matchup_id: `${k}`,
            season: 2025,
            week: wk,
            teamA: { rosterId: id, name: null, ownerName: null, avatar: null, points: safeNum(pts) },
            teamB: null,
            _source: 'sleeper'
          });
        } else {
          const participants = entries.map(ent => {
            const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
            const ppts = findBestScoreFromRow(ent);
            return { rosterId: pid, name: null, avatar: null, points: safeNum(ppts) };
          });
          normalized.push({
            matchup_id: k,
            season: 2025,
            week: wk,
            combinedParticipants: participants,
            participantsCount: participants.length,
            _source: 'sleeper'
          });
        }
      }

      // check completeness (participant with 0 => skip), except when wk is final playoff week
      const incomplete = normalized.some(m => {
        if (m.teamA && m.teamB) return (Number(m.teamA.points) === 0 || Number(m.teamB.points) === 0);
        if (m.combinedParticipants) return m.combinedParticipants.some(p => Number(p.points) === 0);
        if (m.teamA && !m.teamB) return Number(m.teamA.points) === 0;
        return false;
      });

      if (incomplete && wk !== PLAYOFF_FINAL_WEEK) {
        messages.push(`Skipping season=2025 week=${wk} (incomplete: a participant had 0 points)`);
        continue;
      }
      seasonMatchups['2025'][wk] = normalized;
      importSummary['2025'].weeks += 1;
      importSummary['2025'].matchups += normalized.length;
      messages.push(`Fetched season=2025 week=${wk} — matchups: ${normalized.length}`);
    } catch (err) {
      messages.push(`Error fetching season=2025 week=${wk}: ${err?.message ?? err}`);
    }
  }

  // 4) Now compute aggregated standings across seasons (regular vs playoff) using playoffStart per season if possible
  const regularMap = {}; // key -> stats
  const playoffMap = {};
  const allSeasons = Object.keys(seasonMatchups).sort();

  // helper: get playoff start for season
  async function getPlayoffStartForSeason(season) {
    try {
      const leagueId = seasonToLeague[String(season)];
      if (!leagueId) return DEFAULT_PLAYOFF_START;
      const meta = await sleeper.getLeague(leagueId, { ttl: 60 * 60 });
      const ps = meta && meta.settings && meta.settings.playoff_week_start ? Number(meta.settings.playoff_week_start) : DEFAULT_PLAYOFF_START;
      return (ps && !isNaN(ps) && ps >= 1) ? ps : DEFAULT_PLAYOFF_START;
    } catch (e) {
      return DEFAULT_PLAYOFF_START;
    }
  }

  // gather chronological list of games across seasons so we can compute streaks too (season asc, week asc)
  const allGamesChrono = []; // { season, week, teamAKey, teamBKey, aPts, bPts, isPlayoff }

  for (const season of allSeasons) {
    const weeksObj = seasonMatchups[season] || {};
    const playoffStart = await getPlayoffStartForSeason(season);
    const wkNums = Object.keys(weeksObj).map(Number).filter(n=>!Number.isNaN(n)).sort((a,b)=>a-b);
    for (const wk of wkNums) {
      const arr = weeksObj[wk] || [];
      for (const m of arr) {
        // handle normalized shapes where teamA/teamB / combinedParticipants may exist
        if (m.teamA && m.teamB) {
          const aPts = safeNum(m.teamA.points ?? findBestScoreFromRow(m.teamA));
          const bPts = safeNum(m.teamB.points ?? findBestScoreFromRow(m.teamB));
          // only count games that have numeric scores (non-null)
          if (Number.isNaN(aPts) || Number.isNaN(bPts)) continue;
          const aKey = teamIdentityKey(m.teamA) || `season${season}-wk${wk}-a-${m.matchup_id}`;
          const bKey = teamIdentityKey(m.teamB) || `season${season}-wk${wk}-b-${m.matchup_id}`;

          // ensure maps initially
          if (!regularMap[aKey]) regularMap[aKey] = { team: m.teamA.name || null, owner_name: m.teamA.ownerName || null, rosterId: m.teamA.rosterId || null, avatar: m.teamA.avatar || null, wins: 0, losses: 0, pf: 0, pa: 0, results: [] };
          if (!regularMap[bKey]) regularMap[bKey] = { team: m.teamB.name || null, owner_name: m.teamB.ownerName || null, rosterId: m.teamB.rosterId || null, avatar: m.teamB.avatar || null, wins: 0, losses: 0, pf: 0, pa: 0, results: [] };
          if (!playoffMap[aKey]) playoffMap[aKey] = { team: m.teamA.name || null, owner_name: m.teamA.ownerName || null, rosterId: m.teamA.rosterId || null, avatar: m.teamA.avatar || null, wins: 0, losses: 0, pf: 0, pa: 0, results: [] };
          if (!playoffMap[bKey]) playoffMap[bKey] = { team: m.teamB.name || null, owner_name: m.teamB.ownerName || null, rosterId: m.teamB.rosterId || null, avatar: m.teamB.avatar || null, wins: 0, losses: 0, pf: 0, pa: 0, results: [] };

          const isPlayoff = wk >= playoffStart;

          // accumulate PF/PA
          if (isPlayoff) {
            playoffMap[aKey].pf += aPts; playoffMap[aKey].pa += bPts;
            playoffMap[bKey].pf += bPts; playoffMap[bKey].pa += aPts;
          } else {
            regularMap[aKey].pf += aPts; regularMap[aKey].pa += bPts;
            regularMap[bKey].pf += bPts; regularMap[bKey].pa += aPts;
          }

          // wins/losses & results
          if (aPts > bPts) {
            if (isPlayoff) { playoffMap[aKey].wins++; playoffMap[bKey].losses++; playoffMap[aKey].results.push('W'); playoffMap[bKey].results.push('L'); }
            else { regularMap[aKey].wins++; regularMap[bKey].losses++; regularMap[aKey].results.push('W'); regularMap[bKey].results.push('L'); }
          } else if (aPts < bPts) {
            if (isPlayoff) { playoffMap[bKey].wins++; playoffMap[aKey].losses++; playoffMap[bKey].results.push('W'); playoffMap[aKey].results.push('L'); }
            else { regularMap[bKey].wins++; regularMap[aKey].losses++; regularMap[bKey].results.push('W'); regularMap[aKey].results.push('L'); }
          } else {
            // tie -> push 'T' but don't count as win or loss
            if (isPlayoff) { playoffMap[aKey].results.push('T'); playoffMap[bKey].results.push('T'); }
            else { regularMap[aKey].results.push('T'); regularMap[bKey].results.push('T'); }
          }

          // store chronological game for streak computation
          allGamesChrono.push({ season: Number(season), week: wk, aKey, bKey, aPts, bPts, isPlayoff });

        } else if (m.combinedParticipants && Array.isArray(m.combinedParticipants)) {
          // skip multi-team for win/loss tally (or treat as multiple records — choose skip for simplicity)
          continue;
        } else if (m.teamA && !m.teamB) {
          // bye or single participant; skip wins/losses but include PF/PA if desired (here we treat as PF only)
          const aPts = safeNum(m.teamA.points ?? findBestScoreFromRow(m.teamA));
          const aKey = teamIdentityKey(m.teamA) || `season${season}-wk${wk}-a-${m.matchup_id}`;
          if (!regularMap[aKey]) regularMap[aKey] = { team: m.teamA.name || null, owner_name: m.teamA.ownerName || null, rosterId: m.teamA.rosterId || null, avatar: m.teamA.avatar || null, wins: 0, losses: 0, pf: 0, pa: 0, results: [] };
          const isPlayoff = wk >= playoffStart;
          if (isPlayoff) {
            playoffMap[aKey] = playoffMap[aKey] || { team: m.teamA.name || null, owner_name: m.teamA.ownerName || null, rosterId: m.teamA.rosterId || null, avatar: m.teamA.avatar || null, wins: 0, losses: 0, pf: 0, pa: 0, results: [] };
            playoffMap[aKey].pf += aPts;
          } else {
            regularMap[aKey].pf += aPts;
          }
        }
      }
    }
  }

  // compute streaks (maxWinStreak, maxLoseStreak) per map by using their results arrays
  function finalizeMap(map) {
    const out = [];
    for (const [k, v] of Object.entries(map)) {
      out.push({
        key: k,
        team: v.team || v.owner_name || k,
        rosterId: v.rosterId || null,
        owner_name: v.owner_name || null,
        avatar: v.avatar || null,
        wins: v.wins || 0,
        losses: v.losses || 0,
        pf: Number((v.pf || 0).toFixed(2)),
        pa: Number((v.pa || 0).toFixed(2)),
        maxWinStreak: maxStreak(v.results || [], 'W'),
        maxLoseStreak: maxStreak(v.results || [], 'L')
      });
    }
    return out;
  }

  const regularAllTime = finalizeMap(regularMap).sort((a,b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return (b.pf || 0) - (a.pf || 0);
  });

  const playoffAllTime = finalizeMap(playoffMap).sort((a,b) => {
    // sort by wins desc, then pf
    if (b.wins !== a.wins) return b.wins - a.wins;
    return (b.pf || 0) - (a.pf || 0);
  });

  // originalRecords: attempt to preserve Bellooshio & cholybevv by scanning early2023.json if present
  let originalRecords = {};
  try {
    // check for early2023.json in static folder
    try {
      const eurl = new URL('../../../static/early2023.json', import.meta.url);
      const txt = await readFile(eurl, 'utf8');
      const early = JSON.parse(txt);
      // Attempt to compute original owner record totals for Bellooshio and cholybevv by scanning matchups (best-effort)
      const ownersToPreserve = ['bellooshio', 'cholybevv'];
      for (const o of ownersToPreserve) {
        originalRecords[o] = null;
      }
      // naive scan of early data: sum up wins/losses/points for ownerName keys if present
      for (const [seasonKey, seasonVal] of Object.entries(early)) {
        for (const [wk, arr] of Object.entries(seasonVal || {})) {
          for (const m of (arr || [])) {
            const aOwner = (m.teamA && (m.teamA.ownerName || m.teamA.owner_name)) ? String((m.teamA.ownerName || m.teamA.owner_name)).toLowerCase() : null;
            const bOwner = (m.teamB && (m.teamB.ownerName || m.teamB.owner_name)) ? String((m.teamB.ownerName || m.teamB.owner_name)).toLowerCase() : null;
            const aPts = safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? 0);
            const bPts = safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? 0);
            for (const ownerKey of Object.keys(originalRecords)) {
              if (!originalRecords[ownerKey]) originalRecords[ownerKey] = { team: null, regWins: 0, regLosses: 0, regPF: 0, regPA: 0, playoffWins: 0, playoffLosses: 0, playoffPF: 0, playoffPA: 0, championships: 0, avatar: null };
              if (aOwner === ownerKey) {
                originalRecords[ownerKey].team = originalRecords[ownerKey].team || (m.teamA && (m.teamA.name || m.teamA.team));
                originalRecords[ownerKey].regPF += aPts;
                originalRecords[ownerKey].regPA += bPts;
                if (aPts > bPts) originalRecords[ownerKey].regWins++;
                else if (aPts < bPts) originalRecords[ownerKey].regLosses++;
              }
              if (bOwner === ownerKey) {
                originalRecords[ownerKey].team = originalRecords[ownerKey].team || (m.teamB && (m.teamB.name || m.teamB.team));
                originalRecords[ownerKey].regPF += bPts;
                originalRecords[ownerKey].regPA += aPts;
                if (bPts > aPts) originalRecords[ownerKey].regWins++;
                else if (bPts < aPts) originalRecords[ownerKey].regLosses++;
              }
            }
          }
        }
      }
    } catch (e) {
      // early2023.json not present or parse failed — ignore
    }
  } catch (err) {
    // ignore
  }

  // create clickable links list for override files found
  const overridesLinks = Object.entries(files).map(([season, meta]) => ({
    season,
    file: meta.file,
    url: `/season_matchups/${meta.file}`
  }));

  // quick table checks (placeholders)
  const tableChecks = {
    regularAllTime: regularAllTime.length ? 'OK' : 'No data',
    playoffAllTime: playoffAllTime.length ? 'OK' : 'No data'
  };

  return {
    seasonMatchups,
    importSummary,
    overridesLinks,
    messages,
    regularAllTime,
    playoffAllTime,
    originalRecords,
    tableChecks
  };
}
