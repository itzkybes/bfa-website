// src/routes/honor-hall/+page.server.js
import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';

let cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) cache = createKVCache(globalThis.KV);
  else cache = createMemoryCache();
} catch (e) {
  cache = createMemoryCache();
}

const SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
const sleeper = createSleeperClient({ cache, concurrency: SLEEPER_CONCURRENCY });

const BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID)
  ? process.env.BASE_LEAGUE_ID
  : '1219816671624048640';
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export async function load(event) {
  // edge cache header
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];
  // build season chain (same approach as records page)
  let seasons = [];
  try {
    let mainLeague = null;
    try {
      mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 });
    } catch (e) {
      mainLeague = null;
      messages.push('Failed to fetch base league: ' + (e?.message ?? e));
    }

    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id), season: mainLeague.season ?? null, name: mainLeague.name ?? null });
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prev = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prev) { messages.push('Could not fetch league for previous_league_id ' + currPrev); break; }
          seasons.push({ league_id: String(prev.league_id), season: prev.season ?? null, name: prev.name ?? null });
          currPrev = prev.previous_league_id ? String(prev.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err?.message ?? String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error while building seasons chain: ' + (err?.message ?? String(err)));
  }

  // determine selected season (league id) and week from query params
  const url = event.url;
  const seasonParam = url.searchParams.get('season') ?? null;
  let selectedSeason = seasonParam;
  if (!selectedSeason) {
    if (seasons.length) selectedSeason = seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id;
  }

  // find matching league id for selectedSeason (either season value or league_id)
  let selectedLeagueId = null;
  for (const s of seasons) {
    if (String(s.season) === String(selectedSeason) || String(s.league_id) === String(selectedSeason)) {
      selectedLeagueId = String(s.league_id);
      selectedSeason = s.season ?? selectedSeason;
      break;
    }
  }
  // fallback - use BASE_LEAGUE_ID if nothing matched
  if (!selectedLeagueId && seasons.length) selectedLeagueId = seasons[seasons.length - 1].league_id;
  if (!selectedLeagueId) selectedLeagueId = BASE_LEAGUE_ID;

  // build weeks array (1..MAX_WEEKS)
  const weeks = [];
  for (let i = 1; i <= MAX_WEEKS; i++) weeks.push(i);

  // load league metadata to determine playoff start
  let leagueMeta = null;
  try {
    leagueMeta = selectedLeagueId ? await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }) : null;
  } catch (e) {
    leagueMeta = null;
    messages.push('Failed fetching league meta for selected season: ' + (e?.message ?? e));
  }

  let playoffStart = null;
  if (leagueMeta && leagueMeta.settings) {
    playoffStart = Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek ?? 0) || null;
  }

  // fetch roster map (with owner metadata)
  let rosterMap = {};
  try {
    if (selectedLeagueId) {
      rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
      messages.push('Loaded rosters (' + Object.keys(rosterMap).length + ')');
    }
  } catch (e) {
    rosterMap = {};
    messages.push('Failed to fetch rosters for season: ' + (e?.message ?? e));
  }

  // ---------- compute placements by scrubbing matchups through the regular season ----------
  const placementMap = {}; // rosterId -> placement (1-based)
  try {
    // initialize stats for every roster known from rosterMap
    const stats = {}; // rosterId -> { wins, losses, ties, points_for, points_against, games }
    for (const rid of Object.keys(rosterMap || {})) {
      stats[rid] = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0, games: 0 };
    }

    // define regular season weeks: 1 .. (playoffStart - 1) if playoffStart exists, else 1..MAX_WEEKS
    let regStart = 1;
    let regEnd = MAX_WEEKS;
    if (playoffStart && Number(playoffStart) >= 2) {
      regEnd = Number(playoffStart) - 1;
    } else {
      // If playoffStart not set, assume regular-season is up to MAX_WEEKS (fallback).
      regEnd = MAX_WEEKS;
      messages.push('Playoff start not found in metadata — using weeks 1..' + regEnd + ' for standings calculation.');
    }

    // fetch matchups for each regular-season week and update stats
    for (let wk = regStart; wk <= regEnd; wk++) {
      try {
        const wkMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, wk, { ttl: 60 * 5 });
        if (!Array.isArray(wkMatchups) || wkMatchups.length === 0) continue;

        // group by matchup id like we do later (some libraries return objects with roster_id fields)
        const grouped = {};
        for (let i = 0; i < wkMatchups.length; i++) {
          const e = wkMatchups[i];
          const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
          const key = mid != null ? `${mid}` : `auto_${wk}_${i}`;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(e);
        }

        // iterate each grouped matchup
        for (const key of Object.keys(grouped)) {
          const entries = grouped[key];
          if (!entries || entries.length === 0) continue;

          // if exactly two-side matchup (common case), compute winner
          if (entries.length === 2) {
            const a = entries[0];
            const b = entries[1];

            const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? (a.roster ?? a.team ?? 'unknownA'));
            const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? (b.roster ?? b.team ?? 'unknownB'));

            // ensure a/b exist in stats map
            if (!stats[aId]) stats[aId] = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0, games: 0 };
            if (!stats[bId]) stats[bId] = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0, games: 0 };

            const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? a.score ?? null);
            const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? b.score ?? null);

            // accumulate points
            stats[aId].points_for += aPts;
            stats[aId].points_against += bPts;
            stats[aId].games += 1;

            stats[bId].points_for += bPts;
            stats[bId].points_against += aPts;
            stats[bId].games += 1;

            // compare result - only numeric comparison (if both are present)
            if (Number.isFinite(aPts) && Number.isFinite(bPts)) {
              if (aPts > bPts) {
                stats[aId].wins += 1;
                stats[bId].losses += 1;
              } else if (bPts > aPts) {
                stats[bId].wins += 1;
                stats[aId].losses += 1;
              } else {
                stats[aId].ties += 1;
                stats[bId].ties += 1;
              }
            } else {
              // if one or both scores missing, treat as tie (safe fallback)
              stats[aId].ties += 1;
              stats[bId].ties += 1;
            }
          } else {
            // not a simple 2-team matchup: we skip affecting wins/losses, but accumulate points if present
            for (const ent of entries) {
              const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? (ent.roster ?? 'r'));
              if (!stats[pid]) stats[pid] = { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0, games: 0 };
              const pts = safeNum(ent.points ?? ent.points_for ?? ent.pts ?? ent.score ?? 0);
              stats[pid].points_for += pts;
              stats[pid].games += 1;
            }
          }
        }

      } catch (we) {
        messages.push('Failed to fetch matchups for reg-week ' + wk + ': ' + (we?.message ?? we));
        // continue
      }
    }

    // Now we have stats map for rosterIds; build a sortable array
    const statEntries = [];
    for (const [rid, s] of Object.entries(stats)) {
      statEntries.push({
        rosterId: rid,
        wins: s.wins || 0,
        losses: s.losses || 0,
        ties: s.ties || 0,
        points_for: s.points_for || 0,
        points_against: s.points_against || 0,
        games: s.games || 0
      });
    }

    // Sort by: wins desc, then points_for (PF) desc (tiebreaker), then ties desc, then points_against asc, then rosterId
    statEntries.sort((A, B) => {
      if ((B.wins - A.wins) !== 0) return (B.wins - A.wins);
      if ((B.points_for - A.points_for) !== 0) return (B.points_for - A.points_for);
      if ((B.ties - A.ties) !== 0) return (B.ties - A.ties);
      if ((A.points_against - B.points_against) !== 0) return (A.points_against - B.points_against);
      // stable fallback
      return String(A.rosterId).localeCompare(String(B.rosterId));
    });

    // assign placement map (1-based)
    for (let i = 0; i < statEntries.length; i++) {
      const rid = String(statEntries[i].rosterId);
      placementMap[rid] = i + 1;
    }
    messages.push('Computed placements by scrubbing regular-season matchups (weeks ' + regStart + '–' + regEnd + ').');

  } catch (e) {
    messages.push('Failed to compute placements by scrubbing matchups: ' + (e?.message ?? e));
  }

  // fetch playoff matchups (fetch matchups for playoff window)
  let rawMatchups = [];
  try {
    if (selectedLeagueId) {
      // Determine playoff start from league metadata if available
      let startWeek = playoffStart && Number(playoffStart) >= 1 ? Number(playoffStart) : null;
      // If not available, assume final 3 weeks are playoffs (fallback)
      if (!startWeek) {
        startWeek = Math.max(1, MAX_WEEKS - 2);
        messages.push('Playoff start not found in league metadata — defaulting to week ' + startWeek);
      }
      // Fetch matchups for each playoff week up to startWeek+2 (3-week playoff window)
      const endWeek = Math.min(MAX_WEEKS, startWeek + 2);
      for (let wk = startWeek; wk <= endWeek; wk++) {
        try {
          const wkMatchups = await sleeper.getMatchupsForWeek(selectedLeagueId, wk, { ttl: 60 * 5 });
          if (Array.isArray(wkMatchups) && wkMatchups.length) {
            // ensure week property is set for each matchup entry
            for (const m of wkMatchups) {
              if (m && (m.week == null && m.w == null)) m.week = wk;
              rawMatchups.push(m);
            }
          }
        } catch (we) {
          messages.push('Failed to fetch matchups for week ' + wk + ': ' + (we?.message ?? we));
          // continue to next week
        }
      }
    }
  } catch (e) {
    rawMatchups = [];
    messages.push('Failed to fetch playoff matchups: ' + (e?.message ?? e));
  }

  // group matchups by matchup id / week so we present pair rows
  const byMatch = {};
  for (let i = 0; i < rawMatchups.length; i++) {
    const e = rawMatchups[i];
    const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
    const wk = e.week ?? e.w ?? null;
    const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  // Build rows for UI: when pair (2 participants) => Team A vs Team B; otherwise join participants (multi-team)
  const matchupsRows = [];
  for (const k of Object.keys(byMatch)) {
    const entries = byMatch[k];
    if (!entries || entries.length === 0) continue;

    // handle bye (single participant)
    if (entries.length === 1) {
      const a = entries[0];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const aMeta = rosterMap[aId] || {};
      const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const aPlacement = placementMap[aId] ?? null;

      matchupsRows.push({
        matchup_id: k,
        season: selectedSeason ?? null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement },
        teamB: { rosterId: null, name: 'BYE', avatar: null, points: null, placement: null },
        participantsCount: 1
      });
      continue;
    }

    // if exactly 2 participants produce a clean two-column row
    if (entries.length === 2) {
      const a = entries[0];
      const b = entries[1];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
      const aMeta = rosterMap[aId] || {};
      const bMeta = rosterMap[bId] || {};
      const aName = aMeta.team_name || aMeta.owner_name || ('Roster ' + aId);
      const bName = bMeta.team_name || bMeta.owner_name || ('Roster ' + bId);
      const aAvatar = aMeta.team_avatar || aMeta.owner_avatar || null;
      const bAvatar = bMeta.team_avatar || bMeta.owner_avatar || null;

      const aPts = safeNum(a.points ?? a.points_for ?? a.pts ?? null);
      const bPts = safeNum(b.points ?? b.points_for ?? b.pts ?? null);

      const aPlacement = placementMap[aId] ?? null;
      const bPlacement = placementMap[bId] ?? null;

      matchupsRows.push({
        matchup_id: k,
        season: selectedSeason ?? null,
        week: a.week ?? a.w ?? null,
        teamA: { rosterId: aId, name: aName, avatar: aAvatar, points: aPts, placement: aPlacement },
        teamB: { rosterId: bId, name: bName, avatar: bAvatar, points: bPts, placement: bPlacement },
        participantsCount: 2
      });
    } else {
      // multi-participant matchup -- aggregate into combinedParticipants for display
      const participants = entries.map(ent => {
        const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
        const meta = rosterMap[pid] || {};
        return {
          rosterId: pid,
          name: meta.team_name || meta.owner_name || ('Roster ' + pid),
          avatar: meta.team_avatar || meta.owner_avatar || null,
          points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0),
          placement: placementMap[pid] ?? null
        };
      });
      // build a combined label
      const combinedNames = participants.map(p => p.name).join(' / ');
      matchupsRows.push({
        matchup_id: k,
        season: selectedSeason ?? null,
        week: entries[0].week ?? entries[0].w ?? null,
        combinedParticipants: participants,
        combinedLabel: combinedNames,
        participantsCount: participants.length
      });
    }
  }

  // sort rows by week desc then teamA points desc (so finals appear first)
  matchupsRows.sort((x,y) => {
    const wx = Number(x.week ?? 0), wy = Number(y.week ?? 0);
    if (wy !== wx) return wy - wx;
    const ax = (x.teamA && x.teamA.points) ? safeNum(x.teamA.points) : 0;
    const by = (y.teamA && y.teamA.points) ? safeNum(y.teamA.points) : 0;
    return by - ax;
  });

  return {
    seasons,
    weeks,
    selectedSeason,
    matchupsRows,
    messages
  };
}
