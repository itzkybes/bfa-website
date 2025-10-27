<script>
  // Simplified Records page: show import summary, links to season JSON files,
  // and two aggregated tables: Regular All-time and Playoff All-time.
  // IMPORTANT: do NOT use `let` here per request; assign from incoming data.
  export let data;

  // helpers
  function avatarOrPlaceholder(url, name, size = 56) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://via.placeholder.com/${size}?text=${encodeURIComponent(letter)}`;
  }
  function fmt2(v) {
    return Number(v ?? 0).toFixed(2);
  }

  // Data from server
  const importSummary = (data && data.importSummary) ? data.importSummary : {};
  const overrideFiles = (data && data.overrideFiles) ? data.overrideFiles : [];
  const regularAllTime = (data && data.regularAllTime) ? data.regularAllTime : [];
  const playoffAllTime = (data && data.playoffAllTime) ? data.playoffAllTime : [];
  const messages = (data && data.messages) ? data.messages : [];
</script>

<style>
  :global(body) { color-scheme: dark; }
  .page { max-width: 1100px; margin: 1rem auto; padding: 0 1rem; }
  .card { background:#06111a; border-radius:10px; padding:12px; margin-bottom:1rem; border:1px solid rgba(255,255,255,0.03); }
  .tbl { width:100%; border-collapse:collapse; }
  thead th { text-align:left; color:#98a3af; font-size:0.85rem; padding:8px; }
  tbody td { padding:10px; border-top:1px solid rgba(255,255,255,0.02); color:#e6eef8; }
  .col-numeric { text-align:right; font-variant-numeric: tabular-nums; }
  a.link { color: #9aa8ff; text-decoration:underline; }
  .msg { color: #9aa8aa; font-size:0.9rem; white-space:pre-wrap; }
</style>

<div class="page">
  <h1>All-time Records — import & standings</h1>

  <div class="card">
    <h3 style="margin:0 0 8px 0;">Import summary</h3>
    {#if overrideFiles.length}
      <div style="margin-bottom:8px;">
        <strong>Loaded override files:</strong>
        <ul>
          {#each overrideFiles as f}
            <li>Season {f.season}: <a class="link" href={f.url} target="_blank" rel="noopener">{f.filename}</a></li>
          {/each}
        </ul>
      </div>
    {:else}
      <div style="margin-bottom:8px;">No override files discovered.</div>
    {/if}

    {#if Object.keys(importSummary).length}
      <div style="margin-top:6px;">
        <strong>Summary (weeks / matchups):</strong>
        <table class="tbl" style="margin-top:8px;">
          <thead><tr><th>Season</th><th class="col-numeric">Weeks</th><th class="col-numeric">Matchups</th></tr></thead>
          <tbody>
            {#each Object.entries(importSummary) as [season, info]}
              <tr>
                <td>{season}</td>
                <td class="col-numeric">{info.weeks}</td>
                <td class="col-numeric">{info.matchups}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <div class="card">
    <h3 style="margin:0 0 8px 0;">Server messages</h3>
    <div class="msg">
      {#if messages && messages.length}
        {#each messages as m, i}
          {i+1}. {m}
          {#if i < messages.length - 1}
            <br/>
          {/if}
        {/each}
      {:else}
        No messages.
      {/if}
    </div>
  </div>

  <div class="card">
    <h3 style="margin:0 0 8px 0;">All-time Regular Season (aggregated)</h3>
    {#if regularAllTime && regularAllTime.length}
      <table class="tbl" role="table" aria-label="All-time regular season standings">
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
          {#each regularAllTime as r}
            <tr>
              <td>
                <div style="display:flex; align-items:center; gap:8px;">
                  <img src={avatarOrPlaceholder(null, r.team)} alt={r.team} width="40" height="40" style="border-radius:8px;" />
                  <div>
                    <div style="font-weight:700">{r.team}</div>
                    <div style="color:#9aa8aa; font-size:.88rem;">{r.owner_name}</div>
                  </div>
                </div>
              </td>
              <td class="col-numeric">{r.wins}</td>
              <td class="col-numeric">{r.losses}</td>
              <td class="col-numeric">{fmt2(r.pf)}</td>
              <td class="col-numeric">{fmt2(r.pa)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div>No regular-season standings available.</div>
    {/if}
  </div>

  <div class="card">
    <h3 style="margin:0 0 8px 0;">All-time Playoffs (aggregated)</h3>
    {#if playoffAllTime && playoffAllTime.length}
      <table class="tbl" role="table" aria-label="All-time playoff standings">
        <thead>
          <tr>
            <th>Team / Owner</th>
            <th class="col-numeric">Play W</th>
            <th class="col-numeric">Play L</th>
            <th class="col-numeric">PF</th>
            <th class="col-numeric">PA</th>
          </tr>
        </thead>
        <tbody>
          {#each playoffAllTime as p}
            <tr>
              <td>
                <div style="display:flex; align-items:center; gap:8px;">
                  <img src={avatarOrPlaceholder(null, p.team)} alt={p.team} width="40" height="40" style="border-radius:8px;" />
                  <div>
                    <div style="font-weight:700">{p.team}</div>
                    <div style="color:#9aa8aa; font-size:.88rem;">{p.owner_name}</div>
                  </div>
                </div>
              </td>
              <td class="col-numeric">{p.playoffWins}</td>
              <td class="col-numeric">{p.playoffLosses}</td>
              <td class="col-numeric">{fmt2(p.pf)}</td>
              <td class="col-numeric">{fmt2(p.pa)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div>No playoff standings available.</div>
    {/if}
  </div>
</div>
