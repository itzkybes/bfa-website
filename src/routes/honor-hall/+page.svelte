<script>
  export let data;

  // standings arrays per year for seeding
  const finalStandings = {
    2024: ["riguy506","smallvt","JakePratt","Kybes","TLupinetti","samsilverman12","armyjunior","JFK4312","WebbWarrior","slawflesh","jewishhorsemen","noahlap01","zamt","WillMichael"],
    2023: ["armyjunior","jewishhorsemen","Kybes","riguy506","zamt","slawflesh","JFK4312","smallvt","samsilverman12","WebbWarrior","TLupinetti","noahlap01","JakePratt","WillMichael"],
    2022: ["riguy506","smallvt","jewishhorsemen","zamt","noahlap01","Kybes","armyjunior","slawflesh","WillMichael","JFK4312","WebbWarrior","TLupinetti","JakePratt","samsilverman12"]
  };

  $: seasonStandings = finalStandings[data.season] || [];

  // attach placement to each team
  function withPlacement(team) {
    if (!team) return team;
    const idx = seasonStandings.findIndex(name => name === team.displayName);
    return { ...team, placement: idx >= 0 ? idx + 1 : 99 };
  }

  $: filteredRows = data.matchupsRows.map(r => ({
    ...r,
    teamA: withPlacement(r.teamA),
    teamB: withPlacement(r.teamB)
  }));

  // split by bracket
  $: winnersRows = filteredRows.filter(r =>
    (r.teamA?.placement ?? 99) <= 8 && (r.teamB?.placement ?? 99) <= 8
  );

  $: losersRows = filteredRows.filter(r =>
    (r.teamA?.placement ?? 99) > 8 && (r.teamB?.placement ?? 99) > 8
  );

  // round labeler
  function labelRound(row, playoffStart, playoffEnd, isWinners) {
    const wk = row.week;
    if (isWinners) {
      if (wk === playoffStart) return "Quarterfinals";
      if (wk === playoffStart + 1) return "Semifinals";
      if (wk === playoffEnd) {
        return "Championship / 3rd Place";
      }
    } else {
      if (wk === playoffStart) return "Consolation Quarterfinals";
      if (wk === playoffStart + 1) return "Consolation Semifinals";
      if (wk === playoffEnd) return "Consolation Finals / Placement Games";
    }
    return "Playoffs";
  }

  $: winnersLabeled = winnersRows.map(r => ({
    ...r,
    roundLabel: labelRound(r, data.playoffStart, data.playoffEnd, true)
  }));

  $: losersLabeled = losersRows.map(r => ({
    ...r,
    roundLabel: labelRound(r, data.playoffStart, data.playoffEnd, false)
  }));
</script>

<div class="container mx-auto p-4">
  <h1 class="text-2xl font-bold mb-4">Playoffs {data.season}</h1>

  <h2 class="text-xl font-semibold mt-6 mb-2">Winners Bracket</h2>
  {#each winnersLabeled as row (row.matchup_id)}
    <div class="weekGroup mb-4 p-3 border rounded">
      <div class="weekHeader flex justify-between mb-2">
        <div class="weekTitle font-semibold">{row.roundLabel}</div>
        <div class="weekSub text-gray-600">Week {row.week}</div>
      </div>
      <div class="matchup">
        <div class="team flex justify-between">
          <span>{row.teamA?.displayName} ({row.teamA?.placement} seed)</span>
          <span>{row.teamA?.points ?? 0}</span>
        </div>
        <div class="team flex justify-between">
          <span>{row.teamB?.displayName} ({row.teamB?.placement} seed)</span>
          <span>{row.teamB?.points ?? 0}</span>
        </div>
      </div>
    </div>
  {/each}

  <h2 class="text-xl font-semibold mt-6 mb-2">Losers Bracket</h2>
  {#each losersLabeled as row (row.matchup_id)}
    <div class="weekGroup mb-4 p-3 border rounded">
      <div class="weekHeader flex justify-between mb-2">
        <div class="weekTitle font-semibold">{row.roundLabel}</div>
        <div class="weekSub text-gray-600">Week {row.week}</div>
      </div>
      <div class="matchup">
        <div class="team flex justify-between">
          <span>{row.teamA?.displayName} ({row.teamA?.placement} seed)</span>
          <span>{row.teamA?.points ?? 0}</span>
        </div>
        <div class="team flex justify-between">
          <span>{row.teamB?.displayName} ({row.teamB?.placement} seed)</span>
          <span>{row.teamB?.points ?? 0}</span>
        </div>
      </div>
    </div>
  {/each}
</div>
