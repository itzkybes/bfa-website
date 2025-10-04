<script>
  // src/routes/honor-hall/+page.svelte
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  const finalStandings = Array.isArray(data?.finalStandings) ? data.finalStandings : [];
  const debugLog = Array.isArray(data?.debugLog) ? data.debugLog : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function fmtOwnerDisplay(item) {
    // item.owner_name expected from server; fallback to 'Roster <id>'
    if (!item) return '';
    return item.owner_name ? item.owner_name : `Roster ${item.rosterId}`;
  }

  function medalFor(rank) {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  }

  // champion & biggest loser (based on finalStandings ordering)
  $: champion = finalStandings && finalStandings.length ? finalStandings[0] : null;
  $: biggestLoser = finalStandings && finalStandings.length ? finalStandings[finalStandings.length - 1] : null;
</script>

<style>
  :global(body) { background: var(--bg, #0b0c0f); color: #e6eef8; }

  .container { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }

  header.top {
    display:flex;
    justify-content:space-between;
    align-items:baseline;
    gap:1rem;
    margin-bottom: .8rem;
  }
  h1 { font-size: 1.8rem; margin: 0; }
  .subtitle { color: #9aa3ad; margin-bottom: 1rem; }

  /* filters */
  .filters { display:flex; align-items:center; gap:.65rem; }
  .season-label { color:#9aa3ad; margin-right:.5rem; font-weight:700; }
  .season-select {
    background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
    border: 1px solid rgba(255,255,255,0.06);
    color: #fff;
    padding: 8px 12px;
    border-radius: 12px;
    font-weight: 700;
    min-width:110px;
    box-shadow: 0 6px 18px rgba(10,12,16,0.6), inset 0 1px 0 rgba(255,255,255,0.02);
  }

  .layout {
    display:grid;
    grid-template-columns: 1fr 320px;
    gap: 1.25rem;
    align-items:start;
    margin-top: 1.25rem;
  }

  .card {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    padding: 1rem;
    border-radius: 10px;
  }

  .debugList { margin: 0 0 1rem 0; padding-left: 1.25rem; color:#cbd5e1; }
  .debugList li { margin-bottom: .35rem; }

  /* standings list */
  .standingsList { list-style:none; margin:0; padding:0; }
  .standRow {
    display:flex;
    align-items:center;
    gap: 1rem;
    padding:12px 14px;
    border-bottom:1px solid rgba(255,255,255,0.02);
  }
  .rankCol { width:56px; font-weight:800; display:flex; align-items:center; gap:.5rem; color:#fff; }
  .rankEmoji { font-size:1.05rem; }

  .teamCol { display:flex; align-items:center; gap:12px; min-width:0; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; flex-shrink:0; }
  .teamInfo { display:flex; flex-direction:column; min-width:0; }
  .teamName { font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:420px; }
  .teamMeta { color:#9aa3ad; font-size:.9rem; margin-top:4px; }

  .seedCol { margin-left:auto; color:#9aa3ad; font-weight:700; min-width:60px; text-align:right; }

  /* sidebar outcomes */
  .outcomeCard { display:flex; flex-direction:column; gap:1rem; }
  .outcomeItem { display:flex; gap:0.75rem; align-items:center; padding:8px; border-radius:8px; background: rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.02); }
  .outcomeMeta { display:flex; flex-direction:column; min-width:0; }
  .outcomeTitle { color:#9aa3ad; font-weight:700; margin-bottom:.25rem; }
  .outcomeName { font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; }

  /* small utilities */
  .muted { color:#9aa3ad; font-size:.95rem; }
  .messages { margin-top:.5rem; color:#cbd5e1; }
</style>

<div class="container">
  <header class="top">
    <div>
      <h1>Honor Hall — Final Standings</h1>
      <div class="subtitle">Final placements computed from playoff results (server-scrubbed matchups)</div>
    </div>

    <form id="filters" method="get" class="filters" aria-hidden="false">
      <label for="season" class="season-label">Season</label>
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
  </header>

  <div class="layout">
    <div>
      <div class="card">
        {#if messages && messages.length}
          <ul class="debugList" aria-live="polite">
            {#each messages as m, idx}
              <li key={idx}>• {m}</li>
            {/each}
          </ul>
        {/if}

        <div style="margin-bottom:1rem;">
          <strong class="muted">Debug trace</strong>
          {#if debugLog && debugLog.length}
            <ul class="debugList">
              {#each debugLog as d, i}
                <li key={i}>• {d}</li>
              {/each}
            </ul>
          {:else}
            <div class="muted" style="padding:.5rem 0;">• No debug trace available.</div>
          {/if}
        </div>
      </div>

      <div class="card" style="margin-top:1rem;">
        <h3 style="margin:0 0 0.75rem 0;">Final Standings</h3>
        <ul class="standingsList" role="list">
          {#if finalStandings && finalStandings.length}
            {#each finalStandings as row (row.rosterId)}
              <li class="standRow">
                <div class="rankCol">
                  <span class="rank">{row.rank}</span>
                  <span class="rankEmoji">{medalFor(row.rank)}</span>
                </div>

                <div class="teamCol">
                  <img class="avatar" src={row.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((row.team_name||'T')[0])}&background=0d1320&color=ffffff&size=48`} alt="avatar">
                  <div class="teamInfo">
                    <div class="teamName">{row.team_name}</div>
                    <div class="teamMeta">{fmtOwnerDisplay(row)} • Seed #{row.seed ?? '—'}</div>
                  </div>
                </div>

                <div class="seedCol">#{row.seed ?? '—'}</div>
              </li>
            {/each}
          {:else}
            <div class="muted" style="padding:1rem 0;">No final standings available.</div>
          {/if}
        </ul>
      </div>
    </div>

    <aside class="card">
      <div class="outcomeCard">
        <div>
          <div class="outcomeTitle">Season outcomes</div>

          <div style="display:flex; flex-direction:column; gap:0.75rem;">
            <div style="font-weight:700; color:#9aa3ad; margin-bottom:6px;">Champion</div>
            {#if champion}
              <div class="outcomeItem">
                <img class="avatar" src={champion.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((champion.team_name||'T')[0])}&background=0d1320&color=ffffff&size=48`} alt="champion">
                <div class="outcomeMeta">
                  <div class="outcomeName">{champion.team_name} <span style="margin-left:.4rem;">🏆</span></div>
                  <div class="muted">{fmtOwnerDisplay(champion)} • Seed #{champion.seed} • Rank {champion.rank}</div>
                </div>
              </div>
            {:else}
              <div class="muted">—</div>
            {/if}

            <div style="height:8px;"></div>

            <div style="font-weight:700; color:#9aa3ad; margin-bottom:6px;">Biggest loser</div>
            {#if biggestLoser}
              <div class="outcomeItem">
                <img class="avatar" src={biggestLoser.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((biggestLoser.team_name||'T')[0])}&background=0d1320&color=ffffff&size=48`} alt="biggest-loser">
                <div class="outcomeMeta">
                  <div class="outcomeName">{biggestLoser.team_name} <span style="margin-left:.4rem;">😵‍💫</span></div>
                  <div class="muted">{fmtOwnerDisplay(biggestLoser)} • Seed #{biggestLoser.seed} • Rank {biggestLoser.rank}</div>
                </div>
              </div>
            {:else}
              <div class="muted">—</div>
            {/if}
          </div>
        </div>

        <div style="margin-top:1rem; color:#9aa3ad; font-size:.9rem;">
          Final standings are derived from server-scrubbed matchups and the bracket simulation logic (uses real matchup scores where present; falls back to regular-season PF then seed).
        </div>
      </div>
    </aside>
  </div>
</div>
