<!-- src/routes/matchups/+page.svelte (client-side fetched) -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getSeasonsChain, BASE_LEAGUE_ID, pickActiveLeague } from '$lib/sleeperClient.client';
  import { computeMatchupsForLeagueWeek } from '$lib/leagueCompute.client';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';

  let loading = true;
  let error = null;
  let seasons = [];
  let selectedSeason = null;     // season number or league_id string
  let selectedLeagueId = null;
  let selectedWeek = 1;
  let playoffStart = 15;
  let playoffEnd = 17;
  let matchupsRows = [];
  let weekOptions = { regular: [], playoffs: [] };

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? name[0].toUpperCase() : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }
  function fmt2(n) { return Number(n ?? 0).toFixed(2); }

  async function loadSeasons() {
    const { seasons: chain } = await getSeasonsChain(BASE_LEAGUE_ID);
    seasons = chain;
    const urlSeason = $page.url.searchParams.get('season');
    const urlWeek = $page.url.searchParams.get('week');
    if (urlSeason) {
      const found = chain.find(s => String(s.season) === String(urlSeason) || String(s.league_id) === String(urlSeason));
      if (found) {
        selectedSeason = found.season ?? found.league_id;
        selectedLeagueId = found.league_id;
      }
    }
    if (!selectedSeason && chain.length) {
      // Default to the active league (in_season → complete → newest) so the
      // dropdown doesn't open on a not-yet-drafted future season with no data.
      const active = pickActiveLeague(chain);
      const latest = active || chain[chain.length - 1];
      selectedSeason = latest.season ?? latest.league_id;
      selectedLeagueId = latest.league_id;
    }
    selectedWeek = urlWeek ? Number(urlWeek) : 1;
  }

  async function loadMatchups() {
    if (!selectedLeagueId) return;
    loading = true;
    error = null;
    try {
      const out = await computeMatchupsForLeagueWeek(selectedLeagueId, selectedWeek);
      matchupsRows = out.matchupsRows || [];
      playoffStart = out.playoffStart;
      playoffEnd = out.playoffEnd;
      weekOptions = {
        regular: Array.from({ length: Math.max(0, playoffStart - 1) }, (_, i) => i + 1),
        playoffs: Array.from({ length: 3 }, (_, i) => playoffStart + i)
      };
    } catch (e) {
      console.error('[Matchups] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  function onSeasonChange(e) {
    const val = e.target.value;
    const found = seasons.find(s => String(s.season) === val || String(s.league_id) === val);
    if (!found) return;
    selectedSeason = found.season ?? found.league_id;
    selectedLeagueId = found.league_id;
    goto(`?season=${encodeURIComponent(val)}&week=${selectedWeek}`, { replaceState: true });
    loadMatchups();
  }

  function onWeekChange(e) {
    selectedWeek = Number(e.target.value);
    goto(`?season=${encodeURIComponent(selectedSeason)}&week=${selectedWeek}`, { replaceState: true });
    loadMatchups();
  }

  onMount(async () => {
    await loadSeasons();
    await loadMatchups();
  });
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="head-row">
      <div>
        <div class="eyebrow">League · Week-by-Week</div>
        <h1 class="page-title">Matchups</h1>
        <p class="page-sub">Head-to-head results week by week with full starter scoring.</p>
      </div>

      <div class="filters">
        <label for="season" class="visually-hidden">Season</label>
        <select id="season" on:change={onSeasonChange} value={selectedSeason} data-testid="matchups-season-select">
          {#each seasons as s}
            <option value={s.season ?? s.league_id}>{s.season ?? s.name}</option>
          {/each}
        </select>

        <label for="week" class="visually-hidden">Week</label>
        <select id="week" on:change={onWeekChange} value={selectedWeek} data-testid="matchups-week-select">
          {#if weekOptions.regular?.length}
            <optgroup label="Regular Season">
              {#each weekOptions.regular as w}
                <option value={w}>Week {w}</option>
              {/each}
            </optgroup>
          {/if}
          {#if weekOptions.playoffs?.length}
            <optgroup label="Playoffs">
              {#each weekOptions.playoffs as w}
                <option value={w}>Week {w}</option>
              {/each}
            </optgroup>
          {/if}
        </select>
      </div>
    </div>
  </header>

  {#if loading}
    <SkeletonLoader variant="matchup" count={6} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadMatchups} context="matchups" />
  {:else if matchupsRows.length}
    <div class="matchups-list" data-testid="matchups-list">
      {#each matchupsRows as row, idx}
        {#if row.participantsCount === 2}
          <div class="match-row rise" style="animation-delay: {idx * 40}ms;">
            <div class="m-team" class:winner={row.teamA?.points > row.teamB?.points}>
              <img class="m-avatar" src={avatarOrPh(row.teamA?.avatar, row.teamA?.name)} alt={row.teamA?.name} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
              <div class="m-meta">
                <div class="m-name">{row.teamA?.name}</div>
                {#if row.teamA?.ownerName}<div class="m-owner">{row.teamA.ownerName}</div>{/if}
              </div>
              <div class="m-score" class:win={row.teamA?.points > row.teamB?.points} class:tie={row.teamA?.points === row.teamB?.points}>
                <span class="num">{fmt2(row.teamA?.points)}</span>
              </div>
            </div>

            <div class="m-divider"><span class="vs">VS</span></div>

            <div class="m-team right" class:winner={row.teamB?.points > row.teamA?.points}>
              <div class="m-score" class:win={row.teamB?.points > row.teamA?.points} class:tie={row.teamA?.points === row.teamB?.points}>
                <span class="num">{fmt2(row.teamB?.points)}</span>
              </div>
              <div class="m-meta right">
                <div class="m-name">{row.teamB?.name}</div>
                {#if row.teamB?.ownerName}<div class="m-owner">{row.teamB.ownerName}</div>{/if}
              </div>
              <img class="m-avatar" src={avatarOrPh(row.teamB?.avatar, row.teamB?.name)} alt={row.teamB?.name} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            </div>
          </div>
        {:else if row.participantsCount === 1}
          <div class="match-row bye rise" style="animation-delay: {idx * 40}ms;">
            <div class="m-team">
              <img class="m-avatar" src={avatarOrPh(row.teamA?.avatar, row.teamA?.name)} alt={row.teamA?.name} />
              <div class="m-meta">
                <div class="m-name">{row.teamA?.name}</div>
                {#if row.teamA?.ownerName}<div class="m-owner">{row.teamA.ownerName}</div>{/if}
              </div>
              {#if row.teamA?.points != null}
                <div class="m-score"><span class="num">{fmt2(row.teamA.points)}</span></div>
              {/if}
            </div>
            <div class="bye-flag">BYE WEEK</div>
          </div>
        {:else}
          <div class="match-row multi rise">
            <div class="multi-head">
              <span class="multi-label">Multi-team ({row.participantsCount})</span>
              <span class="multi-sub">Week {row.week ?? '-'}</span>
            </div>
            <div class="multi-list">
              {#each row.combinedParticipants as p (p.rosterId)}
                <div class="multi-row">
                  <img class="m-avatar small" src={avatarOrPh(p.avatar, p.name)} alt={p.name} />
                  <div class="m-name">{p.name}</div>
                  <div class="m-score"><span class="num">{fmt2(p.points)}</span></div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="empty-card" data-testid="matchups-empty">No matchups for the selected season/week.</div>
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .head-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; flex-wrap: wrap; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; margin: 0.4rem 0 0; text-transform: uppercase; }
  .filters { display: flex; gap: 0.5rem; }
  .filters select { min-width: 120px; }
  .matchups-list { display: flex; flex-direction: column; gap: 0.6rem; }
  .match-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 1rem; align-items: center; padding: 1rem 1.25rem; background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); transition: border-color var(--t-fast); }
  .match-row:hover { border-color: var(--border-strong); }
  .m-team { display: flex; align-items: center; gap: 0.85rem; min-width: 0; }
  .m-team.right { justify-content: flex-end; }
  .m-team.winner .m-name { color: var(--win); }
  .m-avatar { width: 52px; height: 52px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); flex-shrink: 0; }
  .m-avatar.small { width: 36px; height: 36px; }
  .m-meta { min-width: 0; }
  .m-meta.right { text-align: right; }
  .m-name { font-weight: 700; color: var(--text-primary); line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
  .m-owner { color: var(--text-tertiary); font-size: 0.78rem; margin-top: 0.2rem; }
  .m-score { background: var(--surface-2); border: 1px solid var(--border-subtle); padding: 0.45rem 0.85rem; border-radius: var(--r-sm); min-width: 80px; text-align: center; flex-shrink: 0; }
  .m-score .num { font-family: var(--font-display); font-size: 1.4rem; color: var(--text-secondary); }
  .m-score.win { background: rgba(16, 185, 129, 0.12); border-color: var(--win); }
  .m-score.win .num { color: var(--win); }
  .m-score.tie { border-color: var(--accent); }
  .m-divider { display: grid; place-items: center; }
  .vs { font-family: var(--font-display); color: var(--accent); letter-spacing: 0.15em; font-size: 0.85rem; }
  .match-row.bye { grid-template-columns: 1fr auto; }
  .bye-flag { font-family: var(--font-display); color: var(--text-tertiary); letter-spacing: 0.18em; font-size: 0.85rem; padding: 0.4rem 0.75rem; border: 1px dashed var(--border-strong); border-radius: var(--r-sm); }
  .match-row.multi { display: block; }
  .multi-head { display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-weight: 700; }
  .multi-label { color: var(--text-primary); }
  .multi-sub { color: var(--text-tertiary); font-size: 0.85rem; }
  .multi-list { display: flex; flex-direction: column; gap: 0.3rem; }
  .multi-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.4rem 0.6rem; background: var(--surface-2); border-radius: var(--r-sm); }
  .multi-row .m-name { flex: 1; }
  .empty-card { padding: 2rem; text-align: center; background: var(--surface-1); border: 1px dashed var(--border-strong); border-radius: var(--r-sm); color: var(--text-secondary); }
  @media (max-width: 720px) {
    .head-row { align-items: stretch; }
    .filters { flex: 1; }
    .filters select { flex: 1; min-width: 0; }
    .match-row { grid-template-columns: 1fr; gap: 0.5rem; }
    .m-team, .m-team.right { justify-content: flex-start; flex-direction: row; }
    .m-meta.right { text-align: left; }
    .m-divider { display: none; }
  }
</style>
