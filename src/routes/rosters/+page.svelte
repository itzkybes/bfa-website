<!-- src/routes/rosters/+page.svelte — Owner Hub (single-team picker view) -->
<script>
  import { onMount } from 'svelte';
  import { getSeasonsChain, getRosterMapWithOwners, getPlayersNba, playerHeadshot, BASE_LEAGUE_ID, pickActiveLeague } from '$lib/sleeperClient.client';
  import { computeStandingsForLeague } from '$lib/leagueCompute.client';
  import { expandPositions } from '$lib/positions';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';

  let loading = true;
  let error = null;
  let leagueName = null;
  let season = null;
  let rosters = [];                 // [{ rosterId, team_name, ... }] sorted A→Z
  let selectedRosterId = null;      // currently picked team

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
    const basic = Array.isArray(p.fantasy_positions) ? p.fantasy_positions : (p.position ? [p.position] : []);
    const positions = expandPositions(basic);
    return { name: fullName, team: p.team || p.team_abbreviation || 'FA', positions, player_id: p.player_id || id };
  }

  /**
   * Roll up every season's standings into a per-owner career snapshot:
   * championships, playoff appearances, career W-L, career PF/PA, best
   * finish, and best single-season PF, PLUS franchise-specific records.
   * Reads STRICTLY from `starters_points` for any per-player figures
   * (per project policy — `player_points` is never consulted).
   */
  function buildOwnerHubs(allSeasonResults, chain, playersMap = {}) {
    const hubs = {};
    const ownerSeasonsHandled = {};
    function ensure(uname) {
      const k = String(uname || '').toLowerCase();
      if (!k) return null;
      if (!hubs[k]) {
        hubs[k] = {
          owner_username: uname,
          championships: 0, playoffAppearances: 0, finalsAppearances: 0,
          seasonsPlayed: 0,
          careerWins: 0, careerLosses: 0, careerPF: 0, careerPA: 0,
          bestFinish: null, bestFinishSeason: null,
          bestSeasonPF: 0, bestSeasonPFSeason: null,
          bestSeasonRecord: null,
          longestWinStreak: 0, longestWinStreakSeason: null,
          longestLoseStreak: 0, longestLoseStreakSeason: null,
          bestSingleGame: null,
          bestPlayoffGame: null,
          highestWeek: null, lowestWeek: null,
          biggestBlowoutWin: null, biggestBlowoutLoss: null,
          firstSeason: null, lastSeason: null
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

      for (const reg of r.regularStandings) {
        const meta = rmap[reg.rosterId] || {};
        const hub = ensure(meta.owner_username || meta.owner_name);
        if (!hub) continue;
        const k = hub.owner_username.toLowerCase();
        if (!ownerSeasonsHandled[k].has(seasonLabel)) {
          ownerSeasonsHandled[k].add(seasonLabel);
          hub.seasonsPlayed += 1;
        }
        const wins = Number(reg.wins ?? 0);
        const losses = Number(reg.losses ?? 0);
        const pf = Number(reg.pf ?? 0);
        const pa = Number(reg.pa ?? 0);
        hub.careerWins += wins;
        hub.careerLosses += losses;
        hub.careerPF += pf;
        hub.careerPA += pa;
        if (pf > hub.bestSeasonPF) { hub.bestSeasonPF = pf; hub.bestSeasonPFSeason = seasonLabel; }
        if (!hub.bestSeasonRecord || wins > hub.bestSeasonRecord.wins ||
            (wins === hub.bestSeasonRecord.wins && losses < hub.bestSeasonRecord.losses)) {
          hub.bestSeasonRecord = { wins, losses, season: seasonLabel };
        }
        const winStreak = Number(reg.win_streak ?? reg.winStreak ?? reg.best_win_streak ?? reg.maxWinStreak ?? 0);
        const loseStreak = Number(reg.lose_streak ?? reg.loseStreak ?? reg.worst_lose_streak ?? reg.maxLoseStreak ?? 0);
        if (winStreak > hub.longestWinStreak) { hub.longestWinStreak = winStreak; hub.longestWinStreakSeason = seasonLabel; }
        if (loseStreak > hub.longestLoseStreak) { hub.longestLoseStreak = loseStreak; hub.longestLoseStreakSeason = seasonLabel; }
        if (hub.firstSeason == null || Number(seasonLabel) < Number(hub.firstSeason)) hub.firstSeason = seasonLabel;
        if (hub.lastSeason == null || Number(seasonLabel) > Number(hub.lastSeason)) hub.lastSeason = seasonLabel;
      }

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

      // Per-game records — scan collectedMatchups for every week. Regular
      // season weeks (1 → playoffStart-1) feed the franchise records that
      // are strictly regular-season (highest/lowest, blowouts, best single
      // game). Playoff weeks (playoffStart → playoffEnd) feed `bestPlayoffGame`.
      // All per-player figures read from `starters_points` ONLY.
      const collected = r.collectedMatchups || {};
      const playoffStart = r.playoffStart || 15;
      // 4-week playoff window. The static JSON exposes `playoff_week_end`;
      // fall back to `playoffStart + 3` for in-progress seasons fetched live.
      const playoffEnd = r.playoffEnd || (playoffStart + 3);
      for (const wkStr of Object.keys(collected)) {
        const wk = Number(wkStr);
        if (!isFinite(wk) || wk < 1) continue;
        const isRegular = wk < playoffStart;
        const isPlayoff = wk >= playoffStart && wk <= playoffEnd;
        if (!isRegular && !isPlayoff) continue;
        const entries = collected[wkStr] || [];
        const byMatch = {};
        for (const e of entries) {
          const m = String(e.matchup_id ?? '_unk');
          if (!byMatch[m]) byMatch[m] = [];
          byMatch[m].push(e);
        }
        for (const e of entries) {
          const rid = e.roster_id ?? e.rosterId;
          if (!rid) continue;
          const meta = rmap[rid] || {};
          const hub = ensure(meta.owner_username || meta.owner_name);
          if (!hub) continue;
          const pts = Number(e.points ?? 0);

          // Regular-season-only metrics: highest/lowest week + blowouts.
          if (isRegular && pts > 0) {
            const opp = (byMatch[String(e.matchup_id)] || []).find((o) => (o.roster_id ?? o.rosterId) !== rid);
            const oppMeta = opp ? (rmap[opp.roster_id ?? opp.rosterId] || {}) : {};
            if (!hub.highestWeek || pts > hub.highestWeek.points) {
              hub.highestWeek = {
                points: pts, week: wk, season: seasonLabel,
                opponent_team: oppMeta.team_name || null,
                opponent_avatar: oppMeta.team_avatar || oppMeta.owner_avatar || null
              };
            }
            if (!hub.lowestWeek || pts < hub.lowestWeek.points) {
              hub.lowestWeek = { points: pts, week: wk, season: seasonLabel };
            }
            if (opp) {
              const oppPts = Number(opp.points ?? 0);
              const margin = pts - oppPts;
              if (margin > 0 && (!hub.biggestBlowoutWin || margin > hub.biggestBlowoutWin.margin)) {
                hub.biggestBlowoutWin = {
                  margin, my_score: pts, opp_score: oppPts,
                  opponent_team: oppMeta.team_name || null,
                  opponent_avatar: oppMeta.team_avatar || oppMeta.owner_avatar || null,
                  week: wk, season: seasonLabel
                };
              }
              if (margin < 0 && (!hub.biggestBlowoutLoss || margin < hub.biggestBlowoutLoss.margin)) {
                hub.biggestBlowoutLoss = {
                  margin, my_score: pts, opp_score: oppPts,
                  opponent_team: oppMeta.team_name || null,
                  opponent_avatar: oppMeta.team_avatar || oppMeta.owner_avatar || null,
                  week: wk, season: seasonLabel
                };
              }
            }
          }

          // Best single-game starter performance — strictly from
          // starters_points. Tracked separately for regular vs playoffs.
          const sp = e.starters_points;
          const starters = e.starters;
          if (Array.isArray(sp) && Array.isArray(starters)) {
            for (let idx = 0; idx < starters.length; idx++) {
              const pid = starters[idx];
              if (!pid) continue;
              const val = Number(sp[idx] ?? 0);
              if (!isFinite(val) || val <= 0) continue;
              if (isRegular) {
                if (!hub.bestSingleGame || val > hub.bestSingleGame.points) {
                  const p = playersMap[pid] || {};
                  hub.bestSingleGame = {
                    player_id: pid,
                    player_name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || pid,
                    points: val, week: wk, season: seasonLabel
                  };
                }
              } else if (isPlayoff) {
                if (!hub.bestPlayoffGame || val > hub.bestPlayoffGame.points) {
                  const p = playersMap[pid] || {};
                  hub.bestPlayoffGame = {
                    player_id: pid,
                    player_name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || pid,
                    points: val, week: wk, season: seasonLabel
                  };
                }
              }
            }
          }
        }
      }
    }

    for (const k of Object.keys(hubs)) {
      const h = hubs[k];
      const games = h.careerWins + h.careerLosses;
      h.winPct = games ? h.careerWins / games : 0;
    }
    return hubs;
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
      // Default selection: alphabetically first team (matches sort).
      if (rosters.length && !selectedRosterId) {
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
    padding: 1.1rem 1.1rem;
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
    .team-head { padding: 0.9rem; gap: 0.7rem; }
    .team-avatar { width: 52px; height: 52px; }
    .team-name { font-size: 1.2rem; }
    .team-stats { gap: 0.3rem; }
    .stat-pill { font-size: 0.65rem; padding: 0.15rem 0.4rem; }
    .bench-grid { grid-template-columns: 1fr; }
    .player-pill { flex-wrap: wrap; padding: 0.4rem 0.5rem; }
    .pos-tags { width: 100%; margin-top: 0.3rem; justify-content: flex-end; }
    .player-name { font-size: 0.84rem; }
    .player-team { font-size: 0.7rem; }
    .player-headshot { width: 34px; height: 34px; }
    .player-headshot.small { width: 30px; height: 30px; }
  }
</style>
