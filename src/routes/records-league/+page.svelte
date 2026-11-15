<script>
  import { onMount } from 'svelte';
  import { getSeasonsChain, BASE_LEAGUE_ID } from '$lib/api';
  import { computeStandingsForLeague } from '$lib/compute';
  import { buildLeagueRecordBook } from '$lib/compute/leagueRecords';
  import SkeletonLoader from '$lib/components/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import { avatarOrPlaceholder } from '$lib/utils/format';

  let loading = true;
  let error = null;
  let records = null;
  let seasonsCount = 0;

  async function loadRecords() {
    loading = true;
    error = null;
    try {
      const { seasons = [] } = await getSeasonsChain(BASE_LEAGUE_ID);
      seasonsCount = seasons.length;
      const results = await Promise.all(
        seasons.map((season) => computeStandingsForLeague(season.league_id).catch((err) => {
          console.warn('Unable to load season record data', season.season, err);
          return null;
        }))
      );
      records = buildLeagueRecordBook(results);
    } catch (err) {
      error = err;
    } finally {
      loading = false;
    }
  }

  onMount(loadRecords);
</script>

<svelte:head>
  <title>League Record Book · BFA</title>
  <meta name="description" content="All-time Badger Fantasy Association records across regular seasons and playoffs." />
</svelte:head>

