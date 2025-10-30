// src/routes/honor-hall/+page.server.js
import { readFile } from 'fs/promises';
import { createMemoryCache, createKVCache } from '$lib/server/cache';
import { createSleeperClient } from '$lib/server/sleeperClient';

let cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) {
    cache = createKVCache(globalThis.KV);
  } else {
    cache = createMemoryCache();
  }
} catch (e) {
  cache = createMemoryCache();
}

const SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
const sleeper = createSleeperClient({ cache: cache, concurrency: SLEEPER_CONCURRENCY });

const BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID)
  ? process.env.BASE_LEAGUE_ID
  : '1219816671624048640';
const SEASON_MATCHUP_YEARS = [2022, 2023, 2024]; // extend as needed
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 23; // per your request

function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// robust participant points extractor — prefers starters-only values if present
function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== 'object') return 0;

  const arrayKeys = ['starters_points', 'starter_points', 'startersPoints', 'starterPoints', 'starters_points_list'];
  for (const k of arrayKeys) {
    if (Array.isArray(entry[k]) && entry[k].length) {
      let s = 0;
      for (const v of entry[k]) s += safeNum(v);
      return Math.round(s * 100) / 100;
    }
  }

  if (Array.isArray(entry.starters) && entry.player_points && typeof entry.player_points === 'object') {
    let s = 0;
    for (const st of entry.starters) {
      const pval = entry.player_points[String(st)] ?? entry.player_points[st];
      s += safeNum(pval);
    }
    return Math.round(s * 100) / 100;
  }

  if (Array.isArray(entry.starters) && entry.starters.length && typeof entry.starters[0] === 'object') {
    let s = 0;
    for (const obj of entry.starters) {
      s += safeNum(obj.points ?? obj.p);
    }
    return Math.round(s * 100) / 100;
  }

  const fallback = safeNum(entry.points ?? entry.points_for ?? entry.pts ?? entry.score ?? 0);
  return Math.round(fallback * 100) / 100;
}

// next-week explicit zero detection (used to avoid current in-progress weeks)
function nextWeekContainsExplicitZero(matchupsArr) {
  if (!Array.isArray(matchupsArr) || matchupsArr.length === 0) return false;

  for (const m of matchupsArr) {
    if (Object.prototype.hasOwnProperty.call(m, 'teamAScore') && Number(m.teamAScore) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'teamBScore') && Number(m.teamBScore) === 0) return true;

    if (m.teamA && Object.prototype.hasOwnProperty.call(m.teamA, 'score') && Number(m.teamA.score) === 0) return true;
    if (m.teamB && Object.prototype.hasOwnProperty.call(m.teamB, 'score') && Number(m.teamB.score) === 0) return true;
    if (m.teamA && Object.prototype.hasOwnProperty.call(m.teamA, 'points') && Number(m.teamA.points) === 0) return true;
    if (m.teamB && Object.prototype.hasOwnProperty.call(m.teamB, 'points') && Number(m.teamB.points) === 0) return true;

    if (Object.prototype.hasOwnProperty.call(m, 'points') && Number(m.points) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'points_for') && Number(m.points_for) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'pts') && Number(m.pts) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, 'score') && Number(m.score) === 0) return true;
  }
  return false;
}

// load season_matchups JSON files (origin fetch then static fallback)
async function tryLoadSeasonMatchups(years, origin) {
  const map = {};
  const jsonLinks = [];
  for (const y of years) {
    let loaded = null;
    if (origin && typeof origin === 'string') {
      try {
        const url = origin.replace(/\/$/, '') + `/season_matchups/${String(y)}.json`;
        const res = await fetch(url, { method: 'GET' });
        if (res && res.ok) {
          const txt = await res.text();
          loaded = JSON.parse(txt);
          jsonLinks.push(url);
        }
      } catch (e) {
        loaded = null;
      }
    }

    if (!loaded) {
      try {
        const fileUrl = new URL(`../../../static/season_matchups/${String(y)}.json`, import.meta.url);
        const txt = await readFile(fileUrl, 'utf8');
        loaded = JSON.parse(txt);
        jsonLinks.push(`/season_matchups/${String(y)}.json`);
      } catch (e) {
        loaded = null;
      }
    }

    if (loaded) map[String(y)] = loaded;
  }
  return { map, jsonLinks };
}

