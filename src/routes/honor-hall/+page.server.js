// src/routes/honor-hall/+page.server.js
import { error } from '@sveltejs/kit';

const API_BASE = 'https://api.sleeper.app/v1';

// Use the env var if present, otherwise default to the league id you provided
const BASE_LEAGUE_ID = process.env.BASE_LEAGUE_ID || '1219816671624048640';

function numeric(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// resolveRosterId: slot can be number, null, or { w: matchId } / { l: matchId }
// bracketByMatch is a Map(matchId -> matchObj)
function resolveRosterId(slot, bracketByMatch) {
  if (!slot) return null;

  // direct numeric roster id (string or number)
  if (typeof slot === 'number' || typeof slot === 'string') {
    const n = numeric(slot);
    if (n !== null) return n;
  }

  // slot may be object like { w: 3 } or { l: 2 }
  if (typeof slot === 'object') {
    if (slot.w != null) {
      const match = bracketByMatch.get(slot.w);
      if (!match) return null;
      // If that match already has a winner field, use it
      if (match.w != null) return numeric(match.w);
      // otherwise try to resolve t1/t2 recursively
      const r1 = resolveRosterId(match.t1 ?? match.t1_from, bracketByMatch);
      if (r1 != null) return r1;
      return resolveRosterId(match.t2 ?? match.t2_from, bracketByMatch);
    }
    if (slot.l != null) {
      const match = bracketByMatch.get(slot.l);
      if (!match) return null;
      if (match.l != null) return numeric(match.l);
      // can't reliably infer loser without winner info — attempt to resolve t1/t2 but may return null
      const r1 = resolveRosterId(match.t1 ?? match.t1_from, bracketByMatch);
      const r2 = resolveRosterId(match.t2 ?? match.t2_from, bracketByMatch);
      // if only one side resolves, return that; otherwise null (can't infer)
      if (r1 != null && r2 == null) return r1;
      if (r2 != null && r1 == null) return r2;
      return null;
    }
  }

  return null;
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ fetch, url, setHeaders }) {
  // cache short time at edge
  setHeaders?.({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];
  try {
    if (!BASE_LEAGUE_ID) {
      messages.push('BASE_LEAGUE_ID not set in environment — cannot fetch seasons.');
      return { seasons: [], seasonsMeta: [], selectedSeason: null, rounds: {}, messages };
    }

    // ----------------------------------------------------------------------------
    // 1) Build seasons chain by walking previous_league_id (same approach as matchups)
    // ----------------------------------------------------------------------------
    const seasonsMeta = [];
    let curr = String(BASE_LEAGUE_ID);
    let steps = 0;
    while (curr && steps < 50) {
      steps++;
      try {
        const res = await fetch(`${API_BASE}/league/${curr}`);
        if (!res.ok) {
          messages.push(`Failed fetching league ${curr}: ${res.status}`);
          break;
        }
        const league = await res.json();
        seasonsMeta.push({
          league_id: String(league.league_id),
          season: league.season ?? String(league.season),
          name: league.name ?? null
        });
        curr = league.previous_league_id ? String(league.previous_league_id) : null;
      } catch (e) {
        messages.push(`Error fetching league ${curr}: ${e?.message ?? e}`);
        break;
      }
    }

    if (!seasonsMeta.length) {
      messages.push('No seasons discovered from BASE_LEAGUE_ID.');
      return { seasons: [], seasonsMeta: [], selectedSeason: null, rounds: {}, messages };
    }

    // ----------------------------------------------------------------------------
    // 2) Determine selected season/league
    // ----------------------------------------------------------------------------
    const seasonParam = url.searchParams.get('season') ?? seasonsMeta[0].season;
    let selectedLeagueId = null;
    let selectedSeason = seasonParam;
    for (const s of seasonsMeta) {
      if (String(s.season) === String(seasonParam) || String(s.league_id) === String(seasonParam)) {
        selectedLeagueId = s.league_id;
        selectedSeason = s.season ?? s.season;
        break;
      }
    }
    if (!selectedLeagueId) {
      selectedLeagueId = seasonsMeta[0].league_id;
      selectedSeason = seasonsMeta[0].season;
    }

    // ----------------------------------------------------------------------------
    // 3) Get league metadata (to determine playoff start week if available)
    // ----------------------------------------------------------------------------
    let leagueMeta = null;
    try {
      const lm = await fetch(`${API_BASE}/league/${selectedLeagueId}`);
      if (lm.ok) leagueMeta = await lm.json();
      else messages.push(`Failed to fetch league meta for ${selectedLeagueId}: ${lm.status}`);
    } catch (e) {
      messages.push(`Failed to fetch league meta for ${selectedLeagueId}: ${e?.message ?? e}`);
    }

    const playoffStart = numeric(
      leagueMeta?.settings?.playoff_week_start ??
      leagueMeta?.settings?.playoffStartWeek ??
      leagueMeta?.playoff_week_start
    ) ?? null;

    // ----------------------------------------------------------------------------
    // 4) Fetch winners_bracket for the selected league (structure)
    // ----------------------------------------------------------------------------
    let bracket = [];
    try {
      const bres = await fetch(`${API_BASE}/league/${selectedLeagueId}/winners_bracket`);
      if (bres.ok) bracket = await bres.json();
      else messages.push(`Failed to fetch winners_bracket: ${bres.status}`);
    } catch (e) {
      messages.push(`Error fetching winners_bracket: ${e?.message ?? e}`);
    }

    // ----------------------------------------------------------------------------
    // 5) Fetch rosters & users for selected league (to resolve names/avatars)
    // ----------------------------------------------------------------------------
    let rosters = [], users = [];
    try {
      const [rs, us] = await Promise.all([
        fetch(`${API_BASE}/league/${selectedLeagueId}/rosters`),
        fetch(`${API_BASE}/league/${selectedLeagueId}/users`)
      ]);
      if (rs.ok) rosters = await rs.json(); else messages.push(`Failed rosters: ${rs.status}`);
      if (us.ok) users = await us.json(); else messages.push(`Failed users: ${us.status}`);
    } catch (e) {
      messages.push(`Error fetching rosters/users: ${e?.message ?? e}`);
    }

    const rosterMap = new Map();
    for (const r of rosters || []) {
      const user = (users || []).find(u => String(u.user_id) === String(r.owner_id));
      rosterMap.set(String(r.roster_id), {
        roster_id: String(r.roster_id),
        display_name: user?.metadata?.team_name || user?.display_name || `Roster ${r.roster_id}`,
        avatar: user?.avatar ?? null,
        owner_display: user?.display_name ?? null
      });
    }

    // ----------------------------------------------------------------------------
    // 6) Build bracketByMatch map for resolving {w:..} / {l:..}
    // ----------------------------------------------------------------------------
    const bracketByMatch = new Map();
    for (const m of bracket || []) bracketByMatch.set(m.m, m);

    // ----------------------------------------------------------------------------
    // 7) Decide which weeks to fetch for scores (playoffStart or fallback)
    // ----------------------------------------------------------------------------
    const MAX_WEEKS_FALLBACK = 25;
    const startWeek = playoffStart && playoffStart >= 1 ? playoffStart : Math.max(1, MAX_WEEKS_FALLBACK - 2);
    const playoffWeeks = [startWeek, startWeek + 1, startWeek + 2];

    // ----------------------------------------------------------------------------
    // 8) Fetch weekly matchups for each playoff week to extract points
    // ----------------------------------------------------------------------------
    const weekMatchups = {};
    for (const wk of playoffWeeks) {
      try {
        const r = await fetch(`${API_BASE}/league/${selectedLeagueId}/matchups/${wk}`);
        weekMatchups[wk] = r.ok ? await r.json() : [];
        if (!r.ok) messages.push(`Matchups ${wk} fetch failed: ${r.status}`);
      } catch (e) {
        messages.push(`Error fetching matchups for week ${wk}: ${e?.message ?? e}`);
        weekMatchups[wk] = [];
      }
    }

    const pointsLookup = {};
    for (const wk of Object.keys(weekMatchups)) {
      const arr = weekMatchups[wk] || [];
      for (const ent of arr) {
        const rid = String(ent.roster_id ?? ent.rosterId ?? ent.rosterId);
        pointsLookup[`${wk}_${rid}`] = ent.points ?? ent.points_for ?? ent.pts ?? null;
      }
    }

    // ----------------------------------------------------------------------------
    // 9) Group bracket matches by round and enrich with roster info + scores
    // ----------------------------------------------------------------------------
    const rounds = {};
    for (const m of bracket || []) {
      const rnum = Number(m.r ?? 0);
      if (!rounds[rnum]) rounds[rnum] = [];

      const t1_roster = resolveRosterId(m.t1 ?? m.t1_from, bracketByMatch);
      const t2_roster = resolveRosterId(m.t2 ?? m.t2_from, bracketByMatch);

      const t1_key = t1_roster != null ? String(t1_roster) : null;
      const t2_key = t2_roster != null ? String(t2_roster) : null;

      const weekForRound = startWeek + (rnum - 1);
      const t1_points = t1_key ? (pointsLookup[`${weekForRound}_${t1_key}`] ?? null) : null;
      const t2_points = t2_key ? (pointsLookup[`${weekForRound}_${t2_key}`] ?? null) : null;

      rounds[rnum].push({
        match: m.m,
        round: rnum,
        week: weekForRound,
        t1: t1_key ? (rosterMap.get(t1_key) ?? { roster_id: t1_key, display_name: `Roster ${t1_key}` }) : null,
        t2: t2_key ? (rosterMap.get(t2_key) ?? { roster_id: t2_key, display_name: `Roster ${t2_key}` }) : null,
        t1_points,
        t2_points,
        winner_roster_id: m.w != null ? String(m.w) : null,
        raw: m
      });
    }

    const sortedRounds = {};
    Object.keys(rounds).sort((a, b) => Number(a) - Number(b)).forEach(k => { sortedRounds[k] = rounds[k]; });

    const seasons = seasonsMeta.map(s => ({ league_id: s.league_id, season: s.season, name: s.name }));

    return {
      seasons,
      seasonsMeta,
      selectedSeason,
      selectedLeagueId,
      rounds: sortedRounds,
      messages
    };
  } catch (err) {
    const msg = `Failed to load playoff data: ${err?.message ?? err}`;
    console.error(msg, err);
    return {
      seasons: [],
      seasonsMeta: [],
      selectedSeason: null,
      rounds: {},
      messages: [msg]
    };
  }
}
