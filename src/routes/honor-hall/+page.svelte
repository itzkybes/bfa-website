<script>
  export let data;
  import PlayoffBrackets from '$lib/PlayoffBrackets.svelte';

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[0].season : null);

  // these come from the loader
  const matchupsRows = data?.matchupsRows ?? [];
  const standings = data?.standings ?? [];
  const messages = data?.messages ?? [];

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  }
</script>

<style>
  :global(body){ background: linear-gradient(180deg,#070809,#0b0c0f); color: #e6eef8; }
  .page { padding: 1.2rem 1.6rem; max-width: 1100px; margin: 0 auto; }
  .header { display:flex; gap:1rem; align-items:center; margin-bottom:1rem; }
  h1 { margin:0; font-size:1.25rem; }
  .controls { display:flex; gap:.6rem; align-items:center; margin-left:auto; }
  .season-select { padding:6px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); color:inherit; font-weight:600; }
  .muted { color:#9ca3af; font-size:.9rem; }
</style>

<div class="page">
  <div class="header">
    <div>
      <h1>Honor Hall</h1>
      <div class="muted">Playoff view</div>
    </div>

    <form id="filters" method="get" class="controls" aria-label="filters">
      <label class="muted" for="season">Season</label>
      <select id="season" name="season" class="season-select" on:change={submitFilters} aria-label="Select season">
        {#each seasons as s}
          <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeason)}>{s.season ?? s.name}</option>
        {/each}
      </select>
    </form>
  </div>

  {#if messages && messages.length}
    <div style="background: rgba(255,255,255,0.02); padding:8px; border-radius:8px; margin-bottom:12px; color:#cfe7f6;">
      {#each messages as m}
        <div>{m}</div>
      {/each}
    </div>
  {/if}

  {#if standings && standings.length}
    <PlayoffBrackets standings={standings} season={selectedSeason} matchupsRows={matchupsRows} titlePrefix={String(selectedSeason)} />
  {:else}
    <div class="muted">No playoff matchups or standings found for the selected season.</div>
  {/if}
</div>
