<script>
  // Standings page (regular / playoff split), aggregated across seasons.
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

  // Build playoff display for selected season (kept for reference)
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

  // --- JSON links from server (optional)
  $: jsonLinks = (data && Array.isArray(data.jsonLinks)) ? data.jsonLinks : [];

  // -------------------------
  // Aggregation across seasons
  // -------------------------
  function aggregateStandingsList(list, map) {
    if (!list || !Array.isArray(list)) return;
    for (const row of list) {
      if (!row) continue;
      // choose a stable key: use rosterId when present, else owner_id, else team_name (lowercased)
      let key = row.rosterId ?? row.roster_id ?? row.owner_id ?? null;
      if (!key) {
        key = (row.team_name ? ('team:' + String(row.team_name).toLowerCase()) : null);
      } else {
        key = String(key);
      }
      if (!key) continue;

      if (!map[key]) {
        map[key] = {
          rosterId: row.rosterId ?? row.roster_id ?? null,
          team_name: row.team_name ?? null,
          owner_name: row.owner_name ?? null,
          avatar: row.avatar ?? null,
          wins: 0,
          losses: 0,
          ties: 0,
          pf: 0,
          pa: 0,
          maxWinStreak: 0,
          maxLoseStreak: 0,
          seasonsCount: 0,
          championCount: 0
        };
      }

      const dest = map[key];
      dest.wins += Number(row.wins || 0);
      dest.losses += Number(row.losses || 0);
      dest.ties += Number(row.ties || 0);
      dest.pf += Number(row.pf || 0);
      dest.pa += Number(row.pa || 0);

      // keep latest non-null display fields if present
      if (row.team_name) dest.team_name = row.team_name;
      if (row.owner_name) dest.owner_name = row.owner_name;
      if (row.avatar) dest.avatar = row.avatar;

      // max streaks (take the maximum observed)
      dest.maxWinStreak = Math.max(dest.maxWinStreak || 0, Number(row.maxWinStreak || 0));
      dest.maxLoseStreak = Math.max(dest.maxLoseStreak || 0, Number(row.maxLoseStreak || 0));

      // champion
      if (row.champion === true) dest.championCount = (dest.championCount || 0) + 1;

      dest.seasonsCount = (dest.seasonsCount || 0) + 1;
    }
  }

  // aggregated regular / playoff maps -> arrays
  $: {
    const regMap = {};
    const poMap = {};
    if (seasonsResults && Array.isArray(seasonsResults)) {
      for (const sr of seasonsResults) {
        // regular standings can be in sr.regularStandings or sr.regular or sr.standings
        const regular = sr.regularStandings ?? sr.regular ?? sr.standings ?? [];
        aggregateStandingsList(regular, regMap);

        // playoff standings can be in sr.playoffStandings or sr.playoffs or sr.standings (fall back carefully)
        const playoff = sr.playoffStandings ?? sr.playoffs ?? sr.standings ?? [];
        // It's possible sr.standings is same as regular; to avoid double counting, only use sr.playoffStandings if present,
        // otherwise if sr.playoffStandings absent but sr.standings present and there are distinct playoff entries (we can't reliably detect),
        // we'll still include sr.standings in playoffs only when playoffStandings is present.
        if (sr.playoffStandings && sr.playoffStandings.length) {
          aggregateStandingsList(sr.playoffStandings, poMap);
        } else if (sr.playoffs && sr.playoffs.length) {
          aggregateStandingsList(sr.playoffs, poMap);
        } else if (sr.playoffStandings == null && sr.playoffs == null && sr.standings && sr.standings.length && !sr.regularStandings) {
          // edge-case: some seasons may put all in standings; treat as playoff only if no regularStandings present
          aggregateStandingsList(sr.standings, poMap);
        }
      }
    }

    // convert to arrays and sort
    aggregatedRegular = Object.keys(regMap).map(k => {
      const r = regMap[k];
      // round PF/PA to 2 decimals
      r.pf = Math.round((r.pf || 0) * 100) / 100;
      r.pa = Math.round((r.pa || 0) * 100) / 100;
      r.champion = (r.championCount || 0) > 0;
      return r;
    });

    aggregatedPlayoff = Object.keys(poMap).map(k => {
      const r = poMap[k];
      r.pf = Math.round((r.pf || 0) * 100) / 100;
      r.pa = Math.round((r.pa || 0) * 100) / 100;
      r.champion = (r.championCount || 0) > 0;
      return r;
    });

    // sorting: wins desc, then pf desc
    aggregatedRegular.sort((a,b) => {
      const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
      if (wb !== wa) return wb - wa;
      return (b.pf || 0) - (a.pf || 0);
    });

    aggregatedPlayoff.sort((a,b) => {
      const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
      if (wb !== wa) return wb - wa;
      return (b.pf || 0) - (a.pf || 0);
    });
  }

  // reactive arrays to be used inside template
  let aggregatedRegular = [];
  let aggregatedPlayoff = [];
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

        <!-- JSON links -->
        {#if jsonLinks && jsonLinks.length}
          <div style="margin-top:.5rem; font-weight:700; color:inherit">Loaded JSON files:</div>
          <div class="json-links" aria-live="polite">
            {#each jsonLinks as jl}
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

  <h1>Standings (Aggregated)</h1>

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

    <div class="small-muted">
      Aggregated seasons: <strong style="color:inherit">{seasonsResults.length}</strong>
      {#if selectedSeasonResult}
        • Showing selected: <strong style="color:inherit">{selectedSeasonResult.leagueName ?? `Season ${selectedSeasonResult.season ?? selectedSeasonResult.leagueId}`}</strong>
      {/if}
    </div>
  </div>

  <!-- Aggregated Regular Season -->
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
            {#each aggregatedRegular as row, idx}
              <tr>
                <td class="rank">{idx + 1}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                    <div>
                      <div class="team-name">{row.team_name}{#if row.championCount > 0}<span class="trophies" title="Champion seasons"> 🏆×{row.championCount}</span>{/if}</div>
                      {#if row.owner_name}
                        <div class="owner">{row.owner_name} <span class="small-muted">· {row.seasonsCount} seasons</span></div>
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

  <!-- Aggregated Playoffs -->
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
                    <div>
                      <div class="team-name">
                        <span>{row.team_name}</span>
                        {#if row.championCount > 0}
                          <span class="trophies" title="Champion seasons">🏆×{row.championCount}</span>
                        {/if}
                      </div>
                      {#if row.owner_name}
                        <div class="owner">{row.owner_name} <span class="small-muted">· {row.seasonsCount} seasons</span></div>
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
