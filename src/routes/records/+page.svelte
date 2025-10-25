<script>
  // src/routes/records/+page.svelte
  export let data;

  // Data from server
  const seasons = data?.seasons ?? [];
  const seasonsResults = data?.seasonsResults ?? [];
  const messages = data?.messages ?? [];

  // Selected season logic (same approach as other pages)
  const numericSeasons = seasons.filter(s => s.season != null);
  const latestSeasonDefault = numericSeasons.length
    ? String(numericSeasons[numericSeasons.length - 1].season)
    : (seasons.length ? String(seasons[seasons.length - 1].league_id) : 'all');

  let selectedSeasonId = (() => {
    const ds = data && data.selectedSeason ? String(data.selectedSeason) : null;
    if (ds) {
      const matches = seasons.some(s => (s.season != null && String(s.season) === ds) || String(s.league_id) === ds);
      if (matches) return ds;
    }
    return latestSeasonDefault;
  })();

  // pick selectedSeasonResult from seasonsResults (try by season then leagueId)
  $: selectedSeasonResult = (() => {
    if (!seasonsResults || seasonsResults.length === 0) return null;
    if (!selectedSeasonId || selectedSeasonId === 'all') {
      if (seasons && seasons.length) {
        const last = seasons[seasons.length - 1];
        return seasonsResults.find(r => String(r.leagueId) === String(last.league_id)) || seasonsResults[seasonsResults.length - 1];
      }
      return seasonsResults[seasonsResults.length - 1];
    } else {
      let found = seasonsResults.find(r => r.season != null && String(r.season) === String(selectedSeasonId));
      if (found) return found;
      found = seasonsResults.find(r => String(r.leagueId) === String(selectedSeasonId));
      if (found) return found;
      return seasonsResults[0];
    }
  })();

  // UI helpers
  function seasonLabel(s) {
    if (!s) return 'Unknown';
    if (s.season != null) return String(s.season);
    if (s.name) return s.name;
    return s.league_id || 'Unknown';
  }

  function avatarOrPlaceholder(url, name) {
    return url || `https://via.placeholder.com/56?text=${encodeURIComponent(name ? name[0] : 'T')}`;
  }

  // Submit form helper
  let seasonForm;
  function submitForm() {
    seasonForm && seasonForm.submit && seasonForm.submit();
  }

  // Client-side fallback: attempt to fetch static/early2023.json if server data missing
  // The page will attempt to load early overrides only on the client.
  import { onMount } from 'svelte';
  let early2023 = null;
  let earlyFetchError = null;

  onMount(async () => {
    // Only fetch fallback if server did not provide seasonsResults
    if (!selectedSeasonResult || (Array.isArray(selectedSeasonResult.regularStandings) && selectedSeasonResult.regularStandings.length === 0)) {
      try {
        const res = await fetch('/early2023.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        // store parsed file
        early2023 = json;
      } catch (err) {
        earlyFetchError = String(err.message || err);
      }
    }
  });

  // helper to build a minimal display structure from an early2023 entry (if needed)
  function buildFromEarly(season, week = 1) {
    if (!early2023 || !early2023[season] || !early2023[season][String(week)]) return null;
    // Convert array of matchups to simple per-team record tallies
    const rows = {}; // rosterName -> { team_name, owner_name, wins, losses, ties, pf, pa }
    const matches = early2023[season][String(week)];
    for (const m of matches) {
      const aName = m.teamA?.name || 'Team A';
      const aOwner = m.teamA?.ownerName || m.teamA?.ownerId || null;
      const bName = m.teamB?.name || 'Team B';
      const bOwner = m.teamB?.ownerName || m.teamB?.ownerId || null;
      const aScore = Number(m.teamAScore || 0);
      const bScore = Number(m.teamBScore || 0);

      if (!rows[aName]) rows[aName] = { team_name: aName, owner_name: aOwner, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
      if (!rows[bName]) rows[bName] = { team_name: bName, owner_name: bOwner, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };

      rows[aName].pf += aScore; rows[aName].pa += bScore;
      rows[bName].pf += bScore; rows[bName].pa += aScore;

      if (aScore > bScore) { rows[aName].wins += 1; rows[bName].losses += 1; }
      else if (aScore < bScore) { rows[bName].wins += 1; rows[aName].losses += 1; }
      else { rows[aName].ties += 1; rows[bName].ties += 1; }
    }

    // Convert to sorted array: wins desc, pf desc
    const arr = Object.keys(rows).map(k => rows[k]);
    arr.sort((x,y) => (y.wins - x.wins) || (y.pf - x.pf));
    return arr;
  }
</script>

<style>
  :global(body) { color-scheme: dark; }
  .page { max-width: 1100px; margin: 1.2rem auto; padding: 0 1rem; }
  h1 { margin:0 0 0.5rem 0; }
  .card { background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006)); border:1px solid rgba(255,255,255,0.04); border-radius:12px; padding:14px; margin-bottom:1rem; }
  .controls { display:flex; gap:.6rem; align-items:center; }
  .select { padding:.45rem .6rem; border-radius:8px; background:#07101a; color:#e6eef8; border:1px solid rgba(255,255,255,0.06); min-width:160px; font-weight:600; }
  .tbl { width:100%; border-collapse:collapse; }
  thead th { text-align:left; padding:10px; color:#9ca3af; font-size:.85rem; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.03); }
  td { padding:10px; color:#e6eef8; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; }
  .col-numeric { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .team-row { display:flex; gap:.6rem; align-items:center; }
  .avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; }
  .muted { color:#9ca3af; font-size:.95rem; }
  .debug-box { background:#07101a; padding:12px; border-radius:8px; font-family:monospace; color:#9ca3af; margin-bottom:1rem; white-space:pre-wrap; }
</style>

<div class="page">
  <div style="margin-bottom:.5rem;">
    <h1>Records</h1>
    <div class="muted">Summary of team records (regular / playoff)</div>
  </div>

  <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;">
    <div>
      <strong>Choose season</strong>
    </div>
    <form method="get" bind:this={seasonForm} style="display:flex; gap:.5rem; align-items:center;">
      <select id="season" name="season" class="select" bind:value={selectedSeasonId} on:change={submitForm}>
        {#each seasons as s}
          <option value={s.season ?? s.league_id}>{seasonLabel(s)}</option>
        {/each}
      </select>
      <noscript><button class="select" type="submit">Go</button></noscript>
    </form>
  </div>

  {#if messages && messages.length}
    <div class="card">
      <div style="font-weight:700; margin-bottom:.5rem;">Server messages</div>
      <div class="debug-box">{JSON.stringify(messages, null, 2)}</div>
    </div>
  {/if}

  {#if selectedSeasonResult}
    <!-- Use server-provided standings if available -->
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:.6rem;">
        <div>
          <div style="font-size:1.05rem; font-weight:700;">Regular Season Records</div>
          <div class="muted">Weeks 1 → playoff start - 1</div>
        </div>
        <div class="muted">Sorted by Wins → PF</div>
      </div>

      {#if selectedSeasonResult.regularStandings && selectedSeasonResult.regularStandings.length}
        <table class="tbl" role="table">
          <thead>
            <tr><th>Team / Owner</th><th class="col-numeric">W</th><th class="col-numeric">L</th><th class="col-numeric">T</th><th class="col-numeric">PF</th><th class="col-numeric">PA</th></tr>
          </thead>
          <tbody>
            {#each selectedSeasonResult.regularStandings as r}
              <tr>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(r.avatar, r.team_name)} alt={r.team_name} />
                    <div>
                      <div style="font-weight:700;">{r.team_name}</div>
                      {#if r.owner_name}<div class="muted">{r.owner_name}</div>{/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{r.wins}</td>
                <td class="col-numeric">{r.losses}</td>
                <td class="col-numeric">{r.ties ?? 0}</td>
                <td class="col-numeric">{r.pf}</td>
                <td class="col-numeric">{r.pa}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="muted">No regular-season records available for the selected season.</div>
      {/if}
    </div>

    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:.6rem;">
        <div>
          <div style="font-size:1.05rem; font-weight:700;">Playoff Records</div>
          <div class="muted">Playoff window only</div>
        </div>
        <div class="muted">Champion(s) pinned to top</div>
      </div>

      {#if selectedSeasonResult.playoffStandings && selectedSeasonResult.playoffStandings.length}
        <table class="tbl" role="table">
          <thead>
            <tr><th>Team / Owner</th><th class="col-numeric">W</th><th class="col-numeric">L</th><th class="col-numeric">PF</th><th class="col-numeric">PA</th></tr>
          </thead>
          <tbody>
            {#each selectedSeasonResult.playoffStandings as r}
              <tr aria-current={r.champion ? 'true' : undefined}>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(r.avatar, r.team_name)} alt={r.team_name} />
                    <div>
                      <div style="font-weight:700;">{r.team_name} {r.champion ? '🏆' : ''}</div>
                      {#if r.owner_name}<div class="muted">{r.owner_name}</div>{/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{r.wins}</td>
                <td class="col-numeric">{r.losses}</td>
                <td class="col-numeric">{r.pf}</td>
                <td class="col-numeric">{r.pa}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="muted">No playoff records available for the selected season.</div>
      {/if}
    </div>

  {:else}
    <!-- fallback when server did not supply seasonsResults -->
    <div class="card">
      <div style="font-weight:700; margin-bottom:.5rem;">No server records — fallback / debug</div>

      <div class="muted" style="margin-bottom:.6rem;">Server didn't return `seasonsResults`. The page attempted to fetch a local fallback file <code>/early2023.json</code> (client-side).</div>

      <div style="margin-bottom:.6rem;">
        <div style="font-weight:700; margin-bottom:.35rem;">early2023.json (preview)</div>
        {#if early2023}
          <div class="debug-box">{JSON.stringify(early2023, null, 2)}</div>
        {:else if earlyFetchError}
          <div class="debug-box">Fetch error: {earlyFetchError}</div>
        {:else}
          <div class="muted">Attempting to fetch /early2023.json (client-side). This will only run in the browser after page load.</div>
        {/if}
      </div>

      <!-- If early2023 present, show a derived table for season 2023 week 1 as an example -->
      {#if early2023 && early2023['2023'] && early2023['2023']['1']}
        <div style="margin-top:.6rem; font-weight:700;">Derived records from early2023.json (season 2023, week 1)</div>
        {#if buildFromEarly('2023',1)}
          <table class="tbl" style="margin-top:.5rem;">
            <thead><tr><th>Team</th><th class="col-numeric">W</th><th class="col-numeric">L</th><th class="col-numeric">PF</th><th class="col-numeric">PA</th></tr></thead>
            <tbody>
              {#each buildFromEarly('2023',1) as r}
                <tr>
                  <td>
                    <div class="team-row">
                      <img class="avatar" src={avatarOrPlaceholder(null, r.team_name)} alt={r.team_name} />
                      <div>
                        <div style="font-weight:700;">{r.team_name}</div>
                        {#if r.owner_name}<div class="muted">{r.owner_name}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td class="col-numeric">{r.wins}</td>
                  <td class="col-numeric">{r.losses}</td>
                  <td class="col-numeric">{r.pf}</td>
                  <td class="col-numeric">{r.pa}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {/if}
    </div>
  {/if}
</div>
