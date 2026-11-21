<!-- src/routes/honor-hall/+page.svelte (client-side fetched, simplified final standings) -->
<script>
  import { onMount, afterUpdate } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getSeasonsChain, BASE_LEAGUE_ID, getPlayersNba, playerHeadshot, pickActiveLeague } from '$lib/api';
  import { computeStandingsForLeague, aggregatePlayerPoints } from '$lib/compute';
  import SkeletonLoader from '$lib/components/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import { formatNumber, avatarOrPlaceholder, playerDisplayName } from '$lib/utils/format';

  let loading = true;
  let error = null;
  let seasons = [];
  let selectedSeason = null;
  let finalStandings = []; // for current season selection
  let finalsMvp = null;
  let playoffsMvp = null;
  let regularMvp = null;
  let playersMap = {};
  let bracketData = { winners: [], losers: [], rosterMap: {}, finalSeeds: {}, playoffStart: 0, playoffTeams: 0, scoresByWeek: {} };
  let bracketTrackRefs = {};
  let bracketMatchRefs = {};
  let bracketConnectorPaths = { winners: [], losers: [] };

  // Stash season results so dropdown switching is instant
  let cache = {}; // season -> all computed season honors + both brackets

  function placeEmoji(rank) {
    if (rank === 1) return '🏆'; if (rank === 2) return '🥈'; if (rank === 3) return '🥉'; return '';
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
      bracketData = cache[cacheKey].bracketData;
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

    const scoresByWeek = {};
    for (const [week, entries] of Object.entries(collected)) {
      scoresByWeek[week] = {};
      for (const entry of entries || []) {
        const rosterId = String(entry.roster_id ?? entry.rosterId ?? '');
        if (!rosterId) continue;
        const score = entry.__final_score != null
          ? Number(entry.__final_score)
          : Array.isArray(entry.starters_points)
            ? entry.starters_points.reduce((sum, value) => sum + (Number(value) || 0), 0)
            : null;
        if (score != null && Number.isFinite(score)) scoresByWeek[week][rosterId] = score;
      }
    }
    const nextBracketData = {
      winners: standings.winnersBracket || [],
      losers: standings.losersBracket || [],
      rosterMap: standings.rosterMap || {},
      finalSeeds: Object.fromEntries(finalList.map((row, index) => [String(row.rosterId), Number(row.rank) || index + 1])),
      playoffStart,
      playoffTeams: playoffTeamCount,
      scoresByWeek
    };
    const result = {
      finalStandings: finalList,
      finalsMvp: fm ? { ...fm, playerName: playerDisplayName(playersMap, fm.playerId), roster_meta: standings.rosterMap[fm.rosterId] } : null,
      playoffsMvp: pm ? { ...pm, playerName: playerDisplayName(playersMap, pm.playerId), roster_meta: standings.rosterMap[pm.rosterId] } : null,
      regularMvp: om ? { ...om, playerName: playerDisplayName(playersMap, om.playerId), roster_meta: standings.rosterMap[om.rosterId] } : null,
      bracketData: nextBracketData
    };
    cache[cacheKey] = result;
    finalStandings = result.finalStandings;
    finalsMvp = result.finalsMvp;
    playoffsMvp = result.playoffsMvp;
    regularMvp = result.regularMvp;
    bracketData = result.bracketData;
  }

  function bracketRounds(matches) {
    const grouped = {};
    for (const match of matches || []) {
      const round = Number(match.r) || 1;
      if (!grouped[round]) grouped[round] = [];
      grouped[round].push(match);
    }
    return Object.keys(grouped).map(Number).sort((a, b) => a - b).map((round) => ({
      round,
      matches: grouped[round].slice().sort((a, b) => (Number(a.m) || 0) - (Number(b.m) || 0))
    }));
  }

  function bracketTeam(rosterId) {
    return rosterId == null ? null : bracketData.rosterMap[String(rosterId)] || null;
  }

  function bracketSeed(rosterId) {
    const finalPlace = bracketData.finalSeeds?.[String(rosterId)];
    return finalPlace ? `#${finalPlace}` : '—';
  }

  function bracketScore(round, rosterId) {
    if (rosterId == null) return null;
    const week = Number(bracketData.playoffStart) + Number(round) - 1;
    const value = bracketData.scoresByWeek?.[String(week)]?.[String(rosterId)];
    return Number.isFinite(Number(value)) ? formatNumber(Number(value)) : '—';
  }

  function bracketMatchesForDisplay(bracket) {
    const matches = bracketMatchesForDisplay(bracket);
    if (bracket.type === 'consolation') return matches.filter((match) => Number(match.p) > 1);
    if (bracket.type === 'winners') return matches.filter((match) => Number(match.p) <= 1);
    return matches;
  }

  function bracketRoundLabel(round) {
    return ({ 1: 'ROUND 1', 2: 'ROUND 2', 3: 'FINALS' })[Number(round)] || `ROUND ${round}`;
  }

  function bracketRoundWeek(round) {
    const week = Number(bracketData.playoffStart) + Number(round) - 1;
    return Number.isFinite(week) && week > 0 ? `(Week ${week})` : '';
  }

  function bracketMainTitle(round, bracketType, matches) {
    const mainMatches = (matches || []).filter((match) => !isConsolationMatch(match, bracketType));
    if (!mainMatches.length) return '';
    if (bracketType === 'consolation') {
      if (round === 2) return '5th–8th Place Qualifiers';
      if (round >= 3) return '5th–8th Place Games';
      return 'Consolation Games';
    }
    if (round === 1) return bracketType === 'losers' ? 'Toilet Bowl Quarterfinals' : 'Championship Quarterfinals';
    if (round === 2) {
      if (bracketType === 'losers') return '9th/10th Place Game & Toilet Bowl Semifinals';
      return 'Championship Semifinals';
    }
    if (round >= 3) return bracketType === 'losers' ? 'Toilet Bowl Finals' : 'Championship & 3rd/4th Place';
    return '';
  }

  function bracketMatchKey(match) {
    return `${Number(match.r) || 1}-${match.m ?? 'x'}-${match.p ?? 'x'}`;
  }

  function bracketMatchPlacement(match) {
    const places = [match.t1, match.t2]
      .map((rosterId) => Number(bracketData.finalSeeds?.[String(rosterId)]))
      .filter(Number.isFinite);
    return places.length ? Math.min(...places) : Number(match.m) || 0;
  }

  function bracketMatchOrder(match, bracketType) {
    // Sort finals and the Week 2 placement qualifiers by the final places
    // their teams are playing toward, not by Sleeper's matchup ID.
    if ((bracketType === 'winners' || bracketType === 'consolation') && Number(match.r) >= 2) {
      return bracketMatchPlacement(match);
    }
    return Number(match.m) || 0;
  }

  function hasBracketFollowup(matches, match, rosterId) {
    if (rosterId == null) return false;
    const round = Number(match.r) || 1;
    return (matches || []).some((candidate) =>
      (Number(candidate.r) || 1) > round &&
      [candidate.t1, candidate.t2].some((id) => String(id) === String(rosterId))
    );
  }

  function isConsolationMatch(match, bracketType, matches = []) {
    const round = Number(match.r) || 1;
    if (bracketType === 'losers') {
      if (round === 2) {
        // Only the two games between Week 1 quarterfinal losers and seeds
        // 13/14 are Toilet Bowl semifinals. The QF winners' 9th/10th game
        // stays in the main round column.
        const priorWinners = new Set(
          matches
            .filter((candidate) => (Number(candidate.r) || 1) === 1)
            .flatMap((candidate) => candidate.w == null ? [] : [String(candidate.w)])
        );
        return ![match.t1, match.t2].every(
          (rosterId) => rosterId != null && priorWinners.has(String(rosterId))
        );
      }
      // Both Week 3 Toilet Bowl games are finals: 11th/12th and the
      // Toilet Bowl Championship. Neither is a separate consolation group.
      return false;
    }
    return Number(match.p) > 1;
  }

  function bracketMatchLabel(match, round, matches, bracketType) {
    const placement = Number(match.p);
    if (bracketType === 'losers') {
      if (round === 1) return 'Toilet Bowl Quarterfinal';
      if (round === 2) {
        // The two round-1 winners play for 9th/10th. The other games
        // feed into the 11th/12th game or the Toilet Bowl Championship.
        const priorWinners = new Set(
          (matches || [])
            .filter((candidate) => (Number(candidate.r) || 1) === 1)
            .flatMap((candidate) => candidate.w == null ? [] : [String(candidate.w)])
        );
        const bothAdvancedAsWinners = [match.t1, match.t2].every(
          (rosterId) => rosterId != null && priorWinners.has(String(rosterId))
        );
        return bothAdvancedAsWinners ? '9th/10th Place Game' : 'Toilet Bowl Semifinal';
      }
      if (round >= 3) {
        const places = [match.t1, match.t2]
          .map((rosterId) => Number(bracketData.finalSeeds?.[String(rosterId)]))
          .filter(Number.isFinite).sort((a, b) => a - b);
        if (places[0] === 9 && places[1] === 10) return '9th/10th Place Game';
        if (places[0] === 11 && places[1] === 12) return '11th/12th Place Game';
        if (places[0] === 13 && places[1] === 14) return 'Toilet Bowl Championship';
        return placement === 1 ? 'Toilet Bowl Championship' : 'Placement Game';
      }
    }

    if (bracketType === 'winners' || bracketType === 'consolation') {
      if (round === 3) {
        const places = [match.t1, match.t2]
          .map((rosterId) => Number(bracketData.finalSeeds?.[String(rosterId)]))
          .filter(Number.isFinite).sort((a, b) => a - b);
        const pair = places.join('-');
        return ({
          '1-2': 'Championship',
          '3-4': '3rd Place',
          '5-6': '5th Place',
          '7-8': '7th Place'
        })[pair] || ({ 1: 'Championship', 2: '3rd Place', 3: '5th Place', 4: '7th Place' })[placement] || 'Placement Game';
      }
      if (round === 2 && placement > 1) {
        const firstPlace = bracketMatchPlacement(match);
        return firstPlace <= 6 ? '5th Place Qualifier' : '7th Place Qualifier';
      }
    }
    return bracketRoundLabel(round);
  }

  function bracketConsolationTitle(round, bracketType) {
    if (bracketType === 'winners' && round === 2) return 'Placement Qualifiers';
    if (bracketType === 'losers' && round === 2) return 'Toilet Bowl Semifinals';
    if (bracketType === 'winners' && round === 3) return 'Placement Games';
    if (bracketType === 'losers' && round === 3) return 'Placement Games';
    return 'Consolation Games';
  }

  function setBracketTrackRef(type, element) {
    if (element) bracketTrackRefs[type] = element;
  }

  function setBracketMatchRef(type, match, element) {
    const key = `${type}:${bracketMatchKey(match)}`;
    if (element) bracketMatchRefs[key] = element;
    else delete bracketMatchRefs[key];
  }

  function updateBracketConnectors() {
    const nextPaths = { winners: [], consolation: [], losers: [] };
    for (const type of ['winners', 'consolation', 'losers']) {
      const sourceType = type === 'consolation' ? 'winners' : type;
      const allMatches = bracketData[sourceType] || [];
      const matches = type === 'consolation'
        ? allMatches.filter((match) => Number(match.p) > 1)
        : type === 'winners'
          ? allMatches.filter((match) => Number(match.p) <= 1)
          : allMatches;
      const track = bracketTrackRefs[type];
      if (!track) continue;
      const trackRect = track.getBoundingClientRect();
      for (const match of matches) {
        for (const rosterId of [match.w, match.l]) {
          if (rosterId == null) continue;
          const nextMatch = matches.find((candidate) =>
            (Number(candidate.r) || 1) > (Number(match.r) || 1) &&
            [candidate.t1, candidate.t2].some((id) => String(id) === String(rosterId))
          );
          if (!nextMatch) continue;
          const source = bracketMatchRefs[`${type}:${bracketMatchKey(match)}`];
          const target = bracketMatchRefs[`${type}:${bracketMatchKey(nextMatch)}`];
          if (!source || !target) continue;
          const sourceRows = source.querySelectorAll('.bracket-team');
          const targetRows = target.querySelectorAll('.bracket-team');
          const sourceIndex = String(rosterId) === String(match.t1) ? 0 : 1;
          const targetIndex = String(rosterId) === String(nextMatch.t1) ? 0 : 1;
          const sourceRow = sourceRows[sourceIndex];
          const targetRow = targetRows[targetIndex];
          if (!sourceRow || !targetRow) continue;
          const sourceRect = sourceRow.getBoundingClientRect();
          const targetRect = targetRow.getBoundingClientRect();
          const x1 = sourceRect.right - trackRect.left + track.scrollLeft;
          const y1 = sourceRect.top + sourceRect.height / 2 - trackRect.top + track.scrollTop;
          const x2 = targetRect.left - trackRect.left + track.scrollLeft;
          const y2 = targetRect.top + targetRect.height / 2 - trackRect.top + track.scrollTop;
          const bend = Math.max(18, (x2 - x1) * 0.5);
          nextPaths[type].push({
            d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
            outcome: String(rosterId) === String(match.w) ? 'winner' : 'loser'
          });
        }
      }
    }
    if (JSON.stringify(bracketConnectorPaths) !== JSON.stringify(nextPaths)) bracketConnectorPaths = nextPaths;
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
  afterUpdate(updateBracketConnectors);
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
          <img class="champion-avatar" src={avatarOrPlaceholder(champion.avatar, champion.team_name)} alt={champion.team_name} />
          <div class="champion-name">{champion.team_name}</div>
          <div class="champion-owner">{#if champion.owner_name}{champion.owner_name} · {/if}Seed #{champion.seed ?? '—'}</div>
        </div>
      {/if}

      {#if biggestLoser && biggestLoser !== champion}
        <div class="bento-card loser-card" data-testid="biggest-loser-card">
          <div class="card-corner"><span class="rank-tag num">#{biggestLoser.rank ?? finalStandings.length}</span></div>
          <div class="loser-icon">😵‍💫</div>
          <div class="card-eyebrow">Biggest Loser</div>
          <img class="champion-avatar" src={avatarOrPlaceholder(biggestLoser.avatar, biggestLoser.team_name)} alt={biggestLoser.team_name} />
          <div class="champion-name dim">{biggestLoser.team_name}</div>
          <div class="champion-owner">{#if biggestLoser.owner_name}{biggestLoser.owner_name} · {/if}Seed #{biggestLoser.seed ?? '—'}</div>
        </div>
      {/if}

      {#if finalsMvp}
        <div class="bento-card mvp-card" data-testid="finals-mvp-card">
          <div class="card-eyebrow">Finals MVP</div>
          <img class="mvp-headshot" src={playerHeadshot(finalsMvp.playerId) || avatarOrPlaceholder(finalsMvp.roster_meta?.team_avatar, finalsMvp.playerName)} alt={finalsMvp.playerName} on:error={(e) => (e.currentTarget.src = avatarOrPlaceholder(finalsMvp.roster_meta?.team_avatar, finalsMvp.playerName))} />
          <div class="mvp-name">{finalsMvp.playerName ?? '—'}</div>
          <div class="mvp-pts num">{formatNumber(finalsMvp.points)}<span class="pts-suffix"> PTS</span></div>
          <div class="mvp-sub">{finalsMvp.roster_meta?.owner_name ?? `Roster ${finalsMvp.rosterId ?? '—'}`}</div>
        </div>
      {/if}

      {#if playoffsMvp}
        <div class="bento-card mvp-card" data-testid="playoffs-mvp-card">
          <div class="card-eyebrow">Playoffs MVP</div>
          <img class="mvp-headshot" src={playerHeadshot(playoffsMvp.playerId) || avatarOrPlaceholder(playoffsMvp.roster_meta?.team_avatar, playoffsMvp.playerName)} alt={playoffsMvp.playerName} on:error={(e) => (e.currentTarget.src = avatarOrPlaceholder(playoffsMvp.roster_meta?.team_avatar, playoffsMvp.playerName))} />
          <div class="mvp-name">{playoffsMvp.playerName ?? '—'}</div>
          <div class="mvp-pts num">{formatNumber(playoffsMvp.points)}<span class="pts-suffix"> PTS</span></div>
          <div class="mvp-sub">{playoffsMvp.roster_meta?.owner_name ?? `Roster ${playoffsMvp.rosterId ?? '—'}`}</div>
        </div>
      {/if}

      {#if regularMvp}
        <div class="bento-card mvp-card" data-testid="regular-mvp-card">
          <div class="card-eyebrow">Regular Season MVP</div>
          <img class="mvp-headshot" src={playerHeadshot(regularMvp.playerId) || avatarOrPlaceholder(regularMvp.roster_meta?.team_avatar, regularMvp.playerName)} alt={regularMvp.playerName} on:error={(e) => (e.currentTarget.src = avatarOrPlaceholder(regularMvp.roster_meta?.team_avatar, regularMvp.playerName))} />
          <div class="mvp-name">{regularMvp.playerName ?? '—'}</div>
          <div class="mvp-pts num">{formatNumber(regularMvp.points)}<span class="pts-suffix"> PTS</span></div>
          <div class="mvp-sub">{regularMvp.roster_meta?.owner_name ?? `Roster ${regularMvp.rosterId ?? '—'}`}</div>
        </div>
      {/if}
    </section>

    <section class="block bracket-section" data-testid="season-brackets">
      <div class="block-head"><h2 class="block-title">Season Brackets</h2><span class="block-sub">{bracketData.playoffTeams}-team championship field</span></div>
      <div class="bracket-grid">
        {#each [{ key: 'winners', title: 'Championship Playoff Bracket', type: 'winners' }, { key: 'winners', title: 'Consolation Bracket', type: 'consolation' }, { key: 'losers', title: 'Toilet Bowl Bracket', type: 'losers' }] as bracket}
          <div class="bracket-column" data-testid={bracket.type === 'winners' ? 'championship-bracket' : 'toilet-bowl-bracket'}>
            <h3 class="bracket-title">{bracket.title}</h3>
            {#if bracketMatchesForDisplay(bracket).length}
              <div class="bracket-track" bind:this={bracketTrackRefs[bracket.type]} on:scroll={updateBracketConnectors}>
                <svg class="bracket-connectors" aria-hidden="true" width={bracketTrackRefs[bracket.type]?.scrollWidth || 1000} height={bracketTrackRefs[bracket.type]?.scrollHeight || 600}>
                  <defs>
                    <marker id={`winner-arrow-${bracket.type}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3.5 L0,7 z" class="connector-arrow-winner" /></marker>
                    <marker id={`loser-arrow-${bracket.type}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3.5 L0,7 z" class="connector-arrow-loser" /></marker>
                  </defs>
                  {#each bracketConnectorPaths[bracket.type] || [] as path, pathIndex}
                    <path d={path.d} class:connector-winner={path.outcome === 'winner'} class:connector-loser={path.outcome === 'loser'} marker-end={`url(#${path.outcome}-arrow-${bracket.type})`} />
                  {/each}
                </svg>
                {#each bracketRounds(bracketMatchesForDisplay(bracket)) as round, roundIndex (round.round)}
                  <div class="bracket-round">
                    <h4 class="bracket-round-title"><span>{bracketRoundLabel(round.round)}</span>{#if Number(round.round) === 2}<small>Re-seed</small>{/if}<small>{bracketRoundWeek(round.round)}</small></h4>
                    <div class="bracket-round-games" class:later-round={roundIndex > 0}>
                      {#if round.matches.some(match => !false)}
                        <h5 class="bracket-main-title">{bracketMainTitle(round.round, bracket.type, bracketMatchesForDisplay(bracket))}</h5>
                      {/if}
                      {#each round.matches.filter(match => !false).slice().sort((a, b) => bracketMatchOrder(a, bracket.type) - bracketMatchOrder(b, bracket.type)) as match (bracketMatchKey(match))}
                        <div class="bracket-match" class:bracket-final={bracket.type === 'winners' && Number(match.p) === 1} bind:this={bracketMatchRefs[`${bracket.type}:${bracketMatchKey(match)}`]}>
                          <div class="bracket-match-label bracket-match-tag">{bracketMatchLabel(match, round.round, bracketMatchesForDisplay(bracket), bracket.type === 'consolation' ? 'winners' : bracket.type)}</div>
                          {#each [match.t1, match.t2] as rosterId}
                            {#if rosterId != null}
                              {@const team = bracketTeam(rosterId)}
                              <div class="bracket-team" class:match-winner={String(rosterId) === String(match.w)}>
                                <span class="bracket-seed num">{bracketSeed(rosterId)}</span>
                                <img src={avatarOrPlaceholder(team?.team_avatar || team?.owner_avatar, team?.team_name || `Roster ${rosterId}`)} alt={team?.team_name || `Roster ${rosterId}`} />
                                <span class="bracket-team-name">{team?.team_name || `Roster ${rosterId}`}</span>
                                <span class="bracket-score num">{bracketScore(round.round, rosterId)}</span>
                              </div>
                            {:else}
                              <div class="bracket-team bracket-empty"><span class="bracket-seed">—</span><span>—</span><span class="bracket-score">—</span></div>
                            {/if}
                          {/each}
                        </div>
                      {/each}
                    </div>
                    {#if round.matches.some(match => false)}
                      <div class="bracket-consolation-group">
                        <h5 class="bracket-consolation-title">{bracketConsolationTitle(round.round, bracket.type)}</h5>
                        <div class="bracket-consolation-games">
                          {#each round.matches.filter(match => false).slice().sort((a, b) => bracketMatchOrder(a, bracket.type) - bracketMatchOrder(b, bracket.type)) as match (bracketMatchKey(match))}
                            <div class="bracket-match bracket-match-consolation" bind:this={bracketMatchRefs[`${bracket.type}:${bracketMatchKey(match)}`]}>
                              <div class="bracket-match-label bracket-match-tag">{bracketMatchLabel(match, round.round, bracketMatchesForDisplay(bracket), bracket.type === 'consolation' ? 'winners' : bracket.type)}</div>
                              {#each [match.t1, match.t2] as rosterId}
                                {#if rosterId != null}
                                  {@const team = bracketTeam(rosterId)}
                                  <div class="bracket-team" class:match-winner={String(rosterId) === String(match.w)}>
                                    <span class="bracket-seed num">{bracketSeed(rosterId)}</span>
                                    <img src={avatarOrPlaceholder(team?.team_avatar || team?.owner_avatar, team?.team_name || `Roster ${rosterId}`)} alt={team?.team_name || `Roster ${rosterId}`} />
                                    <span class="bracket-team-name">{team?.team_name || `Roster ${rosterId}`}</span>
                                    <span class="bracket-score num">{bracketScore(round.round, rosterId)}</span>
                                  </div>
                                {:else}
                                  <div class="bracket-team bracket-empty"><span class="bracket-seed">—</span><span>—</span><span class="bracket-score">—</span></div>
                                {/if}
                              {/each}
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}<div class="empty-card">Bracket results are not available for this season.</div>{/if}
          </div>
        {/each}
      </div>
      <p class="bracket-note">Team numbers reflect final season placement. The consolation bracket is separate from both the championship playoffs and the Toilet Bowl.</p>
    </section>
    <section class="block">
      <div class="block-head"><h2 class="block-title">Final Standings</h2><span class="block-sub">Playoff results · champion pinned</span></div>
      {#if finalStandings.length}
        <ol class="standings-list" data-testid="honor-standings-list">
          {#each finalStandings as row, idx (row.rosterId)}
            <li class="standings-row" class:gold={row.rank === 1}>
              <div class="rank-col num">{row.rank}{#if placeEmoji(row.rank)}<span class="medal">{placeEmoji(row.rank)}</span>{/if}</div>
              <img class="team-avatar small" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
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

  .bracket-section { margin-bottom: 1.25rem; }
  .bracket-grid { display: grid; grid-template-columns: 1fr; gap: 1.6rem; padding: 1rem; }
  .bracket-column { min-width: 0; width: 100%; }
  .bracket-title { margin: 0 0 0.9rem; font-family: var(--font-display); font-size: 1.15rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .bracket-track { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: clamp(0.45rem, 1.5vw, 1.25rem); width: 100%; box-sizing: border-box; overflow: visible; padding: 0.2rem 0 1rem; position: relative; }
  .bracket-connectors { position: absolute; inset: 0 auto auto 0; z-index: 0; overflow: visible; pointer-events: none; }
  .bracket-connectors path { fill: none; stroke-width: 1.7; }
  .bracket-connectors .connector-winner { stroke: var(--accent); opacity: 0.9; }
  .bracket-connectors .connector-loser { stroke: var(--text-tertiary); opacity: 0.62; stroke-dasharray: 4 4; }
  .bracket-connectors .connector-arrow-winner { fill: var(--accent); }
  .bracket-connectors .connector-arrow-loser { fill: var(--text-tertiary); }
  .bracket-round { min-width: 0; width: 100%; display: flex; flex-direction: column; }
  .bracket-round-title { display: flex; flex-direction: column; align-items: center; gap: 0.12rem; color: var(--text-tertiary); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 0.55rem; text-align: center; }
  .bracket-round-title small { color: var(--text-tertiary); font-size: 0.9em; font-weight: 400; text-transform: none; letter-spacing: 0; }
  .bracket-main-title { margin: 0 0 0.6rem; color: var(--text-secondary); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; text-align: center; }
  .bracket-round-games { flex: 1; display: flex; flex-direction: column; justify-content: space-around; gap: 1.15rem; }
  .bracket-round-games.later-round { justify-content: space-around; padding: 2rem 0; }
  .bracket-match { position: relative; z-index: 1; display: flex; flex-direction: column; width: 100%; max-width: none; box-sizing: border-box; border: 0; border-radius: 0; padding: 0; background: transparent; min-width: 0; }
  .bracket-consolation-group { margin-top: 1.1rem; padding-top: 0.8rem; border-top: 1px dashed var(--border-subtle); }
  .bracket-consolation-title { margin: 0 0 0.6rem; color: var(--accent); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; text-align: center; }
  .bracket-consolation-games { display: flex; flex-direction: column; gap: 1rem; }
  .bracket-match-consolation { background: transparent; }
  .bracket-match-consolation .bracket-match-label { color: var(--text-secondary); }
  .bracket-round:not(:last-child) .bracket-match::after { content: none; }
  .bracket-team { display: grid; grid-template-columns: 18px 24px minmax(0, 1fr) auto; align-items: center; gap: 0.28rem; min-height: 48px; padding: 0.32rem; box-sizing: border-box; color: var(--text-secondary); font-size: 0.72rem; background: var(--surface-2); }
  .bracket-team:first-of-type { border-radius: 0.7rem 0.7rem 0.18rem 0.18rem; margin-bottom: 2px; }
  .bracket-team:nth-of-type(2) { border-radius: 0.18rem 0.18rem 0.7rem 0.7rem; }
  .bracket-seed { color: var(--text-tertiary); font-size: 0.65rem; text-align: center; white-space: nowrap; }
  .bracket-team img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; background: var(--surface-1); }
  .bracket-team-name { overflow-wrap: anywhere; line-height: 1.12; min-width: 0; }
  .bracket-score { color: var(--text-primary); font-size: 0.76rem; white-space: nowrap; }
  .bracket-team.match-winner { color: var(--text-primary); font-weight: 700; }
  .bracket-team.match-winner .bracket-score, .bracket-team.match-winner .bracket-seed { color: var(--accent); }
  .bracket-empty { opacity: 0.45; }
  .bracket-final .bracket-team { background: linear-gradient(180deg, rgba(245,180,0,.12), var(--surface-2)); }
  .bracket-match-label { order: -1; margin: 0 0 0.35rem; padding: 0; border: 0; color: var(--text-primary); font-size: 0.7rem; font-weight: 650; text-transform: none; letter-spacing: 0; text-align: center; }
  .bracket-match-tag { order: -1; align-self: flex-start; margin: 0 0 0.45rem; padding: 0.2rem 0.55rem; border-radius: 999px; background: var(--surface-2, rgba(255,255,255,0.08)); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
  .bracket-note { margin: 0; padding: 0 1rem 1rem; color: var(--text-tertiary); font-size: 0.72rem; }
  @media (max-width: 700px) {
    .bracket-grid { padding: 0.7rem 0.45rem; gap: 1.5rem; }
    .bracket-track { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem; padding-bottom: 0.5rem; }
    .bracket-round { width: 100%; }
    .bracket-round-title { font-size: 0.62rem; letter-spacing: 0.03em; }
    .bracket-main-title { font-size: 0.55rem; letter-spacing: 0.02em; }
    .bracket-round-games, .bracket-round-games.later-round { padding: 0; gap: 0.8rem; }
    .bracket-match { max-width: none; }
    .bracket-team { grid-template-columns: 13px minmax(0, 1fr) auto; min-height: 43px; gap: 0.18rem; padding: 0.25rem; font-size: 0.61rem; }
    .bracket-team img { width: 18px; height: 18px; grid-column: 2; grid-row: 1; }
    .bracket-seed { grid-column: 1; grid-row: 1; font-size: 0.55rem; }
    .bracket-team-name { grid-column: 1 / 3; grid-row: 2; font-size: 0.59rem; }
    .bracket-score { grid-column: 3; grid-row: 1; font-size: 0.64rem; }
    .bracket-match-label { font-size: 0.58rem; margin-bottom: 0.25rem; }
    .bracket-consolation-title { font-size: 0.56rem; letter-spacing: 0.02em; }
    .bracket-consolation-games { gap: 0.85rem; }
    .bracket-connectors { display: none; }
  }

</style>
