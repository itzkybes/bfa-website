<!-- src/routes/honor-hall/+page.svelte (client-side fetched, simplified final standings) -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getSeasonsChain, BASE_LEAGUE_ID, getPlayersNba, playerHeadshot, pickActiveLeague } from '$lib/sleeperClient.client';
  import { computeStandingsForLeague } from '$lib/leagueCompute.client';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';

  let loading = true;
  let error = null;
  let seasons = [];
  let selectedSeason = null;
  let finalStandings = []; // for current season selection
  let finalsMvp = null;
  let playoffsMvp = null;
  let regularMvp = null;
  let playersMap = {};

  // Stash season results so dropdown switching is instant
  let cache = {}; // season -> { finalStandings, finalsMvp, playoffsMvp, regularMvp }

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? name[0].toUpperCase() : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }
  function fmt(v) {
    const n = Number(v); if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toFixed(1);
  }
  function placeEmoji(rank) {
    if (rank === 1) return '🏆'; if (rank === 2) return '🥈'; if (rank === 3) return '🥉'; return '';
  }

  function playerName(pid) {
    if (!pid) return '';
    const p = playersMap[pid];
    if (!p) return String(pid);
    return p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || String(pid);
  }

  function aggregatePlayerPoints(matchupEntries) {
    const byPlayer = {};
    for (const entry of matchupEntries) {
      if (!entry) continue;
      const rid = String(entry.roster_id ?? entry.rosterId ?? '');
      const starters = Array.isArray(entry.starters) ? entry.starters : [];
      // SOURCE OF TRUTH: `starters_points` array, zipped with `starters`.
      // We never fall back to `player_points` — that includes raw
      // unselected games and would corrupt MVP figures for managers who
      // manually pick which game counts each week.
      const sp = entry.starters_points;
      if (!Array.isArray(sp) || !starters.length) continue;
      for (let i = 0; i < starters.length; i++) {
        const pid = starters[i];
        if (!pid) continue;
        const n = Number(sp[i] ?? 0);
        const val = isFinite(n) ? n : 0;
        if (!byPlayer[pid]) byPlayer[pid] = { playerId: pid, points: 0, rosterId: rid };
        byPlayer[pid].points += val;
      }
    }
    for (const k of Object.keys(byPlayer)) byPlayer[k].points = Math.round(byPlayer[k].points * 100) / 100;
    return byPlayer;
  }

  async function computeSeason(leagueIdOrSeason) {
    // resolve season -> leagueId
    let target = seasons.find(s => String(s.season) === String(leagueIdOrSeason) || String(s.league_id) === String(leagueIdOrSeason));
    if (!target && seasons.length) target = seasons[seasons.length - 1];
    if (!target) return;
    const cacheKey = String(target.season ?? target.league_id);
    if (cache[cacheKey]) {
      finalStandings = cache[cacheKey].finalStandings;
      finalsMvp = cache[cacheKey].finalsMvp;
      playoffsMvp = cache[cacheKey].playoffsMvp;
      regularMvp = cache[cacheKey].regularMvp;
      return;
    }

    const standings = await computeStandingsForLeague(target.league_id);
    const playoffStart = standings.playoffStart;
    const playoffEnd = standings.playoffEnd;

    // ---- Bracket-derived final standings (1st → last) ----
    const finalList = (standings.finalStandings || []).slice();
    // Already sorted by rank ascending. Enrich with seed if needed.
    finalList.forEach((row) => {
      if (row.seed == null) {
        const idx = standings.regularStandings.findIndex(r => r.rosterId === row.rosterId);
        row.seed = idx >= 0 ? idx + 1 : null;
      }
    });

    // ---- MVPs ----
    // Use the matchups we already collected during standings calc (no re-fetch).
    const collected = standings.collectedMatchups || {};
    const regularEntries = [];
    const playoffEntries = [];
    for (const wk of Object.keys(collected)) {
      const week = Number(wk);
      const arr = collected[wk] || [];
      if (week >= playoffStart && week <= playoffEnd) playoffEntries.push(...arr);
      else if (week >= 1 && week < playoffStart) regularEntries.push(...arr);
    }

    // Playoffs MVP must come from a team that ACTUALLY made the playoffs —
    // i.e. seeds 1 → playoff_teams (typically 1–8). Filter out losers-
    // bracket entries so a toilet-bowl matchup doesn't accidentally crown
    // the playoff MVP.
    const playoffTeamCount = Number(standings.playoffTeams) || 8;
    const playoffRosterSet = new Set(
      (standings.regularStandings || [])
        .slice(0, playoffTeamCount)
        .map((r) => String(r.rosterId))
    );
    const playoffEntriesEligible = playoffEntries.filter(
      (e) => playoffRosterSet.has(String(e.roster_id ?? e.rosterId ?? ''))
    );

    // Regular Season MVP = top scorer across regular-season weeks only
    // (does NOT include playoff points).
    const regularList = Object.values(aggregatePlayerPoints(regularEntries)).sort((a, b) => b.points - a.points);
    const playoffsList = Object.values(aggregatePlayerPoints(playoffEntriesEligible)).sort((a, b) => b.points - a.points);

    // Finals MVP = top scorer in the championship GAME only (both finalists),
    // NOT the champion's top scorer across the full playoff window.
    let finalsList = [];
    if (standings.bracketComplete && standings.championshipGame?.week != null) {
      const champWeek = standings.championshipGame.week;
      const champRosters = new Set((standings.championshipGame.rosterIds || []).map(String));
      const champGameEntries = (collected[champWeek] || []).filter(
        (e) => champRosters.has(String(e.roster_id ?? e.rosterId ?? ''))
      );
      finalsList = Object.values(aggregatePlayerPoints(champGameEntries))
        .sort((a, b) => b.points - a.points);
    }

    const om = regularList[0] || null;
    const pm = playoffsList[0] || null;
    const fm = finalsList[0] || null;

    const result = {
      finalStandings: finalList,
      finalsMvp: fm ? { ...fm, playerName: playerName(fm.playerId), roster_meta: standings.rosterMap[fm.rosterId] } : null,
      playoffsMvp: pm ? { ...pm, playerName: playerName(pm.playerId), roster_meta: standings.rosterMap[pm.rosterId] } : null,
      regularMvp: om ? { ...om, playerName: playerName(om.playerId), roster_meta: standings.rosterMap[om.rosterId] } : null
    };
    cache[cacheKey] = result;
    finalStandings = result.finalStandings;
    finalsMvp = result.finalsMvp;
    playoffsMvp = result.playoffsMvp;
    regularMvp = result.regularMvp;
  }

  async function loadAll() {
    loading = true; error = null;
    try {
      const playersPromise = getPlayersNba().catch(() => ({}));
      const { seasons: chain } = await getSeasonsChain(BASE_LEAGUE_ID);
      seasons = chain;
      const urlSeason = $page.url.searchParams.get('season');
      const active = pickActiveLeague(chain);
      const latest = active || chain[chain.length - 1];
      selectedSeason = urlSeason || (latest?.season != null ? String(latest.season) : String(latest?.league_id));
      playersMap = await playersPromise;
      await computeSeason(selectedSeason);
    } catch (e) {
      console.error('[Honor-Hall] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  async function onSeasonChange(e) {
    selectedSeason = e.target.value;
    goto(`?season=${encodeURIComponent(selectedSeason)}`, { replaceState: true, keepFocus: true, noScroll: true });
    loading = true;
    await computeSeason(selectedSeason);
    loading = false;
  }

  $: champion = finalStandings.length ? finalStandings[0] : null;
  $: biggestLoser = finalStandings.length ? finalStandings[finalStandings.length - 1] : null;

  onMount(loadAll);
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="head-row">
      <div>
        <div class="eyebrow">Honors · Season {selectedSeason}</div>
        <h1 class="page-title">Honor Hall</h1>
        <p class="page-sub">Final placements derived from the playoff window.</p>
      </div>
      <div>
        <label for="season-select" class="visually-hidden">Season</label>
        <select id="season-select" on:change={onSeasonChange} value={selectedSeason} data-testid="honor-season-select">
          {#each seasons as s}<option value={s.season ?? s.league_id}>{s.season ?? s.name}</option>{/each}
        </select>
      </div>
    </div>
  </header>

  {#if loading}
    <SkeletonLoader variant="row" count={8} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="honor hall" />
  {:else}
    <section class="bento">
      {#if champion}
        <div class="bento-card champion-card" data-testid="champion-card">
          <div class="card-corner"><span class="rank-tag num">#1</span></div>
          <div class="champion-trophy">🏆</div>
          <div class="card-eyebrow">Champion</div>
          <img class="champion-avatar" src={avatarOrPh(champion.avatar, champion.team_name)} alt={champion.team_name} />
          <div class="champion-name">{champion.team_name}</div>
          <div class="champion-owner">{#if champion.owner_name}{champion.owner_name} · {/if}Seed #{champion.seed ?? '—'}</div>
        </div>
      {/if}

      {#if biggestLoser && biggestLoser !== champion}
        <div class="bento-card loser-card" data-testid="biggest-loser-card">
          <div class="card-corner"><span class="rank-tag num">#{biggestLoser.rank ?? finalStandings.length}</span></div>
          <div class="loser-icon">😵‍💫</div>
          <div class="card-eyebrow">Biggest Loser</div>
          <img class="champion-avatar" src={avatarOrPh(biggestLoser.avatar, biggestLoser.team_name)} alt={biggestLoser.team_name} />
          <div class="champion-name dim">{biggestLoser.team_name}</div>
          <div class="champion-owner">{#if biggestLoser.owner_name}{biggestLoser.owner_name} · {/if}Seed #{biggestLoser.seed ?? '—'}</div>
        </div>
      {/if}

      {#if finalsMvp}
        <div class="bento-card mvp-card" data-testid="finals-mvp-card">
          <div class="card-eyebrow">Finals MVP</div>
          <img class="mvp-headshot" src={playerHeadshot(finalsMvp.playerId) || avatarOrPh(finalsMvp.roster_meta?.team_avatar, finalsMvp.playerName)} alt={finalsMvp.playerName} on:error={(e) => (e.currentTarget.src = avatarOrPh(finalsMvp.roster_meta?.team_avatar, finalsMvp.playerName))} />
          <div class="mvp-name">{finalsMvp.playerName ?? '—'}</div>
          <div class="mvp-pts num">{fmt(finalsMvp.points)}<span class="pts-suffix"> PTS</span></div>
          <div class="mvp-sub">{finalsMvp.roster_meta?.owner_name ?? `Roster ${finalsMvp.rosterId ?? '—'}`}</div>
        </div>
      {/if}

      {#if playoffsMvp}
        <div class="bento-card mvp-card" data-testid="playoffs-mvp-card">
          <div class="card-eyebrow">Playoffs MVP</div>
          <img class="mvp-headshot" src={playerHeadshot(playoffsMvp.playerId) || avatarOrPh(playoffsMvp.roster_meta?.team_avatar, playoffsMvp.playerName)} alt={playoffsMvp.playerName} on:error={(e) => (e.currentTarget.src = avatarOrPh(playoffsMvp.roster_meta?.team_avatar, playoffsMvp.playerName))} />
          <div class="mvp-name">{playoffsMvp.playerName ?? '—'}</div>
          <div class="mvp-pts num">{fmt(playoffsMvp.points)}<span class="pts-suffix"> PTS</span></div>
          <div class="mvp-sub">{playoffsMvp.roster_meta?.owner_name ?? `Roster ${playoffsMvp.rosterId ?? '—'}`}</div>
        </div>
      {/if}

      {#if regularMvp}
        <div class="bento-card mvp-card" data-testid="regular-mvp-card">
          <div class="card-eyebrow">Regular Season MVP</div>
          <img class="mvp-headshot" src={playerHeadshot(regularMvp.playerId) || avatarOrPh(regularMvp.roster_meta?.team_avatar, regularMvp.playerName)} alt={regularMvp.playerName} on:error={(e) => (e.currentTarget.src = avatarOrPh(regularMvp.roster_meta?.team_avatar, regularMvp.playerName))} />
          <div class="mvp-name">{regularMvp.playerName ?? '—'}</div>
          <div class="mvp-pts num">{fmt(regularMvp.points)}<span class="pts-suffix"> PTS</span></div>
          <div class="mvp-sub">{regularMvp.roster_meta?.owner_name ?? `Roster ${regularMvp.rosterId ?? '—'}`}</div>
        </div>
      {/if}
    </section>

    <section class="block">
      <div class="block-head"><h2 class="block-title">Final Standings</h2><span class="block-sub">Playoff results · champion pinned</span></div>
      {#if finalStandings.length}
        <ol class="standings-list" data-testid="honor-standings-list">
          {#each finalStandings as row, idx (row.rosterId)}
            <li class="standings-row" class:gold={row.rank === 1}>
              <div class="rank-col num">{row.rank}{#if placeEmoji(row.rank)}<span class="medal">{placeEmoji(row.rank)}</span>{/if}</div>
              <img class="team-avatar small" src={avatarOrPh(row.avatar, row.team_name)} alt={row.team_name} />
              <div class="team-meta"><div class="team-name">{row.team_name}</div><div class="team-owner">{row.owner_name ?? `Roster ${row.rosterId}`}</div></div>
              <div class="seed-col"><span class="num">#{row.seed ?? '—'}</span><span class="seed-label">Seed</span></div>
            </li>
          {/each}
        </ol>
      {:else}<div class="empty-card">No standings available.</div>{/if}
    </section>
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .head-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; flex-wrap: wrap; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; text-transform: uppercase; margin: 0.4rem 0 0.5rem; }
  .page-sub { color: var(--text-secondary); max-width: 60ch; }

  .bento { display: grid; grid-template-columns: 2fr 1fr 1fr; grid-template-rows: auto auto; gap: 0.85rem; margin-bottom: 2rem; }
  .bento-card { position: relative; padding: 1.75rem 1.5rem; background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; transition: box-shadow var(--t-fast); }
  /* No hover effect on non-champion cards — they stay flat. The champion
     card's hover shadow rule lives below. */

  /* Only the Champion card keeps its gold treatment. Every other bento
     card (Biggest Loser + the three MVP cards) is rendered as a neutral
     surface — no tint, no glow, no hover lift — per design feedback. */
  .champion-card {
    grid-row: span 2;
    border-color: var(--gold);
    border-left: 4px solid var(--gold);
    background:
      radial-gradient(620px 220px at 100% 0%, rgba(245, 180, 0, 0.22), transparent 60%),
      linear-gradient(180deg, var(--surface-1), var(--surface-2));
    display: flex; flex-direction: column; align-items: flex-start; justify-content: center;
    min-height: 320px;
  }
  /* No hover state on the champion card — it stays static even on mouseover. */
  .champion-trophy { font-size: 4rem; margin-bottom: 0.5rem; line-height: 1; }

  .loser-card { /* neutral — no tint or glow */ }
  .loser-icon { font-size: 2rem; margin-bottom: 0.4rem; line-height: 1; }

  .mvp-card { /* neutral — no tint or glow */ }

  .card-corner { position: absolute; top: 1rem; right: 1rem; }
  .rank-tag { font-size: 1.4rem; color: var(--text-tertiary); }
  .card-eyebrow { font-family: var(--font-body); font-weight: 800; text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.72rem; color: var(--text-tertiary); margin-bottom: 0.75rem; }
  .mvp-pts { color: var(--text-primary); }

  .card-corner { position: absolute; top: 1rem; right: 1rem; }
  .rank-tag { font-size: 1.4rem; color: var(--text-tertiary); }
  .card-eyebrow { font-family: var(--font-body); font-weight: 800; text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.72rem; color: var(--text-tertiary); margin-bottom: 0.75rem; }
  .card-eyebrow.accent { color: var(--accent); }
  .card-eyebrow.brand { color: var(--brand); }
  .card-eyebrow.win { color: var(--win); }
  .mvp-pts.brand { color: var(--brand); }
  .mvp-pts.win { color: var(--win); }
  .champion-avatar { width: 80px; height: 80px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); margin-bottom: 0.85rem; }
  .champion-name { font-family: var(--font-display); font-size: clamp(1.5rem, 3vw, 2.4rem); line-height: 1; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.5rem; word-break: break-word; }
  .champion-name.dim { color: var(--text-secondary); font-size: 1.6rem; }
  .champion-owner { color: var(--text-secondary); font-size: 0.88rem; }
  .mvp-card { display: flex; flex-direction: column; align-items: flex-start; }
  .mvp-headshot { width: 64px; height: 64px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); margin-bottom: 0.6rem; }
  .mvp-name { font-family: var(--font-display); font-size: 1.3rem; text-transform: uppercase; letter-spacing: 0.03em; line-height: 1; margin-bottom: 0.3rem; }
  .mvp-pts { font-size: 1.5rem; color: var(--accent); line-height: 1; margin-bottom: 0.3rem; }
  .pts-suffix { font-family: var(--font-body); font-size: 0.65rem; font-weight: 800; letter-spacing: 0.2em; color: var(--text-tertiary); }
  .mvp-sub { color: var(--text-tertiary); font-size: 0.78rem; }

  .block { background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; }
  .block-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); gap: 1rem; }
  .block-title { font-family: var(--font-display); font-size: 1.3rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .block-sub { color: var(--text-tertiary); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 700; }

  .standings-list { list-style: none; margin: 0; padding: 0; }
  .standings-row { display: grid; grid-template-columns: 70px 56px 1fr auto; gap: 1rem; align-items: center; padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border-subtle); transition: background var(--t-fast); }
  .standings-row:last-child { border-bottom: none; }
  .standings-row:hover { background: rgba(255, 255, 255, 0.03); }
  .standings-row.gold { background: linear-gradient(90deg, rgba(245, 180, 0, 0.08), transparent); border-left: 3px solid var(--gold); padding-left: calc(1.25rem - 3px); }
  .rank-col { font-size: 1.4rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem; }
  .medal { font-family: var(--font-body); font-size: 1rem; }
  .team-avatar.small { width: 56px; height: 56px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); }
  .team-meta { min-width: 0; }
  .team-name { font-family: var(--font-display); font-size: 1.2rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-primary); line-height: 1.15; }
  .team-owner { color: var(--text-tertiary); font-size: 0.8rem; margin-top: 0.2rem; }
  .seed-col { text-align: right; display: flex; flex-direction: column; align-items: flex-end; }
  .seed-col .num { font-size: 1.2rem; color: var(--accent); }
  .seed-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.15em; color: var(--text-tertiary); font-weight: 700; }
  .empty-card { padding: 1.5rem; text-align: center; color: var(--text-secondary); }

  @media (max-width: 980px) {
    .bento { grid-template-columns: 1fr 1fr; grid-template-rows: auto; }
    .champion-card { grid-row: span 1; grid-column: span 2; }
  }
  @media (max-width: 720px) {
    .page { padding: 1.75rem 0 3rem; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .head-row { flex-direction: column; align-items: stretch; }
    .head-row > div:last-child { display: flex; }
    .head-row select { flex: 1; min-width: 0; }
    .block-head { padding: 0.85rem 1rem; }
    .block-title { font-size: 1.05rem; }
  }
  @media (max-width: 600px) {
    .bento { grid-template-columns: 1fr; }
    .champion-card { grid-column: span 1; min-height: auto; }
    .champion-trophy { font-size: 3rem; }
    .standings-row { grid-template-columns: 44px 40px 1fr auto; padding: 0.65rem 0.75rem; gap: 0.5rem; }
    .team-avatar.small { width: 40px; height: 40px; }
    .team-name { font-size: 0.95rem; }
    .team-owner { font-size: 0.72rem; }
    .seed-col .num { font-size: 1rem; }
  }
</style>
