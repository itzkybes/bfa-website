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
  // Explicit snapshot totals/manual overrides win. When a year JSON row
  // has no team total, sum only the selected starters saved alongside it.
  const explicitScore = score ?? team.score ?? team.points;
  const starters = Array.isArray(team.starters) ? team.starters : [];
  const starterPoints = Array.isArray(team.starters_points) ? team.starters_points : null;
  const hasAlignedStarterPoints =
    starters.length > 0 && starterPoints && starterPoints.length === starters.length;
  const value = explicitScore != null
    ? Number(explicitScore)
    : hasAlignedStarterPoints
      ? starterPoints.reduce((sum, points) => sum + (Number(points) || 0), 0)
      : null;
  return {
    rosterId: rid,
    name: team.name ?? meta.team_name ?? null,
    ownerName: team.ownerName ?? meta.owner_name ?? null,
    avatar: team.avatar ?? meta.team_avatar ?? meta.owner_avatar ?? null,
    points: Number.isFinite(value) ? Math.round(value * 100) / 100 : null,
    starters: team.starters ?? null,
    starters_points: team.starters_points ?? null,
  };
}
