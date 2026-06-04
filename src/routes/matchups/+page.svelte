<!-- src/routes/matchups/+page.svelte (client-side fetched) -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getSeasonsChain, BASE_LEAGUE_ID, pickActiveLeague, getPlayersNba, playerHeadshot } from '$lib/sleeperClient.client';
  import { computeMatchupsForLeagueWeek, starterPointsByPid } from '$lib/leagueCompute.client';
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
  let playersMap = {};

  // Per-week cache: key = `${leagueId}:${week}` → { matchupsRows, playoffStart, playoffEnd }.
  // Populated synchronously on every successful fetch, AND in the background
  // for every other week of the selected season as soon as that season is
  // loaded. Result: switching weeks is a zero-network operation after the
  // first paint completes — no spinner, no skeleton flash, no API call.
  let weekCache = {};
  // Tracks "I am currently re-fetching THIS key" so we never overwrite a
  // newer fetch's result with an older fetch that finished later. Only ever
  // checked inside the async loader — never read in markup.
  let fetchInFlight = null;
  // Used to render a subtle inline "refreshing…" pill while a background
  // re-fetch is happening. Distinct from `loading`, which still blanks the
  // page on FIRST load only.
  let bgRefreshing = false;
  const cacheKey = (lid, wk) => `${lid}:${wk}`;

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? name[0].toUpperCase() : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }
  function fmt2(n) { return Number(n ?? 0).toFixed(2); }
  function fmt1(n) { return Number(n ?? 0).toFixed(1); }
  // Reactive helper — recreated whenever `playersMap` changes so any
  // `pname(pid)` call in the markup re-renders once the NBA-players fetch
  // resolves. Svelte's compiler tracks the variable reference, not the
  // function-body dependency, so we re-bind on every playersMap update.
  $: pname = (pid) => {
    if (!pid) return null;
    const p = playersMap[pid];
    if (!p) return String(pid);
    return p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || String(pid);
  };

  // Build the week's recap stats reactively from `matchupsRows`. Every
  // metric is derived from the data already on each team (starters +
  // starters_points + player_points) so no extra fetches are needed.
  $: recap = (() => {
    if (!matchupsRows.length) return null;
    const teams = [];                 // [{ name, owner, points, avatar, rosterId }]
    const playerScores = [];          // [{ pid, points, teamName, ownerName, teamAvatar, isStarter }]
    let biggestBlowout = null;        // { winner, loser, margin }
    let closestGame = null;           // { teams, margin }
    let mostExciting = null;          // { teams, total }   highest combined
    let totalPoints = 0;
    const benchByTeam = [];           // [{ team, topBench, totalBench, lowestStarter }]

    for (const row of matchupsRows) {
      const sides = [row.teamA, row.teamB].filter(t => t && t.points != null && t.name !== 'BYE');
      for (const t of sides) {
        teams.push({
          name: t.name, owner: t.ownerName, points: Number(t.points), avatar: t.avatar, rosterId: t.rosterId
        });
        totalPoints += Number(t.points) || 0;

        // ----- Per-starter scores -----
        // SOURCE OF TRUTH: `starters_points` array (via starterPointsByPid).
        // Top 3 Performances and Bust of the Week both read from this only.
        // We never fall back to `player_points` here — that would include
        // bench contributions and corrupt the "starter" semantics.
        const starters = Array.isArray(t.starters) ? t.starters : [];
        const starterMeta = { teamName: t.name, ownerName: t.ownerName, teamAvatar: t.avatar, rosterId: t.rosterId };
        const starterPidSet = new Set(starters.filter(Boolean).map(String));
        let lowestStarter = null;
        const starterMap = starterPointsByPid(t);
        if (starterMap) {
          for (const pid of Object.keys(starterMap)) {
            const val = starterMap[pid];
            if (!isFinite(val) || val <= 0) continue;
            playerScores.push({ pid, points: val, ...starterMeta, isStarter: true });
            if (!lowestStarter || val < lowestStarter.points) {
              lowestStarter = { pid, points: val, ...starterMeta };
            }
          }
        }

        // ----- Bench scoring: every entry in player_points whose pid is
        // NOT one of the starters that week. Used for "bench burn" stat. -----
        let topBench = null;
        let totalBench = 0;
        if (t.player_points && typeof t.player_points === 'object' && !Array.isArray(t.player_points)) {
          for (const pid of Object.keys(t.player_points)) {
            if (starterPidSet.has(pid)) continue;
            const val = Number(t.player_points[pid] ?? 0);
            if (!isFinite(val) || val <= 0) continue;
            totalBench += val;
            if (!topBench || val > topBench.points) topBench = { pid, points: val, ...starterMeta };
          }
        }
        if (topBench || lowestStarter) {
          benchByTeam.push({ team: starterMeta, topBench, totalBench, lowestStarter });
        }
      }

      // Matchup-level stats — only meaningful for true 1v1 weeks.
      if (row.participantsCount === 2 && row.teamA?.points != null && row.teamB?.points != null) {
        const a = Number(row.teamA.points), b = Number(row.teamB.points);
        const margin = Math.abs(a - b);
        const winner = a >= b ? row.teamA : row.teamB;
        const loser  = a >= b ? row.teamB : row.teamA;
        if (!biggestBlowout || margin > biggestBlowout.margin) {
          biggestBlowout = { winner, loser, margin };
        }
        if (margin > 0.01 && (!closestGame || margin < closestGame.margin)) {
          closestGame = { teams: [row.teamA, row.teamB].sort((x, y) => y.points - x.points), margin };
        }
        const combined = a + b;
        if (!mostExciting || combined > mostExciting.total) {
          mostExciting = { teams: [row.teamA, row.teamB].sort((x, y) => y.points - x.points), total: combined, margin };
        }
      }
    }

    if (!teams.length) return null;
    const sortedTeams = teams.slice().sort((a, b) => b.points - a.points);
    // Top 3 and Bust come strictly from `starters_points` (via
    // `starterPointsByPid`). Filter out any 0-point entries so a week
    // with partial data can't put a 0.0 starter on the leaderboard.
    const sortedPlayers = playerScores
      .filter((p) => p.isStarter && p.points > 0)
      .sort((a, b) => b.points - a.points);
    const top3 = sortedPlayers.slice(0, 3);

    // Bench Burn — bench player who outscored their team's lowest starter
    // by the most (i.e. "you should have benched X for Y").
    let benchBurn = null;
    for (const b of benchByTeam) {
      if (!b.topBench || !b.lowestStarter) continue;
      const diff = b.topBench.points - b.lowestStarter.points;
      if (diff > 0 && (!benchBurn || diff > benchBurn.diff)) {
        benchBurn = { ...b.topBench, diff, lowestStarter: b.lowestStarter };
      }
    }
    // Fall back to the heaviest individual bench player if no clean
    // "shoulda started" candidate exists.
    if (!benchBurn) {
      const heaviestBench = benchByTeam
        .map((b) => b.topBench)
        .filter(Boolean)
        .sort((a, b) => b.points - a.points)[0];
      if (heaviestBench) benchBurn = { ...heaviestBench, diff: null, lowestStarter: null };
    }

    // Bust of the Week — lowest non-zero starter score across the league
    // (sortedPlayers is already filtered to starters with points > 0).
    const bustOfWeek = sortedPlayers.length ? sortedPlayers[sortedPlayers.length - 1] : null;

    return {
      top3,
      benchBurn,
      bustOfWeek,
      biggestBlowout,
      closestGame,
      mostExciting,
      highTeam: sortedTeams[0] || null,
      lowTeam: sortedTeams[sortedTeams.length - 1] || null,
      avgScore: teams.length ? totalPoints / teams.length : 0,
      totalPoints,
      teamCount: teams.length
    };
  })();

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

  /**
   * Apply a `{matchupsRows, playoffStart, playoffEnd}` snapshot from the
   * cache into the reactive state. Idempotent — safe to call repeatedly.
   */
  function applySnapshot(snap) {
    matchupsRows = snap.matchupsRows || [];
    playoffStart = snap.playoffStart;
    playoffEnd = snap.playoffEnd;
    weekOptions = {
      regular: Array.from({ length: Math.max(0, playoffStart - 1) }, (_, i) => i + 1),
      playoffs: Array.from({ length: 3 }, (_, i) => playoffStart + i)
    };
  }

  /**
   * Show the requested week IMMEDIATELY from cache (if present), then
   * background-refresh in case the data changed. If there is no cache
   * entry yet, the FIRST mount keeps `loading = true` so skeletons paint;
   * subsequent week switches only set `bgRefreshing = true` so the previous
   * week's data stays visible while we re-fetch (no blank page flash).
   */
  async function loadMatchups({ isInitial = false } = {}) {
    if (!selectedLeagueId) return;
    const key = cacheKey(selectedLeagueId, selectedWeek);

    // Hot path — cached snapshot exists.
    if (weekCache[key]) {
      applySnapshot(weekCache[key]);
      loading = false;
      error = null;
      // Schedule a single background refresh on initial mount so stale
      // localStorage-cached weeks tick over. Subsequent switches do NOT
      // re-fetch the cached week (Sleeper data for past weeks is stable).
      if (isInitial) backgroundRefresh(selectedLeagueId, selectedWeek);
      return;
    }

    // Cold path — first time this (league, week) has been requested.
    // Only show the blocking spinner on the very first mount; otherwise we
    // keep the previous week's data on screen and show an inline pill.
    if (isInitial) loading = true;
    else bgRefreshing = true;
    error = null;
    const inflightKey = `${key}:${Date.now()}`;
    fetchInFlight = inflightKey;
    try {
      const out = await computeMatchupsForLeagueWeek(selectedLeagueId, selectedWeek);
      // Discard stale responses — a faster click may have superseded us.
      if (fetchInFlight !== inflightKey) return;
      const snap = {
        matchupsRows: out.matchupsRows || [],
        playoffStart: out.playoffStart,
        playoffEnd: out.playoffEnd
      };
      weekCache = { ...weekCache, [key]: snap };
      applySnapshot(snap);
    } catch (e) {
      console.error('[Matchups] failed', e);
      error = e;
    } finally {
      loading = false;
      bgRefreshing = false;
    }
  }

  /**
   * Fire-and-forget background re-fetch of a week we already have cached.
   * Used on initial mount so the snapshot is kept fresh.
   */
  async function backgroundRefresh(leagueId, week) {
    const key = cacheKey(leagueId, week);
    try {
      const out = await computeMatchupsForLeagueWeek(leagueId, week);
      const snap = {
        matchupsRows: out.matchupsRows || [],
        playoffStart: out.playoffStart,
        playoffEnd: out.playoffEnd
      };
      weekCache = { ...weekCache, [key]: snap };
      // Only re-apply if the user is still viewing this same week.
      if (selectedLeagueId === leagueId && selectedWeek === week) {
        applySnapshot(snap);
      }
    } catch (e) { /* silent — cached snapshot remains visible */ }
  }

  /**
   * Prefetch every week of the selected season in the background so the
   * dropdown is instant after the very first paint. Skips weeks already
   * in the cache, and limits to 4 in-flight requests at a time so we
   * don't hammer the Sleeper CDN.
   */
  async function prefetchSeason(leagueId, playoffStartLocal) {
    if (!leagueId) return;
    const weeks = Array.from({ length: (playoffStartLocal || 15) - 1 + 3 }, (_, i) => i + 1);
    const queue = weeks.filter((w) => !weekCache[cacheKey(leagueId, w)]);
    const CONCURRENCY = 4;
    async function worker() {
      while (queue.length) {
        const wk = queue.shift();
        // Bail out if the user has navigated to a different season meanwhile.
        if (selectedLeagueId !== leagueId) return;
        try {
          const out = await computeMatchupsForLeagueWeek(leagueId, wk);
          const snap = {
            matchupsRows: out.matchupsRows || [],
            playoffStart: out.playoffStart,
            playoffEnd: out.playoffEnd
          };
          // Late insert — only set if the user hasn't navigated away.
          if (selectedLeagueId === leagueId) {
            weekCache = { ...weekCache, [cacheKey(leagueId, wk)]: snap };
          }
        } catch (e) { /* one missing week shouldn't kill the prefetch */ }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  function onSeasonChange(e) {
    const val = e.target.value;
    const found = seasons.find(s => String(s.season) === val || String(s.league_id) === val);
    if (!found) return;
    selectedSeason = found.season ?? found.league_id;
    selectedLeagueId = found.league_id;
    goto(`?season=${encodeURIComponent(val)}&week=${selectedWeek}`, { replaceState: true });
    loadMatchups();
    // Kick off a background prefetch for the new season — week 1 is in
    // flight via loadMatchups() above, and the rest will follow with
    // 4-wide concurrency. Subsequent week switches in this season will be
    // instant once the prefetch settles (~2-3s on Sleeper's CDN).
    prefetchSeason(selectedLeagueId, playoffStart);
  }

  function onWeekChange(e) {
    selectedWeek = Number(e.target.value);
    goto(`?season=${encodeURIComponent(selectedSeason)}&week=${selectedWeek}`, { replaceState: true });
    loadMatchups();
  }

  onMount(async () => {
    await loadSeasons();
    // Fire the players-map fetch in parallel — recap top-scorer needs names.
    const playersPromise = getPlayersNba().catch(() => ({}));
    await loadMatchups({ isInitial: true });
    playersMap = await playersPromise;
    // Start prefetching every other week in the background. We have to
    // wait for `loadMatchups` so we know `playoffStart` for the season.
    prefetchSeason(selectedLeagueId, playoffStart);
  });
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="head-row">
      <div>
        <div class="eyebrow">League · Weekly Recap</div>
        <h1 class="page-title">Weekly Recap</h1>
        <p class="page-sub">Top performances, biggest blowout, closest game, and every head-to-head from the selected week.</p>
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
        {#if bgRefreshing}
          <span class="refresh-pill" data-testid="matchups-refresh-pill" aria-live="polite">Refreshing…</span>
        {/if}
      </div>
    </div>
  </header>

  {#if loading}
    <SkeletonLoader variant="matchup" count={6} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadMatchups} context="matchups" />
  {:else if matchupsRows.length}
    {#if recap}
      <section class="recap-block" data-testid="recap-block">
        <div class="recap-head">
          <h2 class="recap-title">Week {selectedWeek} Recap</h2>
          <span class="recap-sub">{recap.teamCount} teams · {fmt1(recap.totalPoints)} total PTS · Avg {fmt1(recap.avgScore)}</span>
        </div>
        <div class="recap-grid">
          {#if recap.top3.length}
            <div class="recap-card top-scorer wide" data-testid="recap-top-scorer">
              <div class="recap-eyebrow">🏀 Top 3 Performances</div>
              <ol class="recap-top3-list">
                {#each recap.top3 as p, idx}
                  <li class="recap-top3-row" data-testid={`recap-top3-${idx + 1}`}>
                    <span class="recap-top3-rank">{idx + 1}</span>
                    <img class="recap-top3-headshot" src={playerHeadshot(p.pid)} alt={pname(p.pid) || ''} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    <div class="recap-top3-meta">
                      <div class="recap-top3-name">{pname(p.pid) ?? p.pid}</div>
                      <div class="recap-top3-team">
                        {#if p.teamAvatar}<img class="recap-team-mini" src={p.teamAvatar} alt={p.teamName} />{/if}
                        <span>{p.teamName}</span>
                      </div>
                    </div>
                    <span class="recap-top3-pts num">{fmt2(p.points)}</span>
                  </li>
                {/each}
              </ol>
            </div>
          {/if}

          {#if recap.biggestBlowout}
            <div class="recap-card" data-testid="recap-blowout">
              <div class="recap-eyebrow">💥 Biggest Blowout</div>
              <div class="recap-card-body">
                <img class="recap-team-avatar" src={avatarOrPh(recap.biggestBlowout.winner.avatar, recap.biggestBlowout.winner.name)} alt={recap.biggestBlowout.winner.name} />
                <div class="recap-card-meta">
                  <div class="recap-player">{recap.biggestBlowout.winner.name}</div>
                  <div class="recap-card-team muted">def. {recap.biggestBlowout.loser.name}</div>
                </div>
              </div>
              <div class="recap-stat win">+{fmt1(recap.biggestBlowout.margin)}<span class="recap-stat-label"> MARGIN</span></div>
            </div>
          {/if}

          {#if recap.closestGame}
            <div class="recap-card" data-testid="recap-closest">
              <div class="recap-eyebrow">🔥 Closest Game</div>
              <div class="recap-card-body">
                <img class="recap-team-avatar" src={avatarOrPh(recap.closestGame.teams[0].avatar, recap.closestGame.teams[0].name)} alt={recap.closestGame.teams[0].name} />
                <div class="recap-card-meta">
                  <div class="recap-player">{recap.closestGame.teams[0].name}</div>
                  <div class="recap-card-team muted">vs {recap.closestGame.teams[1].name}</div>
                </div>
              </div>
              <div class="recap-stat">{fmt1(recap.closestGame.margin)}<span class="recap-stat-label"> PT WIN</span></div>
            </div>
          {/if}

          {#if recap.mostExciting}
            <div class="recap-card" data-testid="recap-exciting">
              <div class="recap-eyebrow">🎯 Highest-Scoring Matchup</div>
              <div class="recap-card-body">
                <img class="recap-team-avatar" src={avatarOrPh(recap.mostExciting.teams[0].avatar, recap.mostExciting.teams[0].name)} alt={recap.mostExciting.teams[0].name} />
                <div class="recap-card-meta">
                  <div class="recap-player">{recap.mostExciting.teams[0].name} <span class="muted">vs</span> {recap.mostExciting.teams[1].name}</div>
                  <div class="recap-card-team muted">{fmt1(recap.mostExciting.teams[0].points)} – {fmt1(recap.mostExciting.teams[1].points)}</div>
                </div>
              </div>
              <div class="recap-stat">{fmt1(recap.mostExciting.total)}<span class="recap-stat-label"> COMBINED</span></div>
            </div>
          {/if}

          {#if recap.benchBurn}
            <div class="recap-card" data-testid="recap-bench-burn">
              <div class="recap-eyebrow">🪑 Biggest Bench Burn</div>
              <div class="recap-card-body">
                <img class="recap-headshot" src={playerHeadshot(recap.benchBurn.pid)} alt={pname(recap.benchBurn.pid) || ''} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                <div class="recap-card-meta">
                  <div class="recap-player">{pname(recap.benchBurn.pid) ?? recap.benchBurn.pid}</div>
                  <div class="recap-card-team">
                    {#if recap.benchBurn.teamAvatar}<img class="recap-team-mini" src={recap.benchBurn.teamAvatar} alt={recap.benchBurn.teamName} />{/if}
                    <span class="muted">{recap.benchBurn.teamName} · benched</span>
                  </div>
                </div>
              </div>
              <div class="recap-stat loss">
                {fmt2(recap.benchBurn.points)}<span class="recap-stat-label"> PTS</span>
                {#if recap.benchBurn?.diff != null}<span class="recap-stat-sub">+{fmt1(recap.benchBurn.diff)} over worst starter</span>{/if}
              </div>
            </div>
          {/if}

          {#if recap.bustOfWeek}
            <div class="recap-card" data-testid="recap-bust">
              <div class="recap-eyebrow">🥶 Bust of the Week</div>
              <div class="recap-card-body">
                <img class="recap-headshot" src={playerHeadshot(recap.bustOfWeek.pid)} alt={pname(recap.bustOfWeek.pid) || ''} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                <div class="recap-card-meta">
                  <div class="recap-player">{pname(recap.bustOfWeek.pid) ?? recap.bustOfWeek.pid}</div>
                  <div class="recap-card-team">
                    {#if recap.bustOfWeek.teamAvatar}<img class="recap-team-mini" src={recap.bustOfWeek.teamAvatar} alt={recap.bustOfWeek.teamName} />{/if}
                    <span class="muted">{recap.bustOfWeek.teamName} · started</span>
                  </div>
                </div>
              </div>
              <div class="recap-stat loss">{fmt2(recap.bustOfWeek.points)}<span class="recap-stat-label"> PTS</span></div>
            </div>
          {/if}

          {#if recap.highTeam}
            <div class="recap-card" data-testid="recap-high-team">
              <div class="recap-eyebrow">📈 Highest Team Score</div>
              <div class="recap-card-body">
                <img class="recap-team-avatar" src={avatarOrPh(recap.highTeam.avatar, recap.highTeam.name)} alt={recap.highTeam.name} />
                <div class="recap-card-meta">
                  <div class="recap-player">{recap.highTeam.name}</div>
                  {#if recap.highTeam.owner}<div class="recap-card-team muted">{recap.highTeam.owner}</div>{/if}
                </div>
              </div>
              <div class="recap-stat win">{fmt2(recap.highTeam.points)}<span class="recap-stat-label"> PTS</span></div>
            </div>
          {/if}

          {#if recap.lowTeam && recap.lowTeam !== recap.highTeam}
            <div class="recap-card" data-testid="recap-low-team">
              <div class="recap-eyebrow">📉 Lowest Team Score</div>
              <div class="recap-card-body">
                <img class="recap-team-avatar" src={avatarOrPh(recap.lowTeam.avatar, recap.lowTeam.name)} alt={recap.lowTeam.name} />
                <div class="recap-card-meta">
                  <div class="recap-player">{recap.lowTeam.name}</div>
                  {#if recap.lowTeam.owner}<div class="recap-card-team muted">{recap.lowTeam.owner}</div>{/if}
                </div>
              </div>
              <div class="recap-stat loss">{fmt2(recap.lowTeam.points)}<span class="recap-stat-label"> PTS</span></div>
            </div>
          {/if}
        </div>
      </section>
    {/if}

    <div class="matchups-header">
      <h2 class="recap-title">Head-to-Head Matchups</h2>
      <span class="recap-sub">Final scores · Winner highlighted</span>
    </div>
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

  /* Weekly Recap block — 5 stat cards above the matchup grid summarizing
     the most narrative moments from the week. Uses CSS grid auto-fit so
     it gracefully reflows from 3-up to 2-up to 1-up depending on width. */
  .recap-block {
    margin-bottom: 2rem;
    padding: 1.25rem 1.25rem 1.5rem;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
  }
  .recap-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap;
  }
  .recap-title { font-family: var(--font-display); font-size: 1.4rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .recap-sub { color: var(--text-tertiary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600; }
  .recap-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.75rem;
  }
  .recap-card {
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 0.95rem 1rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .recap-card.top-scorer { border-color: var(--accent); }
  .refresh-pill {
    display: inline-flex; align-items: center; gap: 0.35rem;
    padding: 0.3rem 0.65rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-tertiary);
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    align-self: center;
  }
  .refresh-pill::before {
    content: "";
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: refresh-pulse 1s infinite;
  }
  @keyframes refresh-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .recap-card.wide { grid-column: span 2; }
  .recap-top3-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
  .recap-top3-row {
    display: grid;
    grid-template-columns: 24px 40px 1fr auto;
    align-items: center;
    gap: 0.65rem;
  }
  .recap-top3-rank {
    font-family: var(--font-display);
    font-size: 1.1rem;
    color: var(--text-tertiary);
    text-align: center;
  }
  .recap-top3-headshot {
    width: 36px; height: 36px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
  }
  .recap-top3-meta { min-width: 0; }
  .recap-top3-name {
    font-weight: 700; color: var(--text-primary); font-size: 0.9rem;
    line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .recap-top3-team {
    display: flex; align-items: center; gap: 0.3rem;
    margin-top: 0.15rem; color: var(--text-tertiary); font-size: 0.72rem;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .recap-top3-pts {
    font-family: var(--font-display);
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    font-size: 1.05rem;
  }
  .recap-stat-sub {
    display: block;
    font-family: var(--font-body);
    font-size: 0.66rem;
    font-weight: 600;
    color: var(--text-tertiary);
    letter-spacing: 0.06em;
    margin-top: 0.25rem;
  }
  .muted { color: var(--text-tertiary); }
  @media (max-width: 720px) {
    .recap-card.wide { grid-column: span 1; }
  }
  .recap-eyebrow {
    font-family: var(--font-body);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-size: 0.66rem;
    color: var(--text-tertiary);
  }
  .recap-card-body { display: flex; align-items: center; gap: 0.7rem; min-width: 0; }
  .recap-headshot, .recap-team-avatar {
    width: 44px; height: 44px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .recap-card-meta { min-width: 0; flex: 1; }
  .recap-player {
    font-weight: 700;
    color: var(--text-primary);
    font-size: 0.95rem;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .recap-card-team {
    display: flex; align-items: center; gap: 0.35rem;
    margin-top: 0.2rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .recap-card-team.muted { color: var(--text-tertiary); }
  .recap-team-mini {
    width: 16px; height: 16px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .recap-stat {
    font-family: var(--font-display);
    font-size: 1.6rem;
    color: var(--accent);
    line-height: 1;
    margin-top: 0.1rem;
    font-variant-numeric: tabular-nums;
  }
  .recap-stat.win { color: var(--win); }
  .recap-stat.loss { color: var(--loss); }
  .recap-stat-label {
    font-family: var(--font-body);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.2em;
    color: var(--text-tertiary);
    margin-left: 0.25rem;
  }
  .matchups-header {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.75rem;
  }

  @media (max-width: 720px) {
    .recap-block { padding: 1rem; }
    .recap-title { font-size: 1.15rem; }
    .recap-stat { font-size: 1.35rem; }
    .recap-headshot, .recap-team-avatar { width: 38px; height: 38px; }
  }
  @media (max-width: 720px) {
    .page { padding: 1.75rem 0 3rem; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .head-row { align-items: stretch; }
    .filters { flex: 1; gap: 0.4rem; }
    .filters select { flex: 1; min-width: 0; font-size: 0.85rem; }
    .match-row { grid-template-columns: 1fr; gap: 0.5rem; padding: 0.85rem 0.95rem; }
    .m-team, .m-team.right { justify-content: flex-start; flex-direction: row; }
    .m-meta.right { text-align: left; }
    .m-divider { display: none; }
    .m-avatar { width: 42px; height: 42px; }
    .m-name { font-size: 0.9rem; max-width: 100%; white-space: normal; overflow: visible; }
    .m-score { padding: 0.35rem 0.6rem; min-width: 60px; }
    .m-score .num { font-size: 1.15rem; }
  }
</style>
