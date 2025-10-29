<script>
  import { onMount } from 'svelte';

  // Standings page (aggregated regular / playoff)
  export let data;

  // debug panel state
  let showDebug = true;

  function dismissDebug() { showDebug = false; }

  // helper
  function avatarOrPlaceholder(url, name) {
    return url || `https://via.placeholder.com/56?text=${encodeURIComponent(name ? name[0] : 'T')}`;
  }

  // aggregated lists from server
  $: aggregatedRegular = (data && data.aggregatedRegular && Array.isArray(data.aggregatedRegular)) ? data.aggregatedRegular : [];
  $: aggregatedPlayoff = (data && data.aggregatedPlayoff && Array.isArray(data.aggregatedPlayoff)) ? data.aggregatedPlayoff : [];

  // debug messages and json links
  $: debugMessages = (data && data.messages && Array.isArray(data.messages)) ? data.messages : [];
  $: jsonLinks = (data && data.jsonLinks && Array.isArray(data.jsonLinks)) ? data.jsonLinks : [];

  // ownership notes from server (e.g. remapping owners)
  $: ownershipNotes = (data && data.ownershipNotes && Array.isArray(data.ownershipNotes)) ? data.ownershipNotes : [];

  // ---------- Head-to-Head state ----------
  // Build team options from aggregatedRegular (fall back to aggregatedPlayoff if empty).
  $: teamOptions = (aggregatedRegular.length ? aggregatedRegular : aggregatedPlayoff).map(r => {
    // prefer rosterId as stable id; fall back to owner_name or team_name
    const id = r.rosterId ?? r.roster_id ?? (r.owner_name ? `owner:${String(r.owner_name).toLowerCase()}` : `team:${String((r.team_name||'')).toLowerCase()}`);
    return {
      id: String(id),
      rosterId: r.rosterId ?? null,
      label: `${r.team_name ?? 'Unknown'} · ${r.owner_name ?? ''}`,
      team_name: r.team_name,
      owner_name: r.owner_name,
      avatar: r.avatar ?? null
    };
  });

  let selectedA = teamOptions.length > 0 ? teamOptions[0].id : null;
  let selectedB = teamOptions.length > 1 ? teamOptions[1].id : (teamOptions.length > 0 ? teamOptions[0].id : null);

  // raw fetched season JSONs (map year -> parsed object)
  let fetchedSeasonJsons = {};

  // aggregated head-to-head result object
  let h2hResult = {
    played: 0,
    winsA: 0,
    winsB: 0,
    ties: 0,
    pfA: 0,
    pfB: 0,
    meetings: [] // store last few meeting details if desired
  };

  function safeNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  // normalize id matching: prefer rosterId match, else owner_name/team lowercase comparison
  function matchEntryToId(entry, id) {
    // id may be '123' or 'owner:name' or 'team:name'
    if (!entry) return false;
    // try rosterId
    if (entry.rosterId != null && String(entry.rosterId) === String(id)) return true;
    if (entry.roster_id != null && String(entry.roster_id) === String(id)) return true;

    // if id looks like owner:xxx or team:xxx, do string compare
    if (String(id).startsWith('owner:')) {
      const ownerLow = String(id).slice(6).toLowerCase();
      if (entry.ownerName && String(entry.ownerName).toLowerCase() === ownerLow) return true;
      if (entry.owner_name && String(entry.owner_name).toLowerCase() === ownerLow) return true;
      return false;
    }
    if (String(id).startsWith('team:')) {
      const teamLow = String(id).slice(5).toLowerCase();
      if (entry.name && String(entry.name).toLowerCase() === teamLow) return true;
      if (entry.team_name && String(entry.team_name).toLowerCase() === teamLow) return true;
      return false;
    }

    // lastly compare ownerName / owner_name lowercase and team name lowercase
    if (entry.ownerName && String(entry.ownerName).toLowerCase() === String(id).toLowerCase()) return true;
    if (entry.owner_name && String(entry.owner_name).toLowerCase() === String(id).toLowerCase()) return true;
    if (entry.name && String(entry.name).toLowerCase() === String(id).toLowerCase()) return true;
    if (entry.team_name && String(entry.team_name).toLowerCase() === String(id).toLowerCase()) return true;
    return false;
  }

  // fetch the JSONs listed in data.jsonLinks and build an aggregated list of matchups
  async function fetchSeasonJsons() {
    fetchedSeasonJsons = {};
    if (!jsonLinks || !jsonLinks.length) return;
    for (const jl of jsonLinks) {
      try {
        const res = await fetch(jl);
        if (!res.ok) continue;
        const parsed = await res.json();
        // try to extract year from filename or top-level (best-effort)
        let yearKey = null;
        try {
          const m = String(jl).match(/\/(\d{4})\.json$/);
          if (m) yearKey = m[1];
        } catch (e) {}
        if (!yearKey && parsed && parsed._meta && parsed._meta.year) yearKey = String(parsed._meta.year);
        if (!yearKey) yearKey = String(Object.keys(fetchedSeasonJsons).length + 1);
        fetchedSeasonJsons[yearKey] = parsed;
      } catch (e) {
        // ignore failed fetch for a single JSON
        // (keep going so partial data still works)
      }
    }
  }

  // compute head-to-head across all fetchedSeasonJsons for currently selectedA/B
  function computeH2H() {
    // reset
    h2hResult = { played: 0, winsA: 0, winsB: 0, ties: 0, pfA: 0, pfB: 0, meetings: [] };
    if (!selectedA || !selectedB) return;

    // iterate each loaded season JSON and all weeks
    for (const yearKey of Object.keys(fetchedSeasonJsons)) {
      const seasonsObj = fetchedSeasonJsons[yearKey];
      if (!seasonsObj || typeof seasonsObj !== 'object') continue;

      // weeks keys are typically numeric strings; iterate keys
      for (const wKey of Object.keys(seasonsObj)) {
        if (wKey === '_meta' || wKey === 'playoff_week_start') continue;
        const arr = seasonsObj[wKey];
        if (!Array.isArray(arr)) continue;
        for (const m of arr) {
          // require both sides to exist (head-to-head)
          if (!m.teamA || !m.teamB) continue;

          // skip entries with missing/zero scores (likely future/current in some JSON)
          const ptsA = safeNum(m.teamAScore ?? m.teamA?.score ?? m.teamA?.points ?? null);
          const ptsB = safeNum(m.teamBScore ?? m.teamB?.score ?? m.teamB?.points ?? null);
          if (ptsA === 0 && ptsB === 0) continue;

          const aMatches = matchEntryToId(m.teamA, selectedA);
          const bMatches = matchEntryToId(m.teamB, selectedB);
          const swappedA = matchEntryToId(m.teamA, selectedB);
          const swappedB = matchEntryToId(m.teamB, selectedA);

          let isDirect = (aMatches && bMatches);
          let isSwapped = (swappedA && swappedB);

          if (!isDirect && !isSwapped) continue;

          // increment counters accordingly (respecting which selection matches teamA/teamB)
          if (isDirect) {
            // selectedA is teamA
            h2hResult.played += 1;
            h2hResult.pfA += ptsA;
            h2hResult.pfB += ptsB;
            if (ptsA > ptsB + 1e-9) h2hResult.winsA += 1;
            else if (ptsB > ptsA + 1e-9) h2hResult.winsB += 1;
            else h2hResult.ties += 1;
            h2hResult.meetings.push({ year: yearKey, week: wKey, a: ptsA, b: ptsB });
          } else if (isSwapped) {
            // selectedA is teamB in this matchup (we need to flip)
            h2hResult.played += 1;
            // careful: selectedA maps to teamB in the raw entry
            h2hResult.pfA += ptsB;
            h2hResult.pfB += ptsA;
            if (ptsB > ptsA + 1e-9) h2hResult.winsA += 1;
            else if (ptsA > ptsB + 1e-9) h2hResult.winsB += 1;
            else h2hResult.ties += 1;
            h2hResult.meetings.push({ year: yearKey, week: wKey, a: ptsB, b: ptsA });
          }
        }
      }
    }
  }

  // re-compute when selections change
  $: if (selectedA != null && selectedB != null) {
    // prevent computing when same team selected
    if (selectedA === selectedB) {
      h2hResult = { played: 0, winsA: 0, winsB: 0, ties: 0, pfA: 0, pfB: 0, meetings: [] };
    } else {
      computeH2H();
    }
  }

  // fetch JSONs on mount
  onMount(async () => {
    await fetchSeasonJsons();
    // recalc after fetch
    computeH2H();
  });
