// src/routes/honor-hall/+page.server.js
import { error } from '@sveltejs/kit';

const API_BASE = 'https://api.sleeper.app/v1';
const FALLBACK_LEAGUE_ID = '1219816671624048640';
const BASE_LEAGUE_ID = process.env.BASE_LEAGUE_ID || FALLBACK_LEAGUE_ID;
const MAX_WEEKS = 25;

function numeric(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export async function load({ fetch, url, setHeaders }) {
  // short cache
  setHeaders?.({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];

  try {
    if (!BASE_LEAGUE_ID) {
      messages.push('BASE_LEAGUE_ID not set in environment — cannot fetch seasons.');
      return { seasons: [], seasonsMeta: [], selectedSeason: null, matchupsRows: [], standings: null, messages };
    }

    // --- 1) Walk previous_league_id chain to build seasons list (newest first)
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
      return { seasons: [], seasonsMeta: [], selectedSeason: null, matchupsRows: [], standings: null, messages };
    }

    // Sort newest -> oldest (seasonsMeta already newest-first because we started from base)
    // --- 2) Determine selected season
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

    // --- 3) Fetch league meta to determine playoff start week
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

    // --- 4) Fetch rosters & users to map roster -> display names and avatars
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

    // --- 5) Determine playoff weeks
    const startWeek = playoffStart && playoffStart >= 1 ? playoffStart : Math.max(1, MAX_WEEKS - 2);
    const playoffWeeks = [startWeek, startWeek + 1, startWeek + 2];

    // --- 6) Fetch matchups for playoff weeks
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

    // --- 7) Build points lookup `${week}_${rosterId}` -> points (for potential use)
    const pointsLookup = {};
    for (const wk of Object.keys(weekMatchups)) {
      const arr = weekMatchups[wk] || [];
      for (const ent of arr) {
        const rid = String(ent.roster_id ?? ent.rosterId ?? ent.rosterId ?? '');
        pointsLookup[`${wk}_${rid}`] = ent.points ?? ent.points_for ?? ent.pts ?? null;
      }
    }

    // --- 8) Convert weekly matchups into matchupsRows (one row per matchup group)
    const matchupsRows = [];
    for (let idx = 0; idx < playoffWeeks.length; idx++) {
      const wk = playoffWeeks[idx];
      const raw = weekMatchups[wk] || [];

      // group by matchup id (fallback to index-based key)
      const groups = new Map();
      for (let i = 0; i < raw.length; i++) {
        const ent = raw[i];
        const mid = ent.matchup_id ?? ent.matchupId ?? ent.matchup ?? null;
        const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ent);
      }

      for (const [key, entries] of groups.entries()) {
        if (!entries || entries.length === 0) continue;

        // BYE
        if (entries.length === 1) {
          const a = entries[0];
          const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknown');
          const aMeta = rosterMap.get(aId) || {};
          const aName = aMeta.display_name || aMeta.owner_display || ('Roster ' + aId);
          const aAvatar = aMeta.avatar || null;
          const aPts = numeric(a.points ?? a.points_for ?? a.pts ?? null);

          matchupsRows.push({
            matchup_id: key,
            season: selectedSeason,
            week: a.week ?? a.w ?? wk,
            round: idx + 1,
            participantsCount: 1,
            teamA: { rosterId: aId, name: aName, avatar: aAvatar, owner_display: aMeta.owner_display, points: aPts },
            teamB: null
          });
          continue;
        }

        // standard head-to-head (2 entries)
        if (entries.length === 2) {
          const a = entries[0];
          const b = entries[1];
          const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'a');
          const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'b');
          const aMeta = rosterMap.get(aId) || {};
          const bMeta = rosterMap.get(bId) || {};
          const aName = aMeta.display_name || aMeta.owner_display || ('Roster ' + aId);
          const bName = bMeta.display_name || bMeta.owner_display || ('Roster ' + bId);
          const aAvatar = aMeta.avatar || null;
          const bAvatar = bMeta.avatar || null;
          const aPts = numeric(a.points ?? a.points_for ?? a.pts ?? null);
          const bPts = numeric(b.points ?? b.points_for ?? b.pts ?? null);

          matchupsRows.push({
            matchup_id: key,
            season: selectedSeason,
            week: a.week ?? a.w ?? wk,
            round: idx + 1,
            participantsCount: 2,
            teamA: { rosterId: aId, name: aName, avatar: aAvatar, owner_display: aMeta.owner_display, points: aPts },
            teamB: { rosterId: bId, name: bName, avatar: bAvatar, owner_display: bMeta.owner_display, points: bPts }
          });
          continue;
        }

        // multi-team
        const participants = entries.map(ent => {
          const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
          const meta = rosterMap.get(pid) || {};
          return {
            rosterId: pid,
            name: meta.display_name || meta.owner_display || ('Roster ' + pid),
            avatar: meta.avatar || null,
            owner_display: meta.owner_display || null,
            points: numeric(ent.points ?? ent.points_for ?? ent.pts ?? 0)
          };
        });

        matchupsRows.push({
          matchup_id: key,
          season: selectedSeason,
          week: entries[0].week ?? entries[0].w ?? wk,
          round: idx + 1,
          combinedParticipants: participants,
          combinedLabel: participants.map(p => p.name).join(' / '),
          participantsCount: participants.length
        });
      }
    }

    // optional sort
    matchupsRows.sort((a, b) => {
      const ax = (a.teamA && a.teamA.points != null) ? a.teamA.points : 0;
      const by = (b.teamA && b.teamA.points != null) ? b.teamA.points : 0;
      return by - ax;
    });

    // --- 9) Hard-coded standings given by user (owner names) — convert to objects for PlayoffBrackets
    const standingsMap = {
      '2024': [
        "riguy506","smallvt","JakePratt","Kybes",
        "TLupinetti","samsilverman12","armyjunior","JFK4312",
        "WebbWarrior","slawflesh","jewishhorsemen","noahlap01",
        "zamt","WillMichael"
      ],
      '2023': [
        "armyjunior","jewishhorsemen","Kybes","riguy506",
        "zamt","slawflesh","JFK4312","smallvt",
        "samsilverman12","WebbWarrior","TLupinetti","noahlap01",
        "JakePratt","WillMichael"
      ],
      '2022': [
        "riguy506","smallvt","jewishhorsemen","zamt",
        "noahlap01","Kybes","armyjunior","slawflesh",
        "WillMichael","JFK4312","WebbWarrior","TLupinetti",
        "JakePratt","samsilverman12"
      ]
    };

    const rawStandings = standingsMap[String(selectedSeason)] ?? null;
    const standings = rawStandings ? rawStandings.map((name, i) => ({ id: null, name, placement: i + 1 })) : null;

    // prepare seasons for dropdown (matchups tab shape)
    const seasons = seasonsMeta.map(s => ({ league_id: s.league_id, season: s.season, name: s.name }));

    return {
      seasons,
      seasonsMeta,
      selectedSeason,
      selectedLeagueId,
      matchupsRows,
      standings,
      messages
    };
  } catch (err) {
    const msg = `Failed to load playoff matchups: ${err?.message ?? err}`;
    console.error(msg, err);
    return {
      seasons: [],
      seasonsMeta: [],
      selectedSeason: null,
      selectedLeagueId: null,
      matchupsRows: [],
      standings: null,
      messages: [msg]
    };
  }
}
