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

  // --- Team single-season leaders computation (client-side best-effort) ---
  // We'll try to read matchups from:
  // 1) selectedRow.fullSeasonMatchupsRows (preferred)
  // 2) selectedRow.matchupsRows  (fallback — may only include playoffs)
  // Each matchup should have the normalized shape used across the app:
  // { week, teamA: { rosterId, starters, starters_points, player_points }, teamB: {...} }
  // We aggregate only regular-season weeks: week 1..(championshipWeek - playoffLength) is ambiguous;
  // We'll treat "regular season" as weeks 1..(championshipWeek - 2) if championshipWeek present, otherwise weeks 1..(selectedRow.championshipWeek ?? 23)
  let perTeamLeaders = []; // array of { rosterId, roster_name, topPlayerId, topPlayerName, points, avatar }
  let playersMap = null;
  let playersMapLoaded = false;
  let playersMapError = null;

  // lazy load playersMap when needed
  async function fetchPlayersMapClient() {
    try {
      const res = await fetch('https://api.sleeper.app/v1/players/nba');
      if (!res.ok) throw new Error('players fetch failed');
      const obj = await res.json();
      playersMap = obj || {};
      playersMapLoaded = true;
    } catch (e) {
      playersMap = {};
      playersMapLoaded = true;
      playersMapError = String(e);
    }
  }

  // try to compute per-team leaders from a single array of matchups
  function computeLeadersFromMatchups(allMatchups, championshipWeek, rosterMetaMap = {}) {
    if (!Array.isArray(allMatchups) || !allMatchups.length) return [];

    // decide regular season cutoff:
    let champWeek = (typeof championshipWeek !== 'undefined' && championshipWeek !== null) ? Number(championshipWeek) : null;
    if (!champWeek || isNaN(champWeek)) champWeek = null;

    // if champWeek known, treat regular as 1..(champWeek - 2) (common 3-week playoff); else include weeks 1..(maxWeek - 2)
    let maxWeek = 0;
    for (const m of allMatchups) if (m && m.week && Number(m.week) > maxWeek) maxWeek = Number(m.week);
    if (!champWeek && maxWeek > 0) champWeek = maxWeek;

    const regEnd = (champWeek && champWeek > 2) ? (champWeek - 2) : Math.max(1, Math.min(regularCandidateMaxWeek(allMatchups), Math.max(1, maxWeek)));
    // aggregate per player and per roster (only regular-season weeks)
    const perPlayer = {}; // pid -> { points, byRoster: { rosterId: pts } }
    function note(pid, pts, rosterId) {
      if (!pid) return;
      const id = String(pid);
      if (!perPlayer[id]) perPlayer[id] = { points: 0, byRoster: {} };
      perPlayer[id].points += Number(pts) || 0;
      if (rosterId) perPlayer[id].byRoster[String(rosterId)] = (perPlayer[id].byRoster[String(rosterId)] || 0) + (Number(pts) || 0);
    }

    for (const m of allMatchups) {
      if (!m || !m.week) continue;
      const wk = Number(m.week);
      if (isNaN(wk) || wk < 1) continue;
      if (wk > regEnd) continue;

      for (const side of ['teamA','teamB']) {
        const t = m[side];
        if (!t) continue;
        // starters + starters_points arrays
        if (Array.isArray(t.starters) && Array.isArray(t.starters_points) && t.starters.length === t.starters_points.length) {
          for (let i = 0; i < t.starters.length; i++) {
            const pid = t.starters[i];
            const pts = Number(t.starters_points[i]) || 0;
            if (!pid || String(pid) === '0') continue;
            note(pid, pts, t.rosterId ?? null);
          }
        } else if (Array.isArray(t.player_points)) {
          // array of { player_id, points } or { playerId, points }
          for (const pp of t.player_points) {
            if (!pp) continue;
            const pid = pp.player_id ?? pp.playerId ?? pp.id ?? null;
            const pts = Number(pp.points ?? pp.pts ?? 0);
            if (!pid || String(pid) === '0') continue;
            note(pid, pts, t.rosterId ?? null);
          }
        } else if (t.player_points && typeof t.player_points === 'object') {
          // object mapping playerId -> points
          for (const pidKey of Object.keys(t.player_points || {})) {
            const ppts = Number(t.player_points[pidKey]) || 0;
            if (!pidKey || String(pidKey) === '0') continue;
            note(pidKey, ppts, t.rosterId ?? null);
          }
        }
      }
    }

    // build roster -> top player
    const rosterPlayers = {}; // rosterId -> { pid -> pts }
    for (const pid of Object.keys(perPlayer)) {
      const pinfo = perPlayer[pid];
      for (const rid of Object.keys(pinfo.byRoster || {})) {
        rosterPlayers[rid] = rosterPlayers[rid] || {};
        rosterPlayers[rid][pid] = (rosterPlayers[rid][pid] || 0) + (pinfo.byRoster[rid] || 0);
      }
    }

    const out = [];
    for (const rid of Object.keys(rosterPlayers)) {
      const playersForRoster = rosterPlayers[rid];
      let topPid = null, topPts = -Infinity;
      for (const pid of Object.keys(playersForRoster)) {
        const pts = playersForRoster[pid] || 0;
        if (pts > topPts) { topPts = pts; topPid = pid; }
      }
      const rosterMeta = rosterMetaMap && rosterMetaMap[rid] ? rosterMetaMap[rid] : null;
      out.push({
        rosterId: rid,
        roster_name: rosterMeta?.team_name ?? rosterMeta?.owner_name ?? `Roster ${rid}`,
        topPlayerId: topPid,
        topPlayerName: (playersMap && playersMap[topPid] && (playersMap[topPid].full_name || (playersMap[topPid].first_name ? (playersMap[topPid].first_name + ' ' + (playersMap[topPid].last_name ?? '')) : playersMap[topPid].player_name))) || null,
        points: Math.round((topPts || 0) * 100) / 100,
        avatar: (playersMap && playersMap[topPid] && playersMap[topPid].search_player_id) ? playerHeadshot(playersMap[topPid].search_player_id) : (playersMap && playersMap[topPid] && playersMap[topPid].player_id ? playerHeadshot(playersMap[topPid].player_id) : null)
      });
    }

    // ensure a deterministic order (by roster name)
    out.sort((a,b) => {
      const A = (a.roster_name || '').toLowerCase();
      const B = (b.roster_name || '').toLowerCase();
      if (A < B) return -1;
      if (A > B) return 1;
      return 0;
    });

    return out;
  }

  // choose a reasonable max-week for regular season if no championshipWeek provided
  function regularCandidateMaxWeek(matchups) {
    let maxW = 0;
    for (const m of matchups || []) if (m && m.week && Number(m.week) > maxW) maxW = Number(m.week);
    // assume playoffs last 3 weeks; regular ~= maxW - 3 (but at least 17)
    if (maxW <= 6) return Math.max(1, maxW);
    return Math.max(1, Math.min(20, maxW - 3));
  }

  // compute perTeamLeaders whenever selectedRow changes
  $: (async () => {
    perTeamLeaders = [];
    // try to use fullSeasonMatchupsRows (server could provide)
    let allMatchups = null;
    if (selectedRow?.fullSeasonMatchupsRows && Array.isArray(selectedRow.fullSeasonMatchupsRows) && selectedRow.fullSeasonMatchupsRows.length) {
      allMatchups = selectedRow.fullSeasonMatchupsRows;
    } else if (selectedRow?.matchupsRows && Array.isArray(selectedRow.matchupsRows) && selectedRow.matchupsRows.length) {
      // fallback — might only be playoffs; still attempt
      allMatchups = selectedRow.matchupsRows;
    } else if (selectedRow?.rawMatchups && Array.isArray(selectedRow.rawMatchups) && selectedRow.rawMatchups.length) {
      allMatchups = selectedRow.rawMatchups;
    } else {
      // nothing to compute client-side
      perTeamLeaders = [];
      return;
    }

    // ensure playersMap loaded (non-blocking)
    if (!playersMapLoaded) await fetchPlayersMapClient();

    // roster metadata map: try to use selectedRow.rosterMap if server attached it
    const rosterMetaMap = selectedRow?.rosterMap ?? selectedRow?.roster_meta_map ?? {};
    const leaders = computeLeadersFromMatchups(allMatchups, selectedRow?.championshipWeek ?? selectedRow?.champWeek ?? null, rosterMetaMap);

    // attempt to attach missing names/avatars using playersMap if available
    for (const l of leaders) {
      if (!l.topPlayerName && playersMap && playersMap[l.topPlayerId]) {
        const p = playersMap[l.topPlayerId];
        l.topPlayerName = p.full_name || (p.first_name ? `${p.first_name} ${p.last_name ?? ''}` : (p.display_name || p.player_name || null)) || l.topPlayerName;
        // many Sleeper player objects use the player_id key that the CDN expects; try several
        if (!l.avatar) {
          const pid = p.player_id ?? p.search_player_id ?? p.playerId ?? p.player_id;
          if (pid) l.avatar = playerHeadshot(pid);
        }
      }
      // ensure avatar fallback
      if (!l.avatar) l.avatar = avatarOrPlaceholder(null, l.topPlayerName || 'Player');
    }

    perTeamLeaders = leaders;
  })();
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

    <!-- MVP table (no season column) -->
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
                  src={playerHeadshot(selectedRow.overallMvp.playerId) || selectedRow.overallMvp.player_avatar || selectedRow.overallMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, selectedRow.overallMvp.playerName)}
                  alt={selectedRow.overallMvp.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(selectedRow.overallMvp.roster_meta?.team_avatar ?? selectedRow.overallMvp.roster_meta?.owner_avatar, selectedRow.overallMvp.playerName))}
                />
                <div>
                  <div class="player-name">{selectedRow.overallMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(selectedRow.overallMvp.points)}</div>
                  {#if selectedRow.overallMvp.roster_meta}
                    <div class="small">Top roster: {selectedRow.overallMvp.roster_meta.team_name ?? selectedRow.overallMvp.roster_meta.owner_name}</div>
                  {/if}
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
                  src={playerHeadshot(selectedRow.finalsMvp.playerId) || selectedRow.finalsMvp.player_avatar || selectedRow.finalsMvp.roster_meta?.team_avatar || avatarOrPlaceholder(null, selectedRow.finalsMvp.playerName)}
                  alt={selectedRow.finalsMvp.playerName}
                  on:error={(e) => onImgError(e, avatarOrPlaceholder(selectedRow.finalsMvp.roster_meta?.team_avatar ?? selectedRow.finalsMvp.roster_meta?.owner_avatar, selectedRow.finalsMvp.playerName))}
                />
                <div>
                  <div class="player-name">{selectedRow.finalsMvp.playerName}</div>
                  <div class="small">Pts: {formatPts(selectedRow.finalsMvp.points)}</div>
                  {#if selectedRow.finalsMvp.roster_meta}
                    <div class="small">Roster: {selectedRow.finalsMvp.roster_meta.team_name ?? selectedRow.finalsMvp.roster_meta.owner_name}</div>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="empty">No finals MVP determined for this season.</div>
            {/if}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Team single-season leaders -->
    <h3 style="margin-top:18px; margin-bottom:8px;">Team single-season leaders (regular season)</h3>
    {#if perTeamLeaders && perTeamLeaders.length}
      <table aria-label="Team single-season leaders">
        <thead>
          <tr>
            <th style="width:40%;">Team</th>
            <th style="width:40%;">Top player (season total)</th>
            <th style="width:20%;">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each perTeamLeaders as t (t.rosterId)}
            <tr>
              <td>
                <div style="font-weight:800;">{t.roster_name}</div>
                <div class="small">Roster #{t.rosterId}</div>
              </td>
              <td>
                <div class="player-cell">
                  <img class="player-avatar" src={t.avatar || avatarOrPlaceholder(null, t.topPlayerName)} alt={t.topPlayerName} on:error={(e) => onImgError(e, avatarOrPlaceholder(null, t.topPlayerName))}/>
                  <div>
                    <div class="player-name">{t.topPlayerName ?? `Player ${t.topPlayerId ?? ''}`}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:800;">{formatPts(t.points)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted" style="margin-bottom:12px;">
        Per-team single-season leader data is not available client-side. To enable this table:
        <ul>
          <li>Have the server include a full-season normalized matchups array for the season (field name: <code>fullSeasonMatchupsRows</code> or <code>matchupsRows</code>) containing per-week entries of the form:
            <pre style="display:inline-block; background:rgba(0,0,0,0.35); padding:6px; border-radius:6px;">
{`{ week: 1, teamA: { rosterId: '3', starters: ['1658',...], starters_points: [12.3,...], player_points: {...} }, teamB: { ... } }`}
            </pre>
          </li>
          <li>Optionally server can precompute and return <code>topPlayersByTeam</code> or <code>rosterMap</code> to avoid client computation.</li>
        </ul>
      </div>
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
