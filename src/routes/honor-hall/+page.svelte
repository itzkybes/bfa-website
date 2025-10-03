<script>
  export let data;

  const seasons = data?.seasons ?? [];
  const weeks = data?.weeks ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);
  let selectedWeek = Number(data?.selectedWeek ?? (weeks.length ? weeks[weeks.length - 1] : 1));
  if (!selectedWeek || isNaN(selectedWeek) || selectedWeek < 1) selectedWeek = 1;

  const matchupsRows = data?.matchupsRows ?? [];
  const messages = data?.messages ?? [];
  const originalRecords = data?.originalRecords ?? {};

  let showDebug = false; // toggle debug panel

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0D1B2A&color=fff&size=${size}`;
  }

  function fmt2(n) {
    const x = Number(n);
    if (isNaN(x)) return '0.0';
    return x.toFixed(1);
  }

  // Filtered rows for currently selected season
  $: filteredRows = Array.isArray(matchupsRows) && selectedSeason
    ? matchupsRows.filter(r => String(r.season ?? '') === String(selectedSeason))
    : matchupsRows.slice();

  // compute playoff week range from filteredRows
  $: playoffWeeks = (function () {
    let min = null, max = null;
    for (const r of filteredRows) {
      const w = Number(r.week ?? r.w ?? r.week_number ?? NaN);
      if (!isNaN(w)) {
        if (min === null || w < min) min = w;
        if (max === null || w > max) max = w;
      }
    }
    return { min, max };
  })();

  $: playoffRangeLabel = (playoffWeeks.min === null)
    ? 'Playoff matchups'
    : (playoffWeeks.min === playoffWeeks.max)
      ? `Playoff matchups — Week ${playoffWeeks.min}`
      : `Playoff matchups — Weeks ${playoffWeeks.min}–${playoffWeeks.max}`;

  // Group filtered rows by week (sorted)
  $: groupedByWeek = (function () {
    const map = new Map();
    for (const r of filteredRows) {
      const w = Number(r.week ?? r.w ?? r.week_number ?? NaN) || 0;
      if (!map.has(w)) map.set(w, []);
      map.get(w).push(r);
    }
    const entries = Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([week, rows]) => ({ week, rows }));
    return entries;
  })();

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  }
</script>

<style>
  :global(body) { background: linear-gradient(180deg,#070809,#0b0c0f); color: #e6eef8; }

  .page { padding: 1.2rem 1.6rem; max-width: 1100px; margin: 0 auto; }
  .header { display:flex; align-items:center; gap:1rem; margin-bottom: 1rem; }
  h1 { margin:0; font-size:1.25rem; }
  .controls { display:flex; gap:.6rem; align-items:center; margin-left:auto; }
  .select { padding:6px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.04); background:transparent; color:inherit; }
  .muted { color: #9ca3af; font-size:.9rem; }
  .small { font-size:.85rem; color:#9ca3af; }

  .week-header {
    margin-top: 1rem;
    margin-bottom: .5rem;
    font-weight: 700;
    font-size: .98rem;
    color: #e6eef8;
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(255,255,255,0.02);
  }

  table { width:100%; border-collapse:collapse; }
  td { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; }
  .row-card { display:flex; gap:1rem; align-items:center; padding:8px; border-radius:10px; background: rgba(255,255,255,0.01); }
  .team-cell { display:flex; gap:.6rem; align-items:center; min-width:0; }
  .team-name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 260px; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; }

  .score { font-weight:600; padding:6px 10px; border-radius:8px; background: rgba(255,255,255,0.02); color:#e6eef8; }
  .score.winner { background: linear-gradient(180deg, rgba(99,102,241,0.16), rgba(99,102,241,0.22)); color:#fff; }

  .debug-toggle { margin-left:8px; background:transparent; border:1px solid rgba(255,255,255,0.04); color:inherit; padding:6px 8px; border-radius:6px; cursor:pointer; }

  details.note { margin-top:1rem; color:#cfe7f6; }
</style>

<div class="page">
  <div class="header">
    <div>
      <h1>Honor Hall</h1>
      <div class="small">{playoffRangeLabel}</div>
    </div>

    <form id="filters" method="get" class="controls" aria-label="filters">
      <label class="small muted" for="season">Season</label>
      <select id="season" name="season" class="select" on:change={submitFilters} aria-label="Select season">
        {#each seasons as s}
          <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeason)}>{s.season ?? s.name}</option>
        {/each}
      </select>

      <label class="small muted" for="week">Week</label>
      <select id="week" name="week" class="select" on:change={submitFilters} aria-label="Select week">
        {#each weeks as w}
          <option value={w} selected={w === Number(selectedWeek)}>{w}</option>
        {/each}
      </select>

      <noscript><button type="submit" class="select">Go</button></noscript>
      {#if messages && messages.length}
        <button type="button" on:click={() => showDebug = !showDebug} class="debug-toggle">{showDebug ? 'Hide logs' : 'Show logs ('+messages.length+')'}</button>
      {/if}
    </form>
  </div>

  {#if showDebug && messages && messages.length}
    <div style="background:rgba(255,255,255,0.02); padding:10px; border-radius:8px; margin-bottom:1rem;">
      <div class="small" style="font-weight:700; margin-bottom:6px;">Debug</div>
      <ol style="margin:0 0 0 1.1rem; padding:0; color:#cbdff3;">
        {#each messages as m}
          <li style="margin-bottom:6px;">{m}</li>
        {/each}
      </ol>
    </div>
  {/if}

  {#if groupedByWeek.length}
    {#each groupedByWeek as group}
      <div class="week-header">Week {group.week}</div>
      <table aria-labelledby="week-{group.week}">
        <tbody>
          {#each group.rows as row (row.matchup_id ?? row.key)}
            {#if row.participantsCount === 2}
              <tr>
                <td>
                  <div class="row-card">
                    <div class="team-cell" style="min-width:0;">
                      <img class="avatar" src={row.teamA.avatar ? row.teamA.avatar : avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div style="min-width:0;">
                        <div class="team-name">{row.teamA.name}</div>
                        {#if row.teamA.ownerName}<div class="small muted">{row.teamA.ownerName}</div>{/if}
                      </div>
                    </div>

                    <div style="padding:0 0.8rem; color:#9ca3af;">vs</div>

                    <div class="team-cell" style="margin-left:auto; align-items:center;">
                      <div style="text-align:right; margin-right:.6rem;">
                        <div class="team-name">{row.teamB.name}</div>
                        {#if row.teamB.ownerName}<div class="small muted">{row.teamB.ownerName}</div>{/if}
                      </div>
                      <img class="avatar" src={row.teamB.avatar ? row.teamB.avatar : avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} on:error={(e)=>e.target.style.visibility='hidden'} />
                    </div>
                  </div>
                </td>

                <td style="width:130px; text-align:center;">
                  {#if row.teamA.points != null && row.teamB.points != null}
                    <div class="score {row.teamA.points > row.teamB.points ? 'winner' : ''}">{fmt2(row.teamA.points)} — {fmt2(row.teamB.points)}</div>
                  {:else}
                    <div class="score">—</div>
                  {/if}
                </td>

                <td style="width:80px; text-align:center;">
                  <div class="small muted">Week {row.week}</div>
                </td>
              </tr>

            {:else if row.participantsCount === 1}
              <tr>
                <td>
                  <div class="row-card">
                    <div class="team-cell">
                      <img class="avatar" src={row.teamA.avatar ? row.teamA.avatar : avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div style="min-width:0;">
                        <div class="team-name">{row.teamA.name}</div>
                        {#if row.teamA.ownerName}<div class="small muted">{row.teamA.ownerName}</div>{/if}
                      </div>
                    </div>
                    <div style="margin-left:auto; text-align:right;">
                      <div class="small muted">BYE</div>
                    </div>
                  </div>
                </td>
                <td style="text-align:center;"><div class="small muted">Week {row.week}</div></td>
                <td></td>
              </tr>

            {:else}
              <tr>
                <td colspan="3">
                  <div style="font-weight:700; margin-bottom:.4rem;">Multi-Team Matchup — Week {row.week}</div>
                  <table class="inner-table">
                    <thead><tr><th>Team</th><th style="text-align:right">Points</th></tr></thead>
                    <tbody>
                      {#each row.combinedParticipants as p}
                        <tr>
                          <td>
                            <div class="team-cell">
                              <img class="avatar" src={p.avatar ? p.avatar : avatarOrPlaceholder(p.avatar, p.name, 40)} alt="">
                              <div style="margin-left:.6rem;"><div class="team-name">{p.name}</div></div>
                            </div>
                          </td>
                          <td style="text-align:right; font-weight:700;">{fmt2(p.points)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/each}
  {:else}
    <div class="muted">No playoff matchups found for the selected season. Try picking a different season from the dropdown.</div>
  {/if}

  <details class="note">
    <summary>Ownership / Data notes</summary>
    <div style="padding:0.6rem;">
      {#if originalRecords && Object.keys(originalRecords).length}
        {#each Object.keys(originalRecords) as key}
          <div style="margin-bottom:0.6rem;">
            <div style="font-weight:700;">{key}</div>
            <div class="small muted">
              <div>Regular: <strong>{originalRecords[key].regW}</strong> ({fmt2(originalRecords[key].regPF)}, PA {fmt2(originalRecords[key].regPA)})</div>
              <div>Playoffs: <strong>{originalRecords[key].playoffW}</strong> ({fmt2(originalRecords[key].playoffPF)}, PA {fmt2(originalRecords[key].playoffPA)})</div>
              <div>Championships: <strong>{originalRecords[key].championships}</strong></div>
            </div>
          </div>
        {/each}
      {:else}
        <div class="small muted" style="margin-top:.6rem;">No preserved records were supplied in the loader payload — the `Records` page uses a different `load` return payload.</div>
      {/if}
    </div>
  </details>
</div>
