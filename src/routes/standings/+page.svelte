<!-- src/routes/standings/+page.svelte (client-side fetched) -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getSeasonsChain, BASE_LEAGUE_ID, pickActiveLeague, getPlayersNba, playerHeadshot } from '$lib/sleeperClient.client';
  import { computeStandingsForLeague } from '$lib/leagueCompute.client';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';
  import Sparkline from '$lib/Sparkline.svelte';

  let loading = true;
  let error = null;
  let seasons = [];
  let seasonsResults = [];
  let selectedSeasonId = null;
  let playersMap = {};

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? name[0].toUpperCase() : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }

  $: selectedResult = (() => {
    if (!seasonsResults.length) return null;
    let found = seasonsResults.find((r) => r.season != null && String(r.season) === String(selectedSeasonId));
    if (found) return found;
    found = seasonsResults.find((r) => String(r.leagueId) === String(selectedSeasonId));
    return found || seasonsResults[seasonsResults.length - 1];
  })();

  // Map of rosterId -> [pf, pf, ...] in week order, for sparklines next to
  // each regular-season row. Pulled out of `weeklyPfByRoster` (built inside
  // `computeStandingsForLeague`) so the chart doesn't need its own data fetch.
  $: weeklyByRoster = (() => {
    const out = {};
    const src = selectedResult?.weeklyPfByRoster || {};
    for (const rid of Object.keys(src)) {
      out[rid] = (src[rid] || []).map((p) => p.pf);
    }
    return out;
  })();

  $: playoffDisplay = (() => {
    if (!selectedResult) return [];
    const raw = (selectedResult.playoffStandings || []).slice();
    if (!raw.length) return [];
    const champs = raw.filter((r) => r.champion === true).sort((a, b) => (b.pf || 0) - (a.pf || 0));
    const others = raw.filter((r) => r.champion !== true).sort((a, b) => {
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      return (b.pf || 0) - (a.pf || 0);
    });
    return [...champs, ...others];
  })();

  // Build the "Regular Season MVP Race" mini-leaderboard: top 5 players by
  // cumulative regular-season points (starters_points summed across every
  // regular-season week in the selected season). For each top-5 player we
  // also compute their rank LAST week so the UI can show a ▲/▼/— arrow.
  $: mvpRace = (() => {
    if (!selectedResult) return null;
    const collected = selectedResult.collectedMatchups || {};
    const playoffStart = selectedResult.playoffStart || 999;
    const weeks = Object.keys(collected)
      .map(Number)
      .filter((w) => w >= 1 && w < playoffStart)
      .sort((a, b) => a - b);
    if (!weeks.length) return null;

    // Iterate week-by-week so we can capture each player's rank at the end
    // of every week (needed for the weekly delta arrow).
    const cumulative = {};        // pid → cumulative regular-season points
    const rosterByPid = {};       // pid → rosterId of most-recent appearance
    const rankByWeek = {};        // week → { pid: rank }
    for (const wk of weeks) {
      const entries = collected[wk] || [];
      for (const entry of entries) {
        const rid = String(entry.roster_id ?? entry.rosterId ?? '');
        const starters = Array.isArray(entry.starters) ? entry.starters : [];
        const pts = entry.starters_points || entry.player_points || null;
        if (!pts || typeof pts !== 'object') continue;
        for (const pid of starters) {
          if (!pid) continue;
          let val = 0;
          if (Array.isArray(pts)) {
            const i = starters.indexOf(pid);
            val = Number(pts[i] ?? 0);
          } else {
            val = Number(pts[String(pid)] ?? 0);
          }
          if (!isFinite(val) || val <= 0) continue;
          cumulative[pid] = (cumulative[pid] || 0) + val;
          rosterByPid[pid] = rid;
        }
      }
      const sortedThisWk = Object.entries(cumulative).sort((a, b) => b[1] - a[1]);
      const ranks = {};
      sortedThisWk.forEach(([pid], i) => { ranks[pid] = i + 1; });
      rankByWeek[wk] = ranks;
    }

    const currentWeek = weeks[weeks.length - 1];
    const prevWeek = weeks.length >= 2 ? weeks[weeks.length - 2] : null;
    const sorted = Object.entries(cumulative).sort((a, b) => b[1] - a[1]);

    const top5 = sorted.slice(0, 5).map(([pid, total], i) => {
      const currentRank = i + 1;
      const prevRank = prevWeek ? (rankByWeek[prevWeek][pid] ?? null) : null;
      const delta = prevRank != null ? prevRank - currentRank : null;
      const rid = rosterByPid[pid];
      const meta = (selectedResult.rosterMap || {})[rid] || {};
      const np = playersMap[pid] || {};
      return {
        playerId: pid,
        playerName: np.full_name || `${np.first_name ?? ''} ${np.last_name ?? ''}`.trim() || pid,
        points: Math.round(total * 100) / 100,
        rosterId: rid,
        teamAvatar: meta.team_avatar || meta.owner_avatar || null,
        teamName: meta.team_name,
        ownerName: meta.owner_name,
        delta,
        isNew: prevRank == null
      };
    });

    return { top5, currentWeek, prevWeek, weekCount: weeks.length };
  })();

  async function loadAll() {
    loading = true;
    error = null;
    try {
      const { seasons: chain } = await getSeasonsChain(BASE_LEAGUE_ID);
      seasons = chain;

      // Resolve selected season from URL — default to the active league
      // (in_season → complete → newest) so we don't land on a not-yet-drafted
      // pre-draft 2026 league with empty tables.
      const urlParam = $page.url.searchParams.get('season');
      const active = pickActiveLeague(chain);
      const latest = active || (chain.length ? chain[chain.length - 1] : null);
      selectedSeasonId = urlParam || (latest?.season != null ? String(latest.season) : String(latest?.league_id || BASE_LEAGUE_ID));

      // Compute standings for ALL seasons (so dropdown can switch without
      // refetching) AND fetch the NBA players map for the MVP-race
      // headshots/names — both in parallel.
      const [results, players] = await Promise.all([
        Promise.all(chain.map((s) => computeStandingsForLeague(s.league_id))),
        getPlayersNba().catch(() => ({}))
      ]);
      seasonsResults = results;
      playersMap = players;
    } catch (e) {
      console.error('[Standings] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  function onSeasonChange(e) {
    const val = e.target.value;
    selectedSeasonId = val;
    // Update URL but don't reload (data is already client-side)
    goto(`?season=${encodeURIComponent(val)}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  onMount(loadAll);
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="head-row">
      <div>
        <div class="eyebrow">League · Standings</div>
        <h1 class="page-title">Standings</h1>
        <p class="page-sub">Regular season and playoff records by team. Switch seasons to scrub through league history.</p>
      </div>
      <div class="season-form">
        <label for="season-select" class="visually-hidden">Season</label>
        <select id="season-select" on:change={onSeasonChange} bind:value={selectedSeasonId} data-testid="standings-season-select">
          {#each seasons as s}
            <option value={s.season}>{s.season}</option>
          {/each}
        </select>
      </div>
    </div>
  </header>

  {#if loading}
    <SkeletonLoader variant="row" count={12} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="standings" />
  {:else}
    {#if mvpRace && mvpRace.top5.length}
      <section class="mvp-race" aria-labelledby="mvp-race-h" data-testid="mvp-race-block">
        <div class="block-head">
          <div>
            <h2 id="mvp-race-h" class="block-title">Regular Season MVP Race</h2>
            <span class="block-sub">Top 5 scorers · Through W{mvpRace.currentWeek}</span>
          </div>
          {#if mvpRace.prevWeek}
            <span class="mvp-race-legend" title="Arrow = rank change since the previous week">vs W{mvpRace.prevWeek}</span>
          {/if}
        </div>
        <ol class="mvp-race-list" data-testid="mvp-race-list">
          {#each mvpRace.top5 as p, idx (p.playerId)}
            <li class="mvp-race-row" data-testid={`mvp-race-row-${idx + 1}`}>
              <div class="mvp-rank num">{idx + 1}</div>
              <img class="mvp-race-headshot" src={playerHeadshot(p.playerId)} alt={p.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
              <div class="mvp-race-meta">
                <div class="mvp-race-player">{p.playerName}</div>
                <div class="mvp-race-team">
                  {#if p.teamAvatar}<img class="mvp-race-team-avatar" src={p.teamAvatar} alt={p.teamName} />{/if}
                  <span class="mvp-race-team-name">{p.teamName ?? '—'}</span>
                </div>
              </div>
              <div class="mvp-race-pts num">{p.points.toFixed(1)}<span class="mvp-race-pts-label"> PTS</span></div>
              <div class="mvp-race-delta" data-testid={`mvp-race-delta-${idx + 1}`}>
                {#if p.isNew}
                  <span class="delta new" title="Newly in top scorer list">NEW</span>
                {:else if p.delta > 0}
                  <span class="delta up" title="Moved up {p.delta} from last week">▲ {p.delta}</span>
                {:else if p.delta < 0}
                  <span class="delta down" title="Moved down {Math.abs(p.delta)} from last week">▼ {Math.abs(p.delta)}</span>
                {:else}
                  <span class="delta flat" title="No change from last week">—</span>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    <section class="standings-block" aria-labelledby="reg-h">
      <div class="block-head">
        <h2 id="reg-h" class="block-title">Regular Season</h2>
        <span class="block-sub">Sorted by W → PF</span>
      </div>
      {#if selectedResult?.regularStandings?.length}
        <div class="table-wrap" data-testid="regular-standings-table">
          <table class="bfa-table">
            <thead>
              <tr>
                <th style="width:60px;">#</th>
                <th>Team</th>
                <th class="col-num">W</th>
                <th class="col-num">L</th>
                <th class="col-num">Win Str</th>
                <th class="col-num">Lose Str</th>
                <th class="col-num">PF</th>
                <th class="col-num">PA</th>
                <th class="col-trend">PF / Week</th>
              </tr>
            </thead>
            <tbody>
              {#each selectedResult.regularStandings as row, idx (row.rosterId)}
                <tr>
                  <td class="rank-cell"><span class="num rank-num">{idx + 1}</span></td>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPh(row.avatar, row.team_name)} alt={row.team_name} />
                      <div>
                        <div class="team-name-cell">{row.team_name}</div>
                        {#if row.owner_name}<div class="team-owner-cell">{row.owner_name}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td class="col-num"><span class="num">{row.wins}</span></td>
                  <td class="col-num"><span class="num">{row.losses}</span></td>
                  <td class="col-num"><span class="num">{row.maxWinStreak ?? 0}</span></td>
                  <td class="col-num"><span class="num">{row.maxLoseStreak ?? 0}</span></td>
                  <td class="col-num pf"><span class="num">{row.pf}</span></td>
                  <td class="col-num"><span class="num muted">{row.pa}</span></td>
                  <td class="col-trend" data-testid={`trend-${row.rosterId}`}>
                    <Sparkline
                      points={weeklyByRoster[row.rosterId] || []}
                      width={140}
                      height={32}
                      stroke="var(--accent)"
                      ariaLabel={`${row.team_name} PF by week`}
                    />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="empty-card">No regular season results.</div>
      {/if}
    </section>

    <section class="standings-block" aria-labelledby="po-h">
      <div class="block-head">
        <h2 id="po-h" class="block-title">Playoffs</h2>
        <span class="block-sub">Champion pinned 🏆</span>
      </div>
      {#if playoffDisplay && playoffDisplay.length}
        <div class="table-wrap" data-testid="playoff-standings-table">
          <table class="bfa-table">
            <thead>
              <tr>
                <th>Team</th>
                <th class="col-num">W</th>
                <th class="col-num">L</th>
                <th class="col-num">PF</th>
                <th class="col-num">PA</th>
              </tr>
            </thead>
            <tbody>
              {#each playoffDisplay as row (row.rosterId)}
                <tr class:champion-row={row.champion === true}>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPh(row.avatar, row.team_name)} alt={row.team_name} />
                      <div>
                        <div class="team-name-cell">
                          {row.team_name}
                          {#if row.champion === true}<span class="trophy" title="Champion">🏆</span>{/if}
                        </div>
                        {#if row.owner_name}<div class="team-owner-cell">{row.owner_name}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td class="col-num"><span class="num">{row.wins}</span></td>
                  <td class="col-num"><span class="num">{row.losses}</span></td>
                  <td class="col-num pf"><span class="num">{row.pf}</span></td>
                  <td class="col-num"><span class="num muted">{row.pa}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="empty-card">No playoff results.</div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .head-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; margin: 0.4rem 0 0; text-transform: uppercase; }
  .page-sub { color: var(--text-secondary); margin-top: 0.5rem; }
  .season-form select { min-width: 130px; }

  .standings-block { margin-bottom: 2rem; background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; }
  .block-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); gap: 1rem; }
  .block-title { font-family: var(--font-display); font-size: 1.4rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .block-sub { color: var(--text-tertiary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600; }
  .table-wrap { width: 100%; overflow-x: auto; }
  .bfa-table { min-width: 940px; }
  .col-trend { width: 160px; min-width: 160px; padding-right: 0.75rem; }
  .rank-cell { width: 60px; }
  .rank-num { font-size: 1.4rem; color: var(--accent); }
  .team-cell { display: flex; align-items: center; gap: 0.75rem; }
  .team-avatar.small { width: 42px; height: 42px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); }
  .team-name-cell { font-weight: 700; color: var(--text-primary); line-height: 1.15; }
  .team-owner-cell { color: var(--text-tertiary); font-size: 0.78rem; margin-top: 0.15rem; }
  .trophy { margin-left: 0.4rem; }
  .pf .num { color: var(--text-primary); font-weight: 700; }
  .num.muted { color: var(--text-tertiary); }
  .empty-card { padding: 2rem; text-align: center; color: var(--text-secondary); }

  /* Regular Season MVP Race · compact 5-row card that sits above the
     standings table. Each row is a horizontal flexbox so it stays readable
     even on narrow viewports (collapses to two-line layout on phones). */
  .mvp-race {
    margin-bottom: 1.5rem;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .mvp-race-legend { color: var(--text-tertiary); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600; }
  .mvp-race-list { list-style: none; margin: 0; padding: 0; }
  .mvp-race-row {
    display: grid;
    grid-template-columns: 32px 44px 1fr auto 56px;
    align-items: center;
    gap: 0.85rem;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--border-subtle);
  }
  .mvp-race-row:last-child { border-bottom: none; }
  .mvp-rank { font-size: 1.2rem; color: var(--text-tertiary); font-variant-numeric: tabular-nums; text-align: center; }
  .mvp-race-headshot {
    width: 40px; height: 40px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
  }
  .mvp-race-meta { min-width: 0; }
  .mvp-race-player {
    font-weight: 700;
    color: var(--text-primary);
    font-size: 0.95rem;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mvp-race-team {
    display: flex; align-items: center; gap: 0.4rem;
    margin-top: 0.2rem;
    color: var(--text-tertiary);
    font-size: 0.75rem;
  }
  .mvp-race-team-avatar {
    width: 18px; height: 18px;
    border-radius: 4px;
    object-fit: cover;
    background: var(--surface-2);
  }
  .mvp-race-team-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mvp-race-pts { color: var(--accent); font-size: 1.05rem; font-variant-numeric: tabular-nums; text-align: right; }
  .mvp-race-pts-label { font-family: var(--font-body); font-size: 0.6rem; font-weight: 800; letter-spacing: 0.2em; color: var(--text-tertiary); margin-left: 0.25rem; }
  .mvp-race-delta { text-align: right; font-variant-numeric: tabular-nums; }
  .delta {
    display: inline-block;
    padding: 0.15rem 0.4rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .delta.up { color: var(--win); background: rgba(16, 185, 129, 0.12); }
  .delta.down { color: var(--loss); background: rgba(239, 68, 68, 0.12); }
  .delta.flat { color: var(--text-tertiary); }
  .delta.new { color: var(--brand); background: var(--brand-soft); font-size: 0.62rem; }

  @media (max-width: 600px) {
    .mvp-race-row {
      grid-template-columns: 28px 36px 1fr auto;
      grid-template-rows: auto auto;
      column-gap: 0.6rem;
      row-gap: 0.2rem;
      padding: 0.6rem 0.85rem;
    }
    .mvp-race-headshot { width: 34px; height: 34px; }
    .mvp-race-delta {
      grid-column: 4 / 5;
      grid-row: 2 / 3;
      justify-self: end;
    }
    .mvp-race-pts {
      grid-column: 4 / 5;
      grid-row: 1 / 2;
    }
    .mvp-race-player { font-size: 0.88rem; }
  }
  @media (max-width: 720px) {
    .page { padding: 1.75rem 0 3rem; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .head-row { flex-direction: column; align-items: stretch; }
    .season-form { display: flex; }
    .season-form select { flex: 1; }
    .block-head { padding: 0.85rem 1rem; }
    .block-title { font-size: 1.1rem; }
    .col-trend { width: 96px; min-width: 96px; padding-right: 0.5rem; }
    .team-avatar.small { width: 34px; height: 34px; }
    .team-owner-cell { display: none; }
    .rank-num { font-size: 1.2rem; }
  }
</style>
