// src/routes/honor-hall/+page.server.js
import { error } from '@sveltejs/kit';

const API_BASE = "https://api.sleeper.app/v1";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed fetch ${url}: ${res.status}`);
  return res.json();
}

// Resolve roster_id from a slot (can be number, {w: X}, or {l: X})
function resolveRosterId(slot, bracket) {
  if (!slot) return null;
  if (typeof slot === "number") return slot;

  if (slot.w) {
    const match = bracket.find(b => b.m === slot.w);
    return match?.w ?? null;
  }
  if (slot.l) {
    const match = bracket.find(b => b.m === slot.l);
    return match?.l ?? null;
  }
  return null;
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ params, url }) {
  try {
    const season = url.searchParams.get("season") || new Date().getFullYear();
    const leagueId = process.env.SLEEPER_LEAGUE_ID; // ⚠️ set this in .env

    // --- Get metadata & rosters/users
    const league = await fetchJson(`${API_BASE}/league/${leagueId}`);
    const rosters = await fetchJson(`${API_BASE}/league/${leagueId}/rosters`);
    const users = await fetchJson(`${API_BASE}/league/${leagueId}/users`);

    const playoffStart = league.playoff_week_start ?? 15;

    // --- Get playoff bracket
    const bracket = await fetchJson(`${API_BASE}/league/${leagueId}/winners_bracket`);

    // --- Map roster_id → user info
    const rosterMap = {};
    for (const r of rosters) {
      const user = users.find(u => u.user_id === r.owner_id);
      rosterMap[r.roster_id] = {
        roster_id: r.roster_id,
        display_name: user?.display_name || "Unknown",
        avatar: user?.avatar || null
      };
    }

    // --- Group bracket matches by round
    const rounds = {};
    for (const match of bracket) {
      const r = match.r;
      if (!rounds[r]) rounds[r] = [];
      rounds[r].push(match);
    }

    // --- Fetch scores for playoff weeks
    const scores = {};
    for (let r = 1; r <= Object.keys(rounds).length; r++) {
      const week = playoffStart + (r - 1);
      try {
        const weekMatchups = await fetchJson(`${API_BASE}/league/${leagueId}/matchups/${week}`);
        scores[week] = weekMatchups;
      } catch (err) {
        scores[week] = [];
      }
    }

    // --- Enrich bracket with team info + scores
    const enrichedRounds = {};
    for (const [round, matches] of Object.entries(rounds)) {
      const week = playoffStart + (Number(round) - 1);
      const weekScores = scores[week] || [];

      enrichedRounds[round] = matches.map(m => {
        const t1_roster = resolveRosterId(m.t1, bracket);
        const t2_roster = resolveRosterId(m.t2, bracket);

        const t1_score = weekScores.find(x => x.roster_id === t1_roster)?.points ?? null;
        const t2_score = weekScores.find(x => x.roster_id === t2_roster)?.points ?? null;

        return {
          round,
          match: m.m,
          t1: rosterMap[t1_roster] || null,
          t2: rosterMap[t2_roster] || null,
          t1_score,
          t2_score,
          winner: rosterMap[m.w] || null
        };
      });
    }

    return {
      season,
      league,
      rounds: enrichedRounds
    };
  } catch (err) {
    console.error("Honor Hall load failed:", err);
    throw error(500, "Failed to load playoff data");
  }
}
