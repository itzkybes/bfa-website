<script context="module">
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

  // prefer the precomputed champion for the selected league
  $: champion =
    (selectedLeagueId && finalStandingsBySeason[selectedLeagueId] && finalStandingsBySeason[selectedLeagueId].champion) ||
    (selectedSeason && selectedSeason.finalStandings && selectedSeason.finalStandings.length ? selectedSeason.finalStandings[0] : null);

  // prefer precomputed standings (from client) and fallback to season.finalStandings
  $: displayedStandings =
    (selectedLeagueId && finalStandingsBySeason[selectedLeagueId] && finalStandingsBySeason[selectedLeagueId].standings) ||
    (selectedSeason && selectedSeason.finalStandings) ||
    [];

  // normalize and sort standings for display (desc by wins, then desc by points_for)
  // This creates a new array so we don't mutate server data.
  $: sortedStandings = (() => {
    if (!Array.isArray(displayedStandings)) return [];
    // map to normalized shape for consistent columns
    const normalized = displayedStandings.map((r) => {
      return {
        rosterId: r.rosterId ?? r.roster_id ?? r.roster ?? (r.id ? String(r.id) : null),
        team_name: r.team_name ?? r.team ?? r.name ?? r.owner_name ?? null,
        owner_name: r.owner_name ?? r.owner ?? r.display_name ?? null,
        wins: Number(r.wins ?? r.w ?? 0),
        losses: Number(r.losses ?? r.l ?? 0),
        ties: Number(r.ties ?? r.t ?? 0),
        points_for: Number(r.points_for ?? r.pointsFor ?? r.pf ?? r.points ?? 0),
        points_against: Number(r.points_against ?? r.pointsAgainst ?? r.pa ?? 0),
        team_avatar: r.team_avatar ?? r.avatar ?? r.teamAvatar ?? null
      };
    });

    normalized.sort((a, b) => {
      // primary: wins desc
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      // secondary: points_for desc
      if ((b.points_for || 0) !== (a.points_for || 0)) return (b.points_for || 0) - (a.points_for || 0);
      // tertiary: points_against asc (lower is better)
      return (a.points_against || 0) - (b.points_against || 0);
    });

    return normalized;
  })();

  // rank rows (1-based)
  $: rankedStandings = sortedStandings.map((row, idx) => ({ rank: idx + 1, ...row }));

  // champion (prefer champion var above), and compute last place from sortedStandings
  $: lastPlace = (() => {
    if (!sortedStandings || sortedStandings.length === 0) return null;
    // last after sorting is worst team
    const last = sortedStandings[sortedStandings.length - 1];
    return last;
  })();

  // small helper to format W-L-T
  function wlt(row) {
    const w = row.wins ?? 0;
    const l = row.losses ?? 0;
    const t = row.ties ?? 0;
    if (t) return `${w}-${l}-${t}`;
    return `${w}-${l}`;
  }
</script>

<svelte:head>
  <title>Honor Hall</title>
</svelte:head>

