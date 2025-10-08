<script context="module">
  export const prerender = false;
</script>

<script>
  export let data;

  const { finalStandings = [], finalStandingsBySeason = {} } = data ?? {};

  let selectedSeasonIndex = 0;

  $: selectedSeason = finalStandings[selectedSeasonIndex] ?? null;
  $: selectedLeagueId = selectedSeason ? selectedSeason.leagueId : null;

  // prefer precomputed champion
  $: champion =
    (selectedLeagueId && finalStandingsBySeason[selectedLeagueId] && finalStandingsBySeason[selectedLeagueId].champion) ||
    (selectedSeason && selectedSeason.finalStandings && selectedSeason.finalStandings.length ? selectedSeason.finalStandings[0] : null);

  // prefer precomputed standings
  $: displayedStandings =
    (selectedLeagueId && finalStandingsBySeason[selectedLeagueId] && finalStandingsBySeason[selectedLeagueId].standings) ||
    (selectedSeason && selectedSeason.finalStandings) ||
    [];
</script>

<svelte:head>
  <title>Honor Hall</title>
</svelte:head>

<section class="container mx-auto p-4">
  <h1 class="text-3xl font-bold mb-4">Honor Hall</h1>

  {#if finalStandings.length === 0}
    <div class="prose">
      <p>
        No season mapping found. Add <code>src/lib/data/seasons.json</code> (optional), or set <code>BASE_LEAGUE_ID</code> / <code>VITE_LEAGUE_ID</code> in your environment.
      </p>
    </div>
  {/if}

  {#if finalStandings.length > 1}
    <div class="mb-4 flex items-center">
      <label class="mr-2 font-medium">Season</label>
      <select bind:value={selectedSeasonIndex} class="px-2 py-1 border rounded">
        {#each finalStandings as s, idx}
          <option value={idx}>{s.label ?? s.seasonKey}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    <div class="p-4 border rounded">
      <h2 class="text-xl font-semibold">Champion</h2>
      {#if champion}
        <div class="mt-3">
          <div class="flex items-center space-x-3">
            {#if champion.team_avatar}
              <img src={champion.team_avatar} alt="avatar" class="w-16 h-16 rounded-full object-cover" />
            {/if}
            <div>
              <div class="text-lg font-bold">{champion.team_name ?? champion.team ?? 'Unnamed Team'}</div>
              {#if champion.owner_name}
                <div class="text-sm text-gray-600">Owner: {champion.owner_name}</div>
              {/if}
              {#if champion.rosterId}
                <div class="text-xs text-gray-500">Roster ID: {champion.rosterId}</div>
              {/if}
            </div>
          </div>

          {#if selectedLeagueId && finalStandingsBySeason[selectedLeagueId]}
            <div class="mt-3 text-sm text-gray-700">
              <div>Playoff start: {finalStandingsBySeason[selectedLeagueId].playoffStart ?? '—'}</div>
              <div>Total playoff points (top roster): {finalStandingsBySeason[selectedLeagueId].playoffTotals?.[champion.rosterId] ?? '—'}</div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="mt-3 text-sm text-gray-700">
          Champion not available for this season.
        </div>
      {/if}
    </div>

    <div class="md:col-span-2 p-4 border rounded">
      <h2 class="text-xl font-semibold">Final Standings</h2>

      {#if displayedStandings.length === 0}
        <p class="text-sm text-gray-600 mt-2">No standings available for this season.</p>
      {:else}
        <ol class="mt-2 ml-4 list-decimal">
          {#each displayedStandings as row}
            <li class="text-sm">
              {row.team_name ?? row.owner_name ?? row.rosterId} — {row.wins ?? ''}W {row.losses ?? ''}L {row.points_for ? `• ${row.points_for} pts` : ''}
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </div>
</section>

<style>
  .container { max-width: 1000px; }
</style>
