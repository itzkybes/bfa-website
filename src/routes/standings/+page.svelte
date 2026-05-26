<!-- src/routes/standings/+page.svelte (client-side fetched) -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getSeasonsChain, BASE_LEAGUE_ID } from '$lib/sleeperClient.client';
  import { computeStandingsForLeague } from '$lib/leagueCompute.client';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';

  let loading = true;
  let error = null;
  let seasons = [];
  let seasonsResults = [];
  let selectedSeasonId = null;

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? name[0].toUpperCase() : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }

  $: selectedResult = (() => {
    if (!seasonsResults.length) return null;
    let found = seasonsResults.find((r) => r.season != null && String(r.season) === String(selectedSeasonId));
    if (found) return found;
    found = seasonsResults.find((r) => String(r.leagueId) === String(selectedSeasonId));
    return found || seasonsResults[seasonsResults.length - 1];
  })();

  $: playoffDisplay = (() => {
    if (!selectedResult) return [];
    const raw = (selectedResult.playoffStandings || []).slice();
    if (!raw.length) return [];
    const champs = raw.filter((r) => r.champion === true).sort((a, b) => (b.pf || 0) - (a.pf || 0));
    const others = raw.filter((r) => r.champion !== true).sort((a, b) => {
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      return (b.pf || 0) - (a.pf || 0);
    });
    return [...champs, ...others];
  })();

  async function loadAll() {
    loading = true;
    error = null;
    try {
      const { seasons: chain } = await getSeasonsChain(BASE_LEAGUE_ID);
      seasons = chain;

      // Resolve selected season from URL
      const urlParam = $page.url.searchParams.get('season');
      const latest = chain.length ? chain[chain.length - 1] : null;
      selectedSeasonId = urlParam || (latest?.season != null ? String(latest.season) : String(latest?.league_id || BASE_LEAGUE_ID));

      // Compute standings for ALL seasons (so dropdown can switch without refetching)
      const results = await Promise.all(chain.map((s) => computeStandingsForLeague(s.league_id)));
      seasonsResults = results;
    } catch (e) {
      console.error('[Standings] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  function onSeasonChange(e) {
    const val = e.target.value;
    selectedSeasonId = val;
    // Update URL but don't reload (data is already client-side)
    goto(`?season=${encodeURIComponent(val)}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  onMount(loadAll);
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="head-row">
      <div>
        <div class="eyebrow">League · Standings</div>
        <h1 class="page-title">Standings</h1>
      </div>
      <div class="season-form">
        <label for="season-select" class="visually-hidden">Season</label>
        <select id="season-select" on:change={onSeasonChange} bind:value={selectedSeasonId} data-testid="standings-season-select">
          {#each seasons as s}
            <option value={s.season}>{s.season}</option>
          {/each}
        </select>
      </div>
    </div>
    {#if selectedResult}
      <p class="page-sub">{selectedResult.leagueName ?? `Season ${selectedResult.season ?? selectedResult.leagueId}`}</p>
    {/if}
  </header>

  {#if loading}
    <SkeletonLoader variant="row" count={12} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="standings" />
  {:else}
    <section class="standings-block" aria-labelledby="reg-h">
      <div class="block-head">
        <h2 id="reg-h" class="block-title">Regular Season</h2>
        <span class="block-sub">Sorted by W → PF</span>
      </div>
      {#if selectedResult?.regularStandings?.length}
        <div class="table-wrap" data-testid="regular-standings-table">
          <table class="bfa-table">
            <thead>
              <tr>
                <th style="width:60px;">#</th>
                <th>Team</th>
                <th class="col-num">W</th>
                <th class="col-num">L</th>
                <th class="col-num">Win Str</th>
                <th class="col-num">Lose Str</th>
                <th class="col-num">PF</th>
                <th class="col-num">PA</th>
              </tr>
            </thead>
            <tbody>
              {#each selectedResult.regularStandings as row, idx (row.rosterId)}
                <tr>
                  <td class="rank-cell"><span class="num rank-num">{idx + 1}</span></td>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPh(row.avatar, row.team_name)} alt={row.team_name} />
                      <div>
                        <div class="team-name-cell">{row.team_name}</div>
                        {#if row.owner_name}<div class="team-owner-cell">{row.owner_name}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td class="col-num"><span class="num">{row.wins}</span></td>
                  <td class="col-num"><span class="num">{row.losses}</span></td>
                  <td class="col-num"><span class="num">{row.maxWinStreak ?? 0}</span></td>
                  <td class="col-num"><span class="num">{row.maxLoseStreak ?? 0}</span></td>
                  <td class="col-num pf"><span class="num">{row.pf}</span></td>
                  <td class="col-num"><span class="num muted">{row.pa}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="empty-card">No regular season results.</div>
      {/if}
    </section>

    <section class="standings-block" aria-labelledby="po-h">
      <div class="block-head">
        <h2 id="po-h" class="block-title">Playoffs</h2>
        <span class="block-sub">Champion pinned 🏆</span>
      </div>
      {#if playoffDisplay && playoffDisplay.length}
        <div class="table-wrap" data-testid="playoff-standings-table">
          <table class="bfa-table">
            <thead>
              <tr>
                <th>Team</th>
                <th class="col-num">W</th>
                <th class="col-num">L</th>
                <th class="col-num">PF</th>
                <th class="col-num">PA</th>
              </tr>
            </thead>
            <tbody>
              {#each playoffDisplay as row (row.rosterId)}
                <tr class:champion-row={row.champion === true}>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPh(row.avatar, row.team_name)} alt={row.team_name} />
                      <div>
                        <div class="team-name-cell">
                          {row.team_name}
                          {#if row.champion === true}<span class="trophy" title="Champion">🏆</span>{/if}
                        </div>
                        {#if row.owner_name}<div class="team-owner-cell">{row.owner_name}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td class="col-num"><span class="num">{row.wins}</span></td>
                  <td class="col-num"><span class="num">{row.losses}</span></td>
                  <td class="col-num pf"><span class="num">{row.pf}</span></td>
                  <td class="col-num"><span class="num muted">{row.pa}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="empty-card">No playoff results.</div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .head-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; margin: 0.4rem 0 0; text-transform: uppercase; }
  .page-sub { color: var(--text-secondary); margin-top: 0.5rem; }
  .season-form select { min-width: 130px; }

  .standings-block { margin-bottom: 2rem; background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; }
  .block-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); gap: 1rem; }
  .block-title { font-family: var(--font-display); font-size: 1.4rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .block-sub { color: var(--text-tertiary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600; }
  .table-wrap { width: 100%; overflow-x: auto; }
  .bfa-table { min-width: 780px; }
  .rank-cell { width: 60px; }
  .rank-num { font-size: 1.4rem; color: var(--accent); }
  .team-cell { display: flex; align-items: center; gap: 0.75rem; }
  .team-avatar.small { width: 42px; height: 42px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); }
  .team-name-cell { font-weight: 700; color: var(--text-primary); line-height: 1.15; }
  .team-owner-cell { color: var(--text-tertiary); font-size: 0.78rem; margin-top: 0.15rem; }
  .trophy { margin-left: 0.4rem; }
  .pf .num { color: var(--text-primary); font-weight: 700; }
  .num.muted { color: var(--text-tertiary); }
  .empty-card { padding: 2rem; text-align: center; color: var(--text-secondary); }
  @media (max-width: 720px) {
    .head-row { flex-direction: column; align-items: stretch; }
    .season-form { display: flex; }
    .season-form select { flex: 1; }
  }
</style>
