<script>
  // Standings page (aggregated regular / playoff + single-select H2H table + margin leaderboards)
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

  // H2H map from server (optional)
  $: h2hMap = (data && data.h2h && typeof data.h2h === 'object') ? data.h2h : {};

  // margins from server
  $: topLargestMargins = (data && data.topLargestMargins && Array.isArray(data.topLargestMargins)) ? data.topLargestMargins : [];
  $: topSmallestMargins = (data && data.topSmallestMargins && Array.isArray(data.topSmallestMargins)) ? data.topSmallestMargins : [];

  // Helper to generate canonical key for a row (owner/team)
  function makeKeyFromRow(r) {
    const ownerName = r.owner_name ? String(r.owner_name).toLowerCase() : null;
    if (ownerName) return 'owner:' + ownerName;
    if (r.rosterId != null) return 'roster:' + String(r.rosterId);
    return null;
  }

  // Build a simple keyMetaMap from aggregated rows & seasonsResults (to help H2H labels/avatars)
  $: keyMetaMap = (() => {
    const map = {};
    for (const r of aggregatedRegular) {
      if (!r) continue;
      const k = makeKeyFromRow(r);
      if (!k) continue;
      map[k] = map[k] || { team_name: r.team_name || null, owner_name: r.owner_name || null, avatar: r.avatar || null };
    }
    for (const r of aggregatedPlayoff) {
      if (!r) continue;
      const k = makeKeyFromRow(r);
      if (!k) continue;
      map[k] = map[k] || { team_name: r.team_name || null, owner_name: r.owner_name || null, avatar: r.avatar || null };
    }
    // also include h2h map-derived keys (if present)
    for (const mk of Object.keys(h2hMap || {})) {
      const rec = h2hMap[mk];
      if (!rec) continue;
      if (rec.team1Key) map[rec.team1Key] = map[rec.team1Key] || { team_name: rec.team1Name || null, owner_name: rec.team1Owner || null, avatar: rec.team1Avatar || null };
      if (rec.team2Key) map[rec.team2Key] = map[rec.team2Key] || { team_name: rec.team2Name || null, owner_name: rec.team2Owner || null, avatar: rec.team2Avatar || null };
    }
    return map;
  })();

  // avatar map fallback
  $: avatarMap = (() => {
    const am = {};
    for (const k in keyMetaMap) {
      if (!Object.prototype.hasOwnProperty.call(keyMetaMap, k)) continue;
      if (keyMetaMap[k].avatar) am[k] = keyMetaMap[k].avatar;
    }
    // h2h fallback avatars
    for (const mk of Object.keys(h2hMap || {})) {
      const rec = h2hMap[mk];
      if (!rec) continue;
      if (rec.team1Key && rec.team1Avatar) am[rec.team1Key] = am[rec.team1Key] || rec.team1Avatar;
      if (rec.team2Key && rec.team2Avatar) am[rec.team2Key] = am[rec.team2Key] || rec.team2Avatar;
    }
    return am;
  })();

  function getAvatarForKey(k, fallbackName) {
    if (!k) return avatarOrPlaceholder(null, fallbackName || null);
    return avatarMap[k] ? avatarMap[k] : avatarOrPlaceholder(null, fallbackName || null);
  }

  // Build dropdown labels from keyMetaMap (team name preferred)
  $: dropdownLabelForKey = (() => {
    const d = {};
    for (const k in keyMetaMap) {
      if (!Object.prototype.hasOwnProperty.call(keyMetaMap, k)) continue;
      const m = keyMetaMap[k];
      d[k] = m.team_name || m.owner_name || k;
    }
    // allow h2hMap keys if not present
    for (const mk of Object.keys(h2hMap || {})) {
      const rec = h2hMap[mk];
      if (!rec) continue;
      if (rec.team1Key && !d[rec.team1Key]) d[rec.team1Key] = rec.team1Name || rec.team1Owner || rec.team1Key;
      if (rec.team2Key && !d[rec.team2Key]) d[rec.team2Key] = rec.team2Name || rec.team2Owner || rec.team2Key;
    }
    return d;
  })();

  $: teamKeys = (() => {
    const ks = Object.keys(dropdownLabelForKey || {});
    ks.sort((a,b) => {
      const la = String(dropdownLabelForKey[a] || a).toLowerCase();
      const lb = String(dropdownLabelForKey[b] || b).toLowerCase();
      if (la < lb) return -1;
      if (la > lb) return 1;
      return 0;
    });
    return ks;
  })();

  // selected team for H2H (default first)
  export let selectedTeamKey = null;
  $: if ((!selectedTeamKey || !teamKeys.includes(selectedTeamKey)) && teamKeys && teamKeys.length) {
    selectedTeamKey = teamKeys[0];
  }

  // oriented h2h reader: expects h2hMap keyed by canonical "a|b" pair (or similar); returns oriented record
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

  $: opponentRows = (() => {
    if (!selectedTeamKey || !teamKeys) return [];
    const out = [];
    for (const k of teamKeys) {
      if (k === selectedTeamKey) continue;
      const rec = readH2H(selectedTeamKey, k);
      const meta = keyMetaMap[k] || {};
      out.push({
        key: k,
        team_name: meta.team_name || dropdownLabelForKey[k] || k,
        owner_name: meta.owner_name || '',
        avatar: avatarMap[k] || avatarOrPlaceholder(null, meta.team_name || dropdownLabelForKey[k]),
        record: rec
      });
    }
    out.sort((a,b) => {
      const la = String(a.team_name || a.key).toLowerCase();
      const lb = String(b.team_name || b.key).toLowerCase();
      if (la < lb) return -1;
      if (la > lb) return 1;
      return 0;
    });
    return out;
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
    table-layout: auto;
    min-width: 0;
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
    overflow: visible;
    word-break: normal;
  }

  tbody tr:nth-child(odd) {
    background: rgba(255,255,255,0.005);
  }

  tbody tr:hover {
    background: rgba(99,102,241,0.06);
    transform: translateZ(0);
  }

  .team-row { display:flex; align-items:flex-start; gap:0.75rem; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; background:#111; flex-shrink:0; display:block; }

  .team-name {
    display:block;
    font-weight:700;
    font-size:1rem;
    line-height:1.15;
    margin-bottom: 3px;
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
  }
  .owner { color: var(--muted); font-size:.95rem; margin-top:0; white-space: normal; overflow: visible; }

  .col-numeric { text-align:right; white-space:nowrap; font-variant-numeric: tabular-nums; width:1%; }

  .trophies { margin-left:.4rem; font-size:0.98rem; }
  .small-muted { color: var(--muted); font-size: .88rem; }

  .select {
    padding:.55rem .7rem;
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
    .avatar { width:48px; height:48px; }
    thead th, tbody td { padding: 8px; }
    .team-name { font-size: .98rem; }
    .owner { font-size: .9rem; }
  }

  @media (max-width: 520px) {
    .avatar { width:40px; height:40px; }
    thead th, tbody td { padding: 6px 8px; }
    .team-name { font-size: .98rem; }
    .owner { font-size: .88rem; }
  }

  .json-links a {
    display:block;
    color: var(--muted);
    text-decoration: underline;
    margin-top: .25rem;
    word-break:break-all;
  }

  .h2h-avatar {
    width:40px;
    height:40px;
    border-radius:8px;
    object-fit:cover;
    flex-shrink:0;
    background:#071018;
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
            {#each aggregatedRegular as row}
              <tr>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={getAvatarForKey(makeKeyFromRow(row), row.team_name)} alt={row.team_name} />
                    <div>
                      <div class="team-name">{row.team_name}
                        {#if row.championCount && row.championCount > 0}
                          <span class="trophies" title="Champion seasons"> 🏆×{row.championCount}</span>
                        {/if}
                      </div>
                      {#if row.owner_name}
                        <div class="owner">{row.owner_name}</div>
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
                    <img class="avatar" src={getAvatarForKey(makeKeyFromRow(row), row.team_name)} alt={row.team_name} />
                    <div>
                      <div class="team-name">
                        <span>{row.team_name}</span>
                        {#if row.championCount && row.championCount > 0}
                          <span class="trophies" title="Champion seasons">🏆×{row.championCount}</span>
                        {/if}
                      </div>
                      {#if row.owner_name}
                        <div class="owner">{row.owner_name}</div>
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
      <div class="small-muted">Selected team vs opponents</div>
    </div>

    <div style="display:flex; gap:.75rem; align-items:center; margin-bottom:.6rem;">
      <label for="h2h-select" class="small-muted" aria-hidden="true">Team</label>
      <select id="h2h-select" class="select" bind:value={selectedTeamKey}>
        {#each teamKeys as tk}
          <option value={tk}>{dropdownLabelForKey[tk]}</option>
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
                    <img class="h2h-avatar" src={orow.avatar} alt={orow.team_name} />
                    <div>
                      <div class="team-name">{orow.team_name}</div>
                      {#if orow.owner_name}
                        <div class="owner">{orow.owner_name}</div>
                      {/if}
                    </div>
                  </div>
                </td>
                {#if orow.record}
                  <td class="col-numeric">{orow.record.winsA}</td>
                  <td class="col-numeric">{orow.record.winsB}</td>
                  <td class="col-numeric">{orow.record.pfA}</td>
                  <td class="col-numeric">{orow.record.pfB}</td>
                  <td class="col-numeric">{orow.record.meetings}</td>
                {:else}
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

  <!-- Top margins: largest -->
  <div class="card" style="margin-top:1rem;">
    <div class="card-header">
      <div>
        <div class="section-title">Top 10 — Largest Margin of Victory</div>
        <div class="section-sub">Year and week shown for each matchup</div>
      </div>
      <div class="small-muted">Sorted by margin (descending)</div>
    </div>

    <div class="table-wrap">
      {#if topLargestMargins && topLargestMargins.length}
        <table class="tbl" role="table" aria-label="Largest margins table">
          <thead>
            <tr>
              <th>#</th>
              <th>Margin</th>
              <th>Season</th>
              <th>Week</th>
              <th>Team A</th>
              <th class="col-numeric">Score</th>
              <th>Team B</th>
            </tr>
          </thead>
          <tbody>
            {#each topLargestMargins as m}
              <tr>
                <td class="col-numeric">{m.rank}</td>
                <td class="col-numeric">{m.margin}</td>
                <td class="col-numeric">{m.season}</td>
                <td class="col-numeric">{m.week}</td>
                <td>
                  <div class="team-row">
                    <img class="h2h-avatar" src={m.avatarA ? m.avatarA : avatarOrPlaceholder(null, m.teamA)} alt={m.teamA} />
                    <div>
                      <div class="team-name">{m.teamA}</div>
                      {#if m.ownerA}<div class="owner">{m.ownerA}</div>{/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{m.pfA} - {m.pfB}</td>
                <td>
                  <div class="team-row">
                    <img class="h2h-avatar" src={m.avatarB ? m.avatarB : avatarOrPlaceholder(null, m.teamB)} alt={m.teamB} />
                    <div>
                      <div class="team-name">{m.teamB}</div>
                      {#if m.ownerB}<div class="owner">{m.ownerB}</div>{/if}
                    </div>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="small-muted">No margin data available. (Server must provide topLargestMargins.)</div>
      {/if}
    </div>
  </div>

  <!-- Top margins: smallest -->
  <div class="card" style="margin-top:1rem;">
    <div class="card-header">
      <div>
        <div class="section-title">Top 10 — Smallest Margin of Victory</div>
        <div class="section-sub">Tightest winning margins (non-zero)</div>
      </div>
      <div class="small-muted">Sorted by margin (ascending)</div>
    </div>

    <div class="table-wrap">
      {#if topSmallestMargins && topSmallestMargins.length}
        <table class="tbl" role="table" aria-label="Smallest margins table">
          <thead>
            <tr>
              <th>#</th>
              <th>Margin</th>
              <th>Season</th>
              <th>Week</th>
              <th>Team A</th>
              <th class="col-numeric">Score</th>
              <th>Team B</th>
            </tr>
          </thead>
          <tbody>
            {#each topSmallestMargins as m}
              <tr>
                <td class="col-numeric">{m.rank}</td>
                <td class="col-numeric">{m.margin}</td>
                <td class="col-numeric">{m.season}</td>
                <td class="col-numeric">{m.week}</td>
                <td>
                  <div class="team-row">
                    <img class="h2h-avatar" src={m.avatarA ? m.avatarA : avatarOrPlaceholder(null, m.teamA)} alt={m.teamA} />
                    <div>
                      <div class="team-name">{m.teamA}</div>
                      {#if m.ownerA}<div class="owner">{m.ownerA}</div>{/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{m.pfA} - {m.pfB}</td>
                <td>
                  <div class="team-row">
                    <img class="h2h-avatar" src={m.avatarB ? m.avatarB : avatarOrPlaceholder(null, m.teamB)} alt={m.teamB} />
                    <div>
                      <div class="team-name">{m.teamB}</div>
                      {#if m.ownerB}<div class="owner">{m.ownerB}</div>{/if}
                    </div>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="small-muted">No margin data available. (Server must provide topSmallestMargins.)</div>
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
