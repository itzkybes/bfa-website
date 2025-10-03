// src/routes/honor-hall/+page.server.js
import { error } from '@sveltejs/kit';

const API_BASE = 'https://api.sleeper.app/v1';
const FALLBACK_LEAGUE_ID = '1219816671624048640';
const BASE_LEAGUE_ID = process.env.BASE_LEAGUE_ID || FALLBACK_LEAGUE_ID;

function numeric(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ fetch, url, setHeaders }) {
  // short cache for edge
  setHeaders?.({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];

  try {
    if (!BASE_LEAGUE_ID) {
      messages.push('BASE_LEAGUE_ID not set in environment — cannot fetch seasons.');
      return { seasons: [], seasonsMeta: [], selectedSeason: null, selectedLeagueId: null, rounds: {}, messages };
    }

    // 1) Build seasons chain by walking previous_league_id (same approach as matchups)
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
      return { seasons: [], seasonsMeta: [], selectedSeason: null, selectedLeagueId: null, rounds: {}, messages };
    }

    // 2) Determine selected season and league_id (season param can be season or league_id)
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

    // 3) Get league meta to determine playoff start week
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

    // 4) Fetch rosters & users for selected league (to resolve names/avatars)
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

    // rosterId -> info
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

    // 5) Decide playoff weeks to fetch scores for (playoffStart or fallback to last 3 weeks)
    const MAX_WEEKS_FALLBACK = 25;
    const startWeek = playoffStart && playoffStart >= 1 ? playoffStart : Math.max(1, MAX_WEEKS_FALLBACK - 2);
    const playoffWeeks = [startWeek, startWeek + 1, startWeek + 2];

    // 6) Fetch weekly matchups for each playoff week to extract matchups + points
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

    // 7) Build match rows for each week by grouping by matchup_id (like matchups tab)
    // We'll produce rounds[1], rounds[2], rounds[3] corresponding to playoffWeeks indices
    const rounds = {}; // {1: [...], 2: [...], 3: [...]}
    for (let idx = 0; idx < playoffWeeks.length; idx++) {
      const wk = playoffWeeks[idx];
      const rows = [];
      const raw = weekMatchups[wk] || [];

      // group entries by matchup id; Sleeper returns one entry per roster in matchups
      const byMatch = {};
      for (let i = 0; i < raw.length; i++) {
        const e = raw[i];
        const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
        const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
        if (!byMatch[key]) byMatch[key] = [];
        byMatch[key].push(e);
      }

      // convert groups into row objects (teamA vs teamB or multi)
      for (const key of Object.keys(byMatch)) {
        const entries = byMatch[key];
        if (!entries || entries.length === 0) continue;

        // BYE (single participant)
        if (entries.length === 1) {
          const a = entries[0];
          const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
          const aMeta = rosterMap.get(aId) || {};
          const aName = aMeta.display_name || aMeta.owner_display || ('Roster ' + aId);
          const aAvatar = aMeta.avatar || null;
          const aPts = numeric(a.points ?? a.points_for ?? a.pts ?? null);

          rows.push({
            matchup_id: key,
            week: wk,
            round: idx + 1,
            teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts },
            teamB: { rosterId: null, name: 'BYE', avatar: null, points: null },
            participantsCount: 1
          });
          continue;
        }

        // exactly 2 participants -> standard head-to-head
        if (entries.length === 2) {
          const a = entries[0];
          const b = entries[1];
          const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
          const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
          const aMeta = rosterMap.get(aId) || {};
          const bMeta = rosterMap.get(bId) || {};
          const aName = aMeta.display_name || aMeta.owner_display || ('Roster ' + aId);
          const bName = bMeta.display_name || bMeta.owner_display || ('Roster ' + bId);
          const aAvatar = aMeta.avatar || null;
          const bAvatar = bMeta.avatar || null;
          const aPts = numeric(a.points ?? a.points_for ?? a.pts ?? null);
          const bPts = numeric(b.points ?? b.points_for ?? b.pts ?? null);

          rows.push({
            matchup_id: key,
            week: wk,
            round: idx + 1,
            teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts },
            teamB: { rosterId: bId, name: bName, avatar: bAvatar, points: bPts },
            participantsCount: 2
          });
        } else {
          // multi-participant matchup -- aggregate
          const participants = entries.map(ent => {
            const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
            const meta = rosterMap.get(pid) || {};
            return {
              rosterId: pid,
              name: meta.display_name || meta.owner_display || ('Roster ' + pid),
              avatar: meta.avatar || null,
              points: numeric(ent.points ?? ent.points_for ?? ent.pts ?? 0)
            };
          });
          const combinedLabel = participants.map(p => p.name).join(' / ');
          rows.push({
            matchup_id: key,
            week: wk,
            round: idx + 1,
            combinedParticipants: participants,
            combinedLabel,
            participantsCount: participants.length
          });
        }
      }

      // attach to rounds (1-based index)
      rounds[idx + 1] = rows;
    }

    // 8) Sort rounds entries (optional)
    for (const k of Object.keys(rounds)) {
      rounds[k].sort((x, y) => {
        const ax = (x.teamA && x.teamA.points != null) ? x.teamA.points : 0;
        const by = (y.teamA && y.teamA.points != null) ? y.teamA.points : 0;
        return by - ax;
      });
    }

    // seasons list for dropdown (matchups tab format)
    const seasons = seasonsMeta.map(s => ({ league_id: s.league_id, season: s.season, name: s.name }));

    return {
      seasons,
      seasonsMeta,
      selectedSeason,
      selectedLeagueId,
      rounds,
      messages
    };

  } catch (err) {
    const msg = `Failed to load playoff data: ${err?.message ?? err}`;
    console.error(msg, err);
    return {
      seasons: [],
      seasonsMeta: [],
      selectedSeason: null,
      selectedLeagueId: null,
      rounds: {},
      messages: [msg]
    };
  }
}
