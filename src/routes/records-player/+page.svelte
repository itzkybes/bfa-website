<!-- src/routes/records-player/+page.svelte -->
<script>
  export let data;

  // seasons list and selection (dropdown only for selecting MVPs)
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  // per-season results (server includes teamLeaders per-season)
  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];

  // server-provided cross-season & playoff all-time aggregates
  let crossSeasonLeaders = Array.isArray(data?.crossSeasonLeaders) ? data.crossSeasonLeaders.slice() : [];
  let playoffAllTimeLeaders = Array.isArray(data?.playoffAllTimeLeaders) ? data.playoffAllTimeLeaders.slice() : [];

  // ensure defensive sorting (server should already have sorted desc)
  crossSeasonLeaders.sort((a,b) => (Number(b.totalPoints||0) - Number(a.totalPoints||0)));
  playoffAllTimeLeaders.sort((a,b) => (Number(b.playoffPoints||0) - Number(a.playoffPoints||0)));

  // pick the season result to display MVPs for (dropdown only)
  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? null;
  $: finalsMvp = selectedRow?.finalsMvp ?? null;
  $: overallMvp = selectedRow?.overallMvp ?? null;

  // Sleeper CDN headshot helper (same as honor-hall)
  function playerHeadshot(playerId, size = 56) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // avatar fallback to initials (honor-hall style)
  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name.split(' ').map(n => n[0]||'').slice(0,2).join('') : 'P';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=07101a&color=ffffff&size=${size}`;
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
  .player-avatar, .team-avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; border:1px solid rgba(255,255,255,0.03); }
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
        <div class="muted" style="margin-bottom:6px;">Dropdown selects which season’s Overall & Finals MVP to display. Team leader tables are cross-season / playoff-all-time and are computed server-side.</div>
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
                  {:else if overallMvp.topRosterId}
                    <div class="small">Top roster: Roster {overallMvp.topRosterId}</div>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="empty">No overall MVP determined for this season.</div>
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
                  {:else if finalsMvp.topRosterId}
                    <div class="small">Roster: Roster {finalsMvp.topRosterId}</div>
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

    <!-- Playoff all-time leaders (best playoff single-season per roster across seasons) -->
    <h3 style="margin-top:18px; margin-bottom:8px;">Playoff — best single-season performance per team (all time)</h3>
    {#if playoffAllTimeLeaders && playoffAllTimeLeaders.length}
      <table aria-label="Playoff best single-season per roster">
        <thead>
          <tr>
            <th style="width:30%;">Team</th>
            <th style="width:40%;">Top player (playoff pts)</th>
            <th style="width:15%;">Pts</th>
            <th style="width:15%;">Season</th>
          </tr>
        </thead>
        <tbody>
          {#each playoffAllTimeLeaders as t (t.rosterId)}
            <tr>
              <td>
                <div style="display:flex; align-items:center; gap:.8rem;">
                  <img class="team-avatar" src={t.teamAvatar || (t.roster_meta?.team_avatar ?? null) || avatarOrPlaceholder(null, t.roster_name || t.owner_name)} alt={t.roster_name ?? t.owner_name}
                    on:error={(e) => onImgError(e, avatarOrPlaceholder(null, t.roster_name || t.owner_name))}
                  />
                  <div>
                    <div style="font-weight:800;">{t.roster_name ?? t.owner_name}</div>
                    <div class="small">{t.owner_name}</div>
                  </div>
                </div>
              </td>

              <td>
                <div class="player-cell">
                  <img
                    class="player-avatar"
                    src={playerHeadshot(t.topPlayerId) || t.playerAvatar || avatarOrPlaceholder(null, t.topPlayerName)}
                    alt={t.topPlayerName}
                    on:error={(e) => onImgError(e, avatarOrPlaceholder(t.teamAvatar || (t.roster_meta?.team_avatar ?? null), t.topPlayerName))}
                  />
                  <div>
                    <div class="player-name">{t.topPlayerName ?? `Player ${t.topPlayerId ?? ''}`}</div>
                    <div class="small">Team: {t.roster_name ?? t.owner_name}</div>
                  </div>
                </div>
              </td>

              <td style="font-weight:800;">{formatPts(t.playoffPoints)}</td>
              <td>{t.season ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">Playoff all-time leaders are not available.</div>
    {/if}

    <!-- Cross-season best single-season per roster (regular+playoff totals) -->
    <h3 style="margin-top:18px; margin-bottom:8px;">Cross-season — best single-season per team (regular + playoffs)</h3>
    {#if crossSeasonLeaders && crossSeasonLeaders.length}
      <table aria-label="Cross-season best single-season per roster">
        <thead>
          <tr>
            <th style="width:30%;">Team</th>
            <th style="width:40%;">Top player (season)</th>
            <th style="width:15%;">Pts</th>
            <th style="width:15%;">Season</th>
          </tr>
        </thead>
        <tbody>
          {#each crossSeasonLeaders as t (t.rosterId)}
            <tr>
              <td>
                <div style="display:flex; align-items:center; gap:.8rem;">
                  <img class="team-avatar" src={t.teamAvatar || (t.roster_meta?.team_avatar ?? null) || avatarOrPlaceholder(null, t.roster_name || t.owner_name)} alt={t.roster_name ?? t.owner_name}
                    on:error={(e) => onImgError(e, avatarOrPlaceholder(null, t.roster_name || t.owner_name))}
                  />
                  <div>
                    <div style="font-weight:800;">{t.roster_name ?? t.owner_name}</div>
                    <div class="small">{t.owner_name}</div>
                  </div>
                </div>
              </td>

              <td>
                <div class="player-cell">
                  <img
                    class="player-avatar"
                    src={playerHeadshot(t.topPlayerId) || t.playerAvatar || avatarOrPlaceholder(null, t.topPlayerName)}
                    alt={t.topPlayerName}
                    on:error={(e) => onImgError(e, avatarOrPlaceholder(t.teamAvatar || (t.roster_meta?.team_avatar ?? null), t.topPlayerName))}
                  />
                  <div>
                    <div class="player-name">{t.topPlayerName ?? `Player ${t.topPlayerId ?? ''}`}</div>
                    <div class="small">Regular: {formatPts(t.regularPoints)} • Playoffs: {formatPts(t.playoffPoints)}</div>
                  </div>
                </div>
              </td>

              <td style="font-weight:800;">{formatPts(t.totalPoints)}</td>
              <td>{t.season ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">Cross-season leader data is not available.</div>
    {/if}

    <!-- messages / debug -->
    {#if Array.isArray(data?.messages) && data.messages.length}
      <div class="muted" style="margin-top:12px;">Messages / Debug:</div>
      <div class="debug" aria-live="polite">
        {#each data.messages as m}
          {m}
          {'\n'}
        {/each}
      </div>
    {/if}
  </div>
</div>
