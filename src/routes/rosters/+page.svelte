<!-- src/routes/rosters/+page.svelte — Team rosters grid -->
<script>
  import { onMount } from 'svelte';
  export let data;

  let collapsed = {};
  let isMobile = false;

  onMount(() => {
    isMobile = (typeof window !== 'undefined') && window.innerWidth <= 760;
    if (isMobile && data?.data) {
      const m = { ...collapsed };
      for (const league of data.data) {
        if (!Array.isArray(league.rosters)) continue;
        for (const r of league.rosters) {
          const id = r.rosterId ?? r.roster_id;
          if (id != null && typeof m[id] !== 'boolean') m[id] = true;
        }
      }
      collapsed = m;
    }
  });

  function toggle(id) {
    collapsed = { ...collapsed, [id]: !collapsed[id] };
  }

  function getPlayerInfo(id) {
    if (!id) return { name: 'Empty', team: '', positions: [], player_id: null };
    const players = data?.players;
    const p = players ? (players[id] || players[id.toUpperCase?.()] || players[String(id)]) : null;
    if (!p) return { name: id, team: '', positions: [], player_id: id };
    const fullName = p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.display_name || id;
    const positions = Array.isArray(p.fantasy_positions) ? p.fantasy_positions : (p.position ? [p.position] : []);
    return { name: fullName, team: p.team || p.team_abbreviation || 'FA', positions, player_id: p.player_id || id };
  }

  function headshot(pid) {
    return pid ? `https://sleepercdn.com/content/nba/players/${pid}.jpg` : '';
  }

  function _ro(r) { return r && r.raw ? r.raw : r || {}; }

  function getTaxi(r) {
    const x = _ro(r);
    return x?.taxi || x?.taxi_squad || x?.taxi_players || x?.taxiSquad || x?.taxi_roster || x?.taxi_list || [];
  }

  function getStarters(r) {
    const x = _ro(r);
    if (Array.isArray(x?.starters) && x.starters.length) return x.starters;
    if (Array.isArray(r?.starters) && r.starters.length) return r.starters;
    if (Array.isArray(x?.starting_lineup) && x.starting_lineup.length) return x.starting_lineup;
    const players = r.player_ids || x?.players || [];
    return Array.isArray(players) ? players.slice(0, 9) : [];
  }

  function getBench(r) {
    const all = (r.player_ids || _ro(r)?.players || []).slice();
    const exclude = new Set([
      ...(getStarters(r) || []).map(String),
      ...(getTaxi(r) || []).map(String)
    ]);
    return all.filter((p) => p && !exclude.has(String(p)));
  }

  const STARTER_SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL'];

  $: enhanced = data?.data && Array.isArray(data.data)
    ? data.data.map((league) => {
        const rosters = (league.rosters || []).map((r) => {
          const startersRaw = getStarters(r);
          const _starters = STARTER_SLOTS.map((slot, idx) => {
            const pid = startersRaw[idx] || null;
            return pid ? { slot, pid, player: getPlayerInfo(pid) } : { slot, pid: null, player: null };
          });
          const benchIds = getBench(r);
          const _bench = benchIds.map((pid) => ({ pid, player: getPlayerInfo(pid) }));
          const taxiIds = getTaxi(r);
          const _taxi = taxiIds.map((pid) => ({ pid, player: getPlayerInfo(pid) }));
          return { ...r, _starters, _bench, _taxi };
        });
        return { ...league, rosters };
      })
    : [];
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="eyebrow">League Rosters</div>
    <h1 class="page-title">Team Rosters</h1>
    <p class="page-sub">Current season starting lineups, bench, and taxi squads.</p>
  </header>

  {#if enhanced && enhanced.length}
    {#each enhanced as league (league.leagueId)}
      <div class="league-block">
        {#if league.leagueName}
          <div class="league-name">{league.leagueName} · <span class="season-tag">{league.season ?? ''}</span></div>
        {/if}

        {#if league.rosters && league.rosters.length}
          <div class="teams-grid" data-testid="rosters-grid">
            {#each league.rosters as roster, idx (roster.rosterId)}
              <article
                class="team-card rise"
                class:collapsed={collapsed[roster.rosterId]}
                style="animation-delay: {idx * 30}ms;"
                data-testid={`team-card-${roster.rosterId}`}
              >
                <div class="team-head">
                  <img
                    class="team-avatar"
                    src={roster.team_avatar || roster.owner_avatar || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 56 56%22%3E%3C/svg%3E'}
                    alt={roster.team_name}
                    on:error={(e) => (e.currentTarget.style.visibility = 'hidden')}
                  />
                  <div class="team-info">
                    <div class="team-name" title={roster.team_name}>{roster.team_name}</div>
                    {#if roster.owner_name}
                      <div class="team-owner">{roster.owner_name}</div>
                    {/if}
                    <div class="team-stats">
                      <span class="stat-pill"><b>{roster._starters.filter((s) => s.pid).length}</b> Starters</span>
                      <span class="stat-pill"><b>{roster._bench.length}</b> Bench</span>
                      <span class="stat-pill"><b>{roster._taxi.length}</b> Taxi</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="collapse-btn"
                    aria-pressed={!collapsed[roster.rosterId]}
                    on:click={() => toggle(roster.rosterId)}
                    data-testid={`team-collapse-${roster.rosterId}`}
                  >
                    {collapsed[roster.rosterId] ? '+' : '−'}
                  </button>
                </div>

                {#if !collapsed[roster.rosterId]}
                  <section class="team-body">
                    <div class="section-label">Starters</div>
                    <div class="starters">
                      {#each roster._starters as st, i (i)}
                        <div class="player-pill" title={st.player?.name}>
                          <span class="slot-badge pos-pill {st.slot}">{st.slot}</span>
                          {#if st.pid}
                            <img class="player-headshot" src={headshot(st.player?.player_id)} alt={st.player?.name} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                            <div class="player-info">
                              <div class="player-name">{st.player?.name}</div>
                              <div class="player-team">{st.player?.team}</div>
                            </div>
                            <div class="pos-tags">
                              {#if st.player?.positions?.length}
                                {#each st.player.positions as pos}
                                  <span class="pos-pill {pos}">{pos}</span>
                                {/each}
                              {:else}
                                <span class="pos-pill UTIL">UTIL</span>
                              {/if}
                            </div>
                          {:else}
                            <div class="player-info"><div class="player-name empty">— Empty —</div></div>
                          {/if}
                        </div>
                      {/each}
                    </div>

                    <div class="section-label">Bench</div>
                    {#if roster._bench.length}
                      <div class="bench-grid">
                        {#each roster._bench as b (b.pid)}
                          <div class="player-pill compact" title={b.player?.name}>
                            <span class="slot-badge pos-pill BN">BN</span>
                            <img class="player-headshot small" src={headshot(b.player?.player_id)} alt={b.player?.name} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                            <div class="player-info">
                              <div class="player-name">{b.player?.name}</div>
                              <div class="player-team">{b.player?.team}</div>
                            </div>
                            <div class="pos-tags">
                              {#if b.player?.positions?.length}
                                {#each b.player.positions as pos}
                                  <span class="pos-pill {pos}">{pos}</span>
                                {/each}
                              {/if}
                            </div>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <div class="empty-row">Bench is empty.</div>
                    {/if}

                    <div class="section-label">Taxi Squad</div>
                    {#if roster._taxi.length}
                      <div class="bench-grid">
                        {#each roster._taxi as t (t.pid)}
                          <div class="player-pill compact" title={t.player?.name}>
                            <span class="slot-badge pos-pill TX">TX</span>
                            <img class="player-headshot small" src={headshot(t.player?.player_id)} alt={t.player?.name} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                            <div class="player-info">
                              <div class="player-name">{t.player?.name}</div>
                              <div class="player-team">{t.player?.team}</div>
                            </div>
                            <div class="pos-tags">
                              {#if t.player?.positions?.length}
                                {#each t.player.positions as pos}
                                  <span class="pos-pill {pos}">{pos}</span>
                                {/each}
                              {/if}
                            </div>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <div class="empty-row">Taxi squad empty.</div>
                    {/if}
                  </section>
                {/if}
              </article>
            {/each}
          </div>
        {:else}
          <div class="empty-card">No rosters available for this league.</div>
        {/if}
      </div>
    {/each}
  {:else}
    <div class="empty-card" data-testid="rosters-empty">No rosters available.</div>
  {/if}
</div>

<style>
  .page {
    padding: 2.5rem 0 4rem;
  }

  .page-head {
    margin-bottom: 2rem;
  }

  .page-title {
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 6vw, 4rem);
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin: 0.4rem 0 0.5rem;
  }

  .page-sub {
    color: var(--text-secondary);
    font-size: 1rem;
    max-width: 60ch;
  }

  .league-block {
    margin-bottom: 2rem;
  }

  .league-name {
    font-family: var(--font-display);
    font-size: 1.3rem;
    text-transform: uppercase;
    color: var(--text-primary);
    letter-spacing: 0.06em;
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .season-tag {
    color: var(--accent);
  }

  .teams-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(440px, 1fr));
    gap: 1rem;
  }

  .team-card {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    overflow: hidden;
    transition: border-color var(--t-fast);
  }

  .team-card:hover {
    border-color: var(--border-strong);
  }

  .team-head {
    display: flex;
    gap: 0.85rem;
    align-items: center;
    padding: 1rem;
    background: linear-gradient(180deg, var(--surface-2), var(--surface-1));
    border-bottom: 1px solid var(--border-subtle);
  }

  .team-card.collapsed .team-head {
    border-bottom: none;
  }

  .team-avatar {
    width: 56px;
    height: 56px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .team-info { flex: 1; min-width: 0; }

  .team-name {
    font-family: var(--font-display);
    font-size: 1.25rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.1;
  }

  .team-owner {
    color: var(--text-secondary);
    font-size: 0.85rem;
    font-weight: 500;
    margin-top: 0.2rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .team-stats {
    display: flex;
    gap: 0.35rem;
    margin-top: 0.4rem;
    flex-wrap: wrap;
  }

  .stat-pill {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-secondary);
    background: var(--surface-2);
    padding: 0.18rem 0.45rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--border-subtle);
  }

  .stat-pill b {
    color: var(--accent);
    font-family: var(--font-display);
    font-weight: 400;
    margin-right: 0.2rem;
  }

  .collapse-btn {
    width: 36px;
    height: 36px;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    border-radius: var(--r-sm);
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
    transition: border-color var(--t-fast), background var(--t-fast);
    flex-shrink: 0;
  }

  .collapse-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .team-body {
    padding: 0.5rem 1rem 1rem;
  }

  .section-label {
    font-family: var(--font-body);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.7rem;
    color: var(--accent);
    margin: 1rem 0 0.5rem;
  }

  .section-label:first-child { margin-top: 0.5rem; }

  .starters {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .bench-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.4rem;
  }

  .player-pill {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.45rem 0.6rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    transition: border-color var(--t-fast);
  }

  .player-pill:hover {
    border-color: var(--border-strong);
  }

  .player-pill.compact {
    padding: 0.4rem 0.55rem;
  }

  .slot-badge {
    min-width: 40px;
  }

  .player-headshot {
    width: 38px;
    height: 38px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--bg-base);
    flex-shrink: 0;
  }

  .player-headshot.small {
    width: 30px;
    height: 30px;
  }

  .player-info {
    flex: 1;
    min-width: 0;
  }

  .player-name {
    font-weight: 700;
    font-size: 0.88rem;
    color: var(--text-primary);
    line-height: 1.15;
    word-break: break-word;
  }

  .player-name.empty {
    color: var(--text-tertiary);
    font-style: italic;
    font-weight: 500;
  }

  .player-team {
    color: var(--text-tertiary);
    font-size: 0.72rem;
    margin-top: 0.15rem;
  }

  .pos-tags {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .empty-row {
    color: var(--text-tertiary);
    font-style: italic;
    padding: 0.6rem 0;
    font-size: 0.9rem;
  }

  .empty-card {
    padding: 2rem;
    text-align: center;
    background: var(--surface-1);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-sm);
    color: var(--text-secondary);
  }

  @media (max-width: 720px) {
    .teams-grid { grid-template-columns: 1fr; }
    .player-pill { flex-wrap: wrap; }
    .pos-tags { width: 100%; margin-top: 0.3rem; }
  }
</style>