// Build simple playoff standings from a matchupsByWeek object (used to determine champion)
function buildPlayoffStandingsFromMatchups(matchupsByWeek, playoffStart = 15) {
  const statsByRoster = {}, resultsByRoster = {}, paByRoster = {};
  for (let week = 1; week <= MAX_WEEKS; week++) {
    const matchups = (matchupsByWeek && matchupsByWeek[String(week)]) ? matchupsByWeek[String(week)] : [];
    if (!matchups || !matchups.length) continue;

    const effectivePlayoffStart = playoffStart || 15;
    const playoffEnd = effectivePlayoffStart + 2;
    const isPlayoffWeek = (week >= effectivePlayoffStart && week <= playoffEnd);
    if (!isPlayoffWeek) continue;

    // do not apply "next-week-zero" check for the final playoff week
    if (week !== playoffEnd) {
      const nextMatchups = matchupsByWeek[String(week + 1)];
      if (nextMatchups && nextMatchups.length && nextWeekContainsExplicitZero(nextMatchups)) {
        continue; // skip in-progress week
      }
    }

    for (const m of matchups) {
      const a = m.teamA ?? null;
      const b = m.teamB ?? null;
      if (a && b) {
        const ridA = String(a.rosterId ?? a.roster_id ?? a.id ?? a.roster ?? a.ownerId ?? a.owner_id);
        const ridB = String(b.rosterId ?? b.roster_id ?? b.id ?? b.roster ?? b.ownerId ?? b.owner_id);
        const ptsA = safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? m.points ?? 0);
        const ptsB = safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? 0);

        paByRoster[ridA] = paByRoster[ridA] || 0;
        paByRoster[ridB] = paByRoster[ridB] || 0;
        resultsByRoster[ridA] = resultsByRoster[ridA] || [];
        resultsByRoster[ridB] = resultsByRoster[ridB] || [];
        statsByRoster[ridA] = statsByRoster[ridA] || { wins:0, losses:0, ties:0, pf:0, roster: null };
        statsByRoster[ridB] = statsByRoster[ridB] || { wins:0, losses:0, ties:0, pf:0, roster: null };

        statsByRoster[ridA].pf += ptsA;
        statsByRoster[ridB].pf += ptsB;

        const oppAvgA = ptsB;
        const oppAvgB = ptsA;
        paByRoster[ridA] += oppAvgA;
        paByRoster[ridB] += oppAvgB;

        if (ptsA > oppAvgA + 1e-9) { resultsByRoster[ridA].push('W'); statsByRoster[ridA].wins += 1; }
        else if (ptsA < oppAvgA - 1e-9) { resultsByRoster[ridA].push('L'); statsByRoster[ridA].losses += 1; }
        else { resultsByRoster[ridA].push('T'); statsByRoster[ridA].ties += 1; }

        if (ptsB > oppAvgB + 1e-9) { resultsByRoster[ridB].push('W'); statsByRoster[ridB].wins += 1; }
        else if (ptsB < oppAvgB - 1e-9) { resultsByRoster[ridB].push('L'); statsByRoster[ridB].losses += 1; }
        else { resultsByRoster[ridB].push('T'); statsByRoster[ridB].ties += 1; }

        if (!statsByRoster[ridA].roster) statsByRoster[ridA].roster = { metadata: { team_name: a.name ?? null, owner_name: a.ownerName ?? null } };
        else statsByRoster[ridA].roster.metadata = { team_name: statsByRoster[ridA].roster.metadata?.team_name || a.name || null, owner_name: statsByRoster[ridA].roster.metadata?.owner_name || a.ownerName || null };

        if (!statsByRoster[ridB].roster) statsByRoster[ridB].roster = { metadata: { team_name: b.name ?? null, owner_name: b.ownerName ?? null } };
        else statsByRoster[ridB].roster.metadata = { team_name: statsByRoster[ridB].roster.metadata?.team_name || b.name || null, owner_name: statsByRoster[ridB].roster.metadata?.owner_name || b.ownerName || null };
      }
    }
  }

  const arr = [];
  for (const k of Object.keys(statsByRoster)) {
    const s = statsByRoster[k];
    const meta = s.roster && s.roster.metadata ? s.roster.metadata : {};
    arr.push({
      rosterId: k,
      team_name: meta.team_name || ('Roster ' + k),
      owner_name: meta.owner_name || null,
      wins: s.wins || 0,
      pf: Math.round((s.pf || 0) * 100) / 100
    });
  }

  arr.sort((a,b) => {
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    return (b.pf || 0) - (a.pf || 0);
  });
  return arr;
}

