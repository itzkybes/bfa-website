<script>
  // Standings page (regular / playoff split), formatted like Records page.
  export let data;

  // debug panel state
  let showDebug = true;
  let expanded = false;

  function toggleExpanded() { expanded = !expanded; }
  function dismissDebug() { showDebug = false; }

  // helper
  function avatarOrPlaceholder(url, name, size = 56) {
    return url || `https://via.placeholder.com/${size}?text=${encodeURIComponent(name ? name[0] : 'T')}`;
  }

  // seasons list from server
  const seasons = (data && data.seasons && Array.isArray(data.seasons)) ? data.seasons : [];

  // Determine latest season year (only include seasons with numeric season)
  const numericSeasons = seasons.filter(s => s.season != null);
  const latestSeasonDefault = numericSeasons.length
    ? String(numericSeasons[numericSeasons.length - 1].season)
    : (seasons.length ? String(seasons[seasons.length - 1].league_id) : 'all');

  // default selected season: prefer server's selectedSeason if it matches an available season,
  // otherwise default to the latest season year
  let selectedSeasonId = (() => {
    const ds = data && data.selectedSeason ? String(data.selectedSeason) : null;
    if (ds) {
      const matches = seasons.some(s => (s.season != null && String(s.season) === ds) || String(s.league_id) === ds);
      if (matches) return ds;
    }
    return latestSeasonDefault;
  })();

  // reactive seasonsResults / selectedSeasonResult
  $: seasonsResults = (data && data.seasonsResults && Array.isArray(data.seasonsResults)) ? data.seasonsResults
      // some loaders use "seasonsResults" while others use "seasonsResults" wrapped differently;
      // as a fallback, try data.seasonsResults, data.seasonsResultsFromServer, or construct from data.results
      : (data && data.seasonsResults ? data.seasonsResults : (data && data.seasonsResultsFromServer ? data.seasonsResultsFromServer : (data && data.seasonsResultsRaw ? data.seasonsResultsRaw : [])));

  // Many loaders use data.seasonsResults or data.seasonsResults; if none provided, try other shapes:
  $: if ((!seasonsResults || seasonsResults.length === 0) && data && Array.isArray(data.data)) {
    // fallback: some loaders put season results in data.data
    seasonsResults = data.data;
  }

  $: selectedSeasonResult = (() => {
    if (!seasonsResults || seasonsResults.length === 0) return null;

    // if selectedSeasonId is 'all' or falsy, pick the last (most recent) seasonsResults
    if (!selectedSeasonId || selectedSeasonId === 'all') {
      return seasonsResults[seasonsResults.length - 1];
    }

    // prefer matching by season value (year), then leagueId
    let found = seasonsResults.find(r => r.season != null && String(r.season) === String(selectedSeasonId));
    if (found) return found;
    found = seasonsResults.find(r => String(r.leagueId) === String(selectedSeasonId));
    if (found) return found;

    // some loaders provide nested "data" array (e.g. data.data[0])
    for (const r of seasonsResults) {
      if (r && r.data && Array.isArray(r.data)) {
        const f2 = r.data.find(x => (x.season != null && String(x.season) === String(selectedSeasonId)) || String(x.leagueId) === String(selectedSeasonId));
        if (f2) return f2;
      }
    }

    // fallback to first available
    return seasonsResults[0];
  })();

  function seasonLabel(s) {
    if (!s) return 'Unknown';
    if (s.season != null) return String(s.season);
    if (s.name) return s.name;
    return s.league_id || 'Unknown';
  }

  // submit form when user changes season
  let seasonForm;
  function submitForm() {
    seasonForm && seasonForm.submit && seasonForm.submit();
  }

  // Build playoff display: champion(s) first, then others sorted by wins -> pf
  $: playoffDisplay = (() => {
    if (!selectedSeasonResult) return [];
    const raw = (selectedSeasonResult.playoffStandings && selectedSeasonResult.playoffStandings.length)
      ? selectedSeasonResult.playoffStandings.slice()
      : (selectedSeasonResult.standings && selectedSeasonResult.standings.length ? selectedSeasonResult.standings.slice() : []);

    if (!raw || raw.length === 0) return [];

    const champs = raw.filter(r => r.champion === true);
    const others = raw.filter(r => r.champion !== true);

    // sort champions by pf desc (if multiple)
    champs.sort((a,b) => (b.pf || 0) - (a.pf || 0));

    // sort others by wins desc then pf desc
    others.sort((a,b) => {
      const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
      if (wb !== wa) return wb - wa;
      return (b.pf || 0) - (a.pf || 0);
    });

    return [...champs, ...others];
  })();
</script>

