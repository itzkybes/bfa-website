<!-- src/routes/records-player/+page.svelte -->
<script>
  export let data;

  const seasons = (data && data.seasons) ? data.seasons : [];
  const seasonsResults = (data && Array.isArray(data.seasonsResults)) ? data.seasonsResults : [];

  // select plumbing to match standings style
  let selectedSeasonId = (data && data.selectedSeason) ? String(data.selectedSeason) : (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  function submitForm() {
    const form = document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function playerHeadshot(pid, size = 56) {
    if (!pid) return '';
    return `https://sleepercdn.com/content/nba/players/${pid}.jpg`;
  }

  function fmtPts(v) {
    const n = Number(v ?? 0);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  // messages / jsonLinks for visibility
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
</script>

<style>
  :global(body) {
    --card-bg: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    --card-border: rgba(255,255,255,0.03);
    --muted: #9ca3af;
    --text: #e6eef8;
  }

  .page { max-width: 1100px; margin: 1.5rem auto; padding: 0 1rem; }
  h1 { margin: 0 0 .6rem 0; font-size:1.4rem; }
  .card { background: var(--card-bg); border:1px solid var(--card-border); padding:14px; border-radius:12px; margin-bottom:1rem; }
  .controls { display:flex; gap:.75rem; align-items:center; margin-bottom: .75rem; }
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

  /* MVPs table */
  .mvp-table { width:100%; border-collapse:collapse; margin-top:.5rem; }
  .mvp-table th { text-align:left; padding:10px; color:var(--muted); text-transform:uppercase; font-size:.85rem; border-bottom:1px solid var(--card-border); }
  .mvp-table td { padding:12px 10px; border-bottom:1px solid var(--card-border); color:var(--text); vertical-align:middle; }
  .mvp-row { display:flex; gap:.75rem; align-items:center; }
  .mvp-avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; border:1px solid rgba(255,255,255,0.03); }
  .mvp-name { font-weight:800; }
  .mvp-sub { color:var(--muted); font-size:.9rem; }
  .muted-note { color:var(--muted); font-size:.9rem; margin-top:.5rem; }

  @media (max-width:900px) {
    .select { min-width: 100%; width:100%; }
    .mvp-avatar { width:48px; height:48px; }
  }
</style>

<div class="page">
  <h1>Player Records</h1>

  {#if messages && messages.length}
    <div class="card" aria-live="polite">
      <strong>Messages</strong>
      <div style="margin-top:.5rem">
        {#each messages as m, i}
          <div>{i + 1}. {m}</div>
        {/each}
        {#if jsonLinks && jsonLinks.length}
          <div style="margin-top:.5rem; font-weight:700">Loaded JSON files:</div>
          <ul style="margin:6px 0 0 18px; color:var(--muted);">
            {#each jsonLinks as jl}
              <li>
                {#if typeof jl === 'string'}
                  {jl}
                {:else}
                  {jl.title ?? jl.url}
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}

  <div class="card" role="region" aria-label="MVPs by season">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px; flex-wrap:wrap;">
      <div>
        <div style="font-weight:800">Season MVPs</div>
        <div class="muted-note">Overall MVP = season-long starters points. Finals MVP = championship game performance.</div>
      </div>

      <form id="filters" method="get" style="display:flex; gap:.5rem; align-items:center;">
        <label class="muted-note" for="season">Season</label>
        <select id="season" name="season" class="select" on:change={submitForm}>
          {#if seasons && seasons.length}
            {#each seasons as s}
              <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeasonId)}>{s.season ?? s.name ?? s.league_id}</option>
            {/each}
          {:else}
            <option>{selectedSeasonId}</option>
          {/if}
        </select>
      </form>
    </div>

    <table class="mvp-table" role="table" aria-label="MVPs by season">
      <thead>
        <tr>
          <th style="width:10%">Season</th>
          <th style="width:45%">Finals MVP</th>
          <th style="width:45%">Overall MVP</th>
        </tr>
      </thead>
      <tbody>
        {#if seasonsResults && seasonsResults.length}
          {#each seasonsResults as sr}
            <tr>
              <td>{sr.season}</td>
              <td>
                {#if sr.finalsMvp}
                  <div class="mvp-row">
                    <img class="mvp-avatar" src={playerHeadshot(sr.finalsMvp.playerId)} alt={sr.finalsMvp.playerName ?? `Player ${sr.finalsMvp.playerId}`} on:error={(e)=>e.currentTarget.style.visibility='hidden'} />
                    <div>
                      <div class="mvp-name">{sr.finalsMvp.playerName ?? `Player ${sr.finalsMvp.playerId ?? '—'}`}</div>
                      <div class="mvp-sub">{fmtPts(sr.finalsMvp.points)} pts {sr.finalsMvp.championshipWeek ? `• Wk ${sr.finalsMvp.championshipWeek}` : ''}</div>
                    </div>
                  </div>
                {:else}
                  <div class="mvp-row">
                    <div class="mvp-avatar" style="display:flex; align-items:center; justify-content:center; background:transparent; border:1px dashed var(--card-border); color:var(--muted);">—</div>
                    <div>
                      <div class="mvp-name">No Finals MVP</div>
                      <div class="mvp-sub">—</div>
                    </div>
                  </div>
                {/if}
              </td>

              <td>
                {#if sr.overallMvp}
                  <div class="mvp-row">
                    <img class="mvp-avatar" src={playerHeadshot(sr.overallMvp.playerId)} alt={sr.overallMvp.playerName ?? `Player ${sr.overallMvp.playerId}`} on:error={(e)=>e.currentTarget.style.visibility='hidden'} />
                    <div>
                      <div class="mvp-name">{sr.overallMvp.playerName ?? `Player ${sr.overallMvp.playerId ?? '—'}`}</div>
                      <div class="mvp-sub">{fmtPts(sr.overallMvp.points)} pts (season)</div>
                    </div>
                  </div>
                {:else}
                  <div class="mvp-row">
                    <div class="mvp-avatar" style="display:flex; align-items:center; justify-content:center; background:transparent; border:1px dashed var(--card-border); color:var(--muted);">—</div>
                    <div>
                      <div class="mvp-name">No Overall MVP</div>
                      <div class="mvp-sub">—</div>
                    </div>
                  </div>
                {/if}
              </td>
            </tr>
          {/each}
        {:else}
          <tr><td colspan="3" class="mvp-sub">No MVP data available.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
