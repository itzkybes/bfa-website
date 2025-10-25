// src/routes/matchups/+page.server.js
// Server loader for Matchups page. Fetches matchups per week, extracts starter points,
// enriches with roster/user metadata, and supports a static early2023.json override
// (served from /early2023.json on the same origin).

const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;
const FALLBACK_LEAGUE_ID = '1219816671624048640';

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickPointsFromEntry(entry) {
  if (!entry || typeof entry !== 'object') return 0;

  // prioritized candidate keys
  const candidates = [
    'starters_points', 'starter_points', 'starterPoints', 'startersPoints',
    'starters_points_for', 'starter_points_for', 'starterPointsFor',
    'points', 'points_for', 'pts'
  ];

  for (const k of candidates) {
    if (entry[k] != null && entry[k] !== '') return safeNum(entry[k]);
  }

  // some payloads put scoring under nested objects
  if (entry.scoring && typeof entry.scoring === 'object') {
    for (const k of candidates) {
      if (entry.scoring[k] != null) return safeNum(entry.scoring[k]);
    }
  }

  // last-resort: any numeric property
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return safeNum(v);
  }

  return 0;
}

function normalizeRosterMeta(rmeta) {
  if (!rmeta || typeof rmeta !== 'object') return {};
  return {
    team_name: rmeta.team_name || (rmeta.metadata && rmeta.metadata.team_name) || null,
    owner_name: rmeta.owner_name || null,
    owner_username: rmeta.owner_username || null,
    team_avatar: rmeta.team_avatar || rmeta.owner_avatar || null
  };
}

