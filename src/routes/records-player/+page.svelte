<!-- src/routes/records-player/+page.svelte (client-side fetched) -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getSeasonsChain, BASE_LEAGUE_ID, getMatchupsForWeek, getRosterMapWithOwners, getPlayersNba, playerHeadshot, getLeague } from '$lib/sleeperClient.client';
  import { computeStandingsForLeague, fetchStaticJson, HARDCODED_CHAMPIONS } from '$lib/leagueCompute.client';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';

  let loading = true;
  let error = null;
  let seasons = [];
  let selectedSeason = null;
  let seasonsResults = [];   // [{ season, overallMvp, finalsMvp, teamLeaders[] }]
  let allTimePlayoff = [];
  let allTimeFull = [];
  let playersMap = {};

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? name[0].toUpperCase() : 'P';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }
  function fmt(v) {
    const n = Number(v); if (!isFinite(n)) return '—';
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function playerName(pid) {
    if (!pid) return '';
    const p = playersMap[pid];
    if (!p) return String(pid);
    return p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || String(pid);
  }

  $: selectedRow = seasonsResults.find(r => String(r.season) === String(selectedSeason)) ?? null;
  $: om = selectedRow?.overallMvp ?? null;
  $: pm = selectedRow?.playoffsMvp ?? null;
  $: fm = selectedRow?.finalsMvp ?? null;

  // Aggregate player points across multiple matchups
  function aggregatePlayerPoints(matchupEntries) {
    // For each roster, sum every starter's points across all entries
    const byPlayer = {}; // pid -> { points, rosterId }
    for (const entry of matchupEntries) {
      if (!entry) continue;
      const rid = String(entry.roster_id ?? entry.rosterId ?? '');
      const starters = Array.isArray(entry.starters) ? entry.starters : [];
      const pts = entry.starters_points || entry.player_points || null;
      if (pts && typeof pts === 'object') {
        for (const pid of starters) {
          if (!pid) continue;
          let val = 0;
          if (Array.isArray(pts)) {
            const idx = starters.indexOf(pid);
            val = Number(pts[idx] ?? 0);
          } else {
            val = Number(pts[String(pid)] ?? 0);
          }
          if (!isFinite(val)) val = 0;
          if (!byPlayer[pid]) byPlayer[pid] = { playerId: pid, points: 0, rosterId: rid };
          byPlayer[pid].points += val;
        }
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
      const latest = chain.length ? chain[chain.length - 1] : null;
      selectedSeason = urlSeason || (latest?.season != null ? String(latest.season) : String(latest?.league_id || BASE_LEAGUE_ID));

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

        const overallList = Object.values(fullByPlayer).sort((a, b) => b.points - a.points);
        const playoffsList = Object.values(playoffByPlayer).sort((a, b) => b.points - a.points);

        // Finals MVP = top scorer in the championship game (across BOTH finalists)
        const finalsMvp = finalsList[0] || null;
        // Playoffs MVP = top cumulative scorer across the entire playoff window
        const playoffsMvp = playoffsList[0] || null;

        // team leaders (top scorer per roster, full season)
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
          overallMvp: overallList[0]
            ? { ...overallList[0], playerName: null, roster_meta: rosterMap[overallList[0].rosterId] }
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
          playoffByPlayer
        };
      }));

      playersMap = await playersPromise;
      seasonsResults = allResults;
      // resolve player names now that playersMap is loaded
      for (const r of seasonsResults) {
        if (r.overallMvp) r.overallMvp.playerName = playerName(r.overallMvp.playerId);
        if (r.playoffsMvp) r.playoffsMvp.playerName = playerName(r.playoffsMvp.playerId);
        if (r.finalsMvp) r.finalsMvp.playerName = playerName(r.finalsMvp.playerId);
      }
      seasonsResults = seasonsResults; // force reactivity

      // All-time playoff best per roster
      const allTimePlayoffMap = {}; // rid -> { rosterId, playerId, points, season, ... }
      for (const r of seasonsResults) {
        for (const [pid, info] of Object.entries(r.playoffByPlayer || {})) {
          const rid = info.rosterId;
          if (!allTimePlayoffMap[rid] || info.points > allTimePlayoffMap[rid].points) {
            const meta = r.rosterMap[rid] || {};
            allTimePlayoffMap[rid] = {
              rosterId: rid, playerId: pid, playerName: playerName(pid), points: info.points,
              season: r.season, teamName: meta.team_name, owner_name: meta.owner_name, teamAvatar: meta.team_avatar
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
            allTimeFullMap[rid] = {
              rosterId: rid, playerId: pid, playerName: playerName(pid), points: info.points,
              season: r.season, teamName: meta.team_name, owner_name: meta.owner_name, teamAvatar: meta.team_avatar
            };
          }
        }
      }
      allTimeFull = Object.values(allTimeFullMap).sort((a,b) => b.points - a.points);
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
      <div>
        <label for="season-select" class="visually-hidden">Season</label>
        <select id="season-select" on:change={onSeasonChange} value={selectedSeason} data-testid="player-season-select">
          {#each seasons as s}<option value={s.season ?? s.league_id}>{s.season ?? s.name}</option>{/each}
        </select>
      </div>
    </div>
  </header>

  {#if loading}
    <SkeletonLoader variant="row" count={6} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="player records" />
  {:else}
    <section class="block">
      <div class="block-head"><h2 class="block-title">Season MVPs · {selectedSeason}</h2><span class="block-sub">Overall · Playoffs · Finals</span></div>
      <div class="mvp-grid">
        <div class="mvp-card" data-testid="mvp-overall">
          <div class="mvp-label">Overall MVP</div>
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
          {:else}<div class="mvp-empty">No Overall MVP data.</div>{/if}
        </div>
        <div class="mvp-card playoffs" data-testid="mvp-playoffs">
          <div class="mvp-label playoffs">Playoffs MVP</div>
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
        <div class="mvp-card finals" data-testid="mvp-finals">
          <div class="mvp-label finals">Finals MVP</div>
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
            <thead><tr><th>Team</th><th>Player</th><th>Season</th><th class="col-num">PTS</th></tr></thead>
            <tbody>
              {#each allTimePlayoff as row (row.rosterId)}
                <tr>
                  <td><div class="team-cell"><img class="team-avatar small" src={avatarOrPh(row.teamAvatar, row.teamName)} alt={row.teamName} /><div><div class="team-name-cell">{row.teamName}</div><div class="team-owner-cell">{row.owner_name}</div></div></div></td>
                  <td><div class="player-cell"><img class="headshot" src={playerHeadshot(row.playerId)} alt={row.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} /><div class="player-name-cell">{row.playerName ?? `Player ${row.playerId}`}</div></div></td>
                  <td><span class="num accent-text">{row.season}</span></td>
                  <td class="col-num"><span class="num bigpts">{fmt(row.points)}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}<div class="empty-card">No playoff data.</div>{/if}
    </section>

    <section class="block">
      <div class="block-head"><h2 class="block-title">All-Time Single-Season Full-Season Best</h2><span class="block-sub">Per team · regular + playoffs</span></div>
      {#if allTimeFull.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead><tr><th>Team</th><th>Player</th><th>Season</th><th class="col-num">PTS</th></tr></thead>
            <tbody>
              {#each allTimeFull as row (row.rosterId)}
                <tr>
                  <td><div class="team-cell"><img class="team-avatar small" src={avatarOrPh(row.teamAvatar, row.teamName)} alt={row.teamName} /><div><div class="team-name-cell">{row.teamName}</div><div class="team-owner-cell">{row.owner_name}</div></div></div></td>
                  <td><div class="player-cell"><img class="headshot" src={playerHeadshot(row.playerId)} alt={row.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} /><div class="player-name-cell">{row.playerName ?? `Player ${row.playerId}`}</div></div></td>
                  <td><span class="num accent-text">{row.season}</span></td>
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
  .block-title { font-family: var(--font-display); font-size: 1.3rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .block-sub { color: var(--text-tertiary); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 700; }

  .mvp-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; }
  .mvp-card { padding: 1.5rem; border-right: 1px solid var(--border-subtle); }
  .mvp-card.playoffs { background: linear-gradient(180deg, rgba(56, 49, 219, 0.06), transparent); }
  .mvp-card.finals { border-right: none; background: linear-gradient(180deg, rgba(227, 119, 47, 0.05), transparent); }
  .mvp-label { font-family: var(--font-body); font-weight: 800; text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.72rem; color: var(--text-tertiary); margin-bottom: 1.25rem; }
  .mvp-label.playoffs { color: var(--brand); }
  .mvp-label.finals { color: var(--accent); }
  .mvp-body { display: flex; gap: 1rem; align-items: flex-start; }
  .mvp-headshot { width: 96px; height: 96px; object-fit: cover; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--border-subtle); flex-shrink: 0; }
  .mvp-player-name { font-family: var(--font-display); font-size: 1.6rem; line-height: 1; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-primary); margin-bottom: 0.5rem; }
  .mvp-pts { color: var(--accent); font-size: 1.8rem; margin-bottom: 0.6rem; line-height: 1; }
  .pts-label { font-family: var(--font-body); font-size: 0.75rem; font-weight: 800; letter-spacing: 0.2em; color: var(--text-tertiary); margin-left: 0.25rem; }
  .mvp-team { display: flex; align-items: center; gap: 0.55rem; padding-top: 0.5rem; border-top: 1px solid var(--border-subtle); }
  .team-mini { width: 32px; height: 32px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); }
  .t-name { font-weight: 700; font-size: 0.85rem; color: var(--text-primary); }
  .t-owner { color: var(--text-tertiary); font-size: 0.75rem; }
  .mvp-empty { color: var(--text-tertiary); padding: 1rem 0; font-style: italic; }

  .table-wrap { overflow-x: auto; }
  .bfa-table { min-width: 720px; }
  .team-cell, .player-cell { display: flex; align-items: center; gap: 0.7rem; }
  .team-avatar.small { width: 42px; height: 42px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); }
  .team-name-cell, .player-name-cell { font-weight: 700; color: var(--text-primary); line-height: 1.15; }
  .team-owner-cell { color: var(--text-tertiary); font-size: 0.78rem; margin-top: 0.15rem; }
  .bigpts { font-size: 1.15rem; color: var(--accent); font-weight: 700; }
  .accent-text { color: var(--accent); }
  .empty-card { padding: 1.5rem; text-align: center; color: var(--text-secondary); }
  @media (max-width: 980px) {
    .mvp-grid { grid-template-columns: 1fr; }
    .mvp-card { border-right: none; border-bottom: 1px solid var(--border-subtle); }
    .mvp-card.finals { border-bottom: none; }
    .mvp-body { flex-direction: column; align-items: center; text-align: center; }
    .mvp-team { justify-content: center; }
  }
</style>
