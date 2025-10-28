<script>
  // Standings page (regular / playoff split), formatted like Records page.
  export let data;

  // debug panel state
  let showDebug = true;
  let expanded = false;

  function toggleExpanded() { expanded = !expanded; }
  function dismissDebug() { showDebug = false; }

  // helper
  function avatarOrPlaceholder(url, name) {
    return url || `https://via.placeholder.com/56?text=${encodeURIComponent(name ? name[0] : 'T')}`;
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
  $: seasonsResults = (data && data.seasonsResults && Array.isArray(data.seasonsResults)) ? data.seasonsResults : [];

  $: selectedSeasonResult = (() => {
    if (!seasonsResults || seasonsResults.length === 0) return null;
    if (!selectedSeasonId || selectedSeasonId === 'all') {
      if (seasons && seasons.length) {
        const last = seasons[seasons.length - 1];
        return seasonsResults.find(r => String(r.leagueId) === String(last.league_id)) || seasonsResults[seasonsResults.length - 1];
      }
      return seasonsResults[seasonsResults.length - 1];
    } else {
      // prefer matching by season value (year), then leagueId
      let found = seasonsResults.find(r => r.season != null && String(r.season) === String(selectedSeasonId));
      if (found) return found;
      found = seasonsResults.find(r => String(r.leagueId) === String(selectedSeasonId));
      if (found) return found;
      // fallback
      return seasonsResults[0];
    }
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

  // --- NEW: JSON links from server (optional)
  // server may set data.jsonLinks = [{ title: 'season_matchups/2022.json', url: 'https://...' }, ...]
  $: jsonLinks = (data && Array.isArray(data.jsonLinks)) ? data.jsonLinks : [];
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
    min-width: 740px; /* force horizontal scroll on narrow screens so PF/PA remain reachable */
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

  /* Matchups-style select to match site-wide UI */
  .select {
    padding:.6rem .8rem;
    border-radius:8px;
    background: #07101a;
    color: var(--text);
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

  /* Rank column */
  .rank {
    width:48px;
    text-align:right;
    font-weight:700;
    padding-right:12px;
    color: #e6eef8;
  }

  /* JSON links list in debug panel */
  .json-links { margin-top: 0.5rem; display:flex; flex-direction:column; gap:6px; }
  .json-links a { color: #9fb0ff; font-weight:600; text-decoration: none; }
  .json-links a:hover { text-decoration: underline; }

  /* Responsive adjustments */
  @media (max-width: 1000px) {
    .tbl { min-width: 720px; }
  }

  @media (max-width: 900px) {
    .select { min-width: 100%; width:100%; }
    .avatar { width:44px; height:44px; }
    thead th, tbody td { padding: 8px; }
    .team-name { font-size: .95rem; }
    /* allow full horizontal scroll on small screens */
    .table-wrap { overflow:auto; }
  }

  @media (max-width: 520px) {
    .avatar { width:40px; height:40px; }
    thead th, tbody td { padding: 6px 8px; }
    .team-name { font-size: .98rem; }
  }
</style>

<div class="page">
  {#if data?.messages && data.messages.length}
    <div class="debug">
      <strong>Debug</strong>
      <div style="margin-top:.35rem;">
        {#each data.messages as m, i}
          <div>{i + 1}. {m}</div>
        {/each}

        <!-- NEW: render any JSON links provided by the server -->
        {#if jsonLinks && jsonLinks.length}
          <div style="margin-top:.5rem; font-weight:700; color:inherit">Loaded JSON files:</div>
          <div class="json-links" aria-live="polite">
            {#each jsonLinks as jl}
              <!-- jl expected shape: { title, url } or a raw string url -->
              {#if typeof jl === 'string'}
                <a href={jl} target="_blank" rel="noopener noreferrer">{jl}</a>
              {:else}
                <a href={jl.url} target="_blank" rel="noopener noreferrer">{jl.title ?? jl.url}</a>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <h1>Standings</h1>

  <div class="controls-row">
    <div class="controls" aria-hidden="false">
      <form method="get" bind:this={seasonForm} style="display:flex; gap:.5rem; align-items:center;">
        <label for="season-select" class="small-muted" aria-hidden="true">Season</label>
        <select id="season-select" name="season" class="select" bind:value={selectedSeasonId} on:change={submitForm}>
          {#each seasons.filter(s => s.season != null) as s}
            <option value={s.season}>{seasonLabel(s)}</option>
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
      <div class="table-wrap" role="region" aria-label="Regular season standings table scrollable">
        <table class="tbl" role="table" aria-label="Regular season standings">
          <thead>
            <tr>
              <th>#</th>
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
            {#each selectedSeasonResult.regularStandings as row, idx}
              <tr>
                <td class="rank">{idx + 1}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                    <div>
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

  <div class="card" aria-labelledby="playoff-title">
    <div class="card-header">
      <div>
        <div id="playoff-title" class="section-title">Playoffs</div>
        <div class="section-sub">Playoff window only</div>
      </div>
      <div class="small-muted">Champion(s) pinned to top</div>
    </div>

    {#if selectedSeasonResult && ( (selectedSeasonResult.playoffStandings && selectedSeasonResult.playoffStandings.length) || (selectedSeasonResult.standings && selectedSeasonResult.standings.length) )}
      <!-- wrap playoff table as well so users can horizontally scroll to PF/PA on mobile -->
      <div class="table-wrap" role="region" aria-label="Playoff standings table scrollable">
        <table class="tbl" role="table" aria-label="Playoff standings">
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
            {#each playoffDisplay as row}
              <tr aria-current={row.champion === true ? 'true' : undefined}>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                    <div>
                      <div class="team-name">
                        <span>{row.team_name}</span>
                        {#if row.champion === true}
                          <span class="trophies" title="Champion">🏆</span>
                        {/if}
                      </div>
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
</div>
