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

/**
 * FINAL STANDINGS (owner display_name arrays) — provided by you for seeding.
 */
const FINAL_STANDINGS = {
  '2024': [
    'riguy506','smallvt','JakePratt','Kybes',
    'TLupinetti','samsilverman12','armyjunior','JFK4312',
    'WebbWarrior','slawflesh','jewishhorsemen','noahlap01',
    'zamt','WillMichael'
  ],
  '2023': [
    'armyjunior','jewishhorsemen','Kybes','riguy506',
    'zamt','slawflesh','JFK4312','smallvt',
    'samsilverman12','WebbWarrior','TLupinetti','noahlap01',
    'JakePratt','WillMichael'
  ],
  '2022': [
    'riguy506','smallvt','jewishhorsemen','zamt',
    'noahlap01','Kybes','armyjunior','slawflesh',
    'WillMichael','JFK4312','WebbWarrior','TLupinetti',
    'JakePratt','samsilverman12'
  ]
};

export async function load(event) {
  // caching for edge
  event.setHeaders({ 'cache-control': 's-maxage=60, stale-while-revalidate=120' });

  const messages = [];
  let seasons = [];

  // Build seasons chain starting from BASE_LEAGUE_ID (same logic used previously)
  try {
    let main = null;
    try { main = await sleeper.getLeague(BASE_LEAGUE_ID, { ttl: 60 * 5 }); } catch (e) { main = null; messages.push('Failed fetch base league: ' + (e?.message ?? e)); }
    if (main) {
      seasons.push({ league_id: String(main.league_id), season: main.season ?? null, name: main.name ?? null });
      let prev = main.previous_league_id ? String(main.previous_league_id) : null;
      let steps = 0;
      while (prev && steps < 50) {
        steps++;
        try {
          const p = await sleeper.getLeague(prev, { ttl: 60 * 5 });
          if (!p) { messages.push('Could not fetch prev league ' + prev); break; }
          seasons.push({ league_id: String(p.league_id), season: p.season ?? null, name: p.name ?? null });
          prev = p.previous_league_id ? String(p.previous_league_id) : null;
        } catch (err) {
          messages.push('Error fetching prev league ' + prev + ' — ' + (err?.message ?? String(err)));
          break;
        }
      }
    }
  } catch (err) {
    messages.push('Error building seasons chain: ' + (err?.message ?? String(err)));
  }

  // determine selected season param and selected league id
  const url = event.url;
  const seasonParam = url.searchParams.get('season') ?? null;
  let selectedSeason = seasonParam;
  if (!selectedSeason && seasons.length) selectedSeason = seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id;

  let selectedLeagueId = null;
  for (const s of seasons) {
    if (String(s.season) === String(selectedSeason) || String(s.league_id) === String(selectedSeason)) {
      selectedLeagueId = String(s.league_id);
      selectedSeason = s.season ?? selectedSeason;
      break;
    }
  }
  if (!selectedLeagueId && seasons.length) selectedLeagueId = seasons[seasons.length - 1].league_id;

  // fetch league meta to read playoff start
  let leagueMeta = null;
  try { leagueMeta = selectedLeagueId ? await sleeper.getLeague(selectedLeagueId, { ttl: 60 * 5 }) : null; } catch (e) { leagueMeta = null; messages.push('Failed fetch league meta: ' + (e?.message ?? e)); }

  let playoffStart = null;
  if (leagueMeta && leagueMeta.settings) {
    playoffStart = Number(leagueMeta.settings.playoff_week_start ?? leagueMeta.settings.playoff_start_week ?? leagueMeta.settings.playoffStartWeek ?? 0) || null;
  }
  if (!playoffStart) {
    playoffStart = Math.max(1, MAX_WEEKS - 2);
    messages.push('Playoff start not found; defaulting to week ' + playoffStart);
  }
  const playoffEnd = Math.min(MAX_WEEKS, playoffStart + 2);

  // roster map
  let rosterMap = {};
  try {
    if (selectedLeagueId) {
      rosterMap = await sleeper.getRosterMapWithOwners(selectedLeagueId, { ttl: 60 * 5 });
      messages.push(`Loaded rosters (${Object.keys(rosterMap).length})`);
    }
  } catch (e) {
    rosterMap = {};
    messages.push('Failed fetch roster map: ' + (e?.message ?? e));
  }

  // fetch matchups for playoff weeks
  let rawMatchups = [];
  try {
    if (selectedLeagueId) {
      for (let wk = playoffStart; wk <= playoffEnd; wk++) {
        try {
          const m = await sleeper.getMatchupsForWeek(selectedLeagueId, wk, { ttl: 60 * 5 });
          if (Array.isArray(m) && m.length) {
            for (const mm of m) {
              if (mm && (mm.week == null && mm.w == null)) mm.week = wk;
              rawMatchups.push(mm);
            }
          }
        } catch (we) {
          messages.push(`Failed fetch matchups for week ${wk}: ${we?.message ?? we}`);
        }
      }
    }
  } catch (err) {
    messages.push('Failed fetching playoff matchups: ' + (err?.message ?? err));
  }

  // normalize matchups into rows (same approach as earlier)
  const byMatch = {};
  for (let i = 0; i < rawMatchups.length; i++) {
    const e = rawMatchups[i];
    const mid = e.matchup_id ?? e.matchupId ?? e.matchup ?? null;
    const wk = e.week ?? e.w ?? playoffStart;
    const key = mid != null ? `${mid}|${wk}` : `auto|${wk}|${i}`;
    if (!byMatch[key]) byMatch[key] = [];
    byMatch[key].push(e);
  }

  const matchupsRows = [];
  for (const k of Object.keys(byMatch)) {
    const entries = byMatch[k];
    if (!entries || entries.length === 0) continue;
    if (entries.length === 1) {
      const a = entries[0];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const aMeta = rosterMap[aId] || {};
      matchupsRows.push({
        matchup_id: k, season: selectedSeason ?? null, week: a.week ?? a.w ?? playoffStart,
        teamA: { rosterId: aId, name: aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: safeNum(a.points ?? a.points_for ?? a.pts ?? null) },
        teamB: { rosterId: null, name: 'BYE', avatar: null, points: null }, participantsCount: 1
      });
      continue;
    }
    if (entries.length === 2) {
      const a = entries[0], b = entries[1];
      const aId = String(a.roster_id ?? a.rosterId ?? a.owner_id ?? a.ownerId ?? 'unknownA');
      const bId = String(b.roster_id ?? b.rosterId ?? b.owner_id ?? b.ownerId ?? 'unknownB');
      const aMeta = rosterMap[aId] || {}, bMeta = rosterMap[bId] || {};
      matchupsRows.push({
        matchup_id: k, season: selectedSeason ?? null, week: a.week ?? a.w ?? playoffStart,
        teamA: { rosterId: aId, name: aMeta.team_name || aMeta.owner_name || ('Roster ' + aId), avatar: aMeta.team_avatar || aMeta.owner_avatar || null, points: safeNum(a.points ?? a.points_for ?? a.pts ?? null) },
        teamB: { rosterId: bId, name: bMeta.team_name || bMeta.owner_name || ('Roster ' + bId), avatar: bMeta.team_avatar || bMeta.owner_avatar || null, points: safeNum(b.points ?? b.points_for ?? b.pts ?? null) },
        participantsCount: 2
      });
    } else {
      const participants = entries.map(ent => {
        const pid = String(ent.roster_id ?? ent.rosterId ?? ent.owner_id ?? ent.ownerId ?? 'r');
        const meta = rosterMap[pid] || {};
        return { rosterId: pid, name: meta.team_name || meta.owner_name || ('Roster ' + pid), avatar: meta.team_avatar || meta.owner_avatar || null, points: safeNum(ent.points ?? ent.points_for ?? ent.pts ?? 0) };
      });
      matchupsRows.push({
        matchup_id: k, season: selectedSeason ?? null, week: entries[0].week ?? entries[0].w ?? playoffStart,
        combinedParticipants: participants, combinedLabel: participants.map(p=>p.name).join(' / '), participantsCount: participants.length
      });
    }
  }

  // Helper: find roster id by display name (owner/team) using rosterMap
  function findRosterByDisplayName(displayName) {
    if (!displayName) return null;
    const needle = String(displayName).toLowerCase();
    for (const rid of Object.keys(rosterMap || {})) {
      const m = rosterMap[rid] || {};
      const ownerName = (m.owner_name || '').toLowerCase();
      const teamName = (m.team_name || '').toLowerCase();
      if (ownerName && ownerName === needle) return String(rid);
      if (teamName && teamName === needle) return String(rid);
      if (ownerName && ownerName.includes(needle)) return String(rid);
      if (teamName && teamName.includes(needle)) return String(rid);
    }
    return null;
  }

  // Helper: find matchupsRows entry for roster pair (order-agnostic). Accept an array of weeks to search (priority order).
  function findMatchupRowForPair(rosterA, rosterB, weeks = [playoffStart, playoffStart+1, playoffStart+2]) {
    if (!rosterA || !rosterB) return null;
    const a = String(rosterA), b = String(rosterB);
    // search prioritized by week order passed
    for (const wk of weeks) {
      for (const row of matchupsRows) {
        if (!row || row.participantsCount !== 2) continue;
        if (String(row.week) !== String(wk)) continue;
        const rA = String(row.teamA.rosterId), rB = String(row.teamB.rosterId);
        if ((rA === a && rB === b) || (rA === b && rB === a)) return row;
      }
    }
    // fallback: search any week
    for (const row of matchupsRows) {
      if (!row || row.participantsCount !== 2) continue;
      const rA = String(row.teamA.rosterId), rB = String(row.teamB.rosterId);
      if ((rA === a && rB === b) || (rA === b && rB === a)) return row;
    }
    return null;
  }

  // Helper to pick winner rosterId from a matchup row (fallback to higher seed when no score)
  function winnerFromRow(row, preferHigherSeed = null) {
    if (!row) return null;
    const aPts = safeNum(row.teamA.points ?? 0);
    const bPts = safeNum(row.teamB.points ?? 0);
    if (aPts > bPts + 1e-9) return String(row.teamA.rosterId);
    if (bPts > aPts + 1e-9) return String(row.teamB.rosterId);
    // tie / no scores: if preferHigherSeed is provided, use it; else prefer teamA
    if (preferHigherSeed) return String(preferHigherSeed);
    return String(row.teamA.rosterId);
  }

  // Build seeds array for winners bracket from FINAL_STANDINGS for the selected season (display-name -> rosterId)
  const yearKey = selectedSeason ? String(selectedSeason) : null;
  const finalStandingsForYear = (yearKey && FINAL_STANDINGS[yearKey]) ? FINAL_STANDINGS[yearKey] : null;
  let seeds = []; // ordered rosterIds, 1-based seed at index 0 -> seed1
  if (finalStandingsForYear) {
    for (let i = 0; i < finalStandingsForYear.length; i++) {
      const display = finalStandingsForYear[i];
      const rid = findRosterByDisplayName(display);
      if (rid) seeds.push(String(rid));
      else {
        // fallback: if rosterMap still contains entries not used, push the first unused roster id
        const allIds = Object.keys(rosterMap || {});
        const unused = allIds.filter(x => !seeds.includes(String(x)));
        if (unused.length) seeds.push(String(unused[0]));
      }
    }
  } else {
    // fallback: use rosterMap roster order
    seeds = Object.keys(rosterMap || {}).slice();
  }

  // bracket builders
  function buildWinnersAndLosers(seedsArr) {
    const winners = [];
    const losers = [];

    // determine winners bracket size (2022 special-case = top 6 in winners bracket; else 8)
    const is2022 = yearKey === '2022';
    const winnersSize = is2022 ? 6 : 8;

    // if not enough seeds, fallback to seedsArr length
    const N = Math.min(winnersSize, seedsArr.length);

    // map seed -> roster
    const seeded = seedsArr.slice(0, N); // seed1 = seeded[0]
    // helper get seed roster
    const seed = (n) => seeded[n - 1] ?? null;

    // weeks mapping: quarter = playoffStart, semi = playoffStart+1, final = playoffStart+2
    const qW = playoffStart, sW = playoffStart + 1, fW = playoffStart + 2;
    // winners rounds
    const winnerRounds = [];

    if (is2022 && N === 6) {
      // Quarterfinals: 3v6 and 4v5
      const qMatches = [
        { seedA: 3, seedB: 6, label: 'Quarterfinals' },
        { seedA: 4, seedB: 5, label: 'Quarterfinals' }
      ].map(m => {
        const a = seed(m.seedA), b = seed(m.seedB);
        const row = findMatchupRowForPair(a, b, [qW, sW, fW]);
        const winner = row ? winnerFromRow(row) : (a || b);
        return { label: 'Quarterfinals', week: qW, seedA: m.seedA, seedB: m.seedB, rosterA: a, rosterB: b, row, winner };
      });
      winnerRounds.push({ label: 'Quarterfinals', week: qW, matches: qMatches });

      // Semifinals: seed1 vs winner(4v5), seed2 vs winner(3v6) — highest seed plays lowest seed among winners
      const winner1 = winnerRounds[0].matches[0].winner; // winner of 3v6
      const winner2 = winnerRounds[0].matches[1].winner; // winner of 4v5
      const semiMatches = [
        { seedA: 1, seedB: null, rosterA: seed(1), rosterB: winner2, label: 'Semifinals' },
        { seedA: 2, seedB: null, rosterA: seed(2), rosterB: winner1, label: 'Semifinals' }
      ].map(m => {
        const row = m.rosterA && m.rosterB ? findMatchupRowForPair(m.rosterA, m.rosterB, [sW, fW, qW]) : null;
        const winner = row ? winnerFromRow(row) : (m.rosterA || m.rosterB);
        return { label: 'Semifinals', week: sW, seedA: m.seedA, seedB: null, rosterA: m.rosterA, rosterB: m.rosterB, row, winner };
      });
      winnerRounds.push({ label: 'Semifinals', week: sW, matches: semiMatches });

      // Final: winners of semis
      const finalA = winnerRounds[1].matches[0].winner;
      const finalB = winnerRounds[1].matches[1].winner;
      const finalRow = (finalA && finalB) ? findMatchupRowForPair(finalA, finalB, [fW, sW, qW]) : null;
      const finalWinner = finalRow ? winnerFromRow(finalRow) : (finalA || finalB);
      winnerRounds.push({ label: 'Championship', week: fW, matches: [{ label: 'Championship', week: fW, rosterA: finalA, rosterB: finalB, row: finalRow, winner: finalWinner }] });

      // Build losers bracket per requested rules:
      // losers of quarterfinals: losers of (3v6) and (4v5) -> play each other in Losers Round (week qW or sW)
      const losersQ = winnerRounds[0].matches.map(m => {
        const loser = (m.rosterA && m.rosterB) ? (String(m.winner) === String(m.rosterA) ? m.rosterB : m.rosterA) : null;
        return loser;
      }).filter(Boolean);
      // order by seed (highest seed plays lowest seed)
      const losersOrdered = [...losersQ].sort((x,y) => {
        const sidx = (rid => seeded.indexOf(rid) + 1);
        return sidx(x) - sidx(y);
      });
      // if there are two losers, pair them
      const losersMatches = [];
      if (losersOrdered.length === 2) {
        const ra = losersOrdered[0], rb = losersOrdered[1];
        const row = findMatchupRowForPair(ra, rb, [sW, fW, qW]);
        const winner = row ? winnerFromRow(row) : (ra || rb);
        losersMatches.push({ label: 'Losers Round', week: sW, rosterA: ra, rosterB: rb, row, winner });
        // winners of losersMatches play for 5th place (consolation) — week fW
        const winnerOfLosers = losersMatches[0].winner;
        // losers of losers match play for 7th (not always present)
        const loserOfLosers = (losersMatches[0].rosterA && losersMatches[0].rosterB) ? (String(losersMatches[0].winner) === String(losersMatches[0].rosterA) ? losersMatches[0].rosterB : losersMatches[0].rosterA) : null;
        // 5th place: winnerOfLosers vs (maybe a team dropping from winners semis?), but user asked winners of loser round play for 5th.
        // We'll label the 5th place slot but we need an opponent — in many brackets it's the best-of losers path; here we will build a 5th-place match entry with winner vs TBD if not found.
        const consolationRow = null; // attempt to find a match for this pairing across weeks — complex; leave as constructed object
        const consolation = { label: 'Consolation (5th place)', week: fW, rosterA: winnerOfLosers, rosterB: null, row: consolationRow, winner: null };
        losers.push({ round: 'Losers Round', matches: losersMatches });
        losers.push({ round: 'Consolation (5th place)', matches: [consolation] });
        if (loserOfLosers) {
          losers.push({ round: 'Consolation (7th place)', matches: [{ label: 'Consolation (7th place)', week: fW, rosterA: loserOfLosers, rosterB: null, row: null, winner: null }] });
        }
      }

      // 3rd place match: losers of semifinals play each other
      const semiLosers = winnerRounds[1].matches.map(m => (m.rosterA && m.rosterB) ? (String(m.winner) === String(m.rosterA) ? m.rosterB : m.rosterA) : null).filter(Boolean);
      if (semiLosers.length === 2) {
        const row = findMatchupRowForPair(semiLosers[0], semiLosers[1], [fW, sW, qW]);
        const winner = row ? winnerFromRow(row) : (semiLosers[0] || semiLosers[1]);
        losers.push({ round: 'Third place', matches: [{ label: 'Third place', week: fW, rosterA: semiLosers[0], rosterB: semiLosers[1], row, winner }] });
      }

      // consolidate winners rounds into winners array
      winners.push(...winnerRounds);
    } else {
      // 8-team winners bracket standard
      // Quarterfinal pairs: 1 vs 8, 2 vs 7, 3 vs 6, 4 vs 5
      const qPairs = [
        { seedA: 1, seedB: 8 }, { seedA: 2, seedB: 7 },
        { seedA: 3, seedB: 6 }, { seedA: 4, seedB: 5 }
      ];
      const qMatches = qPairs.map(p => {
        const a = seed(p.seedA), b = seed(p.seedB);
        const row = findMatchupRowForPair(a, b, [qW, sW, fW]);
        const winner = row ? winnerFromRow(row) : (a || b);
        return { label: 'Quarterfinals', week: qW, seedA: p.seedA, seedB: p.seedB, rosterA: a, rosterB: b, row, winner };
      });
      winnerRounds.push({ label: 'Quarterfinals', week: qW, matches: qMatches });

      // Semifinal pairing: highest-seed winner vs lowest-seed winner,
      // We'll order quarter winners by original seed and pair highest vs lowest.
      const quarterWinnersOrdered = qMatches.map(m => ({ seedA: m.seedA, seedB: m.seedB, winner: m.winner }))
        .map((m) => {
          // compute winning seed number
          const winSeed = (String(m.winner) === String(seed(m.seedA))) ? m.seedA : m.seedB;
          return { winSeed, winner: m.winner };
        })
        .sort((x,y)=> x.winSeed - y.winSeed);
      // pair highest vs lowest: [0] vs [3], [1] vs [2]
      const semiMatches = [];
      if (quarterWinnersOrdered.length === 4) {
        const pairing = [[0,3],[1,2]];
        for (const pr of pairing) {
          const left = quarterWinnersOrdered[pr[0]];
          const right = quarterWinnersOrdered[pr[1]];
          const row = findMatchupRowForPair(left.winner, right.winner, [sW, fW, qW]);
          const winner = row ? winnerFromRow(row) : (left.winner || right.winner);
          semiMatches.push({ label: 'Semifinals', week: sW, rosterA: left.winner, rosterB: right.winner, row, winner, seedA: left.winSeed, seedB: right.winSeed });
        }
        winnerRounds.push({ label: 'Semifinals', week: sW, matches: semiMatches });

        // Championship: winners of semis
        const finalA = semiMatches[0].winner, finalB = semiMatches[1].winner;
        const finalRow = (finalA && finalB) ? findMatchupRowForPair(finalA, finalB, [fW, sW, qW]) : null;
        const finalWinner = finalRow ? winnerFromRow(finalRow) : (finalA || finalB);
        winnerRounds.push({ label: 'Championship', week: fW, matches: [{ label: 'Championship', week: fW, rosterA: finalA, rosterB: finalB, row: finalRow, winner: finalWinner }] });

        // LOSERS bracket (per instructions):
        // losers of first round (quarterfinals) play each other — pair highest seed vs lowest seed among them.
        const quarterLosers = qMatches.map(m => {
          const loser = (String(m.winner) === String(m.rosterA)) ? m.rosterB : m.rosterA;
          const losingSeed = (String(m.winner) === String(m.rosterA)) ? m.seedB : m.seedA;
          return { roster: loser, losingSeed };
        }).filter(Boolean);

        // order losers by seed ascending (highest seed = 1)
        quarterLosers.sort((x,y) => x.losingSeed - y.losingSeed);
        // Pair highest vs lowest
        const losersPairs = [];
        while (quarterLosers.length >= 2) {
          const a = quarterLosers.shift(); // highest seed among remaining
          const b = quarterLosers.pop();   // lowest seed among remaining
          losersPairs.push([a.roster, b.roster, a.losingSeed, b.losingSeed]);
        }
        const losersRoundMatches = [];
        for (const p of losersPairs) {
          const [ra, rb] = p;
          const row = findMatchupRowForPair(ra, rb, [sW, fW, qW]);
          const winner = row ? winnerFromRow(row) : (ra || rb);
          losersRoundMatches.push({ label: 'Losers Round', week: sW, rosterA: ra, rosterB: rb, row, winner });
        }
        if (losersRoundMatches.length) losers.push({ round: 'Losers Round', matches: losersRoundMatches });

        // winners of losersRound play for 5th place (consolation)
        const losersWinners = losersRoundMatches.map(m => m.winner).filter(Boolean);
        if (losersWinners.length === 2) {
          const row = findMatchupRowForPair(losersWinners[0], losersWinners[1], [fW, sW, qW]);
          const winner = row ? winnerFromRow(row) : (losersWinners[0] || losersWinners[1]);
          losers.push({ round: 'Consolation (5th place)', matches: [{ label: 'Consolation (5th place)', week: fW, rosterA: losersWinners[0], rosterB: losersWinners[1], row, winner }] });
        }

        // losers of losersRound play for 7th
        const losersLosers = losersRoundMatches.map(m => {
          return (String(m.winner) === String(m.rosterA)) ? m.rosterB : m.rosterA;
        }).filter(Boolean);
        if (losersLosers.length === 2) {
          const row = findMatchupRowForPair(losersLosers[0], losersLosers[1], [fW, sW, qW]);
          const winner = row ? winnerFromRow(row) : (losersLosers[0] || losersLosers[1]);
          losers.push({ round: 'Consolation (7th place)', matches: [{ label: 'Consolation (7th place)', week: fW, rosterA: losersLosers[0], rosterB: losersLosers[1], row, winner }] });
        }

        // third place: losers of semis
        const semiLosers = semiMatches.map(m => (String(m.winner) === String(m.rosterA)) ? m.rosterB : m.rosterA).filter(Boolean);
        if (semiLosers.length === 2) {
          const row = findMatchupRowForPair(semiLosers[0], semiLosers[1], [fW, sW, qW]);
          const winner = row ? winnerFromRow(row) : (semiLosers[0] || semiLosers[1]);
          losers.push({ round: 'Third place', matches: [{ label: 'Third place', week: fW, rosterA: semiLosers[0], rosterB: semiLosers[1], row, winner }] });
        }
      } // end if quarterWinners length 4
      winners.push(...winnerRounds);
    } // end else (8-team)
    return { winners, losers };
  } // end buildWinnersAndLosers

  const { winners: winnersBracket, losers: losersBracket } = buildWinnersAndLosers(seeds);

  return {
    seasons,
    weeks: Array.from({length: MAX_WEEKS}, (_,i)=>i+1),
    selectedSeason,
    selectedLeagueId,
    playoffStart,
    playoffEnd,
    rosterMap,
    matchupsRows,
    messages,
    winnersBracket,
    losersBracket
  };
}