export async function load(event) {
  event.setHeaders({
    'cache-control': 's-maxage=120, stale-while-revalidate=300'
  });

  const origin = event.url?.origin || null;
  const messages = [];
  let seasonMatchupsMap = {};
  let jsonLinks = [];

  // 1) load JSONs first
  try {
    const loaded = await tryLoadSeasonMatchups(SEASON_MATCHUP_YEARS, origin);
    seasonMatchupsMap = loaded.map || {};
    jsonLinks = loaded.jsonLinks || [];
    if (Object.keys(seasonMatchupsMap).length) messages.push('Loaded season JSONs: ' + Object.keys(seasonMatchupsMap).join(', '));
    else messages.push('No season JSONs found for configured years.');
  } catch (e) {
    messages.push('Error loading JSONs: ' + (e?.message ?? String(e)));
    seasonMatchupsMap = {};
  }

  // 2) build seasons chain from base league (same approach as standings page)
  const seasons = [];
  try {
    let mainLeague = null;
    try {
      mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 });
    } catch (e) {
      messages.push('Failed fetching base league — ' + (e?.message ?? String(e)));
    }

    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id || BASE_LEAGUE_ID), season: mainLeague.season || null, name: mainLeague.name || null });
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) break;
          seasons.push({ league_id: String(prevLeague.league_id || currPrev), season: prevLeague.season || null, name: prevLeague.name || null });
          if (prevLeague.previous_league_id) currPrev = String(prevLeague.previous_league_id);
          else currPrev = null;
        } catch (err) {
          messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err?.message ?? String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error building seasons chain: ' + (err?.message ?? String(err)));
  }

  // dedupe & sort seasons by season year (ascending)
  const byId = {};
  for (const s of seasons) {
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  const dedupedSeasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) dedupedSeasons.push(byId[k]);
  dedupedSeasons.sort((a,b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : (a.season > b.season ? 1 : 0);
  });

  // 3) assemble honors[] by iterating over known season JSONs AND league seasons (compute from API when JSON absent)
  const honors = [];

  // helper to fetch matchups for a league into a matchupsByWeek map (only used when JSON absent)
  async function fetchMatchupsByLeague(leagueId) {
    const map = {};
    for (let week = 1; week <= MAX_WEEKS; week++) {
      try {
        const m = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 });
        if (m && m.length) map[String(week)] = m;
      } catch (e) {
        // swallow per-week errors but note
        messages.push(`Error fetching matchups for league ${leagueId} week ${week}: ${e?.message ?? String(e)}`);
      }
    }
    return map;
  }

  // 3a) process JSON seasons (guaranteed data source)
  for (const y of Object.keys(seasonMatchupsMap)) {
    try {
      const json = seasonMatchupsMap[y];
      const meta = (json && json._meta) ? json._meta : {};
      const playoffStartFromJson = (typeof json.playoff_week_start === 'number') ? Number(json.playoff_week_start)
        : (meta && typeof meta.playoff_week_start === 'number') ? Number(meta.playoff_week_start) : 15;

      // prefer explicit champion in _meta, else compute from playoffs
      let champion = null;
      if (meta && meta.champion) {
        champion = meta.champion;
      } else {
        const playoffStandings = buildPlayoffStandingsFromMatchups(json, playoffStartFromJson);
        if (playoffStandings && playoffStandings.length) {
          champion = { team_name: playoffStandings[0].team_name, owner_name: playoffStandings[0].owner_name };
        }
      }

      const explicitHall = meta.honor_hall || meta.hall_of_fame || meta.honors || [];
      honors.push({
        season: String(y),
        source: 'json',
        champion,
        hallEntries: Array.isArray(explicitHall) ? explicitHall : []
      });
      messages.push(`Processed season JSON ${y} (playoff_week_start=${playoffStartFromJson})`);
    } catch (e) {
      messages.push('Error processing season JSON ' + y + ': ' + (e?.message ?? String(e)));
    }
  }

  // 3b) for league seasons discovered via API but not covered by season JSONs, fetch matchups via API and compute champion
  for (const s of dedupedSeasons) {
    const seasonKey = s.season != null ? String(s.season) : null;
    // skip if we already included this season via JSON
    if (seasonKey && Object.prototype.hasOwnProperty.call(seasonMatchupsMap, seasonKey)) continue;

    // attempt to compute champion from API matchups for this league
    try {
      const leagueId = String(s.league_id);
      // fetch rosterMap (for avatar/team_name enrichment when possible)
      let rosterMap = {};
      try {
        rosterMap = await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 }) || {};
      } catch (e) {
        rosterMap = {};
        messages.push('Could not fetch rosterMap for league ' + leagueId + ': ' + (e?.message ?? String(e)));
      }

      // determine playoff_start from league settings if available
      let playoffStart = 15;
      try {
        const leagueMeta = await sleeper.getLeague(leagueId, { ttl: 60 * 5 });
        if (leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start) {
          playoffStart = Number(leagueMeta.settings.playoff_week_start) || 15;
        }
      } catch (e) {
        // ignore
      }

      // fetch matchups by week
      const matchupsByWeek = await fetchMatchupsByLeague(leagueId);

      // compute playoff standings and pick champion
      const playoffStandings = buildPlayoffStandingsFromMatchups(matchupsByWeek, playoffStart);
      let champion = null;
      if (playoffStandings && playoffStandings.length) {
        // try to enrich team_name and owner_name from rosterMap if possible
        const top = playoffStandings[0];
        const rosterMeta = rosterMap && (rosterMap[String(top.rosterId)] || rosterMap[String(top.rosterId).toString()]) ? rosterMap[String(top.rosterId)] : null;
        if (rosterMeta) {
          champion = { team_name: rosterMeta.team_name || top.team_name, owner_name: rosterMeta.owner_name || top.owner_name, avatar: rosterMeta.team_avatar || rosterMeta.owner_avatar || null };
        } else {
          champion = { team_name: top.team_name, owner_name: top.owner_name };
        }
      }

      honors.push({
        season: seasonKey || ('league_' + leagueId),
        source: 'api',
        champion,
        hallEntries: []
      });
      messages.push(`Computed champion from API for season ${seasonKey || leagueId}`);
    } catch (e) {
      messages.push('Error computing champion for league season ' + (s.season || s.league_id) + ': ' + (e?.message ?? String(e)));
    }
  }

  // sort honors by season ascending (string numeric)
  honors.sort((a,b) => {
    const na = Number(a.season);
    const nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a.season).localeCompare(String(b.season));
  });

  // prepare seasons array for dropdown (use seasons known via JSON first, then API seasons as fallback)
  const seasonList = [];
  const jsonYears = Object.keys(seasonMatchupsMap).map(k => String(k));
  for (const y of jsonYears) seasonList.push({ season: String(y) });

  for (const s of dedupedSeasons) {
    const seasonKey = s.season != null ? String(s.season) : null;
    if (seasonKey && !jsonYears.includes(seasonKey)) seasonList.push({ season: seasonKey });
  }

  return {
    seasons: seasonList,
    honors,
    jsonLinks,
    messages
  };
}
