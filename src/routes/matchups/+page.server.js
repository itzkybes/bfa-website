// src/routes/matchups/+page.server.js
// Server load for Matchups page
// - Loads roster & user metadata once
// - Fetches matchups for weeks 1..MAX_WEEKS and normalizes participants
// - Provides early-2023 JSON override support (static/early2023.json) with robust fallbacks
// - Returns weeksParticipants: { "<week>": [ participants... ] } where participants have matchup_id and points
import fs from 'fs/promises';

const DEFAULT_LEAGUE_ID = process.env.BASE_LEAGUE_ID || '1219816671624048640';
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeParseJson(txt) {
  try { return JSON.parse(txt); } catch (e) { return null; }
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function extractPointsFromEntry(entry) {
  // Try multiple plausible fields; prefer explicit starter(s)_points keys
  if (!entry || typeof entry !== 'object') return 0;
  const candidates = [
    'starters_points', 'starter_points', 'starterPoints', 'startersPoints',
    'starters_points_for', 'starters_points_for', 'starters_points_for',
    'points', 'points_for', 'pts'
  ];
  for (const k of candidates) {
    if (entry[k] != null && entry[k] !== '') return safeNum(entry[k]);
  }

  // sometimes Sleeper returns nested fields or different casing — try scanning all numeric fields
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return safeNum(v);
  }
  return 0;
}

