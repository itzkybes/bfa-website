<script>
  // src/routes/honor-hall/+page.svelte
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  const matchupsRows = Array.isArray(data?.matchupsRows) ? data.matchupsRows : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const finalStandings = Array.isArray(data?.finalStandings) ? data.finalStandings : [];

  // helpers
  function avatarOrPlaceholder(url, name, size = 32) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
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

  // group rows by week for display
  $: groupedByWeek = (() => {
    const map = new Map();
    for (const r of matchupsRows) {
      const wk = r.week ?? 'unknown';
      if (!map.has(wk)) map.set(wk, []);
      map.get(wk).push(r);
    }
    const arr = Array.from(map.entries()).map(([week, rows]) => {
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

  /* messages */
  .messages {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    padding: 14px;
    border-radius: 8px;
    margin-bottom: 1rem;
    color: #cbd5e1;
    font-size: .95rem;
  }

  .weekGroup { margin-top: 1.25rem; margin-bottom: 1.25rem; }
  .weekHeader { display:flex; justify-content:space-between; align-items:center; margin-bottom:.8rem; }
  .weekTitle { font-weight:700; color:#e6eef8; }
  .weekSub { color:#9aa3ad; font-size:.95rem; }

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
  .winner { color: #fff; background: rgba(99,102,241,0.12); padding: 3px 8px; border-radius: 8px; }
  .bye { font-style:italic; color:#9aa3ad; }

  .standings { margin-top: 3rem; }
  .standings h2 { font-size: 1.5rem; margin-bottom: .8rem; }
  table { width:100%; border-collapse: collapse; }
  th, td { padding: 8px 10px; text-align:left; }
  th { background: rgba(255,255,255,0.05); font-weight:600; }
  tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
  td { border-bottom: 1px solid rgba(255,255,255,0.05); }
  .place { font-weight:700; color:#9aa3ad; }
</style>

<div class="container">
  <h1>Honor Hall — Playoff matchups</h1>
  <div class="subtitle">Showing playoff matchups and final standings for {selectedSeason}</div>

  <form id="filters" method="get" class="filters">
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
    <div class="messages">
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
            <div class="weekTitle">{weekGroup.rows[0]?.roundLabel ?? "Week " + weekGroup.week}</div>
            <div class="weekSub">Showing playoff matchups (week {weekGroup.week})</div>
          </div>
          <div class="weekSub">{weekGroup.rows.length} match{weekGroup.rows.length === 1 ? '' : 'es'}</div>
        </div>

        {#each weekGroup.rows as row (row.matchup_id ?? Math.random())}
          <div class="matchRow">
            <!-- Team A -->
            <div class="teamCol" style="min-width:260px;">
              <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="avatar">
              <div class="teamInfo">
                <div class="teamName">{row.teamA.name}</div>
                <div class="teamSub">Seed {row.teamA.seed}</div>
              </div>
            </div>

            <div class="vsCol">vs</div>

            <!-- Team B -->
            <div class="teamCol" style="min-width:240px;">
              <img class="avatar" src={avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} alt="avatar">
              <div class="teamInfo">
                <div class="teamName">{row.teamB.name}</div>
                <div class="teamSub">Seed {row.teamB.seed}</div>
              </div>
            </div>

            <!-- score -->
            <div class="scoreCol">
              <div>
                <span class="scoreVal {row.teamA.points > row.teamB.points ? 'winner' : ''}">{fmtPts(row.teamA.points)}</span>
                <span class="scoreVal"> — </span>
                <span class="scoreVal {row.teamB.points > row.teamA.points ? 'winner' : ''}">{fmtPts(row.teamB.points)}</span>
              </div>
              <div class="scoreSub">{row.roundLabel ?? `Week ${row.week}`}</div>
            </div>
          </div>
        {/each}
      </div>
    {/each}
  {/if}

  <!-- Final Standings -->
  {#if finalStandings && finalStandings.length}
    <div class="standings">
      <h2>Final Standings</h2>
      <table>
        <thead>
          <tr>
            <th>Place</th>
            <th>Team</th>
            <th>Seed</th>
          </tr>
        </thead>
        <tbody>
          {#each finalStandings as team (team.seed)}
            <tr>
              <td class="place">{team.place}</td>
              <td>
                <div style="display:flex;align-items:center;gap:.6rem;">
                  <img class="avatar" src={avatarOrPlaceholder(team.avatar, team.name, 28)} alt="avatar" style="width:28px;height:28px;">
                  {team.name}
                </div>
              </td>
              <td>#{team.seed}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
