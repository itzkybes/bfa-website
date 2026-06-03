<!-- src/routes/rosters/+page.svelte — Team rosters grid (client-side fetched) -->
<script>
  import { onMount } from 'svelte';
  import { getSeasonsChain, getRosterMapWithOwners, getPlayersNba, playerHeadshot, safeNum, BASE_LEAGUE_ID, pickActiveLeague } from '$lib/sleeperClient.client';
  import { computeStandingsForLeague } from '$lib/leagueCompute.client';
  import { expandPositions } from '$lib/positions';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';

  let loading = true;
  let error = null;
  let leagueName = null;
  let season = null;
  let rosters = [];   // [{ rosterId, owner_name, team_name, team_avatar, _starters, _bench, _taxi, owner_hub }]
  // Global accordion: at most one roster is open at a time.
  let expandedRosterId = null;

  const STARTER_SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL'];

  function _ro(r) { return r && r.raw ? r.raw : (r?.roster_raw || r || {}); }

  function getTaxi(rawRoster) {
    const x = rawRoster || {};
    return x?.taxi || x?.taxi_squad || x?.taxi_players || x?.taxiSquad || x?.taxi_roster || x?.taxi_list || [];
  }

  function getStarters(rawRoster) {
    const x = rawRoster || {};
    if (Array.isArray(x.starters) && x.starters.length) return x.starters;
    if (Array.isArray(x.starting_lineup) && x.starting_lineup.length) return x.starting_lineup;
    const players = x.players || [];
    return Array.isArray(players) ? players.slice(0, 9) : [];
  }

  function getBench(rawRoster) {
    const all = (rawRoster.players || []).slice();
    const exclude = new Set([
      ...(getStarters(rawRoster) || []).map(String),
      ...(getTaxi(rawRoster) || []).map(String)
    ]);
    return all.filter((p) => p && !exclude.has(String(p)));
  }

  function getPlayerInfo(id, players) {
    if (!id) return { name: 'Empty', team: '', positions: [], player_id: null };
    const p = players[id] || players[String(id)] || null;
    if (!p) return { name: id, team: '', positions: [], player_id: id };
    const fullName = p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.display_name || id;
    // Sleeper only stores 1–2 basic positions per player — expand to every
    // roster slot the player is eligible for (e.g. SG → SG, G, UTIL) so
    // managers can see every legal lineup spot at a glance.
    const basic = Array.isArray(p.fantasy_positions) ? p.fantasy_positions : (p.position ? [p.position] : []);
    const positions = expandPositions(basic);
    return { name: fullName, team: p.team || p.team_abbreviation || 'FA', positions, player_id: p.player_id || id };
  }

  /**
   * Roll up every season's standings into a per-owner career snapshot:
   * championships, playoff appearances, career W-L, career PF/PA, best
   * finish, and best single-season PF. Keyed by `owner_username` (the
   * stable handle across re-themed teams). Returns `{}` if standings can
   * not be computed (e.g. league chain failed).
   */
  function buildOwnerHubs(allSeasonResults, chain) {
    const hubs = {};   // owner_username (lower) → hub object
    const ownerSeasonsHandled = {}; // username → Set(season) to avoid double-counting
    function ensure(uname) {
      const k = String(uname || '').toLowerCase();
      if (!k) return null;
      if (!hubs[k]) {
        hubs[k] = {
          owner_username: uname,
          championships: 0,
          playoffAppearances: 0,
          finalsAppearances: 0,
          seasonsPlayed: 0,
          careerWins: 0,
          careerLosses: 0,
          careerPF: 0,
          careerPA: 0,
          bestFinish: null,         // smallest rank (1 = champ)
          bestFinishSeason: null,
          bestSeasonPF: 0,
          bestSeasonPFSeason: null,
          firstSeason: null,
          lastSeason: null
        };
        ownerSeasonsHandled[k] = new Set();
      }
      return hubs[k];
    }

    for (let i = 0; i < allSeasonResults.length; i++) {
      const s = chain[i];
      const r = allSeasonResults[i];
      if (!r || !r.regularStandings) continue;
      const seasonLabel = s?.season ?? r.leagueSeason ?? s?.league_id;
      const rmap = r.rosterMap || {};

      // Regular-season aggregates (wins/losses/PF/PA per owner)
      for (const reg of r.regularStandings) {
        const meta = rmap[reg.rosterId] || {};
        const hub = ensure(meta.owner_username || meta.owner_name);
        if (!hub) continue;
        const k = hub.owner_username.toLowerCase();
        if (!ownerSeasonsHandled[k].has(seasonLabel)) {
          ownerSeasonsHandled[k].add(seasonLabel);
          hub.seasonsPlayed += 1;
        }
        hub.careerWins += Number(reg.wins ?? 0);
        hub.careerLosses += Number(reg.losses ?? 0);
        hub.careerPF += Number(reg.pf ?? 0);
        hub.careerPA += Number(reg.pa ?? 0);
        if (Number(reg.pf ?? 0) > hub.bestSeasonPF) {
          hub.bestSeasonPF = Number(reg.pf ?? 0);
          hub.bestSeasonPFSeason = seasonLabel;
        }
        if (hub.firstSeason == null || Number(seasonLabel) < Number(hub.firstSeason)) hub.firstSeason = seasonLabel;
        if (hub.lastSeason == null || Number(seasonLabel) > Number(hub.lastSeason)) hub.lastSeason = seasonLabel;
      }

      // Final standings — championships, playoff appearances, best finish.
      // Only count if the bracket actually completed; in-progress seasons
      // (pre_draft / in_season) would otherwise pollute the "best finish".
      if (Array.isArray(r.finalStandings) && r.bracketComplete) {
        for (const fs of r.finalStandings) {
          const meta = rmap[fs.rosterId] || {};
          const hub = ensure(meta.owner_username || meta.owner_name);
          if (!hub) continue;
          if (fs.isChampion) hub.championships += 1;
          if (fs.isPlayoff) hub.playoffAppearances += 1;
          if (fs.rank === 1 || fs.rank === 2) hub.finalsAppearances += 1;
          if (hub.bestFinish == null || fs.rank < hub.bestFinish) {
            hub.bestFinish = fs.rank;
            hub.bestFinishSeason = seasonLabel;
          }
        }
      }
    }

    // Derive win pct for sort / display convenience
    for (const k of Object.keys(hubs)) {
      const h = hubs[k];
      const games = h.careerWins + h.careerLosses;
      h.winPct = games ? h.careerWins / games : 0;
    }
    return hubs;
  }

  function toggle(id) {
    // Accordion: clicking an already-open card closes it; clicking any other
    // card closes whatever was open and opens this one.
    expandedRosterId = expandedRosterId === id ? null : id;
  }

  async function loadAll() {
    loading = true;
    error = null;
    try {
      // 1. fetch seasons chain to get current league
      const { seasons } = await getSeasonsChain(BASE_LEAGUE_ID);
      // Prefer the active league (in_season → complete → newest) so an
      // unconfigured pre-draft season doesn't render empty rosters.
      const active = pickActiveLeague(seasons);
      const current = active || (seasons.length ? seasons[seasons.length - 1] : { league_id: BASE_LEAGUE_ID, season: null, name: 'BFA' });
      season = current.season;
      leagueName = current.name;

      // 2. fetch roster map + players + ALL seasons' standings in parallel.
      // The all-seasons standings powers the per-team Owner Hub stats; each
      // call is cached internally so this is cheap on re-renders.
      const [rosterMap, playersMap, allSeasonResults] = await Promise.all([
        getRosterMapWithOwners(current.league_id),
        getPlayersNba(),
        Promise.all(seasons.map((s) => computeStandingsForLeague(s.league_id).catch(() => null)))
      ]);

      // Build per-owner career hubs from every season's standings.
      const ownerHubs = buildOwnerHubs(allSeasonResults, seasons);

      // 3. enrich
      const list = [];
      for (const rid of Object.keys(rosterMap)) {
        const meta = rosterMap[rid];
        const raw = meta.roster_raw || {};
        const startersRaw = getStarters(raw);
        const _starters = STARTER_SLOTS.map((slot, idx) => {
          const pid = startersRaw[idx] || null;
          return pid ? { slot, pid, player: getPlayerInfo(pid, playersMap) } : { slot, pid: null, player: null };
        });
        const benchIds = getBench(raw);
        const _bench = benchIds.map((pid) => ({ pid, player: getPlayerInfo(pid, playersMap) }));
        const taxiIds = getTaxi(raw);
        const _taxi = taxiIds.map((pid) => ({ pid, player: getPlayerInfo(pid, playersMap) }));

        // Attach the matching Owner Hub (career stats across every season)
        const ownerHubKey = String(meta.owner_username || meta.owner_name || '').toLowerCase();
        const owner_hub = ownerHubs[ownerHubKey] || null;

        list.push({
          rosterId: rid,
          owner_name: meta.owner_name,
          owner_username: meta.owner_username,
          team_name: meta.team_name,
          team_avatar: meta.team_avatar,
          owner_avatar: meta.owner_avatar,
          _starters,
          _bench,
          _taxi,
          owner_hub
        });
      }
      // sort by team name for stable layout
      list.sort((a, b) => String(a.team_name || '').localeCompare(String(b.team_name || '')));
      rosters = list;
    } catch (e) {
      console.error('[Rosters] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadAll();
  });
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="eyebrow">League Rosters{#if season} · {season}{/if}</div>
    <h1 class="page-title">Team Rosters</h1>
    <p class="page-sub">Click any team to expand its Owner Hub (career titles, win %, all-time PF) along with the current starting lineup, bench, and taxi squad.</p>
  </header>

  {#if loading}
    <SkeletonLoader variant="team" count={6} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="rosters" />
  {:else if rosters.length === 0}
    <div class="empty-card" data-testid="rosters-empty">No rosters available.</div>
  {:else}
    <div class="teams-grid" data-testid="rosters-grid">
      {#each rosters as roster, idx (roster.rosterId)}
        <article
          class="team-card rise"
          class:collapsed={expandedRosterId !== roster.rosterId}
          class:expanded={expandedRosterId === roster.rosterId}
          style="animation-delay: {idx * 30}ms;"
          data-testid={`team-card-${roster.rosterId}`}
        >
          <div class="team-head" on:click={(e) => { if (e.target.closest('a,button')) return; toggle(roster.rosterId); }} on:keydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a,button')) { e.preventDefault(); toggle(roster.rosterId); } }} role="button" tabindex="0" aria-expanded={expandedRosterId === roster.rosterId}>
            <img
              class="team-avatar"
              src={roster.team_avatar || roster.owner_avatar || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 56 56%22%3E%3C/svg%3E'}
              alt={roster.team_name}
              on:error={(e) => (e.currentTarget.style.visibility = 'hidden')}
            />
            <div class="team-info">
              {#if roster.owner_username}
                <a class="team-name" href={`/team/${encodeURIComponent(roster.owner_username)}`} title={`${roster.team_name} — see matchup history`} data-testid={`team-history-link-${roster.rosterId}`}>
                  {roster.team_name}
                  <span class="link-chevron" aria-hidden="true">→</span>
                </a>
              {:else}
                <div class="team-name" title={roster.team_name}>{roster.team_name}</div>
              {/if}
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
              aria-pressed={expandedRosterId === roster.rosterId}
              on:click={() => toggle(roster.rosterId)}
              data-testid={`team-collapse-${roster.rosterId}`}
            >
              {expandedRosterId === roster.rosterId ? '−' : '+'}
            </button>
          </div>

          {#if expandedRosterId === roster.rosterId}
            <section class="team-body">
              {#if roster.owner_hub}
                <div class="owner-hub" data-testid={`owner-hub-${roster.rosterId}`}>
                  <div class="owner-hub-head">
                    <div class="owner-hub-title">Owner Hub</div>
                    <div class="owner-hub-sub">
                      {roster.owner_hub.firstSeason ?? '—'} – {roster.owner_hub.lastSeason ?? '—'} ·
                      {roster.owner_hub.seasonsPlayed} {roster.owner_hub.seasonsPlayed === 1 ? 'season' : 'seasons'}
                    </div>
                  </div>
                  <div class="owner-hub-grid">
                    <div class="hub-stat" title="Total league championships won by this owner">
                      <div class="hub-stat-num">{roster.owner_hub.championships}</div>
                      <div class="hub-stat-label">🏆 Titles</div>
                    </div>
                    <div class="hub-stat" title="Number of seasons reaching the playoffs">
                      <div class="hub-stat-num">{roster.owner_hub.playoffAppearances}</div>
                      <div class="hub-stat-label">Playoff Apps</div>
                    </div>
                    <div class="hub-stat" title="Number of championship games reached (Finals appearances)">
                      <div class="hub-stat-num">{roster.owner_hub.finalsAppearances}</div>
                      <div class="hub-stat-label">Finals Apps</div>
                    </div>
                    <div class="hub-stat" title="Best final finish across every season">
                      <div class="hub-stat-num">{roster.owner_hub.bestFinish ?? '—'}{#if roster.owner_hub.bestFinishSeason}<span class="hub-stat-year"> ’{String(roster.owner_hub.bestFinishSeason).slice(-2)}</span>{/if}</div>
                      <div class="hub-stat-label">Best Finish</div>
                    </div>
                    <div class="hub-stat" title="All-time regular-season wins">
                      <div class="hub-stat-num">{roster.owner_hub.careerWins}</div>
                      <div class="hub-stat-label">Career Wins</div>
                    </div>
                    <div class="hub-stat" title="All-time regular-season losses">
                      <div class="hub-stat-num">{roster.owner_hub.careerLosses}</div>
                      <div class="hub-stat-label">Career Losses</div>
                    </div>
                    <div class="hub-stat" title="Career regular-season win percentage">
                      <div class="hub-stat-num">{(roster.owner_hub.winPct * 100).toFixed(1)}<span class="hub-stat-pct">%</span></div>
                      <div class="hub-stat-label">Win %</div>
                    </div>
                    <div class="hub-stat" title="All-time regular-season points scored">
                      <div class="hub-stat-num">{Math.round(roster.owner_hub.careerPF).toLocaleString()}</div>
                      <div class="hub-stat-label">Career PF</div>
                    </div>
                    <div class="hub-stat" title="All-time regular-season points allowed">
                      <div class="hub-stat-num">{Math.round(roster.owner_hub.careerPA).toLocaleString()}</div>
                      <div class="hub-stat-label">Career PA</div>
                    </div>
                    <div class="hub-stat" title="Highest single-season PF and the year it happened">
                      <div class="hub-stat-num">{Math.round(roster.owner_hub.bestSeasonPF).toLocaleString()}{#if roster.owner_hub.bestSeasonPFSeason}<span class="hub-stat-year"> ’{String(roster.owner_hub.bestSeasonPFSeason).slice(-2)}</span>{/if}</div>
                      <div class="hub-stat-label">Best Season PF</div>
                    </div>
                  </div>
                  {#if roster.owner_username}
                    <a class="hub-history-link" href={`/team/${encodeURIComponent(roster.owner_username)}`} data-testid={`owner-hub-history-${roster.rosterId}`}>
                      View matchup history →
                    </a>
                  {/if}
                </div>
              {/if}

              <div class="roster-cols">
                <div class="roster-col">
                  <div class="section-label">Starters</div>
                  <div class="starters">
                {#each roster._starters as st, i (i)}
                  <div class="player-pill" title={st.player?.name}>
                    <span class="slot-badge pos-pill {st.slot}">{st.slot}</span>
                    {#if st.pid}
                      <img class="player-headshot" src={playerHeadshot(st.player?.player_id)} alt={st.player?.name} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
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
                </div>

                <div class="roster-col">
                  <div class="section-label">Bench</div>
                  {#if roster._bench.length}
                    <div class="bench-grid">
                      {#each roster._bench as b (b.pid)}
                        <div class="player-pill compact" title={b.player?.name}>
                          <span class="slot-badge pos-pill BN">BN</span>
                          <img class="player-headshot small" src={playerHeadshot(b.player?.player_id)} alt={b.player?.name} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
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
                          <img class="player-headshot small" src={playerHeadshot(t.player?.player_id)} alt={t.player?.name} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
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
                </div>
              </div>
            </section>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Owner Hub block — career-stats summary that sits above the Starters
     list when a team-card is expanded on /rosters. Grid auto-fits the
     10 stat tiles into multiple rows on narrow viewports. */
  .owner-hub {
    margin-bottom: 1.25rem;
    padding: 0.95rem 1rem 1.1rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
  }
  .owner-hub-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.65rem; flex-wrap: wrap; }
  .owner-hub-title { font-family: var(--font-display); font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); }
  .owner-hub-sub { font-size: 0.7rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600; }
  .owner-hub-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 0.45rem;
  }
  .hub-stat {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 0.5rem 0.6rem;
    display: flex; flex-direction: column; gap: 0.15rem;
    min-width: 0;
  }
  .hub-stat-num {
    font-family: var(--font-display);
    font-size: 1.25rem;
    color: var(--text-primary);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .hub-stat-year { font-size: 0.65rem; color: var(--text-tertiary); margin-left: 0.2rem; }
  .hub-stat-pct { font-size: 0.7rem; color: var(--text-tertiary); margin-left: 0.1rem; }
  .hub-stat-label {
    font-family: var(--font-body);
    font-size: 0.62rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 700;
  }
  .hub-history-link {
    display: inline-block;
    margin-top: 0.75rem;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--brand);
    text-decoration: none;
    border-bottom: 1px dashed var(--border-strong);
    padding-bottom: 0.1rem;
  }
  .hub-history-link:hover { color: var(--accent); }
  @media (max-width: 720px) {
    .owner-hub-grid { grid-template-columns: repeat(2, 1fr); }
    .hub-stat-num { font-size: 1.1rem; }
  }

  /* Two-column expanded body: Starters left, Bench+Taxi right. */
  .roster-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
  }
  .roster-col { min-width: 0; }
  @media (max-width: 980px) {
    .roster-cols { grid-template-columns: 1fr; }
  }

  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .page-title {
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 6vw, 4rem);
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin: 0.4rem 0 0.5rem;
  }
  .page-sub { color: var(--text-secondary); font-size: 1rem; max-width: 60ch; }

  /* Responsive auto-fill grid: collapsed team cards sit in a compact 4-up
     (down to 2-up / 1-up on smaller screens). When a card is `.expanded`
     it breaks out and spans the full row so its owner-hub + starters +
     bench + taxi get a generous full-width canvas, while every OTHER
     team-card stays put — no blank columns. */
  .teams-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.85rem;
    align-items: start;
  }

  .team-card {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    overflow: hidden;
    transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
    display: flex;
    flex-direction: column;
  }
  .team-card:hover { border-color: var(--border-strong); }
  .team-card.collapsed { cursor: pointer; }
  .team-card.collapsed:hover { transform: translateY(-1px); }

  /* Expanded card breaks the grid and gets a glow + accent rail. */
  .team-card.expanded {
    grid-column: 1 / -1;
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent) inset, 0 10px 32px rgba(0, 0, 0, 0.35);
  }

  .team-head {
    display: flex;
    gap: 0.85rem;
    align-items: center;
    padding: 1rem;
    background: linear-gradient(180deg, var(--surface-2), var(--surface-1));
    border-bottom: 1px solid var(--border-subtle);
  }
  .team-card.collapsed .team-head { border-bottom: none; }

  .team-avatar {
    width: 56px; height: 56px;
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
    display: block;
    text-decoration: none;
  }
  a.team-name { display: inline-flex; align-items: center; gap: 0.4rem; }
  a.team-name:hover { color: var(--accent); }
  .link-chevron {
    font-size: 0.85rem;
    color: var(--text-tertiary);
    transition: transform var(--t-fast), color var(--t-fast);
  }
  a.team-name:hover .link-chevron { color: var(--accent); transform: translateX(2px); }
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
    display: flex; gap: 0.35rem; margin-top: 0.4rem; flex-wrap: wrap;
  }
  .stat-pill {
    font-size: 0.7rem; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.1em;
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
    width: 36px; height: 36px;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    border-radius: var(--r-sm);
    font-size: 1.4rem; line-height: 1;
    cursor: pointer;
    transition: border-color var(--t-fast), background var(--t-fast);
    flex-shrink: 0;
  }
  .collapse-btn:hover { border-color: var(--accent); color: var(--accent); }

  .team-body { padding: 0.5rem 1rem 1rem; }
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

  .starters { display: flex; flex-direction: column; gap: 0.4rem; }
  /* Inside a roster-col (half-width), bench/taxi stay single-column so
     player names + pos tags never wrap awkwardly. */
  .bench-grid {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .player-pill {
    display: flex; align-items: center; gap: 0.55rem;
    padding: 0.45rem 0.6rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    transition: border-color var(--t-fast);
  }
  .player-pill:hover { border-color: var(--border-strong); }
  .player-pill.compact { padding: 0.4rem 0.55rem; }

  .slot-badge { min-width: 40px; }

  .player-headshot {
    width: 38px; height: 38px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--bg-base);
    flex-shrink: 0;
  }
  .player-headshot.small { width: 30px; height: 30px; }

  .player-info { flex: 1; min-width: 0; }
  .player-name {
    font-weight: 700; font-size: 0.88rem;
    color: var(--text-primary);
    line-height: 1.15;
    word-break: break-word;
  }
  .player-name.empty { color: var(--text-tertiary); font-style: italic; font-weight: 500; }
  .player-team { color: var(--text-tertiary); font-size: 0.72rem; margin-top: 0.15rem; }

  .pos-tags {
    display: flex; gap: 0.25rem; flex-shrink: 0; flex-wrap: wrap;
  }

  .empty-row { color: var(--text-tertiary); font-style: italic; padding: 0.6rem 0; font-size: 0.9rem; }
  .empty-card {
    padding: 2rem; text-align: center;
    background: var(--surface-1);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-sm);
    color: var(--text-secondary);
  }

  @media (max-width: 720px) {
    .page { padding: 1.75rem 0 3rem; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .teams-grid { column-count: 1; }
    .team-head { padding: 0.85rem; gap: 0.65rem; }
    .team-avatar { width: 48px; height: 48px; }
    .team-name { font-size: 1.1rem; }
    .team-stats { gap: 0.3rem; }
    .stat-pill { font-size: 0.65rem; padding: 0.15rem 0.4rem; }
    .bench-grid { gap: 0.4rem; }
    .player-pill { flex-wrap: wrap; padding: 0.4rem 0.5rem; }
    .pos-tags { width: 100%; margin-top: 0.3rem; justify-content: flex-end; }
    .player-name { font-size: 0.82rem; }
    .player-team { font-size: 0.68rem; }
    .player-headshot { width: 32px; height: 32px; }
    .player-headshot.small { width: 28px; height: 28px; }
    .collapse-btn { width: 32px; height: 32px; font-size: 1.2rem; }
  }
</style>
