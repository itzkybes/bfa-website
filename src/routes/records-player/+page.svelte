<!-- src/routes/records-player/+page.svelte (client-side fetched) -->
<script>
  import { onMount } from 'svelte';
  import { getSeasonsChain, BASE_LEAGUE_ID, getPlayersNba, playerHeadshot, pickActiveLeague, getRosterMapWithOwners } from '$lib/api';
  import { computeStandingsForLeague, aggregatePlayerPoints } from '$lib/compute';
  import SkeletonLoader from '$lib/components/SkeletonLoader.svelte';
  import SectionHeader from '$lib/components/SectionHeader.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import { formatNumber, avatarOrPlaceholder, playerDisplayName } from '$lib/utils/format';

  let loading = true;
  let error = null;
  let seasonsResults = [];
  let allTimeBestByTeam = [];
  let allTimeScoringByTeam = [];
  let allTimeMvpAwards = [];
  let playersMap = {};

  // Page-specific presets for the shared formatters: 2 decimals, and a 'P' placeholder avatar.
  const fmt = (v) => formatNumber(v, 2);
  const avatarOrPh = (url, name) => avatarOrPlaceholder(url, name, 'P');

  $: seasonMvpRows = [...seasonsResults].sort((a, b) => {
    const bestScore = (row) => Math.max(
      row.regularMvp?.points || 0,
      row.playoffsMvp?.points || 0,
      row.finalsMvp?.points || 0
    );
    return bestScore(b) - bestScore(a);
  });

  // Aggregate player points across multiple matchups. Reads STRICTLY from
  // `starters_points` (which already reflects each owner's selected-game
  // choice) — never falls back to `player_points`. Entries that ship
  // without a starters_points array are skipped so we don't inject zeros.
  async function loadAll() {
    loading = true; error = null;
    try {
      const { seasons: chain } = await getSeasonsChain(BASE_LEAGUE_ID);
      const active = pickActiveLeague(chain);
      const latest = active || (chain.length ? chain[chain.length - 1] : null);

      // Fetch the most-recent league's roster map ONCE — this is the canonical
      // source for the "current" team_name + team_avatar so every all-time
      // table renders the franchise's latest branding regardless of which
      // season the record came from. Keyed by owner_username so we can
      // resolve any historic row back to today's logo/name.
      let latestRosterMap = {};
      if (latest?.league_id) {
        try { latestRosterMap = await getRosterMapWithOwners(latest.league_id); }
        catch (e) { latestRosterMap = {}; }
      }
      const latestByOwnerKey = {};
      for (const rid of Object.keys(latestRosterMap)) {
        const m = latestRosterMap[rid];
        const k = (m?.owner_username || m?.owner_name || m?.owner_id);
        if (k) latestByOwnerKey[String(k).toLowerCase()] = m;
      }
      // Given any historic roster-meta, return the latest meta for the same
      // owner (so re-themes/avatar uploads after the fact show up everywhere).
      const latestMetaFor = (meta) => {
        if (!meta) return null;
        const k = (meta.owner_username || meta.owner_name || meta.owner_id);
        if (!k) return meta;
        return latestByOwnerKey[String(k).toLowerCase()] || meta;
      };

      // Fetch players map (~5MB, cached aggressively client-side via fetchWithCache + localStorage)
      const playersPromise = getPlayersNba().catch(() => ({}));

      // For each season, compute standings (which already collects matchups) then derive MVPs
      const allResults = await Promise.all(chain.map(async (s) => {
        const standings = await computeStandingsForLeague(s.league_id);
        const playoffStart = standings.playoffStart;
        const playoffEnd = standings.playoffEnd;
        const rosterMap = standings.rosterMap || {};

        // Use the already-collected matchups (no extra fetches)
        const collected = standings.collectedMatchups || {};
        const regularEntries = [];
        const playoffEntries = [];
        for (const wk of Object.keys(collected)) {
          const week = Number(wk);
          const arr = collected[wk] || [];
          if (week >= playoffStart && week <= playoffEnd) playoffEntries.push(...arr);
          else if (week >= 1 && week < playoffStart) regularEntries.push(...arr);
        }
        const fullEntries = [...regularEntries, ...playoffEntries];

        const fullByPlayer = aggregatePlayerPoints(fullEntries);
        const playoffByPlayer = aggregatePlayerPoints(playoffEntries);
        const regularByPlayer = aggregatePlayerPoints(regularEntries);

        // Playoffs MVP must come from the top-N seeded teams (the actual
        // playoff bracket). Filter losers-bracket entries out so the
        // toilet-bowl winner can't take this trophy.
        const playoffTeamCount = Number(standings.playoffTeams) || 8;
        const playoffRosterSet = new Set(
          (standings.regularStandings || [])
            .slice(0, playoffTeamCount)
            .map((r) => String(r.rosterId))
        );
        const playoffEntriesEligible = playoffEntries.filter(
          (e) => playoffRosterSet.has(String(e.roster_id ?? e.rosterId ?? ''))
        );

        // ---- Finals MVP = top scorer in the championship GAME only ----
        // (not the champion's top scorer across the whole playoff window)
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

        // Regular Season MVP = top scorer across regular-season weeks only.
        const regularList = Object.values(regularByPlayer).sort((a, b) => b.points - a.points);
        const playoffsList = Object.values(aggregatePlayerPoints(playoffEntriesEligible)).sort((a, b) => b.points - a.points);

        // Finals MVP = top scorer in the championship game (across BOTH finalists)
        const finalsMvp = finalsList[0] || null;
        // Playoffs MVP = top cumulative scorer across the playoff window for
        // teams that actually made the playoffs (seeds 1 → playoff_teams).
        const playoffsMvp = playoffsList[0] || null;

        return {
          season: s.season ?? s.league_id,
          leagueId: s.league_id,
          bracketComplete: Boolean(standings.bracketComplete),
          regularMvp: regularList[0]
            ? { ...regularList[0], playerName: null, roster_meta: rosterMap[regularList[0].rosterId] }
            : null,
          playoffsMvp: playoffsMvp
            ? { ...playoffsMvp, playerName: null, roster_meta: rosterMap[playoffsMvp.rosterId] }
            : null,
          finalsMvp: finalsMvp
            ? { ...finalsMvp, playerName: null, roster_meta: rosterMap[finalsMvp.rosterId] }
            : null,
          rosterMap,
          fullByPlayer,
          playoffByPlayer,
          regularByPlayer
        };
      }));

      playersMap = await playersPromise;
      seasonsResults = allResults;
      // resolve player names now that playersMap is loaded, and overlay each
      // per-season MVP's roster_meta with the manager's CURRENT meta so the
      // tinted MVP cards always pick up today's franchise logo color (and
      // today's team name, for historic seasons where the team has been
      // re-themed).
      for (const r of seasonsResults) {
        if (r.regularMvp) {
          r.regularMvp.playerName = playerDisplayName(playersMap, r.regularMvp.playerId);
          r.regularMvp.roster_meta = latestMetaFor(r.regularMvp.roster_meta) || r.regularMvp.roster_meta;
        }
        if (r.playoffsMvp) {
          r.playoffsMvp.playerName = playerDisplayName(playersMap, r.playoffsMvp.playerId);
          r.playoffsMvp.roster_meta = latestMetaFor(r.playoffsMvp.roster_meta) || r.playoffsMvp.roster_meta;
        }
        if (r.finalsMvp) {
          r.finalsMvp.playerName = playerDisplayName(playersMap, r.finalsMvp.playerId);
          r.finalsMvp.roster_meta = latestMetaFor(r.finalsMvp.roster_meta) || r.finalsMvp.roster_meta;
        }
      }
      seasonsResults = seasonsResults; // force reactivity

      // Count each season's three MVP awards by player.
      const mvpAwardCounts = {};
      for (const seasonResult of seasonsResults) {
        if (!seasonResult.bracketComplete) continue;
        for (const [awardKey, awardField] of [
          ['regular', 'regularMvp'],
          ['playoffs', 'playoffsMvp'],
          ['finals', 'finalsMvp']
        ]) {
          const award = seasonResult[awardField];
          if (!award?.playerId) continue;
          const pid = String(award.playerId);
          const row = mvpAwardCounts[pid] || {
            playerId: pid, regular: 0, playoffs: 0, finals: 0, total: 0,
            latestRoster: null
          };
          row[awardKey] += 1;
          row.total += 1;
          row.latestRoster = award.roster_meta || row.latestRoster;
          mvpAwardCounts[pid] = row;
        }
      }
      allTimeMvpAwards = Object.values(mvpAwardCounts)
        .map((row) => ({
          ...row,
          playerName: playerDisplayName(playersMap, row.playerId)
        }))
        .sort((a, b) =>
          b.total - a.total ||
          b.finals - a.finals ||
          b.playoffs - a.playoffs ||
          b.regular - a.regular ||
          String(a.playerName || '').localeCompare(String(b.playerName || ''))
        );


      // -- All-Time Best Single-Season Player BY TEAM (reg vs playoff) ------
      // One row per team (keyed by owner_username, the only stable identifier
      // across seasons). Two columns: best regular-season scorer + best
      // playoff scorer, with the season they did it. Latest roster meta is
      // used for the team-name / avatar columns (so re-themes and new logos
      // show up here too).
      const stableKey = (m) => {
        if (!m) return null;
        const k = m.owner_username || m.owner_name || m.owner_id;
        return k ? String(k).toLowerCase() : null;
      };
      const bestByTeam = {}; // key -> { meta, reg: {...}, playoff: {...} }
      // seasonsResults is sorted oldest → newest by the chain order, so the
      // "last write" naturally lands on the most recent meta.
      for (const r of seasonsResults) {
        for (const rid of Object.keys(r.rosterMap || {})) {
          const meta = r.rosterMap[rid];
          const key = stableKey(meta);
          if (!key) continue;
          if (!bestByTeam[key]) bestByTeam[key] = { key, meta, reg: null, playoff: null };
          // Always overlay with the latest team_name + avatar we've seen.
          bestByTeam[key].meta = meta;
        }
        // Regular-season pass
        for (const [pid, info] of Object.entries(r.regularByPlayer || {})) {
          if (!info?.points || info.points <= 0) continue;
          const meta = r.rosterMap[info.rosterId];
          const key = stableKey(meta);
          if (!key) continue;
          if (!bestByTeam[key]) bestByTeam[key] = { key, meta, reg: null, playoff: null };
          const cur = bestByTeam[key].reg;
          if (!cur || info.points > cur.points) {
            bestByTeam[key].reg = {
              playerId: pid,
              playerName: playerDisplayName(playersMap, pid),
              points: Math.round(info.points * 100) / 100,
              season: r.season
            };
          }
        }
        // Playoff pass
        for (const [pid, info] of Object.entries(r.playoffByPlayer || {})) {
          if (!info?.points || info.points <= 0) continue;
          const meta = r.rosterMap[info.rosterId];
          const key = stableKey(meta);
          if (!key) continue;
          if (!bestByTeam[key]) bestByTeam[key] = { key, meta, reg: null, playoff: null };
          const cur = bestByTeam[key].playoff;
          if (!cur || info.points > cur.points) {
            bestByTeam[key].playoff = {
              playerId: pid,
              playerName: playerDisplayName(playersMap, pid),
              points: Math.round(info.points * 100) / 100,
              season: r.season
            };
          }
        }
      }
      // Rank franchises by their strongest single-season score across either phase.
      allTimeBestByTeam = Object.values(bestByTeam)
        .filter((r) => r.reg || r.playoff)
        .map((r) => ({ ...r, meta: latestMetaFor(r.meta) || r.meta }))
        .sort((a, b) =>
          Math.max(b.reg?.points || 0, b.playoff?.points || 0) -
          Math.max(a.reg?.points || 0, a.playoff?.points || 0)
        );

      // One franchise row with independent cumulative leaders for each phase.
      const scoringByTeam = {};
      for (const r of seasonsResults) {
        for (const [phase, playerMap] of [['regular', r.regularByPlayer || {}], ['playoff', r.playoffByPlayer || {}]]) {
          for (const [pid, info] of Object.entries(playerMap)) {
            if (!info?.points || info.points <= 0) continue;
            const meta = r.rosterMap[info.rosterId];
            const key = stableKey(meta);
            if (!key) continue;
            if (!scoringByTeam[key]) scoringByTeam[key] = { key, meta, regular: {}, playoff: {} };
            scoringByTeam[key].meta = latestMetaFor(meta) || meta;
            const player = scoringByTeam[key][phase][pid] || {
              playerId: pid, playerName: playerDisplayName(playersMap, pid), totalPoints: 0
            };
            player.totalPoints += info.points;
            scoringByTeam[key][phase][pid] = player;
          }
        }
      }
      allTimeScoringByTeam = Object.values(scoringByTeam)
        .map((team) => {
          const top = (players) => Object.values(players).sort((a, b) => b.totalPoints - a.totalPoints)[0] || null;
          const regularLeader = top(team.regular);
          const playoffLeader = top(team.playoff);
          return regularLeader || playoffLeader ? {
            key: team.key,
            meta: team.meta,
            regularLeader: regularLeader ? { ...regularLeader, totalPoints: Math.round(regularLeader.totalPoints * 100) / 100 } : null,
            playoffLeader: playoffLeader ? { ...playoffLeader, totalPoints: Math.round(playoffLeader.totalPoints * 100) / 100 } : null
          } : null;
        })
        .filter(Boolean)
        .sort((a, b) =>
          ((b.regularLeader?.totalPoints || 0) + (b.playoffLeader?.totalPoints || 0)) -
          ((a.regularLeader?.totalPoints || 0) + (a.playoffLeader?.totalPoints || 0))
        );
    } catch (e) {
      console.error('[Records-Player] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  function rosterInfo(row) {
    if (!row) return { teamName: null, ownerName: null, teamAvatar: null };
    return {
      teamName: row.teamName || row.roster_meta?.team_name || row.owner_name || `Roster ${row.rosterId}`,
      ownerName: row.owner_name || row.roster_meta?.owner_name || (row.rosterId ? `Roster ${row.rosterId}` : null),
      teamAvatar: row.teamAvatar || row.roster_meta?.team_avatar || row.roster_meta?.owner_avatar || null
    };
  }

  onMount(loadAll);
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="head-row">
      <div>
        <div class="eyebrow">All-Time · Player Records</div>
        <h1 class="page-title">Player Records</h1>
        <p class="page-sub">Season MVPs, all-time MVP awards, and each franchise's top scorers.</p>
      </div>
    </div>
  </header>

  {#if loading}
    <SkeletonLoader variant="row" count={6} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="player records" />
  {:else}
    <section class="block" data-testid="season-mvps">
      <SectionHeader compact title="Season MVPs" description="Every BFA season · regular season, playoffs, and finals" />
      {#if seasonMvpRows.length}
        <div class="table-wrap">
          <table class="bfa-table season-mvp-table">
            <thead><tr><th>Season</th><th>Regular Season MVP</th><th>Playoffs MVP</th><th>Finals MVP</th></tr></thead>
            <tbody>
              {#each seasonMvpRows as row (row.leagueId)}
                <tr>
                  <td><span class="num season-year">{row.season}</span></td>
                  {#each [row.regularMvp, row.playoffsMvp, row.finalsMvp] as award}
                    <td>
                      {#if award}
                        <div class="player-cell season-award-cell">
                          <img class="record-headshot" src={playerHeadshot(award.playerId) || avatarOrPh(rosterInfo(award).teamAvatar, award.playerName)} alt={award.playerName} on:error={(e) => (e.currentTarget.src = avatarOrPh(rosterInfo(award).teamAvatar, award.playerName))} />
                          <div>
                            <div class="player-name-cell">{award.playerName ?? `Player ${award.playerId}`}</div>
                            <div class="award-points num">{fmt(award.points)} PTS</div>
                            <div class="team-owner-cell">{rosterInfo(award).teamName}</div>
                          </div>
                        </div>
                      {:else}<span class="muted">{row.bracketComplete ? '—' : 'Pending'}</span>{/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}<div class="empty-card">No season MVP data recorded yet.</div>{/if}
    </section>

    <section class="block" data-testid="all-time-mvp-awards">
      <SectionHeader compact title="All-Time MVP Awards" description="Award counts across every completed BFA season" />
      {#if allTimeMvpAwards.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead>
              <tr>
                <th class="rank-cell">Rank</th>
                <th>Player</th>
                <th class="col-num">Total Awards</th>
                <th class="col-num">Regular MVP</th>
                <th class="col-num">Playoffs MVP</th>
                <th class="col-num">Finals MVP</th>
                <th>Most Recent Team</th>
              </tr>
            </thead>
            <tbody>
              {#each allTimeMvpAwards as row, idx (row.playerId)}
                <tr>
                  <td class="rank-cell"><span class="num rank-num" class:leader-cell={idx === 0}>{idx + 1}</span></td>
                  <td>
                    <div class="player-cell">
                      <img class="headshot" src={playerHeadshot(row.playerId)} alt={row.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                      <div class="player-name-cell">{row.playerName}</div>
                    </div>
                  </td>
                  <td class="col-num"><span class="num bigpts" class:leader-cell={idx === 0}>{row.total}</span></td>
                  <td class="col-num"><span class="num">{row.regular}</span></td>
                  <td class="col-num"><span class="num">{row.playoffs}</span></td>
                  <td class="col-num"><span class="num">{row.finals}</span></td>
                  <td>
                    {#if row.latestRoster}
                      <div class="team-cell">
                        <img class="team-avatar small" src={avatarOrPh(row.latestRoster.team_avatar || row.latestRoster.owner_avatar, row.latestRoster.team_name)} alt={row.latestRoster.team_name} />
                        <div>
                          <div class="team-name-cell">{row.latestRoster.team_name}</div>
                          <div class="team-owner-cell">{row.latestRoster.owner_name}</div>
                        </div>
                      </div>
                    {:else}<span class="muted">—</span>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="empty-card">No MVP awards recorded yet.</div>
      {/if}
    </section>

    <section class="block" data-testid="all-time-best-by-team">
      <SectionHeader compact title="All-Time Best Player · By Team" description="Highest single-season scorer ever · regular vs playoffs" />
      {#if allTimeBestByTeam.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Best · Regular Season</th>
                <th class="col-num" title="Regular-season points scored that year">Reg. Season PTS</th>
                <th>Best · Playoffs</th>
                <th class="col-num" title="Playoff points scored that year">Playoff PTS</th>
              </tr>
            </thead>
            <tbody>
              {#each allTimeBestByTeam as row (row.key)}
                <tr>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPh(row.meta?.team_avatar || row.meta?.owner_avatar, row.meta?.team_name)} alt={row.meta?.team_name} />
                      <div>
                        {#if row.meta?.owner_username}
                          <a class="team-name-link" href={`/team/${encodeURIComponent(row.meta.owner_username)}`}>{row.meta?.team_name || `Roster ${row.key}`}</a>
                        {:else}
                          <div class="team-name-cell">{row.meta?.team_name || `Roster ${row.key}`}</div>
                        {/if}
                        {#if row.meta?.owner_name}<div class="team-owner-cell">{row.meta.owner_name}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td>
                    {#if row.reg}
                      <div class="player-cell">
                        <img class="headshot" src={playerHeadshot(row.reg.playerId)} alt={row.reg.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                        <div>
                          <div class="player-name-cell">{row.reg.playerName ?? `Player ${row.reg.playerId}`}</div>
                          <div class="player-meta-cell">'{String(row.reg.season).slice(-2)} season</div>
                        </div>
                      </div>
                    {:else}<span class="muted">—</span>{/if}
                  </td>
                  <td class="col-num">{#if row.reg}<span class="num bigpts">{fmt(row.reg.points)}</span>{:else}<span class="muted">—</span>{/if}</td>
                  <td>
                    {#if row.playoff}
                      <div class="player-cell">
                        <img class="headshot" src={playerHeadshot(row.playoff.playerId)} alt={row.playoff.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                        <div>
                          <div class="player-name-cell">{row.playoff.playerName ?? `Player ${row.playoff.playerId}`}</div>
                          <div class="player-meta-cell">'{String(row.playoff.season).slice(-2)} playoffs</div>
                        </div>
                      </div>
                    {:else}<span class="muted">—</span>{/if}
                  </td>
                  <td class="col-num">{#if row.playoff}<span class="num bigpts">{fmt(row.playoff.points)}</span>{:else}<span class="muted">—</span>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}<div class="empty-card">No team data yet.</div>{/if}
    </section>
    <section class="block" data-testid="all-time-scoring-by-team">
      <SectionHeader compact title="All-Time Scoring Leader · By Team" description="Highest cumulative scorers for each franchise · split by phase" />
      {#if allTimeScoringByTeam.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead><tr><th>Team</th><th>Regular Season Leader</th><th class="col-num">Regular Season PTS</th><th>Playoffs Leader</th><th class="col-num">Playoffs PTS</th></tr></thead>
            <tbody>
              {#each allTimeScoringByTeam as row (row.key)}
                <tr>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPh(row.meta?.team_avatar || row.meta?.owner_avatar, row.meta?.team_name)} alt={row.meta?.team_name} />
                      <div>
                        {#if row.meta?.owner_username}
                          <a class="team-name-link" href={`/team/${encodeURIComponent(row.meta.owner_username)}`}>{row.meta?.team_name || `Roster ${row.key}`}</a>
                        {:else}<div class="team-name-cell">{row.meta?.team_name || `Roster ${row.key}`}</div>{/if}
                        {#if row.meta?.owner_name}<div class="team-owner-cell">{row.meta.owner_name}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td>
                    {#if row.regularLeader}
                      <div class="player-cell">
                        <img class="record-headshot" src={playerHeadshot(row.regularLeader.playerId)} alt={row.regularLeader.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                        <div class="player-name-cell">{row.regularLeader.playerName}</div>
                      </div>
                    {:else}<span class="muted">—</span>{/if}
                  </td>
                  <td class="col-num">{#if row.regularLeader}<span class="num bigpts">{fmt(row.regularLeader.totalPoints)}</span>{:else}<span class="muted">—</span>{/if}</td>
                  <td>
                    {#if row.playoffLeader}
                      <div class="player-cell">
                        <img class="record-headshot" src={playerHeadshot(row.playoffLeader.playerId)} alt={row.playoffLeader.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                        <div class="player-name-cell">{row.playoffLeader.playerName}</div>
                      </div>
                    {:else}<span class="muted">—</span>{/if}
                  </td>
                  <td class="col-num">{#if row.playoffLeader}<span class="num bigpts">{fmt(row.playoffLeader.totalPoints)}</span>{:else}<span class="muted">—</span>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}<div class="empty-card">No all-time scoring data yet.</div>{/if}
    </section>
  {/if}
</div>

<style>
  .page.wrap { max-width: 1600px; }
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .head-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; flex-wrap: wrap; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; text-transform: uppercase; margin: 0.4rem 0 0; }

  .block { background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; margin-bottom: 1.25rem; }

  .team-name-link { font-weight: 700; color: var(--text-primary); line-height: 1.15; text-decoration: none; }
  .team-name-link:hover { color: var(--accent); }
  .player-meta-cell { color: var(--text-tertiary); font-size: 0.72rem; margin-top: 0.15rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }

  .season-year { font-family: var(--font-display); font-size: 1.35rem; color: var(--accent); }
  .season-award-cell { gap: 0.85rem; }
  .record-headshot { width: 68px; height: 68px; object-fit: cover; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--border-subtle); flex-shrink: 0; }
  .bfa-table .headshot { width: 58px; height: 58px; }
  .award-points { color: var(--text-secondary); font-size: 0.82rem; margin-top: 0.2rem; }

  .table-wrap { width: 100%; overflow-x: auto; }
  .bfa-table { width: 100%; min-width: 0; table-layout: auto; }
  .bfa-table thead th { white-space: normal; }
  .team-cell, .player-cell { min-width: 0; }
  .team-name-cell, .player-name-cell { overflow-wrap: anywhere; }
  .team-cell, .player-cell { display: flex; align-items: center; gap: 0.7rem; }
  .team-avatar.small { width: 42px; height: 42px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); }
  .team-name-cell, .player-name-cell { font-weight: 700; color: var(--text-primary); line-height: 1.15; }
  .team-owner-cell { color: var(--text-tertiary); font-size: 0.78rem; margin-top: 0.15rem; }
  .bigpts { font-size: 1.05rem; color: var(--text-secondary); font-weight: 500; }
  .accent-text { color: var(--accent); }
  .best-season { color: var(--text-tertiary); font-size: 0.75rem; font-weight: 700; margin-left: 0.25rem; }
  .rank-cell { width: 60px; }
  .rank-num { font-size: 1.4rem; color: var(--accent); font-family: var(--font-display); }
  .muted { color: var(--text-tertiary); }
  .empty-card { padding: 1.5rem; text-align: center; color: var(--text-secondary); }
  @media (max-width: 720px) {
    .page { padding: 1.75rem 0 3rem; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .table-wrap::after { display: none; }
    .record-headshot { width: 52px; height: 52px; }
    .team-avatar.small { width: 34px; height: 34px; }
    .headshot { width: 48px; height: 48px; }
    .team-owner-cell, .player-meta-cell { display: none; }
    .bigpts { font-size: 1rem; }
    .table-wrap { overflow-x: auto; }
    .bfa-table { table-layout: fixed; font-size: 0.78rem; }
    .bfa-table thead th { padding: 0.58rem 0.32rem; font-size: 0.58rem; letter-spacing: 0.04em; overflow-wrap: anywhere; }
    .bfa-table tbody td { padding: 0.62rem 0.32rem; overflow-wrap: anywhere; }
    .bfa-table .col-num { white-space: normal; }
    .bfa-table .team-cell, .bfa-table .player-cell { gap: 0.35rem; }
    .bfa-table .team-avatar.small { width: 30px; height: 30px; }
    .bfa-table .headshot { width: 40px; height: 40px; }
    .bfa-table .record-headshot { width: 42px; height: 42px; }
    .bfa-table .num { font-size: 0.9rem; }
  }
</style>
