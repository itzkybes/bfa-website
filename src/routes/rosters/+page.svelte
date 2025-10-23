<script>
  // src/routes/rosters/+page.svelte
  import { onMount } from 'svelte';
  export let data;

  // collapsed state per roster — default false (expanded)
  let collapsed = {};

  // detect mobile to default-collapse on small screens
  let isMobile = false;
  onMount(() => {
    isMobile = (typeof window !== 'undefined') && window.innerWidth <= 760;
    if (isMobile && data?.data) {
      const keys = [];
      for (const league of (data.data || [])) {
        if (!league || !Array.isArray(league.rosters)) continue;
        for (const r of league.rosters) if (r && (r.rosterId ?? r.roster_id)) keys.push(r.rosterId ?? r.roster_id);
      }
      if (keys.length) {
        const m = { ...collapsed };
        for (const k of keys) {
          if (typeof m[k] !== 'boolean') m[k] = true; // default collapsed on mobile
        }
        collapsed = m;
      }
    }
  });

  // Initialize collapsed map to include roster IDs (preserve user toggles)
  $: if (data && data.data && data.data.length) {
    const map = {};
    for (const league of data.data) {
      if (!league || !Array.isArray(league.rosters)) continue;
      for (const r of league.rosters) {
        if (!r) continue;
        const id = r.rosterId ?? r.roster_id;
        map[id] = (typeof collapsed[id] === 'boolean') ? collapsed[id] : !!isMobile;
      }
    }
    const a = Object.keys(map).join(',');
    const b = Object.keys(collapsed).join(',');
    if (a !== b) collapsed = map;
  }

  function toggleCollapsed(id) {
    collapsed[id] = !collapsed[id];
    collapsed = { ...collapsed };
  }

  // --- Helpers (kept from your original implementation) ---
  function getPlayerInfo(id) {
    if (!id) return { name: 'Empty', team: '', positions: [], player_id: null };
    const players = data && data.players;
    let p = null;
    if (players) p = players[id] || players[id.toUpperCase()] || players[String(id)];
    if (!p) return { name: id, team: '', positions: [], player_id: id };
    const fullName = p.full_name || `${(p.first_name || '')} ${(p.last_name || '')}`.trim() || p.display_name || id;
    const positions = Array.isArray(p.fantasy_positions) ? p.fantasy_positions : (p.position ? [p.position] : []);
    return { name: fullName, team: p.team || p.team_abbreviation || 'FA', positions, player_id: p.player_id || id };
  }

  function getPlayerHeadshot(playerId) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  function _ro(r) { return r && r.raw ? r.raw : r || {}; }

  function getTaxiPlayers(roster) {
    const r = _ro(roster);
    return r?.taxi || r?.taxi_squad || r?.taxi_players || r?.taxiSquad || r?.taxi_roster || r?.taxiRoster || r?.taxi_list || r?.taxiPlayers || [];
  }

  function getStartersRaw(roster) {
    const r = _ro(roster);
    if (Array.isArray(r?.starters) && r.starters.length) return r.starters;
    if (Array.isArray(roster?.starters) && roster.starters.length) return roster.starters;
    if (Array.isArray(r?.starting_lineup) && r.starting_lineup.length) return r.starting_lineup;
    if (Array.isArray(r?.starters_list) && r.starters_list.length) return r.starters_list;
    const players = roster.player_ids || r?.players || [];
    let N = 9;
    if (r?.metadata && r.metadata.lineup_positions_count) N = Number(r.metadata.lineup_positions_count) || N;
    if (Array.isArray(players)) return players.slice(0, N);
    return [];
  }

  function getBenchPlayers(roster) {
    const players = (roster.player_ids || _ro(roster)?.players || []).slice();
    const starters = getStartersRaw(roster) || [];
    const taxi = getTaxiPlayers(roster) || [];
    const exclude = new Set((starters || []).map(String).concat((taxi || []).map(String)));
    return players.filter(p => p && !exclude.has(String(p)));
  }

  // fixed starter ordering
  const STARTER_SLOTS = ['PG','SG','G','SF','PF','F','C','UTIL','UTIL'];

  // badge colors
  const posColor = {
    PG: '#FF6B6B',
    SG: '#FF8C42',
    G:  '#FFB86B',
    SF: '#6BCB77',
    PF: '#4D96FF',
    F:  '#4D96FF',
    C:  '#A78BFA',
    UTIL: '#94A3B8',
    BN: '#0b1220',
    TX: '#F472B6'
  };

  function posBadgeStyle(pos) {
    const background = posColor[pos] || '#64748B';
    return `background:${background}; color: white; padding: .12rem .45rem; border-radius: 999px; font-size: .72rem; font-weight:600; margin-right:.25rem;`;
  }

  function slotLeftBadgeStyle(type) {
    const bg = type === 'BN' ? '#0b1220' : (posColor[type] || '#64748B');
    const color = type === 'BN' ? '#94a3b8' : 'white';
    return `background:${bg}; color:${color}; padding:.12rem .45rem; border-radius: 8px; font-weight:700; font-size:.72rem; margin-right:.45rem;`;
  }

  function getStarterForSlot(roster, index) {
    const arr = getStartersRaw(roster) || [];
    return arr[index] || null;
  }

  function shortName(fullName) {
    if (!fullName) return '';
    return fullName.split(' ')[0];
  }
