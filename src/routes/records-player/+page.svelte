<!-- src/routes/records-player/+page.svelte -->
<script>
  import { onMount } from 'svelte';

  export let data;

  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);

  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? null;

  // Sleeper CDN headshot
  function playerHeadshot(playerId, size = 56) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name.split(' ').map(n=>n[0]||'').slice(0,2).join('') : 'P';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=07101a&color=ffffff&size=${size}`;
  }

  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 100) / 100);
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function onImgError(e, fallback) {
    try { e.currentTarget.src = fallback; } catch(_) {}
  }

  // Resolve team/owner metadata for an MVP object (server returns roster_meta when available)
  function resolveMvpTeamOwner(mvp, row) {
    if (!mvp) return { teamName: null, ownerName: null, teamAvatar: null, playerAvatar: null, playerName: null };
    const rosterMap = row?.rosterMap ?? row?.roster_meta_map ?? {};
    // prefer server-provided roster_meta
    const rosterFromMvp = mvp.roster_meta ?? null;
    // if roster not present, attempt topRosterId or topRoster
    const rosterId = (mvp.topRosterId ?? mvp.top_roster_id ?? (rosterFromMvp && rosterFromMvp.roster_id) ?? null) || (mvp.rosterId ?? null);
    const rosterMeta = rosterFromMvp || (rosterId ? (rosterMap[String(rosterId)] ?? null) : null);

    const teamName = mvp.teamName ?? mvp.team_name ?? rosterMeta?.team_name ?? rosterMeta?.owner_name ?? null;
    const ownerName = mvp.owner_name ?? rosterMeta?.owner_name ?? null;
    const teamAvatar = rosterMeta?.team_avatar ?? rosterMeta?.owner_avatar ?? mvp.teamAvatar ?? null;

    // player headshot: try mvp.playerAvatar, mvp.player_id variants, or CDN by playerId
    const playerAvatar = mvp.playerAvatar ?? mvp.player_avatar ?? playerHeadshot(mvp.playerId ?? mvp.player_id ?? mvp.topPlayerId ?? null);

    const playerName = mvp.playerName ?? mvp.player_name ?? mvp.player ?? null;

    return { teamName, ownerName, teamAvatar, playerAvatar, playerName };
  }

  // reactive resolved MVP info for markup usage (computed in script to avoid invalid template directives)
  $: ovInfo = selectedRow?.overallMvp ? resolveMvpTeamOwner(selectedRow.overallMvp, selectedRow) : null;
  $: fvInfo = selectedRow?.finalsMvp ? resolveMvpTeamOwner(selectedRow.finalsMvp, selectedRow) : null;

  // server-provided team / roster leader arrays (these must be provided by server; we use them directly)
  const allTimePlayoffBestPerRoster = Array.isArray(data?.allTimePlayoffBestPerRoster) ? data.allTimePlayoffBestPerRoster : (data?.allTimePlayoffBestPerRoster ?? []);
  const allTimeFullSeasonBestPerRoster = Array.isArray(data?.allTimeFullSeasonBestPerRoster) ? data.allTimeFullSeasonBestPerRoster : (data?.allTimeFullSeasonBestPerRoster ?? []);

  // rosterNameMap helper (server may provide mapping)
  const rosterNameMap = data?.rosterNameMap ?? {};

  // utility to get display team/owner from a row
  function getTeamOwnerInfo(row) {
    // row may already include teamAvatar, owner_name, teamName
    const rInfo = rosterNameMap[String(row.rosterId)] ?? {};
    const teamName = row.teamName ?? rInfo.teamName ?? row.owner_name ?? rInfo.ownerName ?? (`Roster ${row.rosterId}`);
    const ownerName = (row.owner_name ?? rInfo.ownerName) || null;
    const teamAvatar = row.teamAvatar ?? row.team_avatar ?? rInfo.teamAvatar ?? rInfo.avatar ?? null;
    return { teamName, ownerName, teamAvatar };
  }
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
  .team-col { font-weight:800; }
</style>

<div class="page">
  <div class="card">
    <div class="topline">
      <div>
        <h2 style="margin:0 0 6px 0;">Player Records — MVPs</h2>
        <div class="muted" style="margin-bottom:6px;">Shows Overall MVP and Finals MVP for the selected season.</div>
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
              <div class="player-cell">
                <img
                  class="player-avatar"
                  src={ovInfo?.playerAvatar || ovInfo?.teamAvatar || avatarOrPlaceholder(null, ovInfo?.playerName)}
                  alt={ovInfo?.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(ovInfo?.teamAvatar ?? null, ovInfo?.playerName))}
                />
                <div>
                  <div class="player-name">{ovInfo?.playerName ?? selectedRow.overallMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(selectedRow.overallMvp.points ?? selectedRow.overallMvp.total ?? 0)}</div>
                  <div class="small">Team: {ovInfo?.teamName ?? (selectedRow.overallMvp.roster_meta?.team_name ?? `Roster ${selectedRow.overallMvp.topRosterId ?? selectedRow.overallMvp.rosterId ?? ''}`)}{#if (ovInfo?.ownerName) } • {ovInfo.ownerName}{/if}</div>
                </div>
              </div>
            {:else}
              <div class="empty">No overall MVP determined for this season.</div>
            {/if}
          </td>

          <td>
            {#if selectedRow?.finalsMvp}
              <div class="player-cell">
                <img
                  class="player-avatar"
                  src={fvInfo?.playerAvatar || fvInfo?.teamAvatar || avatarOrPlaceholder(null, fvInfo?.playerName)}
                  alt={fvInfo?.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(fvInfo?.teamAvatar ?? null, fvInfo?.playerName))}
                />
                <div>
                  <div class="player-name">{fvInfo?.playerName ?? selectedRow.finalsMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(selectedRow.finalsMvp.points ?? selectedRow.finalsMvp.score ?? 0)}</div>
                  <div class="small">Team: {fvInfo?.teamName ?? (selectedRow.finalsMvp.roster_meta?.team_name ?? `Roster ${selectedRow.finalsMvp.topRosterId ?? selectedRow.finalsMvp.rosterId ?? ''}`)}{#if (fvInfo?.ownerName) } • {fvInfo.ownerName}{/if}</div>
                </div>
              </div>
            {:else}
              <div class="empty">No finals MVP determined for this season.</div>
            {/if}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- All-time single-season playoffs best per roster -->
    <h3 style="margin-top:18px; margin-bottom:8px;">All-time single-season playoff best per roster (best single-season playoff total)</h3>
    {#if allTimePlayoffBestPerRoster && allTimePlayoffBestPerRoster.length}
      <table aria-label="All-time playoff best per roster">
        <thead>
          <tr>
            <th style="width:40%;">Team</th>
            <th style="width:40%;">Top player (single-season, playoffs)</th>
            <th style="width:20%;">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each allTimePlayoffBestPerRoster as row (row.rosterId)}
            {#const ti = getTeamOwnerInfo(row)}
            <tr>
              <td>
                <div class="team-col">{ti.teamName}</div>
                <div class="small">{ti.ownerName ?? ''}</div>
              </td>
              <td>
                <div class="player-cell">
                  <img class="player-avatar" src={row.playerAvatar ?? playerHeadshot(row.playerId) ?? avatarOrPlaceholder(ti.teamAvatar, row.playerName)} alt={row.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(ti.teamAvatar, row.playerName))}/>
                  <div>
                    <div class="player-name">{row.playerName ?? (`Player ${row.playerId ?? ''}`)}</div>
                    <div class="small">Season: {row.season ?? '—'}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(row.points ?? row.playoffPoints ?? 0)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No playoff-best-per-roster data available.</div>
    {/if}

    <!-- All-time single-season full-season best per roster -->
    <h3 style="margin-top:18px; margin-bottom:8px;">All-time single-season full-season best per roster (regular season + playoffs)</h3>
    {#if allTimeFullSeasonBestPerRoster && allTimeFullSeasonBestPerRoster.length}
      <table aria-label="All-time full-season best per roster">
        <thead>
          <tr>
            <th style="width:40%;">Team</th>
            <th style="width:40%;">Top player (single-season)</th>
            <th style="width:20%;">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each allTimeFullSeasonBestPerRoster as row (row.rosterId)}
            {#const ti = getTeamOwnerInfo(row)}
            <tr>
              <td>
                <div class="team-col">{ti.teamName}</div>
                <div class="small">{ti.ownerName ?? ''}</div>
              </td>
              <td>
                <div class="player-cell">
                  <img class="player-avatar" src={row.playerAvatar ?? playerHeadshot(row.playerId) ?? avatarOrPlaceholder(ti.teamAvatar, row.playerName)} alt={row.playerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(ti.teamAvatar, row.playerName))}/>
                  <div>
                    <div class="player-name">{row.playerName ?? (`Player ${row.playerId ?? ''}`)}</div>
                    <div class="small">Season: {row.season ?? '—'}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(row.points ?? row.totalPoints ?? 0)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No full-season-best-per-roster data available.</div>
    {/if}

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
