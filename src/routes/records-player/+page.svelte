<script>
  export let data;

  // seasons list from server
  const seasons = (data && Array.isArray(data.seasons)) ? data.seasons : [];
  // seasonsResults is an array of { season, finalsMvp, overallMvp, championshipWeek, ... }
  const seasonsResults = (data && Array.isArray(data.seasonsResults)) ? data.seasonsResults : [];

  // messages / jsonLinks from server
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];

  // Determine default season (prefer latest numeric season returned by server)
  const numericSeasons = seasons.filter(s => s.season != null);
  const latestSeasonDefault = numericSeasons.length
    ? String(numericSeasons[numericSeasons.length - 1].season)
    : (seasons.length ? String(seasons[seasons.length - 1].league_id) : (seasonsResults.length ? String(seasonsResults[seasonsResults.length-1].season) : null));

  // selectedSeason (client-only filter) — default to latest
  let selectedSeason = latestSeasonDefault;

  // reactive: find result for selectedSeason
  $: selectedResult = (() => {
    if (!selectedSeason) return null;
    // prefer match by season value, then leagueId
    let found = seasonsResults.find(r => r.season != null && String(r.season) === String(selectedSeason));
    if (found) return found;
    found = seasonsResults.find(r => String(r.leagueId) === String(selectedSeason));
    if (found) return found;
    // fallback: try to match the seasons array entry
    const seasonObj = seasons.find(s => String(s.season) === String(selectedSeason) || String(s.league_id) === String(selectedSeason));
    if (seasonObj) {
      return seasonsResults.find(r => String(r.season) === String(seasonObj.season) || String(r.leagueId) === String(seasonObj.league_id)) || null;
    }
    return null;
  })();

  // helper to build player headshot URL (same as honor-hall: use sleeper CDN NBA)
  function playerHeadshot(playerId) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // avatar placeholder when no headshot available
  function avatarOrPlaceholder(url, name, size = 56) {
    if (url) return url;
    const letter = name ? name[0] : 'P';
    // use ui-avatars (same pattern you used elsewhere)
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  // convenience to render a season label safe
  function seasonLabel(s) {
    if (!s) return 'Unknown';
    if (s.season != null) return String(s.season);
    if (s.name) return s.name;
    return s.league_id || 'Unknown';
  }
</script>

<style>
  :global(body) {
    --text: #e6eef8;
    --muted: #9ca3af;
    color-scheme: dark;
  }

  .page {
    max-width: 1100px;
    margin: 1.5rem auto;
    padding: 0 1rem;
  }

  h1 {
    margin: 0 0 0.6rem 0;
    font-size: 1.4rem;
  }

  .messages {
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    border: 1px solid rgba(255,255,255,0.03);
    padding: 14px;
    border-radius: 10px;
    color: var(--muted);
    margin-bottom: 1rem;
  }
  .json-links { margin-top: 0.6rem; display:flex; flex-direction:column; gap:6px; }
  .json-links a { color: #9fb0ff; font-weight:600; text-decoration:none; }
  .json-links a:hover { text-decoration:underline; }

  .controls-row {
    display:flex;
    justify-content:space-between;
    gap:1rem;
    align-items:center;
    margin: .6rem 0 1rem 0;
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
    padding: 18px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
    overflow: hidden;
  }

  .mvp-table {
    width:100%;
    border-collapse:collapse;
    margin-top:0.6rem;
  }
  .mvp-table th, .mvp-table td {
    padding: 16px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    vertical-align: middle;
  }
  .mvp-table th {
    text-align:left;
    color: var(--muted);
    font-size:0.9rem;
    text-transform:uppercase;
    letter-spacing:0.02em;
  }

  .player-cell {
    display:flex;
    align-items:center;
    gap:12px;
  }
  .avatar {
    width:56px; height:56px; border-radius:10px; object-fit:cover; border:1px solid rgba(255,255,255,0.04);
    flex-shrink:0;
    background:#081018;
  }
  .player-info { min-width:0; }
  .player-name { font-weight:800; color:var(--text); }
  .player-meta { color: var(--muted); font-size: .92rem; margin-top:4px; }

  .no-data { color: var(--muted); font-weight:700; }

  @media (max-width:900px) {
    .controls-row { align-items:flex-start; }
    .select { min-width: 100%; width:100%; }
    .avatar { width:48px; height:48px; }
    .mvp-table th, .mvp-table td { padding: 12px 8px; }
  }

  @media (max-width:520px) {
    .avatar { width:40px; height:40px; }
  }
</style>

<div class="page">
  <h1>Player MVPs</h1>

  <!-- messages + jsonLinks -->
  {#if messages && messages.length}
    <div class="messages" aria-live="polite">
      <strong>Messages</strong>
      <ol style="margin:.5rem 0 0 1.15rem; padding:0; color:var(--muted);">
        {#each messages as m, i}
          <li style="margin:6px 0;">{m}</li>
        {/each}
      </ol>

      {#if jsonLinks && jsonLinks.length}
        <div style="margin-top:0.8rem; font-weight:700; color:inherit">Loaded JSON files:</div>
        <div class="json-links">
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

  <div class="controls-row">
    <div style="display:flex; align-items:center; gap:.8rem;">
      <label class="small-muted" for="season">Season</label>
      <select id="season" class="select" bind:value={selectedSeason} aria-label="Select season">
        {#if seasons && seasons.length}
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>
              {s.season ?? s.name ?? s.league_id}
            </option>
          {/each}
        {:else if seasonsResults && seasonsResults.length}
          {#each seasonsResults as r}
            <option value={r.season ?? r.leagueId} selected={String(r.season ?? r.leagueId) === String(selectedSeason)}>
              {r.season ?? r.leagueId}
            </option>
          {/each}
        {:else}
          <option value={selectedSeason}>{selectedSeason}</option>
        {/if}
      </select>
    </div>

    <div class="small-muted" aria-live="polite">
      {#if selectedResult}
        Showing MVPs for: <strong style="color:inherit">{selectedResult.season}</strong>
      {:else}
        Showing: <strong style="color:inherit">No data</strong>
      {/if}
    </div>
  </div>

  <div class="card" role="region" aria-label="Player MVPs">
    <table class="mvp-table" role="table">
      <thead>
        <tr>
          <th style="width:30%;">Award</th>
          <th style="width:70%;">Player</th>
        </tr>
      </thead>

      <tbody>
        <!-- Finals MVP row -->
        <tr>
          <td><strong>Finals MVP</strong><div class="player-meta">Best performer across championship matchup(s)</div></td>
          <td>
            {#if selectedResult && selectedResult.finalsMvp && selectedResult.finalsMvp.playerId}
              <div class="player-cell">
                <img class="avatar" src={playerHeadshot(selectedResult.finalsMvp.playerId)} alt={selectedResult.finalsMvp.playerName ?? 'Player headshot'} on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(selectedResult.finalsMvp.playerObj?.headshot ?? selectedResult.finalsMvp.roster_meta?.owner_avatar, selectedResult.finalsMvp.playerName); }} />
                <div class="player-info">
                  <div class="player-name">{selectedResult.finalsMvp.playerName ?? `Player ${selectedResult.finalsMvp.playerId}`}</div>
                  <div class="player-meta">{formatPts(selectedResult.finalsMvp.points ?? 0)} pts • Wk {selectedResult.championshipWeek ?? selectedResult.finalsMvp?.championshipWeek ?? '—'}</div>
                </div>
              </div>
            {:else}
              <div class="player-cell">
                <div class="avatar" style="display:flex; align-items:center; justify-content:center; background:transparent; border:1px dashed rgba(255,255,255,0.03); color:var(--muted); font-weight:700;">P</div>
                <div class="player-info">
                  <div class="player-name no-data">No Finals MVP</div>
                  <div class="player-meta">No data for this season</div>
                </div>
              </div>
            {/if}
          </td>
        </tr>

        <!-- Overall MVP row -->
        <tr>
          <td><strong>Overall MVP</strong><div class="player-meta">Most points across the entire season (regular + playoffs)</div></td>
          <td>
            {#if selectedResult && selectedResult.overallMvp && selectedResult.overallMvp.playerId}
              <div class="player-cell">
                <img class="avatar" src={playerHeadshot(selectedResult.overallMvp.playerId)} alt={selectedResult.overallMvp.playerName ?? 'Player headshot'} on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(selectedResult.overallMvp.playerObj?.headshot ?? selectedResult.overallMvp.roster_meta?.owner_avatar, selectedResult.overallMvp.playerName); }} />
                <div class="player-info">
                  <div class="player-name">{selectedResult.overallMvp.playerName ?? `Player ${selectedResult.overallMvp.playerId}`}</div>
                  <div class="player-meta">{formatPts(selectedResult.overallMvp.points ?? 0)} pts (season)</div>
                </div>
              </div>
            {:else}
              <div class="player-cell">
                <div class="avatar" style="display:flex; align-items:center; justify-content:center; background:transparent; border:1px dashed rgba(255,255,255,0.03); color:var(--muted); font-weight:700;">P</div>
                <div class="player-info">
                  <div class="player-name no-data">No Overall MVP</div>
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
