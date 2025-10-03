<script>
  export let data;

  const roundNames = {
    1: 'Quarterfinals',
    2: 'Semifinals',
    3: 'Finals',
    4: 'Championship'
  };

  function getRoundLabel(r) {
    return roundNames[r] ?? `Round ${r}`;
  }

  function avatarUrl(a) {
    return a ? `https://sleepercdn.com/avatars/${a}` : null;
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  }
</script>

<style>
  .page { padding: 1.2rem 1.6rem; max-width: 1100px; margin: 0 auto; color: #e6eef8; }
  .header { display:flex; gap:1rem; align-items:center; margin-bottom:1rem; }
  .season-select { font-size:1.05rem; padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); color:inherit; }
  .round-title { font-weight:700; font-size:1.05rem; margin: 1rem 0 .6rem; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-weight:700; color:#9ca3af; padding:10px; }
  td { padding:10px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; color:inherit; }
  .team { display:flex; gap:.6rem; align-items:center; }
  .avatar { width:40px; height:40px; border-radius:6px; object-fit:cover; }
  .score { text-align:center; font-weight:700; }
  .winner { color:#fff; background: rgba(99,102,241,0.2); padding:4px 6px; border-radius:6px; }
  .muted { color:#9ca3af; font-size:.9rem; }
  .messages { background: rgba(255,255,255,0.02); padding:8px; border-radius:8px; margin-bottom:12px; color:#cfe7f6; }
</style>

<div class="page">
  <div class="header">
    <h1 style="margin:0;">Honor Hall</h1>

    <form id="filters" method="get" style="margin-left:auto;">
      <label class="muted" for="season">Season</label>
      <select id="season" name="season" class="season-select" on:change={submitFilters}>
        {#each data.seasons as s}
          <option value={s.season} selected={String(s.season) === String(data.selectedSeason)}>{s.season}</option>
        {/each}
      </select>
    </form>
  </div>

  {#if data.messages && data.messages.length}
    <div class="messages">
      {#each data.messages as m}
        <div>{m}</div>
      {/each}
    </div>
  {/if}

  {#if Object.keys(data.rounds || {}).length === 0}
    <div class="muted">No playoff bracket found for the selected season.</div>
  {:else}
    {#each Object.entries(data.rounds) as [round, matches]}
      <div>
        <div class="round-title">{getRoundLabel(Number(round))}</div>

        <table>
          <thead>
            <tr>
              <th>Team A</th>
              <th style="text-align:center;">Score</th>
              <th style="text-align:center;">vs</th>
              <th style="text-align:center;">Score</th>
              <th style="text-align:right;">Team B</th>
            </tr>
          </thead>
          <tbody>
            {#each matches as m}
              <tr>
                <td>
                  {#if m.t1}
                    <div class="team">
                      {#if m.t1.avatar}<img class="avatar" src={avatarUrl(m.t1.avatar)} alt="avatar" />{/if}
                      <div>
                        <div style="font-weight:700">{m.t1.display_name}</div>
                        {#if m.t1.owner_display}<div class="muted">{m.t1.owner_display}</div>{/if}
                      </div>
                    </div>
                  {:else}
                    <div class="muted">TBD</div>
                  {/if}
                </td>

                <td class="score">
                  {#if m.t1_points != null}{m.t1_points}{:else}-{/if}
                </td>

                <td style="text-align:center;">vs</td>

                <td class="score">
                  {#if m.t2_points != null}{m.t2_points}{:else}-{/if}
                </td>

                <td style="text-align:right;">
                  {#if m.t2}
                    <div class="team" style="justify-content:flex-end;">
                      <div style="text-align:right;">
                        <div style="font-weight:700">{m.t2.display_name}</div>
                        {#if m.t2.owner_display}<div class="muted">{m.t2.owner_display}</div>{/if}
                      </div>
                      {#if m.t2.avatar}<img class="avatar" src={avatarUrl(m.t2.avatar)} alt="avatar" />{/if}
                    </div>
                  {:else}
                    <div class="muted">TBD</div>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/each}
  {/if}
</div>
