<script>
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  const matchupsRows = data?.matchupsRows ?? [];
  const messages = data?.messages ?? [];

  function avatarOrPlaceholder(url, name, size = 40) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0D1B2A&color=fff&size=${size}`;
  }

  function fmt2(n) {
    if (n == null) return '—';
    const x = Number(n);
    if (isNaN(x)) return '—';
    return x.toFixed(2);
  }

  $: filteredRows = Array.isArray(matchupsRows) && selectedSeason
    ? matchupsRows.filter(r => String(r.season ?? '') === String(selectedSeason))
    : matchupsRows.slice();

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }
</script>

<style>
  :global(body) { background: #0b0c0f; color: #e6eef8; }

  .page { padding: 1.2rem 1.6rem; max-width: 1100px; margin: 0 auto; }

  h1 { margin-bottom: 0.6rem; }

  .controls { display:flex; justify-content:flex-end; gap:12px; margin-bottom:12px; align-items:center; }
  .season-select {
    font-size: 1rem;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.02);
    color: #fff;
  }

  .messages { margin-bottom: 12px; color:#cbd5e1; background: rgba(255,255,255,0.02); padding:10px; border-radius:8px; }

  table { width:100%; border-collapse: collapse; margin-top: 6px; background: rgba(255,255,255,0.01); border-radius:8px; overflow:hidden; }
  thead th { text-align:left; padding:12px; background: rgba(255,255,255,0.02); color:#9ca3af; font-weight:700; }
  td { padding:12px; border-bottom: 1px solid rgba(255,255,255,0.03); vertical-align:middle; }
  .team { display:flex; align-items:center; gap:.6rem; }
  .avatar { width:44px; height:44px; border-radius:8px; object-fit:cover; background:#091018; }
  .team-name { font-weight:700; display:flex; gap:8px; align-items:center; }
  .placement { font-weight:700; background:rgba(255,255,255,0.04); padding:3px 6px; border-radius:6px; color:#cbd5e1; font-size:0.85rem; }
  .score { text-align:center; font-weight:700; }
  .bye { color:#9ca3af; font-style:italic; }
</style>

<div class="page">
  <h1>Honor Hall — Playoff matchups (showing selected season)</h1>

  <form id="filters" method="get" class="controls">
    <label for="season" style="color:#cbd5e1;margin-right:8px;">Season</label>
    <select id="season" name="season" class="season-select" on:change={submitFilters}>
      {#each seasons as s}
        <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeason)}>
          {s.season ?? s.name}
        </option>
      {/each}
    </select>
  </form>

  {#if messages && messages.length}
    <div class="messages">
      {#each messages as m}
        <div>{m}</div>
      {/each}
    </div>
  {/if}

  {#if filteredRows.length}
    <table role="table" aria-label="Playoff matchups">
      <thead>
        <tr>
          <th>Team A</th>
          <th style="width:120px; text-align:center;">Score</th>
          <th>Team B</th>
          <th style="width:80px; text-align:center;">Week</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredRows as row (row.matchup_id ?? Math.random())}
          {#if row.participantsCount === 2}
            <tr>
              <td>
                <div class="team">
                  <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="avatar">
                  <div>
                    <div class="team-name">
                      <span>{row.teamA.name}</span>
                      {#if row.teamA.placement}
                        <span class="placement">#{row.teamA.placement}</span>
                      {/if}
                    </div>
                    {#if row.teamA.rosterId}<div class="small">#{row.teamA.rosterId}</div>{/if}
                  </div>
                </div>
              </td>

              <td class="score">
                {fmt2(row.teamA.points)} — {fmt2(row.teamB.points)}
              </td>

              <td>
                <div class="team">
                  <img class="avatar" src={avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} alt="avatar">
                  <div>
                    <div class="team-name">
                      <span>{row.teamB.name}</span>
                      {#if row.teamB.placement}
                        <span class="placement">#{row.teamB.placement}</span>
                      {/if}
                    </div>
                    {#if row.teamB.rosterId}<div class="small">#{row.teamB.rosterId}</div>{/if}
                  </div>
                </div>
              </td>

              <td style="text-align:center;">{row.week ?? 'TBD'}</td>
            </tr>
          {:else if row.participantsCount === 1}
            <tr>
              <td>
                <div class="team">
                  <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="avatar">
                  <div>
                    <div class="team-name">
                      <span>{row.teamA.name}</span>
                      {#if row.teamA.placement}
                        <span class="placement">#{row.teamA.placement}</span>
                      {/if}
                    </div>
                    {#if row.teamA.rosterId}<div class="small">#{row.teamA.rosterId}</div>{/if}
                  </div>
                </div>
              </td>
              <td class="score">—</td>
              <td class="bye">BYE</td>
              <td style="text-align:center;">{row.week ?? 'TBD'}</td>
            </tr>
          {:else}
            <tr>
              <td colspan="4">Multiple participants: {row.combinedLabel ?? (row.combinedParticipants && row.combinedParticipants.map(p=>p.name).join(', '))}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {:else}
    <div style="margin-top:1rem;color:#9ca3af;">No playoff matchups found for the selected season. Try picking a different season from the dropdown.</div>
  {/if}
</div>
