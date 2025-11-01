<script>
  // Standings page (aggregated regular / playoff)
  export let data;

  // helper for placeholders
  function avatarOrPlaceholder(url, name) {
    return url || `https://via.placeholder.com/56?text=${encodeURIComponent(name ? name[0] : 'T')}`;
  }

  // aggregated lists from server
  $: aggregatedRegular = (data && data.aggregatedRegular && Array.isArray(data.aggregatedRegular)) ? data.aggregatedRegular : [];
  $: aggregatedPlayoff = (data && data.aggregatedPlayoff && Array.isArray(data.aggregatedPlayoff)) ? data.aggregatedPlayoff : [];

  // debug messages and json links
  $: debugMessages = (data && data.messages && Array.isArray(data.messages)) ? data.messages : [];
  $: jsonLinks = (data && data.jsonLinks && Array.isArray(data.jsonLinks)) ? data.jsonLinks : [];

  // ownership notes from server (e.g. remapping owners)
  $: ownershipNotes = (data && data.ownershipNotes && Array.isArray(data.ownershipNotes)) ? data.ownershipNotes : [];

  // H2H
  $: h2hOwners = (data && data.h2hOwners && Array.isArray(data.h2hOwners)) ? data.h2hOwners : [];
  $: h2hRecords = (data && data.h2hRecords && typeof data.h2hRecords === 'object') ? data.h2hRecords : {};

  // margins
  $: marginsLargest = (data && data.marginsLargest && Array.isArray(data.marginsLargest)) ? data.marginsLargest : [];
  $: marginsSmallest = (data && data.marginsSmallest && Array.isArray(data.marginsSmallest)) ? data.marginsSmallest : [];

  // UI state
  // default selected H2H to first owner if available
  let selectedH2H = null;
  $: if ((!selectedH2H || selectedH2H === '') && h2hOwners && h2hOwners.length) selectedH2H = h2hOwners[0].key;

  function formatLast(season, week) {
    if (!season) return '';
    return `${season} / W${week || ''}`;
  }
</script>

