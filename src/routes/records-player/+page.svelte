<script>
  export let data;

  const seasons = data.seasons || [];
  const seasonsResults = data.seasonsResults || [];
  const jsonLinks = data.jsonLinks || [];
  const messages = data.messages || [];

  // selectedSeason now comes from server; fall back to latest if missing
  let selectedSeason = data.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : (seasonsResults.length ? seasonsResults[0].season : null));

  // submit GET form on change (simple)
  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  }

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? (name.split(' ').map(x=>x[0]||'').slice(0,2).join('')) : 'P';
    return `https://via.placeholder.com/${size}?text=${encodeURIComponent(letter)}`;
  }

  function fmt2(n) { return Number(n ?? 0).toFixed(2); }
</script>

<style>
  .page { max-width: 1100px; margin: 1.2rem auto; padding: 0 1rem; }
  .card { background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006)); border:1px solid rgba(255,255,255,0.03); padding:14px; border-radius:10px; margin-bottom:1rem; color:var(--text,#e6eef8); }
  .filters { display:flex; gap:.6rem; align-items:center; margin-bottom: .8rem; flex-wrap:wrap; }
  .select { padding:.6rem .8rem; border-radius:8px; background: #07101a; color: var(--text); border: 1px solid rgba(99,102,241,0.25); min-width: 180px; font-weight:600; }
  table { width:100%; border-collapse:collapse; margin-top:.6rem; }
  thead th { text-align:left; padding:8px 10px; font-size:.85rem; color:#9ca3af; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.03); }
  td { padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; }
  .player-cell { display:flex; gap:.6rem; align-items:center; }
  .player-name { font-weight:700; }
  .player-avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; }
  .muted { color:#9ca3af; font-size:.9rem; }
  .debug { font-family:monospace; white-space:pre-wrap; font-size:0.82rem; color:#9fb0c4; margin-top:.6rem; }
  @media (max-width:900px) {
    .select { min-width:100%; }
  }
</style>

<div class="page">
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:.6rem; gap:1rem; flex-wrap:wrap;">
      <div style="min-width:0;">
        <h2 style="margin:0 0 4px 0;">Player Records — MVPs</h2>
        <div class="muted">Shows Overall MVP and Finals MVP per season (uses local season_matchups JSON when available).</div>
      </div>

      <!-- GET form so server can see ?season= -->
      <form id="filters" method="get" style="display:flex; gap:.6rem; align-items:center; flex-wrap:wrap;">
        <label class="muted" for="season">Season</label>
        <select id="season" name="season" class="select" on:change={submitFilters} aria-label="Select season">
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>{s.season ?? s.name}</option>
          {/each}
        </select>

        <noscript>
          <button type="submit" class="select" style="cursor:pointer;">Go</button>
        </noscript>
      </form>
    </div>

    {#if seasonsResults && seasonsResults.length}
      <table aria-label="Player MVPs table">
        <thead>
          <tr>
            <th style="width:20%;">Season</th>
            <th style="width:40%;">Overall MVP</th>
            <th style="width:40%;">Finals MVP</th>
          </tr>
        </thead>
        <tbody>
          {#each seasonsResults as row (row.season)}
            {#if String(row.season) === String(selectedSeason)}
              <tr>
                <td>
                  <div style="font-weight:700;">{row.season}</div>
                  <div class="muted">Champ week: {row.championshipWeek ?? '-'}</div>
                  {#if row._sourceJson}
                    <div class="muted" style="margin-top:.25rem;">Source: {row._sourceJson}</div>
                  {/if}
                </td>

                <td>
                  {#if row.overallMvp}
                    <div class="player-cell">
                      <img class="player-avatar" src={avatarOrPlaceholder(row.overallMvp.player_avatar, row.overallMvp.playerName, 64)} alt={row.overallMvp.playerName} on:error={(e)=>e.target.src = avatarOrPlaceholder(null, row.overallMvp.playerName, 64)} />
                      <div>
                        <div class="player-name">{row.overallMvp.playerName}</div>
                        <div class="muted">Pts: {fmt2(row.overallMvp.points)}</div>
                        {#if row.overallMvp.roster_meta}
                          <div class="muted">Top roster: {row.overallMvp.roster_meta.team_name ?? row.overallMvp.roster_meta.owner_name}</div>
                        {/if}
                      </div>
                    </div>
                  {:else}
                    <div class="muted">No overall MVP determined</div>
                  {/if}
                </td>

                <td>
                  {#if row.finalsMvp}
                    <div class="player-cell">
                      <img class="player-avatar" src={avatarOrPlaceholder(row.finalsMvp.player_avatar, row.finalsMvp.playerName, 64)} alt={row.finalsMvp.playerName} on:error={(e)=>e.target.src = avatarOrPlaceholder(null, row.finalsMvp.playerName, 64)} />
                      <div>
                        <div class="player-name">{row.finalsMvp.playerName}</div>
                        <div class="muted">Pts: {fmt2(row.finalsMvp.points)}</div>
                        {#if row.finalsMvp.roster_meta}
                          <div class="muted">Roster: {row.finalsMvp.roster_meta.team_name ?? row.finalsMvp.roster_meta.owner_name}</div>
                        {/if}
                      </div>
                    </div>
                  {:else}
                    <div class="muted">No finals MVP determined</div>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No seasons results available.</div>
    {/if}

    <!-- debug/info -->
    <div style="margin-top:12px;">
      {#if jsonLinks && jsonLinks.length}
        <div class="muted" style="margin-bottom:.35rem;">Loaded JSONs:</div>
        <ul class="muted">
          {#each jsonLinks as jl}
            <li><a href={jl.url} target="_blank" rel="noreferrer">{jl.title}</a></li>
          {/each}
        </ul>
      {/if}

      {#if messages && messages.length}
        <div class="muted" style="margin-top:.6rem;">Messages / Debug:</div>
        <div class="debug">
          {#each messages as m}
            {m}
            {'\n'}
          {/each}
        </div>
      {/if}
    </div>

  </div>
</div>
