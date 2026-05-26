<!-- src/routes/records-team/+page.svelte (client-side fetched, aggregated across seasons) -->
<script>
  import { onMount } from 'svelte';
  import { getSeasonsChain, BASE_LEAGUE_ID, getMatchupsForWeek, getRosterMapWithOwners, getLeague } from '$lib/sleeperClient.client';
  import { computeStandingsForLeague, fetchStaticJson, computeParticipantPoints, computeStreaks } from '$lib/leagueCompute.client';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';

  let loading = true;
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

  // Aggregate across seasons using "owner_username" or "team_name" as a stable key
  function ownerKey(meta) {
    if (!meta) return null;
    return String(meta.owner_username || meta.owner_name || meta.team_name || meta.roster_id || '').toLowerCase();
  }

  async function loadAll() {
    loading = true;
    error = null;
    try {
      const { seasons } = await getSeasonsChain(BASE_LEAGUE_ID);
      // For each season, compute standings + collect matchups for margin analysis
      const allLeagueData = await Promise.all(seasons.map(async (s) => {
        const standings = await computeStandingsForLeague(s.league_id);
        return { season: s, standings };
      }));

      // ---------- Aggregate regular + playoff ----------
      const regAgg = {};
      const poAgg = {};
      function add(agg, row, season) {
        const key = String(row.owner_name || row.team_name || row.rosterId).toLowerCase();
        if (!agg[key]) agg[key] = { ...row, wins:0, losses:0, ties:0, pf:0, pa:0, maxWinStreak:0, maxLoseStreak:0, seasons:[] };
        agg[key].wins += row.wins || 0;
        agg[key].losses += row.losses || 0;
        agg[key].ties += row.ties || 0;
        agg[key].pf = Math.round((agg[key].pf + (row.pf || 0)) * 100) / 100;
        agg[key].pa = Math.round((agg[key].pa + (row.pa || 0)) * 100) / 100;
        if ((row.maxWinStreak || 0) > agg[key].maxWinStreak) agg[key].maxWinStreak = row.maxWinStreak;
        if ((row.maxLoseStreak || 0) > agg[key].maxLoseStreak) agg[key].maxLoseStreak = row.maxLoseStreak;
        if (row.champion) agg[key].champion = true;
        if (season) agg[key].seasons.push(season);
      }
      for (const { season, standings } of allLeagueData) {
        for (const row of standings.regularStandings) add(regAgg, row, season.season);
        for (const row of standings.playoffStandings) add(poAgg, row, season.season);
      }
      aggregatedRegular = Object.values(regAgg).sort((a,b) => (b.wins - a.wins) || (b.pf - a.pf));
      aggregatedPlayoff = Object.values(poAgg).sort((a,b) => {
        if (a.champion && !b.champion) return -1;
        if (b.champion && !a.champion) return 1;
        return (b.wins - a.wins) || (b.pf - a.pf);
      });

      // ---------- H2H matrix ----------
      const h2h = {}; // ownerKey -> { opponentKey -> { wins, losses, games, pf, pa, lastSeason, lastWeek, opponentTeam, opponentDisplay, opponentAvatar } }
      const ownersByKey = {}; // for dropdown
      const allMargins = []; // for margin calcs

      for (const { season: s, standings } of allLeagueData) {
        const { rosterMap, leagueSeason, playoffStart, playoffEnd } = standings;
        // collect roster->key + display
        const ridToKey = {};
        for (const rid of Object.keys(rosterMap)) {
          const meta = rosterMap[rid];
          const k = String(meta.team_name || meta.owner_name || rid).toLowerCase();
          ridToKey[rid] = k;
          if (!ownersByKey[k]) ownersByKey[k] = { key: k, team: meta.team_name, display: meta.owner_name, avatar: meta.team_avatar };
        }

        // Fetch matchups for all weeks of this season (we already triggered some via standings calc; refetch from cache)
        for (let week = 1; week <= 22; week++) {
          let raw = null;
          // try seasonMatchups JSON first
          if (leagueSeason && ['2022','2023','2024'].includes(leagueSeason)) {
            const sm = await fetchStaticJson(`/season_matchups/${leagueSeason}.json`);
            if (sm && sm[String(week)]) {
              raw = sm[String(week)].map(m => [
                { roster_id: m.teamA?.rosterId, points: m.teamAScore ?? m.teamA?.points },
                { roster_id: m.teamB?.rosterId, points: m.teamBScore ?? m.teamB?.points }
              ]).flat().filter(r => r.roster_id != null);
              // simulate matchup_id for pairing
              raw = sm[String(week)].flatMap((m, i) => {
                const mid = m.matchup_id ?? i;
                return [
                  m.teamA ? { matchup_id: mid, roster_id: String(m.teamA.rosterId), points: Number(m.teamAScore ?? m.teamA.points ?? 0) } : null,
                  m.teamB ? { matchup_id: mid, roster_id: String(m.teamB.rosterId), points: Number(m.teamBScore ?? m.teamB.points ?? 0) } : null
                ].filter(Boolean);
              });
            }
          }
          if (!raw) {
            try { raw = await getMatchupsForWeek(s.league_id, week); } catch (e) { raw = null; }
          }
          if (!Array.isArray(raw) || !raw.length) continue;
          // group by matchup_id
          const byM = {};
          for (let i = 0; i < raw.length; i++) {
            const m = raw[i];
            const mid = m.matchup_id ?? m.matchupId ?? ('auto'+i);
            if (!byM[mid]) byM[mid] = [];
            byM[mid].push(m);
          }
          for (const mid of Object.keys(byM)) {
            const arr = byM[mid];
            if (arr.length !== 2) continue;
            const [a, b] = arr;
            const aId = String(a.roster_id ?? a.rosterId ?? '');
            const bId = String(b.roster_id ?? b.rosterId ?? '');
            const aPts = computeParticipantPoints(a);
            const bPts = computeParticipantPoints(b);
            const ak = ridToKey[aId];
            const bk = ridToKey[bId];
            if (!ak || !bk) continue;
            const aMeta = rosterMap[aId] || {};
            const bMeta = rosterMap[bId] || {};

            // record margins
            if (aPts !== bPts) {
              const winId = aPts > bPts ? aId : bId;
              const losId = aPts > bPts ? bId : aId;
              const winPts = aPts > bPts ? aPts : bPts;
              const losPts = aPts > bPts ? bPts : aPts;
              const winMeta = rosterMap[winId] || {};
              const losMeta = rosterMap[losId] || {};
              allMargins.push({
                season: leagueSeason, week, margin: Math.round((winPts - losPts) * 100) / 100,
                teamAName: winMeta.team_name || winId, teamBName: losMeta.team_name || losId,
                avatarA: winMeta.team_avatar, avatarB: losMeta.team_avatar,
                scoreA: Math.round(winPts*100)/100, scoreB: Math.round(losPts*100)/100
              });
            }

            // h2h record
            if (!h2h[ak]) h2h[ak] = {};
            if (!h2h[ak][bk]) h2h[ak][bk] = { wins:0, losses:0, games:0, pf:0, pa:0, lastSeason:null, lastWeek:null, opponentTeam:bMeta.team_name, opponentDisplay:bMeta.owner_name, opponentAvatar:bMeta.team_avatar };
            if (!h2h[bk]) h2h[bk] = {};
            if (!h2h[bk][ak]) h2h[bk][ak] = { wins:0, losses:0, games:0, pf:0, pa:0, lastSeason:null, lastWeek:null, opponentTeam:aMeta.team_name, opponentDisplay:aMeta.owner_name, opponentAvatar:aMeta.team_avatar };

            h2h[ak][bk].games++; h2h[ak][bk].pf += aPts; h2h[ak][bk].pa += bPts;
            h2h[ak][bk].lastSeason = leagueSeason; h2h[ak][bk].lastWeek = week;
            h2h[bk][ak].games++; h2h[bk][ak].pf += bPts; h2h[bk][ak].pa += aPts;
            h2h[bk][ak].lastSeason = leagueSeason; h2h[bk][ak].lastWeek = week;
            if (aPts > bPts) { h2h[ak][bk].wins++; h2h[bk][ak].losses++; }
            else if (bPts > aPts) { h2h[bk][ak].wins++; h2h[ak][bk].losses++; }
          }
        }
      }
      // round h2h
      for (const k of Object.keys(h2h)) for (const o of Object.keys(h2h[k])) {
        h2h[k][o].pf = Math.round(h2h[k][o].pf*100)/100;
        h2h[k][o].pa = Math.round(h2h[k][o].pa*100)/100;
      }
      h2hOwners = Object.values(ownersByKey).sort((a,b) => String(a.team||'').localeCompare(String(b.team||'')));
      h2hRecords = {};
      for (const k of Object.keys(h2h)) {
        h2hRecords[k] = Object.values(h2h[k]).sort((a,b) => b.wins - a.wins || b.games - a.games);
      }
      if (h2hOwners.length) selectedH2H = h2hOwners[0].key;

      // margins
      const sorted = allMargins.slice().sort((a,b) => b.margin - a.margin);
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
    <SkeletonLoader variant="row" count={10} />
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
            <thead><tr><th>Team</th><th class="col-num">W</th><th class="col-num">L</th><th class="col-num">Win Str</th><th class="col-num">Lose Str</th><th class="col-num">PF</th><th class="col-num">PA</th></tr></thead>
            <tbody>
              {#each aggregatedRegular as row}
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
        <span class="block-sub">Champion seasons pinned 🏆</span>
      </div>
      {#if aggregatedPlayoff.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead><tr><th>Team</th><th class="col-num">W</th><th class="col-num">L</th><th class="col-num">PF</th><th class="col-num">PA</th></tr></thead>
            <tbody>
              {#each aggregatedPlayoff as row}
                <tr class:champion-row={row.champion === true}>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPh(row.avatar, row.team_name)} alt={row.team_name} />
                      <div>
                        <div class="team-name-cell">
                          {row.team_name}
                          {#if row.champion === true}<span class="trophy">🏆</span>{/if}
                        </div>
                        {#if row.owner_name}<div class="team-owner-cell">{row.owner_name}</div>{/if}
                      </div>
                    </div>
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
        <div>
          <label for="h2h-select" class="visually-hidden">Team</label>
          <select id="h2h-select" bind:value={selectedH2H} data-testid="h2h-team-select">
            {#each h2hOwners as o}<option value={o.key}>{o.team || o.display}</option>{/each}
          </select>
        </div>
      </div>

      {#if selectedH2H && h2hRecords[selectedH2H]?.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead><tr><th>Opponent</th><th class="col-num">W</th><th class="col-num">L</th><th class="col-num">Games</th><th class="col-num">PF</th><th class="col-num">PA</th><th class="col-num">Last</th></tr></thead>
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

  .block { background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; margin-bottom: 1.25rem; }
  .block-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); gap: 1rem; flex-wrap: wrap; }
  .block-title { font-family: var(--font-display); font-size: 1.3rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .block-sub { color: var(--text-tertiary); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 700; }
  .table-wrap { overflow-x: auto; }
  .bfa-table { min-width: 700px; }
  .team-cell { display: flex; align-items: center; gap: 0.75rem; }
  .team-avatar.small { width: 42px; height: 42px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); }
  .team-name-cell { font-weight: 700; color: var(--text-primary); line-height: 1.15; }
  .team-owner-cell { color: var(--text-tertiary); font-size: 0.78rem; margin-top: 0.15rem; }
  .trophy { margin-left: 0.35rem; }
  .pf .num { font-weight: 800; }
  .num.muted { color: var(--text-tertiary); }
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
    .margin-row { grid-template-columns: 40px 1fr; }
    .margin-meta { grid-column: 2; }
    .margin-teams { grid-template-columns: 1fr; gap: 0.4rem; }
    .m-side.right { justify-content: flex-start; flex-direction: row-reverse; }
    .margin-value { justify-self: start; }
  }
</style>
