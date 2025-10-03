<script>
  // src/routes/honor-hall/+page.svelte
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  const matchupsRows = Array.isArray(data?.matchupsRows) ? data.matchupsRows : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // helpers
  function avatarOrPlaceholder(url, name, size = 48) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    // lightweight placeholder service — background and color chosen to match dark UI
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function fmtPts(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return '—';
    return (Math.round(Number(n) * 100) / 100).toFixed(2);
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  // only show rows that match selectedSeason (if season provided in row)
  $: filteredRows = Array.isArray(matchupsRows) && selectedSeason
    ? matchupsRows.filter(r => {
        // some rows might store season as number or league id; compare stringified
        const rs = r?.season ?? null;
        if (!rs) return true; // keep rows missing season metadata
        return String(rs) === String(selectedSeason);
      })
    : (Array.isArray(matchupsRows) ? matchupsRows.slice() : []);

  // Group by week (descending so finals / later weeks are at top like matchups page)
  $: groupedByWeek = (() => {
    const map = new Map();
    for (const r of filteredRows) {
      const wk = r.week ?? 'unknown';
      if (!map.has(wk)) map.set(wk, []);
      map.get(wk).push(r);
    }
    // convert to array sorted by week desc (numeric if possible)
    const arr = Array.from(map.entries()).map(([week, rows]) => {
      // attempt numeric sort key
      const nweek = Number(week);
      const sortKey = !isNaN(nweek) ? nweek : Number.MIN_SAFE_INTEGER;
      return { week, sortKey, rows };
    });
    arr.sort((a,b) => b.sortKey - a.sortKey);
    return arr;
  })();
</script>

<style>
  :global(body) { background: var(--bg, #0b0c0f); color: #e6eef8; }

  .container { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }

  h1 { font-size: 2rem; margin-bottom: .6rem; }
  .subtitle { color: #9aa3ad; margin-bottom: 1rem; }

  /* filters */
  .filters { display:flex; justify-content:flex-end; gap:.65rem; margin-bottom: 1rem; }
  .season-select {
    background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
    border: 1px solid rgba(255,255,255,0.06);
    color: #fff;
    padding: 8px 10px;
    border-radius: 8px;
    font-weight: 600;
  }

  /* messages box */
  .messages {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    padding: 14px;
    border-radius: 8px;
    margin-bottom: 1rem;
    color: #cbd5e1;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
    font-size: .95rem;
  }

  /* week group */
  .weekGroup { margin-top: 1.25rem; margin-bottom: 1.25rem; }
  .weekHeader { display:flex; justify-content:space-between; align-items:center; margin-bottom:.8rem; }
  .weekTitle { font-weight:700; color:#e6eef8; }
  .weekSub { color:#9aa3ad; font-size:.95rem; }

  /* match row (matchups style) */
  .matchRow {
    display:flex;
    align-items:center;
    gap: 1rem;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.03);
    padding: 12px;
    border-radius: 10px;
    margin-bottom: 10px;
  }
  .teamCol { display:flex; align-items:center; gap:.75rem; min-width: 0; }
  .teamInfo { display:flex; flex-direction:column; min-width:0; }
  .teamName { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:220px; }
  .teamSub { color:#9aa3ad; font-size:.85rem; display:flex; gap:.45rem; align-items:center; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; flex-shrink:0; }

  .vsCol { width:64px; text-align:center; color:#9aa3ad; font-weight:700; }

  .scoreCol { margin-left:auto; text-align:right; min-width:95px; }
  .scoreVal { font-weight:800; color:#fff; display:block; }
  .scoreSub { color:#9aa3ad; font-size:.85rem; }

  .winner { color: #fff; background: rgba(99,102,241,0.12); padding: 3px 8px; border-radius: 8px; }

  .bye { font-style:italic; color:#9aa3ad; }

  /* combined participants */
  .combinedList { display:flex; gap:.5rem; flex-wrap:wrap; }
  .chip { background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); padding:6px 8px; border-radius:8px; color:#d1d5db; font-weight:700; font-size:.9rem; }

  /* empty state */
  .empty { color:#9aa3ad; padding:1rem 0; }
</style>

<div class="container">
  <h1>Honor Hall — Playoff matchups (showing selected season)</h1>
  <div class="subtitle">Playoff matchups (filtered from server loader). Showing week range: {data?.playoffStart} — {data?.playoffEnd}</div>

  <form id="filters" method="get" class="filters" aria-hidden="false">
    <label for="season" class="sr-only">Season</label>
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

  {#if messages && messages.length}
    <div class="messages" role="status" aria-live="polite">
      {#each messages as msg, idx}
        <div key={idx}>• {msg}</div>
      {/each}
    </div>
  {/if}

  {#if groupedByWeek.length === 0}
    <div class="empty">No playoff matchups found for the selected season.</div>
  {:else}
    {#each groupedByWeek as weekGroup (weekGroup.week)}
      <div class="weekGroup">
        <div class="weekHeader">
          <div>
            <div class="weekTitle">Round — Week {weekGroup.week}</div>
            <div class="weekSub">Showing playoff matchups (week {weekGroup.week})</div>
          </div>
          <div class="weekSub">{weekGroup.rows.length} match{weekGroup.rows.length === 1 ? '' : 'es'}</div>
        </div>

        {#each weekGroup.rows as row (row.matchup_id ?? row.combinedLabel ?? Math.random())}
          <div class="matchRow">
            <!-- Team A -->
            <div class="teamCol" style="min-width:260px;">
              {#if row.participantsCount === 1}
                <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="avatar">
                <div class="teamInfo">
                  <div class="teamName">{row.teamA.name}</div>
                  <div class="teamSub">
                    {#if row.teamA.placement}<span class="chip">#{row.teamA.placement}</span>{/if}
                    <span class="teamSub"> {row.teamA.rosterId ?? ''} </span>
                  </div>
                </div>
              {:else if row.participantsCount === 2}
                <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="avatar">
                <div class="teamInfo">
                  <div class="teamName">{row.teamA.name}</div>
                  <div class="teamSub">
                    {#if row.teamA.placement}<span class="chip">#{row.teamA.placement}</span>{/if}
                    <span>Roster {row.teamA.rosterId}</span>
                  </div>
                </div>
              {:else}
                <!-- combined participants -->
                <div class="combinedList">
                  {#each row.combinedParticipants as p (p.rosterId)}
                    <div class="chip">{p.name}</div>
                  {/each}
                </div>
              {/if}
            </div>

            <div class="vsCol">vs</div>

            <!-- Team B -->
            <div class="teamCol" style="min-width:240px;">
              {#if row.participantsCount === 1}
                <div class="teamInfo">
                  <div class="teamName bye">BYE</div>
                </div>
              {:else if row.participantsCount === 2}
                <img class="avatar" src={avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} alt="avatar">
                <div class="teamInfo">
                  <div class="teamName">{row.teamB.name}</div>
                  <div class="teamSub">
                    {#if row.teamB.placement}<span class="chip">#{row.teamB.placement}</span>{/if}
                    <span>Roster {row.teamB.rosterId}</span>
                  </div>
                </div>
              {:else}
                <!-- nothing (already handled above) -->
              {/if}
            </div>

            <!-- score column -->
            <div class="scoreCol" aria-hidden="false">
              {#if row.participantsCount === 2}
                <div>
                  <span class="scoreVal {row.teamA.points > row.teamB.points ? 'winner' : ''}">{fmtPts(row.teamA.points)}</span>
                  <span class="scoreVal"> — </span>
                  <span class="scoreVal {row.teamB.points > row.teamA.points ? 'winner' : ''}">{fmtPts(row.teamB.points)}</span>
                </div>
                <div class="scoreSub">Week {row.week}</div>
              {:else if row.participantsCount === 1}
                <div class="scoreSub">—</div>
                <div class="scoreSub">Week {row.week}</div>
              {:else}
                <div class="scoreSub">{row.combinedLabel}</div>
                <div class="scoreSub">Week {row.week}</div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>
