<script>
  export let data;

  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);

  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? null;

  // Sleeper CDN headshot (NBA)
  function playerHeadshot(playerId, size = 56) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // avatarOrPlaceholder: use provided url else ui-avatars with initials (matches honor-hall)
  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name.split(' ').map(n=>n[0]||'').slice(0,2).join('') : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 100) / 100);
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function onImgError(e, fallback) {
    try { e.currentTarget.src = fallback; } catch(_) {}
  }

  // Use server-provided teamLeaders directly (no client recompute)
  $: teamLeaders = Array.isArray(selectedRow?.teamLeaders) ? selectedRow.teamLeaders : [];
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
        <div class="muted" style="margin-bottom:6px;">Shows Overall MVP and Finals MVP for the selected season.</div>
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

    <!-- MVP table (no season column) -->
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
                  src={playerHeadshot(selectedRow.overallMvp.playerId) || selectedRow.overallMvp.player_avatar || selectedRow.overallMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, selectedRow.overallMvp.playerName)}
                  alt={selectedRow.overallMvp.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(selectedRow.overallMvp.roster_meta?.team_avatar ?? selectedRow.overallMvp.roster_meta?.owner_avatar, selectedRow.overallMvp.playerName))}
                />
                <div>
                  <div class="player-name">{selectedRow.overallMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(selectedRow.overallMvp.points)}</div>
                  {#if selectedRow.overallMvp.roster_meta}
                    <div class="small">Top roster: {selectedRow.overallMvp.roster_meta.owner_name ?? selectedRow.overallMvp.roster_meta.team_name}</div>
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
                  src={playerHeadshot(selectedRow.finalsMvp.playerId) || selectedRow.finalsMvp.player_avatar || selectedRow.finalsMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, selectedRow.finalsMvp.playerName)}
                  alt={selectedRow.finalsMvp.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(selectedRow.finalsMvp.roster_meta?.team_avatar ?? selectedRow.finalsMvp.roster_meta?.owner_avatar, selectedRow.finalsMvp.playerName))}
                />
                <div>
                  <div class="player-name">{selectedRow.finalsMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(selectedRow.finalsMvp.points)}</div>
                  {#if selectedRow.finalsMvp.roster_meta}
                    <div class="small">Roster: {selectedRow.finalsMvp.roster_meta.owner_name ?? selectedRow.finalsMvp.roster_meta.team_name}</div>
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

    <!-- Team single-season leaders (server-provided) -->
    <h3 style="margin-top:18px; margin-bottom:8px;">Team single-season leaders (best player-season per team)</h3>
    {#if teamLeaders && teamLeaders.length}
      <table aria-label="Team single-season leaders">
        <thead>
          <tr>
            <th style="width:40%;">Team</th>
            <th style="width:40%;">Top player (single-season)</th>
            <th style="width:20%;">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each teamLeaders as t (t.rosterId)}
            <tr>
              <td>
                <div style="font-weight:800;">{t.roster_name}</div>
                <div class="small">{t.owner_name ?? `Roster ${t.rosterId}`}</div> <!-- owner name instead of roster# -->
              </td>
              <td>
                <div class="player-cell">
                  <img
                    class="player-avatar"
                    src={playerHeadshot(t.topPlayerId) || t.avatar || t.roster_meta?.team_avatar || t.roster_meta?.owner_avatar || avatarOrPlaceholder(null, t.topPlayerName)}
                    alt={t.topPlayerName}
                    on:error={(e) => onImgError(e, avatarOrPlaceholder(t.roster_meta?.team_avatar ?? t.roster_meta?.owner_avatar, t.topPlayerName))}
                  />
                  <div>
                    <div class="player-name">{t.topPlayerName ?? `Player ${t.topPlayerId ?? ''}`}</div>
                    <div class="small">Season: {t.season}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(t.points)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted" style="margin-bottom:12px;">
        Per-team single-season leader data is not available for this season.
      </div>
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
