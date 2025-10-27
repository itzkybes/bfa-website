<script>
  export let data;

  // Helpers
  function avatarOrPlaceholder(url, name, size = 56) {
    if (url) return url;
    const letter = name ? String(name)[0] : 'T';
    return `https://via.placeholder.com/${size}?text=${encodeURIComponent(letter)}`;
  }

  function fmt2(v) {
    return Number(v ?? 0).toFixed(2);
  }
</script>

<style>
  /* keep previous styling minimal; adopt your existing site styles as needed */
  .page { max-width: 1100px; margin: 1.25rem auto; padding: 0 1rem; }
  .card { background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006)); border-radius: 10px; padding: 14px; margin-bottom: 1rem; border:1px solid rgba(255,255,255,0.03); }
  .tbl { width:100%; border-collapse: collapse; }
  thead th { text-align:left; padding: 8px; color:#9ca3af; font-size: 0.85rem; text-transform:uppercase; }
  tbody td { padding: 10px; border-top:1px solid rgba(255,255,255,0.03); color:#e6eef8; }
  .col-numeric { text-align:right; font-variant-numeric: tabular-nums; }
  .small-muted { color:#9ca3af; font-size:0.9rem; }
  .link { color: #7dd3fc; text-decoration: underline; cursor: pointer; }
</style>

<div class="page">
  <h1>All-time Records — import & standings</h1>

  <div class="card">
    <h3>Import summary</h3>
    {#if data.overridesLinks && data.overridesLinks.length}
      <div class="small-muted">Imported override files — click to download/open</div>
      <ul>
        {#each data.overridesLinks as l}
          <li><a class="link" href={l.url} target="_blank" rel="noreferrer noopener">{l.file} — season {l.season}</a></li>
        {/each}
      </ul>
    {:else}
      <div class="small-muted">No override files discovered.</div>
    {/if}

    <div style="margin-top: 1rem;">
      <strong>Summary (weeks / matchups):</strong>
      <table class="tbl" style="margin-top:.5rem;">
        <thead>
          <tr><th>Season</th><th class="col-numeric">Weeks</th><th class="col-numeric">Matchups</th></tr>
        </thead>
        <tbody>
          {#each Object.keys(data.importSummary || {}).sort() as s}
            <tr>
              <td>{s}</td>
              <td class="col-numeric">{data.importSummary[s].weeks}</td>
              <td class="col-numeric">{data.importSummary[s].matchups}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <h3>Server messages</h3>
    {#if data.messages && data.messages.length}
      <ol style="margin:0 0 0 1.1rem;">
        {#each data.messages as m, i}
          <li class="small-muted">{m}</li>
        {/each}
      </ol>
    {:else}
      <div class="small-muted">No messages</div>
    {/if}
  </div>

  <div class="card">
    <h3>All-time Regular Season (aggregated)</h3>
    {#if data.regularAllTime && data.regularAllTime.length}
      <table class="tbl">
        <thead>
          <tr>
            <th>Team</th>
            <th class="col-numeric">W</th>
            <th class="col-numeric">L</th>
            <th class="col-numeric">Longest W-Str</th>
            <th class="col-numeric">Longest L-Str</th>
            <th class="col-numeric">PF</th>
            <th class="col-numeric">PA</th>
          </tr>
        </thead>
        <tbody>
          {#each data.regularAllTime as r}
            <tr>
              <td>
                <div style="display:flex; gap:.6rem; align-items:center;">
                  <img class="avatar" src={avatarOrPlaceholder(r.avatar, r.team)} alt={r.team} style="width:56px;height:56px;border-radius:8px;object-fit:cover;" />
                  <div>
                    <div style="font-weight:700;">{r.team}</div>
                    {#if r.owner_name}<div class="small-muted">{r.owner_name}</div>{/if}
                  </div>
                </div>
              </td>
              <td class="col-numeric">{r.wins}</td>
              <td class="col-numeric">{r.losses}</td>
              <td class="col-numeric">{r.maxWinStreak ?? r.maxWinStreak ?? r.maxWinStr ?? r.maxWinStreak}</td>
              <td class="col-numeric">{r.maxLoseStreak ?? r.maxLoseStreak ?? r.maxLoseStr ?? r.maxLoseStreak}</td>
              <td class="col-numeric">{fmt2(r.pf)}</td>
              <td class="col-numeric">{fmt2(r.pa)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="small-muted">No regular-season standings available.</div>
    {/if}
  </div>

  <div class="card">
    <h3>All-time Playoffs (aggregated)</h3>
    {#if data.playoffAllTime && data.playoffAllTime.length}
      <table class="tbl">
        <thead>
          <tr>
            <th>Team</th>
            <th class="col-numeric">W</th>
            <th class="col-numeric">L</th>
            <th class="col-numeric">PF</th>
            <th class="col-numeric">PA</th>
          </tr>
        </thead>
        <tbody>
          {#each data.playoffAllTime as r}
            <tr>
              <td>
                <div style="display:flex; gap:.6rem; align-items:center;">
                  <img class="avatar" src={avatarOrPlaceholder(r.avatar, r.team)} alt={r.team} style="width:56px;height:56px;border-radius:8px;object-fit:cover;" />
                  <div>
                    <div style="font-weight:700;">{r.team}</div>
                    {#if r.owner_name}<div class="small-muted">{r.owner_name}</div>{/if}
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
      <div class="small-muted">No playoff standings available.</div>
    {/if}
  </div>

  <div class="card">
    <h3>Ownership note / preserved records</h3>
    <div class="small-muted">Original owners preserved (best-effort from early2023.json)</div>

    {#if data.originalRecords && (data.originalRecords.bellooshio || data.originalRecords.cholybevv)}
      {#if data.originalRecords.bellooshio}
        <div style="margin-top:.6rem; display:flex; gap:.75rem;">
          <img src={avatarOrPlaceholder(data.originalRecords.bellooshio.avatar, data.originalRecords.bellooshio.team)} alt="bellooshio" style="width:56px;height:56px;border-radius:8px;" />
          <div>
            <div style="font-weight:700">Bellooshio</div>
            <div class="small-muted">
              {#if data.originalRecords.bellooshio.team}Team: {data.originalRecords.bellooshio.team} • {/if}
              Regular: <strong>{data.originalRecords.bellooshio.regWins}</strong>-<strong>{data.originalRecords.bellooshio.regLosses}</strong> (PF {fmt2(data.originalRecords.bellooshio.regPF)}, PA {fmt2(data.originalRecords.bellooshio.regPA)})<br/>
              Playoffs: <strong>{data.originalRecords.bellooshio.playoffWins}</strong>-<strong>{data.originalRecords.bellooshio.playoffLosses}</strong> (PF {fmt2(data.originalRecords.bellooshio.playoffPF)}, PA {fmt2(data.originalRecords.bellooshio.playoffPA)})<br/>
              Championships: <strong>{data.originalRecords.bellooshio.championships}</strong>
            </div>
          </div>
        </div>
      {/if}

      {#if data.originalRecords.cholybevv}
        <div style="margin-top:.6rem; display:flex; gap:.75rem;">
          <img src={avatarOrPlaceholder(data.originalRecords.cholybevv.avatar, data.originalRecords.cholybevv.team)} alt="cholybevv" style="width:56px;height:56px;border-radius:8px;" />
          <div>
            <div style="font-weight:700">cholybevv</div>
            <div class="small-muted">
              {#if data.originalRecords.cholybevv.team}Team: {data.originalRecords.cholybevv.team} • {/if}
              Regular: <strong>{data.originalRecords.cholybevv.regWins}</strong>-<strong>{data.originalRecords.cholybevv.regLosses}</strong> (PF {fmt2(data.originalRecords.cholybevv.regPF)}, PA {fmt2(data.originalRecords.cholybevv.regPA)})<br/>
              Playoffs: <strong>{data.originalRecords.cholybevv.playoffWins}</strong>-<strong>{data.originalRecords.cholybevv.playoffLosses}</strong> (PF {fmt2(data.originalRecords.cholybevv.playoffPF)}, PA {fmt2(data.originalRecords.cholybevv.playoffPA)})<br/>
              Championships: <strong>{data.originalRecords.cholybevv.championships}</strong>
            </div>
          </div>
        </div>
      {/if}
    {:else}
      <div class="small-muted">No preserved original owner records found.</div>
    {/if}
  </div>
</div>