<style>
  :global(body) {
    --bg: #0b1220;
    --card: #071025;
    --muted: #9ca3af;
    --accent: rgba(99,102,241,0.08);
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

  .controls-row {
    display:flex;
    justify-content:space-between;
    gap:1rem;
    align-items:center;
    margin: .6rem 0 1rem 0;
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
  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
    overflow: hidden;
    border-radius: 8px;
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
  }

  tbody tr:nth-child(odd) {
    background: rgba(255,255,255,0.005);
  }

  tbody tr:hover {
    background: rgba(99,102,241,0.06);
    transform: translateZ(0);
  }

  .team-row { display:flex; align-items:center; gap:0.75rem; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; background:#111; flex-shrink:0; }
  .team-name { font-weight:700; display:flex; align-items:center; gap:.5rem; }
  .owner { color: var(--muted); font-size:.9rem; margin-top:2px; }

  .col-numeric { text-align:right; white-space:nowrap; font-variant-numeric: tabular-nums; }

  .trophies { margin-left:.4rem; font-size:0.98rem; }
  .small-muted { color: var(--muted); font-size: .88rem; }

  .controls {
    display:flex;
    gap:.75rem;
    align-items:center;
  }

  /* New .select style — matches the Matchups page styles for visual consistency */
  .select {
    padding:.6rem .8rem;
    border-radius:8px;
    background: #07101a;
    color: #e6eef8;
    border: 1px solid rgba(99,102,241,0.25);
    box-shadow: 0 4px 14px rgba(2,6,23,0.45), inset 0 -1px 0 rgba(255,255,255,0.01);
    min-width: 160px;
    font-weight: 600;
    outline: none;
  }
  .select:focus {
    border-color: rgba(99,102,241,0.6);
    box-shadow: 0 6px 20px rgba(2,6,23,0.6), 0 0 0 4px rgba(99,102,241,0.06);
  }

  /* Responsive adjustments */
  @media (max-width: 900px) {
    .avatar { width:48px; height:48px; }
    thead th, tbody td { padding: 8px; }
    .team-name { font-size: .95rem; }
    .col-hide-sm { display:none; }

    /* mobile: hide headers and display rows as cards */
    thead { display:none; }
    tbody { display:block; }
    tbody tr { display:block; margin-bottom:12px; border-radius:10px; background: rgba(255,255,255,0.006); border:1px solid rgba(255,255,255,0.03); padding:10px; }
    tbody tr td { display:block; padding:8px 0; border-bottom:none; }

    /* team row layout: avatar + name on left, stats block floats to right */
    .team-row { align-items:center; justify-content:space-between; }
    .team-meta { max-width: calc(100% - 140px); } /* room for stat column */
    .col-numeric { text-align:right; display:flex; gap:8px; justify-content:flex-end; align-items:center; }
    .stat-pill { background: rgba(255,255,255,0.01); padding:6px 10px; border-radius:8px; font-weight:700; color: #e6eef8; min-width:48px; text-align:center; }
  }

  @media (max-width:520px) {
    .avatar { width:40px; height:40px; }
    .team-name { font-size:0.98rem; }
    .stat-pill { padding:5px 8px; font-size:0.95rem; }
  }

  a:focus, button:focus, select:focus {
    outline: 3px solid rgba(0,198,216,0.12);
    outline-offset: 2px;
    border-radius:6px;
  }
</style>

<div class="page">
  {#if data?.messages && data.messages.length && showDebug}
    <div class="debug" role="status" aria-live="polite">
      <strong>Debug</strong>
      <div style="margin-top:.35rem;">
        {#each data.messages as m, i}
          <div>{i + 1}. {m}</div>
        {/each}
      </div>
      <div style="margin-top:.5rem;">
        <button on:click={dismissDebug} class="select" style="background:transparent; border:1px solid rgba(255,255,255,0.03); color:var(--muted);">Dismiss</button>
      </div>
    </div>
  {/if}

  <h1>Standings</h1>

  <div class="controls-row">
    <div class="controls" aria-hidden="false">
      <form method="get" bind:this={seasonForm} style="display:flex; gap:.5rem; align-items:center;">
        <label for="season-select" class="small-muted" aria-hidden="true">Season</label>
        <select id="season-select" name="season" class="select" bind:value={selectedSeasonId} on:change={submitForm} aria-label="Select season">
          {#each seasons as s}
            <!-- show only numeric seasons if available, but include league_id fallback -->
            <option value={s.season != null ? s.season : s.league_id} selected={String(s.season != null ? s.season : s.league_id) === String(selectedSeasonId)}>{seasonLabel(s)}</option>
          {/each}
        </select>
      </form>
    </div>

    {#if selectedSeasonResult}
      <div class="small-muted">Showing: <strong style="color:inherit">{selectedSeasonResult.leagueName ?? `Season ${selectedSeasonResult.season ?? selectedSeasonResult.leagueId}`}</strong></div>
    {/if}
  </div>

  <div class="card" aria-labelledby="regular-title" style="margin-bottom:1rem;">
    <div class="card-header">
      <div>
        <div id="regular-title" class="section-title">Regular Season</div>
        <div class="section-sub">Weeks 1 → playoff start - 1</div>
      </div>
      <div class="small-muted">Sorted by Wins → PF</div>
    </div>

    {#if selectedSeasonResult && selectedSeasonResult.regularStandings && selectedSeasonResult.regularStandings.length}
      <table class="tbl" role="table" aria-label="Regular season standings">
        <thead>
          <tr>
            <th>Team / Owner</th>
            <th class="col-numeric">W</th>
            <th class="col-numeric">L</th>
            <th class="col-numeric">Longest W-Str</th>
            <th class="col-numeric">Longest L-Str</th>
            <th class="col-numeric col-hide-sm">PF</th>
            <th class="col-numeric col-hide-sm">PA</th>
          </tr>
        </thead>
        <tbody>
          {#each selectedSeasonResult.regularStandings as row}
            <tr>
              <td>
                <div class="team-row">
                  <div style="display:flex; align-items:center; gap:.6rem; min-width:0;">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatar || row.team_avatar || row.owner_avatar, row.team_name)} alt={row.team_name || row.name} />
                    <div class="team-meta">
                      <div class="team-name">{row.team_name ?? row.name ?? row.owner ?? (`Roster ${row.roster_id ?? ''}`)}</div>
                      {#if row.owner_name || row.owner} <div class="owner">{row.owner_name ?? row.owner}</div> {/if}
                    </div>
                  </div>

                  <!-- desktop stats cluster; on mobile these will appear as pills -->
                  <div class="col-numeric" style="display:flex; gap:8px; align-items:center; justify-content:flex-end;">
                    {#if row.wins != null || row.losses != null}
                      <div class="stat-pill" title="W-L">{(row.wins != null || row.losses != null) ? `${row.wins ?? 0}-${row.losses ?? 0}${row.ties ? '-' + row.ties : ''}` : '-'}</div>
                    {/if}
                    {#if row.win_pct != null}
                      <div class="stat-pill" title="Win %">{(typeof row.win_pct === 'number') ? row.win_pct.toFixed(3) : row.win_pct}</div>
                    {/if}
                    {#if row.pf != null}
                      <div class="stat-pill" title="Points For">{row.pf}</div>
                    {/if}
                  </div>
                </div>
              </td>

              <td class="col-numeric">{row.wins ?? '-'}</td>
              <td class="col-numeric">{row.losses ?? '-'}</td>
              <td class="col-numeric">{row.maxWinStreak ?? (row.maxWinStreak === 0 ? 0 : '-')}</td>
              <td class="col-numeric">{row.maxLoseStreak ?? (row.maxLoseStreak === 0 ? 0 : '-')}</td>
              <td class="col-numeric col-hide-sm">{row.pf ?? '-'}</td>
              <td class="col-numeric col-hide-sm">{row.pa ?? '-'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No regular season results to show.</div>
    {/if}
  </div>

  <div class="card" aria-labelledby="playoff-title">
    <div class="card-header">
      <div>
        <div id="playoff-title" class="section-title">Playoffs</div>
        <div class="section-sub">Playoff window only</div>
      </div>
      <div class="small-muted">Champion(s) pinned to top</div>
    </div>

    {#if selectedSeasonResult && ( (selectedSeasonResult.playoffStandings && selectedSeasonResult.playoffStandings.length) || (selectedSeasonResult.standings && selectedSeasonResult.standings.length) )}
      <table class="tbl" role="table" aria-label="Playoff standings">
        <thead>
          <tr>
            <th>Team / Owner</th>
            <th class="col-numeric">W</th>
            <th class="col-numeric">L</th>
            <th class="col-numeric col-hide-sm">PF</th>
            <th class="col-numeric col-hide-sm">PA</th>
          </tr>
        </thead>
        <tbody>
          {#each playoffDisplay as row}
            <tr aria-current={row.champion === true ? 'true' : undefined}>
              <td>
                <div class="team-row">
                  <div style="display:flex; align-items:center; gap:.6rem; min-width:0;">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatar || row.team_avatar || row.owner_avatar, row.team_name)} alt={row.team_name || row.name} />
                    <div>
                      <div class="team-name">
                        <span>{row.team_name ?? row.name}</span>
                        {#if row.champion === true}
                          <span class="trophies" title="Champion">🏆</span>
                        {/if}
                      </div>
                      {#if row.owner_name || row.owner}
                        <div class="owner">{row.owner_name ?? row.owner}</div>
                      {/if}
                    </div>
                  </div>

                  <div class="col-numeric" style="display:flex; gap:8px; align-items:center; justify-content:flex-end;">
                    {#if row.wins != null || row.losses != null}
                      <div class="stat-pill" title="W-L">{(row.wins != null || row.losses != null) ? `${row.wins ?? 0}-${row.losses ?? 0}${row.ties ? '-' + row.ties : ''}` : '-'}</div>
                    {/if}
                    {#if row.pf != null}
                      <div class="stat-pill" title="Points For">{row.pf}</div>
                    {/if}
                  </div>
                </div>
              </td>

              <td class="col-numeric">{row.wins ?? '-'}</td>
              <td class="col-numeric">{row.losses ?? '-'}</td>
              <td class="col-numeric col-hide-sm">{row.pf ?? '-'}</td>
              <td class="col-numeric col-hide-sm">{row.pa ?? '-'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No playoff results to show.</div>
    {/if}
  </div>
</div>
