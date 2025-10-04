<!-- src/routes/honor-hall/+page.svelte -->
<script>
  export let data;

  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // server-provided finalStandings & meta
  const serverFinalStandings = Array.isArray(data?.finalStandings) ? data.finalStandings : [];
  const championRosterId = data?.championRosterId ?? null;
  const biggestLoserRosterId = data?.biggestLoserRosterId ?? null;

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function avatarOrPlaceholder(url, name, size = 48) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function medalEmoji(rank) {
    if (rank === 1) return ' 🥇';
    if (rank === 2) return ' 🥈';
    if (rank === 3) return ' 🥉';
    return '';
  }

  // final sanitization client-side: ensure unique ranks and stable order.
  $: finalStandings = (() => {
    if (!Array.isArray(serverFinalStandings)) return [];
    const list = serverFinalStandings.map(f => ({
      ...f,
      finalRank: f.finalRank != null ? Number(f.finalRank) : null,
      seed: f.seed != null ? Number(f.seed) : null
    }));

    // sort: by finalRank if present, else by seed, else keep existing
    list.sort((a,b) => {
      const ra = a.finalRank != null ? a.finalRank : Infinity;
      const rb = b.finalRank != null ? b.finalRank : Infinity;
      if (ra !== rb) return ra - rb;
      const sa = a.seed != null ? a.seed : Infinity;
      const sb = b.seed != null ? b.seed : Infinity;
      if (sa !== sb) return sa - sb;
      return String(a.team_name).localeCompare(String(b.team_name));
    });

    // reassign unique ranks 1..N to be certain
    for (let i = 0; i < list.length; i++) list[i].finalRank = i + 1;

    return list;
  })();

  // find champion and biggest loser info objects to display
  $: championInfo = finalStandings.find(t => String(t.rosterId) === String(championRosterId)) ?? (finalStandings[0] ?? null);
  $: biggestLoserInfo = finalStandings.length ? finalStandings[finalStandings.length - 1] : null;
</script>