</script>

<style>
  :global(body) { font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; color: #e6eef8; background: transparent; }
  .page { padding: 1rem 1.25rem; max-width: 1400px; margin: 0 auto; }

  h1 { margin: 0 0 .5rem 0; font-size: 1.6rem; }
  h2 { margin: .5rem 0 0.75rem 0; font-size: 1.05rem; color:#e6eef8; }

  .teams-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: 1fr;
    align-items: start;
  }
  @media (min-width: 900px) {
    .teams-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1.25rem;
    }
  }

  .team-card {
    background: rgba(255,255,255,0.02);
    border-radius: 10px;
    padding: 0.9rem;
    display:flex;
    gap:0.4rem;
    align-items:flex-start;
    position:relative;
    transition: padding .18s ease, max-height .18s ease, box-shadow .18s ease;
    overflow: visible;
    box-shadow: 0 1px 0 rgba(255,255,255,0.02) inset;
  }

  .team-card.collapsed {
    padding: 0.45rem 0.6rem;
    align-items:center;
    max-height:82px;
    box-shadow: none;
  }

  .team-card.collapsed .team-body {
    display: none !important;
  }

  /* reduce header width so players are closer */
  .team-side {
    display:flex;
    flex-direction:row;
    gap:.5rem;
    align-items:center;
    min-width:0;
    flex: 0 0 220px; /* tightened to 220px to bring players closer */
  }
  .team-card.collapsed .team-side { flex: 0 1 auto; }

  .team-meta { display:flex; flex-direction:column; gap:.25rem; transition: opacity .12s ease, transform .18s ease; min-width:0; max-width:200px; }
  .team-name { font-weight:700; font-size:1.05rem; transition: font-size .18s ease; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .team-owner { color:#94a3b8; font-size:.95rem; }
  .muted { font-size:.9rem; margin-top:.25rem; color:#9ca3af; }

  .team-body { flex:1 1 auto; display:flex; flex-direction:column; gap:1rem; min-width:0; }

  .section { background: rgba(255,255,255,0.01); padding:.45rem; border-radius:8px; }

  /* starters grid: make rows taller and increase gap so nothing touches/overlaps */
  .starters-grid {
    display: grid;
    gap: .75rem; /* increased gap */
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    align-items: start;
  }
  .starter-slot {
    display:flex;
    gap:.6rem;
    align-items:flex-start;
    padding:.36rem;
    border-radius:8px;
    background: rgba(255,255,255,0.01);
    min-width:0;
    min-height:64px; /* ensures headshot+name have room */
  }
  .slot-badge { font-weight:700; padding:.28rem .45rem; border-radius:6px; color:white; min-width:42px; text-align:center; font-size:.82rem; }

  /* allow starter name to wrap (keeps full name visible) */
  .starter-name {
    font-weight:700;
    line-height:1.05;
    white-space:normal;
    overflow:visible;
    text-overflow:clip;
  }

  .compact-toggle {
    position:absolute;
    right:.5rem;
    top:.5rem;
    background: rgba(255,255,255,0.03);
    border: none;
    color:#cbd5e1;
    padding:.4rem .6rem;
    border-radius:8px;
    cursor:pointer;
    font-weight:700;
    z-index:3;
    font-size:0.9rem;
  }

  .pill-grid { display:flex; gap:0.75rem; flex-wrap:wrap; align-items:flex-start; } /* increased gap and align to top */
  .pill {
    display:flex;
    gap:.5rem;
    align-items:center;
    padding:.4rem .6rem; /* slightly larger padding for wrapped names */
    border-radius:999px;
    background: rgba(255,255,255,0.02);
    color: #e6eef8;
    font-weight:600;
    min-width: 140px; /* ensures pill has room */
    max-width: 100%;
    overflow: visible;
    flex: 0 1 auto;
  }
  .pill .left-badge { height:28px; display:flex; align-items:center; justify-content:center; padding:.12rem .6rem; border-radius:8px; font-weight:700; font-size:.72rem; }
  .pill .thumb { width:34px; height:34px; border-radius:6px; object-fit:cover; background:#0b1220; flex-shrink:0; }
  .pill .meta { display:flex; flex-direction:column; line-height:1; font-size:.95rem; min-width:0; overflow:visible; }
  /* allow bench/taxi names to wrap and show fully */
  .pill .meta .name { font-weight:700; white-space:normal; overflow:visible; text-overflow:clip; }
  .pill .meta .team { color:#9ca3af; font-size:.78rem; margin-top:2px; }

  .pos-badges { display:flex; gap:.25rem; margin-left:.35rem; flex-wrap:wrap; }

  .headshot { width:52px; height:52px; border-radius:8px; object-fit:cover; background:#0b1220; border:1px solid rgba(255,255,255,0.03); flex-shrink:0; }
  .player-meta { display:flex; flex-direction:column; min-width:0; overflow:visible; }
  .player-name { font-weight:700; overflow:visible; text-overflow:clip; white-space:normal; }
  .player-team { color:#9ca3af; font-size:.85rem; margin-top:2px; }

  .empty { color:#9ca3af; font-style:italic; padding:.6rem; }

  @media (max-width: 760px) {
    .page { padding: 0.75rem 0.9rem; }
    .team-side { flex: 0 0 auto; }
    .team-avatar { width:56px; height:56px; }
    .team-card.collapsed { max-height:78px; }
    .headshot { width:40px; height:40px; }
    .pill { min-width: 110px; padding:.3rem .45rem; }
    .compact-toggle { padding:.35rem .5rem; font-size:0.85rem; }
    .starters-grid { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:.5rem; }
    .starter-slot { padding:.28rem; gap:.4rem; min-height:56px; }
    .slot-badge { font-size:0.78rem; padding:.28rem .45rem; min-width:36px; }
    .starter-name { font-size:0.95rem; }
    .pill-grid { gap:.6rem; }
    .pill .meta .name { font-size:0.95rem; }
  }

  @media (min-width: 1200px) {
    .team-avatar { width:88px; height:88px; }
    .headshot { width:56px; height:56px; }
    .teams-grid { gap: 1.25rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  a:focus, button:focus {
    outline: 3px solid rgba(0,198,216,0.18);
    outline-offset: 2px;
    border-radius: 6px;
  }
</style>

<div class="page">
  <h1>Team Rosters — Current Season</h1>

  {#if data?.data && data.data.length}
    {#each data.data as league (league.leagueId)}
      <div style="margin-bottom:1rem;">
        <h2>{league.leagueName ?? `Season ${league.season ?? league.leagueId}`}</h2>

        {#if league.rosters && league.rosters.length}
          <div class="teams-grid">
            {#each league.rosters as roster (roster.rosterId)}
              <article class="team-card" class:collapsed={collapsed[roster.rosterId]} aria-labelledby={"team-" + roster.rosterId}>
                <button class="compact-toggle"
                  aria-pressed={!collapsed[roster.rosterId]}
                  on:click={() => toggleCollapsed(roster.rosterId)}>
                  {collapsed[roster.rosterId] ? 'Expand' : 'Collapse'}
                </button>

                <div class="team-side">
                  <img class="team-avatar"
                    src={roster.team_avatar || roster.owner_avatar || 'https://via.placeholder.com/72?text=?'}
                    alt={roster.team_name}
                    on:error={(e)=>e.target.style.visibility='hidden'} />

                  <div class="team-meta">
                    <div class="team-name" id={"team-" + roster.rosterId} title={roster.team_name}>{roster.team_name}</div>
                    {#if roster.owner_name}
                      <div class="team-owner" title={roster.owner_name}>{roster.owner_name}</div>
                    {/if}
                    <div class="muted">
                      Bench: {getBenchPlayers(roster).length} • Taxi: {getTaxiPlayers(roster).length}
                    </div>
                  </div>
                </div>

                <div class="team-body" aria-hidden={collapsed[roster.rosterId]}>
                  <section class="section" aria-labelledby={"starters-" + roster.rosterId}>
                    <h3 id={"starters-" + roster.rosterId}>Starters</h3>
                    <div class="starters-grid">
                      {#each STARTER_SLOTS as slot, i}
                        <div class="starter-slot">
                          <div class="slot-badge" style="background:{posColor[slot] || '#64748B'}">{slot}</div>
                          {#if getStarterForSlot(roster, i)}
                            <img class="headshot" src={getPlayerHeadshot(getPlayerInfo(getStarterForSlot(roster, i)).player_id)} alt={getPlayerInfo(getStarterForSlot(roster, i)).name} on:error={(e)=>e.target.style.visibility='hidden'} />
                            <div style="margin-left:.5rem; min-width:0;">
                              <div class="starter-name" title={getPlayerInfo(getStarterForSlot(roster, i)).name}>{getPlayerInfo(getStarterForSlot(roster, i)).name}</div>
                              <div class="player-team">{getPlayerInfo(getStarterForSlot(roster, i)).team}</div>
                              <div style="margin-top:.35rem;">
                                {#if getPlayerInfo(getStarterForSlot(roster, i)).positions && getPlayerInfo(getStarterForSlot(roster, i)).positions.length}
                                  {#each getPlayerInfo(getStarterForSlot(roster, i)).positions as pos}
                                    <span style={posBadgeStyle(pos)}>{pos}</span>
                                  {/each}
                                {:else}
                                  <span style={posBadgeStyle('UTIL')}>UTIL</span>
                                {/if}
                              </div>
                            </div>
                          {:else}
                            <div style="margin-left:.5rem; color:#9ca3af;">Empty</div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </section>

                  <section class="section" aria-labelledby={"bench-" + roster.rosterId}>
                    <h3 id={"bench-" + roster.rosterId}>Bench</h3>
                    {#if (getBenchPlayers(roster) || []).length}
                      <div class="pill-grid">
                        {#each getBenchPlayers(roster) as pid (pid)}
                          {#if pid}
                            <div class="pill" title={getPlayerInfo(pid).name}>
                              <div class="left-badge" style={slotLeftBadgeStyle('BN')}>BN</div>
                              <img class="thumb" src={getPlayerHeadshot(getPlayerInfo(pid).player_id)} alt={getPlayerInfo(pid).name} on:error={(e)=>e.target.style.visibility='hidden'} />
                              <div class="meta">
                                <div class="name" title={getPlayerInfo(pid).name}>{getPlayerInfo(pid).name}</div>
                                <div class="team">{getPlayerInfo(pid).team}</div>
                              </div>
                              <div class="pos-badges" aria-hidden="true">
                                {#if getPlayerInfo(pid).positions && getPlayerInfo(pid).positions.length}
                                  {#each getPlayerInfo(pid).positions as pos}
                                    <span style={posBadgeStyle(pos)}>{pos}</span>
                                  {/each}
                                {:else}
                                  <span style={posBadgeStyle('BN')}>BN</span>
                                {/if}
                              </div>
                            </div>
                          {/if}
                        {/each}
                      </div>
                    {:else}
                      <div class="empty">Bench is empty (players may be starters or on taxi).</div>
                    {/if}
                  </section>

                  <section class="section" aria-labelledby={"taxi-" + roster.rosterId}>
                    <h3 id={"taxi-" + roster.rosterId}>Taxi Squad</h3>
                    {#if (getTaxiPlayers(roster) || []).length}
                      <div class="pill-grid">
                        {#each getTaxiPlayers(roster) as pid (pid)}
                          {#if pid}
                            <div class="pill" title={getPlayerInfo(pid).name}>
                              <div class="left-badge" style={slotLeftBadgeStyle('TX')}>TX</div>
                              <img class="thumb" src={getPlayerHeadshot(getPlayerInfo(pid).player_id)} alt={getPlayerInfo(pid).name} on:error={(e)=>e.target.style.visibility='hidden'} />
                              <div class="meta">
                                <div class="name" title={getPlayerInfo(pid).name}>{getPlayerInfo(pid).name}</div>
                                <div class="team">{getPlayerInfo(pid).team}</div>
                              </div>
                              <div class="pos-badges" aria-hidden="true">
                                {#if getPlayerInfo(pid).positions && getPlayerInfo(pid).positions.length}
                                  {#each getPlayerInfo(pid).positions as pos}
                                    <span style={posBadgeStyle(pos)}>{pos}</span>
                                  {/each}
                                {:else}
                                  <span style={posBadgeStyle('TX')}>TX</span>
                                {/if}
                              </div>
                            </div>
                          {/if}
                        {/each}
                      </div>
                    {:else}
                      <div class="empty">Taxi squad is empty.</div>
                    {/if}
                  </section>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <div class="empty">No rosters available.</div>
        {/if}
      </div>
    {/each}
  {:else}
    <div class="empty">No rosters available.</div>
  {/if}
</div>
