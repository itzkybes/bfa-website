<!--
  src/routes/admin/player-id-lookup/+page.svelte

  Tooling page: search the full Sleeper NBA player map and grab a player's
  Sleeper player_id. The player_id is what `/static/season_matchups/*.json`
  uses in the `starters` arrays — handy when you need to manually patch
  per-player scoring for a historical week.
-->
<script>
  import { onMount } from 'svelte';
  import { getPlayersNba, playerHeadshot } from '$lib/api';
  import SkeletonLoader from '$lib/components/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';

  let loading = true;
  let error = null;
  let allPlayers = [];      // [{ pid, name, team, pos, status, search }]
  let query = '';
  let copiedPid = null;

  // Cache flattened player array so re-typing doesn't redo the work.
  // Search index folds diacritics so "doncic" matches "Dončić".
  function fold(s) {
    return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  async function loadData() {
    loading = true; error = null;
    try {
      const map = await getPlayersNba();
      const flat = [];
      for (const pid of Object.keys(map)) {
        const p = map[pid] || {};
        const name = p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || pid;
        flat.push({
          pid,
          name,
          team: p.team || '',
          pos: (p.fantasy_positions && p.fantasy_positions[0]) || p.position || '',
          status: p.status || '',
          search: fold(`${name} ${p.team || ''} ${pid}`)
        });
      }
      // Players with a team first, then alphabetical.
      flat.sort((a, b) => {
        if (!!a.team !== !!b.team) return a.team ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      allPlayers = flat;
    } catch (err) {
      error = err;
      console.error('[PlayerLookup] load error:', err);
    } finally {
      loading = false;
    }
  }

  // Reactive filter — keep result list short or cap when query is empty.
  $: results = (() => {
    if (!query.trim()) return allPlayers.slice(0, 50);
    const q = fold(query.trim());
    const out = [];
    for (const p of allPlayers) {
      if (p.search.includes(q)) {
        out.push(p);
        if (out.length >= 200) break;
      }
    }
    return out;
  })();

  async function copy(pid) {
    try {
      await navigator.clipboard.writeText(String(pid));
      copiedPid = pid;
      setTimeout(() => { if (copiedPid === pid) copiedPid = null; }, 1500);
    } catch (e) {
      console.warn('clipboard write failed', e);
      window.prompt('Copy this id:', String(pid));
    }
  }

  onMount(loadData);
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="eyebrow">Admin · Tooling</div>
    <h1 class="page-title">Player ID Lookup</h1>
    <p class="page-sub">Find a Sleeper <code>player_id</code> by name. These ids show up in the <code>starters</code> arrays of <code>/static/season_matchups/*.json</code> — useful when manually patching per-player scoring.</p>
  </header>

  {#if loading}
    <SkeletonLoader variant="text" count={6} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadData} context="player lookup" />
  {:else}
    <section class="block">
      <div class="search-row">
        <input
          type="search"
          class="search-input"
          placeholder="Type a player name (e.g. luka, jokic, gilgeous)…"
          bind:value={query}
          data-testid="player-search-input"
          autofocus
        />
        <div class="search-meta">{results.length} {results.length === 1 ? 'match' : 'matches'}{query.trim() ? '' : ' · top 50'}</div>
      </div>
    </section>

    {#if !results.length}
      <div class="empty-card" data-testid="player-empty">No players match "{query}".</div>
    {:else}
      <div class="results" data-testid="player-results">
        {#each results as p (p.pid)}
          <article class="player-card" data-testid={`player-card-${p.pid}`}>
            <img
              class="player-headshot"
              src={playerHeadshot(p.pid)}
              alt={p.name}
              loading="lazy"
              on:error={(e) => (e.currentTarget.style.opacity = '0.15')}
            />
            <div class="player-info">
              <div class="player-name">{p.name}</div>
              <div class="player-meta">
                {#if p.pos}<span class="pill pos">{p.pos}</span>{/if}
                {#if p.team}<span class="team">{p.team}</span>{/if}
                {#if p.status && p.status !== 'Active'}<span class="status">{p.status}</span>{/if}
              </div>
            </div>
            <button
              type="button"
              class="copy-btn"
              class:copied={copiedPid === p.pid}
              on:click={() => copy(p.pid)}
              data-testid={`copy-pid-${p.pid}`}
              title="Copy player_id to clipboard"
            >
              <span class="pid">{p.pid}</span>
              <span class="copy-icon" aria-hidden="true">{copiedPid === p.pid ? '✓' : '⧉'}</span>
            </button>
          </article>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }

  .page-head { margin-bottom: 2rem; }

  .page-title {
    font-family: var(--font-display);
    font-size: clamp(2.5rem, 5vw, 4rem);
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin: 0.25rem 0 0.75rem;
  }

  .page-sub {
    color: var(--text-secondary);
    font-size: 1rem;
    max-width: 70ch;
    line-height: 1.6;
  }

  .page-sub :global(code) {
    background: var(--surface-2);
    color: var(--accent);
    padding: 0.1rem 0.35rem;
    border-radius: var(--r-sm);
    font-size: 0.85em;
  }

  .block {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    margin-bottom: 1.25rem;
    padding: 1.25rem;
  }

  .search-row {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .search-input {
    flex: 1;
    min-width: 220px;
    padding: 0.85rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    font-size: 1rem;
    font-family: var(--font-body);
    transition: border-color var(--t-fast);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .search-input::placeholder { color: var(--text-tertiary); }

  .search-meta {
    color: var(--text-tertiary);
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }

  .empty-card {
    padding: 2rem;
    text-align: center;
    background: var(--surface-1);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-sm);
    color: var(--text-secondary);
  }

  .results {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 0.6rem;
  }

  .player-card {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.7rem 0.85rem;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    transition: border-color var(--t-fast), transform var(--t-fast);
  }

  .player-card:hover {
    border-color: var(--border-strong);
    transform: translateY(-1px);
  }

  .player-headshot {
    width: 44px;
    height: 44px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    flex-shrink: 0;
    border: 1px solid var(--border-subtle);
  }

  .player-info {
    flex: 1;
    min-width: 0;
    line-height: 1.2;
  }

  .player-name {
    font-weight: 700;
    color: var(--text-primary);
    font-size: 0.95rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .player-meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.25rem;
    font-size: 0.78rem;
    color: var(--text-tertiary);
    font-weight: 500;
  }

  .pill.pos {
    background: var(--accent);
    color: #fff;
    padding: 0.05rem 0.35rem;
    border-radius: var(--r-sm);
    font-weight: 800;
    font-size: 0.65rem;
    letter-spacing: 0.06em;
  }

  .team { font-weight: 700; }
  .status { color: #fca5a5; font-style: italic; }

  .copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.7rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--t-fast);
    flex-shrink: 0;
  }

  .copy-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .copy-btn.copied {
    border-color: var(--win, #5eead4);
    color: var(--win, #5eead4);
    background: rgba(94, 234, 212, 0.1);
  }

  .pid {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .copy-icon { font-size: 0.95rem; }

  @media (max-width: 640px) {
    .results { grid-template-columns: 1fr; }
  }
</style>
