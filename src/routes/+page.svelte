<!-- src/routes/+page.svelte — Home: hero + Rando Player spotlight + Recent Transactions -->
<script>
  import { onMount } from 'svelte';
  import {
    fetchWithCache,
    getSeasonsChain, BASE_LEAGUE_ID,
    pickActiveLeague, getRecentTransactions,
    getPlayersNba, getRosterMapWithOwners, playerHeadshot
  } from '$lib/api';
  import SkeletonLoader from '$lib/components/SkeletonLoader.svelte';
  import SectionHeader from '$lib/components/SectionHeader.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  // URL override > env override > resolved-at-runtime "live" league
  // (resolved inside loadData via pickActiveLeague). Falls back to BASE_LEAGUE_ID.
  const leagueOverride = (urlParams && urlParams.get('league')) || import.meta.env.VITE_LEAGUE_ID || null;
  let leagueId = leagueOverride || BASE_LEAGUE_ID;
  let seasonLabel = '';
  let recentTransactions = [];
  let transactionsLoading = true;
  let activityFilter = 'all';
  const ALL_ACTIVITY_LIMIT = 18;
  let playersMap = {};
  let rosterMap = {};
  let rawRecentTransactions = [];
  $: visibleTransactions = activityFilter === 'all'
    ? recentTransactions.slice(0, ALL_ACTIVITY_LIMIT)
    : recentTransactions.filter((transaction) => transaction.type === activityFilter);

  const CACHE_10_MIN = 10 * 60 * 1000;

  let loading = true;
  let error = null;
  let rosters = [];
  let users = [];
  let potw = null;

  function findUserByOwner(ownerId) {
    if (!users || !ownerId) return null;
    return users.find((u) => String(u.user_id) === String(ownerId)) || null;
  }

  function displayNameForRoster(roster) {
    if (!roster) return 'Roster';
    const md = roster.metadata || {};
    const settings = roster.settings || {};
    const candidates = [
      md.team_name, md.teamName, md.team, md.name,
      settings.team_name, settings.teamName, settings.team, settings.name
    ];
    for (const c of candidates) if (c && String(c).trim()) return String(c).trim();
    const u = findUserByOwner(roster.owner_id);
    if (u) {
      if (u.metadata && u.metadata.team_name) return u.metadata.team_name;
      if (u.display_name) return u.display_name;
      if (u.username) return u.username;
    }
    return 'Roster ' + roster.roster_id;
  }

  function ownerNameForRoster(roster) {
    if (!roster) return null;
    const u = findUserByOwner(roster.owner_id);
    if (!u) return null;
    return u.display_name || u.username || (u.metadata && u.metadata.team_name) || null;
  }

  function getHeadshot(playerId) {
    return playerHeadshot(playerId);
  }

  function prettyNameFromId(id) {
    if (!id) return '';
    let s = String(id).replace(/[_-]+/g, ' ').replace(/\d+/g, '').trim();
    if (!s) return id;
    return s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  function getPlayerName(info, id) {
    if (!info) return prettyNameFromId(id);
    if (info.full_name) return info.full_name;
    if (info.first_name || info.last_name) return `${info.first_name ?? ''} ${info.last_name ?? ''}`.trim();
    return prettyNameFromId(id);
  }

  function chooseRandom(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  async function pickRandoPlayer() {
    potw = null;
    try {
      const candidates = (rosters || []).filter((r) => Array.isArray(r.players) && r.players.length > 0);
      if (!candidates.length) return;
      const r = chooseRandom(candidates);
      const pid = chooseRandom(r.players);
      if (!pid) return;
      const playerInfo = playersMap[pid] || {
        player_id: pid,
        full_name: prettyNameFromId(pid) || ('Player ' + pid),
        team: '',
        position: ''
      };
      potw = {
        playerId: pid,
        playerInfo,
        roster: r,
        rosterName: displayNameForRoster(r),
        ownerName: ownerNameForRoster(r)
      };
    } catch (e) {
      console.warn('rando player error', e);
    }
  }

  async function loadData() {
    loading = true;
    error = null;
    try {
      // Resolve which league_id is "live" — newest in_season league preferred,
      // else newest complete league, else newest overall.
      if (!leagueOverride) {
        try {
          const { seasons } = await getSeasonsChain(BASE_LEAGUE_ID);
          const active = pickActiveLeague(seasons);
          if (active?.league_id) leagueId = String(active.league_id);
          if (active?.season) seasonLabel = String(active.season);
        } catch (_) { /* keep fallback leagueId */ }
      }

      const [_rosters, _users] = await Promise.all([
        fetchWithCache(`https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/rosters`, {}, CACHE_10_MIN),
        fetchWithCache(`https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/users`, {}, CACHE_10_MIN)
      ]);
      rosters = _rosters;
      users = _users;
      await pickRandoPlayer();

      // Defer the large NBA player directory until after the hero can render.
      // It is shared with transaction enrichment and persisted by the cache.
      loadPlayersMap().catch((e) => console.warn('[Home] player directory failed', e));
      loadRecentTransactions().catch((e) => console.warn('[Home] transactions failed', e));
    } catch (err) {
      error = err;
      console.error('[Home] load error:', err);
    } finally {
      loading = false;
    }
  }

  async function loadPlayersMap() {
    const map = await getPlayersNba();
    playersMap = map || {};
    if (potw) {
      const playerInfo = playersMap[potw.playerId];
      if (playerInfo) potw = { ...potw, playerInfo };
    }
    if (rawRecentTransactions.length) {
      recentTransactions = rawRecentTransactions.map((transaction) =>
        enrichTransaction(transaction, rosterMap, playersMap)
      );
    }
  }

  async function loadRecentTransactions() {
    transactionsLoading = true;
    try {
      const [transactions, rmap] = await Promise.all([
        getRecentTransactions(leagueId, { weekFrom: 0, weekTo: 25, limit: 18 }),
        getRosterMapWithOwners(leagueId).catch(() => ({}))
      ]);
      rawRecentTransactions = transactions;
      rosterMap = rmap;
      recentTransactions = rawRecentTransactions.map((transaction) =>
        enrichTransaction(transaction, rosterMap, playersMap)
      );
    } finally {
      transactionsLoading = false;
    }
  }

  function enrichTransaction(transaction, rmap, pmap) {
    const rosterIds = new Set((transaction.roster_ids || []).map(String));
    const addRoster = (id) => { if (id != null) rosterIds.add(String(id)); };
    for (const id of Object.values(transaction.adds || {})) addRoster(id);
    for (const id of Object.values(transaction.drops || {})) addRoster(id);
    for (const pick of transaction.draft_picks || []) {
      addRoster(pick.owner_id);
      addRoster(pick.previous_owner_id);
    }
    for (const budget of transaction.waiver_budget || []) {
      addRoster(budget.receiver);
      addRoster(budget.sender);
    }

    const sides = {};
    for (const rosterId of rosterIds) {
      sides[rosterId] = {
        rosterId,
        meta: rmap[rosterId] || { team_name: 'Roster ' + rosterId, owner_name: null, team_avatar: null },
        adds: [], drops: [], picksIn: [], picksOut: [], cashIn: 0
      };
    }

    const playerSummary = (pid) => {
      const player = pmap[pid];
      return {
        pid,
        name: player?.full_name || ((player?.first_name || '') + ' ' + (player?.last_name || '')).trim() || 'Player ' + pid,
        team: player?.team || '',
        position: (player?.fantasy_positions && player.fantasy_positions[0]) || player?.position || ''
      };
    };
    for (const [pid, rosterId] of Object.entries(transaction.adds || {})) {
      if (sides[String(rosterId)]) sides[String(rosterId)].adds.push(playerSummary(pid));
    }
    for (const [pid, rosterId] of Object.entries(transaction.drops || {})) {
      if (sides[String(rosterId)]) sides[String(rosterId)].drops.push(playerSummary(pid));
    }
    for (const pick of transaction.draft_picks || []) {
      if (sides[String(pick.owner_id)]) sides[String(pick.owner_id)].picksIn.push({ season: pick.season, round: pick.round });
      if (sides[String(pick.previous_owner_id)]) sides[String(pick.previous_owner_id)].picksOut.push({ season: pick.season, round: pick.round });
    }
    for (const budget of transaction.waiver_budget || []) {
      if (sides[String(budget.receiver)]) sides[String(budget.receiver)].cashIn += Number(budget.amount) || 0;
    }

    const typeLabels = { trade: 'Trade', waiver: 'Waiver Claim', free_agent: 'Free Agent' };
    return {
      id: String(transaction.transaction_id || transaction.created || transaction._week + '-' + [...rosterIds].join('-')),
      type: transaction.type || 'transaction',
      typeLabel: typeLabels[transaction.type] || 'Transaction',
      week: transaction._week,
      timestamp: Number(transaction.status_updated || transaction.created) || 0,
      sides: [...rosterIds].map((rosterId) => sides[rosterId])
    };
  }

  function relativeTime(ms) {
    if (!ms) return '';
    const now = Date.now();
    const diff = Math.max(0, now - ms);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  onMount(loadData);
</script>

<section class="hero" data-testid="hero-section">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="hero-grid-overlay" aria-hidden="true"></div>

  <div class="wrap hero-inner">
    <div class="hero-copy rise">
      <div class="eyebrow">{seasonLabel ? `Season ${Number(seasonLabel) - 1} / ${String(seasonLabel).slice(-2)} · Live` : 'Live'}</div>
      <h1 class="hero-title">
        Welcome to the<br />
        <span class="title-accent">Badger Bowl</span>
      </h1>
      <p class="hero-sub">
        Track rosters, standings, matchups, and league records. Real-time data straight from Sleeper —
        no fluff, just the cold hard buckets.
      </p>
      <div class="hero-actions">
        <a class="btn primary" href="/rosters" data-testid="hero-cta-rosters">View Rosters →</a>
        <a class="btn" href="/standings" data-testid="hero-cta-standings">See Standings</a>
      </div>
    </div>

    <aside class="rando rise" aria-label="Rando Player spotlight" data-testid="rando-card">
      <div class="rando-label">
        <span class="rando-dot"></span>
        Rando Player
      </div>

      {#if potw}
        <div class="rando-body">
          {#if potw.playerInfo.player_id}
            <img
              class="rando-headshot"
              src={getHeadshot(potw.playerInfo.player_id)}
              alt={getPlayerName(potw.playerInfo, potw.playerId)}
              on:error={(e) => (e.currentTarget.style.opacity = '0')}
              loading="lazy"
              data-testid="rando-headshot"
            />
          {:else}
            <div class="rando-headshot placeholder">🏀</div>
          {/if}

          <div class="rando-info">
            <div class="rando-name" title={getPlayerName(potw.playerInfo, potw.playerId)} data-testid="rando-name">
              {getPlayerName(potw.playerInfo, potw.playerId)}
            </div>
            <div class="rando-meta">
              {#if potw.playerInfo.position}<span class="meta-tag">{potw.playerInfo.position}</span>{/if}
              {#if potw.playerInfo.team}<span class="meta-sep">·</span><span>{potw.playerInfo.team}</span>{/if}
            </div>
            <div class="rando-owner" title={potw.rosterName}>
              {potw.rosterName}
              {#if potw.ownerName}<span class="meta-sep">·</span><span>{potw.ownerName}</span>{/if}
            </div>
          </div>
        </div>

        <div class="rando-actions">
          <a class="btn sm" href={`/rosters?owner=${potw.roster.roster_id ?? ''}`} data-testid="rando-view-roster">Roster</a>
          <button class="btn sm primary" on:click={pickRandoPlayer} data-testid="rando-shuffle" aria-label="Shuffle">
            ⟲ Shuffle
          </button>
        </div>
      {:else if loading}
        <div class="rando-body">
          <div class="shimmer rando-headshot" style="opacity:0.5"></div>
          <div style="flex:1;">
            <div class="shimmer" style="height:18px; width:60%; margin-bottom:8px;"></div>
            <div class="shimmer" style="height:12px; width:40%;"></div>
          </div>
        </div>
      {:else if error}
        <ErrorBoundary {error} onRetry={loadData} context="home" />
      {:else}
        <div class="rando-empty">No player available.</div>
      {/if}
    </aside>
  </div>
</section>

<!-- Recent completed league activity across trades, waivers, and free-agent moves. -->
<section class="wrap activity-section" aria-labelledby="activity-h" data-testid="recent-transactions">
  <SectionHeader
    eyebrow="League Activity"
    title="Recent Transactions"
    description="The latest completed moves across the league."
    titleId="activity-h"
    meta={!transactionsLoading && visibleTransactions.length ? `${visibleTransactions.length} latest moves` : ''}
  />

  <div class="activity-filters" role="group" aria-label="Filter transactions">
    <button class:active={activityFilter === 'all'} aria-pressed={activityFilter === 'all'} on:click={() => (activityFilter = 'all')}>All Activity</button>
    <button class:active={activityFilter === 'trade'} aria-pressed={activityFilter === 'trade'} on:click={() => (activityFilter = 'trade')}>Trades</button>
    <button class:active={activityFilter === 'waiver'} aria-pressed={activityFilter === 'waiver'} on:click={() => (activityFilter = 'waiver')}>Waivers</button>
    <button class:active={activityFilter === 'free_agent'} aria-pressed={activityFilter === 'free_agent'} on:click={() => (activityFilter = 'free_agent')}>Free Agents</button>
  </div>

  {#if transactionsLoading}
    <SkeletonLoader variant="row" count={3} />
  {:else if !recentTransactions.length}
    <div class="empty-card" data-testid="transactions-empty">No completed transactions yet.</div>
  {:else if !visibleTransactions.length}
    <div class="empty-card">No activity in this category yet.</div>
  {:else}
    <div class="activity-list" data-testid="transactions-list">
      {#each visibleTransactions as transaction (transaction.id)}
        <article class="activity-card rise" data-testid={'transaction-' + transaction.id}>
          <header class="activity-card-head">
            <div class="activity-tags">
              <span class="activity-type" class:trade-type={transaction.type === 'trade'}>{transaction.typeLabel}</span>
              <span class="activity-week">Week {transaction.week}</span>
            </div>
            <time class="activity-when">{relativeTime(transaction.timestamp)}</time>
          </header>
          <div class="activity-sides" class:multi-side={transaction.sides.length > 1}>
            {#each transaction.sides as side, i (side.rosterId)}
              <div class="activity-side">
                <div class="activity-team">
                  <img
                    class="activity-avatar"
                    src={side.meta.team_avatar || side.meta.owner_avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent((side.meta.team_name || 'T')[0]) + '&background=1a1a1e&color=a1a1aa&size=48&format=svg')}
                    alt={side.meta.team_name}
                    on:error={(e) => (e.currentTarget.style.visibility = 'hidden')}
                    loading="lazy"
                  />
                  <div class="activity-team-meta">
                    {#if side.meta.owner_username}
                      <a class="activity-team-name" href={'/team/' + encodeURIComponent(side.meta.owner_username)}>{side.meta.team_name}</a>
                    {:else}
                      <div class="activity-team-name">{side.meta.team_name}</div>
                    {/if}
                    {#if side.meta.owner_name}<div class="activity-owner">{side.meta.owner_name}</div>{/if}
                  </div>
                </div>
                <div class="activity-details">
                  {#if side.adds.length || side.picksIn.length || side.cashIn > 0}
                    <div class="activity-detail-group">
                      <span class="detail-label positive">Added / Received</span>
                      {#each side.adds as player (player.pid)}
                        <div class="activity-player">
                          <img src={playerHeadshot(player.pid)} alt="" on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} loading="lazy" />
                          <span>{player.name}<small>{player.position}{player.team ? ' · ' + player.team : ''}</small></span>
                        </div>
                      {/each}
                      {#each side.picksIn as pick ('in-' + pick.season + '-' + pick.round)}
                        <div class="activity-asset">{pick.season} Round {pick.round} pick</div>
                      {/each}
                      {#if side.cashIn > 0}<div class="activity-asset">+{side.cashIn} FAAB</div>{/if}
                    </div>
                  {/if}
                  {#if side.drops.length || side.picksOut.length}
                    <div class="activity-detail-group">
                      <span class="detail-label negative">Dropped / Sent</span>
                      {#each side.drops as player (player.pid)}
                        <div class="activity-player">
                          <img src={playerHeadshot(player.pid)} alt="" on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} loading="lazy" />
                          <span>{player.name}<small>{player.position}{player.team ? ' · ' + player.team : ''}</small></span>
                        </div>
                      {/each}
                      {#each side.picksOut as pick ('out-' + pick.season + '-' + pick.round)}
                        <div class="activity-asset">{pick.season} Round {pick.round} pick</div>
                      {/each}
                    </div>
                  {/if}
                  {#if !side.adds.length && !side.drops.length && !side.picksIn.length && !side.picksOut.length && !side.cashIn}
                    <span class="activity-no-details">Transaction details unavailable.</span>
                  {/if}
                </div>
              </div>
              {#if i < transaction.sides.length - 1}<div class="activity-swap" aria-hidden="true">⇄</div>{/if}
            {/each}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>
<style>
  /* ----- HERO ----- */
  .hero {
    position: relative;
    overflow: hidden;
    border-bottom: 1px solid var(--border-subtle);
    padding-top: 4rem;
    padding-bottom: 4rem;
  }

  .hero-bg {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(800px 400px at 80% 30%, rgba(255, 69, 0, 0.18), transparent 70%),
      radial-gradient(600px 500px at 10% 90%, rgba(255, 69, 0, 0.08), transparent 70%);
    z-index: 0;
  }

  .hero-grid-overlay {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.5), transparent 80%);
    -webkit-mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.5), transparent 80%);
    z-index: 0;
  }

  .hero-inner {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 3rem;
    align-items: center;
  }

  .hero-copy { max-width: 640px; }

  .eyebrow {
    margin-bottom: 1.2rem;
  }

  .hero-title {
    font-family: var(--font-display);
    font-size: clamp(3rem, 7vw, 6rem);
    line-height: 0.9;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin-bottom: 1.25rem;
  }

  .title-accent {
    color: var(--brand);
    display: inline-block;
    position: relative;
  }

  .title-accent::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -8px;
    height: 4px;
    background: var(--accent);
  }

  .hero-sub {
    font-size: 1.05rem;
    color: var(--text-secondary);
    margin-bottom: 1.75rem;
    max-width: 52ch;
    line-height: 1.6;
  }

  .hero-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  /* ----- RANDO ----- */
  .rando {
    position: relative;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--accent);
    padding: 1.5rem;
    border-radius: var(--r-sm);
  }

  .rando-label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-body);
    font-weight: 800;
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.2em;
    color: var(--accent);
    margin-bottom: 1.25rem;
  }

  .rando-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .rando-body {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .rando-headshot {
    width: 100px;
    height: 100px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    flex-shrink: 0;
    border: 1px solid var(--border-subtle);
  }

  .rando-headshot.placeholder {
    display: grid;
    place-items: center;
    font-size: 2.5rem;
  }

  .rando-info { min-width: 0; flex: 1; }

  .rando-name {
    font-family: var(--font-display);
    font-size: 1.6rem;
    line-height: 1;
    letter-spacing: 0.03em;
    color: var(--text-primary);
    text-transform: uppercase;
    margin-bottom: 0.4rem;
    word-break: break-word;
  }

  .rando-meta {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-bottom: 0.4rem;
    font-weight: 500;
  }

  .meta-tag {
    display: inline-block;
    background: var(--accent);
    color: #fff;
    padding: 0.1rem 0.45rem;
    border-radius: var(--r-sm);
    font-weight: 800;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
  }

  .meta-sep { opacity: 0.5; }

  .rando-owner {
    font-size: 0.85rem;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rando-actions {
    margin-top: 1.25rem;
    display: flex;
    gap: 0.5rem;
  }

  .rando-empty {
    color: var(--text-secondary);
    padding: 2rem 0;
    text-align: center;
  }

  /* ----- SECTION HEAD + RECENT ACTIVITY ----- */
  .section-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
  }
  .section-title {
    font-family: var(--font-display);
    font-size: clamp(2rem, 4vw, 3rem);
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin-top: 0.35rem;
  }
  .section-description { color: var(--text-secondary); margin-top: 0.35rem; font-size: 0.92rem; }
  .empty-card {
    padding: 2rem;
    text-align: center;
    background: var(--surface-1);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-sm);
    color: var(--text-secondary);
  }
  .activity-section { padding-top: 3rem; padding-bottom: 3.5rem; }
  .activity-count { color: var(--text-tertiary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700; }
  .activity-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0 0 1.1rem; }
  .activity-filters button {
    border: 1px solid var(--border-subtle);
    background: var(--surface-1);
    color: var(--text-secondary);
    border-radius: 999px;
    padding: 0.48rem 0.85rem;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 750;
    cursor: pointer;
    transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
  }
  .activity-filters button:hover { border-color: var(--border-strong); color: var(--text-primary); }
  .activity-filters button.active { background: var(--accent-soft); border-color: var(--accent); color: var(--text-primary); }
  .activity-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.9rem; }
  .activity-card {
    min-width: 0;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 1rem 1.1rem;
    transition: border-color var(--t-fast), transform var(--t-fast);
  }
  .activity-card:hover { border-color: var(--border-strong); transform: translateY(-1px); }
  .activity-card-head { display: flex; align-items: center; justify-content: space-between; gap: 0.7rem; margin-bottom: 0.85rem; padding-bottom: 0.7rem; border-bottom: 1px solid var(--border-subtle); }
  .activity-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; }
  .activity-type { border-radius: 999px; background: var(--surface-2); color: var(--text-primary); padding: 0.28rem 0.58rem; font-size: 0.67rem; font-weight: 850; letter-spacing: 0.08em; text-transform: uppercase; }
  .activity-type.trade-type { background: var(--accent-soft); color: var(--accent); }
  .activity-week { color: var(--text-tertiary); font-size: 0.72rem; font-weight: 700; }
  .activity-when { color: var(--text-tertiary); font-size: 0.75rem; white-space: nowrap; }
  .activity-sides { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.75rem; }
  .activity-sides.multi-side { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: stretch; }
  .activity-side { min-width: 0; display: flex; flex-direction: column; gap: 0.65rem; }
  .activity-team { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
  .activity-avatar { width: 38px; height: 38px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); flex-shrink: 0; }
  .activity-team-meta { min-width: 0; }
  .activity-team-name { display: block; font-family: var(--font-display); font-size: 0.98rem; text-transform: uppercase; letter-spacing: 0.035em; color: var(--text-primary); text-decoration: none; line-height: 1.15; overflow-wrap: anywhere; }
  a.activity-team-name:hover { color: var(--accent); }
  .activity-owner { color: var(--text-tertiary); font-size: 0.7rem; margin-top: 0.15rem; }
  .activity-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
  .activity-detail-group { min-width: 0; background: var(--surface-2); border-radius: var(--r-sm); padding: 0.58rem 0.65rem; display: flex; flex-direction: column; gap: 0.4rem; }
  .detail-label { font-size: 0.61rem; font-weight: 850; letter-spacing: 0.12em; text-transform: uppercase; }
  .detail-label.positive { color: var(--success, #22c55e); }
  .detail-label.negative { color: var(--text-tertiary); }
  .activity-player { display: flex; align-items: center; gap: 0.45rem; min-width: 0; }
  .activity-player img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; background: var(--surface-1); flex-shrink: 0; }
  .activity-player span { min-width: 0; color: var(--text-primary); font-size: 0.76rem; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
  .activity-player small { display: block; color: var(--text-tertiary); font-size: 0.64rem; font-weight: 500; margin-top: 0.12rem; }
  .activity-asset { color: var(--text-secondary); font-size: 0.75rem; font-weight: 700; }
  .activity-no-details { color: var(--text-tertiary); font-size: 0.75rem; }
  .activity-swap { align-self: center; color: var(--accent); font-size: 1.25rem; padding: 0 0.1rem; }

  @media (max-width: 980px) {
    .hero-inner { grid-template-columns: 1fr; gap: 2rem; }
    .rando { max-width: 100%; }
    .activity-list { grid-template-columns: 1fr; }
  }

  @media (max-width: 720px) {
    .hero { padding: 2.5rem 0 3rem; }
    .activity-card { padding: 0.85rem; }
    .activity-sides.multi-side { grid-template-columns: 1fr; }
    .activity-swap { transform: rotate(90deg); justify-self: center; }
    .activity-details { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    /* Buttons stack full-width on phones so they never overflow the viewport */
    .hero-actions { flex-direction: column; align-items: stretch; gap: 0.6rem; }
    .hero-actions :global(.btn) { width: 100%; }
    .hero-sub { font-size: 0.95rem; }
    .section-head { flex-direction: column; align-items: flex-start; gap: 0.75rem; }
    .activity-filters { gap: 0.4rem; }
    .activity-filters button { padding: 0.42rem 0.68rem; font-size: 0.72rem; }
    .activity-details { grid-template-columns: 1fr; }
    .rando { padding: 1.1rem; }
    .rando-headshot { width: 80px; height: 80px; }
    .rando-name { font-size: 1.35rem; }
  }

  @media (max-width: 480px) {
    .hero-title { font-size: clamp(2.2rem, 10vw, 3rem); }
    .hero-sub { font-size: 0.9rem; }
  }
</style>
