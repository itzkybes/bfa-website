#!/usr/bin/env node
/**
 * Regenerate /static/season_matchups/{year}.json snapshots.
 *
 * Walks the Sleeper league chain from the anchor league (current season)
 * backwards via `previous_league_id`, then for every requested year
 * fetches every matchup week and writes a clean JSON file in the
 * historical shape that `lib/leagueCompute.client.js` already consumes.
 *
 * Key correctness rules (matches project policy):
 *   1. Team-total score precedence:
 *        a. `entry.custom_points` (commissioner manual override) when non-null
 *        b. Sum of `starters_points` (zip with `starters` by index)
 *        c. Fallback to `entry.points`
 *   2. `player_points` is NEVER written to the JSON — that field includes
 *      raw unselected games and would corrupt scores for managers using
 *      Sleeper's manual game-selection feature.
 *   3. Per-player figures (starters_points) are written exactly as Sleeper
 *      returns them — those reflect the owner's game selection natively.
 *
 * Usage:
 *   node scripts/regenerate-season-matchups.mjs            # 2022, 2023, 2024, 2025
 *   node scripts/regenerate-season-matchups.mjs 2024 2025  # only the years given
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_DIR = path.resolve(__dirname, '..', 'static', 'season_matchups');

const BASE = 'https://api.sleeper.app/v1';
const ANCHOR_LEAGUE_ID = '1219816671624048640'; // current-season anchor (matches BASE_LEAGUE_ID in sleeperClient)
const DEFAULT_YEARS = ['2022', '2023', '2024', '2025'];

function safeNum(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/**
 * Score a single Sleeper matchup entry. See file header for precedence.
 */
function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  if (entry.custom_points != null) {
    const cp = safeNum(entry.custom_points);
    if (isFinite(cp)) return Math.round(cp * 100) / 100;
  }
  if (Array.isArray(entry.starters_points) && entry.starters_points.length) {
    let s = 0;
    for (const v of entry.starters_points) s += safeNum(v);
    return Math.round(s * 100) / 100;
  }
  const fallback = safeNum(entry.points ?? entry.points_for ?? entry.pts ?? entry.score ?? 0);
  return Math.round(fallback * 100) / 100;
}

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'accept': 'application/json' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
}

async function getLeague(leagueId) {
  return get(`${BASE}/league/${leagueId}`);
}

async function getRosters(leagueId) {
  const r = await get(`${BASE}/league/${leagueId}/rosters`);
  return Array.isArray(r) ? r : [];
}

async function getUsers(leagueId) {
  const r = await get(`${BASE}/league/${leagueId}/users`);
  return Array.isArray(r) ? r : [];
}

async function getMatchupsForWeek(leagueId, week) {
  const r = await get(`${BASE}/league/${leagueId}/matchups/${week}`);
  return Array.isArray(r) ? r : [];
}

/**
 * Build a `rosterId → { team_name, owner_name }` map. Team-name resolution
 * mirrors the browser client: prefer the user's `metadata.team_name`, then
 * roster `settings.team_name`, then `display_name`, last-resort the username.
 */
function buildRosterMap(rosters, users) {
  const byOwner = {};
  for (const u of users) {
    if (u && u.user_id) byOwner[String(u.user_id)] = u;
  }
  const map = {};
  for (const r of rosters) {
    const rid = String(r.roster_id);
    const u = r.owner_id ? byOwner[String(r.owner_id)] || {} : {};
    const teamName =
      (u.metadata && (u.metadata.team_name || u.metadata.teamName)) ||
      (r.settings && r.settings.team_name) ||
      u.display_name ||
      u.username ||
      `Roster ${rid}`;
    const ownerName = u.display_name || u.username || null;
    map[rid] = { team_name: teamName, owner_name: ownerName };
  }
  return map;
}

/**
 * Walk previous_league_id backwards to enumerate every season. Returns
 * `[{ league_id, season, name, status }]` sorted newest → oldest.
 */
async function walkSeasons(anchorLeagueId, maxSteps = 50) {
  const seasons = [];
  let curr = anchorLeagueId;
  let steps = 0;
  while (curr && steps < maxSteps) {
    const lg = await getLeague(curr);
    if (!lg) break;
    seasons.push({
      league_id: String(lg.league_id || curr),
      season: lg.season ? String(lg.season) : null,
      name: lg.name || null,
      status: lg.status || null,
      playoff_week_start: lg.settings && lg.settings.playoff_week_start ? Number(lg.settings.playoff_week_start) : null
    });
    curr = lg.previous_league_id ? String(lg.previous_league_id) : null;
    steps += 1;
  }
  return seasons;
}

/**
 * For one Sleeper league, fetch every week of matchups and shape them
 * into the JSON layout `leagueCompute.client.js → computeStandingsForLeague`
 * already consumes (the existing `static/season_matchups/{year}.json` shape).
 */
