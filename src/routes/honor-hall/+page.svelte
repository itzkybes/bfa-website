<script>
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  const matchupsRows = data?.matchupsRows ?? [];
  const messages = data?.messages ?? [];
  const originalRecords = data?.originalRecords ?? {};

  function avatarOrPlaceholder(url, name, size = 40) {
    if (url) return url;
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

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }
</script>

<style>
  :global(body) { background: #0b0c0f; color: #e6eef8; }

  .page { padding: 1.2rem 1.6rem; max-width: 1100px; margin: 0 auto; }

  h1 { margin-bottom: 1rem; }

  form { margin-bottom: 1rem; }

  .season-label {
    font-weight: 700;
    margin-right: 0.5rem;
    color: #e6eef8;
  }

  .season-select {
    font-size: 1.05rem;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.15);
    background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
    color: #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  }

  table { width:100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  th { text-align: left; font-weight: 700; color:#9ca3af; }
  td { vertical-align: middle; }

  .team { display:flex; align-items:center; gap:.6rem; }
  .team-name { font-weight: 600; }
  .avatar { width:40px; height:40px; border-radius:6px; object-fit:cover; }
  .score { font-weight:600; text-align:center; }
  .winner { color:#fff; background: rgba(99,102,241,0.25); padding:4px 6px; border-radius:6px; }
  .bye { color:#9ca3af; font-style:italic; }
</style>

<div class="page">
  <h1>Honor Hall</h1>

  <form id="filters" method="get">
    <label class="season-label" for="season">Season</label>
    <select id="season" name="season" class="season-select" on:change={submitFilters}>
      {#each seasons as s}
        <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeason)}>
          {s.season ?? s.name}
        </option>
      {/each}
    </select>
  </form>

  {#if filteredRows.length}
    <table>
      <thead>
        <tr>
          <th>Team A</th>
          <th style="text-align:center;">Score</th>
          <th>Team B</th>
          <th style="text-align:center;">Week</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredRows as row (row.matchup_id ?? row.key)}
          {#if row.participantsCount === 2}
            <tr>
              <td>
                <div class="team">
                  <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="">
                  <div>
                    <div class="team-name">{row.teamA.name}</div>
                    {#if row.teamA.ownerName}<div class="small">{row.teamA.ownerName}</div>{/if}
                  </div>
                </div>
              </td>
              <td class="score">
                <span class={row.teamA.points > row.teamB.points ? 'winner' : ''}>{fmt2(row.teamA.points)}</span>
                –
                <span class={row.teamB.points > row.teamA.points ? 'winner' : ''}>{fmt2(row.teamB.points)}</span>
              </td>
              <td>
                <div class="team">
                  <img class="avatar" src={avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} alt="">
                  <div>
                    <div class="team-name">{row.teamB.name}</div>
                    {#if row.teamB.ownerName}<div class="small">{row.teamB.ownerName}</div>{/if}
                  </div>
                </div>
              </td>
              <td style="text-align:center;">{row.week}</td>
            </tr>
          {:else if row.participantsCount === 1}
            <tr>
              <td>
                <div class="team">
                  <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="">
                  <div>
                    <div class="team-name">{row.teamA.name}</div>
                    {#if row.teamA.ownerName}<div class="small">{row.teamA.ownerName}</div>{/if}
                  </div>
                </div>
              </td>
              <td class="score">–</td>
              <td class="bye">BYE</td>
              <td style="text-align:center;">{row.week}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {:else}
    <div>No playoff matchups found for the selected season.</div>
  {/if}
</div>
