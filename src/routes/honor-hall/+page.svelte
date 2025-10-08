<!-- src/routes/honor-hall/+page.svelte -->
<script>
  export let data;

  // seasons list and selection
  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  // finalStandingsBySeason mapping returned by server
  const finalStandingsBySeason = data?.finalStandingsBySeason ?? {};
  // top-level fallbacks
  const finalStandingsFallback = Array.isArray(data?.finalStandings) ? data.finalStandings : [];

  // pick the season result
  $: selectedSeasonKey = String(selectedSeason);
  $: selectedSeasonResult = finalStandingsBySeason[selectedSeasonKey] ?? { finalStandings: finalStandingsFallback, debug: data?.debug ?? [] };
  $: finalStandings = Array.isArray(selectedSeasonResult.finalStandings) ? selectedSeasonResult.finalStandings : [];
  $: debugLines = Array.isArray(selectedSeasonResult.debug) ? selectedSeasonResult.debug : [];

  // also expose MVPs from top-level (computed for the selected league/season by server)
  const finalsMvp = data?.finalsMvp ?? null;
  const overallMvp = data?.overallMvp ?? null;

  // computed champion/biggest loser from finalStandings
  $: champion = finalStandings && finalStandings.length ? finalStandings[0] : null;
  $: biggestLoser = finalStandings && finalStandings.length ? finalStandings[finalStandings.length - 1] : null;

  // messages & other
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function placeEmoji(rank) {
    if (rank === 1) return '🏆';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  }

  // Filter debug lines: remove seed reassignment traces
  function filteredDebug(lines) {
    if (!Array.isArray(lines)) return [];
    return lines.filter(l => {
      if (!l) return false;
      const s = String(l);
      if (s.startsWith('Assign place')) return false;
      if (s.startsWith('Fallback assign')) return false;
      if (s.includes('Assign place ')) return false;
      if (s.includes('Fallback assign')) return false;
      // keep everything else
      return true;
    });
  }

  $: visibleDebug = filteredDebug(debugLines);
</script>