<section class="container mx-auto p-4">
  <h1 class="text-3xl font-bold mb-4">Honor Hall</h1>

  {#if finalStandings.length === 0}
    <div class="prose mb-6">
      <p>
        No season mapping found. Add <code>src/lib/data/seasons.json</code> (optional), or set <code>BASE_LEAGUE_ID</code> / <code>VITE_LEAGUE_ID</code> in your environment.
      </p>
    </div>
  {/if}

  <!-- Season selector -->
  {#if finalStandings.length > 0}
    <div class="mb-4 flex items-center">
      <label class="mr-3 font-medium">Season</label>
      <select bind:value={selectedSeasonIndex} class="px-3 py-1 border rounded bg-white dark:bg-neutral-800">
        {#each finalStandings as s, idx}
          <option value={idx}>{s.label ?? s.seasonKey}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
    <!-- Left / main: standings table (span 2 columns on medium+ screens) -->
    <div class="md:col-span-2 p-4 border rounded bg-white/5">
      <h2 class="text-xl font-semibold mb-3">Final Standings</h2>

      {#if rankedStandings.length === 0}
        <p class="text-sm text-gray-400">No standings available for this season.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm" aria-label="Final standings for selected season">
            <thead class="text-left">
              <tr>
                <th class="pr-4">#</th>
                <th class="pr-6">Team</th>
                <th class="pr-6">Owner</th>
                <th class="pr-4">W-L-T</th>
                <th class="pr-4">PF</th>
                <th class="pr-4">PA</th>
              </tr>
            </thead>
            <tbody>
              {#each rankedStandings as row (row.rosterId)}
                <tr class="border-t">
                  <td class="py-2 pr-4">{row.rank}</td>
                  <td class="py-2 pr-6 flex items-center space-x-3">
                    {#if row.team_avatar}
                      <img src={row.team_avatar} alt="team avatar" class="w-8 h-8 rounded-full object-cover" />
                    {/if}
                    <div>{row.team_name ?? `Roster ${row.rosterId}`}</div>
                  </td>
                  <td class="py-2 pr-6 text-gray-300">{row.owner_name ?? '—'}</td>
                  <td class="py-2 pr-4">{wlt(row)}</td>
                  <td class="py-2 pr-4">{Number.isFinite(row.points_for) ? (Math.round(row.points_for * 100) / 100) : '—'}</td>
                  <td class="py-2 pr-4">{Number.isFinite(row.points_against) ? (Math.round(row.points_against * 100) / 100) : '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <!-- Right / aside: champion & last place -->
    <aside class="p-4 border rounded bg-white/5">
      <h2 class="text-xl font-semibold mb-3">Highlights</h2>

      <div class="space-y-6">
        <!-- Champion card -->
        <div>
          <h3 class="text-lg font-semibold">Champion</h3>
          {#if champion}
            <div class="mt-3 flex items-center">
              {#if champion.team_avatar}
                <img src={champion.team_avatar} alt="champion avatar" class="w-16 h-16 rounded-full object-cover mr-3" />
              {/if}
              <div>
                <div class="font-bold">{champion.team_name ?? champion.team ?? (champion.rosterId ? `Roster ${champion.rosterId}` : '—')}</div>
                {#if champion.owner_name}
                  <div class="text-sm text-gray-300">Owner: {champion.owner_name}</div>
                {/if}
                {#if champion.rosterId}
                  <div class="text-xs text-gray-500">Roster ID: {champion.rosterId}</div>
                {/if}
                {#if selectedLeagueId && finalStandingsBySeason[selectedLeagueId]?.playoffTotals}
                  <div class="text-sm text-gray-300 mt-1">Playoff pts: {finalStandingsBySeason[selectedLeagueId].playoffTotals?.[champion.rosterId] ?? '—'}</div>
                {/if}
              </div>
            </div>
          {:else}
            <div class="mt-2 text-sm text-gray-400">Champion not available for this season.</div>
          {/if}
        </div>

        <!-- Divider -->
        <div class="border-t"></div>

        <!-- Last place card -->
        <div>
          <h3 class="text-lg font-semibold">Last Place</h3>
          {#if lastPlace}
            <div class="mt-3 flex items-center">
              {#if lastPlace.team_avatar}
                <img src={lastPlace.team_avatar} alt="last place avatar" class="w-16 h-16 rounded-full object-cover mr-3" />
              {/if}
              <div>
                <div class="font-bold">{lastPlace.team_name ?? `Roster ${lastPlace.rosterId}`}</div>
                {#if lastPlace.owner_name}
                  <div class="text-sm text-gray-300">Owner: {lastPlace.owner_name}</div>
                {/if}
                {#if lastPlace.rosterId}
                  <div class="text-xs text-gray-500">Roster ID: {lastPlace.rosterId}</div>
                {/if}
                <div class="text-sm text-gray-300 mt-1">Record: {wlt(lastPlace)}</div>
                <div class="text-sm text-gray-300">PF: {Number.isFinite(lastPlace.points_for) ? (Math.round(lastPlace.points_for * 100) / 100) : '—'}</div>
              </div>
            </div>
          {:else}
            <div class="mt-2 text-sm text-gray-400">No last-place data available for this season.</div>
          {/if}
        </div>
      </div>
    </aside>
  </div>
</section>

<style>
  .container { max-width: 1000px; }
  /* nice small table styles - your global CSS will likely handle the rest */
  table thead th { font-weight: 700; padding-bottom: 0.5rem; }
  table tbody tr td { vertical-align: middle; }
</style>
