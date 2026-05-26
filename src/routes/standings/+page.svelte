<!-- src/routes/standings/+page.svelte -->
<script>
  export let data;

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? name[0].toUpperCase() : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }

  const seasons = (data?.seasons || []).filter(s => s.season != null);
  const seasonsResults = data?.seasonsResults || [];

  const numericSeasons = seasons;
  const latestDefault = numericSeasons.length
    ? String(numericSeasons[numericSeasons.length - 1].season)
    : (data?.seasons?.length ? String(data.seasons[data.seasons.length - 1].league_id) : '');

  let selectedSeasonId = (() => {
    const ds = data?.selectedSeason ? String(data.selectedSeason) : null;
    if (ds && (data?.seasons || []).some((s) => String(s.season) === ds || String(s.league_id) === ds)) return ds;
    return latestDefault;
  })();

  $: selectedResult = (() => {
    if (!seasonsResults.length) return null;
    let found = seasonsResults.find((r) => r.season != null && String(r.season) === String(selectedSeasonId));
    if (found) return found;
    found = seasonsResults.find((r) => String(r.leagueId) === String(selectedSeasonId));
    return found || seasonsResults[seasonsResults.length - 1];
  })();

  $: playoffDisplay = (() => {
    if (!selectedResult) return [];
    const raw = (selectedResult.playoffStandings && selectedResult.playoffStandings.length)
      ? selectedResult.playoffStandings.slice()
      : (selectedResult.standings || []).slice();
    if (!raw.length) return [];
    const champs = raw.filter((r) => r.champion === true).sort((a, b) => (b.pf || 0) - (a.pf || 0));
    const others = raw.filter((r) => r.champion !== true).sort((a, b) => {
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      return (b.pf || 0) - (a.pf || 0);
    });
    return [...champs, ...others];
  })();

  let seasonForm;
  function submitForm() { seasonForm?.submit?.(); }
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="head-row">
      <div>
        <div class="eyebrow">League · Standings</div>
        <h1 class="page-title">Standings</h1>
      </div>
      <form method="get" bind:this={seasonForm} class="season-form">
        <label for="season-select" class="visually-hidden">Season</label>
        <select id="season-select" name="season" bind:value={selectedSeasonId} on:change={submitForm} data-testid="standings-season-select">
          {#each seasons as s}
            <option value={s.season}>{s.season}</option>
          {/each}
        </select>
      </form>
    </div>
    {#if selectedResult}
      <p class="page-sub">{selectedResult.leagueName ?? `Season ${selectedResult.season ?? selectedResult.leagueId}`}</p>
    {/if}
  </header>

  <!-- Regular season -->
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

  <!-- Playoffs -->
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
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .head-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .page-title {
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 6vw, 4rem);
    line-height: 1;
    margin: 0.4rem 0 0;
    text-transform: uppercase;
  }
  .page-sub { color: var(--text-secondary); margin-top: 0.5rem; }

  .season-form select {
    min-width: 130px;
  }

  .standings-block {
    margin-bottom: 2rem;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    overflow: hidden;
  }

  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-subtle);
    gap: 1rem;
  }

  .block-title {
    font-family: var(--font-display);
    font-size: 1.4rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .block-sub {
    color: var(--text-tertiary);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-weight: 600;
  }

  .table-wrap {
    width: 100%;
    overflow-x: auto;
  }

  .bfa-table { min-width: 780px; }

  .rank-cell { width: 60px; }
  .rank-num {
    font-size: 1.4rem;
    color: var(--accent);
  }

  .team-cell {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .team-avatar.small {
    width: 42px;
    height: 42px;
  }

  .team-name-cell {
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.15;
  }

  .team-owner-cell {
    color: var(--text-tertiary);
    font-size: 0.78rem;
    margin-top: 0.15rem;
  }

  .trophy {
    margin-left: 0.4rem;
  }

  .pf .num { color: var(--text-primary); font-weight: 700; }
  .num.muted { color: var(--text-tertiary); }

  .empty-card {
    padding: 2rem;
    text-align: center;
    color: var(--text-secondary);
  }

  @media (max-width: 720px) {
    .head-row { flex-direction: column; align-items: stretch; }
    .season-form { display: flex; }
    .season-form select { flex: 1; }
  }
</style>
