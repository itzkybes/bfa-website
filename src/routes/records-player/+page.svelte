<script>
  // Player MVPs table (by season)
  export let data;

  // seasons from server: [{ league_id, season, name }, ...]
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];

  // server can provide either a mapping (mvpBySeason) or an array (mvpList)
  const mvpBySeason = data?.mvpBySeason ?? {};
  const mvpList = Array.isArray(data?.mvpList) ? data.mvpList : [];

  // selected season (try server-specified selectedSeason then fallback to latest numeric season)
  let selectedSeason = (() => {
    const ds = data?.selectedSeason ? String(data.selectedSeason) : null;
    if (ds) {
      const matches = seasons.some(s => (s.season != null && String(s.season) === ds) || String(s.league_id) === ds);
      if (matches) return ds;
    }
    // pick latest numeric season if available
    const numericSeasons = seasons.filter(s => s.season != null);
    if (numericSeasons.length) return String(numericSeasons[numericSeasons.length - 1].season);
    if (seasons.length) return String(seasons[seasons.length - 1].league_id);
    return null;
  })();

  // reactive computed selected key and selected object
  $: selectedKey = String(selectedSeason ?? '');
  $: selectedEntry =
    (mvpBySeason && mvpBySeason[selectedKey]) ?
      mvpBySeason[selectedKey] :
      (mvpList.find(x => String(x.season) === selectedKey || String(x.leagueId) === selectedKey) || null);

  // extract mvp objects (may be null)
  $: finalsMvp = selectedEntry?.finalsMvp ?? null;
  $: overallMvp = selectedEntry?.overallMvp ?? null;

  // helper - submit form on change
  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  // player headshot helper (Sleeper NBA CDN); keep client lazy so page can load even if server didn't fetch players
  function playerHeadshot(playerId) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  // Labels for select
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

  /* copy select style from Standings page for consistency */
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

  @media (max-width: 720px) {
    .controls { flex-direction:column; align-items:stretch; gap:.6rem; }
    .avatar { width:56px; height:56px; }
    .mvp-table th, .mvp-table td { padding:8px; }
  }
</style>

<div class="page">
  <h1>Player MVPs</h1>

  <div class="controls">
    <form id="filters" method="get" style="display:flex; gap:.5rem; align-items:center;">
      <label for="season" class="small-muted" aria-hidden="true">Season</label>
      <select id="season" name="season" class="select" bind:value={selectedSeason} on:change={submitFilters}>
        {#if seasons && seasons.length}
          {#each seasons.filter(s => s.season != null) as s}
            <option value={s.season} selected={String(s.season) === String(selectedSeason)}>{seasonLabel(s)}</option>
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
            {#if finalsMvp}
              <div class="mvp-row">
                <img class="avatar" src={playerHeadshot(finalsMvp.playerId) || avatarOrPlaceholder(finalsMvp.roster_meta?.owner_avatar, finalsMvp.playerName)} alt={finalsMvp.playerName ?? 'Finals MVP'} on:error={(e)=>e.currentTarget.src=avatarOrPlaceholder(finalsMvp.roster_meta?.owner_avatar, finalsMvp.playerName)} />
                <div style="min-width:0;">
                  <div class="player-name">{finalsMvp.playerName ?? finalsMvp.playerObj?.full_name ?? `Player ${finalsMvp.playerId ?? '—'}`}</div>
                  <div class="player-meta">
                    {finalsMvp.roster_meta?.owner_name ? `${finalsMvp.roster_meta.owner_name}` : (finalsMvp.rosterId ? `Roster ${finalsMvp.rosterId}` : 'Roster: —')}
                    {#if finalsMvp.points != null}
                      &nbsp;•&nbsp; {formatPts(finalsMvp.points)} pts
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
            {#if overallMvp}
              <div class="mvp-row">
                <img class="avatar" src={playerHeadshot(overallMvp.playerId || overallMvp.topPlayerId) || avatarOrPlaceholder(overallMvp.roster_meta?.owner_avatar, overallMvp.playerName)} alt={overallMvp.playerName ?? 'Overall MVP'} on:error={(e)=>e.currentTarget.src=avatarOrPlaceholder(overallMvp.roster_meta?.owner_avatar, overallMvp.playerName)} />
                <div style="min-width:0;">
                  <div class="player-name">{overallMvp.playerName ?? overallMvp.playerObj?.full_name ?? `Player ${overallMvp.playerId ?? overallMvp.topPlayerId ?? '—'}`}</div>
                  <div class="player-meta">
                    {overallMvp.roster_meta?.owner_name ? `${overallMvp.roster_meta.owner_name}` : (overallMvp.rosterId || overallMvp.topRosterId ? `Roster ${overallMvp.rosterId ?? overallMvp.topRosterId}` : 'Roster: —')}
                    {#if overallMvp.points != null}
                      &nbsp;•&nbsp; {formatPts(overallMvp.points ?? overallMvp.total ?? overallMvp.score)} pts
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