export async function load(event) {
  const debug = []; // clear previous debug

  const url = event.url;
  const qp = url.searchParams;
  const incomingSeason = qp.get('season') || null;
  const incomingWeek = qp.get('week') ? Number(qp.get('week')) : null;

  const selectedSeason = incomingSeason || '2023';
  const selectedWeek = (Number.isFinite(incomingWeek) && !Number.isNaN(incomingWeek)) ? incomingWeek : 1;

  debug.push(`Override debug: season=${selectedSeason} week=${selectedWeek}`);

  // early2023 override loading (only used to replace a specific week's matchups if present)
  let earlyOverride = null;
  const isEarly2023 = (String(selectedSeason) === '2023' && selectedWeek >= 1 && selectedWeek <= 3);

  if (isEarly2023) {
    debug.push('isEarly2023=true — attempting to load static/early2023.json');

    // Attempt 1: event.fetch('/early2023.json')
    try {
      if (typeof event.fetch === 'function') {
        debug.push('Attempt 1: event.fetch("/early2023.json")');
        const res = await event.fetch('/early2023.json');
        if (res && res.ok) {
          const json = await res.json();
          if (json && typeof json === 'object') {
            const weekData = json['2023'] && json['2023'][String(selectedWeek)] ? json['2023'][String(selectedWeek)] : null;
            if (weekData) {
              earlyOverride = weekData;
              debug.push(`Loaded early override for week ${selectedWeek} via event.fetch`);
            } else {
              debug.push('event.fetch returned JSON but no entry for the selected week');
            }
          } else {
            debug.push('event.fetch returned no/invalid JSON');
          }
        } else {
          debug.push(`event.fetch returned non-ok (status=${res ? res.status : 'no-res'})`);
        }
      } else {
        debug.push('event.fetch is not available in this runtime');
      }
    } catch (e) {
      debug.push(`Attempt 1 error: ${String(e && e.message ? e.message : e)}`);
    }

    // Attempt 2: read from disk relative to this file
    if (!earlyOverride) {
      try {
        debug.push('Attempt 2: reading static/early2023.json from disk');
        const staticPath = new URL('../../../static/early2023.json', import.meta.url);
        const txt = await fs.readFile(staticPath, { encoding: 'utf8' });
        const json = safeParseJson(txt);
        if (json && typeof json === 'object') {
          const weekData = json['2023'] && json['2023'][String(selectedWeek)] ? json['2023'][String(selectedWeek)] : null;
          if (weekData) {
            earlyOverride = weekData;
            debug.push(`Loaded early override for week ${selectedWeek} from disk`);
          } else {
            debug.push('Disk JSON found but no entry for the selected week');
          }
        } else {
          debug.push('Disk JSON parse failed or returned invalid object');
        }
      } catch (e) {
        debug.push(`Attempt 2 error: ${String(e && e.message ? e.message : e)}`);
      }
    }

    // Attempt 3: absolute fetch to origin
    if (!earlyOverride) {
      try {
        debug.push('Attempt 3: absolute fetch to /early2023.json');
        const absUrl = new URL('/early2023.json', event.url.origin).href;
        const res = await fetch(absUrl);
        if (res && res.ok) {
          const json = await res.json();
          const weekData = json['2023'] && json['2023'][String(selectedWeek)] ? json['2023'][String(selectedWeek)] : null;
          if (weekData) {
            earlyOverride = weekData;
            debug.push(`Loaded early override for week ${selectedWeek} via absolute fetch`);
          } else {
            debug.push('Absolute fetch returned JSON but no entry for the selected week');
          }
        } else {
          debug.push(`Absolute fetch failed or non-ok (status=${res ? res.status : 'no-res'})`);
        }
      } catch (e) {
        debug.push(`Attempt 3 error: ${String(e && e.message ? e.message : e)}`);
      }
    }

    if (!earlyOverride) debug.push('No early2023 static override found.');
  } else {
    debug.push('isEarly2023=false — skipping early override loading');
  }

  // Prepare to fetch rosters & users once for enrichment
  const leagueId = qp.get('league') || process.env.VITE_LEAGUE_ID || DEFAULT_LEAGUE_ID;
  debug.push(`Using leagueId=${leagueId}`);

  let rosters = [];
  let users = [];
  try {
    debug.push('Fetching league rosters and users for metadata enrichment');
    // prefer event.fetch (server-side) but fallback to global fetch
    const rRes = (typeof event.fetch === 'function') ? await event.fetch(`https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/rosters`) : await fetch(`https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/rosters`);
    if (rRes && rRes.ok) rosters = await rRes.json();
    const uRes = (typeof event.fetch === 'function') ? await event.fetch(`https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/users`) : await fetch(`https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/users`);
    if (uRes && uRes.ok) users = await uRes.json();
    debug.push(`Fetched ${rosters.length} rosters and ${users.length} users`);
  } catch (e) {
    debug.push(`Error fetching rosters/users: ${String(e && e.message ? e.message : e)}`);
  }

  // Build quick maps
  const rosterById = {};
  for (const r of (rosters || [])) {
    const rid = r.roster_id ?? r.id ?? r.rosterId;
    if (rid != null) rosterById[String(rid)] = r;
  }
  const usersById = {};
  for (const u of (users || [])) {
    const uid = u.user_id ?? u.id ?? u.userId;
    if (uid != null) usersById[String(uid)] = u;
  }

  // Iterate weeks 1..MAX_WEEKS, fetch matchups, produce participants arrays
  const weeksParticipants = {}; // week -> participants[]
  for (let wk = 1; wk <= MAX_WEEKS; wk++) {
    try {
      // If earlyOverride applies to this week, synthesize participants from it and skip external fetch
      if (isEarly2023 && earlyOverride && Number(selectedWeek) === wk) {
        debug.push(`Week ${wk}: using early override (static data)`);
        // earlyOverride is expected to be an array of matchups (teamA/teamB + scores)
        const participants = [];
        for (const m of earlyOverride) {
          // for each override matchup, create two participant objects
          try {
            const a = {
              rosterId: m.teamA?.ownerName ? String(m.teamA.ownerName) : `override-A-${wk}-${Math.random().toString(36).slice(2,7)}`,
              matchup_id: `override-${wk}-${Math.random().toString(36).slice(2,6)}`,
              points: safeNum(m.teamAScore),
              startersPointsRaw: safeNum(m.teamAScore),
              raw: m,
              team_name: m.teamA?.name ?? null,
              owner_name: m.teamA?.ownerName ?? null,
              week: wk
            };
            const b = {
              rosterId: m.teamB?.ownerName ? String(m.teamB.ownerName) : `override-B-${wk}-${Math.random().toString(36).slice(2,7)}`,
              matchup_id: a.matchup_id, // same matchup id: they play each other
              points: safeNum(m.teamBScore),
              startersPointsRaw: safeNum(m.teamBScore),
              raw: m,
              team_name: m.teamB?.name ?? null,
              owner_name: m.teamB?.ownerName ?? null,
              week: wk
            };
            participants.push(a, b);
          } catch (ex) {
            debug.push(`Error synthesizing override matchup for week ${wk}: ${String(ex && ex.message ? ex.message : ex)}`);
          }
        }
        weeksParticipants[String(wk)] = participants;
        continue;
      }

      // Normal fetch
      debug.push(`Week ${wk}: fetching matchups from Sleeper API`);
      const fetchUrl = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/matchups/${wk}`;
      const res = (typeof event.fetch === 'function') ? await event.fetch(fetchUrl) : await fetch(fetchUrl);
      if (!res || !res.ok) {
        debug.push(`Week ${wk}: matchups fetch failed or non-ok (status=${res ? res.status : 'no-res'})`);
        weeksParticipants[String(wk)] = [];
        continue;
      }
      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) {
        debug.push(`Week ${wk}: no matchups returned`);
        weeksParticipants[String(wk)] = [];
        continue;
      }

      // Normalize: each element often represents a participant with roster_id and various points fields
      // Grouping by matchup_id is useful for pages but here we produce a flat participants array where each
      // participant contains matchup_id so callers can group easily.
      const participants = [];
      for (const entry of raw) {
        try {
          const rosterId = entry.roster_id ?? entry.rosterId ?? entry.owner_id ?? entry.ownerId ?? null;
          const matchupId = entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? null;
          const points = extractPointsFromEntry(entry);
          const startersPointsRaw = entry.starters_points ?? entry.starter_points ?? null;

          // enrichment from roster/user maps
          let team_name = null;
          let owner_name = null;
          if (rosterId != null && rosterById[String(rosterId)]) {
            const rmeta = rosterById[String(rosterId)];
            team_name = rmeta.metadata?.team_name ?? rmeta.team_name ?? rmeta.name ?? null;
            // owner_name may be on rosterMap or need users map lookup
            owner_name = rmeta.owner_name ?? null;
            if (!owner_name) {
              const ownerid = rmeta.owner_id ?? rmeta.user_id ?? null;
              if (ownerid && usersById[String(ownerid)]) owner_name = usersById[String(ownerid)].display_name ?? usersById[String(ownerid)].username ?? null;
            }
          } else if (entry.owner_id && usersById[String(entry.owner_id)]) {
            owner_name = usersById[String(entry.owner_id)].display_name ?? usersById[String(entry.owner_id)].username ?? null;
          }

          participants.push({
            rosterId: rosterId != null ? String(rosterId) : null,
            matchup_id: matchupId != null ? String(matchupId) : null,
            points,
            startersPointsRaw: startersPointsRaw != null ? safeNum(startersPointsRaw) : undefined,
            raw: entry,
            team_name,
            owner_name,
            week: wk
          });
        } catch (e) {
          debug.push(`Week ${wk}: error normalizing entry: ${String(e && e.message ? e.message : e)}`);
        }
      }

      weeksParticipants[String(wk)] = participants;
    } catch (e) {
      debug.push(`Week ${wk}: unexpected error: ${String(e && e.message ? e.message : e)}`);
      weeksParticipants[String(wk)] = [];
    }
  } // end weeks loop

  // Done — return payload
  return {
    season: selectedSeason,
    week: selectedWeek,
    leagueId,
    isEarly2023,
    earlyOverride,
    weeksParticipants, // object keyed by week number -> participants array
    debug
  };
}
