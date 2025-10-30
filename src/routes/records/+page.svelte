<script>
  export let data;

  // aggregated lists from server
  $: aggregatedRegular = (data && data.aggregatedRegular && Array.isArray(data.aggregatedRegular)) ? data.aggregatedRegular : [];
  $: aggregatedPlayoff = (data && data.aggregatedPlayoff && Array.isArray(data.aggregatedPlayoff)) ? data.aggregatedPlayoff : [];

  // debug messages and json links
  $: debugMessages = (data && data.messages && Array.isArray(data.messages)) ? data.messages : [];
  $: jsonLinks = (data && data.jsonLinks && Array.isArray(data.jsonLinks)) ? data.jsonLinks : [];

  // ownership notes from server
  $: ownershipNotes = (data && data.ownershipNotes && Array.isArray(data.ownershipNotes)) ? data.ownershipNotes : [];

  // H2H data supplied by server
  $: h2hOwners = (data && data.h2hOwners && Array.isArray(data.h2hOwners)) ? data.h2hOwners : [];
  $: h2hRecords = (data && data.h2hRecords && typeof data.h2hRecords === 'object') ? data.h2hRecords : {};

  // UI state
  let selectedH2H = (h2hOwners && h2hOwners.length) ? h2hOwners[0].key : null;

  // avatar placeholder helper
  function avatarOrPlaceholder(url, name) {
    return url || `https://via.placeholder.com/48?text=${encodeURIComponent(name ? name[0] : 'T')}`;
  }

  // format a key's display name (owner:xxx or roster:...)
  function displayOwnerKey(key) {
    if (!key) return key;
    if (String(key).startsWith('owner:')) return String(key).slice(6);
    return String(key);
  }
</script>

