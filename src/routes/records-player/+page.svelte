<script>
  export let data;

  // data from server
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // determine default selectedSeason (prefer server's selectedSeason if provided via query)
  function seasonValue(s) {
    return s.season != null ? String(s.season) : String(s.league_id);
  }

  // Use server-provided selectedSeason if available (fixes "stuck" dropdown)
  let selectedSeason = data.selectedSeason ?? (() => {
    if (seasonsResults && seasonsResults.length) {
      const last = seasonsResults[seasonsResults.length - 1];
      if (last && last.season) return String(last.season);
    }
    if (seasons && seasons.length) return seasonValue(seasons[seasons.length - 1]);
    return null;
  })();

  // helper to submit GET form (used by selects)
  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  }

  $: selectedResult = (function() {
    if (!selectedSeason) return null;
    const bySeason = seasonsResults.find(r => r.season != null && String(r.season) === String(selectedSeason));
    if (bySeason) return bySeason;
    const byLeague = seasonsResults.find(r => String(r.leagueId) === String(selectedSeason));
    if (byLeague) return byLeague;
    return seasonsResults.find(r => String(r.season).includes(String(selectedSeason))) || null;
  })();

  // headshot helper
  function playerHeadshotUrl(playerId) {
    if (!playerId) return null;
    return `https://sleepercdn.com/players/nba/${encodeURIComponent(playerId)}.jpg`;
  }

  function placeholderDataUri(name, size = 64) {
    const letter = (name && name.length) ? name[0].toUpperCase() : 'P';
    const bg = '#0b1220';
    const fg = '#e6eef8';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><rect width='100%' height='100%' fill='${bg}' rx='12' /><text x='50%' y='50%' dy='.36em' text-anchor='middle' fill='${fg}' font-family='sans-serif' font-weight='700' font-size='${Math.round(size/2)}'>${letter}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  function fmt(n) {
    if (n == null) return '-';
    return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  }

  let showDebug = false;
</script>

<style>
  :root { --muted:#9ca3af; --card-bg: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006)); --card-border: rgba(255,255,255,0.03); --text:#e6eef8; }
  .page { max-width: 1100px; margin: 1.2rem auto; padding: 0 1rem; }
  h1 { margin:0 0 .6rem 0; font-size:1.4rem; }
  .card { background: var(--card-bg); border:1px solid var(--card-border); padding:14px; border-radius:12px; margin-bottom:1rem; box-shadow: 0 6px 18px rgba(2,6,23,0.5); }
  .filters { display:flex; gap:.6rem; align-items:center; margin-bottom:1rem; flex-wrap:wrap; }
  .muted { color: var(--muted); font-size:.95rem; }
  .select { padding:.6rem .8rem; border-radius:8px; background: #07101a; color: var(--text); border: 1px solid rgba(99,102,241,0.25); box-shadow: 0 4px 14px rgba(2,6,23,0.45), inset 0 -1px 0 rgba(255,255,255,0.01); min-width:160px; font-weight:600; outline:none; }
  .select:focus { box-shadow: 0 6px 20px rgba(2,6,23,0.6), 0 0 0 4px rgba(99,102,241,0.06); }
  table { width:100%; border-collapse:collapse; }
  thead th { text-align:left; padding:10px 12px; font-size:.85rem; color:var(--muted); text-transform:uppercase; border-bottom:1px solid var(--card-border); }
  td { padding:12px 12px; border-bottom:1px solid var(--card-border); color:var(--text); vertical-align:middle; }
  .player-cell { display:flex; gap:.75rem; align-items:center; min-width:0; }
  .player-avatar { width:64px; height:64px; border-radius:10px; object-fit:cover; background:#081018; flex-shrink:0; }
  .player-meta { display:flex; flex-direction:column; min-width:0; }
  .player-name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:380px; }
  .player-sub { color:var(--muted); font-size:.92rem; }
  .points { font-weight:800; text-align:right; min-width:90px; }
  .debug-toggle { background: transparent; border: none; color: var(--muted); font-weight:700; cursor:pointer; }
  .debug-panel { margin-top: .8rem; padding: .8rem; border-radius:8px; background: rgba(255,255,255,0.01); border:1px dashed rgba(255,255,255,0.02); color:var(--muted); font-size:.9rem; }
  @media (max-width:900px) {
    .player-avatar { width:56px; height:56px; }
    .player-name { max-width: 60vw; }
    .select { min-width: 100%; width:100%; }
    .filters { flex-direction:column; align-items:stretch; gap:.5rem; }
  }
</style>

<div class="page">
  <h1>Player MVPs</h1>

  <div class="card" role="region" aria-labelledby="mvp-title">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;">
      <div style="min-width:0;">
        <div id="mvp-title" style="font-weight:800; font-size:1.05rem;">MVPs by Season</div>
        <div class="muted" style="margin-top:.2rem;">Select a season to view that season's Overall MVP and Finals MVP.</div>
      </div>

      <form id="filters" method="get" style="display:flex; gap:.6rem; align-items:center; flex-wrap:wrap;">
        <label class="muted" for="season-select">Season</label>
        <select id="season-select" name="season" class="select" on:change={submitFilters} bind:value={selectedSeason} aria-label="Select season">
          {#if seasons.length}
            {#each seasons as s}
              <option value={seasonValue(s)}>{s.season ?? s.name ?? s.league_id}</option>
            {/each}
          {:else}
            {#each seasonsResults as sr}
              <option value={String(sr.season)}>{sr.season}</option>
            {/each}
          {/if}
        </select>
        <noscript><button class="select" type="submit" style="cursor:pointer;">Go</button></noscript>
      </form>
    </div>

    {#if selectedResult}
      <div style="margin-top:1rem; overflow:auto;">
        <table aria-label="MVPs table">
          <thead>
            <tr>
              <th style="width:1%"></th>
              <th>Finals MVP (Championship game)</th>
              <th class="points">Points</th>
              <th style="width:1%"></th>
              <th>Overall MVP (Season total)</th>
              <th class="points">Points</th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td></td>
              <td>
                {#if selectedResult.finalsMvp}
                  <div class="player-cell" style="align-items:center;">
                    <img
                      class="player-avatar"
                      src={playerHeadshotUrl(selectedResult.finalsMvp.playerId)}
                      alt={selectedResult.finalsMvp.playerName ?? `Player ${selectedResult.finalsMvp.playerId}`}
                      on:error={(e) => { e.target.onerror = null; e.target.src = placeholderDataUri(selectedResult.finalsMvp.playerName, 64); }}
                    />
                    <div class="player-meta">
                      <div class="player-name">{selectedResult.finalsMvp.playerName ?? `Player ${selectedResult.finalsMvp.playerId}`}</div>
                      <div class="player-sub">
                        {#if selectedResult.finalsMvp.roster_meta}
                          {selectedResult.finalsMvp.roster_meta.team_name ?? selectedResult.finalsMvp.roster_meta.owner_name}
                        {/if}
                        {#if !selectedResult.finalsMvp.roster_meta}Top roster: {selectedResult.finalsMvp.topRosterId ?? '-' }{/if}
                      </div>
                    </div>
                  </div>
                {:else}
                  <div class="muted">No Finals MVP found for this season.</div>
                {/if}
              </td>
              <td class="points">{#if selectedResult.finalsMvp}{fmt(selectedResult.finalsMvp.points)}{:else}-{/if}</td>

              <td></td>

              <td>
                {#if selectedResult.overallMvp}
                  <div class="player-cell" style="align-items:center;">
                    <img
                      class="player-avatar"
                      src={playerHeadshotUrl(selectedResult.overallMvp.playerId)}
                      alt={selectedResult.overallMvp.playerName ?? `Player ${selectedResult.overallMvp.playerId}`}
                      on:error={(e) => { e.target.onerror = null; e.target.src = placeholderDataUri(selectedResult.overallMvp.playerName, 64); }}
                    />
                    <div class="player-meta">
                      <div class="player-name">{selectedResult.overallMvp.playerName ?? `Player ${selectedResult.overallMvp.playerId}`}</div>
                      <div class="player-sub">
                        {#if selectedResult.overallMvp.roster_meta}
                          {selectedResult.overallMvp.roster_meta.team_name ?? selectedResult.overallMvp.roster_meta.owner_name}
                        {/if}
                        {#if !selectedResult.overallMvp.roster_meta}Top roster: {selectedResult.overallMvp.topRosterId ?? '-' }{/if}
                      </div>
                    </div>
                  </div>
                {:else}
                  <div class="muted">No Overall MVP found for this season.</div>
                {/if}
              </td>
              <td class="points">{#if selectedResult.overallMvp}{fmt(selectedResult.overallMvp.points)}{:else}-{/if}</td>
            </tr>
          </tbody>
        </table>

        {#if selectedResult._sourceJson}
          <div style="margin-top:.6rem;" class="muted">Data source: <strong style="color:inherit">{selectedResult._sourceJson}</strong></div>
        {/if}
      </div>
    {:else}
      <div class="muted" style="padding:.8rem 0;">No MVP data available for the selected season.</div>
    {/if}

    <div style="margin-top:.8rem; display:flex; justify-content:flex-end;">
      <button class="debug-toggle" type="button" on:click={() => showDebug = !showDebug}>{showDebug ? 'Hide' : 'Show'} debug</button>
    </div>

    {#if showDebug}
      <div class="debug-panel" role="region" aria-live="polite">
        <div style="font-weight:700; margin-bottom:.5rem;">Messages</div>
        {#if messages && messages.length}
          <ul style="margin:0 0 .6rem 1rem; padding:0;">
            {#each messages as m}
              <li>{m}</li>
            {/each}
          </ul>
        {:else}
          <div class="muted">No messages</div>
        {/if}

        {#if jsonLinks && jsonLinks.length}
          <div style="margin-top:.4rem; font-weight:700;">Loaded JSONs</div>
          <ul style="margin:0 0 0.2rem 1rem; padding:0;">
            {#each jsonLinks as jl}
              <li>
                {#if typeof jl === 'string'}
                  <a href={jl} target="_blank" rel="noopener noreferrer">{jl}</a>
                {:else}
                  <a href={jl.url} target="_blank" rel="noopener noreferrer">{jl.title ?? jl.url}</a>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
</div>
