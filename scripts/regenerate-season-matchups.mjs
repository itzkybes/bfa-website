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
 *   1. Team totals are derived ONLY from selected starters' `starters_points`.
 *      No whole-roster or top-level score fallback is permitted.
 *   2. Existing `teamAScore` / `teamBScore` values are preserved as manual
 *      historical overrides. New season files omit these fields by default.
 *   2. `player_points` is NEVER written to the JSON — that field includes
 *      raw unselected games and would corrupt scores for managers using
 *      Sleeper's manual game-selection feature.
 *   3. Per-player figures (starters_points) are written exactly as Sleeper
 *      returns them — those reflect the owner's game selection natively.
 *
 * Usage:
 *   node scripts/regenerate-season-matchups.mjs            # every completed season in the chain
 *   node scripts/regenerate-season-matchups.mjs 2024 2025  # only the years given
 *
 * Every discovered season, including the in-progress season, is written to its
 * own JSON file. Re-run after completed scoring weeks to refresh snapshots.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getSeasonFormat } from '../src/lib/compute/seasonFormat.js';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_DIR = path.resolve(__dirname, '..', 'static', 'season_matchups');

const BASE = 'https://api.sleeper.app/v1';
const ANCHOR_LEAGUE_ID = '1219816671624048640'; // current-season anchor (matches BASE_LEAGUE_ID in sleeperClient)

function safeNum(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/**
 * Score a single Sleeper matchup entry. See file header for precedence.
 */
function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  const starters = Array.isArray(entry.starters) ? entry.starters : [];
  const points = Array.isArray(entry.starters_points) ? entry.starters_points : [];
  if (!starters.length || points.length !== starters.length) return 0;
  return Math.round(points.reduce((sum, value) => sum + safeNum(value), 0) * 100) / 100;
}

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
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
      playoff_week_start:
        lg.settings && lg.settings.playoff_week_start
          ? Number(lg.settings.playoff_week_start)
          : null,
      playoff_teams:
        lg.settings && lg.settings.playoff_teams
          ? Number(lg.settings.playoff_teams)
          : null,
    });
    curr = lg.previous_league_id ? String(lg.previous_league_id) : null;
    steps += 1;
  }
  const mainLeague = seasons[0];
  // Discover future seasons through Sleeper's user-leagues endpoint.
  let seedUserIds = [];
  try {
    const anchorUsers = await getUsers(anchorLeagueId);
    seedUserIds = anchorUsers.map((u) => u?.user_id).filter(Boolean).map(String).slice(0, 4);
  } catch (_) {}
  if (seedUserIds.length) {
    const startYear = Number(mainLeague.season) || new Date().getUTCFullYear();
    const maxYear = Math.max(startYear, new Date().getUTCFullYear()) + 5;
    let latestId = String(mainLeague.league_id || anchorLeagueId);
    for (let year = startYear + 1; year <= maxYear; year++) {
      const lists = await Promise.all(seedUserIds.map((uid) =>
        get(`${BASE}/user/${encodeURIComponent(uid)}/leagues/nba/${year}`).catch(() => [])
      ));
      const candidates = new Map();
      for (const list of lists) for (const league of list || []) if (league?.league_id) candidates.set(String(league.league_id), league);
      const next = [...candidates.values()].find((league) => String(league.previous_league_id || '') === latestId);
      if (!next) break;
      const discovered = await getLeague(String(next.league_id));
      if (!discovered) break;
      seasons.push({
        league_id: String(discovered.league_id || next.league_id),
        season: String(discovered.season || year),
        name: discovered.name || null,
        status: discovered.status || null,
        playoff_week_start: Number(discovered.settings?.playoff_week_start) || null,
        playoff_teams: Number(discovered.settings?.playoff_teams) || null,
      });
      latestId = String(discovered.league_id || next.league_id);
    }
  }
  const unique = new Map();
  for (const item of seasons) unique.set(String(item.season), item);
  seasons.splice(0, seasons.length, ...[...unique.values()].sort((a, b) => Number(a.season) - Number(b.season)));
  return seasons;
}

