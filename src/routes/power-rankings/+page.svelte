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
  import { getSeasonsChain, BASE_LEAGUE_ID, pickActiveLeague } from '$lib/api';
  import { computeStandingsForLeague, buildWeeklyScoringTrends, buildTeamScoringProfiles, buildRecentVsSeasonComparison, buildLeagueScoringHistory, buildStandingsMovementSeries } from '$lib/compute';
  import { computeParticipantPoints } from '$lib/compute/scoring';
  import SkeletonLoader from '$lib/components/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';
  import { avatarOrPlaceholder } from '$lib/utils/format';

  let loading = true;
  let error = null;
  let leagueId = null;
  let leagueSeason = null;
  let leagueStatus = null;
  let weekWindow = []; // [w1, w2, w3, w4] inclusive
  let rankings = []; // sorted: [{ rosterId, meta, avgPf, wins, losses, margin, points, lastFour, score, prevRank, rank }]
  let scoringWeeks = [];
  let seasonHighScore = null;
  let seasonLowScore = null;
  let latestScoringWeek = null;
  let highestAverageWeek = null;
  let peakScoringAverage = 0;
  let movementWeeks = [];
  let movementSeries = [];
  let scoringProfiles = [];
  let seasonComparisonRows = [];
  let seasonComparisonWeeks = [];
  let leagueScoringHistory = [];
  let leagueHistoryPeakAverage = 0;

  const MOVEMENT_COLORS = [
    '#c58a2c', '#4b90b5', '#5b9b73', '#c36b4d',
    '#7b8d9b', '#b6a04b', '#3f7f7a', '#a65c44',
    '#6f8fbd', '#a18a59', '#4c9d98', '#b07936'
  ];
  const WINDOW = 4;

  function fmt(v, places = 1) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return n.toFixed(places);
  }

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
        // Use the shared scorer so completed static seasons honor their
        // authoritative __final_score values just like live Sleeper entries.
        const aPts = computeParticipantPoints(a);
        const bPts = computeParticipantPoints(b);
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
      const rosterMap = standings.rosterMap || {};
      const scoringTrends = buildWeeklyScoringTrends(weekly, rosterMap);
      const movement = buildStandingsMovementSeries(standings.standingsMovement?.snapshots || [], rosterMap);
      movementWeeks = movement.weeks;
      movementSeries = movement.teams;
      scoringProfiles = buildTeamScoringProfiles(weekly, rosterMap);
      const comparison = buildRecentVsSeasonComparison(weekly, rosterMap, WINDOW);
      seasonComparisonRows = comparison.teams;
      seasonComparisonWeeks = comparison.recentWeeks;

      // Historical seasons use the same standings scorer as the active season.
      // Reuse the current result and isolate failures so one missing archive
      // cannot prevent the current Trends page from rendering.
      const historicalSeasonData = await Promise.all(
        (Array.isArray(seasons) ? seasons : [])
          .filter((season) => season?.league_id && season?.season)
          .map(async (season) => {
            try {
              const seasonStandings = String(season.league_id) === leagueId
                ? standings
                : await computeStandingsForLeague(String(season.league_id));
              return {
                season: season.season,
                weeklyPfByRoster: seasonStandings.weeklyPfByRoster || {},
                rosterMap: seasonStandings.rosterMap || {}
              };
            } catch (historyError) {
              console.warn('[Trends] historical season unavailable', season.season, historyError);
              return null;
            }
          })
      );
      leagueScoringHistory = buildLeagueScoringHistory(historicalSeasonData.filter(Boolean));
      leagueHistoryPeakAverage = Math.max(0, ...leagueScoringHistory.map((season) => season.averageScore));
      scoringWeeks = scoringTrends.weeks;
      seasonHighScore = scoringTrends.seasonHigh;
      seasonLowScore = scoringTrends.seasonLow;

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

  function movementX(index) {
    const left = 48;
    const plotWidth = 665;
    return left + (index * plotWidth) / Math.max(1, movementWeeks.length - 1);
  }

  function movementY(rank) {
    const top = 20;
    const plotHeight = 210;
    return top + ((rank - 1) * plotHeight) / Math.max(1, movementSeries.length - 1);
  }

  function movementPath(ranks) {
    let previousValid = false;
    return ranks.map((rank, index) => {
      if (!Number.isInteger(rank)) {
        previousValid = false;
        return '';
      }
      const command = previousValid ? 'L' : 'M';
      previousValid = true;
      return command + movementX(index) + ',' + movementY(rank);
    }).filter(Boolean).join(' ');
  }

  function movementColor(index) {
    return MOVEMENT_COLORS[index % MOVEMENT_COLORS.length];
  }

  function movementOf(r) {
    if (r.prevRank == null) return { type: 'flat', delta: 0, label: 'NEW' };
    const delta = r.prevRank - r.rank;
    if (delta > 0) return { type: 'up', delta, label: `▲ ${delta}` };
    if (delta < 0) return { type: 'down', delta, label: `▼ ${Math.abs(delta)}` };
    return { type: 'flat', delta: 0, label: '—' };
  }

  $: latestScoringWeek = scoringWeeks[scoringWeeks.length - 1] || null;
  $: highestAverageWeek = [...scoringWeeks].sort((a, b) => b.averageScore - a.averageScore)[0] || null;
  $: peakScoringAverage = Math.max(0, ...scoringWeeks.map((week) => week.averageScore));

  onMount(loadAll);
