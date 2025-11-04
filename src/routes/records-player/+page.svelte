<script>
  export let data;

  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);

  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // cross-season leaders from server
  const crossSeasonLeadersRaw = Array.isArray(data?.crossSeasonLeaders) ? data.crossSeasonLeaders : [];

  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? null;

  // teamLeaders for selected season (server-provided)
  $: teamLeaders = Array.isArray(selectedRow?.teamLeaders) ? selectedRow.teamLeaders.slice().sort((a,b) => (b.points || 0) - (a.points || 0)) : [];

  // cross-season sorted copy (defensive)
  $: crossSeasonLeaders = crossSeasonLeadersRaw.slice().sort((a,b) => (b.points || 0) - (a.points || 0));

  // helper to build player headshot URL (Sleeper CDN)
  function playerHeadshot(playerId, size = 56) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // fallback to initials via ui-avatars (same style used in honor-hall)
  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? (Array.isArray(name) ? name[0] : name[0]) : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=07101a&color=ffffff&size=${size}`;
  }

  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    // keep two decimals for points for better precision in leaderboards
    return (Math.round(n * 100) / 100).toFixed(n % 1 === 0 ? 0 : 2);
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
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
  .team-avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; border:1px solid rgba(255,255,255,0.03); }

  .player-name { font-weight:800; }
  .small { color:#9aa3ad; font-size:.92rem; }
  .debug { font-family:monospace; white-space:pre-wrap; font-size:.82rem; color:#9fb0c4; margin-top:.8rem; max-height:280px; overflow:auto; background: rgba(255,255,255,0.02); padding:10px; border-radius:8px; }
  .empty { color:#9aa3ad; padding:14px 0; }

  /* responsive tweaks */
  @media (max-width:720px) {
    .player-avatar, .team-avatar { width:44px; height:44px; }
    .player-name { font-size:0.95rem; }
  }
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
                  src={playerHeadshot(selectedRow.overallMvp.playerId) || selectedRow.overallMvp.playerAvatar || selectedRow.overallMvp.roster_meta?.team_avatar || avatarOrPlaceholder(selectedRow.overallMvp.roster_meta?.team_avatar, selectedRow.overallMvp.playerName)}
                  alt={selectedRow.overallMvp.playerName}
                  on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(selectedRow.overallMvp.roster_meta?.team_avatar ?? selectedRow.overallMvp.roster_meta?.owner_avatar, selectedRow.overallMvp.playerName); }}
                />
                <div>
                  <div class="player-name">{selectedRow.overallMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(selectedRow.overallMvp.points ?? selectedRow.overallMvp.total ?? 0)}</div>
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
                  src={playerHeadshot(selectedRow.finalsMvp.playerId) || selectedRow.finalsMvp.playerAvatar || selectedRow.finalsMvp.roster_meta?.team_avatar || avatarOrPlaceholder(selectedRow.finalsMvp.roster_meta?.team_avatar, selectedRow.finalsMvp.playerName)}
                  alt={selectedRow.finalsMvp.playerName}
                  on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(selectedRow.finalsMvp.roster_meta?.team_avatar ?? selectedRow.finalsMvp.roster_meta?.owner_avatar, selectedRow.finalsMvp.playerName); }}
                />
                <div>
                  <div class="player-name">{selectedRow.finalsMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(selectedRow.finalsMvp.points ?? 0)}</div>
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

    <!-- Team single-season leaders (for selected season) -->
    <h3 style="margin-top:18px; margin-bottom:8px;">Team single-season leaders (regular season) — {selectedRow ? selectedRow.season : 'selected'}</h3>
    {#if teamLeaders && teamLeaders.length}
      <table aria-label="Team single-season leaders">
        <thead>
          <tr>
            <th style="width:40%;">Team</th>
            <th style="width:40%;">Top player (season total)</th>
            <th style="width:20%;">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each teamLeaders as t (t.rosterId)}
            <tr>
              <td>
                <div style="display:flex;gap:.8rem;align-items:center;">
                  <img class="team-avatar" src={t.teamAvatar || t.roster_meta?.team_avatar || avatarOrPlaceholder(t.teamAvatar, t.owner_name)} alt={t.owner_name}
                    on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(t.teamAvatar || t.roster_meta?.team_avatar, t.owner_name); }} />
                  <div>
                    <div style="font-weight:800;">{t.owner_name ?? t.roster_name ?? `Roster ${t.rosterId}`}</div>
                    {#if t.roster_name}
                      <div class="small">{t.roster_name}</div>
                    {/if}
                  </div>
                </div>
              </td>

              <td>
                {#if t.topPlayerId || t.topPlayerName}
                  <div class="player-cell">
                    <img
                      class="player-avatar"
                      src={playerHeadshot(t.topPlayerId) || t.playerAvatar || avatarOrPlaceholder(t.teamAvatar, t.topPlayerName)}
                      alt={t.topPlayerName ?? `Player ${t.topPlayerId}`}
                      on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(t.playerAvatar || t.teamAvatar, t.topPlayerName || `Player ${t.topPlayerId}`); }}
                    />
                    <div>
                      <div class="player-name">{t.topPlayerName ?? `Player ${t.topPlayerId ?? ''}`}</div>
                      <div class="small">Top season</div>
                    </div>
                  </div>
                {:else}
                  <div class="empty">No player data for this team this season.</div>
                {/if}
              </td>

              <td style="font-weight:800;">{formatPts(t.points)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted" style="margin-bottom:12px;">
        Team single-season leader data is not available for this season.
      </div>
    {/if}

    <!-- Cross-season best single-season per roster -->
    <h3 style="margin-top:18px; margin-bottom:8px;">Cross-season best single-season per roster</h3>
    {#if crossSeasonLeaders && crossSeasonLeaders.length}
      <table aria-label="Cross-season bests">
        <thead>
          <tr>
            <th style="width:30%;">Team</th>
            <th style="width:40%;">Top player (best season)</th>
            <th style="width:15%;">Pts</th>
            <th style="width:15%;">Season</th>
          </tr>
        </thead>
        <tbody>
          {#each crossSeasonLeaders as c (c.rosterId)}
            <tr>
              <td>
                <div style="display:flex;gap:.8rem;align-items:center;">
                  <img class="team-avatar" src={c.teamAvatar || c.roster_meta?.team_avatar || avatarOrPlaceholder(c.teamAvatar, c.owner_name)} alt={c.owner_name}
                    on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(c.teamAvatar || null, c.owner_name); }} />
                  <div>
                    <div style="font-weight:800;">{c.owner_name ?? c.roster_name ?? `Roster ${c.rosterId}`}</div>
                    {#if c.roster_name}
                      <div class="small">{c.roster_name}</div>
                    {/if}
                  </div>
                </div>
              </td>

              <td>
                {#if c.topPlayerId || c.topPlayerName}
                  <div class="player-cell">
                    <img
                      class="player-avatar"
                      src={playerHeadshot(c.topPlayerId) || c.playerAvatar || avatarOrPlaceholder(c.teamAvatar, c.topPlayerName)}
                      alt={c.topPlayerName ?? `Player ${c.topPlayerId}`}
                      on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(c.playerAvatar || c.teamAvatar, c.topPlayerName || `Player ${c.topPlayerId}`); }}
                    />
                    <div>
                      <div class="player-name">{c.topPlayerName ?? `Player ${c.topPlayerId ?? ''}`}</div>
                      <div class="small">Best season for team</div>
                    </div>
                  </div>
                {:else}
                  <div class="empty">No player recorded for this roster.</div>
                {/if}
              </td>

              <td style="font-weight:800;">{formatPts(c.points)}</td>
              <td class="small">{c.season ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No cross-season leader data available.</div>
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
