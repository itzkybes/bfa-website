<!-- src/routes/honor-hall/+page.svelte -->
<script>
  export let data;

  // seasons list and current selection
  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);

  // payloads returned by server
  const finalStandingsBySeason = data?.finalStandingsBySeason ?? {};
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const globalDebug = Array.isArray(data?.debug) ? data.debug : [];

  // helper to submit the season select form
  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  // avatar fallback
  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  // emoji for top 3
  function placeEmoji(rank) {
    if (rank === 1) return '🏆';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  }

  // reactive: selected season payload (prefer the explicit map, fallback to top-level finalStandings)
  $: selectedPayload = (() => {
    if (!selectedSeason) return null;
    // try exact season string key first
    let key = String(selectedSeason);
    if (finalStandingsBySeason && finalStandingsBySeason[key]) return finalStandingsBySeason[key];
    // try matching by sessions where the key might be league id
    const keys = Object.keys(finalStandingsBySeason || {});
    for (const k of keys) {
      if (k === key) return finalStandingsBySeason[k];
    }
    // fallback to top-level finalStandings if present (older loader)
    if (data?.finalStandings) {
      return { finalStandings: data.finalStandings, debug: data.debug ?? [], rosterMap: data.rosterMap ?? {} };
    }
    return null;
  })();

  $: finalStandings = (selectedPayload && Array.isArray(selectedPayload.finalStandings)) ? selectedPayload.finalStandings : [];
  $: debugLog = (selectedPayload && Array.isArray(selectedPayload.debug)) ? selectedPayload.debug : (globalDebug || []);

  // champion and biggest loser derived from finalStandings
  $: champion = finalStandings.length ? finalStandings[0] : null;
  $: biggestLoser = finalStandings.length ? finalStandings[finalStandings.length - 1] : null;

  // ensure owner_name display is used when available, otherwise fallback to team_name
  function displayOwner(row) {
    return row?.owner_name ?? row?.team_name ?? row?.rosterId ?? 'Roster';
  }

  // show a friendly subtitle for the selected season
  $: seasonLabel = (() => {
    if (!selectedSeason) return '';
    // find season object for nicer labeling
    const found = seasons.find(s => String(s.season) === String(selectedSeason) || String(s.league_id) === String(selectedSeason));
    if (found) return found.season ?? found.name ?? found.league_id;
    return selectedSeason;
  })();
</script>

