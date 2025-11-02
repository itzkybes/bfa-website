<!-- src/routes/records-player/+page.svelte -->
<script>
  export let data;

  // seasons list from server and results
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];

  // messages and jsonLinks
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];

  // default selectedSeason: prefer last numeric season from seasons, else last seasonsResults
  let selectedSeason = (() => {
    if (seasons && seasons.length) {
      const last = seasons[seasons.length - 1];
      return String(last.season ?? last.league_id);
    }
    if (seasonsResults && seasonsResults.length) {
      return String(seasonsResults[seasonsResults.length - 1].season);
    }
    return null;
  })();

  // computed selected result
  $: selectedResult = (() => {
    if (!selectedSeason || !seasonsResults) return null;
    // try to find by season numeric value first, then by leagueId
    let found = seasonsResults.find(r => r.season != null && String(r.season) === String(selectedSeason));
    if (found) return found;
    found = seasonsResults.find(r => String(r.leagueId) === String(selectedSeason));
    if (found) return found;
    // fallback to first
    return seasonsResults.length ? seasonsResults[0] : null;
  })();

  // helper to build player headshot URL (Sleeper CDN)
  function playerHeadshot(playerId, size = 64) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // small formatting helpers
  function formatPts(v) {
    const n = Number(v ?? 0);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name[0] : 'P';
    // use ui-avatars but keep it dark-friendly
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  // submit form if you want server-side filtering in future; currently selection is client-side.
  function submitFilters(e) {
    // retain compatibility: attempt to submit GET form if present
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else if (form) form?.submit();
  }
</script>

<style>
  :global(body) {
    --card: #071025;
    --muted: #9ca3af;
    --text: #e6eef8;
  }

  .page {
    max-width: 1100px;
    margin: 1.5rem auto;
    padding: 0 1rem;
  }

  h1 { margin: 0 0 0.75rem 0; font-size:1.35rem; }

  .controls-row {
    display:flex;
    justify-content:space-between;
    gap:1rem;
    align-items:center;
    margin-bottom: 1rem;
    flex-wrap:wrap;
  }

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

  .card {
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
    overflow: hidden;
  }

  .messages {
    margin-bottom: 1rem;
    color: var(--muted);
    font-size: 0.95rem;
  }

  .json-links { margin-top: 0.5rem; display:flex; flex-direction:column; gap:6px; }
  .json-links a { color: #9fb0ff; font-weight:600; text-decoration: none; }
  .json-links a:hover { text-decoration: underline; }

  .mvp-table {
    width:100%;
    border-collapse: collapse;
    margin-top: 0.6rem;
  }
  .mvp-row {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    padding:14px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }
  .award {
    flex: 1 1 50%;
  }
  .playerCell {
    flex: 1 1 50%;
    display:flex;
    gap:12px;
    align-items:center;
    justify-content:flex-end;
  }
  .playerMeta { text-align:left; }
  .playerName { font-weight:800; color: var(--text); }
  .smallMuted { color: var(--muted); font-size:.9rem; margin-top:4px; }

  .avatar {
    width:64px;
    height:64px;
    border-radius:10px;
    object-fit:cover;
    border:1px solid rgba(255,255,255,0.04);
    flex-shrink:0;
  }

  @media (max-width: 900px) {
    .mvp-row { flex-direction: column; align-items:flex-start; gap:8px; }
    .playerCell { justify-content:flex-start; width:100%; }
    .avatar { width:56px; height:56px; }
    .select { min-width: 100%; width:100%; }
  }
</style>

<div class="page">
  <h1>Player MVPs</h1>

  <div class="controls-row">
    <form id="filters" method="get" style="display:flex; align-items:center; gap:12px;">
      <label for="season-select" class="smallMuted" aria-hidden="true">Season</label>
      <select id="season-select" name="season" class="select" bind:value={selectedSeason} on:change={submitFilters}>
        {#if seasons && seasons.length}
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeason)}>
              {s.season ?? s.name ?? s.league_id}
            </option>
          {/each}
        {:else if seasonsResults && seasonsResults.length}
          {#each seasonsResults as r}
            <option value={r.season ?? r.leagueId} selected={(r.season ?? r.leagueId) === String(selectedSeason)}>
              {r.season ?? r.leagueId}
            </option>
          {/each}
        {:else}
          <option value={selectedSeason}>{selectedSeason}</option>
        {/if}
      </select>
    </form>

    <div class="smallMuted">Showing MVPs for: <strong style="color:var(--text); margin-left:6px;">{selectedSeason}</strong></div>
  </div>

  {#if messages && messages.length}
    <div class="card messages" aria-live="polite">
      <strong>Messages</strong>
      <ol style="margin-top:.5rem; padding-left:18px;">
        {#each messages as m, idx}
          <li>{m}</li>
        {/each}
      </ol>

      {#if jsonLinks && jsonLinks.length}
        <div style="margin-top:.75rem; font-weight:700; color:inherit">Loaded JSON files:</div>
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

  <div class="card" role="region" aria-label="Season MVPs">
    {#if selectedResult}
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div style="font-weight:700; color:var(--text);">Award</div>
        <div style="font-weight:700; color:var(--text);">Player</div>
      </div>

      <!-- Finals MVP row -->
      <div class="mvp-row">
        <div class="award">
          <div style="font-weight:700; margin-bottom:6px;">Finals MVP</div>
          <div class="smallMuted">Best performer across championship matchup(s)</div>
        </div>

        <div class="playerCell">
          {#if selectedResult.finalsMvp && selectedResult.finalsMvp.playerId}
            <img class="avatar" src={playerHeadshot(selectedResult.finalsMvp.playerId)} alt={selectedResult.finalsMvp.playerName ?? `Player ${selectedResult.finalsMvp.playerId}`} on:error={(e)=>{ e.currentTarget.src = avatarOrPlaceholder(null, selectedResult.finalsMvp.playerName); }} />
            <div class="playerMeta">
              <div class="playerName">{selectedResult.finalsMvp.playerName ?? `Player ${selectedResult.finalsMvp.playerId}`}</div>
              <div class="smallMuted">{formatPts(selectedResult.finalsMvp.points)} pts {selectedResult.championshipWeek ? `• Wk ${selectedResult.championshipWeek}` : ''}</div>
            </div>
          {:else}
            <img class="avatar" src={avatarOrPlaceholder(null, 'P')} alt="No Finals MVP" />
            <div class="playerMeta">
              <div class="playerName">No Finals MVP</div>
              <div class="smallMuted">No data for this season</div>
            </div>
          {/if}
        </div>
      </div>

      <!-- Overall MVP row -->
      <div class="mvp-row">
        <div class="award">
          <div style="font-weight:700; margin-bottom:6px;">Overall MVP</div>
          <div class="smallMuted">Most points across the entire season (regular + playoffs)</div>
        </div>

        <div class="playerCell">
          {#if selectedResult.overallMvp && selectedResult.overallMvp.playerId}
            <img class="avatar" src={playerHeadshot(selectedResult.overallMvp.playerId)} alt={selectedResult.overallMvp.playerName ?? `Player ${selectedResult.overallMvp.playerId}`} on:error={(e)=>{ e.currentTarget.src = avatarOrPlaceholder(null, selectedResult.overallMvp.playerName); }} />
            <div class="playerMeta">
              <div class="playerName">{selectedResult.overallMvp.playerName ?? `Player ${selectedResult.overallMvp.playerId}`}</div>
              <div class="smallMuted">{formatPts(selectedResult.overallMvp.points)} pts (season)</div>
            </div>
          {:else}
            <img class="avatar" src={avatarOrPlaceholder(null, 'P')} alt="No Overall MVP" />
            <div class="playerMeta">
              <div class="playerName">No Overall MVP</div>
              <div class="smallMuted">No data for this season</div>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <div class="smallMuted">No MVP data available for the selected season.</div>
    {/if}
  </div>
</div>
