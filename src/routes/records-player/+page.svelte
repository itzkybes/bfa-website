<script>
  export let data;

  // seasons list (for the dropdown)
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);

  // server-provided objects
  const selectedSeasonResult = data?.selectedSeasonResult ?? null;
  const overallMvp = selectedSeasonResult?.overallMvp ?? null;
  const finalsMvp = selectedSeasonResult?.finalsMvp ?? null;

  const allTimePlayoffBestPerRoster = Array.isArray(data?.allTimePlayoffBestPerRoster) ? data.allTimePlayoffBestPerRoster : [];
  const allTimeFullSeasonBestPerRoster = Array.isArray(data?.allTimeFullSeasonBestPerRoster) ? data.allTimeFullSeasonBestPerRoster : [];

  function playerHeadshot(playerId, size = 56) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name.split(' ').map(n => n[0] || '').slice(0,2).join('') : 'P';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=07101a&color=ffffff&size=${size}`;
  }

  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function onImgError(e, fallbackSrc) {
    try { e.currentTarget.src = fallbackSrc; } catch (_) {}
  }
</script>

<style>
  :global(body) { color: #e6eef8; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
  .page { max-width: 1100px; margin: 18px auto; padding: 0 1rem; }
  .card { background: rgba(6,8,12,0.65); border-radius: 12px; padding: 14px; border: 1px solid rgba(255,255,255,0.04); box-shadow: 0 10px 30px rgba(2,6,23,0.6); }
  .topline { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
  .muted { color:#9aa3ad; }
  .filters { display:flex; gap:.6rem; align-items:center; }
  .select { padding:.6rem .8rem; border-radius:8px; background:#07101a; color:#e6eef8; border:1px solid rgba(99,102,241,0.25); font-weight:600; min-width:160px; }
  table { width:100%; border-collapse:collapse; margin-top:12px; }
  thead th { text-align:left; padding:10px; color:#9aa3ad; font-size:.82rem; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.03); }
  td { padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; }
  .player-cell { display:flex; gap:.8rem; align-items:center; }
  .player-avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; border:1px solid rgba(255,255,255,0.03); }
  .player-name { font-weight:800; }
  .small { color:#9aa3ad; font-size:.92rem; }
  .section-title { margin-top:16px; margin-bottom:6px; font-weight:800; color:#e6eef8; }
</style>

<div class="page">
  <div class="card">
    <div class="topline">
      <div>
        <h2 style="margin:0 0 6px 0;">Player Records — MVPs & All-time Leaders</h2>
        <div class="muted" style="margin-bottom:6px;">Use the dropdown to pick a season (applies only to the MVPs table).</div>
      </div>

      <form id="filters" method="get" class="filters" style="margin:0;">
        <label class="muted" for="season-select" style="margin-right:.4rem;">Season</label>
        <select id="season-select" name="season" class="select" on:change={submitFilters} aria-label="Select season">
          {#if seasons && seasons.length}
            {#each seasons as s}
              <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>
                {s.season ?? s.name ?? s.league_id}
              </option>
            {/each}
          {:else}
            <option value={selectedSeason}>{selectedSeason}</option>
          {/if}
        </select>
      </form>
    </div>

    <!-- MVPs table -->
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
            {#if overallMvp}
              <div class="player-cell">
                <img
                  class="player-avatar"
                  src={playerHeadshot(overallMvp.playerId) || overallMvp.playerAvatar || overallMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, overallMvp.playerName)}
                  alt={overallMvp.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(overallMvp.roster_meta?.team_avatar ?? overallMvp.roster_meta?.owner_avatar, overallMvp.playerName))}
                />
                <div>
                  <div class="player-name">{overallMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(overallMvp.points)}</div>
                  {#if overallMvp.roster_meta}
                    <div class="small">Top roster: {overallMvp.roster_meta.team_name ?? overallMvp.roster_meta.owner_name}</div>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="muted">No overall MVP determined for this season.</div>
            {/if}
          </td>

          <td>
            {#if finalsMvp}
              <div class="player-cell">
                <img
                  class="player-avatar"
                  src={playerHeadshot(finalsMvp.playerId) || finalsMvp.playerAvatar || finalsMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, finalsMvp.playerName)}
                  alt={finalsMvp.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(finalsMvp.roster_meta?.team_avatar ?? finalsMvp.roster_meta?.owner_avatar, finalsMvp.playerName))}
                />
                <div>
                  <div class="player-name">{finalsMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(finalsMvp.points)}</div>
                  {#if finalsMvp.roster_meta}
                    <div class="small">Roster: {finalsMvp.roster_meta.team_name ?? finalsMvp.roster_meta.owner_name}</div>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="muted">No finals MVP determined for this season.</div>
            {/if}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- All-time playoff best per roster -->
    <h3 class="section-title">All-time best playoff points by player — per team (2022 → present)</h3>
    {#if allTimePlayoffBestPerRoster && allTimePlayoffBestPerRoster.length}
      <table aria-label="All-time playoff best">
        <thead>
          <tr>
            <th style="width:35%;">Team (owner)</th>
            <th style="width:45%;">Player (season)</th>
            <th style="width:20%;">Playoff pts</th>
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
                    <div class="small">Season: {row.season}</div>
                  </div>
                </div>
              </td>
              <td>
                <div class="player-cell">
                  <img class="player-avatar" src={playerHeadshot(row.playerId) || row.playerAvatar || avatarOrPlaceholder(null, row.playerName)} alt={row.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, row.playerName))}/>
                  <div>
                    <div class="player-name">{row.playerName ?? `Player ${row.playerId ?? ''}`}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(row.points)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No all-time playoff best data available.</div>
    {/if}

    <!-- All-time full-season best per roster -->
    <h3 class="section-title">All-time best full-season (week 1 → playoff_week_start + 2) by player — per team (2022 → present)</h3>
    {#if allTimeFullSeasonBestPerRoster && allTimeFullSeasonBestPerRoster.length}
      <table aria-label="All-time full-season best">
        <thead>
          <tr>
            <th style="width:35%;">Team (owner)</th>
            <th style="width:45%;">Player (season)</th>
            <th style="width:20%;">Points</th>
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
                    <div class="small">Season: {row.season}</div>
                  </div>
                </div>
              </td>
              <td>
                <div class="player-cell">
                  <img class="player-avatar" src={playerHeadshot(row.playerId) || row.playerAvatar || avatarOrPlaceholder(null, row.playerName)} alt={row.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, row.playerName))}/>
                  <div>
                    <div class="player-name">{row.playerName ?? `Player ${row.playerId ?? ''}`}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(row.points)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No all-time full-season best data available.</div>
    {/if}

    <!-- messages -->
    {#if data?.messages && data.messages.length}
      <div class="muted" style="margin-top:12px;">Messages / Debug:</div>
      <div style="font-family:monospace; white-space:pre-wrap; color:#9fb0c4; background: rgba(255,255,255,0.02); padding:10px; border-radius:8px; margin-top:6px;">
        {#each data.messages as m}
          {m}
          {'\n'}
        {/each}
      </div>
    {/if}
  </div>
</div>