<div class="page wrap">
  <header class="page-head">
    <div class="eyebrow">League · History</div>
    <h1 class="page-title">League Record Book</h1>
    <p class="page-sub">The all-time single-week, single-season, and matchup records across BFA history.</p>
    {#if !loading && records}
      <p class="coverage">Compiled from {seasonsCount} discovered seasons · Completed weeks only</p>
    {/if}
  </header>

  {#if loading}
    <SkeletonLoader variant="row" count={8} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadRecords} context="league records" />
  {:else if records}
    <section class="record-section">
      <div class="section-head"><h2>Regular Season · Weekly Scores</h2><span>Top 10</span></div>
      <div class="record-grid">
        <article class="record-card">
          <h3>Highest Team Scores</h3>
          {#each records.highestRegularWeek as row, i}
            <div class="record-row">
              <span class="rank">#{i + 1}</span>
              <img src={avatarOrPlaceholder(row.avatar, row.team)} alt="" />
              <div class="record-main"><strong>{row.team}</strong><small>{row.owner || 'BFA'} · {row.season} W{row.week}</small></div>
              <b class="value">{row.points.toFixed(2)}</b>
            </div>
          {:else}<p class="empty">No regular-season score data.</p>{/each}
        </article>
        <article class="record-card">
          <h3>Lowest Team Scores</h3>
          {#each records.lowestRegularWeek as row, i}
            <div class="record-row">
              <span class="rank">#{i + 1}</span>
              <img src={avatarOrPlaceholder(row.avatar, row.team)} alt="" />
              <div class="record-main"><strong>{row.team}</strong><small>{row.owner || 'BFA'} · {row.season} W{row.week}</small></div>
              <b class="value">{row.points.toFixed(2)}</b>
            </div>
          {:else}<p class="empty">No regular-season score data.</p>{/each}
        </article>
      </div>
    </section>

    <section class="record-section">
      <div class="section-head"><h2>Playoffs · Weekly Scores</h2><span>Top 10</span></div>
      <article class="record-card">
        {#each records.highestPlayoffWeek as row, i}
          <div class="record-row">
            <span class="rank">#{i + 1}</span>
            <img src={avatarOrPlaceholder(row.avatar, row.team)} alt="" />
            <div class="record-main"><strong>{row.team}</strong><small>{row.owner || 'BFA'} · {row.season} W{row.week}</small></div>
            <b class="value">{row.points.toFixed(2)}</b>
          </div>
        {:else}<p class="empty">No playoff score data.</p>{/each}
      </article>
    </section>

    <section class="record-section">
      <div class="section-head"><h2>Regular Season · Matchup Records</h2><span>Top 10</span></div>
      <div class="record-grid">
        <article class="record-card">
          <h3>Largest Margins</h3>
          {#each records.largestRegularMargins as row, i}
            <div class="match-row">
              <span class="rank">#{i + 1}</span>
              <div class="record-main"><strong>{row.winner} over {row.loser}</strong><small>{row.season} W{row.week} · {row.winnerScore}–{row.loserScore}</small></div>
              <b class="value">+{row.margin.toFixed(2)}</b>
            </div>
          {:else}<p class="empty">No completed matchups.</p>{/each}
        </article>
        <article class="record-card">
          <h3>Closest Decisions</h3>
          {#each records.closestRegularMargins as row, i}
            <div class="match-row">
              <span class="rank">#{i + 1}</span>
              <div class="record-main"><strong>{row.winner} over {row.loser}</strong><small>{row.season} W{row.week} · {row.winnerScore}–{row.loserScore}</small></div>
              <b class="value">{row.margin.toFixed(2)}</b>
            </div>
          {:else}<p class="empty">No completed matchups.</p>{/each}
        </article>
      </div>
      <article class="record-card">
        <h3>Highest Combined Scores</h3>
        {#each records.highestCombinedRegular as row, i}
          <div class="match-row">
            <span class="rank">#{i + 1}</span>
            <div class="record-main"><strong>{row.teamA} vs. {row.teamB}</strong><small>{row.season} W{row.week} · {row.scoreA}–{row.scoreB}</small></div>
            <b class="value">{row.combined.toFixed(2)}</b>
          </div>
        {:else}<p class="empty">No completed matchups.</p>{/each}
      </article>
    </section>

    <section class="record-section">
      <div class="section-head"><h2>Regular Season · Single-Season Records</h2><span>Top 10</span></div>
      <div class="record-grid">
        <article class="record-card">
          <h3>Most Wins</h3>
          {#each records.mostRegularSeasonWins as row, i}
            <div class="record-row">
              <span class="rank">#{i + 1}</span>
              <img src={avatarOrPlaceholder(row.avatar, row.team)} alt="" />
              <div class="record-main"><strong>{row.team}</strong><small>{row.owner || 'BFA'} · {row.season}</small></div>
              <b class="value">{row.wins}–{row.losses}</b>
            </div>
          {:else}<p class="empty">No season standings.</p>{/each}
        </article>
        <article class="record-card">
          <h3>Most Points For</h3>
          {#each records.mostRegularSeasonPoints as row, i}
            <div class="record-row">
              <span class="rank">#{i + 1}</span>
              <img src={avatarOrPlaceholder(row.avatar, row.team)} alt="" />
              <div class="record-main"><strong>{row.team}</strong><small>{row.owner || 'BFA'} · {row.season}</small></div>
              <b class="value">{row.pf.toFixed(2)}</b>
            </div>
          {:else}<p class="empty">No season standings.</p>{/each}
        </article>
      </div>
    </section>

    <section class="record-section">
      <div class="section-head"><h2>Champions</h2><span>Verified completed brackets</span></div>
      <article class="record-card champion-list">
        {#each records.champions as row}
          <div class="record-row">
            <span class="trophy">🏆</span>
            <img src={avatarOrPlaceholder(row.avatar, row.team)} alt="" />
            <div class="record-main"><strong>{row.season} · {row.team}</strong><small>{row.owner || 'Champion'}</small></div>
          </div>
        {:else}<p class="empty">No completed championship brackets available.</p>{/each}
      </article>
    </section>
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; text-transform: uppercase; margin: .4rem 0 .5rem; }
  .page-sub { color: var(--text-secondary); max-width: 65ch; }
  .coverage { color: var(--text-tertiary); font-size: .75rem; text-transform: uppercase; letter-spacing: .12em; margin-top: .75rem; }
  .record-section { margin: 1.5rem 0 2rem; }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin-bottom: .8rem; }
  .section-head h2 { font: 700 1.2rem var(--font-display); text-transform: uppercase; letter-spacing: .04em; margin: 0; }
  .section-head span { color: var(--text-tertiary); font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; }
  .record-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  .record-card { min-width: 0; background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; margin-bottom: 1rem; }
  .record-card h3 { margin: 0; padding: .9rem 1rem; border-bottom: 1px solid var(--border-subtle); font-size: .85rem; text-transform: uppercase; letter-spacing: .08em; }
  .record-row, .match-row { display: flex; align-items: center; gap: .7rem; padding: .65rem .85rem; border-bottom: 1px solid var(--border-subtle); min-width: 0; }
  .record-row:last-child, .match-row:last-child { border-bottom: 0; }
  .record-row img { width: 36px; height: 36px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); flex: 0 0 auto; }
  .rank { width: 1.8rem; color: var(--text-tertiary); font-weight: 800; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
  .record-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: .15rem; }
  .record-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .86rem; }
  .record-main small { color: var(--text-tertiary); font-size: .72rem; }
  .value { color: var(--accent); font-variant-numeric: tabular-nums; white-space: nowrap; font-size: .9rem; }
  .empty { padding: 1rem; color: var(--text-tertiary); font-size: .85rem; }
  .trophy { width: 1.8rem; text-align: center; }
  @media (max-width: 760px) {
    .page { padding: 1.75rem 0 3rem; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .record-grid { grid-template-columns: 1fr; gap: 0; }
    .section-head { align-items: flex-start; flex-direction: column; gap: .25rem; }
    .record-row, .match-row { padding: .6rem .7rem; gap: .5rem; }
    .record-row img { width: 32px; height: 32px; }
    .record-main strong { font-size: .8rem; }
    .value { font-size: .82rem; }
  }
</style>
