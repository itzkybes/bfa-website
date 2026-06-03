<!-- src/routes/records-player/+page.svelte (client-side fetched) -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getSeasonsChain, BASE_LEAGUE_ID, getPlayersNba, playerHeadshot, pickActiveLeague, getRosterMapWithOwners } from '$lib/sleeperClient.client';
  import { computeStandingsForLeague, starterPointsByPid } from '$lib/leagueCompute.client';
  import { avatarOrPh, fmt2 as fmt } from '$lib/format';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';
  import TeamBadge from '$lib/TeamBadge.svelte';

  let loading = true;
  let error = null;
  let seasons = [];
  let selectedSeason = null;
  let seasonsResults = [];   // [{ season, regularMvp, finalsMvp, teamLeaders[] }]
  let allTimePlayoff = [];
  let allTimeFull = [];
  let allTimePlayoffsLeaderboard = []; // cumulative playoff points across every season, per player
  let allTimeBestByTeam = [];          // per team: best reg-season player + best playoff player
  let playersMap = {};

  function playerName(pid) {
    if (!pid) return '';
    const p = playersMap[pid];
    if (!p) return String(pid);
    return p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || String(pid);
  }

  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? null;
  $: om = selectedRow?.regularMvp ?? null;
  $: pm = selectedRow?.playoffsMvp ?? null;
  $: fm = selectedRow?.finalsMvp ?? null;

  // Aggregate player points across multiple matchups
  function aggregatePlayerPoints(matchupEntries) {
    // STRICT: only players who occupied a starter slot are credited, and the
    // score used is `starters_points[slotIndex]` — the authoritative per-slot
    // total Sleeper produces AFTER the owner's manual game-selection has
    // been applied. Weeks missing `starters_points` are skipped entirely
    // (rather than falling back to `player_points[pid]`, which would
    // over-count on multi-game NBA weeks).
    const byPlayer = {}; // pid -> { points, rosterId, gamesStarted }
    for (const entry of matchupEntries) {
      const map = starterPointsByPid(entry);
      if (!map) continue;
      const rid = String(entry.roster_id ?? entry.rosterId ?? '');
      for (const pid of Object.keys(map)) {
        const val = map[pid];
        if (!byPlayer[pid]) byPlayer[pid] = { playerId: pid, points: 0, rosterId: rid, gamesStarted: 0 };
        byPlayer[pid].points += val;
        byPlayer[pid].gamesStarted += 1;
      }
    }
    for (const k of Object.keys(byPlayer)) byPlayer[k].points = Math.round(byPlayer[k].points * 100) / 100;
    return byPlayer;
  }

  async function loadAll() {
    loading = true; error = null;
    try {
      const { seasons: chain } = await getSeasonsChain(BASE_LEAGUE_ID);
      seasons = chain;
      const urlSeason = $page.url.searchParams.get('season');
      const active = pickActiveLeague(chain);
      const latest = active || (chain.length ? chain[chain.length - 1] : null);
      selectedSeason = urlSeason || (latest?.season != null ? String(latest.season) : String(latest?.league_id || BASE_LEAGUE_ID));

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

        // team leaders (top scorer per roster, full season) — still uses the
        // full season to surface each roster's all-around best contributor.
        const overallList = Object.values(fullByPlayer).sort((a, b) => b.points - a.points);
        const teamLeaders = [];
        const seenRosters = new Set();
        for (const p of overallList) {
          if (seenRosters.has(p.rosterId)) continue;
          const meta = rosterMap[p.rosterId] || {};
          teamLeaders.push({
            rosterId: p.rosterId, playerId: p.playerId, points: p.points,
            teamName: meta.team_name, owner_name: meta.owner_name, teamAvatar: meta.team_avatar,
            _roster_meta: meta
          });
          seenRosters.add(p.rosterId);
        }

        return {
          season: s.season ?? s.league_id,
          leagueId: s.league_id,
          regularMvp: regularList[0]
            ? { ...regularList[0], playerName: null, roster_meta: rosterMap[regularList[0].rosterId] }
            : null,
          playoffsMvp: playoffsMvp
            ? { ...playoffsMvp, playerName: null, roster_meta: rosterMap[playoffsMvp.rosterId] }
            : null,
          finalsMvp: finalsMvp
            ? { ...finalsMvp, playerName: null, roster_meta: rosterMap[finalsMvp.rosterId] }
            : null,
          teamLeaders,
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
          r.regularMvp.playerName = playerName(r.regularMvp.playerId);
          r.regularMvp.roster_meta = latestMetaFor(r.regularMvp.roster_meta) || r.regularMvp.roster_meta;
        }
        if (r.playoffsMvp) {
          r.playoffsMvp.playerName = playerName(r.playoffsMvp.playerId);
          r.playoffsMvp.roster_meta = latestMetaFor(r.playoffsMvp.roster_meta) || r.playoffsMvp.roster_meta;
        }
        if (r.finalsMvp) {
          r.finalsMvp.playerName = playerName(r.finalsMvp.playerId);
          r.finalsMvp.roster_meta = latestMetaFor(r.finalsMvp.roster_meta) || r.finalsMvp.roster_meta;
        }
      }
      seasonsResults = seasonsResults; // force reactivity

      // All-time playoff best per roster
      const allTimePlayoffMap = {}; // rid -> { rosterId, playerId, points, season, ... }
      for (const r of seasonsResults) {
        for (const [pid, info] of Object.entries(r.playoffByPlayer || {})) {
          const rid = info.rosterId;
          if (!allTimePlayoffMap[rid] || info.points > allTimePlayoffMap[rid].points) {
            const meta = r.rosterMap[rid] || {};
            const latestMeta = latestMetaFor(meta) || meta;
            allTimePlayoffMap[rid] = {
              rosterId: rid, playerId: pid, playerName: playerName(pid), points: info.points,
              gamesStarted: info.gamesStarted || 0,
              season: r.season,
              teamName: latestMeta.team_name || meta.team_name,
              owner_name: latestMeta.owner_name || meta.owner_name,
              owner_username: latestMeta.owner_username || meta.owner_username || null,
              teamAvatar: latestMeta.team_avatar || latestMeta.owner_avatar || meta.team_avatar || meta.owner_avatar
            };
          }
        }
      }
      allTimePlayoff = Object.values(allTimePlayoffMap).sort((a,b) => b.points - a.points);

      // All-time full-season best per roster
      const allTimeFullMap = {};
      for (const r of seasonsResults) {
        for (const [pid, info] of Object.entries(r.fullByPlayer || {})) {
          const rid = info.rosterId;
          if (!allTimeFullMap[rid] || info.points > allTimeFullMap[rid].points) {
            const meta = r.rosterMap[rid] || {};
            const latestMeta = latestMetaFor(meta) || meta;
            allTimeFullMap[rid] = {
              rosterId: rid, playerId: pid, playerName: playerName(pid), points: info.points,
              gamesStarted: info.gamesStarted || 0,
              season: r.season,
              teamName: latestMeta.team_name || meta.team_name,
              owner_name: latestMeta.owner_name || meta.owner_name,
              owner_username: latestMeta.owner_username || meta.owner_username || null,
              teamAvatar: latestMeta.team_avatar || latestMeta.owner_avatar || meta.team_avatar || meta.owner_avatar
            };
          }
        }
      }
      allTimeFull = Object.values(allTimeFullMap).sort((a,b) => b.points - a.points);

      // -- All-Time Playoffs MVP Leaderboard --------------------------------
      // Sum each player's playoff points across EVERY season they appeared in.
      // Track best-single-season + # appearances so the table can show context.
      const playoffsByPlayer = {}; // pid -> { playerId, totalPoints, appearances, best, bestSeason, latestRoster, latestSeason }
      for (const r of seasonsResults) {
        for (const [pid, info] of Object.entries(r.playoffByPlayer || {})) {
          if (!info?.points || info.points <= 0) continue;
          const slot = playoffsByPlayer[pid] || {
            playerId: pid,
            totalPoints: 0,
            totalGamesStarted: 0,
            appearances: 0,
            best: 0,
            bestSeason: null,
            latestRoster: null,
            latestSeason: null
          };
          slot.totalPoints += info.points;
          slot.totalGamesStarted += info.gamesStarted || 0;
          slot.appearances += 1;
          if (info.points > slot.best) {
            slot.best = info.points;
            slot.bestSeason = r.season;
          }
          // Track most recent appearance (chain is sorted oldest → newest).
          // Resolve to the league's latest meta so the displayed avatar/name
          // match today's branding, not whatever the team was called the
          // season this player happened to score.
          const playerSeasonMeta = r.rosterMap[info.rosterId] || slot.latestRoster;
          slot.latestRoster = latestMetaFor(playerSeasonMeta) || playerSeasonMeta;
          slot.latestSeason = r.season;
          playoffsByPlayer[pid] = slot;
        }
      }
      allTimePlayoffsLeaderboard = Object.values(playoffsByPlayer)
        .map((p) => ({
          ...p,
          playerName: playerName(p.playerId),
          totalPoints: Math.round(p.totalPoints * 100) / 100,
          best: Math.round(p.best * 100) / 100,
          ppg: p.totalGamesStarted > 0
            ? Math.round((p.totalPoints / p.totalGamesStarted) * 100) / 100
            : 0
        }))
        .sort((a, b) => b.totalPoints - a.totalPoints)
        .slice(0, 25); // top 25 — keeps the table digestible

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
              playerName: playerName(pid),
              points: Math.round(info.points * 100) / 100,
              gamesStarted: info.gamesStarted || 0,
              ppg: info.gamesStarted > 0
                ? Math.round((info.points / info.gamesStarted) * 100) / 100
                : 0,
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
              playerName: playerName(pid),
              points: Math.round(info.points * 100) / 100,
              gamesStarted: info.gamesStarted || 0,
              ppg: info.gamesStarted > 0
                ? Math.round((info.points / info.gamesStarted) * 100) / 100
                : 0,
              season: r.season
            };
          }
        }
      }
      // Sort by team name for a stable, alphabetical readout. Overlay each
       // entry's meta with the latest-league meta so the avatar/name match
       // the franchise's CURRENT branding (per user requirement: "most recent
       // logos in every table").
      allTimeBestByTeam = Object.values(bestByTeam)
        .filter((r) => r.reg || r.playoff)
        .map((r) => ({ ...r, meta: latestMetaFor(r.meta) || r.meta }))
        .sort((a, b) => String(a.meta?.team_name || '').localeCompare(String(b.meta?.team_name || '')));
    } catch (e) {
      console.error('[Records-Player] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  function onSeasonChange(e) {
    selectedSeason = e.target.value;
    goto(`?season=${encodeURIComponent(selectedSeason)}`, { replaceState: true, keepFocus: true, noScroll: true });
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
        <p class="page-sub">Per-season MVP awards and the all-time single-season scoring leaders by team.</p>
      </div>
    </div>
  </header>

  {#if loading}
    <SkeletonLoader variant="row" count={6} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="player records" />
  {:else}
    <section class="block">
      <div class="block-head">
        <div class="block-head-text">
          <h2 class="block-title">Season MVPs · {selectedSeason}</h2>
          <span class="block-sub">Regular Season · Playoffs · Finals</span>
        </div>
        <div class="block-head-select">
          <label for="season-select" class="visually-hidden">Season</label>
          <select id="season-select" on:change={onSeasonChange} value={selectedSeason} data-testid="player-season-select">
            {#each seasons as s}<option value={s.season ?? s.league_id}>{s.season ?? s.name}</option>{/each}
          </select>
        </div>
      </div>
      <div class="mvp-grid">
        <div class="mvp-card" data-testid="mvp-overall">
          <div class="mvp-label">Regular Season MVP</div>
          {#if om}
            <div class="mvp-body">
              <img class="mvp-headshot" src={playerHeadshot(om.playerId) || avatarOrPh(rosterInfo(om).teamAvatar, om.playerName)} alt={om.playerName} on:error={(e) => (e.currentTarget.src = avatarOrPh(rosterInfo(om).teamAvatar, om.playerName))} />
              <div>
                <div class="mvp-player-name">{om.playerName}</div>
                <div class="mvp-pts num">{fmt(om.points)}<span class="pts-label"> PTS</span></div>
                <div class="mvp-team">
                  <img class="team-mini" src={avatarOrPh(rosterInfo(om).teamAvatar, rosterInfo(om).teamName)} alt={rosterInfo(om).teamName} />
                  <div><div class="t-name">{rosterInfo(om).teamName}</div><div class="t-owner">{rosterInfo(om).ownerName}</div></div>
                </div>
              </div>
            </div>
          {:else}<div class="mvp-empty">No Regular Season MVP data.</div>{/if}
        </div>
        <div class="mvp-card" data-testid="mvp-playoffs">
          <div class="mvp-label">Playoffs MVP</div>
          {#if pm}
            <div class="mvp-body">
              <img class="mvp-headshot" src={playerHeadshot(pm.playerId) || avatarOrPh(rosterInfo(pm).teamAvatar, pm.playerName)} alt={pm.playerName} on:error={(e) => (e.currentTarget.src = avatarOrPh(rosterInfo(pm).teamAvatar, pm.playerName))} />
              <div>
                <div class="mvp-player-name">{pm.playerName}</div>
                <div class="mvp-pts num">{fmt(pm.points)}<span class="pts-label"> PTS</span></div>
                <div class="mvp-team">
                  <img class="team-mini" src={avatarOrPh(rosterInfo(pm).teamAvatar, rosterInfo(pm).teamName)} alt={rosterInfo(pm).teamName} />
                  <div><div class="t-name">{rosterInfo(pm).teamName}</div><div class="t-owner">{rosterInfo(pm).ownerName}</div></div>
                </div>
              </div>
            </div>
          {:else}<div class="mvp-empty">No Playoffs MVP data.</div>{/if}
        </div>
        <div class="mvp-card" data-testid="mvp-finals">
          <div class="mvp-label">Finals MVP</div>
          {#if fm}
            <div class="mvp-body">
              <img class="mvp-headshot" src={playerHeadshot(fm.playerId) || avatarOrPh(rosterInfo(fm).teamAvatar, fm.playerName)} alt={fm.playerName} on:error={(e) => (e.currentTarget.src = avatarOrPh(rosterInfo(fm).teamAvatar, fm.playerName))} />
              <div>
                <div class="mvp-player-name">{fm.playerName}</div>
                <div class="mvp-pts num">{fmt(fm.points)}<span class="pts-label"> PTS</span></div>
                <div class="mvp-team">
                  <img class="team-mini" src={avatarOrPh(rosterInfo(fm).teamAvatar, rosterInfo(fm).teamName)} alt={rosterInfo(fm).teamName} />
                  <div><div class="t-name">{rosterInfo(fm).teamName}</div><div class="t-owner">{rosterInfo(fm).ownerName}</div></div>
                </div>
              </div>
            </div>
          {:else}<div class="mvp-empty">No Finals MVP data.</div>{/if}
        </div>
      </div>
    </section>

    <section class="block">
      <div class="block-head"><h2 class="block-title">All-Time Single-Season Playoff Best</h2><span class="block-sub">Per team · 2022 → present</span></div>
      {#if allTimePlayoff.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead><tr><th>Team</th><th>Top Scorer</th><th title="Season the record was set">Season</th><th class="col-num" title="Games started (= weeks the player was in a starter slot during the playoff window)">GS</th><th class="col-num" title="Average points per game started during the playoff window">PPG (Started)</th><th class="col-num" title="Total playoff points scored that season">Playoff PTS</th></tr></thead>
            <tbody>
              {#each allTimePlayoff as row (row.rosterId)}
                <tr>
                  <td><TeamBadge meta={{ team_name: row.teamName, owner_name: row.owner_name, team_avatar: row.teamAvatar, owner_username: row.owner_username }} size="sm" href={!!row.owner_username} /></td>
                  <td><div class="player-cell"><img class="headshot" src={playerHeadshot(row.playerId)} alt={row.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} /><div class="player-name-cell">{row.playerName ?? `Player ${row.playerId}`}</div></div></td>
                  <td><span class="num accent-text">{row.season}</span></td>
                  <td class="col-num"><span class="num muted">{row.gamesStarted || 0}</span></td>
                  <td class="col-num"><span class="num">{row.gamesStarted > 0 ? fmt(row.points / row.gamesStarted) : '—'}</span></td>
                  <td class="col-num"><span class="num bigpts">{fmt(row.points)}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}<div class="empty-card">No playoff data.</div>{/if}
    </section>

    <section class="block" data-testid="all-time-best-by-team">
      <div class="block-head">
        <h2 class="block-title">All-Time Best Player · By Team</h2>
        <span class="block-sub">Highest single-season scorer ever · regular vs playoffs</span>
      </div>
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
                    <TeamBadge meta={row.meta} size="md" href={!!row.meta?.owner_username} />
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
                  <td class="col-num">
                    {#if row.reg}
                      <span class="num bigpts">{fmt(row.reg.points)}</span>
                      <div class="ppg-sub">{row.reg.gamesStarted || 0} GS · {row.reg.ppg ? fmt(row.reg.ppg) : '—'} PPG</div>
                    {:else}<span class="muted">—</span>{/if}
                  </td>
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
                  <td class="col-num">
                    {#if row.playoff}
                      <span class="num bigpts">{fmt(row.playoff.points)}</span>
                      <div class="ppg-sub">{row.playoff.gamesStarted || 0} GS · {row.playoff.ppg ? fmt(row.playoff.ppg) : '—'} PPG</div>
                    {:else}<span class="muted">—</span>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}<div class="empty-card">No team data yet.</div>{/if}
    </section>

    <section class="block" id="all-time-playoffs-leaderboard" data-testid="all-time-playoffs-leaderboard">
      <div class="block-head">
        <h2 class="block-title">Playoffs MVP · All-Time Leaderboard</h2>
        <span class="block-sub">Cumulative playoff points · every season</span>
      </div>
      {#if allTimePlayoffsLeaderboard.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead>
              <tr>
                <th style="width:60px;" title="Rank by cumulative playoff scoring">Rank</th>
                <th>Player</th>
                <th class="col-num" title="Sum of playoff points across every season played">Total Playoff PTS</th>
                <th class="col-num" title="Average points per playoff game started across every season">PPG (Started)</th>
                <th class="col-num" title="Highest single-season playoff total + year it happened">Best Single Run</th>
                <th class="col-num" title="Number of seasons this player has played in BFA playoffs">Playoffs Made</th>
                <th title="Franchise currently rostering this player">Current Team</th>
              </tr>
            </thead>
            <tbody>
              {#each allTimePlayoffsLeaderboard as row, idx (row.playerId)}
                <tr>
                  <td class="rank-cell"><span class="num rank-num">{idx + 1}</span></td>
                  <td>
                    <div class="player-cell">
                      <img class="headshot" src={playerHeadshot(row.playerId)} alt={row.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                      <div class="player-name-cell">{row.playerName ?? `Player ${row.playerId}`}</div>
                    </div>
                  </td>
                  <td class="col-num"><span class="num bigpts">{fmt(row.totalPoints)}</span></td>
                  <td class="col-num"><span class="num">{row.ppg ? fmt(row.ppg) : '—'}</span></td>
                  <td class="col-num"><span class="num">{fmt(row.best)} <span class="best-season">'{String(row.bestSeason).slice(-2)}</span></span></td>
                  <td class="col-num"><span class="num">{row.appearances}</span></td>
                  <td>
                    {#if row.latestRoster}
                      <TeamBadge meta={row.latestRoster} size="sm" href={!!row.latestRoster.owner_username} />
                    {:else}
                      <span class="muted">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}<div class="empty-card">No playoff data yet.</div>{/if}
    </section>

    <section class="block">
      <div class="block-head"><h2 class="block-title">All-Time Single-Season Full-Season Best</h2><span class="block-sub">Per team · regular + playoffs</span></div>
      {#if allTimeFull.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead><tr><th>Team</th><th>Top Scorer</th><th title="Season the record was set">Season</th><th class="col-num" title="Games started (regular + playoffs)">GS</th><th class="col-num" title="Average points per game started across the full season">PPG (Started)</th><th class="col-num" title="Total points (regular season + playoffs)">Total PTS</th></tr></thead>
            <tbody>
              {#each allTimeFull as row (row.rosterId)}
                <tr>
                  <td><TeamBadge meta={{ team_name: row.teamName, owner_name: row.owner_name, team_avatar: row.teamAvatar, owner_username: row.owner_username }} size="sm" href={!!row.owner_username} /></td>
                  <td><div class="player-cell"><img class="headshot" src={playerHeadshot(row.playerId)} alt={row.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} /><div class="player-name-cell">{row.playerName ?? `Player ${row.playerId}`}</div></div></td>
                  <td><span class="num accent-text">{row.season}</span></td>
                  <td class="col-num"><span class="num muted">{row.gamesStarted || 0}</span></td>
                  <td class="col-num"><span class="num">{row.gamesStarted > 0 ? fmt(row.points / row.gamesStarted) : '—'}</span></td>
                  <td class="col-num"><span class="num bigpts">{fmt(row.points)}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}<div class="empty-card">No full-season data.</div>{/if}
    </section>
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .head-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; flex-wrap: wrap; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; text-transform: uppercase; margin: 0.4rem 0 0; }

  .block { background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; margin-bottom: 1.25rem; }
  .block-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); gap: 1rem; flex-wrap: wrap; }
  .block-head-text { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
  .block-head-select { flex-shrink: 0; }
  .block-head-select select { min-width: 130px; }
  .block-title { font-family: var(--font-display); font-size: 1.3rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .block-sub { color: var(--text-tertiary); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 700; }

  .player-meta-cell { color: var(--text-tertiary); font-size: 0.72rem; margin-top: 0.15rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
  .ppg-sub { color: var(--text-tertiary); font-size: 0.7rem; margin-top: 0.15rem; letter-spacing: 0.05em; font-weight: 600; font-variant-numeric: tabular-nums; }

  /* MVP cards: neutral flat surface, no color tint, no hover effect. */
  .mvp-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; }
  .mvp-card { padding: 1.5rem; border-right: 1px solid var(--border-subtle); }
  .mvp-card:last-child { border-right: none; }
  .mvp-label { font-family: var(--font-body); font-weight: 800; text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.72rem; color: var(--text-tertiary); margin-bottom: 1.25rem; }
  .mvp-pts { color: var(--text-primary); font-size: 1.8rem; margin-bottom: 0.6rem; line-height: 1; }
  .mvp-body { display: flex; gap: 1rem; align-items: flex-start; }
  .mvp-headshot { width: 96px; height: 96px; object-fit: cover; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--border-subtle); flex-shrink: 0; }
  .mvp-player-name { font-family: var(--font-display); font-size: 1.6rem; line-height: 1; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-primary); margin-bottom: 0.5rem; }
  .pts-label { font-family: var(--font-body); font-size: 0.75rem; font-weight: 800; letter-spacing: 0.2em; color: var(--text-tertiary); margin-left: 0.25rem; }
  .mvp-team { display: flex; align-items: center; gap: 0.55rem; padding-top: 0.5rem; border-top: 1px solid var(--border-subtle); }
  .team-mini { width: 32px; height: 32px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); }
  .t-name { font-weight: 700; font-size: 0.85rem; color: var(--text-primary); }
  .t-owner { color: var(--text-tertiary); font-size: 0.75rem; }
  .mvp-empty { color: var(--text-tertiary); padding: 1rem 0; font-style: italic; }

  .table-wrap { overflow-x: auto; }
  .bfa-table { min-width: 720px; }
  .player-cell { display: flex; align-items: center; gap: 0.7rem; }
  .player-name-cell { font-weight: 700; color: var(--text-primary); line-height: 1.15; }
  .bigpts { font-size: 1.15rem; color: var(--accent); font-weight: 700; }
  .accent-text { color: var(--accent); }
  .best-season { color: var(--text-tertiary); font-size: 0.75rem; font-weight: 700; margin-left: 0.25rem; }
  .rank-cell { width: 60px; }
  .rank-num { font-size: 1.4rem; color: var(--accent); font-family: var(--font-display); }
  .muted { color: var(--text-tertiary); }
  .empty-card { padding: 1.5rem; text-align: center; color: var(--text-secondary); }
  @media (max-width: 980px) {
    .mvp-grid { grid-template-columns: 1fr; }
    .mvp-card { border-right: none; border-bottom: 1px solid var(--border-subtle); }
    .mvp-card.finals { border-bottom: none; }
    .mvp-body { flex-direction: column; align-items: center; text-align: center; }
    .mvp-team { justify-content: center; }
  }
  @media (max-width: 720px) {
    .page { padding: 1.75rem 0 3rem; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .block-head { padding: 0.85rem 1rem; }
    .block-head-text { flex: 1; }
    .block-title { font-size: 1.05rem; }
    .block-head-select { width: 100%; }
    .block-head-select select { width: 100%; min-width: 0; }
    .mvp-card { padding: 1.1rem; }
    .mvp-headshot { width: 76px; height: 76px; }
    .mvp-player-name { font-size: 1.3rem; }
    .mvp-pts { font-size: 1.5rem; }
    .headshot { width: 36px; height: 36px; }
    .player-meta-cell { display: none; }
    .bigpts { font-size: 1rem; }
  }
</style>
