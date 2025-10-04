<script>
  // src/routes/honor-hall/+page.svelte
  export let data;

  const seasons = data?.seasons ?? [];
  // selectedSeason is only used to keep the dropdown value; the server already used this param to compute finalStandings.
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  const finalStandings = Array.isArray(data?.finalStandings) ? data.finalStandings : [];
  const rawDebugLog = Array.isArray(data?.debugLog) ? data.debugLog : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // visible debug: filter out "Assign place" or seed reassignment lines (we only want to show the matchup trace)
  $: debugLog = rawDebugLog.filter(line => !/^Assign place\s+/i.test(line) && !/^Assign place\b/i.test(line));

  function avatarOrPlaceholder(url, name, size = 48) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  // champion & biggest loser
  $: champion = finalStandings && finalStandings.length ? finalStandings[0] : null;
  $: biggestLoser = finalStandings && finalStandings.length ? finalStandings[finalStandings.length - 1] : null;

  // medal emoji helper
  function medalForRank(r) {
    if (r === 1) return '🥇';
    if (r === 2) return '🥈';
    if (r === 3) return '🥉';
    return '';
  }
</script>

<style>
  :global(body) { background: var(--bg, #0b0c0f); color: #e6eef8; }

  .container { max-width: 1100px; margin: 0 auto; padding: 1.5rem; display:flex; gap:1.25rem; }
  .main { flex:1 1 0; }
  .side { width:320px; }

  h1 { font-size: 2rem; margin-bottom: .25rem; }
  .subtitle { color: #9aa3ad; margin-bottom: 1rem; }

  /* dropdown */
  .filters { display:flex; justify-content:flex-end; gap:.65rem; margin-bottom: 0.75rem; }
  .season-select {
    background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
    border: 1px solid rgba(255,255,255,0.06);
    color: #fff;
    padding: 10px 14px;
    border-radius: 12px;
    font-weight: 700;
    min-width:130px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
  }

  /* panels */
  .panel {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.03);
    padding: 16px;
    border-radius: 10px;
    margin-bottom: 1rem;
  }

  .debugList { color:#cbd5e1; font-size:.95rem; line-height:1.5; }
  .debugList li { margin:6px 0; }

  /* standings list */
  .standingsWrap { margin-top: .5rem; }
  .standingsHeader { display:flex; gap:12px; align-items:center; margin-bottom:12px; }
  .standingsTitle { font-weight:700; font-size:1.05rem; }

  .list { border-radius:8px; overflow:hidden; }
  .row {
    display:flex;
    align-items:center;
    gap: 12px;
    padding: 12px 14px;
    border-top: 1px solid rgba(255,255,255,0.02);
    background: transparent;
  }
  .row:first-child { border-top: 0; }

  .rankCol { width:48px; text-align:right; font-weight:800; color:#fff; font-size:1.02rem; }
  .rankEmoji { margin-right:8px; color:#ffd166; }

  .teamCol { display:flex; gap:12px; align-items:center; min-width:0; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; flex-shrink:0; }
  .teamMeta { display:flex; flex-direction:column; min-width:0; }
  .teamName { font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .teamSub { color:#9aa3ad; font-size:.9rem; margin-top:4px; }

  .seedCol { margin-left:auto; min-width:50px; text-align:right; color:#9aa3ad; font-weight:700; }

  /* side card */
  .outcomeCard { display:flex; flex-direction:column; gap:12px; }
  .outcomeItem { display:flex; gap:12px; align-items:center; background: rgba(255,255,255,0.01); border-radius:8px; padding:10px; }
  .outcomeMeta { display:flex; flex-direction:column; }
  .outcomeTitle { font-weight:700; }

  /* empty/placeholder */
  .empty { color:#9aa3ad; padding:1rem 0; }

  /* small */
  .small { font-size:.9rem; color:#9aa3ad; }

  @media (max-width: 980px) {
    .container { padding:1rem; flex-direction:column; }
    .side { width:100%; order:2; }
  }
</style>

<div class="container">
  <div class="main">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px;">
      <div>
        <h1>Honor Hall — Final Standings</h1>
        <div class="subtitle">Final placements computed from playoff results (server-scrubbed matchups)</div>
      </div>

      <form id="filters" method="get" class="filters" aria-hidden="false" style="margin:0;">
        <label for="season" class="small" style="margin-right:8px; color:#cbd5e1;">Season</label>
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
      </form>
    </div>

    {#if messages && messages.length}
      <div class="panel" role="status" aria-live="polite">
        {#each messages as m}
          <div class="small">• {m}</div>
        {/each}
      </div>
    {/if}

    <div class="panel">
      <h3 class="small" style="margin:0 0 10px 0;">Debug trace</h3>
      {#if debugLog && debugLog.length}
        <ul class="debugList">
          {#each debugLog as line, idx}
            <li key={idx}>• {line}</li>
          {/each}
        </ul>
      {:else}
        <div class="empty">No debug trace available.</div>
      {/if}
    </div>

    <div class="panel standingsWrap">
      <div class="standingsHeader">
        <div class="standingsTitle">Final Standings</div>
        <div class="small" style="margin-left:auto;">{finalStandings.length} teams</div>
      </div>

      {#if finalStandings && finalStandings.length}
        <div class="list">
          {#each finalStandings as entry (entry.rosterId)}
            <div class="row" aria-label={"Rank " + entry.rank + " " + (entry.team_name || '')}>
              <div class="rankCol">
                <span class="rankEmoji">{medalForRank(entry.rank)}</span>
                <span>{entry.rank}</span>
              </div>

              <div class="teamCol">
                <img class="avatar" src={avatarOrPlaceholder(entry.avatar, entry.team_name)} alt="avatar">
                <div class="teamMeta">
                  <div class="teamName">{entry.team_name}</div>
                  <div class="teamSub">
                    {entry.owner_name} • Seed #{entry.seed}
                  </div>
                </div>
              </div>

              <div class="seedCol">#{entry.seed}</div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty">No final standings available for the selected season.</div>
      {/if}
    </div>
  </div>

  <aside class="side">
    <div class="panel outcomeCard">
      <div>
        <div class="small" style="margin-bottom:6px;">Season outcomes</div>

        <div style="margin-bottom:8px; font-weight:700;">Champion</div>
        {#if champion}
          <div class="outcomeItem">
            <img class="avatar" src={avatarOrPlaceholder(champion.avatar, champion.team_name)} alt="champion avatar" style="width:64px;height:64px;border-radius:10px;">
            <div class="outcomeMeta">
              <div class="outcomeTitle">{champion.team_name} <span title="Champion">🏆</span></div>
              <div class="small">{champion.owner_name} • Seed #{champion.seed} • Rank {champion.rank}</div>
            </div>
          </div>
        {:else}
          <div class="empty">Champion not available</div>
        {/if}
      </div>

      <div style="margin-top:10px;">
        <div style="margin-bottom:8px; font-weight:700;">Biggest loser</div>
        {#if biggestLoser}
          <div class="outcomeItem">
            <img class="avatar" src={avatarOrPlaceholder(biggestLoser.avatar, biggestLoser.team_name)} alt="biggest loser avatar" style="width:64px;height:64px;border-radius:10px;">
            <div class="outcomeMeta">
              <div class="outcomeTitle">{biggestLoser.team_name} <span title="Biggest loser">😵</span></div>
              <div class="small">{biggestLoser.owner_name} • Seed #{biggestLoser.seed} • Rank {biggestLoser.rank}</div>
            </div>
          </div>
        {:else}
          <div class="empty">No biggest loser available</div>
        {/if}
      </div>

      <div class="small" style="margin-top:12px; color:#9aa3ad;">
        Final standings are derived from server-scrubbed matchups and the bracket simulation logic (uses real matchup scores where present; falls back to regular-season PF then seed).
      </div>
    </div>
  </aside>
</div>
