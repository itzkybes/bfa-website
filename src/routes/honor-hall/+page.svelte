<script>
  // src/routes/honor-hall/+page.svelte
  export let data;

  import PlayoffBrackets from '$lib/PlayoffBrackets.svelte';

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[0].season : null);

  const matchupsRows = data?.matchupsRows ?? [];
  const standings = data?.standings ?? null;
  const messages = data?.messages ?? [];

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  }

  function avatarOrPlaceholder(avatar, name, size = 64) {
    if (avatar) return avatar;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0D1B2A&color=fff&size=${size}`;
  }

  function fmt2(n) {
    const x = Number(n);
    if (isNaN(x)) return '0.0';
    return x.toFixed(1);
  }

  $: filteredRows = Array.isArray(matchupsRows) && selectedSeason
    ? matchupsRows.filter(r => String(r.season ?? '') === String(selectedSeason))
    : matchupsRows.slice();

  // group by week for fallback rendering
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

  const roundNames = { 1: 'Quarterfinals', 2: 'Semifinals', 3: 'Finals' };
  function roundLabel(idx) { return roundNames[idx] ?? `Round ${idx}`; }
</script>

<style>
  :global(body){ background: linear-gradient(180deg,#070809,#0b0c0f); color: #e6eef8; }
  .page { padding: 1.2rem 1.6rem; max-width: 1100px; margin: 0 auto; }
  .header { display:flex; gap:1rem; align-items:center; margin-bottom:1rem; }
  h1 { margin:0; font-size:1.25rem; }
  .controls { display:flex; gap:.6rem; align-items:center; margin-left:auto; }
  .season-select { padding:6px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); color:inherit; font-weight:600; }
  .muted { color:#9ca3af; font-size:.9rem; }
  .week-header { margin-top: 1rem; margin-bottom: .5rem; font-weight: 700; font-size: .98rem; color: #e6eef8; padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.02); }
  .row-card { display:flex; gap:1rem; align-items:center; padding:8px; border-radius:10px; background: rgba(255,255,255,0.01); }
  .team-cell { display:flex; gap:.6rem; align-items:center; min-width:0; }
  .team-name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 260px; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; }
  .score { font-weight:600; padding:6px 10px; border-radius:8px; background: rgba(255,255,255,0.02); color:#e6eef8; }
  .score.winner { background: linear-gradient(180deg, rgba(99,102,241,0.16), rgba(99,102,241,0.22)); color:#fff; }
  .messages { background: rgba(255,255,255,0.02); padding:8px; border-radius:8px; margin-bottom:12px; color:#cfe7f6; }
</style>

<div class="page">
  <div class="header">
    <div>
      <h1>Honor Hall</h1>
      <div class="muted">Playoff view</div>
    </div>

    <form id="filters" method="get" class="controls" aria-label="filters">
      <label class="muted" for="season">Season</label>
      <select id="season" name="season" class="season-select" on:change={submitFilters} aria-label="Select season">
        {#each seasons as s}
          <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeason)}>{s.season ?? s.name}</option>
        {/each}
      </select>
    </form>
  </div>

  {#if messages && messages.length}
    <div class="messages">
      {#each messages as m}
        <div>{m}</div>
      {/each}
    </div>
  {/if}

  {#if standings && Array.isArray(standings) && standings.length}
    <!-- Render generated brackets from standings -->
    <PlayoffBrackets standings={standings} season={selectedSeason} titlePrefix={String(selectedSeason)} />
  {:else}
    <!-- Fallback: render playoff matchups grouped by week -->
    {#if groupedByWeek.length}
      {#each groupedByWeek as group, gi}
        <div class="week-header">Week {group.week} — {roundLabel(gi+1)}</div>
        <table style="width:100%; border-collapse:collapse;">
          <tbody>
            {#each group.rows as row (row.matchup_id ?? row.key)}
              {#if row.participantsCount === 2}
                <tr>
                  <td style="padding:10px;">
                    <div class="row-card">
                      <div class="team-cell" style="min-width:0;">
                        <img class="avatar" src={row.teamA.avatar ? row.teamA.avatar : avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} on:error={(e)=>e.target.style.visibility='hidden'} />
                        <div style="min-width:0;">
                          <div class="team-name">{row.teamA.name}</div>
                          {#if row.teamA.owner_display}<div class="muted">{row.teamA.owner_display}</div>{/if}
                        </div>
                      </div>

                      <div style="padding:0 0.8rem; color:#9ca3af;">vs</div>

                      <div class="team-cell" style="margin-left:auto; align-items:center;">
                        <div style="text-align:right; margin-right:.6rem;">
                          <div class="team-name">{row.teamB.name}</div>
                          {#if row.teamB.owner_display}<div class="muted">{row.teamB.owner_display}</div>{/if}
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
                </tr>

              {:else if row.participantsCount === 1}
                <tr>
                  <td style="padding:10px;">
                    <div class="row-card">
                      <div class="team-cell">
                        <img class="avatar" src={row.teamA.avatar ? row.teamA.avatar : avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} on:error={(e)=>e.target.style.visibility='hidden'} />
                        <div style="min-width:0;">
                          <div class="team-name">{row.teamA.name}</div>
                          {#if row.teamA.owner_display}<div class="muted">{row.teamA.owner_display}</div>{/if}
                        </div>
                      </div>
                      <div style="margin-left:auto; text-align:right;">
                        <div class="muted">BYE</div>
                      </div>
                    </div>
                  </td>
                  <td style="text-align:center;"><div class="muted">Week {row.week}</div></td>
                </tr>

              {:else}
                <tr>
                  <td colspan="2" style="padding:10px;">
                    <div style="font-weight:700; margin-bottom:.4rem;">Multi-Team Matchup — Week {row.week}</div>
                    <table style="width:100%; border-collapse:collapse;">
                      <thead><tr><th style="text-align:left; color:#9ca3af; padding:6px 8px;">Team</th><th style="text-align:right; color:#9ca3af; padding:6px 8px;">Points</th></tr></thead>
                      <tbody>
                        {#each row.combinedParticipants as p}
                          <tr>
                            <td style="padding:6px 8px;">
                              <div class="team-cell">
                                <img class="avatar" src={p.avatar ? p.avatar : avatarOrPlaceholder(p.avatar, p.name, 40)} alt="">
                                <div style="margin-left:.6rem;">
                                  <div class="team-name" style="font-weight:700;">{p.name}</div>
                                </div>
                              </div>
                            </td>
                            <td style="padding:6px 8px; text-align:right; font-weight:700;">{fmt2(p.points)}</td>
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
      <div class="muted">No playoff matchups or standings found for the selected season.</div>
    {/if}
  {/if}
</div>