export async function load(event) {
  // caching policy for CDN
  event.setHeaders({
    'cache-control': 's-maxage=120, stale-while-revalidate=300'
  });

  const debug = [];
  const url = event.url;
  const qp = url.searchParams;

  // selected season/week from querystring (defaults)
  const selectedSeason = qp.get('season') ?? (process.env.DEFAULT_SEASON ?? '2023');
  const selectedWeek = qp.get('week') ? Number(qp.get('week')) : 1;

  debug.push(`loader start: season=${selectedSeason} week=${selectedWeek}`);

  // league id resolution: query param -> env -> fallback
  const leagueFromQuery = qp.get('league');
  const leagueId = leagueFromQuery || process.env.BASE_LEAGUE_ID || process.env.VITE_LEAGUE_ID || process.env.BASE_LEAGUE || FALLBACK_LEAGUE_ID;
  debug.push(`using leagueId=${leagueId}`);

  // --- attempt to load early2023.json override from same origin (preferred) ---
  let earlyOverrideJson = null;
  const isEarly2023 = String(selectedSeason) === '2023';
  if (isEarly2023) {
    try {
      const staticUrl = new URL('/early2023.json', url.origin).toString();
      debug.push(`attempting same-origin fetch for static override: ${staticUrl}`);
      const resp = await fetch(staticUrl);
      if (resp && resp.ok) {
        try {
          earlyOverrideJson = await resp.json();
          debug.push('static override fetched and parsed.');
        } catch (e) {
          debug.push(`static override JSON parse error: ${String(e && e.message ? e.message : e)}`);
          earlyOverrideJson = null;
        }
      } else {
        debug.push(`static override fetch returned non-ok: status=${resp ? resp.status : 'no-res'}`);
      }
    } catch (e) {
      // global fetch may throw (network, environment)
      debug.push(`static override fetch error: ${String(e && e.message ? e.message : e)}`);
      earlyOverrideJson = null;
    }
  }

  // --- preload rosters & users to enrich participants ---
  let rosters = [];
  let users = [];
  try {
    const rostersUrl = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/rosters`;
    debug.push(`fetching rosters: ${rostersUrl}`);
    const rres = await fetch(rostersUrl);
    if (rres && rres.ok) {
      rosters = await rres.json();
      debug.push(`rosters loaded: ${Array.isArray(rosters) ? rosters.length : 'not-array'}`);
    } else {
      debug.push(`rosters fetch non-ok status=${rres ? rres.status : 'no-res'}`);
      rosters = [];
    }
  } catch (e) {
    debug.push(`rosters fetch error: ${String(e && e.message ? e.message : e)}`);
  }

  try {
    const usersUrl = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/users`;
    debug.push(`fetching users: ${usersUrl}`);
    const ures = await fetch(usersUrl);
    if (ures && ures.ok) {
      users = await ures.json();
      debug.push(`users loaded: ${Array.isArray(users) ? users.length : 'not-array'}`);
    } else {
      debug.push(`users fetch non-ok status=${ures ? ures.status : 'no-res'}`);
      users = [];
    }
  } catch (e) {
    debug.push(`users fetch error: ${String(e && e.message ? e.message : e)}`);
  }

  // build quick maps
  const rosterMap = {};
  for (const r of (rosters || [])) {
    try {
      const rid = r.roster_id ?? r.id ?? r.rosterId;
      if (rid != null) rosterMap[String(rid)] = r;
    } catch (e) { /* ignore single bad entry */ }
  }
  const userMap = {};
  for (const u of (users || [])) {
    try {
      const uid = u.user_id ?? u.id ?? u.userId;
      if (uid != null) userMap[String(uid)] = u;
    } catch (e) {}
  }

  // iterate weeks -> fetch matchups or use static override for early 2023
  const weeksParticipants = {};
  for (let wk = 1; wk <= MAX_WEEKS; wk++) {
    debug.push(`processing week ${wk}`);

    // if static override applies for season 2023 and wk 1..3, synthesize participants for that week
    if (isEarly2023 && earlyOverrideJson && earlyOverrideJson['2023'] && earlyOverrideJson['2023'][String(wk)]) {
      debug.push(`week ${wk}: using early2023.json override`);
      const overridePairs = earlyOverrideJson['2023'][String(wk)] || [];
      const parts = [];
      for (const pair of overridePairs) {
        try {
          // ownerName used as identifier (per user's JSON); create rosterId from ownerName to normalize
          const aOwner = pair.teamA?.ownerName ?? String(Math.random()).slice(2,8);
          const bOwner = pair.teamB?.ownerName ?? String(Math.random()).slice(2,8);
          const aRid = String(aOwner);
          const bRid = String(bOwner);
          const matchupId = `override-${String(aRid)}-${String(bRid)}-w${wk}`;

          parts.push({
            rosterId: aRid,
            matchup_id: matchupId,
            week: wk,
            points: safeNum(pair.teamAScore),
            startersPointsRaw: safeNum(pair.teamAScore),
            team_name: pair.teamA?.name ?? null,
            owner_name: pair.teamA?.ownerName ?? null,
            raw: pair
          });
          parts.push({
            rosterId: bRid,
            matchup_id: matchupId,
            week: wk,
            points: safeNum(pair.teamBScore),
            startersPointsRaw: safeNum(pair.teamBScore),
            team_name: pair.teamB?.name ?? null,
            owner_name: pair.teamB?.ownerName ?? null,
            raw: pair
          });
        } catch (e) {
          debug.push(`week ${wk} override pair synth error: ${String(e && e.message ? e.message : e)}`);
        }
      }
      weeksParticipants[String(wk)] = parts;
      debug.push(`week ${wk} override participants count=${parts.length}`);
      continue;
    }

    // otherwise fetch from Sleeper API
    try {
      const apiUrl = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/matchups/${wk}`;
      debug.push(`week ${wk}: fetching matchups ${apiUrl}`);
      const resp = await fetch(apiUrl);
      if (!resp) {
        debug.push(`week ${wk}: no response from fetch`);
        weeksParticipants[String(wk)] = [];
        continue;
      }
      if (!resp.ok) {
        debug.push(`week ${wk}: fetch non-ok status=${resp.status}`);
        weeksParticipants[String(wk)] = [];
        continue;
      }
      const raw = await resp.json();
      debug.push(`week ${wk}: fetched raw entries=${Array.isArray(raw) ? raw.length : 'not-array'}`);
      if (!Array.isArray(raw) || raw.length === 0) {
        weeksParticipants[String(wk)] = [];
        continue;
      }

      const parts = [];
      for (const entry of raw) {
        try {
          const rosterId = entry.roster_id ?? entry.rosterId ?? entry.owner_id ?? entry.ownerId ?? null;
          const matchupId = entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? null;
          const points = pickPointsFromEntry(entry);

          // enrich
          let team_name = null;
          let owner_name = null;
          if (rosterId != null && rosterMap[String(rosterId)]) {
            const meta = normalizeRosterMeta(rosterMap[String(rosterId)]);
            team_name = meta.team_name;
            owner_name = meta.owner_name || meta.owner_username || null;
            if (!owner_name) {
              // try to map via roster owner_id inside roster object
              const r = rosterMap[String(rosterId)];
              const maybeOwner = r.owner_id ?? r.ownerId ?? r.user_id ?? null;
              if (maybeOwner && userMap[String(maybeOwner)]) owner_name = userMap[String(maybeOwner)].display_name || userMap[String(maybeOwner)].username || null;
            }
          }

          // if still missing owner_name, try mapping via entry.display_name or username fields
          if (!owner_name) {
            owner_name = entry.owner_name ?? entry.owner ?? entry.ownerName ?? entry.display_name ?? entry.username ?? null;
          }

          parts.push({
            rosterId: rosterId != null ? String(rosterId) : null,
            matchup_id: matchupId != null ? String(matchupId) : null,
            week: wk,
            points,
            startersPointsRaw: points,
            team_name,
            owner_name,
            raw: entry
          });
        } catch (e) {
          debug.push(`week ${wk} entry normalization error: ${String(e && e.message ? e.message : e)}`);
        }
      }

      weeksParticipants[String(wk)] = parts;
      debug.push(`week ${wk}: normalized participants count=${parts.length}`);
    } catch (e) {
      debug.push(`week ${wk} fetch/normalize error: ${String(e && e.message ? e.message : e)}`);
      weeksParticipants[String(wk)] = [];
    }
  } // end weeks loop

  // pick participants for selected week
  const participantsForSelected = weeksParticipants[String(selectedWeek)] || [];

  // Minimal seasons/weekOptions returns to keep matchups page selects working
  // (The page may already build weekOptions from server data elsewhere; here we provide minimal structures.)
  const seasons = [{ league_id: leagueId, season: selectedSeason, name: `Season ${selectedSeason}` }];
  const weekOptions = { regular: Array.from({ length: Math.max(1, Math.min(MAX_WEEKS, 18)) }, (_, i) => i + 1), playoffs: [] };

  return {
    week: selectedWeek,
    participants: participantsForSelected,
    weeksParticipants,
    seasons,
    weekOptions,
    selectedSeason,
    debug
  };
}
