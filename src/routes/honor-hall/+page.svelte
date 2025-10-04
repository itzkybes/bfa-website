<!-- src/routes/honor-hall/+page.svelte -->
<script>
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);

  // payload: finalStandingsBySeason is a map season -> { finalStandings, debug, rosterMap }
  const finalStandingsBySeason = data?.finalStandingsBySeason ?? {};
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const globalDebug = Array.isArray(data?.debug) ? data.debug : [];

  // MVPs (top-level fields for convenience)
  const finalsMvp = data?.finalsMvp ?? null;
  const overallMvp = data?.overallMvp ?? null;

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

  $: selectedPayload = (() => {
    if (!selectedSeason) return null;
    const key = String(selectedSeason);
    if (finalStandingsBySeason && finalStandingsBySeason[key]) return finalStandingsBySeason[key];
    // fallback to top-level data
    if (data?.finalStandings) return { finalStandings: data.finalStandings, debug: data.debug ?? [], rosterMap: data.rosterMap ?? {} };
    return null;
  })();

  $: finalStandings = (selectedPayload && Array.isArray(selectedPayload.finalStandings)) ? selectedPayload.finalStandings : [];
  $: debugLog = (selectedPayload && Array.isArray(selectedPayload.debug)) ? selectedPayload.debug : (globalDebug || []);

  $: champion = finalStandings.length ? finalStandings[0] : null;
  $: biggestLoser = finalStandings.length ? finalStandings[finalStandings.length - 1] : null;
</script>