</script>

<svelte:head><title>Trends · BFA</title></svelte:head>

<div class="page wrap">
  <header class="page-head rise">
    <div>
      <div class="eyebrow">
        {#if leagueStatus === 'in_season'}Live · Full Season
        {:else if leagueStatus === 'complete'}{leagueSeason} Season Final
        {:else}Full Season{/if}
      </div>
      <h1 class="page-title">Trends</h1>
      <p class="page-sub">
        Track how league scoring changes week to week and see which teams are gaining momentum in the rolling Power Rankings.
      </p>
    </div>
  </header>

  {#if loading}
    <SkeletonLoader variant="row" count={10} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="trends" />
  {:else if rankings.length === 0}
    <div class="empty-card" data-testid="rankings-empty">Not enough completed weeks to show trends yet. Check back after a few games.</div>
  {:else}
    <div class="section-heading">
      <div><div class="eyebrow">Scoring trends</div><h2>Weekly Scoring Pulse</h2></div>
      <p>Average team points by completed regular-season week. Hover over a bar to see that week’s top and lowest recorded team scores.</p>
    </div>
    <section class="pulse-panel block" aria-label="Weekly scoring pulse">
      <div class="pulse-summary">
        <article class="pulse-stat">
          <span class="pulse-stat-label">Season high score</span>
          {#if seasonHighScore}
            <strong>{fmt(seasonHighScore.score, 1)} <em>pts</em></strong>
            <small><img src={avatarOrPlaceholder(seasonHighScore.avatar, seasonHighScore.teamName)} alt="" /> {seasonHighScore.teamName} · Week {seasonHighScore.week}</small>
          {:else}
            <strong>—</strong><small>No recorded score yet</small>
          {/if}
        </article>
        <article class="pulse-stat">
          <span class="pulse-stat-label">Season low score</span>
          {#if seasonLowScore}
            <strong>{fmt(seasonLowScore.score, 1)} <em>pts</em></strong>
            <small><img src={avatarOrPlaceholder(seasonLowScore.avatar, seasonLowScore.teamName)} alt="" /> {seasonLowScore.teamName} · Week {seasonLowScore.week}</small>
          {:else}
            <strong>—</strong><small>No recorded score yet</small>
          {/if}
        </article>
        <article class="pulse-stat">
          <span class="pulse-stat-label">Latest week average</span>
          {#if latestScoringWeek}
            <strong>{fmt(latestScoringWeek.averageScore, 1)} <em>pts</em></strong>
            <small>Week {latestScoringWeek.week} · {latestScoringWeek.teamCount} teams with recorded scores</small>
          {:else}
            <strong>—</strong><small>No completed scoring week yet</small>
          {/if}
        </article>
      </div>
      {#if scoringWeeks.length > 0}
        <div class="pulse-chart-scroll">
          <div class="pulse-chart" role="img" aria-label="Average team score by completed regular-season week">
            {#each scoringWeeks as week (week.week)}
              <div
                class="pulse-week"
                title={"Week " + week.week + ": " + fmt(week.averageScore, 1) + " average points; high " + fmt(week.highScore.score, 1) + " by " + week.highScore.teamName + "; low " + fmt(week.lowScore.score, 1) + " by " + week.lowScore.teamName}
              >
                <span class="pulse-value">{fmt(week.averageScore, 0)}</span>
                <div class="pulse-track">
                  <div class="pulse-bar" style={"height:" + Math.max(5, (week.averageScore / peakScoringAverage) * 100) + "%"}></div>
                </div>
                <span class="pulse-week-label">W{week.week}</span>
              </div>
            {/each}
          </div>
        </div>
        <div class="pulse-footer">
          <span><i class="pulse-legend-dot"></i> Average team score</span>
          {#if highestAverageWeek}<span>Highest-scoring week: Week {highestAverageWeek.week} · {fmt(highestAverageWeek.averageScore, 1)} average</span>{/if}
        </div>
      {:else}
        <div class="pulse-empty">Weekly scoring trends will appear after completed team scores are available.</div>
      {/if}
    </section>

    <div class="section-heading rankings-heading">
      <div><div class="eyebrow">League snapshot · Weeks {weekWindow[0]}–{weekWindow[weekWindow.length - 1]}</div><h2>Power Rankings</h2></div>
      <p>Rolling {weekWindow.length}-week blend: 60% average-points rank and 40% win-loss rank. Movement compares with the prior window.</p>
    </div>
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
                <td class="rank-cell"><span class="num rank-num" class:leader-cell={r.rank === 1}>{r.rank}</span></td>
                <td>
                  <div class="team-cell">
                    <img class="team-avatar small" src={avatarOrPlaceholder(r.meta.team_avatar || r.meta.owner_avatar, r.meta.team_name)} alt={r.meta.team_name} />
                    <div>
                      {#if r.meta.owner_username}
                        <a class="team-name-link" href={`/team/${encodeURIComponent(r.meta.owner_username)}`}>{r.meta.team_name}</a>
                      {:else}
                        <div class="team-name-cell">{r.meta.team_name}</div>
                      {/if}
                      {#if r.meta.owner_name}<div class="team-owner-cell">{r.meta.owner_name}</div>{/if}
                    </div>
                  </div>
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

    <div class="section-heading analytics-heading">
      <div><div class="eyebrow">Regular-season position</div><h2>Standings Movement</h2></div>
      <p>Each line follows a team’s league rank after every completed regular-season week. Rank 1 is the top position.</p>
    </div>
    <section class="block movement-panel" aria-label="Standings movement chart">
      {#if movementWeeks.length > 0 && movementSeries.length > 0}
        <div class="movement-chart-scroll">
          <svg class="movement-chart" viewBox="0 0 760 270" role="img" aria-label="Team standings rank by completed week">
            {#each Array.from({ length: movementSeries.length }, (_, index) => index + 1) as rank}
              <line x1="48" x2="713" y1={movementY(rank)} y2={movementY(rank)} class="movement-gridline" />
              <text x="30" y={movementY(rank) + 4} class="movement-axis-label" text-anchor="end">{rank}</text>
            {/each}
            {#each movementWeeks as week, index}
              <text x={movementX(index)} y="253" class="movement-axis-label" text-anchor="middle">W{week}</text>
            {/each}
            {#each movementSeries as team, index (team.rosterId)}
              <path d={movementPath(team.ranks)} fill="none" stroke={movementColor(index)} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
              {#each team.ranks as rank, pointIndex}
                {#if rank != null}
                  <circle cx={movementX(pointIndex)} cy={movementY(rank)} r="3.2" fill={movementColor(index)} />
                {/if}
              {/each}
            {/each}
          </svg>
        </div>
        <div class="movement-legend">
          {#each movementSeries as team, index (team.rosterId)}
            <span><i style={"--team-color:" + movementColor(index)}></i>{team.teamName}</span>
          {/each}
        </div>
      {:else}
        <div class="analytics-empty">Standings movement will appear once the first completed regular-season week is available.</div>
      {/if}
    </section>

    <div class="section-heading analytics-heading">
      <div><div class="eyebrow">Team scoring profiles</div><h2>Scoring Consistency</h2></div>
      <p>Average, high, low, range, and standard deviation across completed regular-season scores. Lower standard deviation means steadier scoring.</p>
    </div>
    <section class="block" aria-label="Scoring consistency">
      {#if scoringProfiles.length > 0}
        <div class="table-wrap">
          <table class="bfa-table analytics-table" data-testid="scoring-consistency-table">
            <thead><tr><th>Team</th><th class="col-num">Avg</th><th class="col-num">High</th><th class="col-num">Low</th><th class="col-num">Range</th><th class="col-num">Std Dev</th></tr></thead>
            <tbody>
              {#each scoringProfiles as team (team.rosterId)}
                <tr>
                  <td><div class="team-cell"><img class="team-avatar small" src={avatarOrPlaceholder(team.avatar, team.teamName)} alt="" /><span class="team-name-cell">{team.teamName}</span></div></td>
                  <td class="col-num"><span class="num">{fmt(team.averageScore, 1)}</span></td>
                  <td class="col-num"><span class="num">{fmt(team.highScore, 1)}</span></td>
                  <td class="col-num"><span class="num">{fmt(team.lowScore, 1)}</span></td>
                  <td class="col-num"><span class="num">{fmt(team.range, 1)}</span></td>
                  <td class="col-num"><span class="num">{fmt(team.standardDeviation, 1)}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="analytics-empty">Scoring profiles will appear when completed team scores are available.</div>
      {/if}
    </section>

    <div class="section-heading analytics-heading">
      <div>
        <div class="eyebrow">{#if seasonComparisonWeeks.length}Weeks {seasonComparisonWeeks[0]}–{seasonComparisonWeeks[seasonComparisonWeeks.length - 1]}{/if}</div>
        <h2>Recent vs Season Average</h2>
      </div>
      <p>Compare each team’s average across the latest completed weeks with its full-season average. Positive differences indicate a recent scoring increase.</p>
    </div>
    <section class="block" aria-label="Recent scoring compared with season average">
      {#if seasonComparisonRows.length > 0}
        <div class="table-wrap">
          <table class="bfa-table analytics-table" data-testid="season-comparison-table">
            <thead><tr><th>Team</th><th class="col-num">Season Avg</th><th class="col-num">Recent Avg</th><th class="col-num">Difference</th></tr></thead>
            <tbody>
              {#each seasonComparisonRows as team (team.rosterId)}
                <tr>
                  <td><div class="team-cell"><img class="team-avatar small" src={avatarOrPlaceholder(team.avatar, team.teamName)} alt="" /><span class="team-name-cell">{team.teamName}</span></div></td>
                  <td class="col-num"><span class="num">{fmt(team.seasonAverage, 1)}</span></td>
                  <td class="col-num"><span class="num">{fmt(team.recentAverage, 1)}</span></td>
                  <td class="col-num"><span class="num" class:positive={team.difference > 0} class:negative={team.difference < 0}>{team.difference > 0 ? '+' : ''}{fmt(team.difference, 1)}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="analytics-empty">Recent scoring comparisons will appear after completed team scores are available.</div>
      {/if}
    </section>

    <div class="section-heading analytics-heading">
      <div><div class="eyebrow">Season-by-season scoring</div><h2>League Scoring History</h2></div>
      <p>League-wide average team points across completed regular-season team scores in each BFA season.</p>
    </div>
    <section class="block history-panel" aria-label="League scoring history chart">
      {#if leagueScoringHistory.length > 0}
        <div class="history-chart-scroll">
          <div class="history-chart" role="img" aria-label="Average team score by BFA season">
            {#each leagueScoringHistory as season (season.season)}
              <div class="history-season" title={season.season + " season: " + fmt(season.averageScore, 1) + " average points across " + season.scoreCount + " team scores"}>
                <span class="history-value">{fmt(season.averageScore, 1)}</span>
                <div class="history-track"><div class="history-bar" style={"height:" + Math.max(5, (season.averageScore / leagueHistoryPeakAverage) * 100) + "%"}></div></div>
                <span class="history-season-label">{season.season}</span>
              </div>
            {/each}
          </div>
        </div>
        <div class="pulse-footer"><span>Average points per team-week</span><span>{leagueScoringHistory.reduce((sum, season) => sum + season.scoreCount, 0)} recorded team scores across {leagueScoringHistory.length} seasons</span></div>
      {:else}
        <div class="analytics-empty">Historical scoring will appear as completed season archives are available.</div>
      {/if}
    </section>

  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; margin: 0.4rem 0 0; text-transform: uppercase; }
  .page-sub { color: var(--text-secondary); margin-top: 0.6rem; max-width: 75ch; }
  .muted { color: var(--text-tertiary); }

  .pulse-panel { padding: 1rem; margin-bottom: 2.5rem; }
  .pulse-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; margin-bottom: 1.4rem; }
  .pulse-stat { min-width: 0; padding: 0.95rem 1rem; border-radius: var(--r-sm); background: var(--surface-2); }
  .pulse-stat-label { display: block; color: var(--text-tertiary); font-size: 0.68rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
  .pulse-stat strong { display: block; margin-top: 0.4rem; font-family: var(--font-display); font-size: 1.75rem; line-height: 1; color: var(--text-primary); }
  .pulse-stat strong em { font-family: var(--font-body); font-size: 0.72rem; font-style: normal; color: var(--text-secondary); }
  .pulse-stat small { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.55rem; color: var(--text-tertiary); font-size: 0.75rem; overflow-wrap: anywhere; }
  .pulse-stat small img { width: 20px; height: 20px; flex: 0 0 auto; object-fit: cover; border-radius: 5px; background: var(--surface-1); }
  .pulse-chart-scroll { width: 100%; overflow-x: auto; padding: 0.5rem 0.1rem 0; }
  .pulse-chart { min-width: 560px; height: 190px; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 0.55rem; align-items: end; }
  .pulse-week { height: 100%; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: end; gap: 0.35rem; }
  .pulse-value { color: var(--text-secondary); font-size: 0.67rem; font-variant-numeric: tabular-nums; }
  .pulse-track { height: 145px; width: min(100%, 34px); display: flex; align-items: end; overflow: hidden; background: var(--surface-2); border-radius: 5px 5px 2px 2px; }
  .pulse-bar { width: 100%; min-height: 3px; border-radius: 5px 5px 0 0; background: linear-gradient(180deg, var(--accent), var(--brand)); transition: height 180ms ease; }
  .pulse-week-label { color: var(--text-tertiary); font-size: 0.68rem; }
  .pulse-footer { display: flex; justify-content: space-between; gap: 1rem; margin-top: 0.75rem; color: var(--text-tertiary); font-size: 0.75rem; }
  .pulse-footer > span:first-child { display: inline-flex; align-items: center; gap: 0.4rem; }
  .pulse-legend-dot { width: 8px; height: 8px; border-radius: 2px; background: var(--accent); display: inline-block; }
  .pulse-empty { padding: 1.5rem 0.5rem; color: var(--text-secondary); text-align: center; }
  .rankings-heading { margin-top: 0.5rem; }

  .analytics-heading { margin-top: 2.5rem; }
  .movement-panel { padding: 0.9rem 1rem 1rem; }
  .movement-chart-scroll { width: 100%; overflow-x: auto; }
  .movement-chart { display: block; width: 100%; min-width: 680px; height: auto; }
  .movement-gridline { stroke: var(--border-subtle); stroke-width: 1; }
  .movement-axis-label { fill: var(--text-tertiary); font-size: 10px; }
  .movement-legend { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.55rem 0.9rem; margin: 0.35rem 0.25rem 0.1rem; }
  .movement-legend span { display: flex; align-items: center; gap: 0.45rem; min-width: 0; color: var(--text-secondary); font-size: 0.76rem; overflow-wrap: anywhere; }
  .movement-legend i { display: inline-block; width: 17px; height: 3px; flex: 0 0 auto; border-radius: 3px; background: var(--team-color); }
  .analytics-table { table-layout: fixed; }
  .analytics-table th, .analytics-table td { padding-left: 0.7rem; padding-right: 0.7rem; }
  .analytics-empty { padding: 1.5rem 1rem; color: var(--text-secondary); text-align: center; }
  .history-panel { padding: 0.8rem 1rem 0.9rem; }
  .history-chart-scroll { width: 100%; overflow-x: auto; }
  .history-chart { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(52px, 1fr); gap: 0.9rem; align-items: end; min-width: 420px; height: 190px; padding: 0.45rem 0.2rem 0; }
  .history-season { min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: end; align-items: center; gap: 0.35rem; }
  .history-value { color: var(--text-secondary); font-size: 0.7rem; font-variant-numeric: tabular-nums; }
  .history-track { width: min(100%, 48px); height: 145px; display: flex; align-items: end; overflow: hidden; background: var(--surface-2); border-radius: 5px 5px 2px 2px; }
  .history-bar { width: 100%; min-height: 3px; border-radius: 5px 5px 0 0; background: linear-gradient(180deg, var(--accent), var(--brand)); }
  .history-season-label { color: var(--text-tertiary); font-size: 0.72rem; }

  .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 1.5rem; margin: 0 0 1rem; }
  .section-heading h2 { font-family: var(--font-display); font-size: clamp(1.6rem, 4vw, 2.3rem); text-transform: uppercase; margin: 0.25rem 0 0; }
  .section-heading p { color: var(--text-tertiary); font-size: 0.82rem; max-width: 46ch; margin: 0 0 0.25rem; }
  .block { background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; }
  .table-wrap { width: 100%; overflow: hidden; }
  .bfa-table { width: 100%; min-width: 0; table-layout: fixed; }
  .col-trend { width: 140px; }
  .col-mv { width: 110px; }
  .rank-cell { width: 54px; }
  .rank-num { font-size: 1.6rem; color: var(--accent); font-family: var(--font-display); }

  .team-cell { display: flex; align-items: center; gap: 0.75rem; }
  .team-avatar.small { width: 42px; height: 42px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); }
  .team-name-cell, .team-name-link { font-weight: 700; color: var(--text-primary); line-height: 1.15; text-decoration: none; }
  a.team-name-link:hover { color: var(--accent); }
  .team-owner-cell { color: var(--text-tertiary); font-size: 0.78rem; margin-top: 0.15rem; }
  .pf { color: var(--text-secondary); font-weight: 400; }
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
  .mv-up { background: var(--surface-2); color: var(--brand); }
  .mv-down { background: var(--surface-2); color: var(--accent); }
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
    .section-heading { display: block; }
    .section-heading p { margin-top: 0.5rem; }
    .movement-legend { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
    .analytics-table th, .analytics-table td { padding-left: 0.35rem; padding-right: 0.35rem; font-size: 0.72rem; }
    .analytics-table .team-cell { gap: 0.35rem; }
    .analytics-table .team-avatar.small { width: 28px; height: 28px; }
    .analytics-table .team-name-cell { font-size: 0.72rem; }
    .history-panel { padding: 0.7rem; }
    .pulse-panel { padding: 0.75rem; margin-bottom: 2rem; }
    .pulse-summary { grid-template-columns: 1fr; gap: 0.5rem; }
    .pulse-stat { padding: 0.8rem; }
    .pulse-footer { flex-direction: column; gap: 0.35rem; }
    .pulse-chart { min-width: 520px; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .page-sub { font-size: 0.88rem; }
    .col-trend { width: auto; min-width: 0; }
    .col-mv { width: auto; min-width: 0; }
    .mv-pill { min-width: 38px; padding: 0.15rem 0.4rem; font-size: 0.72rem; }
    .team-avatar.small { width: 34px; height: 34px; }
    .rank-num { font-size: 1.25rem; }
    .team-owner-cell { display: none; }
  }
</style>
