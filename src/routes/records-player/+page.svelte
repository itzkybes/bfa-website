<!-- src/routes/records-player/+page.svelte -->
<script>
  import { onMount } from 'svelte';

  export let data;

  // seasons list and selection
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  // server-provided selectedSeason or fallback to latest season id
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);

  // server-provided seasons results (each entry should include .season and ideally .teamLeaders precomputed)
  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // pick the selected row from seasonsResults; if missing fallback to most-recent entry
  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? (seasonsResults.length ? seasonsResults[seasonsResults.length - 1] : null);

  // Sleeper CDN headshot helper (NBA)
  function playerHeadshot(playerId, size = 56) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // initials avatar fallback (same style as honor-hall)
  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name.split(' ').map(n=>n[0]||'').slice(0,2).join('') : 'P';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=07101a&color=ffffff&size=${size}`;
  }

  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    // show one decimal if fractional, otherwise integer
    return (Math.round(n * 10) / 10).toFixed(n % 1 === 0 ? 0 : 1);
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function onImgError(e, fallback) {
    try { e.currentTarget.src = fallback; } catch(_) {}
  }

  // --- Team leaders: prefer server-provided selectedRow.teamLeaders.
  // If absent, fallback to empty list (client computation previously existed, but server-side is preferred).
  $: perTeamLeaders = (selectedRow && Array.isArray(selectedRow.teamLeaders) && selectedRow.teamLeaders.length)
    ? // normalize each leader object to common fields and sort by points desc
      selectedRow.teamLeaders.map(t => ({
        rosterId: String(t.rosterId ?? t.roster_id ?? t.roster ?? ''),
        owner_name: t.owner_name ?? t.roster_name ?? t.team_name ?? t.owner ?? null,
        roster_name: t.roster_name ?? t.team_name ?? t.owner_name ?? null,
        topPlayerId: t.topPlayerId ?? t.playerId ?? t.top_player_id ?? t.player_id ?? null,
        topPlayerName: t.topPlayerName ?? t.playerName ?? t.player_name ?? null,
        points: Number(t.points ?? t.pts ?? t.pf ?? 0) || 0,
        // team avatar preferred from server object, else fallback to roster_meta / owner avatar if present
        teamAvatar: t.team_avatar ?? t.team_avatar_url ?? (t.roster_meta && (t.roster_meta.team_avatar ?? t.roster_meta.owner_avatar)) ?? null,
        playerAvatar: t.playerAvatar ?? t.topPlayerAvatar ?? null
      })).sort((a,b) => (b.points || 0) - (a.points || 0))
    : [];

  // Provide graceful UI when no teamLeaders provided by server
  // (we avoid heavy client-side aggregation here since you asked server to compute it)
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
  .two-col { display:grid; grid-template-columns: 1fr 1fr; gap:18px; }
  @media (max-width: 820px) { .two-col { grid-template-columns: 1fr; } }
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

        <!-- bind the select to selectedSeason so UI updates properly; on change we submit the form -->
        <select id="season-select" name="season" class="select" bind:value={selectedSeason} on:change={submitFilters} aria-label="Select season">
          {#each seasons as s}
            <option value={s.season ?? s.league_id}>
              {s.season ?? s.name ?? s.league_id}
            </option>
          {/each}
        </select>
      </form>
    </div>

    <div class="two-col" style="margin-top:12px;">
      <!-- MVP table (no season column) -->
      <div>
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
                      src={playerHeadshot(selectedRow.overallMvp.playerId) || selectedRow.overallMvp.playerAvatar || selectedRow.overallMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, selectedRow.overallMvp.playerName)}
                      alt={selectedRow.overallMvp.playerName}
                      on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(selectedRow.overallMvp.roster_meta?.team_avatar ?? selectedRow.overallMvp.roster_meta?.owner_avatar, selectedRow.overallMvp.playerName); }}
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
                      src={playerHeadshot(selectedRow.finalsMvp.playerId) || selectedRow.finalsMvp.playerAvatar || selectedRow.finalsMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, selectedRow.finalsMvp.playerName)}
                      alt={selectedRow.finalsMvp.playerName}
                      on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(selectedRow.finalsMvp.roster_meta?.team_avatar ?? selectedRow.finalsMvp.roster_meta?.owner_avatar, selectedRow.finalsMvp.playerName); }}
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
      </div>

      <!-- Team single-season leaders -->
      <div>
        <h3 style="margin:0 0 8px 0;">Team single-season leaders (regular season)</h3>

        {#if perTeamLeaders && perTeamLeaders.length}
          <table aria-label="Team single-season leaders">
            <thead>
              <tr>
                <th style="width:40%;">Team (owner)</th>
                <th style="width:40%;">Top player (season total)</th>
                <th style="width:20%;">Pts</th>
              </tr>
            </thead>
            <tbody>
              {#each perTeamLeaders as t (t.rosterId)}
                <tr>
                  <td>
                    <div class="player-cell">
                      <img
                        class="team-avatar"
                        src={t.teamAvatar || t.roster_meta?.team_avatar || avatarOrPlaceholder(null, t.owner_name || t.roster_name)}
                        alt={t.owner_name || t.roster_name}
                        on:error={(e) => onImgError(e, avatarOrPlaceholder(null, t.owner_name || t.roster_name))}
                      />
                      <div>
                        <div style="font-weight:800;">{t.owner_name ?? t.roster_name ?? `Roster ${t.rosterId}`}</div>
                        <div class="small">{/* optional subtitle */}</div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <div class="player-cell">
                      <img
                        class="player-avatar"
                        src={playerHeadshot(t.topPlayerId) || t.playerAvatar || avatarOrPlaceholder(null, t.topPlayerName)}
                        alt={t.topPlayerName}
                        on:error={(e) => onImgError(e, avatarOrPlaceholder(null, t.topPlayerName))}
                      />
                      <div>
                        <div class="player-name">{t.topPlayerName ?? `Player ${t.topPlayerId ?? ''}`}</div>
                      </div>
                    </div>
                  </td>

                  <td style="font-weight:800;">{formatPts(t.points)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="muted" style="margin-top:8px;">
            Per-team single-season leader data not available. Please have the server include <code>teamLeaders</code> inside each season entry (recommended),
            or include a normalized <code>fullSeasonMatchupsRows</code> so we can compute client-side (server-side is preferred).
          </div>
        {/if}
      </div>
    </div>

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