/** Fetch each weekly matchup. Playoff rules come from the shared season format. */
async function generateSeasonJson(season) {
  const { league_id, season: year } = season;
  let previous = {};
  try {
    previous = JSON.parse(await fs.readFile(path.join(STATIC_DIR, `${year}.json`), 'utf8'));
  } catch (_) {
    // No prior snapshot means there are no manual overrides to retain.
  }
  const [rosters, users] = await Promise.all([getRosters(league_id), getUsers(league_id)]);
  const rosterMap = buildRosterMap(rosters, users);
  const format = getSeasonFormat(year, { playoff_week_start: season.playoff_week_start, playoff_teams: season.playoff_teams });
  if (!format) throw new Error(`No BFA season format or valid Sleeper playoff settings found for ${year}`);
  const weeks = {};
  let totalMatchups = 0;
  for (let week = 1; week <= 25; week++) {
    let raw = null;
    try { raw = await getMatchupsForWeek(league_id, week); } catch (_) { continue; }
    if (!Array.isArray(raw) || !raw.length) continue;
    const byMatch = {};
    for (const entry of raw) {
      const matchupId = entry.matchup_id ?? entry.matchupId ?? null;
      if (matchupId == null) continue;
      if (!byMatch[matchupId]) byMatch[matchupId] = [];
      byMatch[matchupId].push(entry);
    }
    const weekRows = [];
    for (const [mid, entries] of Object.entries(byMatch)) {
      if (entries.length !== 2) continue;
      const [a, b] = entries;
      const aId = String(a.roster_id ?? ''), bId = String(b.roster_id ?? '');
      const aMeta = rosterMap[aId] || {}, bMeta = rosterMap[bId] || {};
      const teamA = { rosterId: aId, name: aMeta.team_name ?? null, ownerName: aMeta.owner_name ?? null, starters: Array.isArray(a.starters) ? a.starters : [], starters_points: Array.isArray(a.starters_points) ? a.starters_points : [] };
      const teamB = { rosterId: bId, name: bMeta.team_name ?? null, ownerName: bMeta.owner_name ?? null, starters: Array.isArray(b.starters) ? b.starters : [], starters_points: Array.isArray(b.starters_points) ? b.starters_points : [] };
      const row = { matchup_id: Number(mid) || mid, week, teamA, teamB };
      const previousRow = (previous[String(week)] || []).find(
        (candidate) => String(candidate.matchup_id) === String(row.matchup_id)
      );
      // Preserve manually pinned historical totals; new rows calculate from starters.
      if (previousRow && Object.prototype.hasOwnProperty.call(previousRow, 'teamAScore')) row.teamAScore = safeNum(previousRow.teamAScore);
      if (previousRow && Object.prototype.hasOwnProperty.call(previousRow, 'teamBScore')) row.teamBScore = safeNum(previousRow.teamBScore);
      weekRows.push(row);
    }
    if (weekRows.length) { weeks[String(week)] = weekRows; totalMatchups += weekRows.length; }
  }
  const payload = { playoff_week_start: format.playoffStart, playoff_week_end: format.playoffEnd, playoff_teams: format.playoffTeams, toilet_bowl_teams: format.toiletBowlTeams, ...weeks };
  return { year, payload, totalMatchups, weeks: Object.keys(weeks).length };
}
async function main() {
  const argv = process.argv.slice(2);
  console.log(`▶︎ Regenerating season matchups`);
  console.log(`  Anchor league: ${ANCHOR_LEAGUE_ID}`);
  console.log(`  Output dir   : ${STATIC_DIR}`);

  const seasons = await walkSeasons(ANCHOR_LEAGUE_ID);
  console.log(`\n  Discovered ${seasons.length} season(s) in the league chain:`);
  for (const s of seasons) {
    console.log(
      `    · ${s.season ?? '?'}  league_id=${s.league_id}  playoff_start=${getSeasonFormat(s.season, s)?.playoffStart ?? '?'}  status=${s.status ?? '?'}`
    );
  }

  // Default = every discovered season, including the current season.
  const requestedYears = argv.length
    ? argv
    : seasons.filter((s) => s.season).map((s) => String(s.season));

  if (!requestedYears.length) {
    console.log(
      `\n  ⚠︎  No completed seasons found in the chain. Pass year(s) explicitly to override (e.g. node scripts/regenerate-season-matchups.mjs 2026).`
    );
    return;
  }
  console.log(`\n  Will write: ${requestedYears.join(', ')}`);

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
    console.log(
      `      weeks=${result.weeks}  matchups=${result.totalMatchups}  size=${(size / 1024).toFixed(1)}KB`
    );
    written += 1;
  }

  console.log(`\n✔ done · ${written} file(s) written.`);
}

main().catch((e) => {
  console.error('✗ regen failed:', e);
  process.exit(1);
});
