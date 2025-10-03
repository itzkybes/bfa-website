<script>
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? null;
  const matchupsRows = data?.matchupsRows ?? [];

  const roundNames = {
    1: "Quarterfinals",
    2: "Semifinals",
    3: "Finals",
    4: "Championship"
  };

  function getRoundLabel(r) {
    return roundNames[r] ?? `Round ${r}`;
  }

  function avatarOrPlaceholder(url, name, size = 40) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0D1B2A&color=fff&size=${size}`;
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }
</script>

<style>
  .page { padding: 1.2rem 1.6rem; max-width: 1000px; margin: auto; }

  h1 { margin-bottom: 1rem; }

  .season-select {
    font-size: 1.1rem;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.2);
    background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04));
    color: #fff;
    font-weight: 600;
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
    <select id="season" name="season" class="season-select" on:change={submitFilters}>
      {#each seasons as s}
        <option value={s.season} selected={s.season === selectedSeason}>{s.name}</option>
      {/each}
    </select>
  </form>

  {#if matchupsRows.length}
    <table>
      <thead>
        <tr>
          <th>Team A</th>
          <th style="text-align:center;">Score</th>
          <th>Team B</th>
          <th style="text-align:center;">Round</th>
        </tr>
      </thead>
      <tbody>
        {#each matchupsRows as row}
          <tr>
            <td>
              {#if row.teamA}
                <div class="team">
                  <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="">
                  <div>
                    <div class="team-name">{row.teamA.name}</div>
                    <div class="small">{row.teamA.ownerName}</div>
                  </div>
                </div>
              {/if}
            </td>

            <td class="score">
              {#if row.teamA && row.teamB}
                <span class={row.teamA.points > row.teamB.points ? 'winner' : ''}>{row.teamA.points}</span>
                –
                <span class={row.teamB.points > row.teamA.points ? 'winner' : ''}>{row.teamB.points}</span>
              {:else}
                <span>–</span>
              {/if}
            </td>

            <td>
              {#if row.teamB}
                <div class="team">
                  <img class="avatar" src={avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} alt="">
                  <div>
                    <div class="team-name">{row.teamB.name}</div>
                    <div class="small">{row.teamB.ownerName}</div>
                  </div>
                </div>
              {:else}
                <span class="bye">BYE</span>
              {/if}
            </td>

            <td style="text-align:center;">{getRoundLabel(row.round)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <div>No playoff matchups found for the selected season.</div>
  {/if}
</div>
