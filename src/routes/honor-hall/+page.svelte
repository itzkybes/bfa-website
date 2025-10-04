<script>
  // src/routes/honor-hall/+page.svelte
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  const finalStandings = Array.isArray(data?.finalStandings) ? data.finalStandings : [];
  const debug = Array.isArray(data?.debug) ? data.debug : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function avatarOrPlaceholder(url, name, size = 40) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function medalEmoji(rank) {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  }
</script>

<style>
  :global(body) { background: var(--bg,#0b0c0f); color: #e6eef8; }
  .page { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
  .header { display:flex; justify-content:space-between; align-items:center; gap:1rem; margin-bottom: .75rem; }
  h1 { margin:0; font-size:1.8rem; }
  .subtitle { color:#9aa3ad; margin-bottom: .9rem; }
  form.filters { display:flex; gap:.6rem; align-items:center; }
  select.season { padding:8px 12px; border-radius:10px; background:linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)); color:#fff; border:1px solid rgba(255,255,255,0.07); box-shadow:0 4px 18px rgba(0,0,0,0.45); font-weight:700; }
  .grid { display:grid; grid-template-columns: 1fr 320px; gap: 1rem; }
  .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.03); padding: 14px; border-radius: 10px; }

  .debug { margin-bottom: 1rem; }
  .debug ul { margin:0; padding-left: 1.1rem; color:#cbd5e1; }

  .standings { margin-top: 1rem; }
  .row { display:flex; align-items:center; gap: 1rem; padding: 12px 8px; border-bottom: 1px solid rgba(255,255,255,0.03); }
  .col-rank { width:60px; font-weight:700; display:flex; align-items:center; gap:.5rem; }
  .col-team { flex:1; display:flex; gap:.8rem; align-items:center; min-width:0; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; flex-shrink:0; }
  .tname { font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:420px; }
  .tmeta { color:#9aa3ad; font-size:.9rem; }

  .col-seed { width:70px; text-align:right; color:#9aa3ad; font-weight:700; }
  .sidebox .outcome { display:flex; gap:.6rem; align-items:center; margin-bottom:.9rem; }
  .outcome .meta { color:#9aa3ad; font-size:.9rem; }
</style>

<div class="page">
  <div class="header">
    <div>
      <h1>Honor Hall — Final Standings</h1>
      <div class="subtitle">Final placements computed from playoff results (server-scrubbed matchups)</div>
    </div>

    <form id="filters" method="get" class="filters" on:change|preventDefault={submitFilters}>
      <label for="season" style="color:#9aa3ad; font-weight:700; margin-right:.5rem;">Season</label>
      <select id="season" name="season" class="season">
        {#if seasons && seasons.length}
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeason)}>{s.season ?? s.name ?? s.league_id}</option>
          {/each}
        {:else}
          <option value={selectedSeason}>{selectedSeason}</option>
        {/if}
      </select>
    </form>
  </div>

  {#if messages && messages.length}
    <div class="card debug">
      <ul>
        {#each messages as m}
          <li>{m}</li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="grid">
    <div>
      <div class="card">
        <h3 style="margin:0 0 10px 0;">Debug trace</h3>
        <div class="debug">
          <ul>
            {#if debug && debug.length}
              {#each debug as d}
                <li>{d}</li>
              {/each}
            {:else}
              <li>No debug trace available.</li>
            {/if}
          </ul>
        </div>
      </div>

      <div class="card standings" style="margin-top:1rem;">
        <h3 style="margin:0 0 12px 0;">Final Standings</h3>
        {#if finalStandings && finalStandings.length}
          {#each finalStandings as row}
            <div class="row" aria-label="standing-row">
              <div class="col-rank">
                <span>{row.rank}</span>
                <span>{medalEmoji(row.rank)}</span>
              </div>
              <div class="col-team">
                <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt="">
                <div>
                  <div class="tname">{row.team_name}</div>
                  <div class="tmeta">Roster {row.rosterId} • Seed #{row.seed ?? '—'}</div>
                </div>
              </div>
              <div class="col-seed">#{row.seed ?? '—'}</div>
            </div>
          {/each}
        {:else}
          <div class="tmeta">No final standings computed.</div>
        {/if}
      </div>
    </div>

    <div class="sidebox">
      <div class="card">
        <h4 style="margin:0 0 10px 0;">Season outcomes</h4>
        {#if finalStandings && finalStandings.length}
          <div style="display:flex; flex-direction:column; gap:.7rem;">
            <div class="outcome">
              <div style="width:64px;">
                <img class="avatar" src={avatarOrPlaceholder(finalStandings[0].avatar, finalStandings[0].team_name)} alt="">
              </div>
              <div>
                <div style="font-weight:800;">Champion <span style="margin-left:.45rem;">🥇</span></div>
                <div class="meta">{finalStandings[0].team_name} • Seed #{finalStandings[0].seed}</div>
              </div>
            </div>

            <div style="height:1px; background:rgba(255,255,255,0.03); margin: .2rem 0;"></div>

            <div class="outcome">
              <div style="width:64px;">
                <img class="avatar" src={avatarOrPlaceholder(finalStandings[finalStandings.length-1].avatar, finalStandings[finalStandings.length-1].team_name)} alt="">
              </div>
              <div>
                <div style="font-weight:800;">Biggest loser <span style="margin-left:.45rem;">😵</span></div>
                <div class="meta">{finalStandings[finalStandings.length-1].team_name} • Seed #{finalStandings[finalStandings.length-1].seed}</div>
              </div>
            </div>
          </div>
        {:else}
          <div class="meta">No season outcomes available.</div>
        {/if}
      </div>
    </div>
  </div>
</div>
