<!--
  src/routes/power-rankings/+page.svelte

  Rolling 4-week Power Rankings for the active BFA league. Combines two
  components into a single composite score:
    - Avg PF rank over the last 4 regular-season weeks (offense)
    - Win rate rank over the same window (results)

  Movement arrow is the delta between this week's rank and the rank computed
  for the prior week (the 4-week window shifted back by 1).

  Active league is picked via `pickActiveLeague`:
    - newest in_season league preferred (true "now" rankings)
    - else newest complete league (rankings at championship time)
-->
<script>
  import { onMount } from 'svelte';
  import { getSeasonsChain, BASE_LEAGUE_ID, pickActiveLeague } from '$lib/sleeperClient.client';
  import { computeStandingsForLeague } from '$lib/leagueCompute.client';
  import { avatarOrPh, fmt1 } from '$lib/format';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';
  import Sparkline from '$lib/Sparkline.svelte';
  import TeamBadge from '$lib/TeamBadge.svelte';

  let loading = true;
  let error = null;
  let leagueId = null;
  let leagueSeason = null;
  let leagueStatus = null;
  let weekWindow = []; // [w1, w2, w3, w4] inclusive
  let rankings = []; // sorted: [{ rosterId, meta, avgPf, wins, losses, margin, points, lastFour, score, prevRank, rank }]

  const WINDOW = 4;

  // Local wrapper so existing call-sites that pass `(v, places)` keep working —
  // fmt1 from $lib/format always returns 1 decimal, and the page only ever
  // calls fmt(v) without specifying a precision now.
  const fmt = (v) => fmt1(v);

  /**
   * Given the standings result, the raw weekly PF arrays per roster, and a
   * specific window of week numbers, compute the ranked list of teams.
   * Returns ranks sorted best → worst.
   */
  function rankWindow(standings, windowWeeks) {
    const rosterMap = standings.rosterMap || {};
    const weeklyByRid = standings.weeklyPfByRoster || {};
    const collected = standings.collectedMatchups || {};

    // Pair each week's matchup entries to extract per-team W/L within the window
    const winByRid = {};   // rid -> wins in window
    const lossByRid = {};
    const marginByRid = {}; // rid -> sum of margins (PF - oppPF)
    for (const wk of windowWeeks) {
      const arr = collected[wk] || [];
      const byMid = {};
      for (const e of arr) {
        const mid = e.matchup_id ?? e.matchupId ?? `auto-${wk}`;
        const k = String(mid);
        if (!byMid[k]) byMid[k] = [];
        byMid[k].push(e);
      }
      for (const k of Object.keys(byMid)) {
        const pair = byMid[k];
        if (pair.length < 2) continue;
        const [a, b] = pair;
        const aRid = String(a.roster_id ?? a.rosterId ?? '');
        const bRid = String(b.roster_id ?? b.rosterId ?? '');
        const aPts = Number(a.points || 0);
        const bPts = Number(b.points || 0);
        marginByRid[aRid] = (marginByRid[aRid] || 0) + (aPts - bPts);
        marginByRid[bRid] = (marginByRid[bRid] || 0) + (bPts - aPts);
        if (aPts > bPts + 1e-9) { winByRid[aRid] = (winByRid[aRid] || 0) + 1; lossByRid[bRid] = (lossByRid[bRid] || 0) + 1; }
        else if (bPts > aPts + 1e-9) { winByRid[bRid] = (winByRid[bRid] || 0) + 1; lossByRid[aRid] = (lossByRid[aRid] || 0) + 1; }
      }
    }

    const rows = [];
    for (const rid of Object.keys(rosterMap)) {
      const weekly = (weeklyByRid[rid] || []).filter((p) => windowWeeks.includes(p.week));
      if (weekly.length === 0) continue;
      const sum = weekly.reduce((s, p) => s + (p.pf || 0), 0);
      const avgPf = sum / weekly.length;
      rows.push({
        rosterId: rid,
        meta: rosterMap[rid] || {},
        avgPf,
        wins: winByRid[rid] || 0,
        losses: lossByRid[rid] || 0,
        margin: marginByRid[rid] || 0,
        lastFour: weekly.map((p) => p.pf)
      });
    }
    if (rows.length === 0) return [];

    // PF-rank and win-rank, blend 60/40 weight toward PF (more predictive than
    // small-sample W/L in a 4-week window).
    const byPf = [...rows].sort((a, b) => b.avgPf - a.avgPf);
    const byWin = [...rows].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.margin - a.margin; // tiebreaker
    });
    const pfRank = new Map(byPf.map((r, i) => [r.rosterId, i + 1]));
    const winRank = new Map(byWin.map((r, i) => [r.rosterId, i + 1]));
    for (const r of rows) {
      r.score = (pfRank.get(r.rosterId) || rows.length) * 0.6 + (winRank.get(r.rosterId) || rows.length) * 0.4;
    }
    rows.sort((a, b) => a.score - b.score);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }

  async function loadAll() {
    loading = true;
    error = null;
    try {
      const { seasons } = await getSeasonsChain(BASE_LEAGUE_ID);
      const active = pickActiveLeague(seasons);
      if (!active?.league_id) throw new Error('No active league found');
      leagueId = String(active.league_id);
      leagueSeason = active.season || null;
      leagueStatus = active.status || null;

      const standings = await computeStandingsForLeague(leagueId);
      const weekly = standings.weeklyPfByRoster || {};

      // Find every regular-season week that had data in THIS league (use any
      // roster's weekly list — they all share the same set of weeks).
      let allWeeks = [];
      for (const rid of Object.keys(weekly)) {
        for (const p of weekly[rid]) if (!allWeeks.includes(p.week)) allWeeks.push(p.week);
      }
      allWeeks.sort((a, b) => a - b);

      if (allWeeks.length < 1) throw new Error('Not enough completed weeks for rankings');

      // Rolling window: the last 4 completed regular-season weeks.
      const latestN = allWeeks.slice(-WINDOW);
      weekWindow = latestN;

      const current = rankWindow(standings, latestN);

      // Previous-week comparison: same window shifted back by 1 if we have
      // enough weeks. Otherwise leave prevRank = null (no movement arrow).
      let previous = [];
      if (allWeeks.length >= WINDOW + 1) {
        const prevN = allWeeks.slice(-(WINDOW + 1), -1);
        previous = rankWindow(standings, prevN);
      }
      const prevRankByRid = new Map(previous.map((r) => [r.rosterId, r.rank]));
      for (const r of current) r.prevRank = prevRankByRid.get(r.rosterId) ?? null;

      rankings = current;
    } catch (e) {
      console.error('[PowerRankings] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  function movementOf(r) {
    if (r.prevRank == null) return { type: 'flat', delta: 0, label: 'NEW' };
    const delta = r.prevRank - r.rank;
    if (delta > 0) return { type: 'up', delta, label: `▲ ${delta}` };
    if (delta < 0) return { type: 'down', delta, label: `▼ ${Math.abs(delta)}` };
    return { type: 'flat', delta: 0, label: '—' };
  }

  onMount(loadAll);
</script>

<svelte:head><title>Power Rankings · BFA</title></svelte:head>

<div class="page wrap">
  <header class="page-head rise">
    <div>
      <div class="eyebrow">
        {#if leagueStatus === 'in_season'}Live · 4-Week Rolling
        {:else if leagueStatus === 'complete'}{leagueSeason} Season Final · 4-Week Window
        {:else}Latest 4 Weeks{/if}
      </div>
      <h1 class="page-title">Power Rankings</h1>
      <p class="page-sub">
        Blended ranking from the last <strong>{WINDOW}</strong> regular-season weeks
        {#if weekWindow.length}<span class="muted"> · weeks {weekWindow[0]}–{weekWindow[weekWindow.length - 1]}</span>{/if}.
        Sixty percent weight to average PF, forty to W-L (margin as a tiebreaker).
        Movement arrows compare to the prior 4-week window.
      </p>
    </div>
  </header>

  {#if loading}
    <SkeletonLoader variant="row" count={10} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="power rankings" />
  {:else if rankings.length === 0}
    <div class="empty-card" data-testid="rankings-empty">Not enough completed weeks to rank yet. Check back after a few games.</div>
  {:else}
    <section class="block" aria-label="Power rankings">
      <div class="table-wrap">
        <table class="bfa-table" data-testid="rankings-table">
          <thead>
            <tr>
              <th style="width:54px;" title="Current power-ranking position">Rank</th>
              <th>Team</th>
              <th class="col-num" title="Wins minus losses across the last 4 weeks">Last 4 Record</th>
              <th class="col-num" title="Average points scored over the last 4 weeks">Last 4 Avg Score</th>
              <th class="col-num" title="Cumulative scoring margin (PF - PA) over the last 4 weeks">Avg Margin</th>
              <th class="col-trend" title="Weekly scoring pattern over the last 4 weeks">Score Trend</th>
              <th class="col-mv" title="Position change compared to the prior 4-week window">Δ vs Prior</th>
            </tr>
          </thead>
          <tbody>
            {#each rankings as r (r.rosterId)}
              {@const mv = movementOf(r)}
              <tr data-testid={`rank-row-${r.rosterId}`}>
                <td class="rank-cell"><span class="num rank-num">{r.rank}</span></td>
                <td>
                  <TeamBadge meta={r.meta} size="md" href={!!r.meta.owner_username} />
                </td>
                <td class="col-num"><span class="num">{r.wins}-{r.losses}</span></td>
                <td class="col-num"><span class="num pf">{fmt(r.avgPf, 1)}</span></td>
                <td class="col-num">
                  <span class="num" class:positive={r.margin > 0} class:negative={r.margin < 0}>
                    {r.margin > 0 ? '+' : ''}{fmt(r.margin, 1)}
                  </span>
                </td>
                <td class="col-trend">
                  <Sparkline points={r.lastFour} width={120} height={32} stroke="var(--accent)" ariaLabel={`${r.meta.team_name} last ${WINDOW} weeks`} />
                </td>
                <td class="col-mv">
                  <span class={`mv-pill mv-${mv.type}`}>{mv.label}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; margin: 0.4rem 0 0; text-transform: uppercase; }
  .page-sub { color: var(--text-secondary); margin-top: 0.6rem; max-width: 75ch; }
  .muted { color: var(--text-tertiary); }

  .block { background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; }
  .table-wrap { width: 100%; overflow-x: auto; }
  .bfa-table { min-width: 900px; }
  .col-trend { width: 140px; }
  .col-mv { width: 110px; }
  .rank-cell { width: 54px; }
  .rank-num { font-size: 1.6rem; color: var(--accent); font-family: var(--font-display); }

  .team-cell { display: flex; align-items: center; gap: 0.75rem; }
  .team-avatar.small { width: 42px; height: 42px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); }
  .team-name-cell, .team-name-link { font-weight: 700; color: var(--text-primary); line-height: 1.15; text-decoration: none; }
  .team-owner-cell { color: var(--text-tertiary); font-size: 0.78rem; margin-top: 0.15rem; }
  .pf { color: var(--text-primary); font-weight: 700; }
  .positive { color: var(--brand); font-weight: 700; }
  .negative { color: var(--accent); }

  .mv-pill {
    display: inline-block;
    min-width: 50px;
    padding: 0.18rem 0.5rem;
    border-radius: 999px;
    font-weight: 800;
    font-size: 0.78rem;
    text-align: center;
    letter-spacing: 0.04em;
  }
  .mv-up { background: rgba(52, 50, 200, 0.18); color: var(--brand); }
  .mv-down { background: rgba(200, 114, 50, 0.16); color: var(--accent); }
  .mv-flat { background: var(--surface-2); color: var(--text-tertiary); }

  .empty-card {
    padding: 2rem;
    text-align: center;
    background: var(--surface-1);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-sm);
    color: var(--text-secondary);
  }

  @media (max-width: 720px) {
    .page { padding: 1.75rem 0 3rem; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .page-sub { font-size: 0.88rem; }
    .col-trend { width: 90px; min-width: 90px; }
    .col-mv { width: 78px; min-width: 78px; }
    .mv-pill { min-width: 38px; padding: 0.15rem 0.4rem; font-size: 0.72rem; }
    .team-avatar.small { width: 34px; height: 34px; }
    .rank-num { font-size: 1.25rem; }
    .team-owner-cell { display: none; }
  }
</style>
