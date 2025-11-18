<!-- src/routes/records-player/+page.svelte -->
<script>
  export let data;

  // seasons list and selection (selectedSeason provided by server)
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  // top-level server outputs
  const seasonsResults = Array.isArray(data?.seasonsResults) ? data?.seasonsResults : [];
  const allTimePlayoffBestPerRoster = Array.isArray(data?.allTimePlayoffBestPerRoster) ? data.allTimePlayoffBestPerRoster : [];
  const allTimeFullSeasonBestPerRoster = Array.isArray(data?.allTimeFullSeasonBestPerRoster) ? data.allTimeFullSeasonBestPerRoster : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // find selected season's row (MVPs + per-season teamLeaders)
  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? null;

  // small local vars for template
  let om = null;
  let fm = null;
  $: om = selectedRow?.overallMvp ?? null;
  $: fm = selectedRow?.finalsMvp ?? null;

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
    if (!row) return { teamName: null, ownerName: null, teamAvatar: null };

    // possible roster id fields
    const ridCandidate = row.rosterId ?? row.topRosterId ?? row.top_roster_id ?? row.top_rosterId ?? row.toprosterId ?? null;

    // Some objects place the roster info inside roster_meta
    const rosterMeta = row.roster_meta ?? row._roster_meta ?? null;

    // canonical roster id as string (if any)
    const rid = (typeof ridCandidate !== 'undefined' && ridCandidate !== null) ? String(ridCandidate) : (rosterMeta && (rosterMeta.roster_id ?? rosterMeta.rosterId) ? String(rosterMeta.roster_id ?? rosterMeta.rosterId) : '');

    const rmap = rid ? (rosterNameMap[rid] ?? {}) : {};

    // prefer explicit fields on the row, then roster_meta, then rosterNameMap, then owner_name, then fallback
    const teamName =
      row.teamName ??
      row.team_name ??
      (rosterMeta && (rosterMeta.team_name ?? rosterMeta.teamName)) ??
      rmap.teamName ??
      row.owner_name ??
      (rosterMeta && (rosterMeta.owner_name ?? rosterMeta.owner?.display_name)) ??
      (rid ? `Roster ${rid}` : null);

    const ownerName =
      row.owner_name ??
      (rosterMeta && (rosterMeta.owner_name ?? rosterMeta.owner?.display_name)) ??
      rmap.ownerName ??
      (rid ? `Roster ${rid}` : null);

    const teamAvatar =
      row.teamAvatar ??
      row.team_avatar ??
      rmap.teamAvatar ??
      (rosterMeta && (rosterMeta.team_avatar ?? rosterMeta.owner_avatar ?? rosterMeta.owner?.avatar ?? null)) ??
      null;

    return { teamName, ownerName, teamAvatar };
  }

  function getTeamName(row) { return getRosterInfo(row).teamName; }
  function getOwnerName(row) { return getRosterInfo(row).ownerName; }
  function getTeamAvatar(row) { return getRosterInfo(row).teamAvatar; }
</script>

