<script>
  export let data;

  // seasons / honors loaded from server
  $: seasons = (data && Array.isArray(data.seasons)) ? data.seasons : [];
  $: honors = (data && Array.isArray(data.honors)) ? data.honors : [];
  $: jsonLinks = (data && Array.isArray(data.jsonLinks)) ? data.jsonLinks : [];
  $: messages = (data && Array.isArray(data.messages)) ? data.messages : [];

  // default selected season to newest available (last in list)
  let selectedSeason = '';
  $: if ((!selectedSeason || selectedSeason === '') && seasons && seasons.length) selectedSeason = seasons[seasons.length - 1].season;

  function avatarOrPlaceholder(url, name) {
    return url || `https://via.placeholder.com/56?text=${encodeURIComponent(name ? name[0] : 'C')}`;
  }

  $: selectedHonor = honors.find(h => String(h.season) === String(selectedSeason)) || null;
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
    max-width: 980px;
    margin: 1.5rem auto;
    padding: 0 1rem;
  }

  h1 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
  }

  .debug { color: var(--muted); font-size: 0.95rem; margin-bottom: .75rem; }

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

  .section-title { font-size:1.05rem; font-weight:700; margin:0; }
  .section-sub { color: var(--muted); font-size: .9rem; }

  .h-controls { display:flex; align-items:center; gap:12px; }
  .team-select { padding:8px 10px; border-radius:8px; background:#06101a; color:var(--text); border:1px solid rgba(255,255,255,0.04); }

  .honor-row { display:flex; align-items:center; gap:12px; margin:10px 0; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; background:#111; display:block; flex-shrink:0; }
  .honor-title { font-weight:700; }
  .honor-sub { color: var(--muted); font-size:0.92rem; }

  .json-links a { display:block; color:var(--muted); text-decoration:underline; margin-top:.25rem; word-break:break-all; }
</style>

<div class="page">
  <h1>Honor Hall</h1>

  {#if messages && messages.length}
    <div class="debug" aria-live="polite">
      {#each messages as m, i}
        <div>{i + 1}. {m}</div>
      {/each}
    </div>
  {/if}

  <div class="card" style="margin-bottom:1rem;">
    <div class="card-header">
      <div>
        <div class="section-title">Season</div>
        <div class="section-sub">Choose a season to view honors</div>
      </div>
      <div class="h-controls">
        <label for="season-select" class="small-muted">Season</label>
        <select id="season-select" class="team-select" bind:value={selectedSeason}>
          {#each seasons as s}
            <option value={s.season}>Season {s.season}</option>
          {/each}
        </select>
      </div>
    </div>

    {#if selectedHonor}
      <div style="margin-top:8px;">
        <div class="honor-row">
          <div style="min-width:56px;">
            <img class="avatar" src={avatarOrPlaceholder(selectedHonor.champion?.avatar ?? null, selectedHonor.champion?.team_name)} alt="Champion" />
          </div>
          <div>
            <div class="honor-title">Champion</div>
            {#if selectedHonor.champion}
              <div class="honor-sub">{selectedHonor.champion.team_name} {#if selectedHonor.champion.owner_name}— <span class="small-muted">{selectedHonor.champion.owner_name}</span>{/if}</div>
            {:else}
              <div class="honor-sub small-muted">No champion data available</div>
            {/if}
          </div>
        </div>

        {#if selectedHonor.hallEntries && selectedHonor.hallEntries.length}
          <div style="margin-top:14px;">
            <div class="section-sub" style="margin-bottom:8px;">Hall entries</div>
            {#each selectedHonor.hallEntries as he}
              <div class="honor-row">
                <div style="min-width:56px;">
                  <img class="avatar" src={avatarOrPlaceholder(he.avatar || null, he.name || he.person || 'H')} alt={he.name || he.person || 'Hall'} />
                </div>
                <div>
                  <div class="honor-title">{he.name || he.person || he.title || 'Unknown'}</div>
                  <div class="honor-sub">{he.note || he.description || ''}</div>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div style="margin-top:12px;" class="small-muted">No explicit hall entries found in JSON for this season.</div>
        {/if}
      </div>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No data for selected season.</div>
    {/if}
  </div>

  {#if jsonLinks && jsonLinks.length}
    <div class="card" style="margin-top:1rem;">
      <div class="section-sub">Loaded JSON files</div>
      <div style="margin-top:8px;">
        {#each jsonLinks as jl}
          <div class="json-links"><a href={jl} target="_blank" rel="noopener noreferrer">{jl}</a></div>
        {/each}
      </div>
    </div>
  {/if}
</div>