<style>
  :global(body) { color-scheme: dark; }
  .page { max-width: 1100px; margin: 1.5rem auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: .6rem; color: #e6eef8; }

  .card { background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006)); border:1px solid rgba(255,255,255,0.04); border-radius:12px; padding:14px; margin-bottom:1rem; }
  .card-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:.5rem; }
  .section-title { font-size:1.05rem; font-weight:700; margin:0; color:#eef2ff; }
  .section-sub { color:#9ca3af; font-size:.9rem; }

  .table-wrap { width:100%; overflow:auto; -webkit-overflow-scrolling:touch; margin-top:.5rem; }
  .tbl { width:100%; border-collapse:collapse; font-size:0.95rem; min-width:740px; table-layout:auto; }

  thead th { text-align:left; padding:10px 12px; font-size:0.85rem; color:#9ca3af; background:linear-gradient(180deg, rgba(255,255,255,0.012), rgba(255,255,255,0.004)); text-transform:uppercase; letter-spacing:.02em; border-bottom:1px solid rgba(255,255,255,0.03); }
  tbody td { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.03); color:#e6eef8; vertical-align:middle; }
  tbody tr:nth-child(odd) { background: rgba(255,255,255,0.005); }
  tbody tr:hover { background: rgba(99,102,241,0.06); }

  .team-row { display:flex; align-items:center; gap:.75rem; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; background:#111; flex-shrink:0; }
  .team-cell { display:flex; flex-direction:column; min-width:200px; max-width:40%; }
  .team-name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .owner { color:#9ca3af; font-size:.9rem; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  .col-numeric { text-align:right; white-space:nowrap; font-variant-numeric: tabular-nums; }

  .h2h-controls { display:flex; align-items:center; gap:12px; }
  select.team-select { padding:8px 10px; border-radius:8px; background:#06101a; color:#e6eef8; border:1px solid rgba(255,255,255,0.04); }

  @media (max-width: 900px) {
    .avatar { width:44px; height:44px; }
    thead th, tbody td { padding:8px; }
  }

  @media (max-width: 520px) {
    .team-cell { max-width:60%; }
    .avatar { width:40px; height:40px; }
  }
</style>

<div class="page">
  {#if debugMessages && debugMessages.length}
    <div class="card" style="margin-bottom:1rem; color:#9ca3af;">
      <strong>Debug</strong>
      <div style="margin-top:.35rem;">
        {#each debugMessages as m, i}
          <div>{i + 1}. {m}</div>
        {/each}
        {#if jsonLinks && jsonLinks.length}
          <div style="margin-top:.5rem; font-weight:700; color:inherit">Loaded JSON files:</div>
          <div style="word-break:break-all; margin-top:.25rem;">
            {#each jsonLinks as jl}
              <a href={jl} target="_blank" rel="noopener noreferrer" style="color:#9ca3af; text-decoration:underline;">{jl}</a>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <h1>Standings (Aggregated)</h1>

  {#if ownershipNotes && ownershipNotes.length}
    <div style="background: rgba(99,102,241,0.04); border:1px solid rgba(99,102,241,0.08); padding:10px 12px; margin:8px 0 14px 0; border-radius:8px; color:#9ca3af;">
      {#each ownershipNotes as on}
        <div>{on}</div>
      {/each}
    </div>
  {/if}

  <div class="card" aria-labelledby="regular-title">
    <div class="card-header">
      <div>
        <div id="regular-title" class="section-title">Regular Season (Aggregated)</div>
        <div class="section-sub">Combined across available seasons</div>
      </div>
      <div class="section-sub">Sorted by Wins → PF</div>
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
            {#each aggregatedRegular as row}
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
      <div class="section-sub" style="padding:.5rem 0;">No regular season results to show.</div>
    {/if}
  </div>

  <div class="card" aria-labelledby="playoff-title">
    <div class="card-header">
      <div>
        <div id="playoff-title" class="section-title">Playoffs (Aggregated)</div>
        <div class="section-sub">Combined playoff window across available seasons</div>
      </div>
      <div class="section-sub">Champion seasons pinned to top where applicable</div>
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
      <div class="section-sub" style="padding:.5rem 0;">No playoff results to show.</div>
    {/if}
  </div>

  <!-- H2H section -->
  <div class="card" aria-labelledby="h2h-title">
    <div class="card-header">
      <div>
        <div id="h2h-title" class="section-title">Head-to-Head</div>
        <div class="section-sub">Select a team to view aggregated head-to-head records vs all opponents</div>
      </div>
      <div class="h2h-controls">
        <label for="h2h-select" style="color:#9ca3af; font-size:.9rem;">Team</label>
        <select id="h2h-select" class="team-select" bind:value={selectedH2H}>
          {#each h2hOwners as o}
            <option value={o.key}>{o.display}</option>
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
                    <img class="avatar" src={avatarOrPlaceholder(r.opponentAvatar, r.opponentDisplay)} alt={r.opponentDisplay} />
                    <div class="team-cell">
                      <div class="team-name">{r.opponentDisplay}</div>
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{r.wins}</td>
                <td class="col-numeric">{r.losses}</td>
                <td class="col-numeric">{r.games}</td>
                <td class="col-numeric">{r.pf}</td>
                <td class="col-numeric">{r.pa}</td>
                <td class="col-numeric">{r.lastSeason ? r.lastSeason + ' / W' + (r.lastWeek || '') : ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="section-sub" style="padding:.5rem 0;">No head-to-head data available for selected team.</div>
    {/if}
  </div>

  <!-- Top 10 margin tables (largest & smallest) -->
  <div class="card" aria-labelledby="margin-title">
    <div class="card-header">
      <div>
        <div id="margin-title" class="section-title">Top 10 — Largest Margin of Victory</div>
        <div class="section-sub">Year and week shown for each matchup</div>
      </div>
      <div class="section-sub">Sorted by margin (descending)</div>
    </div>

    {#if data && data.topLargestMargins && data.topLargestMargins.length}
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th class="col-numeric">MARGIN</th>
              <th>SEASON</th>
              <th>WEEK</th>
              <th>TEAM A</th>
              <th class="col-numeric">SCORE</th>
              <th>TEAM B</th>
            </tr>
          </thead>
          <tbody>
            {#each data.topLargestMargins as item}
              <tr>
                <td class="col-numeric">{item.rank}</td>
                <td class="col-numeric">{item.margin}</td>
                <td class="col-numeric">{item.season}</td>
                <td class="col-numeric">{item.week}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(item.avatarA, item.teamA)} alt={item.teamA} />
                    <div class="team-cell">
                      <div class="team-name">{item.teamA}</div>
                      {#if item.ownerA}<div class="owner">{item.ownerA}</div>{/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{item.pfA} - {item.pfB}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(item.avatarB, item.teamB)} alt={item.teamB} />
                    <div class="team-cell">
                      <div class="team-name">{item.teamB}</div>
                      {#if item.ownerB}<div class="owner">{item.ownerB}</div>{/if}
                    </div>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="section-sub" style="padding:.5rem 0;">No margin records found.</div>
    {/if}
  </div>

  <div class="card" aria-labelledby="margin-small">
    <div class="card-header">
      <div>
        <div id="margin-small" class="section-title">Top 10 — Smallest Margin of Victory</div>
        <div class="section-sub">Year and week shown for each matchup</div>
      </div>
      <div class="section-sub">Sorted by margin (ascending)</div>
    </div>

    {#if data && data.topSmallestMargins && data.topSmallestMargins.length}
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th class="col-numeric">MARGIN</th>
              <th>SEASON</th>
              <th>WEEK</th>
              <th>TEAM A</th>
              <th class="col-numeric">SCORE</th>
              <th>TEAM B</th>
            </tr>
          </thead>
          <tbody>
            {#each data.topSmallestMargins as item}
              <tr>
                <td class="col-numeric">{item.rank}</td>
                <td class="col-numeric">{item.margin}</td>
                <td class="col-numeric">{item.season}</td>
                <td class="col-numeric">{item.week}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(item.avatarA, item.teamA)} alt={item.teamA} />
                    <div class="team-cell">
                      <div class="team-name">{item.teamA}</div>
                      {#if item.ownerA}<div class="owner">{item.ownerA}</div>{/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{item.pfA} - {item.pfB}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(item.avatarB, item.teamB)} alt={item.teamB} />
                    <div class="team-cell">
                      <div class="team-name">{item.teamB}</div>
                      {#if item.ownerB}<div class="owner">{item.ownerB}</div>{/if}
                    </div>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="section-sub" style="padding:.5rem 0;">No small-margin records found.</div>
    {/if}
  </div>

</div>
