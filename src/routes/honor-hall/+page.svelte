<script>
  export let data;
  let { matchupsRows, finalStandings } = data;
</script>

<h1 class="text-2xl font-bold mb-4">Playoffs</h1>

{#each matchupsRows as row}
  <div class="border rounded-lg p-4 mb-2 shadow">
    <div class="text-gray-600 text-sm mb-1">{row.roundLabel}</div>
    <div class="flex justify-between">
      <div>
        <div>{row.teamA?.name} ({row.teamA?.points})</div>
        <div>{row.teamB?.name} ({row.teamB?.points})</div>
      </div>
    </div>
  </div>
{/each}

<h2 class="text-xl font-bold mt-8 mb-2">Final Standings</h2>
<table class="w-full border-collapse">
  <thead>
    <tr class="bg-gray-100">
      <th class="border p-2">Place</th>
      <th class="border p-2">Seed</th>
    </tr>
  </thead>
  <tbody>
    {#each finalStandings as s}
      <tr>
        <td class="border p-2">{s.place}</td>
        <td class="border p-2">{s.seed}</td>
      </tr>
    {/each}
  </tbody>
</table>