<style>
  :global(body) {
    --bg: #0b1220;
    --card: #071025;
    --muted: #9ca3af;
    --accent: rgba(99,102,241,0.08);
    --text: #e6eef8;
    color-scheme: dark;
  }

  .page {
    max-width: 1100px;
    margin: 1.5rem auto;
    padding: 0 1rem;
  }

  h1 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
  }

  .debug {
    margin-bottom: 1rem;
    color: var(--muted);
    font-size: 0.95rem;
  }

  .ownership-note {
    background: rgba(99,102,241,0.04);
    border: 1px solid rgba(99,102,241,0.08);
    padding: 10px 12px;
    margin: 8px 0 14px 0;
    border-radius: 8px;
    color: var(--muted);
    font-size: 0.95rem;
  }

  .card {
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
    overflow: hidden;
  }

  .card-header {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:1rem;
    margin-bottom: 0.5rem;
  }

  .section-title {
    font-size:1.05rem;
    font-weight:700;
    margin:0;
  }
  .section-sub {
    color: var(--muted);
    font-size: .9rem;
  }

  /* Table styling */
  .table-wrap {
    width:100%;
    overflow:auto;
    -webkit-overflow-scrolling: touch;
    margin-top: .5rem;
  }

  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
    overflow: hidden;
    border-radius: 8px;
    min-width: 740px;
    table-layout: auto;
  }

  thead th {
    text-align:left;
    padding: 10px 12px;
    font-size: 0.85rem;
    color: var(--muted);
    background: linear-gradient(180deg, rgba(255,255,255,0.012), rgba(255,255,255,0.004));
    text-transform: uppercase;
    letter-spacing: 0.02em;
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }

  tbody td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    color: #e6eef8;
    vertical-align: middle;
    overflow: hidden;
  }

  tbody tr:nth-child(odd) {
    background: rgba(255,255,255,0.005);
  }

  tbody tr:hover {
    background: rgba(99,102,241,0.06);
    transform: translateZ(0);
  }

  .team-row { display:flex; align-items:center; gap:0.75rem; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; background:#111; flex-shrink:0; display:block; }
  .team-cell { display:flex; flex-direction:column; min-width:220px; max-width: 42%; }
  .team-name { font-weight:700; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .owner { color: var(--muted); font-size:.9rem; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  .col-numeric { text-align:right; white-space:nowrap; font-variant-numeric: tabular-nums; }

  .trophies { margin-left:.4rem; font-size:0.98rem; }
  .small-muted { color: var(--muted); font-size: .88rem; }

  .rank {
    width:48px;
    text-align:right;
    font-weight:700;
    padding-right:12px;
    color: #e6eef8;
  }

  .h2h-controls { display:flex; align-items:center; gap:12px; }
  .team-select { padding:8px 10px; border-radius:8px; background:#06101a; color:var(--text); border:1px solid rgba(255,255,255,0.04); }

  @media (max-width: 900px) {
    .avatar { width:44px; height:44px; }
    thead th, tbody td { padding: 8px; }
    .team-name { font-size: .95rem; }
  }

  @media (max-width: 520px) {
    .avatar { width:40px; height:40px; }
    thead th, tbody td { padding: 6px 8px; }
    .team-name { font-size: .98rem; }
    .team-cell { max-width: 60%; }
  }

  .json-links a {
    display:block;
    color: var(--muted);
    text-decoration: underline;
    margin-top: .25rem;
    word-break:break-all;
  }
</style>

<div class="page">
  {#if debugMessages && debugMessages.length}
    <div class="debug">
      <strong>Debug</strong>
      <div style="margin-top:.35rem;">
        {#each debugMessages as m, i}
          <div>{i + 1}. {m}</div>
        {/each}

        {#if jsonLinks && jsonLinks.length}
          <div style="margin-top:.5rem; font-weight:700; color:inherit">Loaded JSON files:</div>
          <div class="json-links" aria-live="polite">
            {#each jsonLinks as jl}
              <a href={jl} target="_blank" rel="noopener noreferrer">{jl}</a>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <h1>Standings (Aggregated)</h1>

  {#if ownershipNotes && ownershipNotes.length}
    <div class="ownership-note" role="note" aria-live="polite">
      {#each ownershipNotes as on}
        <div>{on}</div>
      {/each}
    </div>
  {/if}

  <div class="small-muted" style="margin-bottom:.6rem;">
    Aggregated rows — regular: <strong>{aggregatedRegular.length}</strong>, playoffs: <strong>{aggregatedPlayoff.length}</strong>
  </div>

  <!-- Regular Season -->
  <div class="card" aria-labelledby="regular-title" style="margin-bottom:1rem;">
    <div class="card-header">
      <div>
        <div id="regular-title" class="section-title">Regular Season (Aggregated)</div>
        <div class="section-sub">Combined across available seasons</div>
      </div>
      <div class="small-muted">Sorted by Wins → PF</div>
    </div>

    {#if aggregatedRegular && aggregatedRegular.length}
      <div class="table-wrap" role="region" aria-label="Aggregated regular season standings table scrollable">
        <table class="tbl" role="table" aria-label="Aggregated regular season standings">
          <thead>
            <tr>
              <th>Team / Owner</th>
              <th class="col-numeric">W</th>
              <th class="col-numeric">L</th>
              <th class="col-numeric">Longest W-Str</th>
              <th class="col-numeric">Longest L-Str</th>
              <th class="col-numeric">PF</th>
              <th class="col-numeric">PA</th>
            </tr>
          </thead>
          <tbody>
            {#each aggregatedRegular as row, idx}
              <tr>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                    <div class="team-cell">
                      <div class="team-name">{row.team_name}</div>
                      {#if row.owner_name}
                        <div class="owner">{row.owner_name}</div>
                      {/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{row.wins}</td>
                <td class="col-numeric">{row.losses}</td>
                <td class="col-numeric">{row.maxWinStreak ?? (row.maxWinStreak === 0 ? 0 : '')}</td>
                <td class="col-numeric">{row.maxLoseStreak ?? (row.maxLoseStreak === 0 ? 0 : '')}</td>
                <td class="col-numeric">{row.pf}</td>
                <td class="col-numeric">{row.pa}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No regular season results to show.</div>
    {/if}
  </div>

  <!-- Playoffs -->
  <div class="card" aria-labelledby="playoff-title">
    <div class="card-header">
      <div>
        <div id="playoff-title" class="section-title">Playoffs (Aggregated)</div>
        <div class="section-sub">Combined playoff window across available seasons</div>
      </div>
      <div class="small-muted">Champion seasons pinned to top where applicable</div>
    </div>

    {#if aggregatedPlayoff && aggregatedPlayoff.length}
      <div class="table-wrap" role="region" aria-label="Aggregated playoff standings table scrollable">
        <table class="tbl" role="table" aria-label="Aggregated playoff standings">
          <thead>
            <tr>
              <th>Team / Owner</th>
              <th class="col-numeric">W</th>
              <th class="col-numeric">L</th>
              <th class="col-numeric">PF</th>
              <th class="col-numeric">PA</th>
            </tr>
          </thead>
          <tbody>
            {#each aggregatedPlayoff as row}
              <tr aria-current={row.champion === true ? 'true' : undefined}>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                    <div class="team-cell">
                      <div class="team-name">{row.team_name}</div>
                      {#if row.owner_name}
                        <div class="owner">{row.owner_name}</div>
                      {/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{row.wins}</td>
                <td class="col-numeric">{row.losses}</td>
                <td class="col-numeric">{row.pf}</td>
                <td class="col-numeric">{row.pa}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No playoff results to show.</div>
    {/if}
  </div>

  <!-- Head-to-Head -->
  <div class="card" aria-labelledby="h2h-title" style="margin-top:1rem;">
    <div class="card-header">
      <div>
        <div id="h2h-title" class="section-title">Head-to-Head</div>
        <div class="section-sub">Select a team to view aggregated head-to-head records vs all opponents</div>
      </div>
      <div class="h2h-controls">
        <label for="h2h-select" class="small-muted">Team</label>
        <select id="h2h-select" class="team-select" bind:value={selectedH2H}>
          {#each h2hOwners as o}
            <option value={o.key}>{o.team ? o.team : o.display}</option>
          {/each}
        </select>
      </div>
    </div>

    {#if selectedH2H && h2hRecords[selectedH2H] && h2hRecords[selectedH2H].length}
      <div class="table-wrap" role="region" aria-label="H2H table scrollable">
        <table class="tbl" role="table" aria-label="Head to Head records">
          <thead>
            <tr>
              <th>Opponent</th>
              <th class="col-numeric">W</th>
              <th class="col-numeric">L</th>
              <th class="col-numeric">Games</th>
              <th class="col-numeric">PF</th>
              <th class="col-numeric">PA</th>
              <th class="col-numeric">Last</th>
            </tr>
          </thead>
          <tbody>
            {#each h2hRecords[selectedH2H] as r}
              <tr>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(r.opponentAvatar, r.opponentTeam || r.opponentDisplay)} alt={r.opponentTeam || r.opponentDisplay} />
                    <div class="team-cell">
                      <div class="team-name">{r.opponentTeam ? r.opponentTeam : r.opponentDisplay}</div>
                      {#if r.opponentDisplay}
                        <div class="owner">{r.opponentDisplay}</div>
                      {/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{r.wins}</td>
                <td class="col-numeric">{r.losses}</td>
                <td class="col-numeric">{r.games}</td>
                <td class="col-numeric">{r.pf}</td>
                <td class="col-numeric">{r.pa}</td>
                <td class="col-numeric">{formatLast(r.lastSeason, r.lastWeek)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No head-to-head data available for selected team.</div>
    {/if}
  </div>

  <!-- Margins: Largest -->
  <div class="card" style="margin-top:1rem;">
    <div class="card-header">
      <div>
        <div class="section-title">Top 10 — Largest Margin of Victory</div>
        <div class="section-sub">Year and week shown for each matchup</div>
      </div>
      <div class="small-muted">Sorted by margin (descending)</div>
    </div>

    {#if marginsLargest && marginsLargest.length}
      <div class="table-wrap">
        <table class="tbl" role="table" aria-label="Largest margins">
          <thead>
            <tr>
              <th>#</th>
              <th class="col-numeric">Margin</th>
              <th>Season</th>
              <th>Week</th>
              <th>Team A</th>
              <th class="col-numeric">Score</th>
              <th>Team B</th>
            </tr>
          </thead>
          <tbody>
            {#each marginsLargest as row}
              <tr>
                <td class="col-numeric">{row.rank}</td>
                <td class="col-numeric">{row.margin}</td>
                <td class="col-numeric">{row.season}</td>
                <td class="col-numeric">{row.week}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatarA, row.teamAName)} alt={row.teamAName} />
                    <div class="team-cell">
                      <div class="team-name">{row.teamAName}</div>
                      <div class="owner">{row.ownerA}</div>
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{row.scoreA} - {row.scoreB}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatarB, row.teamBName)} alt={row.teamBName} />
                    <div class="team-cell">
                      <div class="team-name">{row.teamBName}</div>
                      <div class="owner">{row.ownerB}</div>
                    </div>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No margin data available.</div>
    {/if}
  </div>

  <!-- Margins: Smallest -->
  <div class="card" style="margin-top:1rem;">
    <div class="card-header">
      <div>
        <div class="section-title">Top 10 — Smallest Margin of Victory</div>
        <div class="section-sub">Year and week shown for each matchup</div>
      </div>
      <div class="small-muted">Sorted by margin (ascending, non-zero)</div>
    </div>

    {#if marginsSmallest && marginsSmallest.length}
      <div class="table-wrap">
        <table class="tbl" role="table" aria-label="Smallest margins">
          <thead>
            <tr>
              <th>#</th>
              <th class="col-numeric">Margin</th>
              <th>Season</th>
              <th>Week</th>
              <th>Team A</th>
              <th class="col-numeric">Score</th>
              <th>Team B</th>
            </tr>
          </thead>
          <tbody>
            {#each marginsSmallest as row}
              <tr>
                <td class="col-numeric">{row.rank}</td>
                <td class="col-numeric">{row.margin}</td>
                <td class="col-numeric">{row.season}</td>
                <td class="col-numeric">{row.week}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatarA, row.teamAName)} alt={row.teamAName} />
                    <div class="team-cell">
                      <div class="team-name">{row.teamAName}</div>
                      <div class="owner">{row.ownerA}</div>
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{row.scoreA} - {row.scoreB}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatarB, row.teamBName)} alt={row.teamBName} />
                    <div class="team-cell">
                      <div class="team-name">{row.teamBName}</div>
                      <div class="owner">{row.ownerB}</div>
                    </div>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No margin data available.</div>
    {/if}
  </div>

  <!-- Ownership note repeated at bottom (user asked for bottom) -->
  {#if ownershipNotes && ownershipNotes.length}
    <div class="ownership-note" role="note" style="margin-top:1rem;">
      {#each ownershipNotes as on}
        <div>{on}</div>
      {/each}
    </div>
  {/if}
</div>
