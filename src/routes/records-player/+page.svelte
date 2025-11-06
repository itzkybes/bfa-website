<!-- src/routes/records-player/+page.svelte -->
<script>
  export let data;

  // seasons list and selection (selectedSeason provided by server)
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  // top-level server outputs
  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];
  const allTimePlayoffBestPerRoster = Array.isArray(data?.allTimePlayoffBestPerRoster) ? data.allTimePlayoffBestPerRoster : [];
  const allTimeFullSeasonBestPerRoster = Array.isArray(data?.allTimeFullSeasonBestPerRoster) ? data.allTimeFullSeasonBestPerRoster : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // find selected season's row (MVPs + per-season teamLeaders)
  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? null;

  // helper to build player headshot URL (NBA)
  function playerHeadshot(playerId, size = 56) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // fallback avatar (owner/team avatar first, then initials)
  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name.split(' ').map(n=>n[0]||'').slice(0,2).join('') : 'P';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=07101a&color=ffffff&size=${size}`;
  }

  // format points for display
  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    // show 2 decimals like earlier template
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function onImgError(e, fallback) {
    try { e.currentTarget.src = fallback; } catch(_) {}
  }

  // Build a rosterId -> team_name map (try to pull from seasonsResults' teamLeaders/_roster_meta)
  const rosterNameMap = {};
  (function buildRosterNameMap() {
    for (const sr of seasonsResults) {
      if (!sr || !Array.isArray(sr.teamLeaders)) continue;
      for (const t of sr.teamLeaders) {
        const rid = String(t.rosterId);
        const metaName = (t._roster_meta && (t._roster_meta.team_name || t._roster_meta.owner_name)) ? (t._roster_meta.team_name || t._roster_meta.owner_name) : null;
        const ownerName = t.owner_name ?? (t._roster_meta && (t._roster_meta.owner_name || t._roster_meta.owner?.display_name)) ?? null;
        if (!rosterNameMap[rid]) {
          rosterNameMap[rid] = { teamName: metaName || ownerName || null, ownerName: ownerName || null, teamAvatar: t.teamAvatar ?? (t._roster_meta?.team_avatar ?? null) };
        } else {
          if (!rosterNameMap[rid].teamName && metaName) rosterNameMap[rid].teamName = metaName;
          if (!rosterNameMap[rid].ownerName && ownerName) rosterNameMap[rid].ownerName = ownerName;
          if (!rosterNameMap[rid].teamAvatar && (t.teamAvatar || t._roster_meta?.team_avatar)) rosterNameMap[rid].teamAvatar = t.teamAvatar ?? t._roster_meta?.team_avatar;
        }
      }
    }
  })();

  // helpers used by template to resolve team/owner/avatar
  function getRosterInfo(row) {
    const rid = String(row?.rosterId ?? '');
    const rmap = rosterNameMap[rid] ?? {};
    const teamName = row?.teamName ?? rmap.teamName ?? row?.owner_name ?? `Roster ${rid}`;
    const ownerName = rmap.ownerName ?? row?.owner_name ?? `Roster ${rid}`;
    const teamAvatar = row?.teamAvatar ?? rmap.teamAvatar ?? (row?._roster_meta?.team_avatar ?? null);
    return { teamName, ownerName, teamAvatar };
  }

  function getTeamName(row) { return getRosterInfo(row).teamName; }
  function getOwnerName(row) { return getRosterInfo(row).ownerName; }
  function getTeamAvatar(row) { return getRosterInfo(row).teamAvatar; }
</script>

<style>
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
  .debug { font-family:monospace; white-space:pre-wrap; font-size:.82rem; color:#9fb0c4; margin-top:.8rem; max-height:280px; overflow:auto; background: rgba(255,255,255,0.02); padding:10px; border-radius:8px; }
  .empty { color:#9aa3ad; padding:14px 0; }
</style>

<div class="page">
  <div class="card">
    <div class="topline">
      <div>
        <h2 style="margin:0 0 6px 0;">Player Records — MVPs</h2>
        <div class="muted" style="margin-bottom:6px;">Select a season to view Overall & Finals MVP for that season (dropdown controls only the MVPs)</div>
      </div>

      <form id="filters" method="get" class="filters" style="margin:0;">
        <label class="muted" for="season-select" style="margin-right:.4rem;">Season</label>
        <select id="season-select" name="season" class="select" on:change={submitFilters} aria-label="Select season">
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>
              {s.season ?? s.name ?? s.league_id}
            </option>
          {/each}
        </select>
      </form>
    </div>

    <!-- MVPs table -->
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
            {#if selectedRow?.overallMvp}
              {#const om = selectedRow.overallMvp}
              <div style="display:flex; gap:12px; align-items:center;">
                <!-- team avatar + team name/owner -->
                <img class="player-avatar" style="width:56px;height:56px;border-radius:8px" src={om.roster_meta?.team_avatar || getTeamAvatar(om) || avatarOrPlaceholder(null, getTeamName(om))} alt={getTeamName(om)} on:error={(e)=>onImgError(e, avatarOrPlaceholder(null, getTeamName(om)))} />
                <div style="flex:1; min-width:0;">
                  <div style="display:flex; align-items:center; gap:12px;">
                    <img class="player-avatar" src={om.playerAvatar || playerHeadshot(om.playerId) || avatarOrPlaceholder(null, om.playerName)} alt={om.playerName} on:error={(e)=>onImgError(e, avatarOrPlaceholder(om.roster_meta?.team_avatar, om.playerName))} />
                    <div style="min-width:0;">
                      <div class="player-name">{om.playerName}</div>
                      <div class="small">Pts: {formatPts(om.points)}</div>
                    </div>
                  </div>
                  <div class="small" style="margin-top:6px;">
                    Team: {getTeamName(om)} • Owner: {getOwnerName(om)}
                  </div>
                </div>
              </div>
            {:else}
              <div class="empty">No overall MVP determined for this season.</div>
            {/if}
          </td>

          <td>
            {#if selectedRow?.finalsMvp}
              {#const fm = selectedRow.finalsMvp}
              <div style="display:flex; gap:12px; align-items:center;">
                <img class="player-avatar" style="width:56px;height:56px;border-radius:8px" src={fm.roster_meta?.team_avatar || getTeamAvatar(fm) || avatarOrPlaceholder(null, getTeamName(fm))} alt={getTeamName(fm)} on:error={(e)=>onImgError(e, avatarOrPlaceholder(null, getTeamName(fm)))} />
                <div style="flex:1; min-width:0;">
                  <div style="display:flex; align-items:center; gap:12px;">
                    <img class="player-avatar" src={fm.playerAvatar || playerHeadshot(fm.playerId) || avatarOrPlaceholder(null, fm.playerName)} alt={fm.playerName} on:error={(e)=>onImgError(e, avatarOrPlaceholder(fm.roster_meta?.team_avatar, fm.playerName))} />
                    <div style="min-width:0;">
                      <div class="player-name">{fm.playerName}</div>
                      <div class="small">Pts: {formatPts(fm.points)}</div>
                    </div>
                  </div>
                  <div class="small" style="margin-top:6px;">
                    Team: {getTeamName(fm)} • Owner: {getOwnerName(fm)}
                  </div>
                </div>
              </div>
            {:else}
              <div class="empty">No finals MVP determined for this season.</div>
            {/if}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- All-time Playoff Best per roster (single best-season playoff points for a player on each roster) -->
    <h3 style="margin-top:18px; margin-bottom:8px;">All-time single-season playoff best (best player for each team — 2022→present)</h3>
    {#if allTimePlayoffBestPerRoster && allTimePlayoffBestPerRoster.length}
      <table aria-label="All-time playoff best per roster">
        <thead>
          <tr>
            <th style="width:35%;">Team</th>
            <th style="width:45%;">Player (season)</th>
            <th style="width:20%;">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each allTimePlayoffBestPerRoster as row (row.rosterId)}
            <tr>
              <td>
                <div style="display:flex; gap:.6rem; align-items:center;">
                  <img class="player-avatar" src={row.teamAvatar || avatarOrPlaceholder(null, getTeamName(row))} alt={getTeamName(row)} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, getTeamName(row)))} style="width:48px;height:48px"/>
                  <div>
                    <div style="font-weight:800;">{row.teamName ?? getTeamName(row)}</div>
                    <div class="small">{row.owner_name ?? getOwnerName(row)}</div>
                  </div>
                </div>
              </td>
              <td>
                <div class="player-cell">
                  <img class="player-avatar" src={row.playerAvatar || playerHeadshot(row.playerId) || avatarOrPlaceholder(null, row.playerName)} alt={row.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, row.playerName))}/>
                  <div>
                    <div class="player-name">{row.playerName ?? `Player ${row.playerId}`}</div>
                    <div class="small">Season {row.season}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(row.points)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No playoff bests available.</div>
    {/if}

    <!-- Cross-season full-season best per roster (1..playoffEnd totals) -->
    <h3 style="margin-top:18px; margin-bottom:8px;">All-time single-season full-season best (best player for each team — includes regular + playoffs, 2022→present)</h3>
    {#if allTimeFullSeasonBestPerRoster && allTimeFullSeasonBestPerRoster.length}
      <table aria-label="All-time full-season best per roster">
        <thead>
          <tr>
            <th style="width:35%;">Team</th>
            <th style="width:45%;">Player (season)</th>
            <th style="width:20%;">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each allTimeFullSeasonBestPerRoster as row (row.rosterId)}
            <tr>
              <td>
                <div style="display:flex; gap:.6rem; align-items:center;">
                  <img class="player-avatar" src={row.teamAvatar || avatarOrPlaceholder(null, getTeamName(row))} alt={getTeamName(row)} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, getTeamName(row)))} style="width:48px;height:48px"/>
                  <div>
                    <div style="font-weight:800;">{row.teamName ?? getTeamName(row)}</div>
                    <div class="small">{row.owner_name ?? getOwnerName(row)}</div>
                  </div>
                </div>
              </td>
              <td>
                <div class="player-cell">
                  <img class="player-avatar" src={row.playerAvatar || playerHeadshot(row.playerId) || avatarOrPlaceholder(null, row.playerName)} alt={row.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, row.playerName))}/>
                  <div>
                    <div class="player-name">{row.playerName ?? `Player ${row.playerId}`}</div>
                    <div class="small">Season {row.season}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(row.points)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No full-season bests available.</div>
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

    {#if messages && messages.length}
      <div class="muted" style="margin-top:12px;">Messages / Debug:</div>
      <div class="debug" aria-live="polite">
        {#each messages as m}
          {m}
          {'\n'}
        {/each}
      </div>
    {/if}
  </div>
</div>
