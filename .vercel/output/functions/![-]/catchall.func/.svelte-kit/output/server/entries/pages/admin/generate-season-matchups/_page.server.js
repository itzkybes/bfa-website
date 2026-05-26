import { c as createKVCache, a as createMemoryCache, b as createSleeperClient } from "../../../../chunks/cache.js";
let _cache = null;
let _sleeper = null;
function getSleeperClient() {
  if (_sleeper) return _sleeper;
  if (!_cache) {
    try {
      if (typeof globalThis !== "undefined" && globalThis.KV) _cache = createKVCache(globalThis.KV);
      else _cache = createMemoryCache();
    } catch (e) {
      _cache = createMemoryCache();
    }
  }
  const concurrency = Number(process.env.SLEEPER_CONCURRENCY) || 8;
  _sleeper = createSleeperClient({ cache: _cache, concurrency });
  return _sleeper;
}
const BASE_LEAGUE_ID = typeof process !== "undefined" && process.env && process.env.BASE_LEAGUE_ID ? process.env.BASE_LEAGUE_ID : "1219816671624048640";
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 23;
const PLAYOFF_WEEK_START = Number(process.env.PLAYOFF_WEEK_START) || 15;
function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function extractStarters(part) {
  if (!part) return null;
  if (Array.isArray(part.starters) && part.starters.length) {
    return part.starters.map((s) => typeof s === "object" ? s.player_id ?? s.playerId ?? s.id ?? s : s).map(String);
  }
  return null;
}
function extractStarterPoints(part) {
  if (!part) return null;
  const arrayKeys = ["starters_points", "starter_points", "startersPoints", "starterPoints", "starters_points_list"];
  for (const k of arrayKeys) {
    if (Array.isArray(part[k]) && part[k].length) {
      return part[k].map((v) => Math.round(safeNum(v) * 100) / 100);
    }
  }
  if (part.player_points && typeof part.player_points === "object" && Array.isArray(part.starters) && part.starters.length) {
    const out = [];
    for (const st of part.starters) {
      const val = part.player_points[String(st)] ?? part.player_points[st];
      out.push(Math.round(safeNum(val) * 100) / 100);
    }
    return out;
  }
  if (Array.isArray(part.starters) && part.starters.length && typeof part.starters[0] === "object") {
    const out = [];
    for (const obj of part.starters) {
      out.push(Math.round(safeNum(obj.points ?? obj.p) * 100) / 100);
    }
    return out;
  }
  return null;
}
function computeTotalFromParticipant(part) {
  const sp = extractStarterPoints(part);
  if (Array.isArray(sp) && sp.length) {
    return Math.round(sp.reduce((s, x) => s + safeNum(x), 0) * 100) / 100;
  }
  const fallback = safeNum(part.points ?? part.points_for ?? part.pts ?? part.score ?? 0);
  return Math.round(fallback * 100) / 100;
}
async function load(event) {
  const sleeper = getSleeperClient();
  event.setHeaders({
    "cache-control": "s-maxage=60, stale-while-revalidate=300"
  });
  const messages = [];
  const outputs = [];
  let seasons = [];
  try {
    let mainLeague = null;
    try {
      mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 });
    } catch (e) {
      messages.push("Failed fetching base league " + BASE_LEAGUE_ID + " — " + (e && e.message ? e.message : String(e)));
    }
    if (mainLeague) {
      seasons.push({
        league_id: String(mainLeague.league_id || BASE_LEAGUE_ID),
        season: mainLeague.season || null,
        name: mainLeague.name || null
      });
      let currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      let steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          const prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) {
            messages.push("Could not fetch league for previous_league_id " + currPrev);
            break;
          }
          seasons.push({
            league_id: String(prevLeague.league_id || currPrev),
            season: prevLeague.season || null,
            name: prevLeague.name || null
          });
          if (prevLeague.previous_league_id) currPrev = String(prevLeague.previous_league_id);
          else currPrev = null;
        } catch (err) {
          messages.push("Error fetching previous_league_id: " + currPrev + " — " + (err && err.message ? err.message : String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push("Error while building seasons chain: " + (err && err.message ? err.message : String(err)));
  }
  const byId = {};
  for (const s of seasons) {
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = Object.keys(byId).map((k) => byId[k]);
  seasons.sort((a, b) => {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    return Number(a.season) - Number(b.season);
  });
  const discoveredYears = seasons.filter((s) => s.season != null).map((s) => String(s.season));
  const YEARS = discoveredYears.length ? discoveredYears : ["2022", "2023", "2024"];
  for (const year of YEARS) {
    const payload = {};
    const meta = { year };
    const matching = seasons.find((s) => String(s.season) === String(year) || String(s.league_id) === String(year));
    const leagueId = matching ? matching.league_id : null;
    let playoff_week_start = PLAYOFF_WEEK_START;
    let rosterMap = {};
    if (leagueId) {
      try {
        const lm = await sleeper.getLeague(leagueId, { ttl: 60 * 5 });
        if (lm && lm.settings && lm.settings.playoff_week_start) {
          playoff_week_start = Number(lm.settings.playoff_week_start) || PLAYOFF_WEEK_START;
        }
      } catch (e) {
      }
      try {
        rosterMap = await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 }) || {};
      } catch (e) {
        messages.push(`Failed to fetch roster map for league ${leagueId} (season ${year}) — ${e?.message ?? e}`);
        rosterMap = {};
      }
    }
    meta.playoff_week_start = playoff_week_start;
    for (let week = 1; week <= MAX_WEEKS; week++) {
      try {
        if (!leagueId) continue;
        const matchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 }) || [];
        if (!matchups || !matchups.length) continue;
        const byMatch = {};
        for (let i = 0; i < matchups.length; i++) {
          const entry = matchups[i];
          const mid = entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? null;
          const key = mid != null ? String(mid) : `auto-${week}-${i}`;
          if (!byMatch[key]) byMatch[key] = { mid, entries: [] };
          byMatch[key].entries.push(entry);
        }
        const normalized = [];
        for (const key of Object.keys(byMatch)) {
          const { mid, entries } = byMatch[key];
          if (!entries || entries.length === 0) continue;
          if (entries.length === 1) {
            const e = entries[0];
            const pid = e.roster_id ?? e.rosterId ?? e.owner_id ?? e.ownerId ?? null;
            const rosterMeta = pid && rosterMap[String(pid)] ? rosterMap[String(pid)] : null;
            const teamA = {
              rosterId: pid != null ? String(pid) : null,
              name: rosterMeta?.team_name ?? rosterMeta?.name ?? (e.team_name ?? e.teamName ?? null),
              ownerName: rosterMeta?.owner_username ?? rosterMeta?.owner_name ?? e.owner_name ?? e.owner ?? null,
              starters: extractStarters(e) || null,
              starters_points: extractStarterPoints(e) || null,
              player_points: e.player_points && typeof e.player_points === "object" ? e.player_points : null
            };
            const teamAScore = computeTotalFromParticipant(e);
            normalized.push({
              matchup_id: mid,
              week,
              teamA,
              teamAScore
            });
          } else {
            const aRaw = entries[0];
            const bRaw = entries[1];
            const aPid = aRaw.roster_id ?? aRaw.rosterId ?? aRaw.owner_id ?? aRaw.ownerId ?? null;
            const bPid = bRaw.roster_id ?? bRaw.rosterId ?? bRaw.owner_id ?? bRaw.ownerId ?? null;
            const aMeta = aPid && rosterMap[String(aPid)] ? rosterMap[String(aPid)] : null;
            const bMeta = bPid && rosterMap[String(bPid)] ? rosterMap[String(bPid)] : null;
            const teamA = {
              rosterId: aPid != null ? String(aPid) : null,
              name: aMeta?.team_name ?? aMeta?.name ?? (aRaw.team_name ?? aRaw.teamName ?? null),
              ownerName: aMeta?.owner_username ?? aMeta?.owner_name ?? aRaw.owner_name ?? aRaw.owner ?? null,
              starters: extractStarters(aRaw) || null,
              starters_points: extractStarterPoints(aRaw) || null,
              player_points: aRaw.player_points && typeof aRaw.player_points === "object" ? aRaw.player_points : null
            };
            const teamB = {
              rosterId: bPid != null ? String(bPid) : null,
              name: bMeta?.team_name ?? bMeta?.name ?? (bRaw.team_name ?? bRaw.teamName ?? null),
              ownerName: bMeta?.owner_username ?? bMeta?.owner_name ?? bRaw.owner_name ?? bRaw.owner ?? null,
              starters: extractStarters(bRaw) || null,
              starters_points: extractStarterPoints(bRaw) || null,
              player_points: bRaw.player_points && typeof bRaw.player_points === "object" ? bRaw.player_points : null
            };
            const teamAScore = computeTotalFromParticipant(aRaw);
            const teamBScore = computeTotalFromParticipant(bRaw);
            normalized.push({
              matchup_id: mid,
              week,
              teamA,
              teamB,
              teamAScore,
              teamBScore
            });
          }
        }
        if (normalized.length) {
          payload[week] = normalized;
        }
      } catch (wkErr) {
        messages.push(`Error fetching/processing week ${week} for season ${year}: ${wkErr?.message ?? wkErr}`);
        continue;
      }
    }
    outputs.push({ year, meta, weeks: payload });
  }
  return {
    messages,
    outputs
  };
}
export {
  load
};
