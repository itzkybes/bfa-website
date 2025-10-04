<script>
  export let seasons;
  export let weeks;
  export let selectedSeason;
  export let selectedWeek;
  export let matchupsRows;
  export let finalStandings;
  export let messages;
</script>

<h1 class="text-2xl font-bold mb-4">Matchups – Season {selectedSeason}, Week {selectedWeek}</h1>

{#if messages?.length}
  <div class="mb-4 p-2 bg-yellow-100 border border-yellow-400 rounded">
    {#each messages as m}
      <p>{m}</p>
    {/each}
  </div>
{/if}

<!-- Matchups Table -->
{#if matchupsRows?.length}
  <table class="table-auto border-collapse border border-gray-400 w-full">
    <thead>
      <tr class="bg-gray-200">
        <th class="border border-gray-400 px-4 py-2">Team A</th>
        <th class="border border-gray-400 px-4 py-2">Score</th>
        <th class="border border-gray-400 px-4 py-2">Team B</th>
        <th class="border border-gray-400 px-4 py-2">Score</th>
      </tr>
    </thead>
    <tbody>
      {#each matchupsRows as row}
        {#if row.participantsCount === 2}
          <tr>
            <td class="border border-gray-400 px-4 py-2 flex items-center gap-2">
              {#if row.teamA.avatar}<img src={row.teamA.avatar} alt={row.teamA.name} class="w-6 h-6 rounded-full" />{/if}
              {row.teamA.name}
            </td>
            <td class="border border-gray-400 px-4 py-2">{row.teamA.points}</td>
            <td class="border border-gray-400 px-4 py-2 flex items-center gap-2">
              {#if row.teamB.avatar}<img src={row.teamB.avatar} alt={row.teamB.name} class="w-6 h-6 rounded-full" />{/if}
              {row.teamB.name}
            </td>
            <td class="border border-gray-400 px-4 py-2">{row.teamB.points}</td>
          </tr>
        {:else}
          <tr>
            <td colspan="4" class="border border-gray-400 px-4 py-2">
              {row.combinedLabel} – {row.combinedParticipants.map(p => p.points).join(' / ')}
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
{/if}

<!-- Final Standings -->
{#if finalStandings?.length}
  <h2 class="mt-8 text-xl font-bold">Final Standings</h2>
  <table class="table-auto border-collapse border border-gray-400 w-full mt-2">
    <thead>
      <tr class="bg-gray-200">
        <th class="border border-gray-400 px-4 py-2 text-left">Place</th>
        <th class="border border-gray-400 px-4 py-2 text-left">Team</th>
        <th class="border border-gray-400 px-4 py-2 text-left">Record</th>
        <th class="border border-gray-400 px-4 py-2 text-left">Points For</th>
      </tr>
    </thead>
    <tbody>
      {#each finalStandings as team, i}
        <tr>
          <td class="border border-gray-400 px-4 py-2">{i + 1}</td>
          <td class="border border-gray-400 px-4 py-2 flex items-center gap-2">
            {#if team.avatar}
              <img src={team.avatar} alt={team.name} class="w-6 h-6 rounded-full" />
            {/if}
            {team.name}
          </td>
          <td class="border border-gray-400 px-4 py-2">{team.wins}-{team.losses}{team.ties > 0 ? `-${team.ties}` : ''}</td>
          <td class="border border-gray-400 px-4 py-2">{team.fpts}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
