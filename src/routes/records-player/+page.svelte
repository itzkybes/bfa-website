<!-- src/routes/records-player/+page.svelte -->
<script>
  export let data;

  const seasons = data.seasons || [];
  const seasonsResults = data.seasonsResults || [];
  const messages = data.messages || [];
  const jsonLinks = data.jsonLinks || [];

  // default selected season: pick the most recent seasonsResults entry if available
  let selectedSeason = (() => {
    if (seasonsResults && seasonsResults.length) return String(seasonsResults[seasonsResults.length - 1].season);
    if (seasons && seasons.length) {
      const last = seasons[seasons.length - 1];
      return String(last.season ?? last.league_id);
    }
    return null;
  })();

  $: selectedResult = seasonsResults.find(r => String(r.season) === String(selectedSeason)) || (seasonsResults.length ? seasonsResults[0] : null);

  function placeholderInitial(name) {
    if (!name) return 'P';
    return name.trim()[0].toUpperCase();
  }
</script>

<style>
  :global(body) { color-scheme: dark; }
  .page { max-width:1100px; margin:1.2rem auto; padding:0 1rem; }
  h1 { margin:0 0 .6rem 0; }
  .controls-row { display:flex; justify-content:space-between; align-items:center; gap:1rem; margin-bottom:1rem; }
  .small-muted { color: #9ca3af; }
  .card { background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006)); border:1px solid rgba(255,255,255,0.04); border-radius:12px; padding:14px; box-shadow: 0 6px 18px rgba(2,6,23,0.6); }
  .messages { margin-bottom:1rem; padding:12px; border-radius:10px; background: rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.02); color:#e6eef8; }
  .json-links { margin-top:.6rem; display:flex; flex-direction:column; gap:6px; }
  .json-links a { color:#9fb0ff; font-weight:600; text-decoration:none; }

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
  .select:focus { border-color: rgba(99,102,241,0.6); box-shadow: 0 6px 20px rgba(2,6,23,0.6), 0 0 0 4px rgba(99,102,241,0.06); }

  .mvp-card { margin-top:1rem; border-radius:10px; overflow:hidden; }
  .mvp-row { display:flex; justify-content:space-between; align-items:center; padding:18px; border-bottom:1px solid rgba(255,255,255,0.02); }
  .mvp-row:last-child { border-bottom:none; }
  .award { width:52%; }
  .award .title { font-weight:700; margin-bottom:6px; }
  .award .desc { color:var(--muted,#9ca3af); font-size:.95rem; }
  .player { width:44%; display:flex; align-items:center; gap:.8rem; justify-content:flex-end; }
  .player .meta { text-align:right; }
  .player .name { font-weight:800; }
  .player .sub { color:var(--muted,#9ca3af); font-size:.95rem; margin-top:4px; }
  .placeholder-avatar { display:inline-flex; align-items:center; justify-content:center; width:64px; height:64px; border-radius:10px; background:#0b1220; color:#9ca3af; font-weight:800; font-size:1.2rem; }
  .no-data { color:var(--muted,#9ca3af); font-weight:700; }
  @media (max-width:900px) {
    .controls-row { flex-direction:column; align-items:stretch; }
    .player { width:100%; justify-content:flex-start; text-align:left; gap:12px; }
    .award { width:100%; margin-bottom:8px; }
    .mvp-row { flex-direction:column; align-items:stretch; gap:10px; }
  }
</style>

<div class="page">
  <h1>Player MVPs</h1>

  <div class="controls-row">
    <div>
      <label class="small-muted" for="season-select">Season</label>
      <select id="season-select" class="select" bind:value={selectedSeason} aria-label="Select season">
        {#if seasonsResults && seasonsResults.length}
          {#each seasonsResults as s}
            <option value={s.season}>{s.season}</option>
          {/each}
        {:else if seasons && seasons.length}
          {#each seasons as s}
            <option value={s.season ?? s.league_id}>{s.season ?? s.name}</option>
          {/each}
        {/if}
      </select>
    </div>

    <div class="small-muted">Showing MVPs for: <strong style="color:inherit">{selectedSeason ?? '—'}</strong></div>
  </div>

  {#if messages && messages.length}
    <div class="messages card">
      <strong>Messages</strong>
      <ol style="margin-top:.5rem;">
        {#each messages as m, i}
          <li style="margin:.25rem 0;">{m}</li>
        {/each}
      </ol>

      {#if jsonLinks && jsonLinks.length}
        <div style="margin-top:.5rem; font-weight:700;">Loaded JSON files:</div>
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
  {/if}

  <div class="card mvp-card">
    <div style="padding:12px 18px; border-bottom:1px solid rgba(255,255,255,0.02);">
      <div style="font-weight:700; font-size:1.05rem;">Award</div>
      <div class="small-muted" style="margin-top:6px;">Overall MVP = season-long starters points. Finals MVP = championship game performance (player must appear in the championship matchup).</div>
    </div>

    <div class="mvp-row">
      <div class="award">
        <div class="title">Finals MVP</div>
        <div class="desc">Best performer across championship matchup(s)</div>
      </div>

      <div class="player">
        {#if selectedResult && selectedResult.finalsMvp && selectedResult.finalsMvp.playerId}
          <div class="placeholder-avatar">{placeholderInitial(selectedResult.finalsMvp.playerName)}</div>
          <div class="meta">
            <div class="name">{selectedResult.finalsMvp.playerName ?? `Player ${selectedResult.finalsMvp.playerId}`}</div>
            <div class="sub">{(selectedResult.finalsMvp.points ?? 0).toFixed ? (Number(selectedResult.finalsMvp.points).toFixed(1) + ' pts') : (selectedResult.finalsMvp.points + ' pts')} • Wk {selectedResult.championshipWeek ?? '—'}</div>
          </div>
        {:else}
          <div class="placeholder-avatar">P</div>
          <div class="meta" style="margin-left:.6rem;">
            <div class="no-data">No Finals MVP</div>
            <div class="sub">No data for this season</div>
          </div>
        {/if}
      </div>
    </div>

    <div class="mvp-row">
      <div class="award">
        <div class="title">Overall MVP</div>
        <div class="desc">Most points across the entire season (regular + playoffs)</div>
      </div>

      <div class="player">
        {#if selectedResult && selectedResult.overallMvp && selectedResult.overallMvp.playerId}
          <div class="placeholder-avatar">{placeholderInitial(selectedResult.overallMvp.playerName)}</div>
          <div class="meta">
            <div class="name">{selectedResult.overallMvp.playerName ?? `Player ${selectedResult.overallMvp.playerId}`}</div>
            <div class="sub">{(selectedResult.overallMvp.points ?? 0).toFixed ? (Number(selectedResult.overallMvp.points).toFixed(1) + ' pts (season)') : (selectedResult.overallMvp.points + ' pts (season)')}</div>
          </div>
        {:else}
          <div class="placeholder-avatar">P</div>
          <div class="meta" style="margin-left:.6rem;">
            <div class="no-data">No Overall MVP</div>
            <div class="sub">No data for this season</div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
