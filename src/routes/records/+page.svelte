<script>
  // Standings page (aggregated regular / playoff + single-select H2H table)
  export let data;

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
  // shape: { "k1|k2": { team1Key, team2Key, team1Display, team2Display, wins1, wins2, ties, pf1, pf2, meetings } }
  $: h2hMap = (data && data.h2h && typeof data.h2h === 'object') ? data.h2h : {};

  // Build a canonical map of key -> display label using aggregatedRegular rows first
  function makeKeyFromRow(r) {
    const ownerName = r.owner_name ? String(r.owner_name).toLowerCase() : null;
    if (ownerName) return 'owner:' + ownerName;
    if (r.rosterId != null) return 'roster:' + String(r.rosterId);
    return null;
  }

  $: keyLabelMap = (() => {
    const m = {};
    for (const r of aggregatedRegular) {
      const k = makeKeyFromRow(r);
      if (!k) continue;
      m[k] = r.owner_name || r.team_name || m[k] || k;
    }
    for (const r of aggregatedPlayoff) {
      const k = makeKeyFromRow(r);
      if (!k) continue;
      m[k] = m[k] || r.owner_name || r.team_name || k;
    }
    for (const mk of Object.keys(h2hMap || {})) {
      const rec = h2hMap[mk];
      if (!rec) continue;
      if (rec.team1Key) m[rec.team1Key] = m[rec.team1Key] || rec.team1Display || rec.team1Key;
      if (rec.team2Key) m[rec.team2Key] = m[rec.team2Key] || rec.team2Display || rec.team2Key;
    }
    return m;
  })();

  // Sorted keys for selectors / table rows
  $: teamKeys = (() => {
    const ks = Object.keys(keyLabelMap || {});
    ks.sort((a, b) => {
      const la = String(keyLabelMap[a] || a).toLowerCase();
      const lb = String(keyLabelMap[b] || b).toLowerCase();
      if (la < lb) return -1;
      if (la > lb) return 1;
      return 0;
    });
    return ks;
  })();

  // selected team key for dropdown (default to first available)
  let selectedTeamKey = null;
  $: if ((!selectedTeamKey || !teamKeys.includes(selectedTeamKey)) && teamKeys && teamKeys.length) {
    selectedTeamKey = teamKeys[0];
  }

  // read oriented H2H for (aKey vs bKey) where result is oriented to aKey
  function readH2H(aKey, bKey) {
    if (!aKey || !bKey) return null;
    if (aKey === bKey) return null;
    const mapKey = aKey < bKey ? (aKey + '|' + bKey) : (bKey + '|' + aKey);
    const rec = h2hMap[mapKey];
    if (!rec) return null;
    const aIs1 = (rec.team1Key === aKey);
    const winsA = aIs1 ? Number(rec.wins1 || 0) : Number(rec.wins2 || 0);
    const winsB = aIs1 ? Number(rec.wins2 || 0) : Number(rec.wins1 || 0);
    const pfA = aIs1 ? Number(rec.pf1 || 0) : Number(rec.pf2 || 0);
    const pfB = aIs1 ? Number(rec.pf2 || 0) : Number(rec.pf1 || 0);
    const ties = Number(rec.ties || 0);
    const meetings = Number(rec.meetings || 0);
    return { winsA, winsB, pfA: Math.round(pfA * 100) / 100, pfB: Math.round(pfB * 100) / 100, ties, meetings };
  }

  // Build opponent rows for the selectedTeamKey
  $: opponentRows = (() => {
    if (!selectedTeamKey || !teamKeys) return [];
    const opps = [];
    for (const k of teamKeys) {
      if (k === selectedTeamKey) continue;
      const rec = readH2H(selectedTeamKey, k);
      opps.push({
        key: k,
        label: keyLabelMap[k] || k,
        record: rec // may be null if no data
      });
    }
    // sort opponents by label
    opps.sort((a, b) => {
      const la = String(a.label || a.key).toLowerCase();
      const lb = String(b.label || b.key).toLowerCase();
      if (la < lb) return -1;
      if (la > lb) return 1;
      return 0;
    });
    return opps;
  })();
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
    word-break: break-word;
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
    padding:.6rem .8rem;
    border-radius:8px;
    background: #07101a;
    color: var(--text);
    border: 1px solid rgba(99,102,241,0.25);
    box-shadow: 0 4px 14px rgba(2,6,23,0.45), inset 0 -1px 0 rgba(255,255,255,0.01);
    min-width: 260px;
    font-weight: 600;
    outline: none;
  }
  .select:focus {
    border-color: rgba(99,102,241,0.6);
    box-shadow: 0 6px 20px rgba(2,6,23,0.6), 0 0 0 4px rgba(99,102,241,0.06);
  }

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

  {#if ownershipNotes && ownershipNotes.length}
    <div class="ownership-note" role="note" aria-live="polite">
      {#each ownershipNotes as on}
        <div>{on}</div>
      {/each}
    </div>
  {/if}

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

  <!-- Head-to-Head single-select table -->
  <div class="card" aria-labelledby="h2h-title" style="margin-top:1rem;">
    <div class="card-header">
      <div>
        <div id="h2h-title" class="section-title">Head-to-Head</div>
        <div class="section-sub">Select a team to view aggregated H2H vs all opponents</div>
      </div>
      <div class="small-muted">Row = selected team vs Column = opponent</div>
    </div>

    <div style="display:flex; gap:.75rem; align-items:center; margin-bottom:.6rem;">
      <label for="h2h-select" class="small-muted" aria-hidden="true">Team</label>
      <select id="h2h-select" class="select" bind:value={selectedTeamKey}>
        {#each teamKeys as tk}
          <option value={tk}>{keyLabelMap[tk]}</option>
        {/each}
      </select>
    </div>

    <div class="table-wrap" role="region" aria-label="Head to head table" style="margin-top:.5rem;">
      {#if selectedTeamKey && opponentRows && opponentRows.length}
        <table class="tbl" role="table" aria-label="Head to head table">
          <thead>
            <tr>
              <th>Opponent</th>
              <th class="col-numeric">W</th>
              <th class="col-numeric">L</th>
              <th class="col-numeric">T</th>
              <th class="col-numeric">PF (for)</th>
              <th class="col-numeric">PF (against)</th>
              <th class="col-numeric">Meetings</th>
            </tr>
          </thead>
          <tbody>
            {#each opponentRows as orow}
              <tr>
                <td style="text-align:left;">
                  <div class="team-row">
                    <div style="min-width:36px; width:36px; height:36px; border-radius:8px; background:#071018; display:flex; align-items:center; justify-content:center; font-weight:700;">
                      {orow.label ? orow.label[0] : 'T'}
                    </div>
                    <div>
                      <div class="team-name">{orow.label}</div>
                    </div>
                  </div>
                </td>
                {#if orow.record}
                  <td class="col-numeric">{orow.record.winsA}</td>
                  <td class="col-numeric">{orow.record.winsB}</td>
                  <td class="col-numeric">{orow.record.ties}</td>
                  <td class="col-numeric">{orow.record.pfA}</td>
                  <td class="col-numeric">{orow.record.pfB}</td>
                  <td class="col-numeric">{orow.record.meetings}</td>
                {:else}
                  <td class="col-numeric">0</td>
                  <td class="col-numeric">0</td>
                  <td class="col-numeric">0</td>
                  <td class="col-numeric">0</td>
                  <td class="col-numeric">0</td>
                  <td class="col-numeric">0</td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="small-muted">No head-to-head data available.</div>
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
