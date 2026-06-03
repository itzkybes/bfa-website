<!-- src/routes/records-team/+page.svelte (client-side, bracket-aware, parallelized) -->
<script>
  import { onMount } from 'svelte';
  import { getSeasonsChain, BASE_LEAGUE_ID } from '$lib/sleeperClient.client';
  import { computeStandingsForLeague, computeParticipantPoints } from '$lib/leagueCompute.client';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';

  let loading = true;
  let progress = '';
  let error = null;
  let aggregatedRegular = [];
  let aggregatedPlayoff = [];
  let h2hOwners = [];
  let h2hRecords = {};
  let marginsLargest = [];
  let marginsSmallest = [];
  let selectedH2H = null;

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? name[0].toUpperCase() : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }

  function lastLabel(season, week) {
    if (!season) return '—';
    return `${season} · W${week || ''}`;
  }

  // Stable key across seasons: prefer owner_username (Sleeper username), fallback to owner_name.
  function stableKey(meta) {
    if (!meta) return null;
    const k = meta.owner_username || meta.owner_name || meta.owner_id;
    return k ? String(k).toLowerCase() : null;
  }

  async function loadAll() {
    loading = true; progress = 'Fetching season chain…'; error = null;
    try {
      const { seasons } = await getSeasonsChain(BASE_LEAGUE_ID);
      progress = `Computing ${seasons.length} season(s) in parallel…`;

      // Parallel fetch across all seasons (huge speed boost vs sequential)
      const standingsResults = await Promise.all(
        seasons.map((s) => computeStandingsForLeague(s.league_id).catch((e) => {
          console.warn('season failed', s.season, e);
          return null;
        }))
      );

      progress = 'Aggregating…';

      // ---------- Aggregate regular + playoff by owner_username ----------
      const regAgg = {};
      const poAgg = {};
      const championCounts = {}; // stableKey -> # championships
      const seasonOwnersByRid = {}; // {season: {rid: stableKey}}

      function addRow(agg, row, meta, season) {
        const key = stableKey(meta) || String(row.team_name || row.rosterId).toLowerCase();
        if (!agg[key]) {
          agg[key] = {
            key,
            team_name: row.team_name,
            owner_name: row.owner_name,
            owner_username: meta?.owner_username || null,
            avatar: row.avatar || null,
            wins: 0, losses: 0, ties: 0,
            pf: 0, pa: 0,
            maxWinStreak: 0, maxLoseStreak: 0,
            championships: 0,
            seasons: []
          };
        }
        // Always prefer the most recently seen avatar — seasons iterate
        // oldest → newest, so the last write wins (the current season's logo).
        if (row.avatar) agg[key].avatar = row.avatar;
        // prefer the more "personal" team name (skip "Roster N")
        if (row.team_name && !String(row.team_name).startsWith('Roster ')) agg[key].team_name = row.team_name;
        if (row.owner_name) agg[key].owner_name = row.owner_name;
        agg[key].wins += row.wins || 0;
        agg[key].losses += row.losses || 0;
        agg[key].ties += row.ties || 0;
        agg[key].pf = Math.round((agg[key].pf + (row.pf || 0)) * 100) / 100;
        agg[key].pa = Math.round((agg[key].pa + (row.pa || 0)) * 100) / 100;
        if ((row.maxWinStreak || 0) > agg[key].maxWinStreak) agg[key].maxWinStreak = row.maxWinStreak;
        if ((row.maxLoseStreak || 0) > agg[key].maxLoseStreak) agg[key].maxLoseStreak = row.maxLoseStreak;
        if (season) agg[key].seasons.push(season);
      }

      for (const result of standingsResults) {
        if (!result) continue;
        const rmap = result.rosterMap || {};
        // record championship → owner mapping (only for completed brackets)
        if (result.bracketComplete && result.bracketChampionId) {
          const cmeta = rmap[result.bracketChampionId];
          const ck = stableKey(cmeta);
          if (ck) championCounts[ck] = (championCounts[ck] || 0) + 1;
        }
        // build per-roster ownership map for h2h
        const ridToKey = {};
        for (const rid of Object.keys(rmap)) {
          ridToKey[rid] = stableKey(rmap[rid]) || String(rmap[rid].team_name || rid).toLowerCase();
        }
        seasonOwnersByRid[result.season] = ridToKey;

        for (const row of (result.regularStandings || [])) addRow(regAgg, row, rmap[row.rosterId], result.season);
        for (const row of (result.playoffStandings || [])) addRow(poAgg, row, rmap[row.rosterId], result.season);
      }

      // attach championship counts to playoff rows
      for (const k of Object.keys(poAgg)) poAgg[k].championships = championCounts[k] || 0;
      for (const k of Object.keys(regAgg)) regAgg[k].championships = championCounts[k] || 0;

      aggregatedRegular = Object.values(regAgg).sort((a, b) => (b.wins - a.wins) || (b.pf - a.pf));
      aggregatedPlayoff = Object.values(poAgg).sort((a, b) => {
        if ((b.championships || 0) !== (a.championships || 0)) return (b.championships || 0) - (a.championships || 0);
        return (b.wins - a.wins) || (b.pf - a.pf);
      });

      // ---------- H2H + margins (reuse collectedMatchups from standings results) ----------
      const h2h = {};
      const ownersByKey = {};
      const allMargins = [];

      for (const result of standingsResults) {
        if (!result) continue;
        const rmap = result.rosterMap || {};
        const matchups = result.collectedMatchups || {};
        const leagueSeason = result.season;

        for (const rid of Object.keys(rmap)) {
          const k = stableKey(rmap[rid]) || String(rmap[rid].team_name || rid).toLowerCase();
          if (!ownersByKey[k]) {
            ownersByKey[k] = {
              key: k,
              team: rmap[rid].team_name,
              display: rmap[rid].owner_name,
              avatar: rmap[rid].team_avatar || rmap[rid].owner_avatar
            };
          } else {
            // upgrade missing avatar / team name when a later season has it
            if (!ownersByKey[k].avatar && (rmap[rid].team_avatar || rmap[rid].owner_avatar)) {
              ownersByKey[k].avatar = rmap[rid].team_avatar || rmap[rid].owner_avatar;
            }
            if ((!ownersByKey[k].team || ownersByKey[k].team.startsWith('Roster ')) && rmap[rid].team_name) {
              ownersByKey[k].team = rmap[rid].team_name;
            }
          }
        }

        for (const wk of Object.keys(matchups)) {
          const weekEntries = matchups[wk];
          if (!Array.isArray(weekEntries)) continue;
          // group by matchup_id
          const byM = {};
          for (let i = 0; i < weekEntries.length; i++) {
            const e = weekEntries[i];
            const mid = e.matchup_id ?? e.matchupId ?? ('auto' + i);
            if (!byM[mid]) byM[mid] = [];
            byM[mid].push(e);
          }
          for (const mid of Object.keys(byM)) {
            const arr = byM[mid];
            if (arr.length !== 2) continue;
            const [a, b] = arr;
            const aId = String(a.roster_id ?? a.rosterId ?? '');
            const bId = String(b.roster_id ?? b.rosterId ?? '');
            const aPts = computeParticipantPoints(a);
            const bPts = computeParticipantPoints(b);
            const ak = stableKey(rmap[aId]);
            const bk = stableKey(rmap[bId]);
            if (!ak || !bk) continue;
            const aMeta = rmap[aId] || {};
            const bMeta = rmap[bId] || {};

            // margins (skip ties)
            if (aPts !== bPts) {
              const winMeta = aPts > bPts ? aMeta : bMeta;
              const losMeta = aPts > bPts ? bMeta : aMeta;
              const winPts = aPts > bPts ? aPts : bPts;
              const losPts = aPts > bPts ? bPts : aPts;
              allMargins.push({
                season: leagueSeason, week: Number(wk),
                margin: Math.round((winPts - losPts) * 100) / 100,
                teamAName: winMeta.team_name, teamBName: losMeta.team_name,
                avatarA: winMeta.team_avatar || winMeta.owner_avatar,
                avatarB: losMeta.team_avatar || losMeta.owner_avatar,
                scoreA: Math.round(winPts * 100) / 100,
                scoreB: Math.round(losPts * 100) / 100
              });
            }

            // H2H
            if (!h2h[ak]) h2h[ak] = {};
            if (!h2h[ak][bk]) h2h[ak][bk] = {
              wins: 0, losses: 0, games: 0, pf: 0, pa: 0,
              lastSeason: null, lastWeek: null,
              opponentTeam: bMeta.team_name, opponentDisplay: bMeta.owner_name,
              opponentAvatar: bMeta.team_avatar || bMeta.owner_avatar
            };
            if (!h2h[bk]) h2h[bk] = {};
            if (!h2h[bk][ak]) h2h[bk][ak] = {
              wins: 0, losses: 0, games: 0, pf: 0, pa: 0,
              lastSeason: null, lastWeek: null,
              opponentTeam: aMeta.team_name, opponentDisplay: aMeta.owner_name,
              opponentAvatar: aMeta.team_avatar || aMeta.owner_avatar
            };

            h2h[ak][bk].games++; h2h[ak][bk].pf += aPts; h2h[ak][bk].pa += bPts;
            h2h[ak][bk].lastSeason = leagueSeason; h2h[ak][bk].lastWeek = Number(wk);
            h2h[bk][ak].games++; h2h[bk][ak].pf += bPts; h2h[bk][ak].pa += aPts;
            h2h[bk][ak].lastSeason = leagueSeason; h2h[bk][ak].lastWeek = Number(wk);
            if (aPts > bPts) { h2h[ak][bk].wins++; h2h[bk][ak].losses++; }
            else if (bPts > aPts) { h2h[bk][ak].wins++; h2h[ak][bk].losses++; }
          }
        }
      }

      for (const k of Object.keys(h2h)) for (const o of Object.keys(h2h[k])) {
        h2h[k][o].pf = Math.round(h2h[k][o].pf * 100) / 100;
        h2h[k][o].pa = Math.round(h2h[k][o].pa * 100) / 100;
      }
      h2hOwners = Object.values(ownersByKey).sort((a, b) => String(a.team || '').localeCompare(String(b.team || '')));
      h2hRecords = {};
      for (const k of Object.keys(h2h)) {
        h2hRecords[k] = Object.values(h2h[k]).sort((a, b) => b.wins - a.wins || b.games - a.games);
      }
      if (h2hOwners.length) selectedH2H = h2hOwners[0].key;

      const sorted = allMargins.slice().sort((a, b) => b.margin - a.margin);
      marginsLargest = sorted.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));
      marginsSmallest = sorted.slice(-10).reverse().map((r, i) => ({ ...r, rank: i + 1 }));
    } catch (e) {
      console.error('[Records-Team] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  onMount(loadAll);
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="eyebrow">All-Time · Team Records</div>
    <h1 class="page-title">Team Records</h1>
    <p class="page-sub">Aggregated stats across every available season — head-to-head matchups, biggest blowouts and nailbiters.</p>
  </header>

  {#if loading}
    <div class="loading-card">
      <SkeletonLoader variant="row" count={4} />
      {#if progress}<div class="progress-text">{progress}</div>{/if}
    </div>
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="team records" />
  {:else}
    <section class="block">
      <div class="block-head">
        <h2 class="block-title">Regular Season — Aggregated</h2>
        <span class="block-sub">Sorted by Wins → PF</span>
      </div>
      {#if aggregatedRegular.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead><tr><th>Team</th><th class="col-num" title="All-time regular-season wins">Wins</th><th class="col-num" title="All-time regular-season losses">Losses</th><th class="col-num" title="Best win streak ever, in any season">Best Streak</th><th class="col-num" title="Worst lose streak ever, in any season">Worst Streak</th><th class="col-num" title="All-time points scored">Points For</th><th class="col-num" title="All-time points allowed">Points Against</th></tr></thead>
            <tbody>
              {#each aggregatedRegular as row (row.key)}
                <tr>
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
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="empty-card">No regular season results.</div>
      {/if}
    </section>

    <section class="block">
      <div class="block-head">
        <h2 class="block-title">Playoffs — Aggregated</h2>
        <span class="block-sub">🏆 = championship · sorted by titles → wins</span>
      </div>
      {#if aggregatedPlayoff.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead><tr><th>Team</th><th class="col-num" title="Total championships won">Championships</th><th class="col-num" title="Playoff wins all-time">Playoff Wins</th><th class="col-num" title="Playoff losses all-time">Playoff Losses</th><th class="col-num" title="Total playoff points scored">Playoff PF</th><th class="col-num" title="Total playoff points allowed">Playoff PA</th></tr></thead>
            <tbody>
              {#each aggregatedPlayoff as row (row.key)}
                <tr class:champion-row={(row.championships || 0) > 0}>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPh(row.avatar, row.team_name)} alt={row.team_name} />
                      <div>
                        <div class="team-name-cell">
                          {row.team_name}
                          {#if (row.championships || 0) > 0}
                            <span class="trophies" title={`${row.championships} championship${row.championships > 1 ? 's' : ''}`}>
                              {#each Array(row.championships) as _, i}<span>🏆</span>{/each}
                            </span>
                          {/if}
                        </div>
                        {#if row.owner_name}<div class="team-owner-cell">{row.owner_name}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td class="col-num">
                    {#if (row.championships || 0) > 0}
                      <span class="num title-count">{row.championships}</span>
                    {:else}
                      <span class="num muted">—</span>
                    {/if}
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

    <section class="block">
      <div class="block-head">
        <h2 class="block-title">Head-to-Head</h2>
        <div class="h2h-select-wrap">
          <label for="h2h-select" class="visually-hidden">Team</label>
          <select id="h2h-select" bind:value={selectedH2H} data-testid="h2h-team-select">
            {#each h2hOwners as o}<option value={o.key}>{o.team || o.display}</option>{/each}
          </select>
        </div>
      </div>

      {#if selectedH2H && h2hRecords[selectedH2H]?.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead><tr><th>Opponent</th><th class="col-num" title="Head-to-head wins vs this opponent">Wins</th><th class="col-num" title="Head-to-head losses vs this opponent">Losses</th><th class="col-num" title="Total times the two teams have played">Games Played</th><th class="col-num" title="Points scored against this opponent">Points For</th><th class="col-num" title="Points allowed to this opponent">Points Against</th><th class="col-num" title="Most recent season they played">Last Met</th></tr></thead>
            <tbody>
              {#each h2hRecords[selectedH2H] as r}
                <tr>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPh(r.opponentAvatar, r.opponentTeam || r.opponentDisplay)} alt={r.opponentTeam} />
                      <div>
                        <div class="team-name-cell">{r.opponentTeam || r.opponentDisplay}</div>
                        {#if r.opponentDisplay && r.opponentTeam}<div class="team-owner-cell">{r.opponentDisplay}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td class="col-num"><span class="num win-color">{r.wins}</span></td>
                  <td class="col-num"><span class="num loss-color">{r.losses}</span></td>
                  <td class="col-num"><span class="num muted">{r.games}</span></td>
                  <td class="col-num"><span class="num">{r.pf}</span></td>
                  <td class="col-num"><span class="num muted">{r.pa}</span></td>
                  <td class="col-num"><span class="num muted">{lastLabel(r.lastSeason, r.lastWeek)}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="empty-card">No head-to-head data for selected team.</div>
      {/if}
    </section>

    <div class="margins-grid">
      <section class="block">
        <div class="block-head"><h2 class="block-title">Largest Margins</h2><span class="block-sub">Top 10 blowouts</span></div>
        {#if marginsLargest.length}
          <div class="margin-list">
            {#each marginsLargest as row}
              <div class="margin-row">
                <div class="margin-rank num">#{row.rank}</div>
                <div class="margin-teams">
                  <div class="m-side"><img class="team-avatar small" src={avatarOrPh(row.avatarA, row.teamAName)} alt={row.teamAName} /><div class="m-mini"><div class="m-mini-name">{row.teamAName}</div><div class="m-mini-score num">{row.scoreA}</div></div></div>
                  <div class="margin-value num">+{row.margin}</div>
                  <div class="m-side right"><div class="m-mini"><div class="m-mini-name">{row.teamBName}</div><div class="m-mini-score num">{row.scoreB}</div></div><img class="team-avatar small" src={avatarOrPh(row.avatarB, row.teamBName)} alt={row.teamBName} /></div>
                </div>
                <div class="margin-meta">S{row.season} · W{row.week}</div>
              </div>
            {/each}
          </div>
        {:else}<div class="empty-card">No margin data.</div>{/if}
      </section>

      <section class="block">
        <div class="block-head"><h2 class="block-title">Smallest Margins</h2><span class="block-sub">Top 10 nailbiters</span></div>
        {#if marginsSmallest.length}
          <div class="margin-list">
            {#each marginsSmallest as row}
              <div class="margin-row">
                <div class="margin-rank num">#{row.rank}</div>
                <div class="margin-teams">
                  <div class="m-side"><img class="team-avatar small" src={avatarOrPh(row.avatarA, row.teamAName)} alt={row.teamAName} /><div class="m-mini"><div class="m-mini-name">{row.teamAName}</div><div class="m-mini-score num">{row.scoreA}</div></div></div>
                  <div class="margin-value tight num">{row.margin}</div>
                  <div class="m-side right"><div class="m-mini"><div class="m-mini-name">{row.teamBName}</div><div class="m-mini-score num">{row.scoreB}</div></div><img class="team-avatar small" src={avatarOrPh(row.avatarB, row.teamBName)} alt={row.teamBName} /></div>
                </div>
                <div class="margin-meta">S{row.season} · W{row.week}</div>
              </div>
            {/each}
          </div>
        {:else}<div class="empty-card">No margin data.</div>{/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; text-transform: uppercase; margin: 0.4rem 0 0.5rem; }
  .page-sub { color: var(--text-secondary); max-width: 60ch; }

  .loading-card {
    padding: 1rem;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
  }
  .progress-text {
    color: var(--accent);
    font-family: var(--font-body);
    font-weight: 700;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    text-align: center;
    margin-top: 0.5rem;
  }

  .block { background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; margin-bottom: 1.25rem; }
  .block-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); gap: 1rem; flex-wrap: wrap; }
  .block-title { font-family: var(--font-display); font-size: 1.3rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .block-sub { color: var(--text-tertiary); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 700; }
  .table-wrap { overflow-x: auto; }
  .bfa-table { min-width: 700px; }
  .team-cell { display: flex; align-items: center; gap: 0.75rem; }
  .team-avatar.small { width: 42px; height: 42px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); }
  .team-name-cell { font-weight: 700; color: var(--text-primary); line-height: 1.15; display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
  .team-owner-cell { color: var(--text-tertiary); font-size: 0.78rem; margin-top: 0.15rem; }
  .trophies { display: inline-flex; gap: 0.1rem; font-size: 0.95rem; }
  .pf .num { font-weight: 800; }
  .num.muted { color: var(--text-tertiary); }
  .title-count { color: var(--gold); font-size: 1.2rem; font-weight: 800; }
  .win-color { color: var(--win); }
  .loss-color { color: var(--loss); }
  .empty-card { padding: 1.5rem; text-align: center; color: var(--text-secondary); }
  .margins-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .margin-list { padding: 0.5rem 0; }
  .margin-row { display: grid; grid-template-columns: 50px 1fr auto; gap: 0.75rem; align-items: center; padding: 0.65rem 1rem; border-bottom: 1px solid var(--border-subtle); }
  .margin-row:last-child { border-bottom: none; }
  .margin-rank { font-size: 1.1rem; color: var(--accent); }
  .margin-teams { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 0.5rem; min-width: 0; }
  .m-side { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  .m-side.right { justify-content: flex-end; flex-direction: row; }
  .m-mini { min-width: 0; }
  .m-side.right .m-mini { text-align: right; }
  .m-mini-name { font-weight: 600; font-size: 0.82rem; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .m-mini-score { color: var(--text-secondary); font-size: 0.85rem; }
  .margin-value { background: var(--surface-2); border: 1px solid var(--border-subtle); padding: 0.25rem 0.55rem; border-radius: var(--r-sm); color: var(--accent); font-size: 1.1rem; }
  .margin-value.tight { color: var(--win); border-color: var(--win); }
  .margin-meta { color: var(--text-tertiary); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
  @media (max-width: 980px) { .margins-grid { grid-template-columns: 1fr; } }
  @media (max-width: 720px) {
    .page { padding: 1.75rem 0 3rem; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .page-sub { font-size: 0.9rem; }
    .block-head { padding: 0.85rem 1rem; }
    .block-title { font-size: 1.05rem; }
    .block-head select { width: 100%; min-width: 0; }
    .h2h-select-wrap { width: 100%; }
    .team-avatar.small { width: 34px; height: 34px; }
    .team-owner-cell { display: none; }
    .margin-row { grid-template-columns: 40px 1fr; padding: 0.55rem 0.75rem; }
    .margin-meta { grid-column: 2; }
    .margin-teams { grid-template-columns: 1fr; gap: 0.4rem; }
    .m-side.right { justify-content: flex-start; flex-direction: row-reverse; }
    .margin-value { justify-self: start; }
  }
</style>
