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
  import { computeStandingsForLeague, buildWeeklyScoringTrends } from '$lib/compute';
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
  let biggestRiser = null;
  let biggestDrop = null;
  let topScorer = null;
  let bestRecord = null;
  let longestWinStreak = null;
  let longestLoseStreak = null;
  let scoringWeeks = [];
  let seasonHighScore = null;
  let seasonLowScore = null;
  let latestScoringWeek = null;
  let highestAverageWeek = null;
  let peakScoringAverage = 0;

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


  function findSeasonStreakLeaders(standings, weeks) {
    const collected = standings.collectedMatchups || {}, rosterMap = standings.rosterMap || {};
    const streaks = {};
    for (const rid of Object.keys(rosterMap)) streaks[rid] = { win: 0, loss: 0, bestWin: 0, bestLoss: 0 };
    for (const week of weeks) {
      const entries = collected[week] || collected[String(week)] || [], byMatchup = {};
      for (const entry of entries) {
        const mid = String(entry.matchup_id ?? entry.matchupId ?? `week-${week}-${entry.roster_id ?? entry.rosterId}`);
        (byMatchup[mid] ||= []).push(entry);
      }
      for (const pair of Object.values(byMatchup)) {
        if (pair.length < 2) continue;
        const [a, b] = pair, aId = String(a.roster_id ?? a.rosterId), bId = String(b.roster_id ?? b.rosterId);
        const aPts = computeParticipantPoints(a), bPts = computeParticipantPoints(b);
        if (!streaks[aId] || !streaks[bId]) continue;
        if (aPts > bPts + 1e-9) {
          streaks[aId].win++; streaks[aId].loss = 0; streaks[bId].loss++; streaks[bId].win = 0;
        } else if (bPts > aPts + 1e-9) {
          streaks[bId].win++; streaks[bId].loss = 0; streaks[aId].loss++; streaks[aId].win = 0;
        } else {
          streaks[aId].win = streaks[aId].loss = 0; streaks[bId].win = streaks[bId].loss = 0;
        }
        for (const id of [aId, bId]) {
          streaks[id].bestWin = Math.max(streaks[id].bestWin, streaks[id].win);
          streaks[id].bestLoss = Math.max(streaks[id].bestLoss, streaks[id].loss);
        }
      }
    }
    const rows = Object.entries(streaks).map(([rosterId, s]) => ({ rosterId, meta: rosterMap[rosterId] || {}, ...s }));
    const wins = [...rows].sort((a,b)=>b.bestWin-a.bestWin), losses = [...rows].sort((a,b)=>b.bestLoss-a.bestLoss);
    return { win: wins[0]?.bestWin > 0 ? wins[0] : null, loss: losses[0]?.bestLoss > 0 ? losses[0] : null };
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
      const scoringTrends = buildWeeklyScoringTrends(weekly, standings.rosterMap || {});
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
      const seasonStreaks = findSeasonStreakLeaders(standings, allWeeks);
      longestWinStreak = seasonStreaks.win;
      longestLoseStreak = seasonStreaks.loss;

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

  $: biggestRiser = [...rankings].filter((r) => r.prevRank != null && r.prevRank > r.rank)
    .sort((a, b) => (b.prevRank - b.rank) - (a.prevRank - a.rank))[0] || null;
  $: biggestDrop = [...rankings].filter((r) => r.prevRank != null && r.prevRank < r.rank)
    .sort((a, b) => (b.rank - b.prevRank) - (a.rank - a.prevRank))[0] || null;
  $: topScorer = [...rankings].sort((a, b) => b.avgPf - a.avgPf)[0] || null;
  $: bestRecord = [...rankings].sort((a, b) => {
    const aGames = a.wins + a.losses, bGames = b.wins + b.losses;
    const aRate = aGames ? a.wins / aGames : 0, bRate = bGames ? b.wins / bGames : 0;
    return bRate - aRate || b.wins - a.wins || b.margin - a.margin;
  })[0] || null;
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
        Follow the league’s season-long streak records, see how scoring changes week to week, and track which teams are gaining momentum in the rolling Power Rankings.
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
    <section class="trend-grid" aria-label="Season and recent performance highlights">
      <article class="trend-card">
        <div class="trend-kicker">Longest win streak</div>
        {#if longestWinStreak}
          <div class="trend-team"><img class="team-avatar" src={avatarOrPlaceholder(longestWinStreak.meta.team_avatar || longestWinStreak.meta.owner_avatar, longestWinStreak.meta.team_name)} alt="" />
            <div><div class="trend-name">{longestWinStreak.meta.team_name}</div><div class="trend-detail">{longestWinStreak.meta.owner_name || longestWinStreak.meta.owner_username || 'League team'}</div></div></div>
          <div class="trend-value positive">{longestWinStreak.bestWin} <span>consecutive wins</span></div>
          <div class="trend-caption">Longest winning run this season</div>
        {:else}<div class="trend-empty">No completed win streak yet</div>{/if}
      </article>
      <article class="trend-card">
        <div class="trend-kicker">Longest losing streak</div>
        {#if longestLoseStreak}
          <div class="trend-team"><img class="team-avatar" src={avatarOrPlaceholder(longestLoseStreak.meta.team_avatar || longestLoseStreak.meta.owner_avatar, longestLoseStreak.meta.team_name)} alt="" />
            <div><div class="trend-name">{longestLoseStreak.meta.team_name}</div><div class="trend-detail">{longestLoseStreak.meta.owner_name || longestLoseStreak.meta.owner_username || 'League team'}</div></div></div>
          <div class="trend-value negative">{longestLoseStreak.bestLoss} <span>consecutive losses</span></div>
          <div class="trend-caption">Longest losing run this season</div>
        {:else}<div class="trend-empty">No completed losing streak yet</div>{/if}
      </article>
      <article class="trend-card">
        <div class="trend-kicker">Biggest riser</div>
        {#if biggestRiser}
          <div class="trend-team">
            <img class="team-avatar" src={avatarOrPlaceholder(biggestRiser.meta.team_avatar || biggestRiser.meta.owner_avatar, biggestRiser.meta.team_name)} alt="" />
            <div><div class="trend-name">{biggestRiser.meta.team_name}</div><div class="trend-detail">{biggestRiser.meta.owner_name || biggestRiser.meta.owner_username || 'League team'}</div></div>
          </div>
          <div class="trend-value positive">▲ {biggestRiser.prevRank - biggestRiser.rank} <span>spots</span></div>
          <div class="trend-caption">Moved from #{biggestRiser.prevRank} to #{biggestRiser.rank} in the latest window</div>
        {:else}
          <div class="trend-empty">No ranking movement yet</div>
        {/if}
      </article>
      <article class="trend-card">
        <div class="trend-kicker">Biggest drop</div>
        {#if biggestDrop}
          <div class="trend-team">
            <img class="team-avatar" src={avatarOrPlaceholder(biggestDrop.meta.team_avatar || biggestDrop.meta.owner_avatar, biggestDrop.meta.team_name)} alt="" />
            <div><div class="trend-name">{biggestDrop.meta.team_name}</div><div class="trend-detail">{biggestDrop.meta.owner_name || biggestDrop.meta.owner_username || 'League team'}</div></div>
          </div>
          <div class="trend-value negative">▼ {biggestDrop.rank - biggestDrop.prevRank} <span>spots</span></div>
          <div class="trend-caption">Moved from #{biggestDrop.prevRank} to #{biggestDrop.rank} in the latest window</div>
        {:else}
          <div class="trend-empty">No ranking drop yet</div>
        {/if}
      </article>
      <article class="trend-card">
        <div class="trend-kicker">Top recent scorer</div>
        {#if topScorer}
          <div class="trend-team">
            <img class="team-avatar" src={avatarOrPlaceholder(topScorer.meta.team_avatar || topScorer.meta.owner_avatar, topScorer.meta.team_name)} alt="" />
            <div><div class="trend-name">{topScorer.meta.team_name}</div><div class="trend-detail">{topScorer.meta.owner_name || topScorer.meta.owner_username || 'League team'}</div></div>
          </div>
          <div class="trend-value">{fmt(topScorer.avgPf, 1)} <span>avg points</span></div>
          <div class="trend-caption">Highest average across the last {weekWindow.length} completed weeks</div>
        {:else}
          <div class="trend-empty">No scoring leader yet</div>
        {/if}
      </article>
      <article class="trend-card">
        <div class="trend-kicker">Best recent record</div>
        {#if bestRecord}
          <div class="trend-team">
            <img class="team-avatar" src={avatarOrPlaceholder(bestRecord.meta.team_avatar || bestRecord.meta.owner_avatar, bestRecord.meta.team_name)} alt="" />
            <div><div class="trend-name">{bestRecord.meta.team_name}</div><div class="trend-detail">{bestRecord.meta.owner_name || bestRecord.meta.owner_username || 'League team'}</div></div>
          </div>
          <div class="trend-value">{bestRecord.wins}-{bestRecord.losses} <span>record</span></div>
          <div class="trend-caption">Best win rate across the latest completed weeks</div>
        {:else}
          <div class="trend-empty">No recent record yet</div>
        {/if}
      </article>
    </section>

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
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; margin: 0.4rem 0 0; text-transform: uppercase; }
  .page-sub { color: var(--text-secondary); margin-top: 0.6rem; max-width: 75ch; }
  .muted { color: var(--text-tertiary); }

  .trend-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin: 0 0 2.5rem; }
  .trend-card { min-width: 0; padding: 1.25rem; background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); }
  .trend-kicker { color: var(--text-tertiary); font-size: 0.7rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; margin-bottom: 1rem; }
  .trend-team { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
  .trend-team .team-avatar { width: 48px; height: 48px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); flex: 0 0 auto; }
  .trend-name { font-weight: 800; overflow-wrap: anywhere; }
  .trend-detail, .trend-caption { color: var(--text-tertiary); font-size: 0.78rem; margin-top: 0.2rem; }
  .trend-value { font-family: var(--font-display); font-size: 1.8rem; line-height: 1.1; margin-top: 1rem; }
  .trend-value span { font-family: var(--font-body); font-size: 0.78rem; color: var(--text-secondary); }
  .trend-caption { margin-top: 0.35rem; }
  .trend-empty { color: var(--text-secondary); padding: 1rem 0; }
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
    .trend-grid { grid-template-columns: 1fr; gap: 0.75rem; margin-bottom: 2rem; }
    .trend-card { padding: 1rem; }
    .section-heading { display: block; }
    .section-heading p { margin-top: 0.5rem; }
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
