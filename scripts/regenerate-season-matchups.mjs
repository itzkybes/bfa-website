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
 *   node scripts/regenerate-season-matchups.mjs            # every completed season in the chain
 *   node scripts/regenerate-season-matchups.mjs 2024 2025  # only the years given
 *
 * The "current" in-progress season is intentionally skipped by default. While
 * the league is live, `computeStandingsForLeague` always reads the Sleeper API
 * so newly-played games show up immediately. Once the season ends, re-run this
 * script (or pass the year explicitly) to lock the snapshot in.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
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
 *
 * Playoff window: this league plays a **4-week** playoff every season, with
 * the LAST 2 weeks merged into a single championship matchup (owners pick one
 * game each of those weeks; total score = sum of the two starters_points
 * arrays). The Sleeper API only records `matchup_id` for the first week of
 * the merged final, so we walk forward one week and synthesize the same
 * matchup_id for the second half so downstream code can pair the rounds.
 */
async function generateSeasonJson(season) {
  const { league_id, season: year } = season;
  const [rosters, users] = await Promise.all([getRosters(league_id), getUsers(league_id)]);
  const rosterMap = buildRosterMap(rosters, users);

  let playoffStart = season.playoff_week_start;
  if (!isFinite(playoffStart) || playoffStart < 1) playoffStart = 15;
  // League policy: playoffs are always 4 weeks (2 single-elim rounds + a
  // 2-week merged championship final). `playoff_week_end` is written to the
  // JSON so the consumers don't have to assume.
  const playoffEnd = playoffStart + 3;
  const finalsWeek1 = playoffStart + 2;   // first half of the merged final
  const finalsWeek2 = playoffStart + 3;   // second half — usually no matchup_id from Sleeper

  // We need to peek at the previous week (the first half of finals) to know
  // how the championship was paired. Build a roster_id → matchup_id index
  // for that week first, then apply it to finalsWeek2 entries that come
  // back without their own matchup_id.
  let finalsPairingByRoster = {};

  const weeks = {};
  let totalMatchups = 0;
  let overridesSeen = 0;
  let finalsSynthesized = 0;

  // Walk through every plausible playoff week (extend to 25 to cover any
  // edge cases). We loop in order so the finals-week1 mapping is built
  // before finals-week2 is processed.
  for (let week = 1; week <= 25; week++) {
    let raw = null;
    try { raw = await getMatchupsForWeek(league_id, week); } catch (_) { continue; }
    if (!raw || !raw.length) continue;

    // For the first half of the merged final, snapshot its roster→matchup_id
    // pairing so the second half can inherit it.
    if (week === finalsWeek1) {
      finalsPairingByRoster = {};
      for (const e of raw) {
        if (e && e.roster_id != null && e.matchup_id != null) {
          finalsPairingByRoster[String(e.roster_id)] = e.matchup_id;
        }
      }
    }

    const byMatch = {};
    for (let i = 0; i < raw.length; i++) {
      const m = raw[i];
      if (m && m.custom_points != null) overridesSeen += 1;
      // Synthesize matchup_id for the merged-final's second half. Sleeper
      // doesn't pair the W2 entries (matchup_id=null) — we inherit pairing
      // from W1 so downstream consumers can show the two halves as one
      // championship rendered across two weeks.
      let mid = m.matchup_id ?? m.matchupId ?? null;
      if (mid == null && week === finalsWeek2 && m && m.roster_id != null) {
        const inherited = finalsPairingByRoster[String(m.roster_id)];
        if (inherited != null) {
          mid = inherited;
          finalsSynthesized += 1;
        }
      }
      if (mid == null) mid = 'auto' + i;
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
      if (a.custom_points != null) teamA.custom_points = safeNum(a.custom_points);
      if (b.custom_points != null) teamB.custom_points = safeNum(b.custom_points);
      const isFinalsLeg2 = (week === finalsWeek2);
      weekRows.push({
        matchup_id: Number(mid) || mid,
        week,
        // Mark championship halves explicitly so consumers can recognise the
        // merged-final shape without re-deriving it.
        is_finals_leg1: week === finalsWeek1 || undefined,
        is_finals_leg2: isFinalsLeg2 || undefined,
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

  // Final payload — matches existing JSON shape, now with playoff_week_end.
  const payload = {
    playoff_week_start: playoffStart,
    playoff_week_end: playoffEnd,
    ...weeks
  };
  return { year, payload, totalMatchups, overridesSeen, weeks: Object.keys(weeks).length, finalsSynthesized };
}

async function main() {
  const argv = process.argv.slice(2);
  console.log(`▶︎ Regenerating season matchups`);
  console.log(`  Anchor league: ${ANCHOR_LEAGUE_ID}`);
  console.log(`  Output dir   : ${STATIC_DIR}`);

  const seasons = await walkSeasons(ANCHOR_LEAGUE_ID);
  console.log(`\n  Discovered ${seasons.length} season(s) in the league chain:`);
  for (const s of seasons) {
    console.log(`    · ${s.season ?? '?'}  league_id=${s.league_id}  playoff_start=${s.playoff_week_start ?? '?'}  status=${s.status ?? '?'}`);
  }

  // Default = every COMPLETED season. The current in-progress season is
  // intentionally skipped — we want fresh API data while the league is live.
  const requestedYears = argv.length
    ? argv
    : seasons.filter((s) => s.status === 'complete' && s.season).map((s) => String(s.season));

  if (!requestedYears.length) {
    console.log(`\n  ⚠︎  No completed seasons found in the chain. Pass year(s) explicitly to override (e.g. node scripts/regenerate-season-matchups.mjs 2026).`);
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
    console.log(`      weeks=${result.weeks}  matchups=${result.totalMatchups}  commish_overrides=${result.overridesSeen}  finals_synthesized=${result.finalsSynthesized}  size=${(size / 1024).toFixed(1)}KB`);
    written += 1;
  }

  console.log(`\n✔ done · ${written} file(s) written.`);
}

main().catch((e) => {
  console.error('✗ regen failed:', e);
  process.exit(1);
});
