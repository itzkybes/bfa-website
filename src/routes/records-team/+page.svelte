<!-- src/routes/records-team/+page.svelte — Team aggregated records, H2H, margins -->
<script>
  export let data;

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? name[0].toUpperCase() : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }

  $: aggregatedRegular = data?.aggregatedRegular ?? [];
  $: aggregatedPlayoff = data?.aggregatedPlayoff ?? [];
  $: ownershipNotes = data?.ownershipNotes ?? [];
  $: h2hOwners = data?.h2hOwners ?? [];
  $: h2hRecords = data?.h2hRecords ?? {};
  $: marginsLargest = data?.marginsLargest ?? [];
  $: marginsSmallest = data?.marginsSmallest ?? [];

  let selectedH2H = null;
  $: if ((!selectedH2H || selectedH2H === '') && h2hOwners.length) selectedH2H = h2hOwners[0].key;

  function lastLabel(season, week) {
    if (!season) return '—';
    return `${season} · W${week || ''}`;
  }
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="eyebrow">All-Time · Team Records</div>
    <h1 class="page-title">Team Records</h1>
    <p class="page-sub">Aggregated stats across every available season — head-to-head matchups, biggest blowouts and nailbiters.</p>
  </header>

  {#if ownershipNotes.length}
    <div class="note rise">
      {#each ownershipNotes as on}
        <div>{on}</div>
      {/each}
    </div>
  {/if}

  <!-- Aggregated Regular Season -->
  <section class="block">
    <div class="block-head">
      <h2 class="block-title">Regular Season — Aggregated</h2>
      <span class="block-sub">Sorted by Wins → PF</span>
    </div>
    {#if aggregatedRegular.length}
      <div class="table-wrap">
        <table class="bfa-table">
          <thead>
            <tr>
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
            {#each aggregatedRegular as row}
              <tr>
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
      <div class="empty-card">No regular season results to show.</div>
    {/if}
  </section>

  <!-- Aggregated Playoffs -->
  <section class="block">
    <div class="block-head">
      <h2 class="block-title">Playoffs — Aggregated</h2>
      <span class="block-sub">Champion seasons pinned 🏆</span>
    </div>
    {#if aggregatedPlayoff.length}
      <div class="table-wrap">
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
            {#each aggregatedPlayoff as row}
              <tr class:champion-row={row.champion === true}>
                <td>
                  <div class="team-cell">
                    <img class="team-avatar small" src={avatarOrPh(row.avatar, row.team_name)} alt={row.team_name} />
                    <div>
                      <div class="team-name-cell">
                        {row.team_name}
                        {#if row.champion === true}<span class="trophy">🏆</span>{/if}
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

  <!-- H2H -->
  <section class="block">
    <div class="block-head">
      <h2 class="block-title">Head-to-Head</h2>
      <div class="h2h-select">
        <label for="h2h-select" class="visually-hidden">Team</label>
        <select id="h2h-select" bind:value={selectedH2H} data-testid="h2h-team-select">
          {#each h2hOwners as o}
            <option value={o.key}>{o.team ? o.team : o.display}</option>
          {/each}
        </select>
      </div>
    </div>

    {#if selectedH2H && h2hRecords[selectedH2H]?.length}
      <div class="table-wrap">
        <table class="bfa-table">
          <thead>
            <tr>
              <th>Opponent</th>
              <th class="col-num">W</th>
              <th class="col-num">L</th>
              <th class="col-num">Games</th>
              <th class="col-num">PF</th>
              <th class="col-num">PA</th>
              <th class="col-num">Last</th>
            </tr>
          </thead>
          <tbody>
            {#each h2hRecords[selectedH2H] as r}
              <tr>
                <td>
                  <div class="team-cell">
                    <img class="team-avatar small" src={avatarOrPh(r.opponentAvatar, r.opponentTeam || r.opponentDisplay)} alt={r.opponentTeam || r.opponentDisplay} />
                    <div>
                      <div class="team-name-cell">{r.opponentTeam || r.opponentDisplay}</div>
                      {#if r.opponentDisplay && r.opponentTeam}
                        <div class="team-owner-cell">{r.opponentDisplay}</div>
                      {/if}
                    </div>
                  </div>
                </td>
                <td class="col-num"><span class="num win-color">{r.wins}</span></td>
                <td class="col-num"><span class="num loss-color">{r.losses}</span></td>
                <td class="col-num"><span class="num muted">{r.games}</span></td>
                <td class="col-num"><span class="num">{r.pf}</span></td>
                <td class="col-num"><span class="num muted">{r.pa}</span></td>
                <td class="col-num"><span class="num muted">{lastLabel(r.lastSeason, r.lastWeek)}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="empty-card">No head-to-head data for selected team.</div>
    {/if}
  </section>

  <!-- Margins -->
  <div class="margins-grid">
    <section class="block">
      <div class="block-head">
        <h2 class="block-title">Largest Margins</h2>
        <span class="block-sub">Top 10 blowouts</span>
      </div>
      {#if marginsLargest.length}
        <div class="margin-list">
          {#each marginsLargest as row}
            <div class="margin-row">
              <div class="margin-rank num">#{row.rank}</div>
              <div class="margin-teams">
                <div class="m-side">
                  <img class="team-avatar small" src={avatarOrPh(row.avatarA, row.teamAName)} alt={row.teamAName} />
                  <div class="m-mini">
                    <div class="m-mini-name">{row.teamAName}</div>
                    <div class="m-mini-score num">{row.scoreA}</div>
                  </div>
                </div>
                <div class="margin-value num">+{row.margin}</div>
                <div class="m-side right">
                  <div class="m-mini">
                    <div class="m-mini-name">{row.teamBName}</div>
                    <div class="m-mini-score num">{row.scoreB}</div>
                  </div>
                  <img class="team-avatar small" src={avatarOrPh(row.avatarB, row.teamBName)} alt={row.teamBName} />
                </div>
              </div>
              <div class="margin-meta">S{row.season} · W{row.week}</div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-card">No margin data.</div>
      {/if}
    </section>

    <section class="block">
      <div class="block-head">
        <h2 class="block-title">Smallest Margins</h2>
        <span class="block-sub">Top 10 nailbiters</span>
      </div>
      {#if marginsSmallest.length}
        <div class="margin-list">
          {#each marginsSmallest as row}
            <div class="margin-row">
              <div class="margin-rank num">#{row.rank}</div>
              <div class="margin-teams">
                <div class="m-side">
                  <img class="team-avatar small" src={avatarOrPh(row.avatarA, row.teamAName)} alt={row.teamAName} />
                  <div class="m-mini">
                    <div class="m-mini-name">{row.teamAName}</div>
                    <div class="m-mini-score num">{row.scoreA}</div>
                  </div>
                </div>
                <div class="margin-value tight num">{row.margin}</div>
                <div class="m-side right">
                  <div class="m-mini">
                    <div class="m-mini-name">{row.teamBName}</div>
                    <div class="m-mini-score num">{row.scoreB}</div>
                  </div>
                  <img class="team-avatar small" src={avatarOrPh(row.avatarB, row.teamBName)} alt={row.teamBName} />
                </div>
              </div>
              <div class="margin-meta">S{row.season} · W{row.week}</div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-card">No margin data.</div>
      {/if}
    </section>
  </div>
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }

  .page-head { margin-bottom: 2rem; }

  .page-title {
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 6vw, 4rem);
    line-height: 1;
    text-transform: uppercase;
    margin: 0.4rem 0 0.5rem;
  }

  .page-sub { color: var(--text-secondary); max-width: 60ch; }

  .note {
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    border-left: 3px solid var(--accent);
    border-radius: var(--r-sm);
    padding: 0.75rem 1rem;
    color: var(--text-primary);
    margin-bottom: 1.5rem;
    font-size: 0.9rem;
  }

  .block {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    overflow: hidden;
    margin-bottom: 1.25rem;
  }

  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-subtle);
    gap: 1rem;
    flex-wrap: wrap;
  }

  .block-title {
    font-family: var(--font-display);
    font-size: 1.3rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .block-sub {
    color: var(--text-tertiary);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-weight: 700;
  }

  .table-wrap { overflow-x: auto; }
  .bfa-table { min-width: 700px; }

  .team-cell {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .team-avatar.small { width: 42px; height: 42px; }

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

  .trophy { margin-left: 0.35rem; }
  .pf .num { font-weight: 800; }
  .num.muted { color: var(--text-tertiary); }
  .win-color { color: var(--win); }
  .loss-color { color: var(--loss); }

  .empty-card {
    padding: 1.5rem;
    text-align: center;
    color: var(--text-secondary);
  }

  .h2h-select select { min-width: 200px; }

  /* Margins */
  .margins-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .margin-list {
    padding: 0.5rem 0;
  }

  .margin-row {
    display: grid;
    grid-template-columns: 50px 1fr auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .margin-row:last-child { border-bottom: none; }

  .margin-rank {
    font-size: 1.1rem;
    color: var(--accent);
  }

  .margin-teams {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .m-side {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .m-side.right { justify-content: flex-end; flex-direction: row; }

  .m-mini { min-width: 0; }
  .m-side.right .m-mini { text-align: right; }

  .m-mini-name {
    font-weight: 600;
    font-size: 0.82rem;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .m-mini-score {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .margin-value {
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    padding: 0.25rem 0.55rem;
    border-radius: var(--r-sm);
    color: var(--accent);
    font-size: 1.1rem;
  }

  .margin-value.tight {
    color: var(--win);
    border-color: var(--win);
  }

  .margin-meta {
    color: var(--text-tertiary);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  @media (max-width: 980px) {
    .margins-grid { grid-template-columns: 1fr; }
  }

  @media (max-width: 720px) {
    .margin-row { grid-template-columns: 40px 1fr; }
    .margin-meta { grid-column: 2; }
    .margin-teams { grid-template-columns: 1fr; gap: 0.4rem; }
    .m-side.right { justify-content: flex-start; flex-direction: row-reverse; }
    .margin-value { justify-self: start; }
  }
</style>
