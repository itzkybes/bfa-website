// src/routes/rosters/+page.server.js
// Returns enriched rosters for the current (most recent) season + players map.
// Keeps robust fallbacks and debug messages.

import { createSleeperClient } from '$lib/server/sleeperClient';
import { createMemoryCache, createKVCache } from '$lib/server/cache';

var cache;
try {
  if (typeof globalThis !== 'undefined' && globalThis.KV) cache = createKVCache(globalThis.KV);
  else cache = createMemoryCache();
} catch (e) {
  cache = createMemoryCache();
}

var SLEEPER_CONCURRENCY = Number(process.env.SLEEPER_CONCURRENCY) || 8;
var sleeper = createSleeperClient({ cache: cache, concurrency: SLEEPER_CONCURRENCY });

var BASE_LEAGUE_ID = (typeof process !== 'undefined' && process.env && process.env.BASE_LEAGUE_ID) ? process.env.BASE_LEAGUE_ID : '1219816671624048640';
var CACHE_TTL = Number(process.env.ROSTERS_CACHE_TTL) || 60 * 5;
var MAX_WEEKS = Number(process.env.MAX_WEEKS) || 25;

function safeNum(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

export async function load(event) {
  event.setHeaders({ 'cache-control': 's-maxage=120, stale-while-revalidate=300' });

  var url = event.url;
  // keep compatibility: allow explicit season query param, but default to "current"
  var selectedSeasonParam = url.searchParams.get('season') || 'current';
  var messages = [];
  var prevChain = [];

  // Build seasons chain (same as other loaders)
  var seasons = [];
  try {
    var mainLeague = null;
    try { mainLeague = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { messages.push('Failed fetching base league: ' + (e && e.message ? e.message : e)); console.error(e); }
    if (mainLeague) {
      seasons.push({ league_id: String(mainLeague.league_id || BASE_LEAGUE_ID), season: mainLeague.season || null, name: mainLeague.name || null });
      prevChain.push(String(mainLeague.league_id || BASE_LEAGUE_ID));
      var currPrev = mainLeague.previous_league_id ? String(mainLeague.previous_league_id) : null;
      var steps = 0;
      while (currPrev && steps < 50) {
        steps++;
        try {
          var prevLeague = await sleeper.getLeague(currPrev, { ttl: 60 * 5 });
          if (!prevLeague) { messages.push('Could not fetch previous_league_id ' + currPrev); break; }
          seasons.push({ league_id: String(prevLeague.league_id || currPrev), season: prevLeague.season || null, name: prevLeague.name || null });
          prevChain.push(String(prevLeague.league_id || currPrev));
          currPrev = prevLeague.previous_league_id ? String(prevLeague.previous_league_id) : null;
        } catch (err) { messages.push('Error fetching previous_league_id: ' + currPrev + ' — ' + (err && err.message ? err.message : err)); console.error(err); break; }
      }
    }
  } catch (err) { messages.push('Error building seasons chain: ' + (err && err.message ? err.message : err)); console.error(err); }

  // dedupe & sort by season (earliest -> latest)
  var byId = {};
  for (var sIdx = 0; sIdx < seasons.length; sIdx++) byId[String(seasons[sIdx].league_id)] = seasons[sIdx];
  seasons = [];
  for (var k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) seasons.push(byId[k]);
  seasons.sort(function (a, b) {
    if (a.season == null && b.season == null) return 0;
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    var na = Number(a.season), nb = Number(b.season);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.season < b.season ? -1 : 1;
  });

  // choose the league to show:
  // - if selectedSeasonParam is 'current' or missing, pick the most recent season from seasons array
  // - if user provided a season id, try to use it
  var leagueIdToProcess = null;
  if (!selectedSeasonParam || selectedSeasonParam === 'current' || selectedSeasonParam === 'all') {
    if (seasons.length === 0) leagueIdToProcess = BASE_LEAGUE_ID;
    else leagueIdToProcess = String(seasons[seasons.length - 1].league_id); // most recent
  } else {
    // if they passed a league id or season string, try to match by league id first, then by season
    var matched = false;
    for (var i = 0; i < seasons.length; i++) {
      if (String(seasons[i].league_id) === String(selectedSeasonParam)) { leagueIdToProcess = String(seasons[i].league_id); matched = true; break; }
    }
    if (!matched) {
      for (var j = 0; j < seasons.length; j++) {
        if (String(seasons[j].season) === String(selectedSeasonParam)) { leagueIdToProcess = String(seasons[j].league_id); matched = true; break; }
      }
    }
    if (!matched) leagueIdToProcess = String(selectedSeasonParam);
  }

  var dataPayload = {
    seasons: seasons,
    selectedSeason: selectedSeasonParam,
    prevChain: prevChain,
    messages: messages
  };

  // fetch players map for NBA (used by UI to resolve player names)
  var playersMap = {};
  try {
    // use client's rawFetch (it has rate limiting + retries)
    var rawPlayers = await sleeper.rawFetch(`/players/nba`);
    // rawPlayers can be an object mapping player_id -> player object (Sleeper returns an object)
    if (rawPlayers && typeof rawPlayers === 'object') playersMap = rawPlayers;
    else playersMap = {};
    messages.push('Loaded players dataset (' + Object.keys(playersMap).length + ')');
  } catch (e) {
    playersMap = {};
    messages.push('Failed to load players dataset: ' + (e && e.message ? e.message : e));
    console.error('rosters: players fetch failed', e);
  }

  // Now build roster list for the chosen league only
  var resultLeague = {
    leagueId: String(leagueIdToProcess),
    season: null,
    leagueName: null,
    rosters: []
  };

  try {
    var leagueMeta = null;
    try { leagueMeta = await sleeper.getLeague(leagueIdToProcess, { ttl: 60 * 5 }); } catch (e) { leagueMeta = null; }
    if (leagueMeta) {
      resultLeague.season = leagueMeta.season ? String(leagueMeta.season) : null;
      resultLeague.leagueName = leagueMeta.name || null;
    }

    // Try main enrichment path (map)
    var rosterMap = {};
    try {
      rosterMap = await sleeper.getRosterMapWithOwners(leagueIdToProcess, { ttl: CACHE_TTL });
      if (!rosterMap || Object.keys(rosterMap).length === 0) {
        messages.push('rosterMapWithOwners empty; falling back to getRostersWithOwners.');
        var arr = await sleeper.getRostersWithOwners(leagueIdToProcess, { ttl: CACHE_TTL });
        if (Array.isArray(arr) && arr.length) {
          rosterMap = {};
          for (var ai = 0; ai < arr.length; ai++) { var e = arr[ai]; if (e && e.roster_id != null) rosterMap[String(e.roster_id)] = e; }
          messages.push('getRostersWithOwners returned ' + arr.length);
        } else {
          messages.push('getRostersWithOwners empty; falling back to raw rosters+users enrichment.');
          // raw fallback
          var rawRosters = [];
          var rawUsers = [];
          try { rawRosters = await sleeper.getRosters(leagueIdToProcess, { ttl: CACHE_TTL }) || []; } catch (e) { rawRosters = []; messages.push('raw getRosters failed: ' + (e && e.message ? e.message : e)); console.error(e); }
          try { rawUsers = await sleeper.getUsers(leagueIdToProcess, { ttl: CACHE_TTL }) || []; } catch (e) { rawUsers = []; messages.push('raw getUsers failed: ' + (e && e.message ? e.message : e)); console.error(e); }
          var usersById = {};
          if (Array.isArray(rawUsers)) {
            for (var u = 0; u < rawUsers.length; u++) { var uu = rawUsers[u]; var id = uu.user_id ?? uu.userId ?? uu.id; if (id != null) usersById[String(id)] = uu; }
          }
          if (Array.isArray(rawRosters)) {
            for (var rr = 0; rr < rawRosters.length; rr++) {
              var rrr = rawRosters[rr];
              var rid = rrr.roster_id ?? rrr.id ?? rrr.rosterId;
              var ownerId = rrr.owner_id ?? rrr.ownerId ?? null;
              var uobj = ownerId != null ? usersById[String(ownerId)] : null;
              // team name heuristics
              var teamName = null;
              if (rrr && rrr.metadata && rrr.metadata.team_name) teamName = rrr.metadata.team_name;
              if (!teamName && uobj) {
                if (uobj.metadata && uobj.metadata.team_name) teamName = uobj.metadata.team_name;
                else if (uobj.display_name) teamName = `${uobj.display_name}'s Team`;
                else if (uobj.username) teamName = `${uobj.username}'s Team`;
              }
              if (!teamName) teamName = 'Roster ' + String(rid);
              // avatars
              var teamAvatar = null;
              try { if (rrr && rrr.metadata && rrr.metadata.team_avatar) teamAvatar = (String(rrr.metadata.team_avatar).indexOf('http') === 0 ? String(rrr.metadata.team_avatar) : 'https://sleepercdn.com/avatars/' + String(rrr.metadata.team_avatar)); } catch(e){}
              var ownerAvatar = null;
              if (uobj) {
                try { if (uobj.metadata && uobj.metadata.team_avatar) ownerAvatar = (String(uobj.metadata.team_avatar).indexOf('http') === 0 ? String(uobj.metadata.team_avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.metadata.team_avatar)); } catch(e){}
                if (!ownerAvatar) try { if (uobj.metadata && uobj.metadata.avatar) ownerAvatar = (String(uobj.metadata.avatar).indexOf('http') === 0 ? String(uobj.metadata.avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.metadata.avatar)); } catch(e){}
                if (!ownerAvatar) try { if (uobj.avatar) ownerAvatar = (String(uobj.avatar).indexOf('http') === 0 ? String(uobj.avatar) : 'https://sleepercdn.com/avatars/' + String(uobj.avatar)); } catch(e){}
              }
              rosterMap[String(rid)] = {
                roster_id: rid != null ? String(rid) : null,
                owner_id: ownerId != null ? String(ownerId) : null,
                team_name: teamName,
                owner_name: uobj ? (uobj.display_name || uobj.username || null) : null,
                team_avatar: teamAvatar,
                owner_avatar: ownerAvatar,
                roster_raw: rrr,
                user_raw: uobj || null
              };
            }
            messages.push('Built rosterMap from raw rosters/users: ' + (rawRosters ? rawRosters.length : 0));
          }
        }
      } else {
        messages.push('rosterMapWithOwners returned ' + Object.keys(rosterMap).length + ' entries for league ' + leagueIdToProcess);
      }
    } catch (e) {
      messages.push('Error obtaining rosterMapWithOwners: ' + (e && e.message ? e.message : e));
      console.error(e);
      rosterMap = {};
    }

    // Build normalized roster array, attach player ids and resolved player objects where possible
    var normalized = [];
    if (rosterMap && Object.keys(rosterMap).length) {
      for (var ridk in rosterMap) {
        if (!Object.prototype.hasOwnProperty.call(rosterMap, ridk)) continue;
        var m = rosterMap[ridk];
        // roster players come from m.roster_raw.players (Sleeper roster structure)
        var playerIds = (m.roster_raw && Array.isArray(m.roster_raw.players)) ? m.roster_raw.players.slice() : (m.roster_raw && Array.isArray(m.roster_raw.player_ids) ? m.roster_raw.player_ids.slice() : []);
        // build players array from playersMap
        var playersArr = [];
        if (playerIds && playerIds.length && playersMap) {
          for (var pi = 0; pi < playerIds.length; pi++) {
            var pid = playerIds[pi];
            if (!pid) continue;
            var pobj = null;
            try { pobj = playersMap[pid] || playersMap[pid.toUpperCase()] || null; } catch(e){ pobj = null; }
            // normalize minimal fields so UI can rely on them
            if (pobj && typeof pobj === 'object') {
              playersArr.push({
                player_id: pobj.player_id || pid,
                full_name: pobj.full_name || `${pobj.first_name || ''} ${pobj.last_name || ''}`.trim(),
                team: pobj.team || pobj.team_abbreviation || 'FA',
                positions: pobj.fantasy_positions || pobj.position || []
              });
            } else {
              playersArr.push({ player_id: pid, full_name: pid, team: '', positions: [] });
            }
          }
        }
        normalized.push({
          rosterId: m.roster_id,
          owner_id: m.owner_id,
          team_name: m.team_name,
          owner_name: m.owner_name,
          team_avatar: m.team_avatar,
          owner_avatar: m.owner_avatar,
          player_ids: playerIds,
          players: playersArr,
          raw: m.roster_raw || null,
          user_raw: m.user_raw || null
        });
      }
    }

    // fallback: if normalized empty, try raw rosters + players mapping
    if ((!normalized || normalized.length === 0)) {
      try {
        var rawRosters2 = await sleeper.getRosters(leagueIdToProcess, { ttl: CACHE_TTL }) || [];
        var rawUsers2 = await sleeper.getUsers(leagueIdToProcess, { ttl: CACHE_TTL }) || [];
        var usersById2 = {};
        for (var u2 = 0; u2 < rawUsers2.length; u2++) { var uu2 = rawUsers2[u2]; var id2 = uu2.user_id ?? uu2.userId ?? uu2.id; if (id2 != null) usersById2[String(id2)] = uu2; }
        for (var rr2 = 0; rr2 < (rawRosters2 || []).length; rr2++) {
          var rinfo = rawRosters2[rr2];
          var rid2 = rinfo.roster_id ?? rinfo.id ?? rinfo.rosterId;
          var owner2 = rinfo.owner_id ?? rinfo.ownerId ?? null;
          var uo = owner2 != null ? usersById2[String(owner2)] : null;
          var teamname = (rinfo && rinfo.metadata && rinfo.metadata.team_name) ? rinfo.metadata.team_name : (uo ? (uo.metadata && uo.metadata.team_name ? uo.metadata.team_name : (uo.display_name || uo.username || (`Roster ${rid2}`))) : (`Roster ${rid2}`));
          var tav = null;
          try { if (rinfo && rinfo.metadata && rinfo.metadata.team_avatar) tav = (String(rinfo.metadata.team_avatar).indexOf('http') === 0 ? String(rinfo.metadata.team_avatar) : 'https://sleepercdn.com/avatars/' + String(rinfo.metadata.team_avatar)); } catch(e){}
          var oav = null;
          if (uo) {
            try { if (uo.metadata && uo.metadata.team_avatar) oav = (String(uo.metadata.team_avatar).indexOf('http') === 0 ? String(uo.metadata.team_avatar) : 'https://sleepercdn.com/avatars/' + String(uo.metadata.team_avatar)); } catch(e){}
            if (!oav) try { if (uo.metadata && uo.metadata.avatar) oav = (String(uo.metadata.avatar).indexOf('http') === 0 ? String(uo.metadata.avatar) : 'https://sleepercdn.com/avatars/' + String(uo.metadata.avatar)); } catch(e){}
            if (!oav) try { if (uo.avatar) oav = (String(uo.avatar).indexOf('http') === 0 ? String(uo.avatar) : 'https://sleepercdn.com/avatars/' + String(uo.avatar)); } catch(e){}
          }
          var playerIds2 = (rinfo && Array.isArray(rinfo.players)) ? rinfo.players.slice() : [];
          var playersArr2 = [];
          for (var pidx = 0; pidx < (playerIds2 || []).length; pidx++) {
            var pid2 = playerIds2[pidx];
            var pobj2 = (playersMap && playersMap[pid2]) ? playersMap[pid2] : null;
            if (pobj2) playersArr2.push({ player_id: pobj2.player_id || pid2, full_name: pobj2.full_name || (`${pobj2.first_name||''} ${pobj2.last_name||''}`).trim(), team: pobj2.team || 'FA', positions: pobj2.fantasy_positions || [] });
            else playersArr2.push({ player_id: pid2, full_name: pid2, team: '', positions: [] });
          }
          normalized.push({
            rosterId: rid2 != null ? String(rid2) : null,
            owner_id: owner2 != null ? String(owner2) : null,
            team_name: teamname,
            owner_name: uo ? (uo.display_name || uo.username || null) : null,
            team_avatar: tav,
            owner_avatar: oav,
            player_ids: playerIds2,
            players: playersArr2,
            raw: rinfo,
            user_raw: uo || null
          });
        }
        if (normalized && normalized.length) messages.push('Built normalized roster list from raw rosters/users (fallback).');
      } catch (e) {
        messages.push('Fallback raw rosters/users fetch failed: ' + (e && e.message ? e.message : e));
        console.error(e);
      }
    }

    resultLeague.rosters = normalized;
  } catch (err) {
    messages.push('Error processing league ' + leagueIdToProcess + ': ' + (err && err.message ? err.message : err));
    console.error('rosters: league error', leagueIdToProcess, err);
    resultLeague.error = (err && err.message ? err.message : String(err));
  }

  // return shape:
  // { seasons, selectedSeason, prevChain, messages, players (map), data: [ { leagueId, season, leagueName, rosters: [...] } ] }
  dataPayload.players = playersMap;
  dataPayload.data = [ resultLeague ];
  dataPayload.error = (!resultLeague.rosters || resultLeague.rosters.length === 0) ? ('No rosters found. Details: ' + (messages.length ? messages.join(' | ') : 'no details')) : null;
  dataPayload.anyFound = (resultLeague.rosters && resultLeague.rosters.length > 0);

  return dataPayload;
}