<style>
  /* Keep host page background but use light text so header/nav remains visible on dark backgrounds */
  :global(body) { color: #e6eef8; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }

  /* Container centers content */
  .container {
    max-width: 1180px;
    margin: 24px auto;
    padding: 20px;
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: 20px;
    align-items: start;
  }

  .header { grid-column: 1 / span 2; display:flex; justify-content:space-between; align-items:center; gap:12px; }
  h1 { font-size: 1.6rem; margin:0; color: #e6eef8; }
  .subtitle { color: rgba(230,238,248,0.6); margin-top:6px; font-size:.95rem; }

  /* translucent dark cards (no bright white) */
  .main, .side {
    background: rgba(6,8,12,0.65);
    border-radius: 12px;
    padding: 16px;
    border: 1px solid rgba(255,255,255,0.04);
    box-shadow: 0 10px 30px rgba(2,6,23,0.6);
    backdrop-filter: blur(6px);
    color: inherit;
  }

  /* filters */
  .filters { display:flex; align-items:center; gap:.75rem; }
  .season-label { color: #cbd5e1; font-weight:700; margin-right:.4rem; }
  select.season-select {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    color: #e6eef8;
    padding: 8px 12px;
    border-radius: 10px;
    font-weight: 700;
    min-width:140px;
    box-shadow: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
  }
  .select-wrap { position: relative; display:inline-block; }
  .select-wrap::after {
    content: "▾";
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: #9aa3ad;
    font-size: 0.9rem;
  }
  select.season-select option { background: rgba(6,8,12,0.85); color: #e6eef8; }

  /* debug box */
  .debug { background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); padding:12px; border-radius:10px; margin-bottom:12px; color:#cbd5e1; max-height:260px; overflow:auto; }
  .debug ul { margin:0; padding-left:18px; }

  /* final standings list */
  .standings-list { list-style:none; margin:0; padding:0; }
  .stand-row { display:flex; align-items:center; gap:14px; padding:12px; border-bottom:1px solid rgba(255,255,255,0.03); }
  .rank { width:56px; font-weight:800; display:flex; align-items:center; gap:8px; color:#e6eef8; justify-content:flex-start; }
  .player { display:flex; align-items:center; gap:12px; min-width:0; }
  .avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; flex-shrink:0; border:1px solid rgba(255,255,255,0.04); }
  .teamName { font-weight:800; color:#e6eef8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:420px; }
  .teamMeta { color: #9aa3ad; font-size:.9rem; margin-top:4px; }
  .seedCol { margin-left:auto; color:#9aa3ad; font-weight:700; min-width:56px; text-align:right; }

  .outcome-row { display:flex; gap:12px; align-items:center; margin-bottom:12px; }
  .outcome-name { font-weight:700; color:#e6eef8; }
  .small { color:#9aa3ad; font-size:.9rem; }

  .no-debug { color:#9aa3ad; }

  @media (max-width: 980px) {
    .container { grid-template-columns: 1fr; padding:12px; }
    .side { order: 2; }
  }
</style>

<div class="container">
  <div class="header">
    <div>
      <h1>Honors Hall</h1>
      <div class="subtitle">Final placements computed from playoff results — season {selectedSeason}</div>
    </div>

    <form id="filters" method="get" class="filters" aria-hidden="false">
      <label class="season-label" for="season">Season</label>
      <div class="select-wrap">
        <select id="season" name="season" class="season-select" on:change={submitFilters}>
          {#if seasons && seasons.length}
            {#each seasons as s}
              <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeason)}>
                {s.season ?? s.name ?? s.league_id}
              </option>
            {/each}
          {:else}
            <option value={selectedSeason}>{selectedSeason}</option>
          {/if}
        </select>
      </div>
    </form>
  </div>

  <div class="main">
    <div class="debug" aria-live="polite">
      <ul>
        {#if visibleDebug && visibleDebug.length}
          {#each visibleDebug as d}
            <li>{@html d.replace(/</g,'&lt;')}</li>
          {/each}
        {:else}
          <li>No debug trace available.</li>
        {/if}
      </ul>
    </div>

    <h3 style="margin:0 0 12px 0">Final Standings</h3>
    <ul class="standings-list" role="list" aria-label="Final standings">
      {#if finalStandings && finalStandings.length}
        {#each finalStandings as row (row.rosterId)}
          <li class="stand-row" role="listitem">
            <div class="rank" aria-hidden="true">
              <span>{row.rank}</span>
              <span>{placeEmoji(row.rank)}</span>
            </div>

            <div class="player" style="min-width:0;">
              <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt="team avatar">
              <div style="min-width:0;">
                <div class="teamName">{row.team_name}</div>
                <div class="teamMeta">
                  {#if row.owner_name}
                    {row.owner_name}
                  {:else}
                    {`Roster ${row.rosterId}`}
                  {/if}
                </div>
              </div>
            </div>

            <div class="seedCol">Seed #{row.seed ?? '—'}</div>
          </li>
        {/each}
      {:else}
        <li class="no-debug">No final standings available.</li>
      {/if}
    </ul>
  </div>

  <aside class="side" aria-labelledby="outcomes-title">
    <h3 id="outcomes-title" style="margin-top:0">Season outcomes</h3>

    {#if champion}
      <div class="outcome-row">
        <img class="avatar" src={avatarOrPlaceholder(champion.avatar, champion.team_name)} alt="champion avatar" style="width:64px;height:64px">
        <div>
          <div class="outcome-name">Champion <span style="margin-left:6px">🏆</span></div>
          <div class="small">{champion.team_name} • {champion.owner_name ?? `Roster ${champion.rosterId}`} • Seed #{champion.seed}</div>
        </div>
      </div>
    {/if}

    {#if biggestLoser}
      <div style="margin-top:8px" class="outcome-row">
        <img class="avatar" src={avatarOrPlaceholder(biggestLoser.avatar, biggestLoser.team_name)} alt="biggest loser avatar" style="width:64px;height:64px">
        <div>
          <div class="outcome-name">Biggest loser <span style="margin-left:6px">😵‍💫</span></div>
          <div class="small">{biggestLoser.team_name} • {biggestLoser.owner_name ?? `Roster ${biggestLoser.rosterId}`} • Seed #{biggestLoser.seed}</div>
        </div>
      </div>
    {/if}


    {#if finalsMvp}
      <div style="margin-top:12px" class="outcome-row">
        <img class="avatar" src={finalsMvp.playerObj?.avatar || avatarOrPlaceholder(finalsMvp.playerObj?.avatar, finalsMvp.playerName)} alt="finals mvp avatar" style="width:56px;height:56px">
        <div>
          <div class="outcome-name">Finals MVP</div>
          <div class="small">
            {finalsMvp.playerName ?? `Player ${finalsMvp.playerId}`}<br>
            {finalsMvp.playerTeam ? `Team: ${finalsMvp.playerTeam}` : ''}
            <br>{finalsMvp.points} pts
            <br>Started by: {finalsMvp.ownerName ?? finalsMvp.rosterName ?? `Roster ${finalsMvp.rosterId}`}
          </div>
        </div>
      </div>
    {/if}

    {#if overallMvp}
      <div style="margin-top:12px" class="outcome-row">
        <img class="avatar" src={overallMvp.playerObj?.avatar || avatarOrPlaceholder(overallMvp.playerObj?.avatar, overallMvp.playerName)} alt="overall mvp avatar" style="width:56px;height:56px">
        <div>
          <div class="outcome-name">Overall MVP</div>
          <div class="small">
            {overallMvp.playerName ?? `Player ${overallMvp.playerId}`}<br>
            {overallMvp.playerTeam ? `Team: ${overallMvp.playerTeam}` : ''}
            <br>{overallMvp.points} pts
            <br>Most points for: {overallMvp.topOwnerName ?? overallMvp.topRosterName ?? `Roster ${overallMvp.topRosterId}`}
          </div>
        </div>
      </div>
    {/if}

    <div style="margin-top:12px; color:#9aa3ad; font-size:.9rem">
      Final standings are derived from server-scrubbed matchups and the bracket simulation logic. The debug trace above shows the decisions used to construct the bracket (matchups & tiebreaks).
    </div>
  </aside>
</div>
