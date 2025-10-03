<script>
  // src/routes/honor-hall/+page.svelte
  export let data;

  const seasons = data?.seasons ?? [];
  const selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[0].season : null);

  const rows = data?.matchupsRows ?? [];
  const messages = data?.messages ?? [];

  // Group rows by week (sorted)
  $: grouped = (function() {
    const map = new Map();
    for (const r of rows) {
      const w = Number(r.week ?? r.w ?? 0) || 0;
      if (!map.has(w)) map.set(w, []);
      map.get(w).push(r);
    }
    return Array.from(map.entries()).sort((a,b) => a[0] - b[0]).map(([week, items]) => ({ week, items }));
  })();

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  }

  function avatarOrPlaceholder(avatar, name, size = 48) {
    if (avatar) return `https://sleepercdn.com/avatars/${avatar}`;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0D1B2A&color=fff&size=${size}`;
  }

  function fmt(n) {
    const x = Number(n);
    if (isNaN(x) || x === null) return '—';
    return x.toFixed(1).replace(/\.0$/, '');
  }

  const roundNames = {
    1: 'Quarterfinals',
    2: 'Semifinals',
    3: 'Finals'
  };

  function roundLabel(roundIndex) {
    return roundNames[roundIndex] ?? `Round ${roundIndex}`;
  }
</script>

<style>
  :global(body){ background: linear-gradient(180deg,#070809,#0b0c0f); color: #e6eef8; }
  .page { padding: 1.2rem 1.6rem; max-width: 1100px; margin: 0 auto; }
  .header { display:flex; gap:1rem; align-items:center; margin-bottom:1rem; }
  h1 { margin:0; font-size:1.6rem; }
  form.controls { margin-left:auto; display:flex; align-items:center; gap:.6rem; }
  .season-select { font-size:1.02rem; padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); color:inherit; min-width:120px; }
  .muted { color:#9ca3af; font-size:.92rem; }
  .messages { background: rgba(255,255,255,0.02); padding:10px; border-radius:8px; margin-bottom:12px; color:#cfe7f6; }
  .week-header { margin-top: 1rem; margin-bottom: .5rem; font-weight:700; font-size:.98rem; color:#e6eef8; padding:8px 12px; border-radius:8px; background: rgba(255,255,255,0.02); }
  table { width:100%; border-collapse:collapse; }
  th, td { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; }
  thead th { text-align:left; color:#9ca3af; font-weight:700; background: rgba(255,255,255,0.01); }
  .team { display:flex; gap:.6rem; align-items:center; }
  .team-name { font-weight:700; max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; }
  .score { font-weight:700; text-align:center; min-width:80px; }
  .winner { background: linear-gradient(180deg, rgba(99,102,241,0.16), rgba(99,102,241,0.22)); padding:4px 8px; border-radius:8px; color:#fff; display:inline-block; }
  .bye { color:#9ca3af; font-style:italic; }
  .inner-table { width:100%; border-collapse:collapse; }
  .inner-table td { border-bottom: none; padding:6px 8px; }
  .no-data { color:#9ca3af; margin-top:0.6rem; }
</style>

<div class="page">
  <div class="header">
    <div>
      <h1>Honor Hall</h1>
      <div class="muted">Playoff matchups</div>
    </div>

    <form id="filters" method="get" class="controls" aria-label="filters">
      <label class="muted" for="season" style="margin-right:.4rem;">Season</label>
      <select id="season" name="season" class="season-select" on:change={submitFilters}>
        {#each seasons as s}
          <option value={s.season} selected={String(s.season) === String(selectedSeason)}>{s.season}{s.name ? ` — ${s.name}` : ''}</option>
        {/each}
      </select>
    </form>
  </div>

  {#if messages && messages.length}
    <div class="messages" role="status" aria-live="polite">
      {#each messages as m}
        <div>{m}</div>
      {/each}
    </div>
  {/if}

  {#if grouped.length === 0}
    <div class="no-data">No playoff matchups found for the selected season.</div>
  {:else}
    {#each grouped as g, gi}
      <div class="week-header">Week {g.week} — {roundLabel(gi+1)}</div>
      <table>
        <thead>
          <tr>
            <th>Team A</th>
            <th style="text-align:center; width:120px;">Score</th>
            <th style="text-align:center; width:60px;">vs</th>
            <th style="text-align:center; width:120px;">Score</th>
            <th style="text-align:right;">Team B</th>
          </tr>
        </thead>
        <tbody>
          {#each g.items as row (row.matchup_id ?? row.match ?? row.key)}
            {#if row.participantsCount === 2}
              <tr>
                <td>
                  <div class="team">
                    <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="" on:error={(e)=>e.target.src = avatarOrPlaceholder(null, row.teamA.name)} />
                    <div>
                      <div class="team-name">{row.teamA.name}</div>
                      {#if row.teamA.owner_display}<div class="muted" style="font-size:.85rem;">{row.teamA.owner_display}</div>{/if}
                    </div>
                  </div>
                </td>

                <td class="score">
                  {#if row.teamA.points != null}
                    <span class={row.teamA.points > (row.teamB.points ?? -Infinity) ? 'winner' : ''}>{fmt(row.teamA.points)}</span>
                  {:else}
                    <span>—</span>
                  {/if}
                </td>

                <td style="text-align:center;">vs</td>

                <td class="score">
                  {#if row.teamB.points != null}
                    <span class={row.teamB.points > (row.teamA.points ?? -Infinity) ? 'winner' : ''}>{fmt(row.teamB.points)}</span>
                  {:else}
                    <span>—</span>
                  {/if}
                </td>

                <td style="text-align:right;">
                  <div class="team" style="justify-content:flex-end;">
                    <div style="text-align:right;">
                      <div class="team-name">{row.teamB.name}</div>
                      {#if row.teamB.owner_display}<div class="muted" style="font-size:.85rem;">{row.teamB.owner_display}</div>{/if}
                    </div>
                    <img class="avatar" src={avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} alt="" on:error={(e)=>e.target.src = avatarOrPlaceholder(null, row.teamB.name)} />
                  </div>
                </td>
              </tr>

            {:else if row.participantsCount === 1}
              <tr>
                <td>
                  <div class="team">
                    <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="" on:error={(e)=>e.target.src = avatarOrPlaceholder(null, row.teamA.name)} />
                    <div>
                      <div class="team-name">{row.teamA.name}</div>
                      {#if row.teamA.owner_display}<div class="muted" style="font-size:.85rem;">{row.teamA.owner_display}</div>{/if}
                    </div>
                  </div>
                </td>

                <td class="score">—</td>
                <td style="text-align:center;">—</td>
                <td class="score"><span class="bye">BYE</span></td>

                <td style="text-align:right;"></td>
              </tr>

            {:else}
              <tr>
                <td colspan="5">
                  <div style="font-weight:700; margin-bottom:.4rem;">Multi-Team Matchup</div>
                  <table class="inner-table">
                    <tbody>
                      {#each row.combinedParticipants as p}
                        <tr>
                          <td>
                            <div class="team">
                              <img class="avatar" src={avatarOrPlaceholder(p.avatar, p.name, 36)} alt="" on:error={(e)=>e.target.src = avatarOrPlaceholder(null, p.name, 36)} />
                              <div style="margin-left:.5rem;">
                                <div style="font-weight:700;">{p.name}</div>
                              </div>
                            </div>
                          </td>
                          <td style="text-align:right; font-weight:700; width:120px;">{fmt(p.points)}</td>
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
  {/if}
</div>
