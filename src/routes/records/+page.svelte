<script>
  // Standings page (aggregated regular / playoff + H2H)
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

  // H2H map from server
  $: h2hMap = (data && data.h2h && typeof data.h2h === 'object') ? data.h2h : {};

  // Build options list for dropdowns (use aggregatedRegular to get the canonical list)
  $: teamOptions = aggregatedRegular.map(r => {
    // key: prefer owner key if present; aggregated map used server-side keys (owner:, roster:)
    // The server does not return the original map key; however aggregatedRegular rows come from regMap values.
    // We will construct a key from owner_name (lowercased) when present, otherwise roster:rosterId
    const ownerName = r.owner_name ? String(r.owner_name).toLowerCase() : null;
    const key = ownerName ? ('owner:' + ownerName) : (r.rosterId ? ('roster:' + r.rosterId) : null);
    return { key, label: (r.owner_name ? r.owner_name : r.team_name), team_name: r.team_name, avatar: r.avatar, seasonsCount: r.seasonsCount, raw: r };
  });

  // dropdown selections for head-to-head
  let selectedA = null;
  let selectedB = null;

  // computed H2H record for the selected pair
  $: selectedH2H = null;
  $: {
    if (selectedA && selectedB && selectedA !== selectedB) {
      const keyA = selectedA;
      const keyB = selectedB;
      // server stores pairs lexicographically as "k1|k2"
      const mapKey = (keyA < keyB) ? (keyA + '|' + keyB) : (keyB + '|' + keyA);
      const rec = h2hMap[mapKey];
      if (rec) {
        // map rec back to "A vs B" orientation so UI shows A's wins etc.
        const aIs1 = (rec.team1Key === keyA);
        selectedH2H = {
          meetings: rec.meetings,
          a: {
            key: keyA,
            label: (aIs1 ? rec.team1Display : rec.team2Display),
            wins: aIs1 ? rec.wins1 : rec.wins2,
            pf: aIs1 ? Math.round(rec.pf1 * 100) / 100 : Math.round(rec.pf2 * 100) / 100
          },
          b: {
            key: keyB,
            label: (aIs1 ? rec.team2Display : rec.team1Display),
            wins: aIs1 ? rec.wins2 : rec.wins1,
            pf: aIs1 ? Math.round(rec.pf2 * 100) / 100 : Math.round(rec.pf1 * 100) / 100
          },
          ties: rec.ties
        };
      } else {
        selectedH2H = { meetings: 0, a: { key: keyA, label: null, wins: 0, pf: 0 }, b: { key: keyB, label: null, wins: 0, pf: 0 }, ties: 0 };
      }
    } else {
      selectedH2H = null;
    }
  }
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
    margin: 8px 0 14px 0;
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
    table-layout: fixed; /* keep columns aligned */
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

  .select {
    background: var(--card);
    color: var(--text);
    padding: .5rem .6rem;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.04);
    font-weight:600;
    min-width:240px;
  }

  @media (max-width: 900px) {
    .avatar { width:44px; height:44px; }
    thead th, tbody td { padding: 8px; }
    .team-name { font-size: .95rem; }
    .select { min-width: 180px; }
  }

  @media (max-width: 520px) {
    .avatar { width:40px; height:40px; }
    thead th, tbody td { padding: 6px 8px; }
    .team-name { font-size: .98rem; }
    .select { min-width: 140px; }
  }

  .json-links a {
    display:block;
    color: var(--muted);
    text-decoration: underline;
    margin-top: .25rem;
    word-break:break-all;
  }

  .h2h-grid { display:flex; gap:1rem; align-items:center; margin-top:.6rem; flex-wrap:wrap; }
  .h2h-box { flex: 1 1 300px; }
  .h2h-result { margin-top:.6rem; padding:10px; border-radius:8px; background: rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.02); color:var(--text); }
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

  <div class="card" aria-labelledby="playoff-title" style="margin-bottom:1rem;">
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

  <!-- Head-to-Head section -->
  <div class="card" aria-labelledby="h2h-title" style="margin-top:1rem;">
    <div class="card-header">
      <div>
        <div id="h2h-title" class="section-title">Head-to-Head</div>
        <div class="section-sub">Select two teams to view aggregated H2H results</div>
      </div>
      <div class="small-muted">Aggregated across loaded seasons</div>
    </div>

    <div class="h2h-grid">
      <div class="h2h-box">
        <label class="small-muted">Team A</label>
        <select class="select" bind:value={selectedA}>
          <option value={null}>— select team A —</option>
          {#each teamOptions as opt}
            {#if opt.key}
              <option value={opt.key}>{opt.label}{opt.seasonsCount ? ` · ${opt.seasonsCount} seasons` : ''}</option>
            {/if}
          {/each}
        </select>
      </div>
      <div class="h2h-box">
        <label class="small-muted">Team B</label>
        <select class="select" bind:value={selectedB}>
          <option value={null}>— select team B —</option>
          {#each teamOptions as opt}
            {#if opt.key}
              <option value={opt.key}>{opt.label}{opt.seasonsCount ? ` · ${opt.seasonsCount} seasons` : ''}</option>
            {/if}
          {/each}
        </select>
      </div>
    </div>

    <div style="margin-top:.8rem;">
      {#if selectedH2H}
        <div class="h2h-result" role="region" aria-live="polite">
          <div style="display:flex; align-items:center; gap:1rem;">
            <div style="flex:1;">
              <div style="font-weight:700;">{selectedH2H.a.label || selectedH2H.a.key}</div>
              <div class="small-muted">Wins: {selectedH2H.a.wins} · PF: {selectedH2H.a.pf}</div>
            </div>
            <div style="text-align:center; min-width:120px;">
              <div style="font-weight:700; font-size:1.05rem;">Meetings: {selectedH2H.meetings}</div>
              <div class="small-muted">Ties: {selectedH2H.ties}</div>
            </div>
            <div style="flex:1; text-align:right;">
              <div style="font-weight:700;">{selectedH2H.b.label || selectedH2H.b.key}</div>
              <div class="small-muted">Wins: {selectedH2H.b.wins} · PF: {selectedH2H.b.pf}</div>
            </div>
          </div>
        </div>
      {:else}
        <div class="small-muted">Choose two distinct teams to see head-to-head results.</div>
      {/if}
    </div>
  </div>

  {#if ownershipNotes && ownershipNotes.length}
    <div style="margin-top:1rem;" role="note" aria-live="polite">
      {#each ownershipNotes as on}
        <div class="ownership-note">{on}</div>
      {/each}
    </div>
  {/if}
</div>