<style>
  :global(body) { background: var(--bg, #0b0c0f); color: #e6eef8; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }

  .container { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }

  header {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:1rem;
    margin-bottom:1rem;
  }
  h1 { font-size:1.6rem; margin:0; letter-spacing:-0.2px; }
  .subtitle { color:#9aa3ad; font-size:.95rem; margin-top:.2rem; }

  .filters { display:flex; gap:.6rem; align-items:center; }
  .season-label { font-weight:700; color:#cfe3ff; font-size:.95rem; margin-right:.35rem; }
  .season-select {
    appearance: none;
    -webkit-appearance: none;
    background: #0f1720;
    color: #e6eef8;
    border: 1px solid rgba(99,102,241,0.55);
    padding: .6rem 1rem;
    border-radius: 12px;
    font-weight:700;
    min-width:180px;
    box-shadow: 0 6px 22px rgba(2,6,23,0.65);
    cursor:pointer;
    font-size:.98rem;
  }
  .season-select:focus { outline: 3px solid rgba(99,102,241,0.16); outline-offset: 2px; }

  .messages {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    padding: 12px;
    border-radius: 10px;
    margin-bottom: 1rem;
    color: #cbd5e1;
    font-size:.95rem;
  }

  /* panel grid: main table + right column */
  .panel {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    padding: 14px;
    border-radius: 12px;
    display:grid;
    grid-template-columns: 1fr 320px;
    gap: 18px;
    align-items:start;
  }

  .finalTable { width:100%; border-collapse: collapse; margin-top:.5rem; }
  .finalTable thead th { text-align:left; font-weight:700; color:#9aa3ad; padding:10px 12px; font-size:.9rem; }
  .finalTable tbody tr { border-bottom: 1px solid rgba(255,255,255,0.03); }
  .finalTable td { padding:12px; vertical-align:middle; }

  .rankCol { width:86px; font-weight:800; font-size:1.05rem; color:#fff; }
  .teamCell { display:flex; align-items:center; gap:.75rem; min-width:0; }
  .teamAvatar { width:44px; height:44px; border-radius:8px; object-fit:cover; flex-shrink:0; }
  .teamName { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:420px; }
  .teamMeta { color:#9aa3ad; font-size:.88rem; }

  .seed { color:#9aa3ad; font-weight:700; text-align:right; min-width:76px; }

  /* right summary column */
  .summaryCard {
    background: rgba(255,255,255,0.015);
    border: 1px solid rgba(255,255,255,0.03);
    border-radius:10px;
    padding:12px;
  }
  .summaryTitle { font-weight:800; color:#cfe3ff; margin-bottom:8px; }
  .person {
    display:flex; align-items:center; gap:.75rem; margin-bottom:12px;
  }
  .personAvatar { width:56px; height:56px; border-radius:10px; object-fit:cover; }
  .personMeta { display:flex; flex-direction:column; }
  .personName { font-weight:800; }
  .personSub { color:#9aa3ad; font-size:.9rem; }

  @media (max-width:980px) {
    .panel { grid-template-columns: 1fr; }
  }
</style>

<div class="container">
  <header>
    <div>
      <h1>Honor Hall — Final Standings</h1>
      <div class="subtitle">Final placements computed from playoff results (server-scrubbed matchups)</div>
    </div>

    <form id="filters" method="get" class="filters" aria-label="Season selector">
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
  </header>

  {#if messages && messages.length}
    <div class="messages" role="status" aria-live="polite">
      {#each messages as msg, idx}
        <div key={idx}>• {msg}</div>
      {/each}
    </div>
  {/if}

  <div class="panel" role="region" aria-labelledby="final-standings-heading">
    <div>
      <h2 id="final-standings-heading" style="font-size:1rem;margin:0 0 8px 0;color:#cfe3ff;">Final Standings</h2>

      {#if finalStandings && finalStandings.length}
        <table class="finalTable" role="table" aria-label="Final Standings table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Team</th>
              <th style="text-align:right">Seed</th>
            </tr>
          </thead>
          <tbody>
            {#each finalStandings as t (t.rosterId)}
              <tr>
                <td class="rankCol">{t.finalRank}{medalEmoji(t.finalRank)}</td>
                <td>
                  <div class="teamCell" title={t.team_name}>
                    <img class="teamAvatar" src={avatarOrPlaceholder(t.avatar, t.team_name, 44)} alt="">
                    <div>
                      <div class="teamName">{t.team_name}</div>
                      <div class="teamMeta">Roster {t.rosterId}</div>
                    </div>
                  </div>
                </td>
                <td class="seed">#{t.seed ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div style="color:#9aa3ad;padding:12px 0;">Final standings not available for the selected season.</div>
      {/if}
    </div>

    <aside class="summaryCard" aria-label="Champion and biggest loser">
      <div class="summaryTitle">Season outcomes</div>

      <div style="margin-bottom:8px;color:#9aa3ad;font-size:.95rem;">Champion</div>
      {#if championInfo}
        <div class="person">
          <img class="personAvatar" src={avatarOrPlaceholder(championInfo.avatar, championInfo.team_name, 56)} alt="">
          <div class="personMeta">
            <div class="personName">{championInfo.team_name} <span style="font-size:.95rem">🥇</span></div>
            <div class="personSub">Seed #{championInfo.seed ?? '—'} • Rank {championInfo.finalRank}</div>
          </div>
        </div>
      {:else}
        <div style="color:#9aa3ad">Champion not determined</div>
      {/if}

      <div style="margin-top:12px;margin-bottom:8px;color:#9aa3ad;font-size:.95rem;">Biggest loser</div>
      {#if biggestLoserInfo}
        <div class="person">
          <img class="personAvatar" src={avatarOrPlaceholder(biggestLoserInfo.avatar, biggestLoserInfo.team_name, 56)} alt="">
          <div class="personMeta">
            <div class="personName">{biggestLoserInfo.team_name} <span style="font-size:.95rem">😢</span></div>
            <div class="personSub">Seed #{biggestLoserInfo.seed ?? '—'} • Rank {biggestLoserInfo.finalRank}</div>
          </div>
        </div>
      {:else}
        <div style="color:#9aa3ad">No data</div>
      {/if}

      <div style="margin-top:10px;border-top:1px dashed rgba(255,255,255,0.03);padding-top:10px;color:#9aa3ad;font-size:.88rem;">
        Final standings are derived from server-scrubbed matchups and the regular-season seeding.
      </div>
    </aside>
  </div>
</div>
