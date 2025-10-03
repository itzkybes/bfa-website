<script>
  export let data;

  const seasons = data?.seasons ?? [];
  const weeks = data?.weeks ?? [];
  // Use selectedSeason from loader or default to most recent season in chain
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);
  let selectedWeek = Number(data?.selectedWeek ?? (weeks.length ? weeks[weeks.length - 1] : 1));
  if (!selectedWeek || isNaN(selectedWeek) || selectedWeek < 1) selectedWeek = 1;

  const matchupsRows = data?.matchupsRows ?? [];
  const messages = data?.messages ?? [];
  const originalRecords = data?.originalRecords ?? {};

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
    // sort participants inside each week and produce an array of { week, rows }
    const entries = Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([week, rows]) => {
      // keep original order-ish but ensure pair rows before multi maybe
      return { week, rows };
    });
    return entries;
  })();

  // small helper to determine winner styling
  function winnerClass(aPts, bPts) {
    if (aPts == null || bPts == null) return '';
    if (aPts > bPts) return 'winnerA';
    if (bPts > aPts) return 'winnerB';
    return 'tie';
  }
</script>

<style>
  .page { padding: 1rem; }
  .muted { color: #9ca3af; font-size:.9rem; }
  .controls { display:flex; gap:.8rem; align-items:center; margin-bottom:0.8rem; }
  .select { padding:6px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.06); background:transparent; color:inherit; }
  .week-header {
    margin-top: 1rem;
    margin-bottom: .5rem;
    font-weight: 700;
    font-size: 1rem;
    color: #e6eef8;
    background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
    padding: 8px 12px;
    border-radius: 8px;
  }

  /* Table layout modeled on Matchups tab */
  table { width:100%; border-collapse:collapse; }
  thead th { text-align:left; padding:8px 10px; font-size:.85rem; color:#9ca3af; }
  td { padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; color:#e6eef8; }

  .row-card { display:flex; gap:1rem; align-items:center; padding:10px; border-radius:10px; background: rgba(255,255,255,0.01); transition: box-shadow .12s ease, transform .06s ease; }
  .row-card:hover { box-shadow: 0 8px 30px rgba(2,6,23,0.45); transform: translateY(-2px); }

  .team-cell { display:flex; gap:.6rem; align-items:center; min-width:0; }
  .team-meta { display:flex; flex-direction:column; min-width:0; }
  .team-name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 320px; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; background:#081018; flex-shrink:0; }

  .score { margin-left:auto; font-weight:600; white-space:nowrap; padding:6px 10px; display:inline-block; min-width:72px; text-align:center; border-radius:8px; }
  .score.winner { background: linear-gradient(180deg, rgba(99,102,241,0.16), rgba(99,102,241,0.22)); color:#eef8ff; }
  .score.tie { background: rgba(255,255,255,0.02); color: #e6eef8; font-weight:700; }

  /* table-row style for non-table layout (we'll keep using table rows but style inner content) */
  .muted-small { color:#9ca3af; font-size:.85rem; }

  .inner-table { width:100%; border-collapse:collapse; margin-top:.6rem; }
  .inner-table th { text-align:left; color:#9ca3af; font-size:.8rem; padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.03); }
  .inner-table td { padding:8px 8px; }

  @media (max-width:900px) {
    .avatar { width:44px; height:44px; }
    .score { padding:5px 8px; min-width:56px; }
  }
</style>

<div class="page">
  <div class="muted" style="margin-bottom:.5rem;">
    {#if messages && messages.length}
      <div><strong>Debug</strong></div>
      {#each messages as m, i}
        <div>{i+1}. {m}</div>
      {/each}
    {/if}
  </div>

  <!-- Controls -->
  <div class="controls">
    <div>
      <label class="muted">Season</label><br/>
      <select class="select" bind:value={selectedSeason}>
        {#each seasons as s}
          <option value={s.league_id}>{s.name ?? s.season}</option>
        {/each}
      </select>
    </div>

    <div>
      <label class="muted">Week</label><br/>
      <select class="select" bind:value={selectedWeek}>
        {#each weeks as w}
          <option value={w}>{w}</option>
        {/each}
      </select>
    </div>

    <div style="margin-left:auto; display:flex; flex-direction:column; align-items:flex-end;">
      <div style="font-weight:700;">{playoffRangeLabel}</div>
      <div class="muted-small">Showing season: {#if selectedSeason}{(seasons.find(s=>String(s.league_id)===String(selectedSeason))?.name ?? selectedSeason)}{:else}All{/if}</div>
    </div>
  </div>

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
                      <div class="team-meta" style="min-width:0;">
                        <div class="team-name">{row.teamA.name}</div>
                        {#if row.teamA.ownerName}<div class="muted">{row.teamA.ownerName}</div>{/if}
                      </div>
                    </div>

                    <div style="padding:0 0.8rem; color:#9ca3af;">vs</div>

                    <div class="team-cell" style="margin-left:auto; align-items:center;">
                      <div style="text-align:right; margin-right:.6rem;">
                        <div class="team-name">{row.teamB.name}</div>
                        {#if row.teamB.ownerName}<div class="muted">{row.teamB.ownerName}</div>{/if}
                      </div>
                      <img class="avatar" src={row.teamB.avatar ? row.teamB.avatar : avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} on:error={(e)=>e.target.style.visibility='hidden'} />
                    </div>
                  </div>
                </td>

                <td style="width:120px; text-align:center;">
                  <div class={row.teamA.points != null && row.teamB.points != null ? (row.teamA.points > row.teamB.points ? 'score winner' : (row.teamA.points === row.teamB.points ? 'score tie' : 'score')) : 'score'}>
                    {#if row.teamA.points != null && row.teamB.points != null}
                      {#if row.teamA.points > row.teamB.points}
                        {fmt2(row.teamA.points)} — {fmt2(row.teamB.points)}
                      {:else if row.teamA.points === row.teamB.points}
                        {fmt2(row.teamA.points)} — {fmt2(row.teamB.points)}
                      {:else}
                        {fmt2(row.teamA.points)} — {fmt2(row.teamB.points)}
                      {/if}
                    {:else}
                      {#if row.teamA.points != null}{fmt2(row.teamA.points)}{:else if row.teamB.points != null}{fmt2(row.teamB.points)}{:else}—{/if}
                    {/if}
                  </div>
                </td>

                <td style="width:80px; text-align:center;">
                  <div class="muted">Week {row.week}</div>
                </td>
              </tr>

            {:else if row.participantsCount === 1}
              <!-- BYE -->
              <tr>
                <td>
                  <div class="row-card">
                    <div class="team-cell">
                      <img class="avatar" src={row.teamA.avatar ? row.teamA.avatar : avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div class="team-meta" style="min-width:0;">
                        <div class="team-name">{row.teamA.name}</div>
                        {#if row.teamA.ownerName}<div class="muted">{row.teamA.ownerName}</div>{/if}
                      </div>
                    </div>
                    <div style="margin-left:auto; text-align:right;">
                      <div class="muted">BYE</div>
                    </div>
                  </div>
                </td>
                <td style="text-align:center;">
                  <div class="muted">Week {row.week}</div>
                </td>
                <td></td>
              </tr>

            {:else}
              <!-- multi-team -->
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
                              <div class="team-meta">
                                <div class="team-name">{p.name}</div>
                              </div>
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

  <details class="note" style="margin-top:1rem;">
    <summary>Ownership / Data notes</summary>
    <div style="padding:0.6rem;">
      {#if originalRecords && Object.keys(originalRecords).length}
        {#each Object.keys(originalRecords) as key}
          <div style="margin-bottom:0.6rem;">
            <div style="font-weight:700;">{key}</div>
            <div class="muted" style="font-size:.9rem;">
              <div>Regular: <strong>{originalRecords[key].regW}</strong> ({fmt2(originalRecords[key].regPF)}, PA {fmt2(originalRecords[key].regPA)})</div>
              <div>Playoffs: <strong>{originalRecords[key].playoffW}</strong> ({fmt2(originalRecords[key].playoffPF)}, PA {fmt2(originalRecords[key].playoffPA)})</div>
              <div>Championships: <strong>{originalRecords[key].championships}</strong></div>
            </div>
          </div>
        {/each}
      {:else}
        <div class="muted" style="margin-top:.6rem;">No preserved records were supplied in the loader payload — the `Records` page uses a different `load` return payload.</div>
      {/if}
    </div>
  </details>
</div>
