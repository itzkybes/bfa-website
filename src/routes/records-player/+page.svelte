<script>
  // Player MVPs page
  export let data;

  // seasons from server
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];

  // mapping created by server: seasonKey -> { finalsMvp, overallMvp, ... }
  const mvpBySeason = data?.mvpBySeason ?? {};

  // selected season - prefer server's selectedSeason
  let selectedSeason = data?.selectedSeason ? String(data.selectedSeason) : (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  // reactive selectedKey and selectedEntry
  $: selectedKey = String(selectedSeason ?? '');
  $: selectedEntry = mvpBySeason[selectedKey] ?? null;

  // messages/jsonLinks from server (for debug / visibility)
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
  const loadedFiles = Array.isArray(data?.loadedFiles) ? data.loadedFiles : [];

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function playerHeadshot(playerId) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name[0] : 'P';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function seasonLabel(s) {
    if (!s) return 'Unknown';
    if (s.season != null) return String(s.season);
    if (s.name) return s.name;
    return s.league_id || 'Unknown';
  }
</script>

<style>
  :global(body) {
    --card-bg: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    --muted: #9ca3af;
    --text: #e6eef8;
  }

  .page { max-width: 1100px; margin: 1.5rem auto; padding: 0 1rem; }
  h1 { margin: 0 0 0.5rem 0; font-size: 1.35rem; }

  .card {
    background: var(--card-bg);
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
  }

  .controls {
    display:flex;
    gap:.75rem;
    align-items:center;
    margin: .6rem 0 1rem 0;
    justify-content:space-between;
  }

  /* Matchings select style from Standings */
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

  .mvp-table { width:100%; border-collapse: collapse; margin-top: .5rem; }
  .mvp-table th { text-align:left; padding:10px 12px; color:var(--muted); font-size:.9rem; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.03); }
  .mvp-table td { padding:12px; border-bottom:1px solid rgba(255,255,255,0.03); color:var(--text); vertical-align: middle; }

  .mvp-row { display:flex; gap:12px; align-items:center; min-width:0; }
  .avatar { width:64px; height:64px; border-radius:10px; object-fit:cover; background:#081018; flex-shrink:0; border:1px solid rgba(255,255,255,0.03); }
  .player-name { font-weight:800; }
  .player-meta { color:var(--muted); font-size:.95rem; margin-top:6px; }

  .messages { margin-bottom: 12px; color: var(--muted); font-size: .95rem; }

  @media (max-width: 720px) {
    .controls { flex-direction:column; align-items:stretch; gap:.6rem; }
    .avatar { width:56px; height:56px; }
    .mvp-table th, .mvp-table td { padding:8px; }
  }
</style>

<div class="page">
  <h1>Player MVPs</h1>

  {#if messages && messages.length}
    <div class="messages" aria-live="polite">
      <strong>Messages</strong>
      <ol>
        {#each messages as m, i}
          <li>{m}</li>
        {/each}
      </ol>

      {#if loadedFiles && loadedFiles.length}
        <div style="margin-top:.6rem; font-weight:700">Loaded JSON files:</div>
        <ul style="margin-top:.35rem; color:var(--muted)">
          {#each loadedFiles as lf}
            <li>{lf}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <div class="controls">
    <form id="filters" method="get" style="display:flex; gap:.5rem; align-items:center;">
      <label for="season" class="small-muted" aria-hidden="true">Season</label>
      <select id="season" name="season" class="select" bind:value={selectedSeason} on:change={submitFilters}>
        {#if seasons && seasons.length}
          {#each seasons as s}
            <option value={s.season ?? s.league_id}>{seasonLabel(s)}</option>
          {/each}
        {:else}
          <option value={selectedSeason}>{selectedSeason}</option>
        {/if}
      </select>
    </form>

    <div style="color:var(--muted); font-weight:700;">
      Showing MVPs for: <span style="color:inherit">{selectedEntry?.season ?? selectedEntry?.leagueId ?? selectedSeason ?? '—'}</span>
    </div>
  </div>

  <div class="card" role="region" aria-label="Player MVPs">
    <table class="mvp-table" role="table">
      <thead>
        <tr>
          <th style="width:60%;">Award</th>
          <th style="width:40%;">Player</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div style="font-weight:800;">Finals MVP</div>
            <div class="player-meta">Best performer across championship matchup(s)</div>
          </td>
          <td>
            {#if selectedEntry && selectedEntry.finalsMvp}
              <div class="mvp-row">
                <img class="avatar" src={playerHeadshot(selectedEntry.finalsMvp.playerId) || avatarOrPlaceholder(null, selectedEntry.finalsMvp.playerId)} alt={selectedEntry.finalsMvp.playerId} on:error={(e)=>e.currentTarget.src=avatarOrPlaceholder(null, selectedEntry.finalsMvp.playerId)} />
                <div style="min-width:0;">
                  <div class="player-name">{selectedEntry.finalsMvp.playerName ?? selectedEntry.finalsMvp.playerId ?? 'Player'}</div>
                  <div class="player-meta">
                    {selectedEntry.finalsMvp.rosterId ? `Roster ${selectedEntry.finalsMvp.rosterId}` : 'Roster: —'}
                    {#if selectedEntry.finalsMvp.points != null}
                      &nbsp;•&nbsp; {formatPts(selectedEntry.finalsMvp.points)} pts
                    {/if}
                  </div>
                </div>
              </div>
            {:else}
              <div class="mvp-row">
                <img class="avatar" src={avatarOrPlaceholder(null, 'Player')} alt="placeholder" />
                <div style="min-width:0;">
                  <div class="player-name">No Finals MVP</div>
                  <div class="player-meta">No data for this season</div>
                </div>
              </div>
            {/if}
          </td>
        </tr>

        <tr>
          <td>
            <div style="font-weight:800;">Overall MVP</div>
            <div class="player-meta">Most points across the entire season (regular + playoffs)</div>
          </td>
          <td>
            {#if selectedEntry && selectedEntry.overallMvp}
              <div class="mvp-row">
                <img class="avatar" src={playerHeadshot(selectedEntry.overallMvp.playerId || selectedEntry.overallMvp.topPlayerId) || avatarOrPlaceholder(null, selectedEntry.overallMvp.playerId)} alt={selectedEntry.overallMvp.playerId} on:error={(e)=>e.currentTarget.src=avatarOrPlaceholder(null, selectedEntry.overallMvp.playerId)} />
                <div style="min-width:0;">
                  <div class="player-name">{selectedEntry.overallMvp.playerName ?? selectedEntry.overallMvp.playerId ?? 'Player'}</div>
                  <div class="player-meta">
                    {#if selectedEntry.overallMvp.points != null}
                      {formatPts(selectedEntry.overallMvp.points)} pts (season)
                    {:else}
                      No season points found
                    {/if}
                  </div>
                </div>
              </div>
            {:else}
              <div class="mvp-row">
                <img class="avatar" src={avatarOrPlaceholder(null, 'Player')} alt="placeholder" />
                <div style="min-width:0;">
                  <div class="player-name">No Overall MVP</div>
                  <div class="player-meta">No data for this season</div>
                </div>
              </div>
            {/if}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