</script>

<style>
  :global(body) {
    --bg: #0b1220;
    --card: #071025;
    --muted: #9ca3af;
    --accent: rgba(99,102,241,0.08);
    --text: #e6eef8;
    color-scheme: dark;
  }

  .page {
    max-width: 1100px;
    margin: 1.5rem auto;
    padding: 0 1rem;
  }

  h1 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
  }

  .debug {
    margin-bottom: 1rem;
    color: var(--muted);
    font-size: 0.95rem;
  }

  .ownership-note {
    background: rgba(99,102,241,0.04);
    border: 1px solid rgba(99,102,241,0.08);
    padding: 10px 12px;
    margin: 18px 0 0 0;
    border-radius: 8px;
    color: var(--muted);
    font-size: 0.95rem;
  }

  .card {
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
    overflow: hidden;
  }

  .card-header {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:1rem;
    margin-bottom: 0.5rem;
  }

  .section-title {
    font-size:1.05rem;
    font-weight:700;
    margin:0;
  }
  .section-sub {
    color: var(--muted);
    font-size: .9rem;
  }

  /* Table styling */
  .table-wrap {
    width:100%;
    overflow:auto;
    -webkit-overflow-scrolling: touch;
    margin-top: .5rem;
  }

  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
    overflow: hidden;
    border-radius: 8px;
    min-width: 740px;
    table-layout: fixed;
  }

  thead th {
    text-align:left;
    padding: 10px 12px;
    font-size: 0.85rem;
    color: var(--muted);
    background: linear-gradient(180deg, rgba(255,255,255,0.012), rgba(255,255,255,0.004));
    text-transform: uppercase;
    letter-spacing: 0.02em;
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }

  tbody td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    color: #e6eef8;
    vertical-align: middle;
    overflow: hidden;
  }

  tbody tr:nth-child(odd) {
    background: rgba(255,255,255,0.005);
  }

  tbody tr:hover {
    background: rgba(99,102,241,0.06);
    transform: translateZ(0);
  }

  .team-row { display:flex; align-items:center; gap:0.75rem; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; background:#111; flex-shrink:0; display:block; }
  .team-name { font-weight:700; display:flex; align-items:center; gap:.5rem; }
  .owner { color: var(--muted); font-size:.9rem; margin-top:2px; }

  .col-numeric { text-align:right; white-space:nowrap; font-variant-numeric: tabular-nums; }

  .trophies { margin-left:.4rem; font-size:0.98rem; }
  .small-muted { color: var(--muted); font-size: .88rem; }

  .rank {
    width:48px;
    text-align:right;
    font-weight:700;
    padding-right:12px;
    color: #e6eef8;
  }

  .controls {
    display:flex;
    gap:.75rem;
    align-items:center;
  }

  /* Matchups-style select to match site-wide UI */
  .select {
    padding:.6rem .8rem;
    border-radius:8px;
    background: #07101a;
    color: var(--text);
    border: 1px solid rgba(99,102,241,0.25);
    box-shadow: 0 4px 14px rgba(2,6,23,0.45), inset 0 -1px 0 rgba(255,255,255,0.01);
    min-width: 220px;
    font-weight: 600;
    outline: none;
  }
  .select:focus {
    border-color: rgba(99,102,241,0.6);
    box-shadow: 0 6px 20px rgba(2,6,23,0.6), 0 0 0 4px rgba(99,102,241,0.06);
  }

  .h2h-row { display:flex; gap:1rem; align-items:center; margin-bottom:12px; flex-wrap:wrap; }

  @media (max-width: 900px) {
    .avatar { width:44px; height:44px; }
    thead th, tbody td { padding: 8px; }
    .team-name { font-size: .95rem; }
  }

  @media (max-width: 520px) {
    .avatar { width:40px; height:40px; }
    thead th, tbody td { padding: 6px 8px; }
    .team-name { font-size: .98rem; }
  }

  .json-links a {
    display:block;
    color: var(--muted);
    text-decoration: underline;
    margin-top: .25rem;
    word-break:break-all;
  }
</style>

<div class="page">
  {#if debugMessages && debugMessages.length}
    <div class="debug">
      <strong>Debug</strong>
      <div style="margin-top:.35rem;">
        {#each debugMessages as m, i}
          <div>{i + 1}. {m}</div>
        {/each}

        {#if jsonLinks && jsonLinks.length}
          <div style="margin-top:.5rem; font-weight:700; color:inherit">Loaded JSON files:</div>
          <div class="json-links" aria-live="polite">
            {#each jsonLinks as jl}
              <a href={jl} target="_blank" rel="noopener noreferrer">{jl}</a>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <h1>Standings (Aggregated)</h1>

  <div class="small-muted" style="margin-bottom:.6rem;">
    Aggregated rows — regular: <strong>{aggregatedRegular.length}</strong>, playoffs: <strong>{aggregatedPlayoff.length}</strong>
  </div>

  <div class="card" aria-labelledby="regular-title" style="margin-bottom:1rem;">
    <div class="card-header">
      <div>
        <div id="regular-title" class="section-title">Regular Season (Aggregated)</div>
        <div class="section-sub">Combined across available seasons</div>
      </div>
      <div class="small-muted">Sorted by Wins → PF</div>
    </div>

    {#if aggregatedRegular && aggregatedRegular.length}
      <div class="table-wrap" role="region" aria-label="Aggregated regular season standings table scrollable">
        <table class="tbl" role="table" aria-label="Aggregated regular season standings">
          <thead>
            <tr>
              <th>#</th>
              <th>Team / Owner</th>
              <th class="col-numeric">W</th>
              <th class="col-numeric">L</th>
              <th class="col-numeric">Longest W-Str</th>
              <th class="col-numeric">Longest L-Str</th>
              <th class="col-numeric">PF</th>
              <th class="col-numeric">PA</th>
            </tr>
          </thead>
          <tbody>
            {#each aggregatedRegular as row, idx}
              <tr>
                <td class="rank">{idx + 1}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                    <div>
                      <div class="team-name">
                        {row.team_name}
                        {#if row.championCount && row.championCount > 0}
                          <span class="trophies" title="Champion seasons"> 🏆×{row.championCount}</span>
                        {/if}
                      </div>
                      {#if row.owner_name}
                        <div class="owner">{row.owner_name} <span class="small-muted">· {row.seasonsCount} seasons</span></div>
                      {/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{row.wins}</td>
                <td class="col-numeric">{row.losses}</td>
                <td class="col-numeric">{row.maxWinStreak ?? (row.maxWinStreak === 0 ? 0 : '')}</td>
                <td class="col-numeric">{row.maxLoseStreak ?? (row.maxLoseStreak === 0 ? 0 : '')}</td>
                <td class="col-numeric">{row.pf}</td>
                <td class="col-numeric">{row.pa}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No regular season results to show.</div>
    {/if}
  </div>

  <!-- Head-to-Head Card -->
  <div class="card" aria-labelledby="h2h-title" style="margin-bottom:1rem;">
    <div class="card-header">
      <div>
        <div id="h2h-title" class="section-title">Head-to-Head</div>
        <div class="section-sub">Compare two teams across loaded season JSONs</div>
      </div>
      <div class="small-muted">Matches aggregated from loaded season JSON files</div>
    </div>

    <div style="margin-top:.4rem;">
      <div class="h2h-row">
        <div style="display:flex; flex-direction:column;">
          <label class="small-muted" for="h2h-a">Team A</label>
          <select id="h2h-a" class="select" bind:value={selectedA} aria-label="Select Team A">
            {#each teamOptions as opt}
              <option value={opt.id}>{opt.label}</option>
            {/each}
          </select>
        </div>

        <div style="display:flex; flex-direction:column;">
          <label class="small-muted" for="h2h-b">Team B</label>
          <select id="h2h-b" class="select" bind:value={selectedB} aria-label="Select Team B">
            {#each teamOptions as opt}
              <option value={opt.id}>{opt.label}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="small-muted" style="margin-bottom:.5rem;">
        <strong>Summary</strong>
      </div>

      <table class="tbl" style="min-width:460px;">
        <thead>
          <tr>
            <th>Played</th>
            <th class="col-numeric">A Wins</th>
            <th class="col-numeric">B Wins</th>
            <th class="col-numeric">Ties</th>
            <th class="col-numeric">PF (A)</th>
            <th class="col-numeric">PF (B)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{h2hResult.played}</td>
            <td class="col-numeric">{h2hResult.winsA}</td>
            <td class="col-numeric">{h2hResult.winsB}</td>
            <td class="col-numeric">{h2hResult.ties}</td>
            <td class="col-numeric">{Math.round((h2hResult.pfA || 0) * 100) / 100}</td>
            <td class="col-numeric">{Math.round((h2hResult.pfB || 0) * 100) / 100}</td>
          </tr>
        </tbody>
      </table>

      {#if h2hResult.meetings && h2hResult.meetings.length}
        <div style="margin-top:12px;" class="small-muted"><strong>Recent meetings</strong></div>
        <div class="table-wrap" style="margin-top:6px;">
          <table class="tbl" style="min-width:420px;">
            <thead>
              <tr>
                <th>Season</th>
                <th>Week</th>
                <th class="col-numeric">A Score</th>
                <th class="col-numeric">B Score</th>
              </tr>
            </thead>
            <tbody>
              {#each h2hResult.meetings.slice().reverse().slice(0,8) as meet}
                <tr>
                  <td>{meet.year}</td>
                  <td>{meet.week}</td>
                  <td class="col-numeric">{meet.a}</td>
                  <td class="col-numeric">{meet.b}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>

  <div class="card" aria-labelledby="playoff-title">
    <div class="card-header">
      <div>
        <div id="playoff-title" class="section-title">Playoffs (Aggregated)</div>
        <div class="section-sub">Combined playoff window across available seasons</div>
      </div>
      <div class="small-muted">Champion seasons pinned to top where applicable</div>
    </div>

    {#if aggregatedPlayoff && aggregatedPlayoff.length}
      <div class="table-wrap" role="region" aria-label="Aggregated playoff standings table scrollable">
        <table class="tbl" role="table" aria-label="Aggregated playoff standings">
          <thead>
            <tr>
              <th>Team / Owner</th>
              <th class="col-numeric">W</th>
              <th class="col-numeric">L</th>
              <th class="col-numeric">PF</th>
              <th class="col-numeric">PA</th>
            </tr>
          </thead>
          <tbody>
            {#each aggregatedPlayoff as row}
              <tr aria-current={row.champion === true ? 'true' : undefined}>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                    <div>
                      <div class="team-name">
                        <span>{row.team_name}</span>
                        {#if row.championCount && row.championCount > 0}
                          <span class="trophies" title="Champion seasons">🏆×{row.championCount}</span>
                        {/if}
                      </div>
                      {#if row.owner_name}
                        <div class="owner">{row.owner_name} <span class="small-muted">· {row.seasonsCount} seasons</span></div>
                      {/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{row.wins}</td>
                <td class="col-numeric">{row.losses}</td>
                <td class="col-numeric">{row.pf}</td>
                <td class="col-numeric">{row.pa}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No playoff results to show.</div>
    {/if}
  </div>

  <!-- ownership note moved to the bottom of the page as requested -->
  {#if ownershipNotes && ownershipNotes.length}
    <div class="ownership-note" role="note" aria-live="polite">
      {#each ownershipNotes as on}
        <div>{on}</div>
      {/each}
    </div>
  {/if}
</div>
