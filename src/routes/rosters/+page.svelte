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
  let rosters = [];   // [{ rosterId, owner_name, team_name, team_avatar, _starters, _bench, _taxi }]
  // Global accordion: at most one roster is open at a time. Default state on
  // load is `null` → every team-card is rendered in its collapsed (head-only)
  // form, which keeps the grid uniform and prevents one expanded card from
  // creating a tall blank column next to a still-collapsed neighbor.
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

  function toggle(id) {
    // Accordion: clicking an already-open card closes it; clicking any other
    // card closes whatever was open and opens this one.
    expandedRosterId = expandedRosterId === id ? null : id;
  }

  /**
   * Roll up every season's standings into a per-owner career snapshot:
   * championships, playoff appearances, career W-L, career PF/PA, best
   * finish, and best single-season PF, PLUS franchise-specific records
   * (highest single-game starter, biggest blowout +/-, longest streak,
   * best weekly score, etc). Keyed by `owner_username` (the stable handle
   * across re-themed teams). Returns `{}` if standings can not be computed.
   */
  function buildOwnerHubs(allSeasonResults, chain, playersMap = {}) {
    const hubs = {};
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
          bestFinish: null,
          bestFinishSeason: null,
          bestSeasonPF: 0,
          bestSeasonPFSeason: null,
          bestSeasonRecord: null,            // { wins, losses, season }
          longestWinStreak: 0,
          longestWinStreakSeason: null,
          longestLoseStreak: 0,
          longestLoseStreakSeason: null,
          bestSingleGame: null,              // { player_id, points, week, season }
          highestWeek: null,                 // { points, week, season, opponent_team, opponent_avatar }
          lowestWeek: null,                  // { points, week, season }
          biggestBlowoutWin: null,           // { margin, my_score, opp_score, opponent_team, opponent_avatar, week, season }
          biggestBlowoutLoss: null,          // same shape (negative perspective)
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

      // Per-roster aggregates from regular standings.
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
        // Best season record by wins, tiebreak by lowest losses.
        if (!hub.bestSeasonRecord || wins > hub.bestSeasonRecord.wins ||
            (wins === hub.bestSeasonRecord.wins && losses < hub.bestSeasonRecord.losses)) {
          hub.bestSeasonRecord = { wins, losses, season: seasonLabel };
        }
        const winStreak = Number(reg.win_streak ?? reg.winStreak ?? reg.best_win_streak ?? 0);
        const loseStreak = Number(reg.lose_streak ?? reg.loseStreak ?? reg.worst_lose_streak ?? 0);
        if (winStreak > hub.longestWinStreak) { hub.longestWinStreak = winStreak; hub.longestWinStreakSeason = seasonLabel; }
        if (loseStreak > hub.longestLoseStreak) { hub.longestLoseStreak = loseStreak; hub.longestLoseStreakSeason = seasonLabel; }
        if (hub.firstSeason == null || Number(seasonLabel) < Number(hub.firstSeason)) hub.firstSeason = seasonLabel;
        if (hub.lastSeason == null || Number(seasonLabel) > Number(hub.lastSeason)) hub.lastSeason = seasonLabel;
      }

      // Final standings — championships, playoff appearances, best finish.
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

      // Per-game records — scan collectedMatchups for every regular-season
      // week to find highest single-game starter scores + biggest weekly
      // wins/losses. Skip playoffs to keep records "regular-season pure".
      const collected = r.collectedMatchups || {};
      const playoffStart = r.playoffStart || 15;
      for (const wkStr of Object.keys(collected)) {
        const wk = Number(wkStr);
        if (!isFinite(wk) || wk < 1 || wk >= playoffStart) continue;
        const entries = collected[wkStr] || [];
        // Group by matchup_id to find opponents
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

          // Highest / lowest weekly score
          if (pts > 0) {
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

          // Highest single-game starter performance
          const sp = e.starters_points;
          const starters = e.starters;
          if (Array.isArray(sp) && Array.isArray(starters)) {
            for (let idx = 0; idx < starters.length; idx++) {
              const pid = starters[idx];
              if (!pid) continue;
              const val = Number(sp[idx] ?? 0);
              if (!isFinite(val) || val <= 0) continue;
              if (!hub.bestSingleGame || val > hub.bestSingleGame.points) {
                const p = playersMap[pid] || {};
                hub.bestSingleGame = {
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
      const ownerHubs = buildOwnerHubs(allSeasonResults, seasons, playersMap);

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
    <div class="eyebrow">Owner Hub{#if season} · {season}{/if}</div>
    <h1 class="page-title">Owner Hub</h1>
    <p class="page-sub">Tap a team to expand: career stats, franchise records, and the current season's roster.</p>
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
          <div class="team-head">
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

                {#if roster.owner_hub.bestSingleGame || roster.owner_hub.highestWeek || roster.owner_hub.biggestBlowoutWin || roster.owner_hub.biggestBlowoutLoss}
                  <div class="franchise-records" data-testid={`franchise-records-${roster.rosterId}`}>
                    <div class="records-head">
                      <div class="records-title">Franchise Records</div>
                      <div class="records-sub">Regular season only · across every season the owner has played</div>
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
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
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

  /* CSS multi-column layout lets the column flow re-balance when a card
     expands — so opening one team doesn't leave a tall blank gap next to a
     still-collapsed neighbor. `break-inside: avoid` keeps a single card
     intact within one column. */
  .teams-grid {
    column-count: 2;
    column-gap: 1rem;
  }
  @media (min-width: 1400px) {
    .teams-grid { column-count: 3; }
  }
  @media (max-width: 880px) {
    .teams-grid { column-count: 1; }
  }

  .team-card {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    overflow: hidden;
    transition: border-color var(--t-fast);
    display: inline-block;          /* required for break-inside in columns */
    width: 100%;
    margin: 0 0 1rem;
    break-inside: avoid;
    -webkit-column-break-inside: avoid;
    page-break-inside: avoid;
  }
  .team-card:hover { border-color: var(--border-strong); }
  /* When a card is the open one, lift the border slightly so it's obvious
     which team's roster is currently being read. */
  .team-card.expanded { border-color: var(--border-strong); box-shadow: 0 0 0 1px var(--border-accent) inset; }

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

  /* Owner Hub — career stats card shown at the top of an expanded roster.
     Stats grid auto-fits to 5/4/3/2 columns depending on width so it stays
     readable inside narrow accordion columns. */
  .owner-hub {
    margin: 0.5rem 0 1rem;
    padding: 0.85rem 0.95rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
  }
  .owner-hub-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.7rem;
  }
  .owner-hub-title {
    font-family: var(--font-display);
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--text-secondary);
  }
  .owner-hub-sub {
    font-size: 0.7rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 600;
  }
  .owner-hub-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(95px, 1fr));
    gap: 0.55rem;
  }
  .hub-stat {
    padding: 0.55rem 0.6rem;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    text-align: center;
  }
  .hub-stat-num {
    font-family: var(--font-display);
    font-size: 1.25rem;
    color: var(--text-primary);
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .hub-stat-year {
    font-family: var(--font-body);
    font-size: 0.65rem;
    color: var(--text-tertiary);
    font-weight: 600;
    margin-left: 0.15rem;
  }
  .hub-stat-pct {
    font-family: var(--font-body);
    font-size: 0.85rem;
    color: var(--text-tertiary);
    margin-left: 0.1rem;
  }
  .hub-stat-label {
    margin-top: 0.2rem;
    font-size: 0.62rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }
  .hub-history-link {
    display: inline-block;
    margin-top: 0.85rem;
    font-size: 0.75rem;
    color: var(--brand);
    text-decoration: none;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .hub-history-link:hover { text-decoration: underline; }

  /* Franchise Records — second card inside the expanded team body.
     Surfaces per-team highlights (best single game, biggest blowout,
     longest streak, etc) so each owner has their own mini hall-of-fame
     visible without leaving the roster page. */
  .franchise-records {
    margin: 0.4rem 0 1rem;
    padding: 0.85rem 0.95rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
  }
  .records-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.7rem;
  }
  .records-title {
    font-family: var(--font-display);
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--text-secondary);
  }
  .records-sub {
    font-size: 0.65rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }
  .records-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.55rem;
  }
  .record-card {
    padding: 0.65rem 0.75rem 0.75rem;
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
    font-size: 0.6rem;
    color: var(--text-tertiary);
  }
  .record-body { display: flex; align-items: center; gap: 0.55rem; min-width: 0; }
  .record-headshot, .record-team-avatar {
    width: 32px; height: 32px;
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
    font-size: 0.88rem;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .record-context {
    font-size: 0.66rem;
    color: var(--text-tertiary);
    margin-top: 0.15rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .record-stat {
    font-family: var(--font-display);
    font-size: 1.15rem;
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
    font-size: 0.7rem;
    color: var(--accent);
    margin: 1rem 0 0.5rem;
  }
  .section-label:first-child { margin-top: 0.5rem; }

  .starters { display: flex; flex-direction: column; gap: 0.4rem; }
  .bench-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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
    .bench-grid { grid-template-columns: 1fr; }
    .player-pill { flex-wrap: wrap; padding: 0.4rem 0.5rem; }
    .pos-tags { width: 100%; margin-top: 0.3rem; justify-content: flex-end; }
    .player-name { font-size: 0.82rem; }
    .player-team { font-size: 0.68rem; }
    .player-headshot { width: 32px; height: 32px; }
    .player-headshot.small { width: 28px; height: 28px; }
    .collapse-btn { width: 32px; height: 32px; font-size: 1.2rem; }
  }
</style>
