<script context="module">
  // keep server rendering (not prerendered) so the server load can compute/cache champions
  export const prerender = false;
</script>

<script>
  // data injected by page.server.js
  export let data;

  // finalStandings: array of season descriptors { seasonKey, leagueId, label, finalStandings }
  // finalStandingsBySeason: { "<leagueId>": { standings, champion, playoffTotals, playoffStart, meta } }
  const { finalStandings = [], finalStandingsBySeason = {} } = data ?? {};

  // UI state
  let selectedSeasonIndex = 0;

  $: selectedSeason = finalStandings[selectedSeasonIndex] ?? null;
  $: selectedLeagueId = selectedSeason ? selectedSeason.leagueId : null;
  $: selectedSeasonKey = selectedSeason ? selectedSeason.seasonKey : null;

  // prefer the cached precomputed champion for the selected league, fallback to season.finalStandings[0]
  $: champion =
    (selectedLeagueId && finalStandingsBySeason[selectedLeagueId] && finalStandingsBySeason[selectedLeagueId].champion) ||
    (selectedSeason && selectedSeason.finalStandings && selectedSeason.finalStandings.length ? selectedSeason.finalStandings[0] : null);

  // derive displayed standings: either the precomputed standings or the server-provided finalStandings entry
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
        No season data found. If your project maintains a seasons mapping, place it in <code>$lib/data/seasons.json</code>,
        or set <code>BASE_LEAGUE_ID</code> (or <code>VITE_LEAGUE_ID</code>) in your environment so the server can discover which league(s) to compute.
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
    <div class="col-span-1 md:col-span-1 p-4 border rounded">
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
          Champion not available for this season yet (server could not compute or no league mapping found).
        </div>
      {/if}
    </div>

    <div class="col-span-1 md:col-span-2 p-4 border rounded">
      <h2 class="text-xl font-semibold">Past Champions & Final Standings</h2>

      {#if finalStandings.length === 0}
        <p class="text-sm text-gray-600">No final standings data was returned from the server.</p>
      {/if}

      <div class="mt-3 space-y-4">
        {#each finalStandings as season}
          <div class="p-3 bg-gray-50 rounded border">
            <div class="flex justify-between items-center">
              <div>
                <div class="font-semibold">{season.label ?? season.seasonKey}</div>
                <div class="text-xs text-gray-500">League ID: {season.leagueId}</div>
              </div>

              <div class="text-right">
                {#if finalStandingsBySeason && finalStandingsBySeason[season.leagueId] && finalStandingsBySeason[season.leagueId].champion}
                  <div class="text-sm">Cached champion: {finalStandingsBySeason[season.leagueId].champion.team_name}</div>
                {:else}
                  <div class="text-sm text-gray-500">Champion not cached</div>
                {/if}
              </div>
            </div>

            {#if (finalStandingsBySeason && finalStandingsBySeason[season.leagueId] && finalStandingsBySeason[season.leagueId].standings && finalStandingsBySeason[season.leagueId].standings.length) || (season.finalStandings && season.finalStandings.length)}
              <ol class="mt-2 ml-4 list-decimal">
                {#each (finalStandingsBySeason[season.leagueId]?.standings ?? season.finalStandings ?? []) as row}
                  <li class="text-sm">
                    {row.team_name ?? row.owner_name ?? row.rosterId} — {row.wins ?? ''}W {row.losses ?? ''}L {row.points_for ? `• ${row.points_for} pts` : ''}
                  </li>
                {/each}
              </ol>
            {:else}
              <div class="mt-2 text-sm text-gray-600">No standings available for this season.</div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
</section>

<style>
  .container { max-width: 1000px; }
</style>
