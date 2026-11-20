<!-- src/routes/rosters/+page.svelte — Owner Hub (single-team picker view) -->
<script>
  import { onMount } from 'svelte';
  import { getSeasonsChain, getRosterMapWithOwners, getPlayersNba, getMatchupsForWeek, playerHeadshot, BASE_LEAGUE_ID, pickActiveLeague } from '$lib/api';
  import { computeStandingsForLeague, computeParticipantPoints } from '$lib/compute';
  import { buildOwnerHubs } from '$lib/compute/ownerHubs';
  import { expandPositions } from '$lib/utils/positions';
  import SkeletonLoader from '$lib/components/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';

  let loading = true;
  let error = null;
  let leagueName = null;
  let season = null;
  let rosters = [];                 // [{ rosterId, team_name, ... }] sorted A→Z
  let selectedRosterId = null;      // currently picked team
  let currentSeasonSchedule = {};
  $: selectedSchedule = currentSeasonSchedule[String(selectedRosterId)] || [];

  // Currently selected roster, derived reactively from the picker.
  $: selectedRoster = rosters.find((r) => r.rosterId === selectedRosterId) || null;

  const STARTER_SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL'];

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
    const all = Array.isArray(rawRoster?.players) ? rawRoster.players.slice() : [];
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
    const basic = Array.isArray(p.fantasy_positions) ? p.fantasy_positions : (p.position ? [p.position] : []);
    const positions = expandPositions(basic);
    return { name: fullName, team: p.team || p.team_abbreviation || 'FA', positions, player_id: p.player_id || id };
  }

  function hasAuthoritativeScore(entry) {
    return Boolean(entry && (
      entry.__final_score != null ||
      (Array.isArray(entry.starters) && entry.starters.length > 0 &&
       Array.isArray(entry.starters_points) && entry.starters_points.length === entry.starters.length)
    ));
  }

  async function buildCurrentSeasonSchedule(leagueId, standings, rosterMap) {
    const playoffStart = Number(standings?.playoffStart || 19);
    const completedThrough = Number(standings?.completedThroughWeek ?? 0);
    const lastWeek = Number(standings?.playoffEnd || playoffStart + 2 || 21);
    const completedMatchups = standings?.collectedMatchups || {};
    const weeks = Array.from({ length: Math.max(0, lastWeek) }, (_, i) => i + 1);
    const fetched = [];
    for (let offset = 0; offset < weeks.length; offset += 4) {
      const batch = weeks.slice(offset, offset + 4);
      fetched.push(...await Promise.all(batch.map((week) =>
        getMatchupsForWeek(leagueId, week).catch(() => [])
      )));
    }

    // Completed scores come only from the shared standings calculation,
    // which applies the site-wide week cutoff and starter-only scoring.
    // The live endpoint below is used only to show future schedule opponents.
    const finalRegularSeasonEntries = completedMatchups[String(playoffStart - 1)] || [];
    const finalWeekScores = new Map(finalRegularSeasonEntries
      .filter(hasAuthoritativeScore)
      .map((entry) => [
        String(entry.roster_id ?? entry.rosterId),
        computeParticipantPoints(entry)
      ]));
    const regularSeasonComplete = completedThrough >= playoffStart - 1 &&
      Object.keys(rosterMap).length > 0 &&
      Object.keys(rosterMap).every((rid) => finalWeekScores.has(String(rid)));

    const schedule = Object.fromEntries(Object.keys(rosterMap).map((rid) => [String(rid), []]));
    for (let index = 0; index < weeks.length; index++) {
      const week = weeks[index];
      const liveEntries = Array.isArray(fetched[index]) ? fetched[index] : [];
      const completedEntries = completedMatchups[String(week)] || [];
      const entries = week <= completedThrough && completedEntries.length
        ? completedEntries
        : liveEntries;
      const byMatchup = {};
      for (const entry of entries) {
        if (entry?.matchup_id == null) continue;
        const key = String(entry.matchup_id);
        (byMatchup[key] ||= []).push(entry);
      }

      const completedByMatchup = {};
      for (const entry of completedEntries) {
        if (entry?.matchup_id == null) continue;
        const key = String(entry.matchup_id);
        (completedByMatchup[key] ||= []).push(entry);
      }

      for (const rid of Object.keys(rosterMap)) {
        const mine = entries.find((entry) => String(entry.roster_id ?? entry.rosterId) === String(rid));
        const participants = mine?.matchup_id != null ? (byMatchup[String(mine.matchup_id)] || []) : [];
        const opponent = participants.find((entry) => String(entry.roster_id ?? entry.rosterId) !== String(rid));
        const opponentId = opponent ? String(opponent.roster_id ?? opponent.rosterId) : null;
        const opponentMeta = opponentId ? rosterMap[opponentId] : null;

        // Keep playoff weeks hidden until the final regular-season week has
        // authoritative completed scores for every roster.
        if (week >= playoffStart && !regularSeasonComplete) continue;

        const completedParticipants = mine?.matchup_id != null
          ? (completedByMatchup[String(mine.matchup_id)] || [])
          : [];
        const completedMine = completedParticipants.find((entry) =>
          String(entry.roster_id ?? entry.rosterId) === String(rid)
        );
        const completedOpponent = opponentId
          ? completedParticipants.find((entry) =>
              String(entry.roster_id ?? entry.rosterId) === opponentId
            )
          : null;
        const completed = week <= completedThrough &&
          hasAuthoritativeScore(completedMine) &&
          hasAuthoritativeScore(completedOpponent);

        const minePoints = completed ? computeParticipantPoints(completedMine) : null;
        const opponentPoints = completed ? computeParticipantPoints(completedOpponent) : null;
        let result = null;
        if (completed) {
          result = minePoints > opponentPoints ? 'W' : minePoints < opponentPoints ? 'L' : 'T';
        }

        const completedBye = week <= completedThrough && hasAuthoritativeScore(completedMine) &&
          completedParticipants.length === 1;
        schedule[String(rid)].push({
          week,
          isPlayoff: week >= playoffStart,
          opponentName: opponentMeta?.team_name ||
            (completedBye ? 'Bye' : 'Schedule pending'),
          opponentAvatar: opponentMeta?.team_avatar || opponentMeta?.owner_avatar || null,
          status: completed ? result : completedBye ? 'BYE' : 'UPCOMING',
          score: completed ? `${minePoints.toFixed(1)} – ${opponentPoints.toFixed(1)}` : null,
          result
        });
      }
    }
    return schedule;
  }

  async function loadAll() {
    loading = true;
    error = null;
    try {
      const { seasons } = await getSeasonsChain(BASE_LEAGUE_ID);
      const active = pickActiveLeague(seasons);
      const current = active || (seasons.length ? seasons[seasons.length - 1] : { league_id: BASE_LEAGUE_ID, season: null, name: 'BFA' });
      season = current.season;
      leagueName = current.name;

      const [rosterMap, playersMap, allSeasonResults] = await Promise.all([
        getRosterMapWithOwners(current.league_id),
        getPlayersNba(),
        Promise.all(seasons.map((s) => computeStandingsForLeague(s.league_id).catch(() => null)))
      ]);

      const ownerHubs = buildOwnerHubs(allSeasonResults, seasons, playersMap);
      const currentStandings = allSeasonResults.find((result) => String(result?.leagueId) === String(current.league_id));
      currentSeasonSchedule = await buildCurrentSeasonSchedule(current.league_id, currentStandings, rosterMap);

      // Keep the Best / Toughest matchup callouts focused on owners who are
      // currently in this league, while retaining their full historical H2H.
      const activeTeamsByOwner = new Map();
      for (const meta of Object.values(rosterMap)) {
        const key = String(meta.owner_username || meta.owner_name || '').toLowerCase();
        if (key) activeTeamsByOwner.set(key, meta);
      }
      for (const [ownerKey, hub] of Object.entries(ownerHubs)) {
        const activeOpponents = Object.entries(hub.headToHead || {})
          .filter(([key, record]) => key !== ownerKey && activeTeamsByOwner.has(key) && (record.wins + record.losses + record.ties) > 0)
          .map(([key, record]) => {
            const meta = activeTeamsByOwner.get(key);
            const games = record.wins + record.losses + record.ties;
            return {
              key,
              ...record,
              owner: meta.team_name || record.owner || key,
              avatar: meta.team_avatar || meta.owner_avatar || null,
              games,
              winPct: (record.wins + record.ties * 0.5) / Math.max(1, games)
            };
          });
        hub.activeToughestOpponent = [...activeOpponents].sort((a, b) => a.winPct - b.winPct || b.games - a.games)[0] || null;
        hub.activeFavorableOpponent = [...activeOpponents].sort((a, b) => b.winPct - a.winPct || b.games - a.games)[0] || null;
      }

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

        const ownerHubKey = String(meta.owner_username || meta.owner_name || '').toLowerCase();
        const owner_hub = ownerHubs[ownerHubKey] || null;

        list.push({
          rosterId: rid,
          owner_name: meta.owner_name,
          owner_username: meta.owner_username,
          team_name: meta.team_name,
          team_avatar: meta.team_avatar,
          owner_avatar: meta.owner_avatar,
          _starters, _bench, _taxi,
          owner_hub
        });
      }
      list.sort((a, b) => String(a.team_name || '').localeCompare(String(b.team_name || '')));
      rosters = list;
      // A deep link from the Home page selects the matching team in the
      // existing Owner Hub picker, while keeping the user on this page.
      const requestedRosterId = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('rosterId')
        : null;
      const requestedRoster = requestedRosterId
        ? rosters.find((roster) => String(roster.rosterId) === String(requestedRosterId))
        : null;

      // Prefer the requested team; otherwise default to the alphabetically first team.
      if (requestedRoster) {
        selectedRosterId = requestedRoster.rosterId;
      } else if (rosters.length && !selectedRosterId) {
        selectedRosterId = rosters[0].rosterId;
      }
    } catch (e) {
      console.error('[Rosters] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  onMount(() => { loadAll(); });
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="head-row">
      <div>
        <div class="eyebrow">Owner Hub{#if season} · {season}{/if}</div>
        <h1 class="page-title">Owner Hub</h1>
        <p class="page-sub">Pick a team to see career stats, franchise records, and the current roster.</p>
      </div>
      {#if rosters.length}
        <div class="picker">
          <label for="team-select" class="visually-hidden">Team</label>
          <select
            id="team-select"
            class="team-select"
            bind:value={selectedRosterId}
            data-testid="rosters-team-select"
          >
            {#each rosters as r (r.rosterId)}
              <option value={r.rosterId}>{r.team_name}{r.owner_name ? ` — ${r.owner_name}` : ''}</option>
            {/each}
          </select>
        </div>
      {/if}
    </div>
  </header>

  {#if loading}
    <SkeletonLoader variant="team" count={1} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="rosters" />
  {:else if !selectedRoster}
    <div class="empty-card" data-testid="rosters-empty">No rosters available.</div>
  {:else}
    {@const roster = selectedRoster}
    <article class="team-card rise" data-testid={`team-card-${roster.rosterId}`}>
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
      </div>

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
              <div class="hub-stat" title="Average points scored per regular-season matchup">
                <div class="hub-stat-num">{roster.owner_hub.avgPF.toFixed(1)}</div>
                <div class="hub-stat-label">Avg PF / Game</div>
              </div>
              <div class="hub-stat" title="Average points allowed per regular-season matchup">
                <div class="hub-stat-num">{roster.owner_hub.avgPA.toFixed(1)}</div>
                <div class="hub-stat-label">Avg PA / Game</div>
              </div>
              <div class="hub-stat" title="Career points scored minus points allowed">
                <div class="hub-stat-num">{roster.owner_hub.pointDifferential > 0 ? '+' : ''}{Math.round(roster.owner_hub.pointDifferential).toLocaleString()}</div>
                <div class="hub-stat-label">Point Differential</div>
              </div>
              <div class="hub-stat" title="Average points scored minus points allowed per matchup">
                <div class="hub-stat-num">{roster.owner_hub.avgMargin > 0 ? '+' : ''}{roster.owner_hub.avgMargin.toFixed(1)}</div>
                <div class="hub-stat-label">Avg Margin</div>
              </div>
              <div class="hub-stat" title="Highest single-season PF and the year it happened">
                <div class="hub-stat-num">{Math.round(roster.owner_hub.bestSeasonPF).toLocaleString()}{#if roster.owner_hub.bestSeasonPFSeason}<span class="hub-stat-year"> ’{String(roster.owner_hub.bestSeasonPFSeason).slice(-2)}</span>{/if}</div>
                <div class="hub-stat-label">Best Season PF</div>
              </div>
            </div>
          </div>

          {#if roster.owner_hub.bestSingleGame || roster.owner_hub.highestWeek || roster.owner_hub.biggestBlowoutWin || roster.owner_hub.biggestBlowoutLoss}
            <div class="franchise-records" data-testid={`franchise-records-${roster.rosterId}`}>
              <div class="records-head">
                <div class="records-title">Franchise Records</div>
                <div class="records-sub">Across every season this owner has played</div>
              </div>
              <div class="records-grid">
                {#if roster.owner_hub.bestSingleGame}
                  <div class="record-card">
                    <div class="record-eyebrow">🏀 Best Single Game</div>
                    <div class="record-body">
                      <img class="record-headshot" src={playerHeadshot(roster.owner_hub.bestSingleGame.player_id)} alt={roster.owner_hub.bestSingleGame.player_name} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                      <div class="record-meta">
                        <div class="record-name">{roster.owner_hub.bestSingleGame.player_name}</div>
                        <div class="record-context">W{roster.owner_hub.bestSingleGame.week} · {roster.owner_hub.bestSingleGame.season}</div>
                      </div>
                    </div>
                    <div class="record-stat win">{roster.owner_hub.bestSingleGame.points.toFixed(2)}<span class="record-stat-label"> PTS</span></div>
                  </div>
                {/if}

                {#if roster.owner_hub.bestPlayoffGame}
                  <div class="record-card">
                    <div class="record-eyebrow">🏆 Best Playoff Game</div>
                    <div class="record-body">
                      <img class="record-headshot" src={playerHeadshot(roster.owner_hub.bestPlayoffGame.player_id)} alt={roster.owner_hub.bestPlayoffGame.player_name} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                      <div class="record-meta">
                        <div class="record-name">{roster.owner_hub.bestPlayoffGame.player_name}</div>
                        <div class="record-context">W{roster.owner_hub.bestPlayoffGame.week} · {roster.owner_hub.bestPlayoffGame.season} Playoffs</div>
                      </div>
                    </div>
                    <div class="record-stat win">{roster.owner_hub.bestPlayoffGame.points.toFixed(2)}<span class="record-stat-label"> PTS</span></div>
                  </div>
                {/if}

                {#if roster.owner_hub.highestWeek}
                  <div class="record-card">
                    <div class="record-eyebrow">📈 Highest Weekly Total</div>
                    <div class="record-body">
                      {#if roster.owner_hub.highestWeek.opponent_avatar}
                        <img class="record-team-avatar" src={roster.owner_hub.highestWeek.opponent_avatar} alt={roster.owner_hub.highestWeek.opponent_team ?? ''} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                      {/if}
                      <div class="record-meta">
                        <div class="record-name">vs {roster.owner_hub.highestWeek.opponent_team ?? '—'}</div>
                        <div class="record-context">W{roster.owner_hub.highestWeek.week} · {roster.owner_hub.highestWeek.season}</div>
                      </div>
                    </div>
                    <div class="record-stat win">{roster.owner_hub.highestWeek.points.toFixed(1)}<span class="record-stat-label"> PTS</span></div>
                  </div>
                {/if}

                {#if roster.owner_hub.lowestWeek}
                  <div class="record-card">
                    <div class="record-eyebrow">📉 Lowest Weekly Total</div>
                    <div class="record-body">
                      <div class="record-meta">
                        <div class="record-name">W{roster.owner_hub.lowestWeek.week}</div>
                        <div class="record-context">{roster.owner_hub.lowestWeek.season}</div>
                      </div>
                    </div>
                    <div class="record-stat loss">{roster.owner_hub.lowestWeek.points.toFixed(1)}<span class="record-stat-label"> PTS</span></div>
                  </div>
                {/if}

                {#if roster.owner_hub.biggestBlowoutWin}
                  <div class="record-card">
                    <div class="record-eyebrow">💥 Biggest Blowout (Win)</div>
                    <div class="record-body">
                      {#if roster.owner_hub.biggestBlowoutWin.opponent_avatar}
                        <img class="record-team-avatar" src={roster.owner_hub.biggestBlowoutWin.opponent_avatar} alt={roster.owner_hub.biggestBlowoutWin.opponent_team ?? ''} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                      {/if}
                      <div class="record-meta">
                        <div class="record-name">def. {roster.owner_hub.biggestBlowoutWin.opponent_team ?? '—'}</div>
                        <div class="record-context">{roster.owner_hub.biggestBlowoutWin.my_score.toFixed(1)} – {roster.owner_hub.biggestBlowoutWin.opp_score.toFixed(1)} · W{roster.owner_hub.biggestBlowoutWin.week} {roster.owner_hub.biggestBlowoutWin.season}</div>
                      </div>
                    </div>
                    <div class="record-stat win">+{roster.owner_hub.biggestBlowoutWin.margin.toFixed(1)}<span class="record-stat-label"> MARGIN</span></div>
                  </div>
                {/if}

                {#if roster.owner_hub.biggestBlowoutLoss}
                  <div class="record-card">
                    <div class="record-eyebrow">🥶 Biggest Blowout (Loss)</div>
                    <div class="record-body">
                      {#if roster.owner_hub.biggestBlowoutLoss.opponent_avatar}
                        <img class="record-team-avatar" src={roster.owner_hub.biggestBlowoutLoss.opponent_avatar} alt={roster.owner_hub.biggestBlowoutLoss.opponent_team ?? ''} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                      {/if}
                      <div class="record-meta">
                        <div class="record-name">lost to {roster.owner_hub.biggestBlowoutLoss.opponent_team ?? '—'}</div>
                        <div class="record-context">{roster.owner_hub.biggestBlowoutLoss.my_score.toFixed(1)} – {roster.owner_hub.biggestBlowoutLoss.opp_score.toFixed(1)} · W{roster.owner_hub.biggestBlowoutLoss.week} {roster.owner_hub.biggestBlowoutLoss.season}</div>
                      </div>
                    </div>
                    <div class="record-stat loss">{roster.owner_hub.biggestBlowoutLoss.margin.toFixed(1)}<span class="record-stat-label"> MARGIN</span></div>
                  </div>
                {/if}

                {#if roster.owner_hub.longestWinStreak > 0}
                  <div class="record-card">
                    <div class="record-eyebrow">🔥 Longest Win Streak</div>
                    <div class="record-body">
                      <div class="record-meta">
                        <div class="record-name">{roster.owner_hub.longestWinStreak} {roster.owner_hub.longestWinStreak === 1 ? 'game' : 'games'}</div>
                        <div class="record-context">{roster.owner_hub.longestWinStreakSeason}</div>
                      </div>
                    </div>
                  </div>
                {/if}

                {#if roster.owner_hub.longestLoseStreak > 0}
                  <div class="record-card">
                    <div class="record-eyebrow">❄️ Longest Lose Streak</div>
                    <div class="record-body">
                      <div class="record-meta">
                        <div class="record-name">{roster.owner_hub.longestLoseStreak} {roster.owner_hub.longestLoseStreak === 1 ? 'game' : 'games'}</div>
                        <div class="record-context">{roster.owner_hub.longestLoseStreakSeason}</div>
                      </div>
                    </div>
                  </div>
                {/if}

                {#if roster.owner_hub.bestSeasonRecord}
                  <div class="record-card">
                    <div class="record-eyebrow">🏅 Best Season Record</div>
                    <div class="record-body">
                      <div class="record-meta">
                        <div class="record-name">{roster.owner_hub.bestSeasonRecord.wins}–{roster.owner_hub.bestSeasonRecord.losses}</div>
                        <div class="record-context">{roster.owner_hub.bestSeasonRecord.season}</div>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
          <div class="advanced-stats" data-testid={`advanced-owner-stats-${roster.rosterId}`}>
            <div class="records-head">
              <div class="records-title">Advanced Team Analytics</div>
              <div class="records-sub">Completed regular seasons and playoff results</div>
            </div>
            <div class="owner-hub-grid">
              <div class="hub-stat" title="Career playoff record">
                <div class="hub-stat-num">{roster.owner_hub.playoffRecord.wins}–{roster.owner_hub.playoffRecord.losses}{#if roster.owner_hub.playoffRecord.ties}–{roster.owner_hub.playoffRecord.ties}{/if}</div>
                <div class="hub-stat-label">Playoff Record</div>
              </div>
              <div class="hub-stat" title="Average final placement in seasons with completed brackets">
                <div class="hub-stat-num">{roster.owner_hub.averageFinalFinish == null ? '—' : roster.owner_hub.averageFinalFinish.toFixed(1)}</div>
                <div class="hub-stat-label">Avg Finish</div>
              </div>
              <div class="hub-stat" title="Number of completed seasons finishing in the top four">
                <div class="hub-stat-num">{roster.owner_hub.topFourFinishes}</div>
                <div class="hub-stat-label">Top 4 Finishes</div>
              </div>
              <div class="hub-stat" title="Seasons leading the league in regular-season points for">
                <div class="hub-stat-num">{roster.owner_hub.leagueLeaders.mostPointsForSeasons}</div>
                <div class="hub-stat-label">PF Titles</div>
                <div class="hub-stat-years">{roster.owner_hub.leagueLeaders.mostPointsForYears.join(', ') || '—'}</div>
              </div>
              <div class="hub-stat" title="Seasons with the best regular-season record, using points for as the tiebreaker">
                <div class="hub-stat-num">{roster.owner_hub.leagueLeaders.bestRecordSeasons}</div>
                <div class="hub-stat-label">Best Records</div>
                <div class="hub-stat-years">{roster.owner_hub.leagueLeaders.bestRecordYears.join(', ') || '—'}</div>
              </div>
              <div class="hub-stat" title="Weeks this team finished with the lowest total points among all teams in the league">
                <div class="hub-stat-num">{roster.owner_hub.leagueLowestWeeks || 0}</div>
                <div class="hub-stat-label">League Weekly Lows</div>
              </div>
              {#if roster.owner_hub.weeklyScoring}
                <div class="hub-stat" title="Highest completed regular-season weekly team score">
                  <div class="hub-stat-num">{roster.owner_hub.weeklyScoring.highest.toFixed(1)}</div>
                  <div class="hub-stat-label">Weekly High</div>
                </div>
                <div class="hub-stat" title="Lowest completed regular-season weekly team score">
                  <div class="hub-stat-num">{roster.owner_hub.weeklyScoring.lowest.toFixed(1)}</div>
                  <div class="hub-stat-label">Weekly Low</div>
                </div>
              {/if}
            </div>
            {#if roster.owner_hub.activeToughestOpponent || roster.owner_hub.activeFavorableOpponent}
              <div class="rivalry-highlights">
                {#if roster.owner_hub.activeToughestOpponent}
                  <div>
                    <span>Toughest matchup</span>
                    <div class="rivalry-team"><img src={roster.owner_hub.activeToughestOpponent.avatar || ''} alt="" on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} /><strong>{roster.owner_hub.activeToughestOpponent.owner}</strong></div>
                    <small>{roster.owner_hub.activeToughestOpponent.wins}–{roster.owner_hub.activeToughestOpponent.losses}{#if roster.owner_hub.activeToughestOpponent.ties}–{roster.owner_hub.activeToughestOpponent.ties}{/if} · {(roster.owner_hub.activeToughestOpponent.winPct * 100).toFixed(0)}% win rate</small>
                  </div>
                {/if}
                {#if roster.owner_hub.activeFavorableOpponent}
                  <div>
                    <span>Best matchup</span>
                    <div class="rivalry-team"><img src={roster.owner_hub.activeFavorableOpponent.avatar || ''} alt="" on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} /><strong>{roster.owner_hub.activeFavorableOpponent.owner}</strong></div>
                    <small>{roster.owner_hub.activeFavorableOpponent.wins}–{roster.owner_hub.activeFavorableOpponent.losses}{#if roster.owner_hub.activeFavorableOpponent.ties}–{roster.owner_hub.activeFavorableOpponent.ties}{/if} · {(roster.owner_hub.activeFavorableOpponent.winPct * 100).toFixed(0)}% win rate</small>
                  </div>
                {/if}
              </div>
            {/if}
            {#if roster.owner_hub.headToHeadRecords?.length}
              <div class="records-head h2h-head">
                <div class="records-title">Head-to-Head Records</div>
                <div class="records-sub">Regular-season matchups</div>
              </div>
              <div class="season-table-wrap">
                <table class="bfa-table season-table h2h-table">
                  <thead><tr><th>Opponent</th><th>Record</th><th>Win %</th><th>PF</th><th>PA</th></tr></thead>
                  <tbody>
                    {#each roster.owner_hub.headToHeadRecords as opponent (opponent.key)}
                      <tr>
                        <td>{opponent.owner}</td>
                        <td>{opponent.wins}–{opponent.losses}{#if opponent.ties}–{opponent.ties}{/if}</td>
                        <td>{(opponent.winPct * 100).toFixed(1)}%</td>
                        <td>{Math.round(opponent.pf).toLocaleString()}</td>
                        <td>{Math.round(opponent.pa).toLocaleString()}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>
          {#if roster.owner_hub.seasonHistory?.length}
            <div class="season-history" data-testid={`season-history-${roster.rosterId}`}>
              <div class="records-head">
                <div class="records-title">Season-by-Season</div>
                <div class="records-sub">Regular-season totals · PF breaks ties</div>
              </div>
              <div class="season-table-wrap">
                <table class="bfa-table season-table">
                  <thead>
                    <tr><th>Season</th><th>Record</th><th>Finish</th><th>PF</th><th>PA</th><th>Diff</th></tr>
                  </thead>
                  <tbody>
                    {#each roster.owner_hub.seasonHistory as seasonRow (seasonRow.season)}
                      <tr>
                        <td>{seasonRow.season}</td>
                        <td>{seasonRow.wins}–{seasonRow.losses}{#if seasonRow.ties}–{seasonRow.ties}{/if}</td>
                        <td>{seasonRow.finish ? `#${seasonRow.finish}` : '—'}</td>
                        <td>{Math.round(seasonRow.pf).toLocaleString()}</td>
                        <td>{Math.round(seasonRow.pa).toLocaleString()}</td>
                        <td class:positive={seasonRow.pf > seasonRow.pa} class:negative={seasonRow.pf < seasonRow.pa}>
                          {seasonRow.pf - seasonRow.pa > 0 ? '+' : ''}{Math.round(seasonRow.pf - seasonRow.pa).toLocaleString()}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
          <section class="season-schedule" data-testid={`current-season-schedule-${roster.rosterId}`}>
            <div class="records-head">
              <div class="records-title">Current Season Schedule</div>
              <div class="records-sub">{season} · {selectedSchedule.length} weeks</div>
            </div>
            {#if selectedSchedule.length}
              <div class="schedule-list">
                {#each selectedSchedule as game (game.week)}
                  <div class="schedule-row">
                    <div class="schedule-week">Week {game.week}<small>{game.isPlayoff ? 'Playoffs' : 'Regular season'}</small></div>
                    <div class="schedule-opponent">
                      {#if game.opponentAvatar}<img src={game.opponentAvatar} alt="" on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />{/if}
                      <span>{game.opponentName}</span>
                    </div>
                    <div class="schedule-outcome" class:win={game.result === 'W'} class:loss={game.result === 'L'} class:tie={game.result === 'T'}>
                      {game.score || game.status}
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="empty-row">No schedule has been published for this season yet.</div>
            {/if}
          </section>

        {/if}

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
      </section>
    </article>
  {/if}
</div>


<style>
  .hub-stat-years { margin-top: .2rem; color: var(--text-tertiary); font-size: .68rem; line-height: 1.35; overflow-wrap: anywhere; }
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .head-row {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 1.5rem; flex-wrap: wrap;
  }
  .page-title {
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 6vw, 4rem);
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin: 0.4rem 0 0.5rem;
  }
  .page-sub { color: var(--text-secondary); font-size: 1rem; max-width: 60ch; }

  .picker { flex-shrink: 0; }
  .team-select {
    appearance: none;
    -webkit-appearance: none;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    font-family: var(--font-body);
    font-weight: 600;
    font-size: 0.95rem;
    padding: 0.65rem 2.2rem 0.65rem 0.85rem;
    min-width: 260px;
    cursor: pointer;
    transition: border-color var(--t-fast);
    background-image: linear-gradient(45deg, transparent 50%, var(--text-secondary) 50%),
                      linear-gradient(135deg, var(--text-secondary) 50%, transparent 50%);
    background-position: calc(100% - 18px) center, calc(100% - 12px) center;
    background-size: 6px 6px, 6px 6px;
    background-repeat: no-repeat;
  }
  .team-select:hover, .team-select:focus { border-color: var(--accent); outline: none; }
  .visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
  }

  .team-card {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    overflow: hidden;
  }

  .team-head {
    display: flex;
    gap: 0.85rem;
    align-items: center;
    padding: 1.1rem 1.5rem 1.1rem 1.5rem;
    background: linear-gradient(180deg, var(--surface-2), var(--surface-1));
    border-bottom: 1px solid var(--border-subtle);
  }

  .team-avatar {
    width: 64px; height: 64px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .team-info { flex: 1; min-width: 0; }
  .team-name {
    font-family: var(--font-display);
    font-size: 1.5rem;
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
    font-size: 0.92rem;
    font-weight: 500;
    margin-top: 0.25rem;
  }

  .team-stats {
    display: flex; gap: 0.4rem; margin-top: 0.55rem; flex-wrap: wrap;
  }
  .stat-pill {
    font-size: 0.72rem; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--text-secondary);
    background: var(--surface-2);
    padding: 0.2rem 0.5rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--border-subtle);
  }
  .stat-pill b {
    color: var(--accent);
    font-family: var(--font-display);
    font-weight: 400;
    margin-right: 0.2rem;
  }

  .team-body { padding: 1rem 1.1rem 1.2rem; }

  .owner-hub {
    margin: 0.25rem 0 1.1rem;
    padding: 0.95rem 1rem 1.05rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
  }
  .owner-hub-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.8rem;
  }
  .owner-hub-title {
    font-family: var(--font-display);
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--text-secondary);
  }
  .owner-hub-sub {
    font-size: 0.72rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 600;
  }
  .owner-hub-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 0.6rem;
  }
  .hub-stat {
    padding: 0.6rem 0.6rem;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    text-align: center;
  }
  .hub-stat-num {
    font-family: var(--font-display);
    font-size: 1.35rem;
    color: var(--text-primary);
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .hub-stat-year {
    font-family: var(--font-body);
    font-size: 0.7rem;
    color: var(--text-tertiary);
    font-weight: 600;
    margin-left: 0.15rem;
  }
  .hub-stat-pct {
    font-family: var(--font-body);
    font-size: 0.9rem;
    color: var(--text-tertiary);
    margin-left: 0.1rem;
  }
  .hub-stat-label {
    margin-top: 0.2rem;
    font-size: 0.64rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .advanced-stats {
    margin: 0.25rem 0 1.1rem;
    padding: 0.95rem 1rem 1.05rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
  }
  .rivalry-highlights {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 0.6rem;
    margin: 0.85rem 0;
  }
  .rivalry-highlights > div {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    padding: 0.65rem 0.75rem;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
  }
  .rivalry-highlights span, .rivalry-highlights small {
    color: var(--text-tertiary);
    font-size: 0.68rem;
  }
  .rivalry-highlights span { text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
  .rivalry-highlights strong { color: var(--text-primary); font-size: 0.9rem; }

  .rivalry-team { display: flex; align-items: center; gap: .5rem; min-width: 0; }
  .rivalry-team img { width: 28px; height: 28px; border-radius: 5px; object-fit: cover; background: var(--surface-2); flex-shrink: 0; }
  .rivalry-team strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .season-schedule {
    margin: 0.25rem 0 1.1rem; padding: 0.95rem 1rem 1.05rem;
    background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: var(--r-sm);
  }
  .schedule-list { display: grid; grid-template-columns: 1fr; gap: .45rem; }
  .schedule-row { display: grid; grid-template-columns: 102px minmax(0, 1fr) auto; align-items: center; gap: .55rem; padding: .55rem .65rem; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: 6px; min-width: 0; }
  .schedule-week { color: var(--text-primary); font-size: .8rem; font-weight: 600; white-space: nowrap; }
  .schedule-week small { display: block; margin-top: .12rem; color: var(--text-tertiary); font-size: .58rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 400; }
  .schedule-opponent { display: flex; align-items: center; gap: .45rem; min-width: 0; color: var(--text-secondary); font-size: .78rem; }
  .schedule-opponent img { width: 26px; height: 26px; border-radius: 5px; object-fit: cover; flex-shrink: 0; }
  .schedule-opponent span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .schedule-outcome { color: var(--text-tertiary); font-size: .68rem; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .schedule-outcome.win { color: var(--win); }
  .schedule-outcome.loss { color: var(--loss); }
  .schedule-outcome.tie { color: var(--accent); }
  .h2h-head { margin-top: 1rem; }
  .season-history {
    margin: 0.25rem 0 1.1rem;
    padding: 0.95rem 1rem 1.05rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
  }
  .season-table-wrap { overflow: hidden; }
  .season-table, .h2h-table { width: 100%; min-width: 0; table-layout: fixed; }

  .franchise-records {
    margin: 0.25rem 0 1.1rem;
    padding: 0.95rem 1rem 1.05rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
  }
  .records-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.8rem;
  }
  .records-title {
    font-family: var(--font-display);
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--text-secondary);
  }
  .records-sub {
    font-size: 0.68rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }
  .records-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.6rem;
  }
  .record-card {
    padding: 0.7rem 0.8rem 0.8rem;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .record-eyebrow {
    font-family: var(--font-body);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.62rem;
    color: var(--text-tertiary);
  }
  .record-body { display: flex; align-items: center; gap: 0.55rem; min-width: 0; }
  .record-headshot, .record-team-avatar {
    width: 34px; height: 34px;
    border-radius: 5px;
    object-fit: cover;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .record-meta { min-width: 0; flex: 1; }
  .record-name {
    font-weight: 700;
    color: var(--text-primary);
    font-size: 0.9rem;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .record-context {
    font-size: 0.68rem;
    color: var(--text-tertiary);
    margin-top: 0.15rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .record-stat {
    font-family: var(--font-display);
    font-size: 1.2rem;
    color: var(--text-primary);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .record-stat.win { color: var(--win); }
  .record-stat.loss { color: var(--loss); }
  .record-stat-label {
    font-family: var(--font-body);
    font-size: 0.55rem;
    font-weight: 800;
    letter-spacing: 0.18em;
    color: var(--text-tertiary);
    margin-left: 0.2rem;
  }

  .section-label {
    font-family: var(--font-body);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.72rem;
    color: var(--accent);
    margin: 1rem 0 0.55rem;
  }
  .section-label:first-child { margin-top: 0.5rem; }

  .starters { display: flex; flex-direction: column; gap: 0.45rem; }
  .bench-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.45rem;
  }

  .player-pill {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.5rem 0.65rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    transition: border-color var(--t-fast);
    flex-wrap: wrap;
  }
  .player-pill:hover { border-color: var(--border-strong); }
  .player-pill.compact { padding: 0.45rem 0.6rem; }
  /* Inside the bench/taxi grid the cards are narrow — force the position
     pills onto their own row so the player name always gets full width
     and never has to break character-by-character. */
  .player-pill.compact .pos-tags {
    width: 100%;
    margin-top: 0.3rem;
    justify-content: flex-end;
  }
  .player-pill .player-info { flex: 1 1 140px; }

  .slot-badge { min-width: 42px; }

  .player-headshot {
    width: 40px; height: 40px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--bg-base);
    flex-shrink: 0;
  }
  .player-headshot.small { width: 32px; height: 32px; }

  .player-info { flex: 1; min-width: 0; }
  .player-name {
    font-weight: 700; font-size: 0.9rem;
    color: var(--text-primary);
    line-height: 1.15;
    overflow-wrap: anywhere;
    word-break: normal;
  }
  .player-name.empty { color: var(--text-tertiary); font-style: italic; font-weight: 500; }
  .player-team { color: var(--text-tertiary); font-size: 0.74rem; margin-top: 0.15rem; }

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
    .head-row { gap: 1rem; }
    .team-select { width: 100%; min-width: 0; }
    .picker { width: 100%; }
    .team-head { padding: 0.9rem 1.2rem; gap: 0.7rem; }
    .team-avatar { width: 52px; height: 52px; }
    .team-name { font-size: 1.2rem; }
    .team-stats { gap: 0.3rem; }
    .stat-pill { font-size: 0.65rem; padding: 0.15rem 0.4rem; }
    .bench-grid { grid-template-columns: 1fr; }
    .schedule-list { grid-template-columns: 1fr; }
    .schedule-row { grid-template-columns: 72px minmax(0, 1fr) auto; gap: .4rem; padding: .5rem; }
    .schedule-opponent { font-size: .72rem; }
    .player-pill { flex-wrap: wrap; padding: 0.4rem 0.5rem; }
    .pos-tags { width: 100%; margin-top: 0.3rem; justify-content: flex-end; }
    .player-name { font-size: 0.84rem; }
    .player-team { font-size: 0.7rem; }
    .player-headshot { width: 34px; height: 34px; }
    .player-headshot.small { width: 30px; height: 30px; }
  }
</style>
