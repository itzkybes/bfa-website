<!-- src/routes/records-player/+page.svelte -->
<script>
  export let data;

  // seasons list and selection (selectedSeason provided by server)
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  // top-level server outputs
  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];
  const allTimePlayoffBestPerRoster = Array.isArray(data?.allTimePlayoffBestPerRoster) ? data.allTimePlayoffBestPerRoster : [];
  const allTimeFullSeasonBestPerRoster = Array.isArray(data?.allTimeFullSeasonBestPerRoster) ? data.allTimeFullSeasonBestPerRoster : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // find selected season's row (MVPs + per-season teamLeaders)
  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? null;

  // helper to build player headshot URL (NBA)
  function playerHeadshot(playerId, size = 56) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // fallback avatar (owner/team avatar first, then initials)
  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name.split(' ').map(n=>n[0]||'').slice(0,2).join('') : 'P';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=07101a&color=ffffff&size=${size}`;
  }

  // format points for display
  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function onImgError(e, fallback) {
    try { e.currentTarget.src = fallback; } catch(_) {}
  }
</script>

<style>
  .page { max-width: 1100px; margin: 1.2rem auto; padding: 0 1rem; color: var(--nav-text,#e6eef8); }
  .card { background: rgba(6,8,12,0.6); border-radius: 12px; padding: 14px; border: 1px solid rgba(255,255,255,0.03); }
  .topline { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
  .muted { color:#9ca3af; }
  .filters { display:flex; gap:.6rem; align-items:center; }
  .select { padding:.6rem .8rem; border-radius:8px; background:#07101a; color:#e6eef8; border:1px solid rgba(99,102,241,0.25); font-weight:600; min-width:160px; }
  table { width:100%; border-collapse:collapse; margin-top:12px; }
  thead th { text-align:left; padding:10px; color:#9aa3ad; font-size:.82rem; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.03); }
  td { padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; }
  .player-cell { display:flex; gap:.8rem; align-items:center; }
  .player-avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; border:1px solid rgba(255,255,255,0.03); }
  .player-name { font-weight:800; }
  .small { color:#9aa3ad; font-size:.92rem; }
  .debug { font-family:monospace; white-space:pre-wrap; font-size:.82rem; color:#9fb0c4; margin-top:.8rem; max-height:280px; overflow:auto; background: rgba(255,255,255,0.02); padding:10px; border-radius:8px; }
  .empty { color:#9aa3ad; padding:14px 0; }
</style>

<div class="page">
  <div class="card">
    <div class="topline">
      <div>
        <h2 style="margin:0 0 6px 0;">Player Records — MVPs</h2>
        <div class="muted" style="margin-bottom:6px;">Select a season to view Overall & Finals MVP for that season (dropdown controls only the MVPs)</div>
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

    <!-- MVPs table (no season column) -->
    <table aria-label="Player MVPs">
      <thead>
        <tr>
          <th style="width:50%;">Overall MVP</th>
          <th style="width:50%;">Finals MVP</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            {#if selectedRow?.overallMvp}
              <div class="player-cell">
                <img
                  class="player-avatar"
                  src={selectedRow.overallMvp.playerAvatar || playerHeadshot(selectedRow.overallMvp.playerId) || avatarOrPlaceholder(selectedRow.overallMvp.roster_meta?.team_avatar, selectedRow.overallMvp.playerName)}
                  alt={selectedRow.overallMvp.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(selectedRow.overallMvp.roster_meta?.team_avatar ?? selectedRow.overallMvp.roster_meta?.owner_avatar, selectedRow.overallMvp.playerName))}
                />
                <div>
                  <div class="player-name">{selectedRow.overallMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(selectedRow.overallMvp.points)}</div>
                  {#if selectedRow.overallMvp.roster_meta}
                    <div class="small">Top roster: {selectedRow.overallMvp.roster_meta.team_name ?? selectedRow.overallMvp.roster_meta.owner_name}</div>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="empty">No overall MVP determined for this season.</div>
            {/if}
          </td>

          <td>
            {#if selectedRow?.finalsMvp}
              <div class="player-cell">
                <img
                  class="player-avatar"
                  src={selectedRow.finalsMvp.playerAvatar || playerHeadshot(selectedRow.finalsMvp.playerId) || avatarOrPlaceholder(selectedRow.finalsMvp.roster_meta?.team_avatar, selectedRow.finalsMvp.playerName)}
                  alt={selectedRow.finalsMvp.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(selectedRow.finalsMvp.roster_meta?.team_avatar ?? selectedRow.finalsMvp.roster_meta?.owner_avatar, selectedRow.finalsMvp.playerName))}
                />
                <div>
                  <div class="player-name">{selectedRow.finalsMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(selectedRow.finalsMvp.points)}</div>
                  {#if selectedRow.finalsMvp.roster_meta}
                    <div class="small">Roster: {selectedRow.finalsMvp.roster_meta.team_name ?? selectedRow.finalsMvp.roster_meta.owner_name}</div>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="empty">No finals MVP determined for this season.</div>
            {/if}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- All-time Playoff Best per roster (single best-season playoff points for a player on each roster) -->
    <h3 style="margin-top:18px; margin-bottom:8px;">All-time single-season playoff best (best player for each team — 2022→present)</h3>
    {#if allTimePlayoffBestPerRoster && allTimePlayoffBestPerRoster.length}
      <table aria-label="All-time playoff best per roster">
        <thead>
          <tr>
            <th style="width:35%;">Team (owner)</th>
            <th style="width:45%;">Player (season)</th>
            <th style="width:20%;">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each allTimePlayoffBestPerRoster as row (row.rosterId)}
            <tr>
              <td>
                <div style="display:flex; gap:.6rem; align-items:center;">
                  <img class="player-avatar" src={row.teamAvatar || avatarOrPlaceholder(null, row.owner_name)} alt={row.owner_name} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, row.owner_name))} style="width:48px;height:48px"/>
                  <div>
                    <div style="font-weight:800;">{row.owner_name ?? `Roster ${row.rosterId}`}</div>
                    <div class="small">Season {row.season}</div>
                  </div>
                </div>
              </td>
              <td>
                <div class="player-cell">
                  <img class="player-avatar" src={row.playerAvatar || playerHeadshot(row.playerId) || avatarOrPlaceholder(null, row.playerName)} alt={row.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, row.playerName))}/>
                  <div>
                    <div class="player-name">{row.playerName ?? `Player ${row.playerId}`}</div>
                    <div class="small">Season {row.season}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(row.points)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No playoff bests available.</div>
    {/if}

    <!-- Cross-season full-season best per roster (1..playoffEnd totals) -->
    <h3 style="margin-top:18px; margin-bottom:8px;">All-time single-season full-season best (best player for each team — includes regular + playoffs, 2022→present)</h3>
    {#if allTimeFullSeasonBestPerRoster && allTimeFullSeasonBestPerRoster.length}
      <table aria-label="All-time full-season best per roster">
        <thead>
          <tr>
            <th style="width:35%;">Team (owner)</th>
            <th style="width:45%;">Player (season)</th>
            <th style="width:20%;">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each allTimeFullSeasonBestPerRoster as row (row.rosterId)}
            <tr>
              <td>
                <div style="display:flex; gap:.6rem; align-items:center;">
                  <img class="player-avatar" src={row.teamAvatar || avatarOrPlaceholder(null, row.owner_name)} alt={row.owner_name} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, row.owner_name))} style="width:48px;height:48px"/>
                  <div>
                    <div style="font-weight:800;">{row.owner_name ?? `Roster ${row.rosterId}`}</div>
                    <div class="small">Season {row.season}</div>
                  </div>
                </div>
              </td>
              <td>
                <div class="player-cell">
                  <img class="player-avatar" src={row.playerAvatar || playerHeadshot(row.playerId) || avatarOrPlaceholder(null, row.playerName)} alt={row.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, row.playerName))}/>
                  <div>
                    <div class="player-name">{row.playerName ?? `Player ${row.playerId}`}</div>
                    <div class="small">Season {row.season}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(row.points)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No full-season bests available.</div>
    {/if}

    <!-- JSON links & debug -->
    {#if jsonLinks && jsonLinks.length}
      <div style="margin-top:12px;">
        <div class="small" style="margin-bottom:6px;">Loaded JSON files:</div>
        <ul class="muted">
          {#each jsonLinks as jl}
            <li><a href={jl.url} target="_blank" rel="noreferrer">{jl.title}</a></li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if messages && messages.length}
      <div class="muted" style="margin-top:12px;">Messages / Debug:</div>
      <div class="debug" aria-live="polite">
        {#each messages as m}
          {m}
          {'\n'}
        {/each}
      </div>
    {/if}
  </div>
</div>
