<script>
  export let data;

  const roundNames = {
    1: "Quarterfinals",
    2: "Semifinals",
    3: "Finals"
  };
</script>

<div class="p-6 space-y-10">
  <h1 class="text-3xl font-bold text-center">🏆 Honor Hall – {data.season} Playoffs</h1>

  {#each Object.entries(data.rounds) as [round, matches]}
    <div class="space-y-4">
      <h2 class="text-2xl font-semibold text-gray-800 text-center">
        {roundNames[round] || `Round ${round}`}
      </h2>

      <table class="w-full border-collapse shadow rounded-xl overflow-hidden">
        <thead class="bg-gray-100 text-gray-700">
          <tr>
            <th class="p-3 text-left">Team 1</th>
            <th class="p-3 text-center">Score</th>
            <th class="p-3 text-center">vs</th>
            <th class="p-3 text-center">Score</th>
            <th class="p-3 text-right">Team 2</th>
          </tr>
        </thead>
        <tbody>
          {#each matches as match}
            <tr class="border-b hover:bg-gray-50">
              <td class="p-3 flex items-center space-x-2">
                {#if match.t1?.avatar}
                  <img
                    src={"https://sleepercdn.com/avatars/" + match.t1.avatar}
                    alt={match.t1.display_name}
                    class="w-8 h-8 rounded-full"
                  />
                {/if}
                <span class={match.winner?.roster_id === match.t1?.roster_id
                  ? "font-bold text-green-600"
                  : ""}>
                  {match.t1?.display_name || "TBD"}
                </span>
              </td>

              <td class="p-3 text-center font-medium">
                {match.t1_score ?? "-"}
              </td>

              <td class="p-3 text-center">vs</td>

              <td class="p-3 text-center font-medium">
                {match.t2_score ?? "-"}
              </td>

              <td class="p-3 flex items-center justify-end space-x-2">
                <span class={match.winner?.roster_id === match.t2?.roster_id
                  ? "font-bold text-green-600"
                  : ""}>
                  {match.t2?.display_name || "TBD"}
                </span>
                {#if match.t2?.avatar}
                  <img
                    src={"https://sleepercdn.com/avatars/" + match.t2.avatar}
                    alt={match.t2.display_name}
                    class="w-8 h-8 rounded-full"
                  />
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/each}
</div>