async function generateSeasonJson(season) {
  const { league_id, season: year } = season;
  const [rosters, users] = await Promise.all([getRosters(league_id), getUsers(league_id)]);
  const rosterMap = buildRosterMap(rosters, users);

  let playoffStart = season.playoff_week_start;
  if (!isFinite(playoffStart) || playoffStart < 1) playoffStart = 15;

  const weeks = {};
  let totalMatchups = 0;
  let overridesSeen = 0;

  for (let week = 1; week <= 22; week++) {
    let raw = null;
    try { raw = await getMatchupsForWeek(league_id, week); } catch (_) { continue; }
    if (!raw || !raw.length) continue;

    const byMatch = {};
    for (let i = 0; i < raw.length; i++) {
      const m = raw[i];
      if (m && m.custom_points != null) overridesSeen += 1;
      const mid = m.matchup_id ?? m.matchupId ?? ('auto' + i);
      if (!byMatch[mid]) byMatch[mid] = [];
      byMatch[mid].push(m);
    }

    const weekRows = [];
    for (const [mid, arr] of Object.entries(byMatch)) {
      if (arr.length !== 2) continue;
      const [a, b] = arr;
      const aId = String(a.roster_id ?? '');
      const bId = String(b.roster_id ?? '');
      const aMeta = rosterMap[aId] || {};
      const bMeta = rosterMap[bId] || {};
      const teamA = {
        rosterId: aId,
        name: aMeta.team_name ?? null,
        ownerName: aMeta.owner_name ?? null,
        starters: Array.isArray(a.starters) ? a.starters : [],
        starters_points: Array.isArray(a.starters_points) ? a.starters_points : []
      };
      const teamB = {
        rosterId: bId,
        name: bMeta.team_name ?? null,
        ownerName: bMeta.owner_name ?? null,
        starters: Array.isArray(b.starters) ? b.starters : [],
        starters_points: Array.isArray(b.starters_points) ? b.starters_points : []
      };
      // Preserve the commish manual-override field on every entry that has
      // one. Downstream consumers (see `computeStandingsForLeague`) honor
      // this exactly the same way as live Sleeper data.
      if (a.custom_points != null) teamA.custom_points = safeNum(a.custom_points);
      if (b.custom_points != null) teamB.custom_points = safeNum(b.custom_points);
      weekRows.push({
        matchup_id: Number(mid) || mid,
        week,
        teamA,
        teamAScore: computeParticipantPoints(a),
        teamB,
        teamBScore: computeParticipantPoints(b)
      });
    }
    if (weekRows.length) {
      weeks[String(week)] = weekRows;
      totalMatchups += weekRows.length;
    }
  }

  // Final payload — matches existing JSON shape exactly.
  const payload = {
    playoff_week_start: playoffStart,
    ...weeks
  };
  return { year, payload, totalMatchups, overridesSeen, weeks: Object.keys(weeks).length };
}

async function main() {
  const argv = process.argv.slice(2);
  const requestedYears = argv.length ? argv : DEFAULT_YEARS;
  console.log(`▶︎ Regenerating season matchups for: ${requestedYears.join(', ')}`);
  console.log(`  Anchor league: ${ANCHOR_LEAGUE_ID}`);
  console.log(`  Output dir   : ${STATIC_DIR}`);

  const seasons = await walkSeasons(ANCHOR_LEAGUE_ID);
  console.log(`\n  Discovered ${seasons.length} season(s) in the league chain:`);
  for (const s of seasons) {
    console.log(`    · ${s.season ?? '?'}  league_id=${s.league_id}  playoff_start=${s.playoff_week_start ?? '?'}  status=${s.status ?? '?'}`);
  }

  await fs.mkdir(STATIC_DIR, { recursive: true });

  let written = 0;
  for (const yr of requestedYears) {
    const season = seasons.find((s) => String(s.season) === String(yr));
    if (!season) {
      console.log(`\n  ⚠︎  ${yr}: no matching league in chain — skipping.`);
      continue;
    }
    console.log(`\n  → ${yr}  (league ${season.league_id})`);
    const result = await generateSeasonJson(season);
    const outPath = path.join(STATIC_DIR, `${yr}.json`);
    await fs.writeFile(outPath, JSON.stringify(result.payload, null, 2) + '\n', 'utf8');
    const size = (await fs.stat(outPath)).size;
    console.log(`    ✓ wrote ${outPath}`);
    console.log(`      weeks=${result.weeks}  matchups=${result.totalMatchups}  commish_overrides=${result.overridesSeen}  size=${(size / 1024).toFixed(1)}KB`);
    written += 1;
  }

  console.log(`\n✔ done · ${written} file(s) written.`);
}

main().catch((e) => {
  console.error('✗ regen failed:', e);
  process.exit(1);
});
