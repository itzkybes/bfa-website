<script>
  export let data;

  // data shape (compatible with existing loader)
  const seasons = data.seasons || [];
  let selectedSeason = data.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);
  const selectedSeasonResult = data.selectedSeasonResult || null;
  const messages = data.messages || [];

  // fallback arrays (may be named differently in your loader — adjust if needed)
  const regularStandings = (selectedSeasonResult && selectedSeasonResult.regularStandings) ? selectedSeasonResult.regularStandings : (selectedSeasonResult && selectedSeasonResult.standings) ? selectedSeasonResult.standings : [];
  const playoffStandings = (selectedSeasonResult && selectedSeasonResult.playoffStandings) ? selectedSeasonResult.playoffStandings : [];

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  }

  function avatarOrPlaceholder(url, name, size = 56) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://via.placeholder.com/${size}?text=${encodeURIComponent(letter)}`;
  }

  function fmtPts(n) { return (n == null) ? '-' : (Math.round(Number(n) * 10) / 10).toFixed(1); }
  function fmtWL(w, l, t) {
    const wv = Number(w ?? 0);
    const lv = Number(l ?? 0);
    const tv = Number(t ?? 0);
    return `${wv}-${lv}${tv ? '-' + tv : ''}`;
  }
  function fmtPct(p) {
    if (p == null) return '-';
    const n = Number(p);
    if (isNaN(n)) return '-';
    return n.toFixed(3).replace(/^0\./,'0.');
  }
</script>

