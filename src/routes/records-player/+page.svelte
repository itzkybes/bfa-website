<!-- src/routes/records-player/+page.svelte -->
<script>
  export let data;

  // seasons list and initial selection (dropdown controls only MVP display)
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);

  // server-provided results per season (array)
  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];

  // server-provided global tables (all-time bests). These fields should be produced by server.
  const allTimePlayoffBestPerRoster = Array.isArray(data?.allTimePlayoffBestPerRoster) ? data.allTimePlayoffBestPerRoster : [];
  const allTimeFullSeasonBestPerRoster = Array.isArray(data?.allTimeFullSeasonBestPerRoster) ? data.allTimeFullSeasonBestPerRoster : [];

  // optional maps server may include
  const rosterNameMap = data?.rosterNameMap ?? data?.roster_meta_map ?? data?.rosterMap ?? {};
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // find season result for the selectedSeason (MVPs)
  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? null;
  $: overallMvp = selectedRow?.overallMvp ?? null;
  $: finalsMvp = selectedRow?.finalsMvp ?? null;

  // helper: build player headshot URL
  function playerHeadshot(playerId, size = 56) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // avatar fallback (initials)
  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name.split(' ').map(n => (n && n[0]) || '').slice(0,2).join('') : 'P';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=07101a&color=ffffff&size=${size}`;
  }

  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function onImgError(e, fallback) {
    try { e.currentTarget.src = fallback; } catch (_) {}
  }

  // Resolve team/owner display info for a row (use rosterNameMap or row fields)
  function getTeamOwnerInfo(row) {
    const rid = String(row?.rosterId ?? row?.roster_id ?? row?.roster ?? '');
    const meta = rosterNameMap && rosterNameMap[rid] ? rosterNameMap[rid] : (row?.roster_meta ?? {});
    const teamName = row?.teamName ?? row?.team_name ?? meta?.team_name ?? meta?.teamName ?? meta?.name ?? `Roster ${rid}`;
    const ownerName = row?.owner_name ?? meta?.owner_name ?? meta?.owner?.display_name ?? meta?.owner?.username ?? null;
    const teamAvatar = row?.teamAvatar ?? row?.team_avatar ?? meta?.team_avatar ?? meta?.owner_avatar ?? meta?.avatar ?? null;
    return { teamName, ownerName, teamAvatar };
  }

  // precompute mapped arrays to avoid in-template function calls / #const blocks
  $: playoffRows = Array.isArray(allTimePlayoffBestPerRoster)
    ? allTimePlayoffBestPerRoster.map(r => ({ ...r, _ti: getTeamOwnerInfo(r) }))
      .sort((a,b) => (Number(b.playoffPoints ?? b.points ?? 0) - Number(a.playoffPoints ?? a.points ?? 0)))
    : [];

  $: fullSeasonRows = Array.isArray(allTimeFullSeasonBestPerRoster)
    ? allTimeFullSeasonBestPerRoster.map(r => ({ ...r, _ti: getTeamOwnerInfo(r) }))
      .sort((a,b) => (Number(b.totalPoints ?? b.points ?? 0) - Number(a.totalPoints ?? a.points ?? 0)))
    : [];

  // ensure arrays are unique by rosterId (just defensive)
  function uniqByRoster(arr) {
    const seen = new Set();
    const out = [];
    for (const it of arr || []) {
      const k = String(it.rosterId ?? it.roster_id ?? '');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
    return out;
  }

  $: playoffRows = uniqByRoster(playoffRows);
  $: fullSeasonRows = uniqByRoster(fullSeasonRows);

  // expose some debug-ready condensed messages if needed
  $: debugMessages = messages;
</script>

<style>
  /* Layout & styling inspired by records-team / honor-hall */
  .page { max-width: 1100px; margin: 1.2rem auto; padding: 0 1rem; color: var(--nav-text,#e6eef8); }
  .card { background: rgba(6,8,12,0.6); border-radius: 12px; padding: 14px; border: 1px solid rgba(255,255,255,0.03); }
  .topline { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
  .muted { color:#9ca3af; }
  .filters { display:flex; gap:.6rem; align-items:center; }
  .select { padding:.6rem .8rem; border-radius:8px; background:#07101a; color:#e6eef8; border:1px solid rgba(99,102,241,0.25); font-weight:600; min-width:160px; }

  table { width:100%; border-collapse:collapse; margin-top:12px; }
  thead th { text-align:left; padding:10px; color:#9aa3ad; font-size:.82rem; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.03); }
  td { padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; }
  .player-cell { display:flex; gap:.8rem; align-items:center; }
  .player-avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; border:1px solid rgba(255,255,255,0.03); }
  .player-name { font-weight:800; }
  .small { color:#9aa3ad; font-size:.92rem; }
  .team-col { font-weight:800; }
  .debug { font-family:monospace; white-space:pre-wrap; font-size:.82rem; color:#9fb0c4; margin-top:.8rem; max-height:280px; overflow:auto; background: rgba(255,255,255,0.02); padding:10px; border-radius:8px; }
  .empty { color:#9aa3ad; padding:14px 0; }

  @media (max-width: 880px) {
    .topline { flex-direction:column; align-items:flex-start; gap:8px; }
    .player-avatar { width:48px; height:48px; }
  }
</style>

<div class="page">
  <div class="card">
    <div class="topline">
      <div>
        <h2 style="margin:0 0 6px 0;">Player Records — MVPs</h2>
        <div class="muted" style="margin-bottom:6px;">Use the dropdown to pick a season to show Overall MVP and Finals MVP for that season.</div>
      </div>

      <form id="filters" method="get" class="filters" style="margin:0;">
        <label class="muted" for="season-select" style="margin-right:.4rem;">Season</label>
        <select id="season-select" name="season" class="select" on:change={submitFilters} aria-label="Select season">
          {#if seasons && seasons.length}
            {#each seasons as s}
              <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>
                {s.season ?? s.name ?? s.league_id}
              </option>
            {/each}
          {:else}
            <option value={selectedSeason}>{selectedSeason}</option>
          {/if}
        </select>
      </form>
    </div>

    <!-- MVPs table (no season column) -->
    <table aria-label="Player MVPs">
      <thead>
        <tr>
          <th style="width:50%;">Overall MVP</th>
          <th style="width:50%;">Finals MVP</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            {#if overallMvp}
              <div class="player-cell">
                <img
                  class="player-avatar"
                  src={playerHeadshot(overallMvp.playerId) || overallMvp.playerAvatar || overallMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, overallMvp.playerName)}
                  alt={overallMvp.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(overallMvp.roster_meta?.team_avatar ?? overallMvp.roster_meta?.owner_avatar, overallMvp.playerName))}
                />
                <div>
                  <div class="player-name">{overallMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(overallMvp.points ?? overallMvp.totalPoints ?? overallMvp.total ?? 0)}</div>
                  <div class="small">{overallMvp.roster_meta?.team_name ?? overallMvp.roster_meta?.owner_name ?? ''}</div>
                </div>
              </div>
            {:else}
              <div class="empty">No overall MVP determined for this season.</div>
            {/if}
          </td>

          <td>
            {#if finalsMvp}
              <div class="player-cell">
                <img
                  class="player-avatar"
                  src={playerHeadshot(finalsMvp.playerId) || finalsMvp.playerAvatar || finalsMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, finalsMvp.playerName)}
                  alt={finalsMvp.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(finalsMvp.roster_meta?.team_avatar ?? finalsMvp.roster_meta?.owner_avatar, finalsMvp.playerName))}
                />
                <div>
                  <div class="player-name">{finalsMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(finalsMvp.points ?? finalsMvp.playoffPoints ?? 0)}</div>
                  <div class="small">{finalsMvp.roster_meta?.team_name ?? finalsMvp.roster_meta?.owner_name ?? ''}</div>
                </div>
              </div>
            {:else}
              <div class="empty">No finals MVP determined for this season.</div>
            {/if}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- All-time single-player playoff best per roster (one best season per roster, playoffs only) -->
    <h3 style="margin-top:18px; margin-bottom:8px;">All-time single playoffs best per roster (best single-season playoff points for a player)</h3>
    {#if playoffRows && playoffRows.length}
      <table aria-label="All-time playoff best per roster">
        <thead>
          <tr>
            <th style="width:40%;">Team / Owner</th>
            <th style="width:40%;">Player (season)</th>
            <th style="width:20%;">Pts (playoffs)</th>
          </tr>
        </thead>
        <tbody>
          {#each playoffRows as row (row.rosterId)}
            <tr>
              <td>
                <div class="team-col">{row._ti.teamName}</div>
                <div class="small">{row._ti.ownerName ?? ''}</div>
              </td>
              <td>
                <div class="player-cell">
                  <img
                    class="player-avatar"
                    src={playerHeadshot(row.playerId) || row.playerAvatar || row._ti.teamAvatar || avatarOrPlaceholder(row._ti.teamAvatar, row.playerName)}
                    alt={row.playerName}
                    on:error={(e) => onImgError(e, avatarOrPlaceholder(row._ti.teamAvatar, row.playerName))}
                  />
                  <div>
                    <div class="player-name">{row.playerName ?? `Player ${row.playerId ?? ''}`}</div>
                    <div class="small">Season: {row.season ?? '—'}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(row.playoffPoints ?? row.points ?? 0)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No playoff-best-per-roster data available.</div>
    {/if}

    <!-- All-time best single-season per roster (regular season + playoffs) -->
    <h3 style="margin-top:18px; margin-bottom:8px;">All-time single-season best per roster (regular + playoffs)</h3>
    {#if fullSeasonRows && fullSeasonRows.length}
      <table aria-label="All-time full-season best per roster">
        <thead>
          <tr>
            <th style="width:40%;">Team / Owner</th>
            <th style="width:40%;">Player (season)</th>
            <th style="width:20%;">Pts (season total)</th>
          </tr>
        </thead>
        <tbody>
          {#each fullSeasonRows as row (row.rosterId)}
            <tr>
              <td>
                <div class="team-col">{row._ti.teamName}</div>
                <div class="small">{row._ti.ownerName ?? ''}</div>
              </td>
              <td>
                <div class="player-cell">
                  <img
                    class="player-avatar"
                    src={playerHeadshot(row.playerId) || row.playerAvatar || row._ti.teamAvatar || avatarOrPlaceholder(row._ti.teamAvatar, row.playerName)}
                    alt={row.playerName}
                    on:error={(e) => onImgError(e, avatarOrPlaceholder(row._ti.teamAvatar, row.playerName))}
                  />
                  <div>
                    <div class="player-name">{row.playerName ?? `Player ${row.playerId ?? ''}`}</div>
                    <div class="small">Season: {row.season ?? '—'}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(row.totalPoints ?? row.points ?? 0)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No full-season-best-per-roster data available.</div>
    {/if}

    <!-- JSON links & debug -->
    {#if jsonLinks && jsonLinks.length}
      <div style="margin-top:12px;">
        <div class="small" style="margin-bottom:6px;">Loaded JSON files:</div>
        <ul class="muted">
          {#each jsonLinks as jl}
            <li><a href={jl.url} target="_blank" rel="noreferrer">{jl.title}</a></li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if debugMessages && debugMessages.length}
      <div class="muted" style="margin-top:12px;">Messages / Debug:</div>
      <div class="debug" aria-live="polite">
        {#each debugMessages as m}
          {m}
          {'\n'}
        {/each}
      </div>
    {/if}
  </div>
</div>
