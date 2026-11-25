// Pure matchup adapters. Saved year JSON supplies all scores and
// per-player starter data; live Sleeper fallback is display context only.

export function buildTeamFromLive(rid, rosterMap = {}, _entry = null) {
  const meta = rosterMap[String(rid)] || {};
  return {
    rosterId: String(rid),
    name: meta.team_name || meta.owner_name || 'Roster ' + rid,
    ownerName: meta.owner_name || null,
    avatar: meta.team_avatar || meta.owner_avatar || null,
    points: null,
    starters: null,
    starters_points: null,
  };
}

export function buildTeamFromStatic(team, score, rosterMap = {}) {
  const rid = String(team.rosterId ?? team.roster_id ?? '');
  const meta = rid && rosterMap[rid] ? rosterMap[rid] : {};
  const value = Number(score ?? team.score ?? team.points ?? 0);
  return {
    rosterId: rid,
    name: team.name ?? meta.team_name ?? null,
    ownerName: team.ownerName ?? meta.owner_name ?? null,
    avatar: team.avatar ?? meta.team_avatar ?? meta.owner_avatar ?? null,
    points: Number.isFinite(value) ? value : 0,
    starters: team.starters ?? null,
    starters_points: team.starters_points ?? null,
  };
}