<style>
  :root{
    --card-bg: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    --card-border: rgba(255,255,255,0.03);
    --muted: #9ca3af;
    --text: #e6eef8;
    --accent-outline: rgba(99,102,241,0.06);
  }

  .page { max-width: 1100px; margin: 1.2rem auto; padding: 0 1rem; color: var(--text); }
  .card { background: var(--card-bg); border:1px solid var(--card-border); padding:14px; border-radius:10px; margin-bottom:1rem; }

  /* reuse the select style used in matchups for visual consistency */
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
    box-shadow: 0 6px 20px rgba(2,6,23,0.6), 0 0 0 4px var(--accent-outline);
  }

  .filters { display:flex; gap:.6rem; align-items:center; margin-bottom: .8rem; flex-wrap:wrap; }

  table { width:100%; border-collapse:collapse; }
  thead th { text-align:left; padding:8px 10px; font-size:.85rem; color:var(--muted); text-transform:uppercase; border-bottom:1px solid var(--card-border); }
  td { padding:12px 10px; border-bottom:1px solid var(--card-border); vertical-align:middle; color:var(--text); }

  .team-cell { display:flex; gap:.6rem; align-items:center; min-width:0; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; background:#081018; flex-shrink:0; }
  .team-meta { display:flex; flex-direction:column; min-width:0; }
  .team-name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:420px; }
  .muted { color: var(--muted); font-size:.9rem; }

  /* standings stats column — align right on desktop */
  .stats { text-align:right; min-width:120px; white-space:nowrap; }

  /* highlight winner/top rows optionally */
  .top-row { background: rgba(99,102,241,0.02); border-radius:6px; }

  /* responsive: collapse into card rows on small screens */
  @media (max-width:900px) {
    .filters { flex-direction:column; align-items:stretch; gap:0.5rem; }
    .select { min-width: 100%; width:100%; }
    .card { padding:12px; }

    thead { display:none; }
    tbody { display:block; }
    tbody tr { display:block; margin-bottom:12px; border-radius:10px; background: rgba(255,255,255,0.006); border:1px solid var(--card-border); padding:10px; }
    tbody tr td { display:block; padding:8px 0; border-bottom:none; }

    /* team row layout: avatar + name on left, stats block floats to right */
    .team-row { display:flex; align-items:center; gap:0.6rem; justify-content:space-between; }
    .team-row .left { display:flex; gap:0.6rem; align-items:center; min-width:0; flex:1 1 auto; }
    .team-meta { max-width: calc(100% - 140px); } /* leave room for stats */
    .team-name { max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    .stats { text-align:right; min-width:0; margin-left:auto; display:flex; gap:8px; align-items:center; justify-content:flex-end; }
    .stat-pill { background: rgba(255,255,255,0.01); padding:6px 10px; border-radius:8px; font-weight:700; color:var(--text); min-width:48px; text-align:center; }
    .stat-muted { font-size:.85rem; color:var(--muted); font-weight:600; }

    /* shrink avatar slightly */
    .avatar { width:48px; height:48px; }
  }

  @media (max-width:520px) {
    .avatar { width:40px; height:40px; }
    .team-name { font-size:0.98rem; }
    .stat-pill { padding:5px 8px; font-size:0.95rem; }
  }

  a:focus, button:focus, select:focus {
    outline: 3px solid rgba(0,198,216,0.12);
    outline-offset: 2px;
    border-radius:6px;
  }
</style>

<div class="page">
  <div class="muted" style="margin-bottom:.5rem;">
    {#if messages.length}
      <div><strong>Debug</strong></div>
      {#each messages as m, i}
        <div>{i+1}. {m}</div>
      {/each}
    {/if}
  </div>

  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: .6rem; gap:1rem; flex-wrap:wrap;">
      <div style="min-width:0;">
        <h2 style="margin:0 0 2px 0;">Standings</h2>
        <div class="muted" style="font-size:.95rem;">Choose a season to view standings</div>
      </div>

      <form id="filters" method="get" style="display:flex; gap:.6rem; align-items:center; flex-wrap:wrap;">
        <label class="muted" for="season">Season</label>
        <select id="season" name="season" class="select" on:change={submitFilters} aria-label="Select season">
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>{s.season ?? s.name}</option>
          {/each}
        </select>

        <noscript>
          <button type="submit" class="select" style="cursor:pointer;">Go</button>
        </noscript>
      </form>
    </div>

    {#if regularStandings && regularStandings.length}
      <table aria-label="Standings table">
        <thead>
          <tr>
            <th style="width:60%;">Team</th>
            <th style="width:40%; text-align:right;">Record</th>
          </tr>
        </thead>

        <tbody>
          {#each regularStandings as s, idx}
            <tr class={idx < 1 ? 'top-row' : ''} aria-label={"Standing " + (s.rank ?? idx+1)}>
              <td>
                <div class="team-cell team-row">
                  <div class="left" style="display:flex; align-items:center; gap:.6rem; min-width:0;">
                    <img class="avatar" src={avatarOrPlaceholder(s.avatar || s.team_avatar || s.owner_avatar, s.team_name || s.name)} alt={s.team_name || s.name} on:error={(e)=>e.target.style.visibility='hidden'} />
                    <div class="team-meta">
                      <div class="team-name">{s.team_name ?? s.name ?? s.owner ?? ('Roster ' + (s.roster_id ?? ''))}</div>
                      {#if s.ownerName || s.owner} <div class="muted">{s.ownerName ?? s.owner}</div> {/if}
                    </div>
                  </div>

                  <div class="stats" role="group" aria-label="Team stats">
                    <!-- desktop shows cohesive columns; mobile will display pills -->
                    {#if s.wins != null || s.losses != null}
                      <div class="stat-pill" title="W-L">{fmtWL(s.wins, s.losses, s.ties)}</div>
                    {/if}
                    {#if s.win_pct != null}
                      <div class="stat-pill" title="Win %">{(typeof s.win_pct === 'number') ? s.win_pct.toFixed(3) : s.win_pct}</div>
                    {/if}
                    {#if s.points_for != null}
                      <div class="stat-pill" title="Points For">{fmtPts(s.points_for)}</div>
                    {/if}
                  </div>
                </div>
              </td>

              <td class="stats" style="vertical-align:middle; text-align:right;">
                <!-- fallback numeric display for larger screens -->
                <div style="display:flex; gap:8px; align-items:center; justify-content:flex-end;">
                  {#if s.wins != null || s.losses != null}
                    <div class="muted" style="min-width:80px; text-align:right;">{fmtWL(s.wins, s.losses, s.ties)}</div>
                  {/if}
                  {#if s.win_pct != null}
                    <div class="muted" style="min-width:70px; text-align:right;">{(typeof s.win_pct === 'number') ? s.win_pct.toFixed(3) : s.win_pct}</div>
                  {/if}
                  {#if s.points_for != null}
                    <div style="min-width:72px; font-weight:800; text-align:right;">{fmtPts(s.points_for)}</div>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No standings available for this season.</div>
    {/if}

    {#if playoffStandings && playoffStandings.length}
      <div style="margin-top:1rem;">
        <h3 style="margin:0 0 .4rem 0;">Playoff Standings</h3>
        <table aria-label="Playoff standings">
          <thead>
            <tr>
              <th>Team</th>
              <th style="text-align:right">Record</th>
            </tr>
          </thead>
          <tbody>
            {#each playoffStandings as p}
              <tr>
                <td>
                  <div class="team-cell">
                    <img class="avatar" src={avatarOrPlaceholder(p.avatar, p.name)} alt={p.name} on:error={(e)=>e.target.style.visibility='hidden'} />
                    <div class="team-meta">
                      <div class="team-name">{p.name}</div>
                      {#if p.ownerName}<div class="muted">{p.ownerName}</div>{/if}
                    </div>
                  </div>
                </td>
                <td class="stats" style="text-align:right;">
                  <div>{fmtWL(p.wins, p.losses, p.ties)} • {p.points_for != null ? fmtPts(p.points_for) : '-'}</div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>