<style>
  /* reuse your existing styles (I assume you've pasted them before) */
  :global(body) { background: var(--bg, #0b0c0f); color: #e6eef8; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
  .container { max-width: 1100px; margin: 0 auto; padding: 1.5rem; display: grid; grid-template-columns: 1fr 360px; gap: 1rem; }
  .header { grid-column: 1 / span 2; display:flex; justify-content:space-between; align-items:center; gap:1rem; }
  h1 { font-size: 1.85rem; margin:0; }
  .subtitle { color:#9aa3ad; margin-top:6px; font-size:.95rem; }

  .filters { display:flex; align-items:center; gap:.75rem; }
  .season-label { color:#b9c3cc; font-weight:700; margin-right:.6rem; }
  .select-wrap { position: relative; display: inline-block; }
  select.season-select { -webkit-appearance: none; -moz-appearance: none; appearance: none; background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)); border: 1px solid rgba(99,102,241,0.32); color: #fff; padding: 10px 40px 10px 16px; border-radius: 14px; font-weight: 800; min-width:160px; box-shadow: 0 10px 30px rgba(2,6,23,0.6), 0 0 0 4px rgba(99,102,241,0.03) inset; font-size: 1rem; cursor: pointer; }
  .select-wrap::after { content: ''; position: absolute; right: 12px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; pointer-events: none; background-image: linear-gradient(45deg, transparent 50%, #cbd5e1 50%), linear-gradient(135deg, #cbd5e1 50%, transparent 50%); background-size: 8px 8px; background-repeat: no-repeat; background-position: center; opacity: 0.95; }
  option { background: #0b0c0f; color: #e6eef8; }

  .debug { background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); padding:14px; border-radius:10px; margin-bottom:1rem; color:#cbd5e1; max-height:220px; overflow:auto; }
  .debug ul { margin:0; padding-left:18px; font-size:.95rem; }

  .main { background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); padding:14px; border-radius:10px; }
  .side { background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); padding:14px; border-radius:10px; height:fit-content; }

  .standings-list { list-style:none; margin:0; padding:0; }
  .stand-row { display:flex; align-items:center; gap:12px; padding:12px 12px; border-bottom:1px solid rgba(255,255,255,0.02); }
  .rank { width:58px; font-weight:800; display:flex; align-items:center; gap:8px; color:#e6eef8; }
  .player { display:flex; align-items:center; gap:12px; min-width:0; }
  .avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; flex-shrink:0; }
  .teamName { font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:360px; }
  .teamMeta { color:#9aa3ad; font-size:.95rem; margin-top:4px; }
  .seedCol { margin-left:auto; color:#9aa3ad; font-weight:700; display:flex; align-items:center; gap:.5rem; }

  .outcome-row { display:flex; gap:12px; align-items:center; margin-bottom:12px; }
  .outcome-name { font-weight:700; }
  .small { color:#9aa3ad; font-size:.9rem; }
  .no-debug { color:#9aa3ad; padding: 12px 0; }

  @media (max-width: 980px) { .container { grid-template-columns: 1fr; } .side { order: 2; } }
</style>

<div class="container">
  <div class="header">
    <div>
      <h1>Honors Hall</h1>
      <div class="subtitle">Final placements computed from playoff results — season {selectedSeason}</div>
    </div>

    <form id="filters" method="get" class="filters" aria-hidden="false">
      <label class="season-label" for="season">Season</label>
      <div class="select-wrap" role="presentation">
        <select id="season" name="season" class="season-select" on:change={submitFilters} aria-label="Select season">
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
                <!-- show only one owner/label (owner_name preferred) -->
                <div class="teamMeta">{row.owner_name ? row.owner_name : `Roster ${row.rosterId}`}</div>
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

    {#if finalStandings.length}
      <div class="outcome-row" title="Champion">
        <img class="avatar" src={avatarOrPlaceholder(finalStandings[0].avatar, finalStandings[0].team_name)} alt="champion avatar" style="width:72px;height:72px">
        <div>
          <div class="outcome-name">Champion <span style="margin-left:6px">🏆</span></div>
          <div class="small">{finalStandings[0].team_name} {finalStandings[0].owner_name ? `• ${finalStandings[0].owner_name}` : ''} • Seed #{finalStandings[0].seed ?? '—'}</div>
        </div>
      </div>

      <div style="margin-top:8px" class="outcome-row" title="Biggest Loser">
        <img class="avatar" src={avatarOrPlaceholder(finalStandings[finalStandings.length-1].avatar, finalStandings[finalStandings.length-1].team_name)} alt="biggest loser avatar" style="width:72px;height:72px">
        <div>
          <div class="outcome-name">Biggest loser <span style="margin-left:6px">😵‍💫</span></div>
          <div class="small">{finalStandings[finalStandings.length-1].team_name} {finalStandings[finalStandings.length-1].owner_name ? `• ${finalStandings[finalStandings.length-1].owner_name}` : ''} • Seed #{finalStandings[finalStandings.length-1].seed ?? '—'}</div>
        </div>
      </div>
    {/if}

    <!-- NEW: Finals MVP -->
    {#if finalsMvp}
      <div style="margin-top:14px; border-top:1px solid rgba(255,255,255,0.03); padding-top:12px;">
        <div class="outcome-name">Finals MVP <span style="margin-left:6px">🔥</span></div>
        <div class="outcome-row" style="margin-top:.6rem">
          <img class="avatar" src={avatarOrPlaceholder(finalsMvp.roster_meta?.team_avatar || finalsMvp.roster_meta?.owner_avatar, finalsMvp.roster_meta?.team_name || finalsMvp.rosterId)} alt="finals mvp roster avatar" style="width:56px;height:56px">
          <div>
            <div style="font-weight:800">{finalsMvp.playerId} • {finalsMvp.roster_meta?.team_name ?? finalsMvp.rosterId}</div>
            <div class="small">{finalsMvp.points} pts (starters)</div>
          </div>
        </div>
      </div>
    {/if}

    <!-- NEW: Overall MVP -->
    {#if overallMvp}
      <div style="margin-top:12px; border-top:1px solid rgba(255,255,255,0.03); padding-top:12px;">
        <div class="outcome-name">Overall MVP <span style="margin-left:6px">🌟</span></div>
        <div class="outcome-row" style="margin-top:.6rem">
          <img class="avatar" src={avatarOrPlaceholder(overallMvp.roster_meta?.team_avatar || overallMvp.roster_meta?.owner_avatar, overallMvp.roster_meta?.team_name || overallMvp.rosterId)} alt="overall mvp roster avatar" style="width:56px;height:56px">
          <div>
            <div style="font-weight:800">{overallMvp.playerId} • {overallMvp.roster_meta?.team_name ?? overallMvp.rosterId}</div>
            <div class="small">{overallMvp.points} pts (starters, season)</div>
          </div>
        </div>
      </div>
    {/if}

    <div style="margin-top:12px; color:#9aa3ad; font-size:.9rem">
      Final standings are derived from server-scrubbed matchups and the bracket simulation logic. The debug trace above shows the decisions used to construct the bracket (matchups & tiebreaks).
    </div>
  </aside>
</div>