<style>
  :root {
    --bg: rgba(6,8,12,0.6);
    --card-pad: 14px;
    --muted: #9ca3af;
    --text: #e6eef8;
  }

  .page { max-width: 1100px; margin: 1.2rem auto; padding: 0 1rem; color: var(--text); }
  .card { background: var(--bg); border-radius: 12px; padding: var(--card-pad); border: 1px solid rgba(255,255,255,0.03); margin-bottom: 18px; }
  .topline { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
  .muted { color:var(--muted); }
  .filters { display:flex; gap:.6rem; align-items:center; }
  .select { padding:.6rem .8rem; border-radius:8px; background:#07101a; color:var(--text); border:1px solid rgba(99,102,241,0.12); font-weight:600; min-width:180px; }
  .compact-select { min-width:120px; padding:.5rem .6rem; font-size:.95rem; }

  table { width:100%; border-collapse:collapse; margin-top:12px; }
  thead th { text-align:left; padding:10px; color:#9aa3ad; font-size:.82rem; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.03); }
  td { padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; }
  .player-cell { display:flex; gap:.8rem; align-items:center; }
  .player-avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; border:1px solid rgba(255,255,255,0.03); }
  .player-name { font-weight:800; }
  .small { color:#9aa3ad; font-size:.92rem; }
  .debug { font-family:monospace; white-space:pre-wrap; font-size:.82rem; color:#9fb0c4; margin-top:.8rem; max-height:280px; overflow:auto; background: rgba(255,255,255,0.02); padding:10px; border-radius:8px; }
  .empty { color:#9aa3ad; padding:14px 0; }

  /* MVP table small helpers */
  .mvp-title { font-weight:700; color:#9aa3ad; margin-bottom:8px; }

  /* responsive tweaks — keep table-to-cards behavior on small viewports */
  @media (max-width: 860px) {
    .select { min-width:140px; }
    thead th { font-size: .78rem; }
    .player-avatar { width:48px; height:48px; }
  }

  @media (max-width: 700px) {
    .page { padding: 0 12px; }
    .card { padding: 12px; }
    /* Convert tables -> stacked cards for readability */
    table, thead, tbody, th, td, tr { display: block; width: 100%; }
    thead { display: none; }
    tbody tr { margin-bottom: 12px; background: rgba(255,255,255,0.02); padding: 10px; border-radius: 10px; display:flex; gap:8px; align-items:center; }
    td { padding: 6px 0; border-bottom: none; display:flex; justify-content:space-between; align-items:center; width:100%; }
    td > div { flex:1; min-width:0; }
    td::before { content: attr(data-label) ": "; font-weight:700; color:#9aa3ad; margin-right:8px; flex-shrink:0; white-space:nowrap; }
    .player-avatar { width:44px; height:44px; }
    .player-cell { gap:0.6rem; }
    .select { min-width:120px; }
    .compact-select { min-width:100px; padding:.45rem .55rem; }
    .debug { font-size:0.85rem; }
  }

  /* small visual polish for very narrow phones */
  @media (max-width: 360px) {
    .player-name { font-size: .95rem; }
    .small { font-size: .85rem; }
  }
</style>

<div class="page">
  <!-- MVPs card (title + selector inside this card) -->
  <div class="card" aria-labelledby="mvp-heading">
    <div class="topline" style="margin-bottom:8px;">
      <div>
        <h2 id="mvp-heading" style="margin:0 0 6px 0;">Player Records — MVPs</h2>
        <div class="muted" style="margin-bottom:0;">Select a season to view Overall & Finals MVP for that season (dropdown controls only the MVPs)</div>
      </div>

      <!-- keep selector inside the same card as requested -->
      <form id="filters" method="get" class="filters" style="margin:0;">
        <label class="muted" for="season-select" style="margin-right:.6rem;">Season</label>
        <select id="season-select" name="season" class="select compact-select" on:change={submitFilters} aria-label="Select season">
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>
              {s.season ?? s.name ?? s.league_id}
            </option>
          {/each}
        </select>
      </form>
    </div>

    <h3 class="mvp-title" style="margin:0 0 8px 0;">MVPs</h3>

    <table aria-label="MVPs">
      <thead>
        <tr>
          <th style="width:35%;">Team</th>
          <th style="width:45%;">Player (role)</th>
          <th style="width:20%;">Pts</th>
        </tr>
      </thead>
      <tbody>
        {#if om}
          <tr>
            <td data-label="Team">
              <div style="display:flex; gap:.6rem; align-items:center;">
                <img class="player-avatar" src={om.roster_meta?.team_avatar || getTeamAvatar(om) || avatarOrPlaceholder(null, getTeamName(om))} alt={getTeamName(om)} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, getTeamName(om)))} style="width:48px;height:48px"/>
                <div style="min-width:0;">
                  <div style="font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{getTeamName(om)}</div>
                  <div class="small" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{getOwnerName(om)}</div>
                </div>
              </div>
            </td>

            <td data-label="Player (role)">
              <div class="player-cell" style="min-width:0;">
                <img class="player-avatar" src={om.playerAvatar || playerHeadshot(om.playerId) || avatarOrPlaceholder(null, om.playerName)} alt={om.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(om.roster_meta?.team_avatar, om.playerName))}/>
                <div style="min-width:0; overflow:hidden;">
                  <div class="player-name" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{om.playerName}</div>
                  <div class="small">Overall MVP • {formatPts(om.points)} pts</div>
                </div>
              </div>
            </td>

            <td data-label="Pts" style="font-weight:800; white-space:nowrap;">{formatPts(om.points)}</td>
          </tr>
        {:else}
          <tr>
            <td data-label="Team"><div class="empty">No overall MVP</div></td>
            <td data-label="Player (role)"><div class="empty">—</div></td>
            <td data-label="Pts"><div class="empty">—</div></td>
          </tr>
        {/if}

        {#if fm}
          <tr>
            <td data-label="Team">
              <div style="display:flex; gap:.6rem; align-items:center;">
                <img class="player-avatar" src={fm.roster_meta?.team_avatar || getTeamAvatar(fm) || avatarOrPlaceholder(null, getTeamName(fm))} alt={getTeamName(fm)} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, getTeamName(fm)))} style="width:48px;height:48px"/>
                <div style="min-width:0;">
                  <div style="font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{getTeamName(fm)}</div>
                  <div class="small" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{getOwnerName(fm)}</div>
                </div>
              </div>
            </td>

            <td data-label="Player (role)">
              <div class="player-cell" style="min-width:0;">
                <img class="player-avatar" src={fm.playerAvatar || playerHeadshot(fm.playerId) || avatarOrPlaceholder(null, fm.playerName)} alt={fm.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(fm.roster_meta?.team_avatar, fm.playerName))}/>
                <div style="min-width:0; overflow:hidden;">
                  <div class="player-name" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{fm.playerName}</div>
                  <div class="small">Finals MVP • {formatPts(fm.points)} pts</div>
                </div>
              </div>
            </td>

            <td data-label="Pts" style="font-weight:800; white-space:nowrap;">{formatPts(fm.points)}</td>
          </tr>
        {:else}
          <tr>
            <td data-label="Team"><div class="empty">No finals MVP</div></td>
            <td data-label="Player (role)"><div class="empty">—</div></td>
            <td data-label="Pts"><div class="empty">—</div></td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>

  <!-- All-time Playoff Best card -->
  <div class="card" aria-labelledby="playoff-heading">
    <h3 id="playoff-heading" style="margin:0 0 8px 0;">All-time single-season playoff best (best player for each team — 2022→present)</h3>

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
              <td data-label="Team">
                <div style="display:flex; gap:.6rem; align-items:center;">
                  <img class="player-avatar" src={row.teamAvatar || avatarOrPlaceholder(null, getTeamName(row))} alt={getTeamName(row)} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, getTeamName(row)))} style="width:48px;height:48px"/>
                  <div style="min-width:0;">
                    <div style="font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{row.teamName ?? getTeamName(row)}</div>
                    <div class="small" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{row.owner_name ?? getOwnerName(row)}</div>
                  </div>
                </div>
              </td>
              <td data-label="Player (season)">
                <div class="player-cell" style="min-width:0;">
                  <img class="player-avatar" src={row.playerAvatar || playerHeadshot(row.playerId) || avatarOrPlaceholder(null, row.playerName)} alt={row.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, row.playerName))}/>
                  <div style="min-width:0; overflow:hidden;">
                    <div class="player-name" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{row.playerName ?? `Player ${row.playerId}`}</div>
                    <div class="small">Season {row.season}</div>
                  </div>
                </div>
              </td>
              <td data-label="Pts" style="font-weight:800; white-space:nowrap;">{formatPts(row.points)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No playoff bests available.</div>
    {/if}
  </div>

  <!-- All-time Full-Season Best card -->
  <div class="card" aria-labelledby="fullseason-heading">
    <h3 id="fullseason-heading" style="margin:0 0 8px 0;">All-time single-season full-season best (best player for each team — includes regular + playoffs, 2022→present)</h3>

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
              <td data-label="Team">
                <div style="display:flex; gap:.6rem; align-items:center;">
                  <img class="player-avatar" src={row.teamAvatar || avatarOrPlaceholder(null, getTeamName(row))} alt={getTeamName(row)} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, getTeamName(row)))} style="width:48px;height:48px"/>
                  <div style="min-width:0;">
                    <div style="font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{row.teamName ?? getTeamName(row)}</div>
                    <div class="small" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{row.owner_name ?? getOwnerName(row)}</div>
                  </div>
                </div>
              </td>
              <td data-label="Player (season)">
                <div class="player-cell" style="min-width:0;">
                  <img class="player-avatar" src={row.playerAvatar || playerHeadshot(row.playerId) || avatarOrPlaceholder(null, row.playerName)} alt={row.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, row.playerName))}/>
                  <div style="min-width:0; overflow:hidden;">
                    <div class="player-name" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{row.playerName ?? `Player ${row.playerId}`}</div>
                    <div class="small">Season {row.season}</div>
                  </div>
                </div>
              </td>
              <td data-label="Pts" style="font-weight:800; white-space:nowrap;">{formatPts(row.points)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No full-season bests available.</div>
    {/if}
  </div>

  <!-- JSON links & debug card -->
  <div class="card" aria-labelledby="debug-heading">
    <h3 id="debug-heading" style="margin:0 0 8px 0;">Loaded JSON & Messages</h3>

    {#if jsonLinks && jsonLinks.length}
      <div style="margin-top:6px;">
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
