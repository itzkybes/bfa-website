<script>
  // Records page: all-time regular season and playoff standings + extra record tables.
  export let data;

  // Helpers
  function avatarOrPlaceholder(url, name, size = 56) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://via.placeholder.com/${size}?text=${encodeURIComponent(letter)}`;
  }

  function safeNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function fmt2(v) {
    return Number(v ?? 0).toFixed(2);
  }

  // inputs from server
  const seasonMatchups = (data && data.seasonMatchups) ? data.seasonMatchups : {};
  const importSummary = (data && data.importSummary) ? data.importSummary : {};
  const tableChecks = (data && data.tableChecks) ? data.tableChecks : {};
  const messages = (data && data.messages) ? data.messages : [];
  const debugTeams = (data && data.debugTeams) ? data.debugTeams : [];
  const debugMatchups = (data && data.debugMatchups) ? data.debugMatchups : [];

  const regularAllTime = (data && data.regularAllTime) ? data.regularAllTime : [];
  const playoffAllTime = (data && data.playoffAllTime) ? data.playoffAllTime : [];

  // UI helper to build a public URL for season override JSONs
  function seasonJsonUrl(season) {
    return `/season_matchups/${season}.json`; // this will resolve relative to site root
  }
</script>

<style>
  :global(body) {
    --bg: transparent;
    --card: #071025;
    --muted: #9ca3af;
    --accent: rgba(99,102,241,0.08);
    color-scheme: dark;
  }
  .page { max-width:1200px; margin:1.25rem auto; padding:0 1rem; }
  .card { background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006)); border:1px solid rgba(255,255,255,0.04); border-radius:12px; padding:14px; margin-bottom:1rem; }
  .section-title { font-weight:700; font-size:1.05rem; }
  .small-muted { color:var(--muted); font-size:0.9rem; }
  .tbl { width:100%; border-collapse:collapse; }
  thead th { text-align:left; color:var(--muted); font-size:0.85rem; padding:8px; text-transform:uppercase; }
  tbody td { padding:10px; color:#e6eef8; }
  .col-numeric { text-align:right; font-variant-numeric:tabular-nums; }
  a.link { color: #9fbafc; text-decoration: underline; }
  .debug-line { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; font-size:0.85rem; color:var(--muted); margin-bottom:4px; }
</style>

<div class="page">
  <h1>All-time Records</h1>

  <!-- IMPORT SUMMARY CARD -->
  <div class="card" aria-labelledby="import-title">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div id="import-title" class="section-title">Debug / Import Summary</div>
        <div class="small-muted">Shows whether season JSON files imported and table completeness checks.</div>
      </div>
      <div class="small-muted">Seasons: {Object.keys(importSummary).length}</div>
    </div>

    <div style="margin-top:.75rem;">
      {#if Object.keys(importSummary).length}
        <table class="tbl" role="table">
          <thead>
            <tr>
              <th>Season</th>
              <th class="col-numeric">Weeks</th>
              <th class="col-numeric">Matchups</th>
              <th>JSON Link</th>
            </tr>
          </thead>
          <tbody>
            {#each Object.keys(importSummary).sort() as s}
              <tr>
                <td>{s}</td>
                <td class="col-numeric">{importSummary[s].weeks}</td>
                <td class="col-numeric">{importSummary[s].matchups}</td>
                <td>
                  <a class="link" href={seasonJsonUrl(s)} target="_blank" rel="noopener noreferrer">
                    /season_matchups/{s}.json
                  </a>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="small-muted">No import summary available.</div>
      {/if}
    </div>

    <div style="margin-top:.75rem;">
      <div class="section-title">Server messages</div>
      <div style="margin-top:.5rem;">
        {#each messages as m, i}
          <div class="debug-line">{i + 1}. {m}</div>
        {/each}
      </div>
    </div>
  </div>

  <!-- REGULAR SEASON TABLE -->
  <div class="card" aria-labelledby="regular-title">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div id="regular-title" class="section-title">All-time Regular Season</div>
        <div class="small-muted">Aggregated across seasons (regular weeks only)</div>
      </div>
      <div class="small-muted">Rows sorted by Wins → PF</div>
    </div>

    {#if regularAllTime && regularAllTime.length}
      <table class="tbl" role="table" aria-label="All-time regular season standings" style="margin-top:.6rem;">
        <thead>
          <tr>
            <th>Team</th>
            <th class="col-numeric">W</th>
            <th class="col-numeric">L</th>
            <th class="col-numeric">PF</th>
            <th class="col-numeric">PA</th>
            <th class="col-numeric">Max W-Str</th>
            <th class="col-numeric">Max L-Str</th>
          </tr>
        </thead>
        <tbody>
          {#each regularAllTime as r}
            <tr>
              <td>{r.team}{r.owner_name ? ` • ${r.owner_name}` : ''}</td>
              <td class="col-numeric">{r.wins}</td>
              <td class="col-numeric">{r.losses}</td>
              <td class="col-numeric">{fmt2(r.pf)}</td>
              <td class="col-numeric">{fmt2(r.pa)}</td>
              <td class="col-numeric">{r.maxWinStreak ?? 0}</td>
              <td class="col-numeric">{r.maxLoseStreak ?? 0}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No regular-season aggregates available.</div>
    {/if}
  </div>

  <!-- PLAYOFFS TABLE -->
  <div class="card" aria-labelledby="playoff-title">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div id="playoff-title" class="section-title">All-time Playoffs</div>
        <div class="small-muted">Aggregated playoff stats (playoff window only)</div>
      </div>
      <div class="small-muted">Sorted by Playoff Wins → PF</div>
    </div>

    {#if playoffAllTime && playoffAllTime.length}
      <table class="tbl" role="table" aria-label="All-time playoff standings" style="margin-top:.6rem;">
        <thead>
          <tr>
            <th>Team</th>
            <th class="col-numeric">W</th>
            <th class="col-numeric">L</th>
            <th class="col-numeric">PF</th>
            <th class="col-numeric">PA</th>
            <th class="col-numeric">Max W-Str</th>
            <th class="col-numeric">Max L-Str</th>
          </tr>
        </thead>
        <tbody>
          {#each playoffAllTime as p}
            <tr>
              <td>{p.team}{p.owner_name ? ` • ${p.owner_name}` : ''}</td>
              <td class="col-numeric">{p.wins}</td>
              <td class="col-numeric">{p.losses}</td>
              <td class="col-numeric">{fmt2(p.pf)}</td>
              <td class="col-numeric">{fmt2(p.pa)}</td>
              <td class="col-numeric">{p.maxWinStreak ?? 0}</td>
              <td class="col-numeric">{p.maxLoseStreak ?? 0}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No playoff aggregates available.</div>
    {/if}
  </div>

  <!-- DEBUG MATCHUPS (for selected teams) -->
  <div class="card" aria-labelledby="debug-matchups">
    <div class="section-title" id="debug-matchups">Debug: matchups for debug teams</div>
    <div class="small-muted" style="margin-top:.5rem;">Showing all matchups that involve the configured debug teams.</div>

    {#if debugMatchups && debugMatchups.length}
      <table class="tbl" role="table" style="margin-top:.6rem;">
        <thead>
          <tr>
            <th>Season</th>
            <th>Week</th>
            <th>Team</th>
            <th>Opponent</th>
            <th class="col-numeric">Team Score</th>
            <th class="col-numeric">Opp Score</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {#each debugMatchups as dm}
            <tr>
              <td>{dm.season}</td>
              <td>{dm.week}</td>
              <td>{dm.teamA.name}</td>
              <td>{dm.teamB.name}</td>
              <td class="col-numeric">{fmt2(dm.teamA.points)}</td>
              <td class="col-numeric">{fmt2(dm.teamB.points)}</td>
              <td>{dm.source}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No debug matchups found.</div>
    {/if}
  </div>
</div>
