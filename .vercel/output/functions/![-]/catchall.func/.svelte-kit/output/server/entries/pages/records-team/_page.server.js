import { c as createKVCache, a as createMemoryCache, b as createSleeperClient } from "../../../chunks/cache.js";
import { readFile } from "fs/promises";
let cache;
try {
  if (typeof globalThis !== "undefined" && globalThis.KV) {
    cache = createKVCache(globalThis.KV);
  } else {
    cache = createMemoryCache();
  }
} catch (e) {
  cache = createMemoryCache();
}
const SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
const sleeper = createSleeperClient({ cache, concurrency: SLEEPER_CONCURRENCY });
const BASE_LEAGUE_ID = typeof process !== "undefined" && process.env && process.env.BASE_LEAGUE_ID ? process.env.BASE_LEAGUE_ID : "1219816671624048640";
const MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;
const SEASON_MATCHUP_YEARS = [2022, 2023, 2024];
function safeNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function computeStreaks(resultsArray) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  if (!resultsArray || !Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
  for (let i = 0; i < resultsArray.length; i++) {
    const r = resultsArray[i];
    if (r === "W") {
      curW += 1;
      curL = 0;
      if (curW > maxW) maxW = curW;
    } else if (r === "L") {
      curL += 1;
      curW = 0;
      if (curL > maxL) maxL = curL;
    } else {
      curW = 0;
      curL = 0;
    }
  }
  return { maxW, maxL };
}
async function tryLoadEarly2023(origin) {
  if (origin && typeof origin === "string") {
    try {
      const url = origin.replace(/\/$/, "") + "/early2023.json";
      const res = await fetch(url, { method: "GET" });
      if (res && res.ok) {
        const txt = await res.text();
        try {
          return JSON.parse(txt);
        } catch (e) {
        }
      }
    } catch (e) {
    }
  }
  try {
    const fileUrl = new URL("../../../static/early2023.json", import.meta.url);
    const txt = await readFile(fileUrl, "utf8");
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}
async function tryLoadSeasonMatchups(years, origin) {
  const map = {};
  const jsonLinks = [];
  for (const y of years) {
    let loaded = null;
    if (origin && typeof origin === "string") {
      try {
        const url = origin.replace(/\/$/, "") + `/season_matchups/${String(y)}.json`;
        const res = await fetch(url, { method: "GET" });
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
        const txt = await readFile(fileUrl, "utf8");
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
function computeParticipantPoints(entry) {
  if (!entry || typeof entry !== "object") return 0;
  const arrayKeys = ["starters_points", "starter_points", "startersPoints", "starterPoints", "starters_points_list"];
  for (const k of arrayKeys) {
    if (Array.isArray(entry[k]) && entry[k].length) {
      let s = 0;
      for (const v of entry[k]) s += safeNum(v);
      return Math.round(s * 100) / 100;
    }
  }
  if (Array.isArray(entry.starters) && entry.player_points && typeof entry.player_points === "object") {
    let s = 0;
    for (const st of entry.starters) {
      const pval = entry.player_points[String(st)] ?? entry.player_points[st];
      s += safeNum(pval);
    }
    return Math.round(s * 100) / 100;
  }
  if (Array.isArray(entry.starters) && entry.starters.length && typeof entry.starters[0] === "object") {
    let s = 0;
    for (const obj of entry.starters) {
      s += safeNum(obj.points ?? obj.p);
    }
    return Math.round(s * 100) / 100;
  }
  const fallback = safeNum(entry.points ?? entry.points_for ?? entry.pts ?? entry.score ?? 0);
  return Math.round(fallback * 100) / 100;
}
function buildStandingsFromMaps(statsByRoster, resultsByRoster, paByRoster, rosterMap) {
  const standings = [];
  let iterationKeys = Object.keys(resultsByRoster);
  if (iterationKeys.length === 0 && rosterMap && Object.keys(rosterMap).length) iterationKeys = Object.keys(rosterMap);
  for (let idx = 0; idx < iterationKeys.length; idx++) {
    const ridK = iterationKeys[idx];
    if (!Object.prototype.hasOwnProperty.call(statsByRoster, ridK)) {
      statsByRoster[ridK] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap && rosterMap[ridK] ? rosterMap[ridK].roster_raw : null };
    }
    const s = statsByRoster[ridK];
    const wins = s.wins || 0;
    const losses = s.losses || 0;
    const ties = s.ties || 0;
    const pfVal = Math.round((s.pf || 0) * 100) / 100;
    const paVal = Math.round((paByRoster[ridK] || s.pa || 0) * 100) / 100;
    const meta = rosterMap && rosterMap[ridK] ? rosterMap[ridK] : {};
    const team_name = meta.team_name ? meta.team_name : s.roster && s.roster.metadata && s.roster.metadata.team_name ? s.roster.metadata.team_name : "Roster " + ridK;
    const owner_name = meta.owner_name || s.roster && s.roster.metadata && s.roster.metadata.owner_name || null;
    const team_avatar = meta.team_avatar || meta.avatar || null;
    const owner_avatar = meta.owner_avatar || null;
    const avatar = team_avatar || owner_avatar || null;
    const resArr = resultsByRoster && resultsByRoster[ridK] ? resultsByRoster[ridK] : [];
    const streaks = computeStreaks(resArr);
    standings.push({
      rosterId: ridK,
      owner_id: meta.owner_id || null,
      team_name,
      owner_name,
      avatar,
      wins,
      losses,
      ties,
      pf: pfVal,
      pa: paVal,
      champion: false,
      maxWinStreak: streaks.maxW,
      maxLoseStreak: streaks.maxL
    });
  }
  standings.sort(function(a, b) {
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    return (b.pf || 0) - (a.pf || 0);
  });
  return standings;
}
function nextWeekContainsExplicitZero(matchupsArr) {
  if (!Array.isArray(matchupsArr) || matchupsArr.length === 0) return false;
  for (const m of matchupsArr) {
    if (Object.prototype.hasOwnProperty.call(m, "teamAScore") && Number(m.teamAScore) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, "teamBScore") && Number(m.teamBScore) === 0) return true;
    if (m.teamA && Object.prototype.hasOwnProperty.call(m.teamA, "score") && Number(m.teamA.score) === 0) return true;
    if (m.teamB && Object.prototype.hasOwnProperty.call(m.teamB, "score") && Number(m.teamB.score) === 0) return true;
    if (m.teamA && Object.prototype.hasOwnProperty.call(m.teamA, "points") && Number(m.teamA.points) === 0) return true;
    if (m.teamB && Object.prototype.hasOwnProperty.call(m.teamB, "points") && Number(m.teamB.points) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, "points") && Number(m.points) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, "points_for") && Number(m.points_for) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, "pts") && Number(m.pts) === 0) return true;
    if (Object.prototype.hasOwnProperty.call(m, "score") && Number(m.score) === 0) return true;
  }
  return false;
}
function ownerKeyFromRosterMeta(meta) {
  if (!meta) return null;
  if (meta.owner_username) return String(meta.owner_username).toLowerCase();
  if (meta.owner_name) return String(meta.owner_name).toLowerCase();
  if (meta.owner_id) return "ownerid:" + String(meta.owner_id);
  if (meta.team_name) return "team:" + String(meta.team_name).toLowerCase();
  return null;
}
async function load(event) {
  event.setHeaders({
    "cache-control": "s-maxage=120, stale-while-revalidate=300"
  });
  const url = event.url;
  const origin = url?.origin || null;
  const incomingSeasonParam = url.searchParams.get("season") || null;
  const messages = [];
  const prevChain = [];
  const OWNER_REPARENT = {
    "bellooshio": "jakepratt",
    "cholybevv": "jakepratt"
  };
  const OWNER_DISPLAY = {
    "jakepratt": "JakePratt"
  };
  const ownershipNotes = [];
  let seasonMatchupsMap = {};
  let jsonLinks = [];
  try {
    const loaded = await tryLoadSeasonMatchups(SEASON_MATCHUP_YEARS, origin);
    seasonMatchupsMap = loaded.map || {};
    jsonLinks = loaded.jsonLinks || [];
    if (Object.keys(seasonMatchupsMap).length) {
      messages.push("Loaded season_matchups JSON for years: " + Object.keys(seasonMatchupsMap).join(", ") + ".");
    } else {
      messages.push("No season_matchups JSON files found for configured years: " + SEASON_MATCHUP_YEARS.join(", ") + ".");
    }
  } catch (e) {
    messages.push("Error loading season_matchups JSON: " + (e?.message ?? String(e)));
    seasonMatchupsMap = {};
  }
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
      prevChain.push(String(mainLeague.league_id || BASE_LEAGUE_ID));
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
          prevChain.push(String(prevLeague.league_id || currPrev));
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
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    byId[String(s.league_id)] = { league_id: String(s.league_id), season: s.season, name: s.name };
  }
  seasons = [];
  for (const k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);
  seasons.sort(function(a, b) {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    const na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : a.season > b.season ? 1 : 0;
  });
  let selectedSeasonParam = incomingSeasonParam;
  if (!selectedSeasonParam) {
    if (seasons && seasons.length) {
      const latest = seasons[seasons.length - 1];
      selectedSeasonParam = latest.season != null ? String(latest.season) : String(latest.league_id);
    } else {
      selectedSeasonParam = "all";
    }
  }
  const leagueIdsToProcess = [];
  if (!selectedSeasonParam || selectedSeasonParam === "all") {
    if (seasons.length === 0) leagueIdsToProcess.push(BASE_LEAGUE_ID);
    else for (let ii = 0; ii < seasons.length; ii++) leagueIdsToProcess.push(String(seasons[ii].league_id));
  } else {
    let matched = false;
    for (let jj = 0; jj < seasons.length; jj++) {
      if (String(seasons[jj].league_id) === String(selectedSeasonParam)) {
        leagueIdsToProcess.push(String(seasons[jj].league_id));
        matched = true;
        break;
      }
    }
    if (!matched) {
      for (let kk = 0; kk < seasons.length; kk++) {
        if (seasons[kk].season != null && String(seasons[kk].season) === String(selectedSeasonParam)) {
          leagueIdsToProcess.push(String(seasons[kk].league_id));
          matched = true;
          break;
        }
      }
    }
    if (!matched) leagueIdsToProcess.push(String(selectedSeasonParam));
  }
  const seasonsResults = [];
  let anyDataFound = false;
  const HARDCODED_CHAMPIONS = {
    "2022": "riguy506",
    "2023": "armyjunior",
    "2024": "riguy506"
  };
  function buildRosterLookup(rosterMap) {
    const usernameToRoster = {};
    const ownerNameToRoster = {};
    const teamNameToRoster = {};
    for (const rk in rosterMap) {
      if (!Object.prototype.hasOwnProperty.call(rosterMap, rk)) continue;
      const meta = rosterMap[rk] || {};
      if (meta.owner_username) usernameToRoster[String(meta.owner_username).toLowerCase()] = String(rk);
      if (meta.owner_name) ownerNameToRoster[String(meta.owner_name).toLowerCase()] = String(rk);
      if (meta.team_name) teamNameToRoster[String(meta.team_name).toLowerCase()] = String(rk);
    }
    return { usernameToRoster, ownerNameToRoster, teamNameToRoster };
  }
  const globalH2HCandidates = [];
  const globalMargins = [];
  for (const yearKey of Object.keys(seasonMatchupsMap)) {
    try {
      const matchupsByWeek = seasonMatchupsMap[yearKey];
      if (!matchupsByWeek) continue;
      const playoffStartFromJson = typeof matchupsByWeek.playoff_week_start === "number" ? Number(matchupsByWeek.playoff_week_start) : matchupsByWeek._meta && typeof matchupsByWeek._meta.playoff_week_start === "number" ? Number(matchupsByWeek._meta.playoff_week_start) : 15;
      const statsByRosterRegular = {}, resultsByRosterRegular = {}, paByRosterRegular = {};
      const statsByRosterPlayoff = {}, resultsByRosterPlayoff = {}, paByRosterPlayoff = {};
      for (let week = 1; week <= MAX_WEEKS; week++) {
        const matchups = matchupsByWeek[String(week)] || [];
        if (!matchups || !matchups.length) continue;
        const effectivePlayoffStart = playoffStartFromJson || 15;
        const playoffEnd = effectivePlayoffStart + 2;
        const isRegularWeek = week >= 1 && week < effectivePlayoffStart;
        const isPlayoffWeek = week >= effectivePlayoffStart && week <= playoffEnd;
        if (!isRegularWeek && !isPlayoffWeek) continue;
        if (week !== playoffEnd) {
          const nextMatchups = matchupsByWeek[String(week + 1)];
          if (nextMatchups && nextMatchups.length && nextWeekContainsExplicitZero(nextMatchups)) {
            continue;
          }
        }
        const statsByRoster = isPlayoffWeek ? statsByRosterPlayoff : statsByRosterRegular;
        const resultsByRoster = isPlayoffWeek ? resultsByRosterPlayoff : resultsByRosterRegular;
        const paByRoster = isPlayoffWeek ? paByRosterPlayoff : paByRosterRegular;
        for (const m of matchups) {
          const a = m.teamA ?? null;
          const b = m.teamB ?? null;
          const seasonNum = String(yearKey);
          if (a && b) {
            const ridA = String(a.rosterId ?? a.roster_id ?? a.id ?? a.roster ?? a.ownerId ?? a.owner_id);
            const ridB = String(b.rosterId ?? b.roster_id ?? b.id ?? b.roster ?? b.ownerId ?? b.owner_id);
            const ptsA = safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? m.points ?? 0);
            const ptsB = safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? 0);
            const ownerAKey = (a.ownerName ? String(a.ownerName).toLowerCase() : a.owner_username ? String(a.owner_username).toLowerCase() : null) || "roster:" + ridA;
            const ownerBKey = (b.ownerName ? String(b.ownerName).toLowerCase() : b.owner_username ? String(b.owner_username).toLowerCase() : null) || "roster:" + ridB;
            const ownerADisplay = a.ownerName ?? a.owner_username ?? null;
            const ownerBDisplay = b.ownerName ?? b.owner_username ?? null;
            const aTeamName = a.name ?? null;
            const bTeamName = b.name ?? null;
            const avatarA = a.avatar ?? a.team_avatar ?? null;
            const avatarB = b.avatar ?? b.team_avatar ?? null;
            globalH2HCandidates.push({
              ownerKey: ownerAKey,
              ownerDisplay: ownerADisplay,
              ownerAvatar: avatarA,
              ownerTeam: aTeamName,
              opponentKey: ownerBKey,
              opponentDisplay: ownerBDisplay,
              opponentAvatar: avatarB,
              opponentTeam: bTeamName,
              season: seasonNum,
              week,
              ownerScore: ptsA,
              opponentScore: ptsB
            });
            globalH2HCandidates.push({
              ownerKey: ownerBKey,
              ownerDisplay: ownerBDisplay,
              ownerAvatar: avatarB,
              ownerTeam: bTeamName,
              opponentKey: ownerAKey,
              opponentDisplay: ownerADisplay,
              opponentAvatar: avatarA,
              opponentTeam: aTeamName,
              season: seasonNum,
              week,
              ownerScore: ptsB,
              opponentScore: ptsA
            });
            const margin = Math.abs(ptsA - ptsB);
            globalMargins.push({
              season: seasonNum,
              week,
              margin,
              teamAName: aTeamName || ownerADisplay || "Roster " + ridA,
              teamBName: bTeamName || ownerBDisplay || "Roster " + ridB,
              ownerA: ownerADisplay || ownerAKey,
              ownerB: ownerBDisplay || ownerBKey,
              avatarA,
              avatarB,
              scoreA: ptsA,
              scoreB: ptsB,
              source: "season_json_" + String(yearKey)
            });
            paByRoster[ridA] = paByRoster[ridA] || 0;
            paByRoster[ridB] = paByRoster[ridB] || 0;
            resultsByRoster[ridA] = resultsByRoster[ridA] || [];
            resultsByRoster[ridB] = resultsByRoster[ridB] || [];
            statsByRoster[ridA] = statsByRoster[ridA] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
            statsByRoster[ridB] = statsByRoster[ridB] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
            statsByRoster[ridA].pf += ptsA;
            statsByRoster[ridB].pf += ptsB;
            const oppAvgA = ptsB;
            const oppAvgB = ptsA;
            paByRoster[ridA] += oppAvgA;
            paByRoster[ridB] += oppAvgB;
            if (ptsA > oppAvgA + 1e-9) {
              resultsByRoster[ridA].push("W");
              statsByRoster[ridA].wins += 1;
            } else if (ptsA < oppAvgA - 1e-9) {
              resultsByRoster[ridA].push("L");
              statsByRoster[ridA].losses += 1;
            } else {
              resultsByRoster[ridA].push("T");
              statsByRoster[ridA].ties += 1;
            }
            if (ptsB > oppAvgB + 1e-9) {
              resultsByRoster[ridB].push("W");
              statsByRoster[ridB].wins += 1;
            } else if (ptsB < oppAvgB - 1e-9) {
              resultsByRoster[ridB].push("L");
              statsByRoster[ridB].losses += 1;
            } else {
              resultsByRoster[ridB].push("T");
              statsByRoster[ridB].ties += 1;
            }
            if (!statsByRoster[ridA].roster) statsByRoster[ridA].roster = { metadata: { team_name: a.name ?? null, owner_name: a.ownerName ?? null } };
            else statsByRoster[ridA].roster.metadata = { team_name: statsByRoster[ridA].roster.metadata?.team_name || a.name || null, owner_name: statsByRoster[ridA].roster.metadata?.owner_name || a.ownerName || null };
            if (!statsByRoster[ridB].roster) statsByRoster[ridB].roster = { metadata: { team_name: b.name ?? null, owner_name: b.ownerName ?? null } };
            else statsByRoster[ridB].roster.metadata = { team_name: statsByRoster[ridB].roster.metadata?.team_name || b.name || null, owner_name: statsByRoster[ridB].roster.metadata?.owner_name || b.ownerName || null };
          } else if (a) {
            const ridOnly = String(a.rosterId ?? a.roster_id ?? a.id ?? a.roster ?? a.ownerId ?? a.owner_id);
            const ptsOnly = safeNum(m.teamAScore ?? m.teamA?.score ?? m.points ?? 0);
            paByRoster[ridOnly] = paByRoster[ridOnly] || 0;
            resultsByRoster[ridOnly] = resultsByRoster[ridOnly] || [];
            statsByRoster[ridOnly] = statsByRoster[ridOnly] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
            statsByRoster[ridOnly].pf += ptsOnly;
            if (!statsByRoster[ridOnly].roster) statsByRoster[ridOnly].roster = { metadata: { team_name: a.name ?? null, owner_name: a.ownerName ?? null } };
            else statsByRoster[ridOnly].roster.metadata = { team_name: statsByRoster[ridOnly].roster.metadata?.team_name || a.name || null, owner_name: statsByRoster[ridOnly].roster.metadata?.owner_name || a.ownerName || null };
          }
        }
      }
      const regularStandings = buildStandingsFromMaps(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular, {});
      const playoffStandings = buildStandingsFromMaps(statsByRosterPlayoff, resultsByRosterPlayoff, paByRosterPlayoff, {});
      seasonsResults.push({
        leagueId: "season_json_" + String(yearKey),
        season: String(yearKey),
        leagueName: "Season " + String(yearKey) + " (JSON)",
        playoff_week_start: playoffStartFromJson,
        regularStandings,
        playoffStandings,
        _fromJson: true
      });
      anyDataFound = true;
      messages.push("Processed season_matchups JSON for year " + String(yearKey) + " (playoff_week_start=" + playoffStartFromJson + ").");
    } catch (e) {
      messages.push("Error processing season_matchups JSON for year " + yearKey + " — " + (e?.message ?? String(e)));
    }
  }
  for (let li = 0; li < leagueIdsToProcess.length; li++) {
    const leagueId = leagueIdsToProcess[li];
    try {
      let leagueMeta = null;
      try {
        leagueMeta = await sleeper.getLeague(leagueId, { ttl: 60 * 5 });
      } catch (e) {
        leagueMeta = null;
      }
      const leagueSeason = leagueMeta && leagueMeta.season ? String(leagueMeta.season) : null;
      const leagueName = leagueMeta && leagueMeta.name ? leagueMeta.name : null;
      let rosterMap = {};
      try {
        rosterMap = await sleeper.getRosterMapWithOwners(leagueId, { ttl: 60 * 5 }) || {};
      } catch (e) {
        rosterMap = {};
      }
      const { usernameToRoster, ownerNameToRoster, teamNameToRoster } = buildRosterLookup(rosterMap);
      let playoffStart = leagueMeta && leagueMeta.settings && leagueMeta.settings.playoff_week_start ? Number(leagueMeta.settings.playoff_week_start) : 15;
      if (!playoffStart || isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
      const playoffEnd = playoffStart + 2;
      const statsByRosterRegular = {}, resultsByRosterRegular = {}, paByRosterRegular = {};
      const statsByRosterPlayoff = {}, resultsByRosterPlayoff = {}, paByRosterPlayoff = {};
      if (rosterMap && Object.keys(rosterMap).length) {
        for (const rk2 in rosterMap) {
          if (!Object.prototype.hasOwnProperty.call(rosterMap, rk2)) continue;
          statsByRosterRegular[String(rk2)] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk2].roster_raw || null };
          resultsByRosterRegular[String(rk2)] = [];
          paByRosterRegular[String(rk2)] = 0;
          statsByRosterPlayoff[String(rk2)] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: rosterMap[rk2].roster_raw || null };
          resultsByRosterPlayoff[String(rk2)] = [];
          paByRosterPlayoff[String(rk2)] = 0;
        }
      }
      let earlyData = null;
      try {
        if (String(leagueSeason) === "2023") {
          earlyData = await tryLoadEarly2023(origin);
          if (!earlyData) messages.push("early2023.json not available for 2023; will use API values.");
        }
      } catch (err) {
        earlyData = null;
        messages.push("Error loading early2023.json: " + (err?.message ?? String(err)));
      }
      const seasonMatchupsForLeague = leagueSeason && seasonMatchupsMap[String(leagueSeason)] ? seasonMatchupsMap[String(leagueSeason)] : null;
      let seasonJsonPlayoffStart = null;
      if (seasonMatchupsForLeague) {
        seasonJsonPlayoffStart = typeof seasonMatchupsForLeague.playoff_week_start === "number" ? Number(seasonMatchupsForLeague.playoff_week_start) : seasonMatchupsForLeague._meta && typeof seasonMatchupsForLeague._meta.playoff_week_start === "number" ? Number(seasonMatchupsForLeague._meta.playoff_week_start) : null;
        messages.push(`Using season_matchups JSON for season ${String(leagueSeason)}${seasonJsonPlayoffStart ? " (playoff_week_start=" + seasonJsonPlayoffStart + ")" : ""}.`);
      }
      for (let week = 1; week <= MAX_WEEKS; week++) {
        let matchups = null;
        let isFromSeasonJSON = false;
        if (seasonMatchupsForLeague) {
          matchups = seasonMatchupsForLeague[String(week)] || [];
          isFromSeasonJSON = true;
        } else {
          try {
            matchups = await sleeper.getMatchupsForWeek(leagueId, week, { ttl: 60 * 5 }) || [];
          } catch (errWeek) {
            messages.push("Error fetching matchups for league " + leagueId + " week " + week + " — " + (errWeek && errWeek.message ? errWeek.message : String(errWeek)));
            continue;
          }
        }
        if (!matchups || !matchups.length) continue;
        const effectivePlayoffStart = seasonJsonPlayoffStart || leagueMeta && leagueMeta.settings && Number(leagueMeta.settings.playoff_week_start) || 15;
        const effectivePlayoffEnd = effectivePlayoffStart + 2;
        const isRegularWeek = week >= 1 && week < effectivePlayoffStart;
        const isPlayoffWeek = week >= effectivePlayoffStart && week <= effectivePlayoffEnd;
        if (!isRegularWeek && !isPlayoffWeek) continue;
        if (week !== effectivePlayoffEnd) {
          try {
            let nextMatchups = null;
            if (isFromSeasonJSON) {
              nextMatchups = seasonMatchupsForLeague[String(week + 1)] || [];
            } else {
              try {
                nextMatchups = await sleeper.getMatchupsForWeek(leagueId, week + 1, { ttl: 60 * 5 }) || [];
              } catch (e) {
                nextMatchups = null;
              }
            }
            if (nextMatchups && nextMatchups.length && nextWeekContainsExplicitZero(nextMatchups)) {
              continue;
            }
          } catch (e) {
          }
        }
        const statsByRoster = isPlayoffWeek ? statsByRosterPlayoff : statsByRosterRegular;
        const resultsByRoster = isPlayoffWeek ? resultsByRosterPlayoff : resultsByRosterRegular;
        const paByRoster = isPlayoffWeek ? paByRosterPlayoff : paByRosterRegular;
        if (isFromSeasonJSON) {
          for (const m of matchups) {
            const a = m.teamA ?? null;
            const b = m.teamB ?? null;
            if (a && b) {
              const ridA = String(a.rosterId ?? a.roster_id ?? a.id ?? a.roster ?? a.ownerId ?? a.owner_id);
              const ridB = String(b.rosterId ?? b.roster_id ?? b.id ?? b.roster ?? b.ownerId ?? b.owner_id);
              const ptsA = safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? 0);
              const ptsB = safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? 0);
              paByRoster[ridA] = paByRoster[ridA] || 0;
              paByRoster[ridB] = paByRoster[ridB] || 0;
              resultsByRoster[ridA] = resultsByRoster[ridA] || [];
              resultsByRoster[ridB] = resultsByRoster[ridB] || [];
              statsByRoster[ridA] = statsByRoster[ridA] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
              statsByRoster[ridB] = statsByRoster[ridB] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
              statsByRoster[ridA].pf += ptsA;
              statsByRoster[ridB].pf += ptsB;
              const oppAvgA = ptsB;
              const oppAvgB = ptsA;
              paByRoster[ridA] += oppAvgA;
              paByRoster[ridB] += oppAvgB;
              if (ptsA > oppAvgA + 1e-9) {
                resultsByRoster[ridA].push("W");
                statsByRoster[ridA].wins += 1;
              } else if (ptsA < oppAvgA - 1e-9) {
                resultsByRoster[ridA].push("L");
                statsByRoster[ridA].losses += 1;
              } else {
                resultsByRoster[ridA].push("T");
                statsByRoster[ridA].ties += 1;
              }
              if (ptsB > oppAvgB + 1e-9) {
                resultsByRoster[ridB].push("W");
                statsByRoster[ridB].wins += 1;
              } else if (ptsB < oppAvgB - 1e-9) {
                resultsByRoster[ridB].push("L");
                statsByRoster[ridB].losses += 1;
              } else {
                resultsByRoster[ridB].push("T");
                statsByRoster[ridB].ties += 1;
              }
              if (!statsByRoster[ridA].roster) statsByRoster[ridA].roster = { metadata: { team_name: a.name ?? null, owner_name: a.ownerName ?? null } };
              else {
                statsByRoster[ridA].roster.metadata.team_name = statsByRoster[ridA].roster.metadata.team_name || a.name || null;
                statsByRoster[ridA].roster.metadata.owner_name = statsByRoster[ridA].roster.metadata.owner_name || a.ownerName || null;
              }
              if (!statsByRoster[ridB].roster) statsByRoster[ridB].roster = { metadata: { team_name: b.name ?? null, owner_name: b.ownerName ?? null } };
              else {
                statsByRoster[ridB].roster.metadata.team_name = statsByRoster[ridB].roster.metadata.team_name || b.name || null;
                statsByRoster[ridB].roster.metadata.owner_name = statsByRoster[ridB].roster.metadata.owner_name || b.ownerName || null;
              }
            } else if (a) {
              const ridOnly = String(a.rosterId ?? a.roster_id ?? a.id ?? a.roster ?? a.ownerId ?? a.owner_id);
              const ptsOnly = safeNum(m.teamAScore ?? m.teamA?.score ?? m.points ?? 0);
              paByRoster[ridOnly] = paByRoster[ridOnly] || 0;
              resultsByRoster[ridOnly] = resultsByRoster[ridOnly] || [];
              statsByRoster[ridOnly] = statsByRoster[ridOnly] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
              statsByRoster[ridOnly].pf += ptsOnly;
              if (!statsByRoster[ridOnly].roster) statsByRoster[ridOnly].roster = { metadata: { team_name: a.name ?? null, owner_name: a.ownerName ?? null } };
              else {
                statsByRoster[ridOnly].roster.metadata.team_name = statsByRoster[ridOnly].roster.metadata.team_name || a.name || null;
                statsByRoster[ridOnly].roster.metadata.owner_name = statsByRoster[ridOnly].roster.metadata.owner_name || a.ownerName || null;
              }
            }
          }
          continue;
        }
        const byMatch = {};
        for (let mi = 0; mi < matchups.length; mi++) {
          const entry = matchups[mi];
          const mid = entry.matchup_id ?? entry.matchupId ?? entry.matchup ?? null;
          const wk = entry.week ?? entry.w ?? week;
          const key = String(mid != null ? mid + "|" + wk : "auto|" + wk + "|" + mi);
          if (!byMatch[key]) byMatch[key] = [];
          byMatch[key].push(entry);
        }
        const mids = Object.keys(byMatch);
        for (let mii = 0; mii < mids.length; mii++) {
          const mid = mids[mii];
          const entries = byMatch[mid];
          if (!entries || entries.length === 0) continue;
          if (entries.length === 1) {
            const only = entries[0];
            const ridOnly = only.roster_id ?? only.rosterId ?? only.owner_id ?? only.ownerId;
            const keyRid = String(ridOnly);
            paByRoster[keyRid] = paByRoster[keyRid] || 0;
            resultsByRoster[keyRid] = resultsByRoster[keyRid] || [];
            statsByRoster[keyRid] = statsByRoster[keyRid] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
            let ptsOnly = null;
            try {
              if (earlyData) {
                const meta2 = rosterMap[String(ridOnly)] || {};
                const ownerLow = meta2.owner_name || meta2.owner_username ? String(meta2.owner_name || meta2.owner_username).toLowerCase() : null;
                const teamLow = meta2.team_name ? String(meta2.team_name).toLowerCase() : null;
                if (ownerLow && earlyData["2023"] && earlyData["2023"][String(week)]) {
                  const arr = earlyData["2023"][String(week)];
                  const found = (arr || []).find((e) => e.teamA && e.teamA.ownerName && String(e.teamA.ownerName).toLowerCase() === ownerLow || e.teamB && e.teamB.ownerName && String(e.teamB.ownerName).toLowerCase() === ownerLow || e.teamA && e.teamA.name && String(e.teamA.name).toLowerCase() === teamLow || e.teamB && e.teamB.name && String(e.teamB.name).toLowerCase() === teamLow);
                  if (found) {
                    if (found.teamA && found.teamA.ownerName && String(found.teamA.ownerName).toLowerCase() === ownerLow) ptsOnly = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                    else if (found.teamB && found.teamB.ownerName && String(found.teamB.ownerName).toLowerCase() === ownerLow) ptsOnly = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                    else if (found.teamA && found.teamA.name && String(found.teamA.name).toLowerCase() === teamLow) ptsOnly = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                    else if (found.teamB && found.teamB.name && String(found.teamB.name).toLowerCase() === teamLow) ptsOnly = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                  }
                }
              }
            } catch (e) {
              ptsOnly = null;
            }
            if (ptsOnly == null) ptsOnly = computeParticipantPoints(only);
            statsByRoster[keyRid].pf += ptsOnly;
            const meta = rosterMap[String(keyRid)] || {};
            const ownerKey = ownerKeyFromRosterMeta(meta) || "roster:" + keyRid;
            const ownerDisplay = meta.owner_username || meta.owner_name || null;
            const teamName = meta.team_name || null;
            const avatar = meta.team_avatar || meta.avatar || null;
            globalH2HCandidates.push({
              ownerKey,
              ownerDisplay,
              ownerAvatar: avatar,
              ownerTeam: teamName,
              opponentKey: null,
              opponentDisplay: null,
              opponentAvatar: null,
              opponentTeam: null,
              season: leagueSeason,
              week,
              ownerScore: ptsOnly,
              opponentScore: null
            });
            continue;
          }
          const participants = [];
          for (let e = 0; e < entries.length; e++) {
            const en = entries[e];
            const pid = en.roster_id ?? en.rosterId ?? en.owner_id ?? en.ownerId;
            const pidStr = String(pid);
            let ppts = null;
            if (earlyData) {
              try {
                const meta = rosterMap[pidStr] || {};
                const ownerLow = meta.owner_name || meta.owner_username ? String(meta.owner_name || meta.owner_username).toLowerCase() : null;
                const teamLow = meta.team_name ? String(meta.team_name).toLowerCase() : null;
                if (ownerLow && earlyData["2023"] && earlyData["2023"][String(week)]) {
                  const arr = earlyData["2023"][String(week)];
                  const found = (arr || []).find((e2) => e2.teamA && e2.teamA.ownerName && String(e2.teamA.ownerName).toLowerCase() === ownerLow || e2.teamB && e2.teamB.ownerName && String(e2.teamB.ownerName).toLowerCase() === ownerLow || e2.teamA && e2.teamA.name && String(e2.teamA.name).toLowerCase() === teamLow || e2.teamB && e2.teamB.name && String(e2.teamB.name).toLowerCase() === teamLow);
                  if (found) {
                    if (found.teamA && found.teamA.ownerName && String(found.teamA.ownerName).toLowerCase() === ownerLow) ppts = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                    else if (found.teamB && found.teamB.ownerName && String(found.teamB.ownerName).toLowerCase() === ownerLow) ppts = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                    else if (found.teamA && found.teamA.name && String(found.teamA.name).toLowerCase() === teamLow) ppts = safeNum(found.teamAScore ?? found.teamA?.score ?? found.teamA?.points ?? 0);
                    else if (found.teamB && found.teamB.name && String(found.teamB.name).toLowerCase() === teamLow) ppts = safeNum(found.teamBScore ?? found.teamB?.score ?? found.teamB?.points ?? 0);
                  }
                }
              } catch (e2) {
                ppts = null;
              }
            }
            if (ppts == null) ppts = computeParticipantPoints(en);
            participants.push({ rosterId: String(pid), points: ppts, rawEntry: en });
            paByRoster[String(pid)] = paByRoster[String(pid)] || 0;
            resultsByRoster[String(pid)] = resultsByRoster[String(pid)] || [];
            statsByRoster[String(pid)] = statsByRoster[String(pid)] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
            statsByRoster[String(pid)].pf += ppts;
          }
          for (let pi = 0; pi < participants.length; pi++) {
            const part = participants[pi];
            const opponents = [];
            for (let oi = 0; oi < participants.length; oi++) {
              if (oi === pi) continue;
              opponents.push(participants[oi]);
            }
            let oppAvg = 0;
            if (opponents.length) {
              for (let oa = 0; oa < opponents.length; oa++) oppAvg += opponents[oa].points;
              oppAvg = oppAvg / opponents.length;
            }
            paByRoster[part.rosterId] = paByRoster[part.rosterId] || 0;
            paByRoster[part.rosterId] += oppAvg;
            if (part.points > oppAvg + 1e-9) {
              resultsByRoster[part.rosterId].push("W");
              statsByRoster[part.rosterId].wins += 1;
            } else if (part.points < oppAvg - 1e-9) {
              resultsByRoster[part.rosterId].push("L");
              statsByRoster[part.rosterId].losses += 1;
            } else {
              resultsByRoster[part.rosterId].push("T");
              statsByRoster[part.rosterId].ties += 1;
            }
          }
          if (participants.length === 2) {
            const A = participants[0], B = participants[1];
            const pidA = A.rosterId, pidB = B.rosterId;
            const ptsA = A.points, ptsB = B.points;
            const margin = Math.abs(ptsA - ptsB);
            const metaA = rosterMap[pidA] || {};
            const metaB = rosterMap[pidB] || {};
            const ownerAKey = ownerKeyFromRosterMeta(metaA) || "roster:" + pidA;
            const ownerBKey = ownerKeyFromRosterMeta(metaB) || "roster:" + pidB;
            const ownerADisplay = metaA.owner_username || metaA.owner_name || null;
            const ownerBDisplay = metaB.owner_username || metaB.owner_name || null;
            const aTeamName = metaA.team_name || null;
            const bTeamName = metaB.team_name || null;
            const avatarA = metaA.team_avatar || metaA.avatar || null;
            const avatarB = metaB.team_avatar || metaB.avatar || null;
            globalH2HCandidates.push({
              ownerKey: ownerAKey,
              ownerDisplay: ownerADisplay,
              ownerAvatar: avatarA,
              ownerTeam: aTeamName,
              opponentKey: ownerBKey,
              opponentDisplay: ownerBDisplay,
              opponentAvatar: avatarB,
              opponentTeam: bTeamName,
              season: leagueSeason,
              week,
              ownerScore: ptsA,
              opponentScore: ptsB
            });
            globalH2HCandidates.push({
              ownerKey: ownerBKey,
              ownerDisplay: ownerBDisplay,
              ownerAvatar: avatarB,
              ownerTeam: bTeamName,
              opponentKey: ownerAKey,
              opponentDisplay: ownerADisplay,
              opponentAvatar: avatarA,
              opponentTeam: aTeamName,
              season: leagueSeason,
              week,
              ownerScore: ptsB,
              opponentScore: ptsA
            });
            globalMargins.push({
              season: leagueSeason,
              week,
              margin,
              teamAName: aTeamName || ownerADisplay || "Roster " + pidA,
              teamBName: bTeamName || ownerBDisplay || "Roster " + pidB,
              ownerA: ownerADisplay || ownerAKey,
              ownerB: ownerBDisplay || ownerBKey,
              avatarA,
              avatarB,
              scoreA: ptsA,
              scoreB: ptsB,
              source: leagueId
            });
          }
        }
      }
      const regularStandings = buildStandingsFromMaps(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular, rosterMap);
      const playoffStandings = buildStandingsFromMaps(statsByRosterPlayoff, resultsByRosterPlayoff, paByRosterPlayoff, rosterMap);
      try {
        if (leagueSeason != null) {
          const seasonKey = String(leagueSeason);
          if (HARDCODED_CHAMPIONS.hasOwnProperty(seasonKey)) {
            const championOwner = String(HARDCODED_CHAMPIONS[seasonKey]);
            const low = championOwner.toLowerCase();
            let rosterId = null;
            if (usernameToRoster[low]) rosterId = usernameToRoster[low];
            else if (ownerNameToRoster[low]) rosterId = ownerNameToRoster[low];
            if (rosterId) {
              const matchingRow = (playoffStandings || []).find(function(r) {
                return String(r.rosterId) === String(rosterId);
              });
              if (matchingRow) {
                matchingRow.champion = true;
                messages.push("Hardcoded champion applied for season " + seasonKey + ': owner "' + championOwner + '" -> roster ' + rosterId);
              } else {
                messages.push('Hardcoded champion owner "' + championOwner + '" mapped to roster ' + rosterId + " but roster not present in playoffStandings for season " + seasonKey + ".");
              }
            } else {
              messages.push('Hardcoded champion owner "' + championOwner + '" could not be mapped to a roster for season ' + seasonKey + ".");
            }
          }
        }
      } catch (hcErr) {
        messages.push("Error applying hardcoded champion for league " + leagueId + " — " + (hcErr && hcErr.message ? hcErr.message : String(hcErr)));
      }
      if (regularStandings && regularStandings.length || playoffStandings && playoffStandings.length) anyDataFound = true;
      seasonsResults.push({
        leagueId: String(leagueId),
        season: leagueSeason,
        leagueName,
        regularStandings,
        playoffStandings,
        rosterMap
        // keep the rosterMap so other post-processing can use it if needed
      });
    } catch (err) {
      messages.push("Error processing league " + leagueId + " — " + (err && err.message ? err.message : String(err)));
      seasonsResults.push({ leagueId: String(leagueId), error: err && err.message ? err.message : String(err) });
    }
  }
  if (!anyDataFound && messages.length === 0) messages.push("No data found for requested seasons.");
  const finalError = !anyDataFound ? "No roster/matchup data found for requested seasons. Details: " + (messages.length ? messages.join(" | ") : "no details") : null;
  function aggregateStandingsList(list, map) {
    if (!list || !Array.isArray(list)) return;
    for (const row of list) {
      if (!row) continue;
      let ownerLow = row.owner_name ? String(row.owner_name).toLowerCase() : null;
      if (ownerLow && OWNER_REPARENT[ownerLow]) {
        const mapped = OWNER_REPARENT[ownerLow];
        ownerLow = mapped;
        row.owner_name = OWNER_DISPLAY[mapped] || mapped;
      }
      let key = null;
      if (ownerLow) key = "owner:" + String(ownerLow).toLowerCase();
      else if (row.owner_id) key = "ownerid:" + String(row.owner_id);
      else if (row.rosterId) key = "roster:" + String(row.rosterId);
      else if (row.team_name) key = "team:" + String(row.team_name).toLowerCase();
      if (!key) continue;
      if (!map[key]) {
        map[key] = {
          rosterId: row.rosterId ?? row.roster_id ?? null,
          team_name: row.team_name ?? null,
          owner_name: row.owner_name ?? null,
          avatar: row.avatar ?? null,
          wins: 0,
          losses: 0,
          ties: 0,
          pf: 0,
          pa: 0,
          maxWinStreak: 0,
          maxLoseStreak: 0,
          seasonsCount: 0,
          championCount: 0
        };
      }
      const dest = map[key];
      dest.wins += Number(row.wins || 0);
      dest.losses += Number(row.losses || 0);
      dest.ties += Number(row.ties || 0);
      dest.pf += Number(row.pf || 0);
      dest.pa += Number(row.pa || 0);
      if (row.team_name) dest.team_name = row.team_name;
      if (row.owner_name) dest.owner_name = row.owner_name;
      if (row.avatar) dest.avatar = row.avatar;
      dest.maxWinStreak = Math.max(dest.maxWinStreak || 0, Number(row.maxWinStreak || 0));
      dest.maxLoseStreak = Math.max(dest.maxLoseStreak || 0, Number(row.maxLoseStreak || 0));
      if (row.champion === true) dest.championCount = (dest.championCount || 0) + 1;
      dest.seasonsCount = (dest.seasonsCount || 0) + 1;
    }
  }
  const regMap = {};
  const poMap = {};
  for (const sr of seasonsResults) {
    if (!sr) continue;
    const regular = sr.regularStandings ?? sr.regular ?? sr.standings ?? [];
    aggregateStandingsList(regular, regMap);
    const playoffs = sr.playoffStandings ?? sr.playoffs ?? [];
    aggregateStandingsList(playoffs, poMap);
  }
  const repartneredOwners = Object.keys(OWNER_REPARENT).map((k) => OWNER_REPARENT[k]);
  const uniqueRepartnered = [...new Set(repartneredOwners)];
  let repartnerApplied = false;
  for (const mapped of uniqueRepartnered) {
    const key = "owner:" + String(mapped).toLowerCase();
    if (regMap[key] || poMap[key]) {
      repartnerApplied = true;
      break;
    }
  }
  if (repartnerApplied) {
    const note = "Owners Bellooshio and cholybevv have been combined into JakePratt for aggregation.";
    ownershipNotes.push(note);
    messages.push(note);
  }
  const aggregatedRegular = Object.keys(regMap).map((k) => {
    const r = regMap[k];
    r.pf = Math.round((r.pf || 0) * 100) / 100;
    r.pa = Math.round((r.pa || 0) * 100) / 100;
    r.champion = (r.championCount || 0) > 0;
    r._aggKey = k;
    return r;
  });
  const aggregatedPlayoff = Object.keys(poMap).map((k) => {
    const r = poMap[k];
    r.pf = Math.round((r.pf || 0) * 100) / 100;
    r.pa = Math.round((r.pa || 0) * 100) / 100;
    r.champion = (r.championCount || 0) > 0;
    r._aggKey = k;
    return r;
  });
  aggregatedRegular.sort((a, b) => {
    const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
    if (wb !== wa) return wb - wa;
    return (b.pf || 0) - (a.pf || 0);
  });
  aggregatedPlayoff.sort((a, b) => {
    const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
    if (wb !== wa) return wb - wa;
    return (b.pf || 0) - (a.pf || 0);
  });
  function normalizeOwnerKey(rawKey) {
    if (!rawKey) return null;
    let k = String(rawKey);
    if (k.indexOf("owner:") === 0) {
      const inner = k.slice("owner:".length);
      if (OWNER_REPARENT[inner]) return "owner:" + OWNER_REPARENT[inner];
      return k;
    }
    const low = k.toLowerCase();
    if (OWNER_REPARENT[low]) return OWNER_REPARENT[low];
    return low;
  }
  const avatarLookup = {};
  const ownerDisplayLookup = {};
  const ownerTeamLookup = {};
  for (const row of aggregatedRegular.concat(aggregatedPlayoff)) {
    if (!row) continue;
    const key = row._aggKey || null;
    if (!key) continue;
    if (String(key).indexOf("owner:") === 0) {
      const ownerLow = String(key).slice("owner:".length);
      if (row.avatar) avatarLookup[ownerLow] = avatarLookup[ownerLow] || row.avatar;
      if (row.owner_name) ownerDisplayLookup[ownerLow] = ownerDisplayLookup[ownerLow] || row.owner_name;
      if (row.team_name) ownerTeamLookup[ownerLow] = ownerTeamLookup[ownerLow] || row.team_name;
    }
  }
  for (const sr of seasonsResults) {
    if (!sr || !sr.rosterMap) continue;
    for (const rk in sr.rosterMap) {
      if (!Object.prototype.hasOwnProperty.call(sr.rosterMap, rk)) continue;
      const meta = sr.rosterMap[rk] || {};
      const ownerKey = ownerKeyFromRosterMeta(meta);
      if (ownerKey && ownerKey.indexOf("owner:") === 0) {
        const low = ownerKey.slice("owner:".length);
        if (meta.team_avatar || meta.avatar) avatarLookup[low] = avatarLookup[low] || (meta.team_avatar || meta.avatar);
        if (meta.owner_name || meta.owner_username) ownerDisplayLookup[low] = ownerDisplayLookup[low] || (meta.owner_name || meta.owner_username);
        if (meta.team_name) ownerTeamLookup[low] = ownerTeamLookup[low] || meta.team_name;
      } else if (ownerKey && ownerKey.indexOf("ownerid:") === 0) ;
    }
  }
  const h2hMap = {};
  const ownersSet = /* @__PURE__ */ new Set();
  for (const cand of globalH2HCandidates) {
    if (!cand || !cand.ownerKey) continue;
    let ownerKeyRaw = cand.ownerKey;
    let ownerKey = normalizeOwnerKey(ownerKeyRaw);
    let opponentKey = cand.opponentKey ? normalizeOwnerKey(cand.opponentKey) : cand.opponentKey ? String(cand.opponentKey).toLowerCase() : null;
    if (typeof ownerKey === "string" && ownerKey.indexOf("owner:") === 0) ownerKey = ownerKey.slice("owner:".length);
    if (typeof opponentKey === "string" && opponentKey.indexOf("owner:") === 0) opponentKey = opponentKey.slice("owner:".length);
    if (ownerKey && OWNER_REPARENT[ownerKey]) ownerKey = OWNER_REPARENT[ownerKey];
    if (opponentKey && OWNER_REPARENT[opponentKey]) opponentKey = OWNER_REPARENT[opponentKey];
    if (!ownerKey) continue;
    ownersSet.add(ownerKey);
    if (!h2hMap[ownerKey]) h2hMap[ownerKey] = {};
    const oppKeyForMap = opponentKey || "__unknown_opponent__";
    if (!h2hMap[ownerKey][oppKeyForMap]) {
      h2hMap[ownerKey][oppKeyForMap] = {
        opponentKey,
        opponentDisplay: cand.opponentDisplay || null,
        opponentAvatar: cand.opponentAvatar || null,
        opponentTeam: cand.opponentTeam || null,
        wins: 0,
        losses: 0,
        games: 0,
        pf: 0,
        pa: 0,
        lastSeason: null,
        lastWeek: null
      };
    }
    const rec = h2hMap[ownerKey][oppKeyForMap];
    const ownerScore = safeNum(cand.ownerScore ?? 0);
    const oppScore = safeNum(cand.opponentScore ?? 0);
    if (ownerScore != null && oppScore != null && !isNaN(ownerScore) && !isNaN(oppScore)) {
      if (ownerScore > oppScore + 1e-9) rec.wins += 1;
      else if (ownerScore < oppScore - 1e-9) rec.losses += 1;
      rec.games += 1;
      rec.pf += ownerScore;
      rec.pa += oppScore;
    } else if (ownerScore != null) {
      rec.pf += ownerScore;
    }
    try {
      const snum = cand.season ? Number(cand.season) : null;
      const wnum = cand.week ? Number(cand.week) : null;
      let replace = false;
      if (rec.lastSeason == null) replace = true;
      else if (snum != null && wnum != null) {
        if (snum > Number(rec.lastSeason || 0)) replace = true;
        else if (snum === Number(rec.lastSeason || 0) && wnum > Number(rec.lastWeek || 0)) replace = true;
      }
      if (replace) {
        rec.lastSeason = cand.season;
        rec.lastWeek = cand.week;
      }
    } catch (e) {
    }
    if (!rec.opponentAvatar && cand.opponentAvatar) rec.opponentAvatar = cand.opponentAvatar;
    if (!rec.opponentTeam && cand.opponentTeam) rec.opponentTeam = cand.opponentTeam;
    if (!rec.opponentDisplay && cand.opponentDisplay) rec.opponentDisplay = cand.opponentDisplay;
  }
  const h2hRecords = {};
  for (const ownerKey of Object.keys(h2hMap)) {
    const arr = [];
    for (const ok in h2hMap[ownerKey]) {
      if (!Object.prototype.hasOwnProperty.call(h2hMap[ownerKey], ok)) continue;
      const r = h2hMap[ownerKey][ok];
      r.pf = Math.round((r.pf || 0) * 100) / 100;
      r.pa = Math.round((r.pa || 0) * 100) / 100;
      arr.push({
        opponentKey: r.opponentKey,
        opponentDisplay: r.opponentDisplay || (r.opponentTeam || "Opponent"),
        opponentAvatar: r.opponentAvatar || null,
        opponentTeam: r.opponentTeam || null,
        wins: r.wins || 0,
        losses: r.losses || 0,
        games: r.games || 0,
        pf: r.pf,
        pa: r.pa,
        lastSeason: r.lastSeason || null,
        lastWeek: r.lastWeek || null
      });
    }
    arr.sort((a, b) => {
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      if ((b.games || 0) !== (a.games || 0)) return (b.games || 0) - (a.games || 0);
      return (b.pf || 0) - (a.pf || 0);
    });
    h2hRecords[ownerKey] = arr;
  }
  for (const ownerKey of Object.keys(h2hRecords)) {
    const rows = h2hRecords[ownerKey];
    for (const r of rows) {
      let opp = null;
      if (r.opponentKey) {
        opp = String(r.opponentKey).toLowerCase();
        if (OWNER_REPARENT[opp]) opp = OWNER_REPARENT[opp];
      } else {
        opp = null;
      }
      if (opp && avatarLookup[opp]) r.opponentAvatar = r.opponentAvatar || avatarLookup[opp];
      if (opp) {
        const teamNameLatest = ownerTeamLookup[opp] || ownerDisplayLookup[opp] || null;
        const ownerDisplayLatest = ownerDisplayLookup[opp] || null;
        if (teamNameLatest) {
          r.opponentTeam = teamNameLatest;
          r.opponentDisplay = ownerDisplayLatest || r.opponentDisplay || null;
        } else {
          r.opponentTeam = r.opponentTeam || r.opponentDisplay || null;
        }
      } else {
        r.opponentTeam = r.opponentTeam || r.opponentDisplay || "Opponent";
      }
    }
  }
  const h2hOwners = Array.from(ownersSet).map((k) => {
    const key = String(k).toLowerCase();
    const display = ownerDisplayLookup[key] || key;
    const team = ownerTeamLookup[key] || null;
    const avatar = avatarLookup[key] || null;
    const remapped = OWNER_REPARENT[key] ? OWNER_REPARENT[key] : key;
    const label = team ? String(team) : display;
    return {
      key: remapped,
      display: OWNER_DISPLAY[remapped] || display,
      team,
      avatar,
      label
    };
  }).sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
  for (const m of globalMargins) {
    if (!m) continue;
    const ownerAKey = m.ownerA && String(m.ownerA).toLowerCase() || null;
    const ownerBKey = m.ownerB && String(m.ownerB).toLowerCase() || null;
    if (ownerAKey && OWNER_REPARENT[ownerAKey]) {
      const mapped = OWNER_REPARENT[ownerAKey];
      if (avatarLookup[mapped]) m.avatarA = avatarLookup[mapped];
    }
    if (ownerBKey && OWNER_REPARENT[ownerBKey]) {
      const mapped = OWNER_REPARENT[ownerBKey];
      if (avatarLookup[mapped]) m.avatarB = avatarLookup[mapped];
    }
    const lowA = m.ownerA ? String(m.ownerA).toLowerCase() : null;
    const lowB = m.ownerB ? String(m.ownerB).toLowerCase() : null;
    if (lowA && !m.avatarA && avatarLookup[lowA]) m.avatarA = avatarLookup[lowA];
    if (lowB && !m.avatarB && avatarLookup[lowB]) m.avatarB = avatarLookup[lowB];
  }
  const marginsSortedDesc = globalMargins.slice().filter((x) => x && typeof x.margin === "number").sort((a, b) => b.margin - a.margin);
  const marginsLargest = marginsSortedDesc.slice(0, 10).map((m, idx) => {
    return {
      rank: idx + 1,
      margin: Math.round((m.margin || 0) * 100) / 100,
      season: m.season,
      week: m.week,
      teamAName: m.teamAName,
      teamBName: m.teamBName,
      ownerA: m.ownerA,
      ownerB: m.ownerB,
      avatarA: m.avatarA || null,
      avatarB: m.avatarB || null,
      scoreA: m.scoreA,
      scoreB: m.scoreB
    };
  });
  const marginsSortedAsc = globalMargins.slice().filter((x) => x && typeof x.margin === "number" && x.margin >= 0).sort((a, b) => a.margin - b.margin);
  const marginsNonZero = marginsSortedAsc.filter((m) => m.margin > 0);
  const marginsSmallest = marginsNonZero.slice(0, 10).map((m, idx) => {
    return {
      rank: idx + 1,
      margin: Math.round((m.margin || 0) * 100) / 100,
      season: m.season,
      week: m.week,
      teamAName: m.teamAName,
      teamBName: m.teamBName,
      ownerA: m.ownerA,
      ownerB: m.ownerB,
      avatarA: m.avatarA || null,
      avatarB: m.avatarB || null,
      scoreA: m.scoreA,
      scoreB: m.scoreB
    };
  });
  return {
    seasons,
    selectedSeason: selectedSeasonParam,
    seasonsResults,
    aggregatedRegular,
    aggregatedPlayoff,
    jsonLinks,
    ownershipNotes,
    error: finalError,
    messages,
    prevChain,
    h2hOwners,
    h2hRecords,
    marginsLargest,
    marginsSmallest
  };
}
export {
  load
};
