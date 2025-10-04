<script>
  export let season;
  export let matchupsRows;
  export let finalStandings;
</script>

<h1 class="text-2xl font-bold mb-4">Playoffs {season}</h1>

<!-- Matchups -->
{#each matchupsRows as row}
  <div class="border rounded mb-2 p-2">
    <div class="font-semibold">{row.roundLabel}</div>
    <div>{row.home.name} ({row.home.score}) vs {row.away.name} ({row.away.score})</div>
  </div>
{/each}

<!-- Final Standings -->
<h2 class="text-xl font-bold mt-8 mb-2">Final Standings</h2>
<table class="w-full border-collapse">
  <thead>
    <tr class="bg-gray-100">
      <th class="border p-2">Place</th>
      <th class="border p-2">Seed</th>
      <th class="border p-2">Team</th>
    </tr>
  </thead>
  <tbody>
    {#each finalStandings as s}
      <tr>
        <td class="border p-2">{s.place}</td>
        <td class="border p-2">{s.seed}</td>
        <td class="border p-2">{s.teamName}</td>
      </tr>
    {/each}
  </tbody>
</table>