<style>
  :global(body) { background: var(--bg, #0b0c0f); color: #e6eef8; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
  .container { max-width: 1100px; margin: 0 auto; padding: 1.5rem; display: grid; grid-template-columns: 1fr 360px; gap: 1rem; }
  .header { grid-column: 1 / span 2; display:flex; justify-content:space-between; align-items:center; gap:1rem; }
  h1 { font-size: 1.85rem; margin:0; }
  .subtitle { color:#9aa3ad; margin-top:6px; font-size:.95rem; }

  /* filters */
  .filters { display:flex; align-items:center; gap:.75rem; }
  .season-label { color:#b9c3cc; font-weight:700; margin-right:.4rem; }
  select.season-select {
    background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
    border: 1px solid rgba(99,102,241,0.18);
    color: #fff;
    padding: 10px 14px;
    border-radius: 12px;
    font-weight: 700;
    min-width:140px;
    box-shadow: 0 6px 26px rgba(2,6,23,0.6);
    font-size: .95rem;
  }

  /* debug box */
  .debug { background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); padding:14px; border-radius:10px; margin-bottom:1rem; color:#cbd5e1; max-height:220px; overflow:auto; }
  .debug ul { margin:0; padding-left:18px; font-size:.95rem; }

  /* main / right layout */
  .main { background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); padding:14px; border-radius:10px; }
  .side { background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); padding:14px; border-radius:10px; height:fit-content; }

  /* final standings list */
  .standings-list { list-style:none; margin:0; padding:0; }
  .stand-row { display:flex; align-items:center; gap:12px; padding:12px 12px; border-bottom:1px solid rgba(255,255,255,0.02); }
  .rank { width:58px; font-weight:800; display:flex; align-items:center; gap:8px; color:#e6eef8; }
  .player { display:flex; align-items:center; gap:12px; min-width:0; }
  .avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; flex-shrink:0; }
  .teamName { font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:360px; }
  .teamMeta { color:#9aa3ad; font-size:.9rem; margin-top:3px; }

  .seedCol { margin-left:auto; color:#9aa3ad; font-weight:700; display:flex; align-items:center; gap:.5rem; }

  .outcome-row { display:flex; gap:12px; align-items:center; margin-bottom:12px; }
  .outcome-name { font-weight:700; }
  .small { color:#9aa3ad; font-size:.9rem; }

  .no-debug { color:#9aa3ad; padding: 12px 0; }

  @media (max-width: 980px) {
    .container { grid-template-columns: 1fr; }
    .side { order: 2; }
  }
</style>

<div class="container">
  <div class="header">
    <div>
      <h1>Honor Hall — Final Standings</h1>
      <div class="subtitle">Final placements computed from playoff results — season {seasonLabel}</div>
    </div>

    <form id="filters" method="get" class="filters" aria-hidden="false">
      <label class="season-label" for="season">Season</label>
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
    </form>
  </div>

  <div class="main">
    <div class="debug" aria-live="polite" role="status">
      <ul>
        {#if messages && messages.length}
          {#each messages as m}
            <li>{m}</li>
          {/each}
        {/if}
        {#if debugLog && debugLog.length}
          {#each debugLog as d}
            <li>{d}</li>
          {/each}
        {:else if (!messages || messages.length === 0)}
          <li class="no-debug">No debug trace available for this season.</li>
        {/if}
      </ul>
    </div>

    <h3 style="margin:0 0 12px 0">Final Standings</h3>
    <ul class="standings-list" role="list" aria-label="Final standings">
      {#if finalStandings && finalStandings.length}
        {#each finalStandings as row (row.rosterId)}
          <li class="stand-row" role="listitem">
            <div class="rank" aria-hidden="false">
              <span style="min-width:26px; text-align:center;">{row.rank}</span>
              <span>{placeEmoji(row.rank)}</span>
            </div>

            <div class="player" style="min-width:0;">
              <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt="team avatar">
              <div style="min-width:0;">
                <div class="teamName">{row.team_name}</div>
                <div class="teamMeta">{displayOwner(row)} {row.owner_name ? `• ${row.owner_name}` : ''}</div>
              </div>
            </div>

            <div class="seedCol" title="Seed">
              <span class="small">Seed</span>
              <strong>#{row.seed ?? '—'}</strong>
            </div>
          </li>
        {/each}
      {:else}
        <li class="no-debug">No final standings available for this season.</li>
      {/if}
    </ul>
  </div>

  <aside class="side" aria-labelledby="outcomes-title">
    <h3 id="outcomes-title" style="margin-top:0">Season outcomes</h3>

    {#if champion}
      <div class="outcome-row" title="Champion">
        <img class="avatar" src={avatarOrPlaceholder(champion.avatar, champion.team_name)} alt="champion avatar" style="width:72px;height:72px">
        <div>
          <div class="outcome-name">Champion <span style="margin-left:6px">🏆</span></div>
          <div class="small">{champion.team_name} {champion.owner_name ? `• ${champion.owner_name}` : ''} • Seed #{champion.seed ?? '—'}</div>
        </div>
      </div>
    {/if}

    {#if biggestLoser}
      <div style="margin-top:8px" class="outcome-row" title="Biggest Loser">
        <img class="avatar" src={avatarOrPlaceholder(biggestLoser.avatar, biggestLoser.team_name)} alt="biggest loser avatar" style="width:72px;height:72px">
        <div>
          <div class="outcome-name">Biggest loser <span style="margin-left:6px">😵‍💫</span></div>
          <div class="small">{biggestLoser.team_name} {biggestLoser.owner_name ? `• ${biggestLoser.owner_name}` : ''} • Seed #{biggestLoser.seed ?? '—'}</div>
        </div>
      </div>
    {/if}

    <div style="margin-top:12px; color:#9aa3ad; font-size:.9rem">
      Final standings are derived from server-scrubbed matchups and the bracket simulation logic. The debug trace above shows the decisions used to construct the bracket (matchups & tiebreaks).
    </div>
  </aside>
</div>
