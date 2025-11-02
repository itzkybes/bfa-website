<!-- src/routes/records-player/+page.svelte -->
<script>
  export let data;

  // seasons + results (server provides seasonsResults)
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];

  // messages & jsonLinks (server-side diagnostics)
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];

  // Determine latest season year (only include seasons with numeric season)
  const numericSeasons = seasons.filter(s => s.season != null);
  const latestSeasonDefault = numericSeasons.length
    ? String(numericSeasons[numericSeasons.length - 1].season)
    : (seasons.length ? String(seasons[seasons.length - 1].league_id) : 'all');

  // prefer server-provided selection if valid, else pick latest
  let selectedSeasonId = (() => {
    const ds = data && data.selectedSeason ? String(data.selectedSeason) : null;
    if (ds) {
      const matches = seasons.some(s => (s.season != null && String(s.season) === ds) || String(s.league_id) === ds);
      if (matches) return ds;
    }
    return latestSeasonDefault;
  })();

  function submitForm() {
    const form = document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function playerHeadshot(pid, size = 56) {
    if (!pid) return '';
    return `https://sleepercdn.com/content/nba/players/${pid}.jpg`;
  }

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function formatPts(v) {
    const n = Number(v ?? 0);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  // displayedResults: filter seasonsResults by selectedSeasonId
  // match by sr.season or sr.leagueId (some server objects may use leagueId)
  $: displayedResults = Array.isArray(seasonsResults)
    ? seasonsResults.filter(sr => {
        // allow 'all' to pass through everything
        if (!selectedSeasonId || String(selectedSeasonId) === 'all') return true;
        if (sr == null) return false;
        if (typeof sr.season !== 'undefined' && sr.season !== null && String(sr.season) === String(selectedSeasonId)) return true;
        if (typeof sr.leagueId !== 'undefined' && String(sr.leagueId) === String(selectedSeasonId)) return true;
        // some server payloads put top-level season as selectedSeason (string) — attempt to match that too
        if (sr.selectedSeason && String(sr.selectedSeason) === String(selectedSeasonId)) return true;
        return false;
      })
    : [];

  // optionally sort displayedResults by season desc (so latest first)
  $: displayedResults.sort((a,b) => {
    const sa = a?.season ?? a?.leagueId ?? '';
    const sb = b?.season ?? b?.leagueId ?? '';
    const na = Number(sa);
    const nb = Number(sb);
    if (!isNaN(na) && !isNaN(nb)) return nb - na;
    if (sa < sb) return 1;
    if (sa > sb) return -1;
    return 0;
  });
</script>

<style>
  :global(body) {
    --card-bg: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    --card-border: rgba(255,255,255,0.04);
    --muted: #9ca3af;
    --text: #e6eef8;
    color-scheme: dark;
  }

  .page {
    max-width: 1100px;
    margin: 1.5rem auto;
    padding: 0 1rem;
  }

  h1 { margin:0 0 1rem 0; font-size:1.4rem; }

  .messages {
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    border: 1px solid rgba(255,255,255,0.03);
    border-radius: 10px;
    padding: 14px;
    color: var(--muted);
    margin-bottom: 1rem;
  }
  .messages ul { margin:0; padding-left:18px; }

  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
  }

  .controls {
    display:flex;
    gap:.75rem;
    align-items:center;
    justify-content:space-between;
    margin-bottom: .75rem;
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

  table { width:100%; border-collapse:collapse; margin-top:.5rem; }
  thead th { text-align:left; padding:12px; font-size:.9rem; color:var(--muted); text-transform:uppercase; border-bottom:1px solid var(--card-border); }
  tbody td { padding:12px; border-bottom:1px solid var(--card-border); color:var(--text); vertical-align:middle; }

  .mvp-row { display:flex; gap:12px; align-items:center; }
  .mvp-avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; border:1px solid rgba(255,255,255,0.03); flex-shrink:0; background:#07101a; }
  .mvp-name { font-weight:800; }
  .mvp-meta { color: var(--muted); font-size:0.9rem; margin-top:4px; }

  .season-col { width:100px; text-align:left; font-weight:700; color:var(--text); }

  @media (max-width:900px) {
    .controls { flex-direction:column; align-items:stretch; gap:.5rem; }
    .select { width:100%; min-width:0; }
    thead { display:none; }
    tbody { display:block; }
    tbody tr { display:block; margin-bottom:12px; border-radius:10px; background: rgba(255,255,255,0.006); border:1px solid var(--card-border); padding:10px; }
    tbody td { display:block; padding:6px 0; border-bottom:none; }
    .season-col { text-align:left; padding-bottom:6px; }
  }
</style>

<div class="page">
  <h1>Player Records</h1>

  {#if messages && messages.length}
    <div class="messages" role="region" aria-live="polite">
      <strong>Messages</strong>
      <ul>
        {#each messages as m, i}
          <li>{i + 1}. {m}</li>
        {/each}
      </ul>

      {#if jsonLinks && jsonLinks.length}
        <div style="margin-top:.75rem; font-weight:700; color:inherit">Loaded JSON files:</div>
        <ul style="margin-top:.35rem; padding-left:18px;">
          {#each jsonLinks as jl}
            <li>
              {#if typeof jl === 'string'}
                <a href={jl} target="_blank" rel="noopener noreferrer">{jl}</a>
              {:else}
                <a href={jl.url} target="_blank" rel="noopener noreferrer">{jl.title ?? jl.url}</a>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <div class="card" role="region" aria-labelledby="mvps-title">
    <div class="controls">
      <div>
        <div id="mvps-title" style="font-weight:800; margin-bottom:4px;">Season MVPs</div>
        <div style="color:var(--muted); font-size:.95rem;">Overall MVP = season-long starters points. Finals MVP = championship game performance.</div>
      </div>

      <form id="filters" method="get" style="display:flex; gap:.5rem; align-items:center;">
        <label for="season-select" style="color:var(--muted); font-weight:700; margin-right:.4rem;">Season</label>
        <select id="season-select" name="season" class="select" bind:value={selectedSeasonId} on:change={submitForm}>
          <option value="all" selected={String(selectedSeasonId) === 'all'}>All</option>
          {#each seasons.filter(s => s.season != null) as s}
            <option value={s.season} selected={String(selectedSeasonId) === String(s.season)}>{s.season}</option>
          {/each}
        </select>
      </form>
    </div>

    <table aria-label="Season MVPs">
      <thead>
        <tr>
          <th>Season</th>
          <th>Finals MVP</th>
          <th>Overall MVP</th>
        </tr>
      </thead>

      <tbody>
        {#if displayedResults && displayedResults.length}
          {#each displayedResults as sr}
            <tr>
              <td class="season-col">{sr.season ?? sr.leagueId ?? '-'}</td>

              <td>
                {#if sr.finalsMvp}
                  <div class="mvp-row">
                    <img class="mvp-avatar" src={playerHeadshot(sr.finalsMvp.playerId) || avatarOrPlaceholder(sr.finalsMvp.roster_meta?.owner_avatar, sr.finalsMvp.playerName)} alt={sr.finalsMvp.playerName ?? 'Finals MVP'} on:error={(e)=> e.currentTarget.src = avatarOrPlaceholder(sr.finalsMvp.roster_meta?.owner_avatar, sr.finalsMvp.playerName)} />
                    <div>
                      <div class="mvp-name">{sr.finalsMvp.playerName ?? sr.finalsMvp.playerObj?.full_name ?? (`Player ${sr.finalsMvp.playerId ?? '—'}`)}</div>
                      <div class="mvp-meta">{formatPts(sr.finalsMvp.points ?? sr.finalsMvp.score ?? sr.finalsMvp.pts ?? 0)} pts • {sr.finalsMvp.week ?? sr.finalsMvp.championshipWeek ?? `Wk ${sr.playoffWeek ?? '-'}`}</div>
                    </div>
                  </div>
                {:else}
                  <div class="mvp-row">
                    <img class="mvp-avatar" src={avatarOrPlaceholder(null, '—')} alt="No finals mvp" />
                    <div>
                      <div class="mvp-name">—</div>
                      <div class="mvp-meta">No data</div>
                    </div>
                  </div>
                {/if}
              </td>

              <td>
                {#if sr.overallMvp}
                  <div class="mvp-row">
                    <img class="mvp-avatar" src={playerHeadshot(sr.overallMvp.playerId ?? sr.overallMvp.topPlayerId) || avatarOrPlaceholder(sr.overallMvp.roster_meta?.owner_avatar, sr.overallMvp.playerName)} alt={sr.overallMvp.playerName ?? 'Overall MVP'} on:error={(e)=> e.currentTarget.src = avatarOrPlaceholder(sr.overallMvp.roster_meta?.owner_avatar, sr.overallMvp.playerName)} />
                    <div>
                      <div class="mvp-name">{sr.overallMvp.playerName ?? sr.overallMvp.playerObj?.full_name ?? (`Player ${sr.overallMvp.playerId ?? sr.overallMvp.topPlayerId ?? '—'}`)}</div>
                      <div class="mvp-meta">{formatPts(sr.overallMvp.points ?? sr.overallMvp.total ?? sr.overallMvp.score ?? 0)} pts (season)</div>
                    </div>
                  </div>
                {:else}
                  <div class="mvp-row">
                    <img class="mvp-avatar" src={avatarOrPlaceholder(null, '—')} alt="No overall mvp" />
                    <div>
                      <div class="mvp-name">—</div>
                      <div class="mvp-meta">No data</div>
                    </div>
                  </div>
                {/if}
              </td>
            </tr>
          {/each}
        {:else}
          <tr>
            <td colspan="3" style="color:var(--muted); padding:14px;">No MVP data available for season {selectedSeasonId}.</td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
