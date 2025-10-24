// src/routes/matchups/+page.server.js
// Server load for Matchups page
// - Loads roster & user metadata once
// - Fetches matchups for weeks 1..MAX_WEEKS and normalizes participants
// - Prefers same-origin fetch('/early2023.json') for the static override (like homepage)
// - Returns weeksParticipants: { "<week>": [ participants... ] } and debug array

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
  if (!entry || typeof entry !== 'object') return 0;
  // Prefer explicit starter(s)_points fields, then common points fields, then any numeric field
  const candidates = [
    'starters_points', 'starter_points', 'starterPoints', 'startersPoints',
    'starters_points_for', 'startersPointsFor',
    'points', 'points_for', 'pts'
  ];
  for (const k of candidates) {
    if (entry[k] != null && entry[k] !== '') return safeNum(entry[k]);
  }
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return safeNum(v);
  }
  return 0;
}

export async function load(event) {
  const debug = []; // will be returned for page debug

  const url = event.url;
  const qp = url.searchParams;
  const incomingSeason = qp.get('season') || null;
  const incomingWeek = qp.get('week') ? Number(qp.get('week')) : null;

  const selectedSeason = incomingSeason || '2023';
  const selectedWeek = (Number.isFinite(incomingWeek) && !Number.isNaN(incomingWeek)) ? incomingWeek : 1;

  debug.push(`loader start: season=${selectedSeason} week=${selectedWeek}`);

  // early2023 override loading (only used to replace a specific week's matchups if present)
  let earlyOverride = null;
  const isEarly2023 = (String(selectedSeason) === '2023' && selectedWeek >= 1 && selectedWeek <= 3);

  if (isEarly2023) {
    debug.push('isEarly2023=true — attempting same-origin fetch("/early2023.json")');
    // Attempt same-origin fetch first (this mirrors how static files are used by the homepage)
    try {
      const originUrl = new URL('/early2023.json', url.origin).toString();
      debug.push(`attempting fetch ${originUrl}`);
      const res = await fetch(originUrl);
      if (res && res.ok) {
        const json = await res.json();
        if (json && typeof json === 'object') {
          const weekData = json['2023'] && json['2023'][String(selectedWeek)] ? json['2023'][String(selectedWeek)] : null;
          if (weekData) {
            earlyOverride = weekData;
            debug.push(`Loaded early override for week ${selectedWeek} via same-origin fetch`);
          } else {
            debug.push('same-origin fetch returned JSON but no entry for selected week');
          }
        } else {
          debug.push('same-origin fetch returned non-object JSON');
        }
      } else {
        debug.push(`same-origin fetch returned non-ok (status=${res ? res.status : 'no-res'})`);
      }
    } catch (e) {
      debug.push(`same-origin fetch error: ${String(e && e.message ? e.message : e)}`);
    }

    // Fallback: try to read from disk relative to this file (only as last resort)
    if (!earlyOverride) {
      try {
        debug.push('Attempting to read static/early2023.json from disk as fallback');
        // compute path relative to this file: src/routes/matchups/+page.server.js -> ../../.. -> project root
        const staticPath = new URL('../../../static/early2023.json', import.meta.url);
        debug.push(`reading ${staticPath.pathname}`);
        const txt = await fs.readFile(staticPath, { encoding: 'utf8' });
        const json = safeParseJson(txt);
        if (json && typeof json === 'object') {
          const weekData = json['2023'] && json['2023'][String(selectedWeek)] ? json['2023'][String(selectedWeek)] : null;
          if (weekData) {
            earlyOverride = weekData;
            debug.push(`Loaded early override for week ${selectedWeek} from disk`);
          } else {
            debug.push('disk JSON found but no entry for selected week');
          }
        } else debug.push('disk JSON parse failed or not object');
      } catch (e) {
        debug.push(`disk read fallback failed: ${String(e && e.message ? e.message : e)}`);
      }
    }

    if (!earlyOverride) debug.push('No early2023 override found.');
  } else {
    debug.push('isEarly2023=false — skipping early override loading');
  }

  // Prepare to fetch rosters & users once for enrichment
  const leagueId = qp.get('league') || process.env.VITE_LEAGUE_ID || DEFAULT_LEAGUE_ID;
  debug.push(`Using leagueId=${leagueId}`);

  let rosters = [];
  let users = [];
  try {
    debug.push('Fetching rosters and users from Sleeper API (metadata enrichment)');
    const rostersUrl = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/rosters`;
    const usersUrl = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/users`;
    debug.push(`fetch ${rostersUrl}`);
    const rRes = await fetch(rostersUrl);
    if (rRes && rRes.ok) {
      rosters = await rRes.json();
      debug.push(`rosters fetched: ${rosters.length}`);
    } else {
      debug.push(`rosters fetch non-ok (status=${rRes ? rRes.status : 'no-res'})`);
    }
    debug.push(`fetch ${usersUrl}`);
    const uRes = await fetch(usersUrl);
    if (uRes && uRes.ok) {
      users = await uRes.json();
      debug.push(`users fetched: ${users.length}`);
    } else {
      debug.push(`users fetch non-ok (status=${uRes ? uRes.status : 'no-res'})`);
    }
  } catch (e) {
    debug.push(`Error fetching rosters/users: ${String(e && e.message ? e.message : e)}`);
  }

  // Build maps for enrichment
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
        const participants = [];
        for (const m of earlyOverride) {
          try {
            // build a stable-ish matchup id using owner names or fallback random
            const baseId = `${String(m.teamA?.ownerName ?? 'A')}-${String(m.teamB?.ownerName ?? 'B')}-${wk}`;
            const mid = `override-${baseId}`;
            const aRid = m.teamA?.ownerName ? String(m.teamA.ownerName) : `override-A-${wk}-${Math.random().toString(36).slice(2,7)}`;
            const bRid = m.teamB?.ownerName ? String(m.teamB.ownerName) : `override-B-${wk}-${Math.random().toString(36).slice(2,7)}`;
            const a = {
              rosterId: aRid,
              matchup_id: mid,
              points: safeNum(m.teamAScore),
              startersPointsRaw: safeNum(m.teamAScore),
              raw: m,
              team_name: m.teamA?.name ?? null,
              owner_name: m.teamA?.ownerName ?? null,
              week: wk
            };
            const b = {
              rosterId: bRid,
              matchup_id: mid,
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
        debug.push(`Week ${wk}: synth participants count=${participants.length}`);
        continue;
      }

      // Normal fetch from Sleeper API
      const fetchUrl = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/matchups/${wk}`;
      debug.push(`Week ${wk}: fetching ${fetchUrl}`);
      const res = await fetch(fetchUrl);
      if (!res) {
        debug.push(`Week ${wk}: no response from fetch`);
        weeksParticipants[String(wk)] = [];
        continue;
      }
      if (!res.ok) {
        debug.push(`Week ${wk}: matchups fetch returned non-ok status=${res.status}`);
        weeksParticipants[String(wk)] = [];
        continue;
      }
      const raw = await res.json();
      if (!raw || !Array.isArray(raw) || raw.length === 0) {
        debug.push(`Week ${wk}: matchups fetch returned empty array or non-array (length=${raw ? raw.length : 'n/a'})`);
        weeksParticipants[String(wk)] = [];
        continue;
      }

      debug.push(`Week ${wk}: raw matchups entries=${raw.length}`);
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
      debug.push(`Week ${wk}: normalized participants count=${participants.length}`);
    } catch (e) {
      debug.push(`Week ${wk}: unexpected error: ${String(e && e.message ? e.message : e)}`);
      weeksParticipants[String(wk)] = [];
    }
  }

  debug.push('loader finished');

  return {
    season: selectedSeason,
    week: selectedWeek,
    leagueId,
    isEarly2023,
    earlyOverride: earlyOverride ? true : false,
    weeksParticipants,
    debug
  };
}
