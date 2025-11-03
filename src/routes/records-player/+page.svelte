<script>
  export let data;

  // seasons list & selection (server should return seasons and optionally selectedSeason)
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);

  // seasonsResults: array of { season, championshipWeek, finalsMvp, overallMvp, ... }
  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // helper: pick the single seasonsResults row for the selected season
  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? null;

  // Build a Sleeper CDN player headshot URL like honor-hall does
  function playerHeadshot(playerId, size = 56) {
    if (!playerId) return '';
    // honor-hall used: https://sleepercdn.com/content/nba/players/${playerId}.jpg
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // fallback: use roster-level avatar or generated initials avatar
  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name.split(' ').map(n => n[0] || '').slice(0,2).join('') : 'P';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=07101a&color=ffffff&size=${size}`;
  }

  // format points
  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return Math.round(n * 100) / 100;
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  // onimageerror
  function onImgError(e, fallback) {
    try { e.currentTarget.src = fallback; }
    catch (err) {}
  }
</script>

<style>
  .page { max-width: 1100px; margin: 1.2rem auto; padding: 0 1rem; color: var(--nav-text, #e6eef8); }
  .card { background: rgba(6,8,12,0.6); border-radius: 12px; padding: 14px; border: 1px solid rgba(255,255,255,0.03); }
  .filters { display:flex; gap:.6rem; align-items:center; justify-content:flex-end; margin-bottom: .75rem; }
  .select { padding:.6rem .8rem; border-radius:8px; background: #07101a; color: #e6eef8; border: 1px solid rgba(99,102,241,0.25); min-width: 160px; font-weight:600; }
  table { width:100%; border-collapse:collapse; margin-top: .6rem; }
  thead th { text-align:left; padding:10px; color:#9ca3af; font-size:.85rem; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.03); }
  td { padding:14px 10px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; }
  .player-cell { display:flex; gap:.8rem; align-items:center; }
  .player-avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; border:1px solid rgba(255,255,255,0.03); }
  .player-name { font-weight:800; }
  .muted { color:#9ca3af; font-size:.92rem; }
  .debug { font-family:monospace; white-space:pre-wrap; font-size:0.82rem; color:#9fb0c4; margin-top:.6rem; }
</style>

<div class="page">
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;">
      <div>
        <h2 style="margin:0 0 6px 0;">Player Records — MVPs</h2>
        <div class="muted">Shows Overall MVP and Finals MVP per season (uses local season_matchups JSON when available).</div>
      </div>

      <form id="filters" method="get" class="filters" style="margin:0;">
        <label class="muted" for="season-select" style="margin-right:.4rem;">Season</label>
        <select id="season-select" name="season" class="select" on:change={submitFilters} aria-label="Select season">
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>
              {s.season ?? s.name ?? s.league_id}
            </option>
          {/each}
        </select>
      </form>
    </div>

    <!-- Table -->
    <table aria-label="Player MVPs">
      <thead>
        <tr>
          <th style="width:20%;">Season</th>
          <th style="width:40%;">Overall MVP</th>
          <th style="width:40%;">Finals MVP</th>
        </tr>
      </thead>

      <tbody>
        {#if selectedRow}
          <tr>
            <td>
              <div style="font-weight:700;">{selectedRow.season}</div>
              <div class="muted">Champ week: {selectedRow.championshipWeek ?? '-'}</div>
              {#if selectedRow._sourceJson}
                <div class="muted" style="margin-top:.4rem;">Source: {selectedRow._sourceJson}</div>
              {/if}
            </td>

            <td>
              {#if selectedRow.overallMvp}
                <div class="player-cell">
                  <img
                    class="player-avatar"
                    src={playerHeadshot(selectedRow.overallMvp.playerId) || selectedRow.overallMvp.player_avatar || selectedRow.overallMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, selectedRow.overallMvp.playerName)}
                    alt={selectedRow.overallMvp.playerName}
                    on:error={(e) => onImgError(e, avatarOrPlaceholder(selectedRow.overallMvp.roster_meta?.team_avatar ?? selectedRow.overallMvp.roster_meta?.owner_avatar, selectedRow.overallMvp.playerName))}
                  />
                  <div>
                    <div class="player-name">{selectedRow.overallMvp.playerName}</div>
                    <div class="muted">Pts: {formatPts(selectedRow.overallMvp.points)}</div>
                    {#if selectedRow.overallMvp.roster_meta}
                      <div class="muted">Top roster: {selectedRow.overallMvp.roster_meta.team_name ?? selectedRow.overallMvp.roster_meta.owner_name}</div>
                    {/if}
                  </div>
                </div>
              {:else}
                <div class="muted">No overall MVP determined</div>
              {/if}
            </td>

            <td>
              {#if selectedRow.finalsMvp}
                <div class="player-cell">
                  <img
                    class="player-avatar"
                    src={playerHeadshot(selectedRow.finalsMvp.playerId) || selectedRow.finalsMvp.player_avatar || selectedRow.finalsMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, selectedRow.finalsMvp.playerName)}
                    alt={selectedRow.finalsMvp.playerName}
                    on:error={(e) => onImgError(e, avatarOrPlaceholder(selectedRow.finalsMvp.roster_meta?.team_avatar ?? selectedRow.finalsMvp.roster_meta?.owner_avatar, selectedRow.finalsMvp.playerName))}
                  />
                  <div>
                    <div class="player-name">{selectedRow.finalsMvp.playerName}</div>
                    <div class="muted">Pts: {formatPts(selectedRow.finalsMvp.points)}</div>
                    {#if selectedRow.finalsMvp.roster_meta}
                      <div class="muted">Roster: {selectedRow.finalsMvp.roster_meta.team_name ?? selectedRow.finalsMvp.roster_meta.owner_name}</div>
                    {/if}
                  </div>
                </div>
              {:else}
                <div class="muted">No finals MVP determined</div>
              {/if}
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="3" class="muted">No data for selected season.</td>
          </tr>
        {/if}
      </tbody>
    </table>

    <!-- debug -->
    <div style="margin-top:12px;">
      {#if jsonLinks && jsonLinks.length}
        <div class="muted" style="margin-bottom:.4rem;">Loaded JSON files:</div>
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
