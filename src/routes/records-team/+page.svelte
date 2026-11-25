<!-- src/routes/records-team/+page.svelte (client-side, bracket-aware, parallelized) -->
<script>
  import { onMount } from 'svelte';
  import { getSeasonsChain, BASE_LEAGUE_ID } from '$lib/api';
  import { computeStandingsForLeague, computeParticipantPoints } from '$lib/compute';
  import SkeletonLoader from '$lib/components/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import { avatarOrPlaceholder } from '$lib/utils/format';

  let loading = true;
  let progress = '';
  let error = null;
  let aggregatedRegular = [];
  let aggregatedPlayoff = [];
  let singleSeasonRecords = [];
  let marginsLargest = [];
  let marginsSmallest = [];
  let lowestWeeklyTotals = [];
  let highestScoringWeeks = [];
  let lowestScoringWeeks = [];
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

      // Best completed regular-season campaigns (exclude an active/incomplete season).
      singleSeasonRecords = standingsResults.flatMap((result) => {
        if (!result?.bracketComplete) return [];
        return (result.regularStandings || []).map((row) => {
          const games = (row.wins || 0) + (row.losses || 0) + (row.ties || 0);
          return {
            season: result.season,
            rosterId: row.rosterId,
            team_name: row.team_name || 'Unknown team',
            owner_name: row.owner_name || result.rosterMap?.[row.rosterId]?.owner_name || '',
            avatar: row.avatar || result.rosterMap?.[row.rosterId]?.team_avatar || result.rosterMap?.[row.rosterId]?.owner_avatar || null,
            wins: row.wins || 0,
            losses: row.losses || 0,
            winPct: games ? (((row.wins || 0) + (row.ties || 0) * 0.5) / games) * 100 : 0,
            pf: row.pf || 0,
            pa: row.pa || 0,
            diff: (row.pf || 0) - (row.pa || 0)
          };
        });
      }).sort((a, b) => (b.winPct - a.winPct) || (b.wins - a.wins) || (b.pf - a.pf)).slice(0, 10);

      // ---------- Aggregate regular + playoff by owner_username ----------
      const regAgg = {};
      const poAgg = {};
      const championCounts = {}; // stableKey -> # championships
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
        for (const row of (result.regularStandings || [])) {
          const meta = rmap[row.rosterId] || {};
          addRow(regAgg, row, meta, result.season);

          // Start every regular-season team in the playoff career table too.
          // Teams that never qualified retain zero postseason totals.
          const key = stableKey(meta) || String(row.team_name || row.rosterId).toLowerCase();
          if (!poAgg[key]) {
            poAgg[key] = {
              key,
              team_name: row.team_name || meta.team_name || 'Unknown team',
              owner_name: row.owner_name || meta.owner_name || '',
              owner_username: meta.owner_username || null,
              avatar: row.avatar || meta.team_avatar || meta.owner_avatar || null,
              wins: 0, losses: 0, ties: 0,
              pf: 0, pa: 0,
              maxWinStreak: 0, maxLoseStreak: 0,
              championships: 0,
              seasons: []
            };
          } else {
            if (row.avatar) poAgg[key].avatar = row.avatar;
            if (row.team_name && !String(row.team_name).startsWith('Roster ')) poAgg[key].team_name = row.team_name;
            if (row.owner_name) poAgg[key].owner_name = row.owner_name;
          }
        }
        for (const row of (result.playoffStandings || [])) addRow(poAgg, row, rmap[row.rosterId], result.season);
      }

      // attach championship counts to playoff rows
      for (const k of Object.keys(poAgg)) poAgg[k].championships = championCounts[k] || 0;
      for (const k of Object.keys(regAgg)) regAgg[k].championships = championCounts[k] || 0;

      aggregatedRegular = Object.values(regAgg).map((row) => {
        row.seasons = [...new Set(row.seasons)];
        row.games = row.wins + row.losses + row.ties;
        row.winPct = row.games ? ((row.wins + row.ties * 0.5) / row.games) * 100 : 0;
        row.avgPF = row.games ? row.pf / row.games : 0;
        return row;
      }).sort((a, b) => (b.wins - a.wins) || (b.pf - a.pf));
      aggregatedPlayoff = Object.values(poAgg).map((row) => {
        row.seasons = [...new Set(row.seasons)];
        row.games = row.wins + row.losses + row.ties;
        row.winPct = row.games ? ((row.wins + row.ties * 0.5) / row.games) * 100 : 0;
        return row;
      }).sort((a, b) => {
        if ((b.championships || 0) !== (a.championships || 0)) return (b.championships || 0) - (a.championships || 0);
        return (b.wins - a.wins) || (b.pf - a.pf);
      });

      // ---------- All-time margin records ----------
      const allMargins = [];
      for (const result of standingsResults) {
        if (!result) continue;
        const rmap = result.rosterMap || {};
        const matchups = result.collectedMatchups || {};
        const playoffMatchups = result.playoffMatchups || {};
        const playoffStart = Number(result.playoffStart) || 19;
        const playoffEnd = Number(result.playoffEnd) || playoffStart + 2;
        for (const wk of Object.keys(matchups)) {
          const week = Number(wk);
          const weekEntries = week >= playoffStart && week <= playoffEnd
            ? (playoffMatchups[wk] || [])
            : matchups[wk];
          if (!Array.isArray(weekEntries)) continue;
          const byM = {};
          for (let i = 0; i < weekEntries.length; i++) {
            const entry = weekEntries[i];
            const matchupId = entry.matchup_id ?? entry.matchupId ?? ('auto' + i);
            if (!byM[matchupId]) byM[matchupId] = [];
            byM[matchupId].push(entry);
          }
          for (const entries of Object.values(byM)) {
            if (entries.length !== 2) continue;
            const [a, b] = entries;
            const aPts = computeParticipantPoints(a);
            const bPts = computeParticipantPoints(b);
            if (aPts === bPts) continue;
            const aMeta = rmap[String(a.roster_id ?? a.rosterId ?? '')] || {};
            const bMeta = rmap[String(b.roster_id ?? b.rosterId ?? '')] || {};
            const winner = aPts > bPts ? aMeta : bMeta;
            const loser = aPts > bPts ? bMeta : aMeta;
            const winnerPts = Math.max(aPts, bPts);
            const loserPts = Math.min(aPts, bPts);
            allMargins.push({
              season: result.season,
              week: Number(wk),
              margin: Math.round((winnerPts - loserPts) * 100) / 100,
              teamAName: winner.team_name || 'Unknown team',
              teamBName: loser.team_name || 'Unknown team',
              avatarA: winner.team_avatar || winner.owner_avatar,
              avatarB: loser.team_avatar || loser.owner_avatar,
              scoreA: Math.round(winnerPts * 100) / 100,
              scoreB: Math.round(loserPts * 100) / 100
            });
          }
        }
      }


      // Seed every team from every season first, so teams with zero
      // lowest-scoring weeks remain visible in the all-time table.
      const lowestByTeam = {};
      for (const result of standingsResults) {
        if (!result) continue;
        const rmap = result.rosterMap || {};
        for (const row of (result.regularStandings || [])) {
          const rid = String(row.rosterId ?? row.roster_id ?? '');
          const meta = rmap[rid] || {};
          const key = stableKey(meta) || String(row.team_name || rid).toLowerCase();
          if (!lowestByTeam[key]) lowestByTeam[key] = {
            key,
            team_name: row.team_name || meta.team_name || 'Unknown team',
            owner_name: row.owner_name || meta.owner_name || '',
            avatar: row.avatar || meta.team_avatar || meta.owner_avatar || null,
            count: 0,
            weeks: []
          };
        }
      }

      // Lowest team total in each regular-season week across the entire league.
      // Tied lowest scores all count as a league low.
      for (const result of standingsResults) {
        if (!result) continue;
        const rmap = result.rosterMap || {}, collected = result.collectedMatchups || {};
        const playoffStart = Number(result.playoffStart) || 19;
        for (const wk of Object.keys(collected)) {
          const week = Number(wk);
          if (!Number.isFinite(week) || week < 1 || week >= playoffStart) continue;
          const entries = (collected[wk] || []).filter((entry) => Number.isFinite(Number(entry.__final_score ?? entry.points)));
          if (!entries.length) continue;
          const lowest = Math.min(...entries.map((entry) => Number(entry.__final_score ?? entry.points)));
          for (const entry of entries) {
            const points = Number(entry.__final_score ?? entry.points);
            if (Math.abs(points - lowest) > 1e-9) continue;
            const rid = String(entry.roster_id ?? entry.rosterId ?? ''), meta = rmap[rid] || {};
            const key = stableKey(meta) || String(meta.team_name || rid).toLowerCase();
            if (!lowestByTeam[key]) lowestByTeam[key] = {
              key, team_name: meta.team_name || 'Unknown team', owner_name: meta.owner_name || '',
              avatar: meta.team_avatar || meta.owner_avatar || null, count: 0, weeks: []
            };
            lowestByTeam[key].count++;
            lowestByTeam[key].weeks.push({ season: result.season, week, points });
          }
        }
      }
      lowestWeeklyTotals = Object.values(lowestByTeam).sort((a,b)=>b.count-a.count || a.team_name.localeCompare(b.team_name));

      // Top and bottom individual team scores across completed regular-season weeks.
      const weeklyTeamScores = [];
      for (const result of standingsResults) {
        if (!result) continue;
        const rmap = result.rosterMap || {};
        const playoffStart = Number(result.playoffStart) || 19;
        const playoffEnd = Number(result.playoffEnd) || playoffStart + 2;
        const playoffMatchups = result.playoffMatchups || {};
        for (const [weekText, entries] of Object.entries(result.collectedMatchups || {})) {
          const week = Number(weekText);
          if (!Number.isInteger(week) || week < 1 || week > playoffEnd) continue;
          const phaseEntries = week >= playoffStart ? (playoffMatchups[weekText] || []) : entries;
          for (const entry of phaseEntries || []) {
            const rawPoints = Number(entry.__final_score ?? entry.points);
            if (!Number.isFinite(rawPoints)) continue;
            const rid = String(entry.roster_id ?? entry.rosterId ?? '');
            const meta = rmap[rid] || {};
            weeklyTeamScores.push({
              key: `${result.season}-${week}-${rid}`,
              season: result.season,
              week,
              phase: week >= playoffStart ? 'Playoffs' : 'Regular Season',
              points: Math.round(rawPoints * 100) / 100,
              rosterId: rid,
              team_name: meta.team_name || entry.__team_name || 'Unknown team',
              owner_name: meta.owner_name || entry.__owner_name || '',
              avatar: meta.team_avatar || meta.owner_avatar || null
            });
          }
        }
      }
      highestScoringWeeks = weeklyTeamScores.slice().sort((a, b) =>
        b.points - a.points || Number(b.season) - Number(a.season) || b.week - a.week
      ).slice(0, 10);
      lowestScoringWeeks = weeklyTeamScores.slice().sort((a, b) =>
        a.points - b.points || Number(b.season) - Number(a.season) || b.week - a.week
      ).slice(0, 10);

      const sorted = allMargins.slice().sort((a, b) => b.margin - a.margin);
      marginsLargest = sorted.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));
      marginsSmallest = sorted.slice().reverse().slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));
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
    <p class="page-sub">The league’s all-time team leaderboard: career records, postseason success, and the biggest and closest matchups.</p>
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
      <div class="block-head"><h2 class="block-title">Highest Scoring Week — Top 10</h2><span class="block-sub">Top completed team-week scores · regular season + playoffs</span></div>
      {#if highestScoringWeeks.length}
        <div class="table-wrap"><table class="bfa-table weekly-record-table">
          <colgroup><col style="width:7%" /><col style="width:37%" /><col style="width:13%" /><col style="width:10%" /><col style="width:15%" /><col style="width:18%" /></colgroup>
          <thead><tr><th>Rank</th><th>Team</th><th>Season</th><th>Week</th><th>Phase</th><th class="col-num">Points</th></tr></thead>
          <tbody>{#each highestScoringWeeks as row, i (row.key)}
            <tr>
              <td class="num">{i + 1}</td>
              <td><div class="team-cell"><img class="team-avatar small" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} /><div><div class="team-name-cell">{row.team_name}</div>{#if row.owner_name}<div class="team-owner-cell">{row.owner_name}</div>{/if}</div></div></td>
              <td>{row.season}</td><td>{row.week}</td><td>{row.phase}</td><td class="col-num"><span class="num">{row.points.toFixed(2)}</span></td>
            </tr>
          {/each}</tbody>
        </table></div>
      {:else}<div class="empty-card">No completed regular-season weekly scores yet.</div>{/if}
    </section>
    <section class="block">
      <div class="block-head"><h2 class="block-title">Lowest Scoring Week — Top 10</h2><span class="block-sub">Lowest completed team-week scores · regular season + playoffs</span></div>
      {#if lowestScoringWeeks.length}
        <div class="table-wrap"><table class="bfa-table weekly-record-table">
          <colgroup><col style="width:7%" /><col style="width:37%" /><col style="width:13%" /><col style="width:10%" /><col style="width:15%" /><col style="width:18%" /></colgroup>
          <thead><tr><th>Rank</th><th>Team</th><th>Season</th><th>Week</th><th>Phase</th><th class="col-num">Points</th></tr></thead>
          <tbody>{#each lowestScoringWeeks as row, i (row.key)}
            <tr>
              <td class="num">{i + 1}</td>
              <td><div class="team-cell"><img class="team-avatar small" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} /><div><div class="team-name-cell">{row.team_name}</div>{#if row.owner_name}<div class="team-owner-cell">{row.owner_name}</div>{/if}</div></div></td>
              <td>{row.season}</td><td>{row.week}</td><td>{row.phase}</td><td class="col-num"><span class="num">{row.points.toFixed(2)}</span></td>
            </tr>
          {/each}</tbody>
        </table></div>
      {:else}<div class="empty-card">No completed regular-season weekly scores yet.</div>{/if}
    </section>
    <section class="block">
      <div class="block-head">
        <h2 class="block-title">Best Single-Season Records</h2>
        <span class="block-sub">Completed seasons · win % → wins → PF</span>
      </div>
      {#if singleSeasonRecords.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead><tr><th>Season</th><th>Team</th><th class="col-num">Record</th><th class="col-num">Win %</th><th class="col-num">PF</th><th class="col-num">PA</th><th class="col-num">Diff</th></tr></thead>
            <tbody>
              {#each singleSeasonRecords as row, idx (row.season + '-' + row.rosterId)}
                <tr>
                  <td><span class="num">{row.season}</span></td>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                      <div>
                        <div class="team-name-cell">{row.team_name}</div>
                        {#if row.owner_name}<div class="team-owner-cell">{row.owner_name}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td class="col-num"><span class="num">{row.wins}–{row.losses}</span></td>
                  <td class="col-num"><span class="num" class:leader-cell={idx === 0}>{row.winPct.toFixed(1)}%</span></td>
                  <td class="col-num"><span class="num">{row.pf.toFixed(2)}</span></td>
                  <td class="col-num"><span class="num muted">{row.pa.toFixed(2)}</span></td>
                  <td class="col-num"><span class="num" class:positive={row.diff > 0} class:negative={row.diff < 0}>{row.diff > 0 ? '+' : ''}{row.diff.toFixed(2)}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="empty-card">No completed-season records are available yet.</div>
      {/if}
    </section>

    <section class="block">
      <div class="block-head">
        <h2 class="block-title">Regular Season — Career Totals</h2>
        <span class="block-sub">Sorted by Wins → PF</span>
      </div>
      {#if aggregatedRegular.length}
        <div class="table-wrap">
          <table class="bfa-table career-totals-table">
            <colgroup><col style="width:27%" /><col style="width:7%" /><col style="width:7%" /><col style="width:8%" /><col style="width:8%" /><col style="width:8%" /><col style="width:10%" /><col style="width:10%" /><col style="width:8%" /><col style="width:7%" /></colgroup>
            <thead><tr><th>Team</th><th class="col-num" title="All-time regular-season wins">W</th><th class="col-num" title="All-time regular-season losses">L</th><th class="col-num" title="Win percentage, with ties counting as half a win">Win %</th><th class="col-num" title="Best win streak ever, in any season">Best Streak</th><th class="col-num" title="Worst losing streak ever, in any season">Worst Streak</th><th class="col-num" title="All-time points scored">Points For</th><th class="col-num" title="All-time points allowed">Points Against</th><th class="col-num" title="Average points scored per game">PF / Game</th><th class="col-num" title="Number of seasons played">Seasons</th></tr></thead>
            <tbody>
              {#each aggregatedRegular as row, idx (row.key)}
                <tr>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                      <div>
                        <div class="team-name-cell">{row.team_name}</div>
                        {#if row.owner_name}<div class="team-owner-cell">{row.owner_name}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td class="col-num"><span class="num" class:leader-cell={idx === 0}>{row.wins}</span></td>
                  <td class="col-num"><span class="num">{row.losses}</span></td>
                  <td class="col-num"><span class="num">{row.winPct.toFixed(1)}%</span></td>
                  <td class="col-num"><span class="num">{row.maxWinStreak ?? 0}</span></td>
                  <td class="col-num"><span class="num">{row.maxLoseStreak ?? 0}</span></td>
                  <td class="col-num pf"><span class="num">{row.pf}</span></td>
                  <td class="col-num"><span class="num muted">{row.pa}</span></td>
                  <td class="col-num"><span class="num">{row.avgPF.toFixed(2)}</span></td>
                  <td class="col-num"><span class="num muted">{row.seasons.length}</span></td>
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
        <h2 class="block-title">Playoff Career Records</h2>
        <span class="block-sub">Championships → wins → points for</span>
      </div>
      {#if aggregatedPlayoff.length}
        <div class="table-wrap">
          <table class="bfa-table">
            <thead><tr><th>Team</th><th class="col-num" title="Total championships won">Titles</th><th class="col-num" title="Playoff wins all-time">W</th><th class="col-num" title="Playoff losses all-time">L</th><th class="col-num" title="Playoff win percentage">Win %</th><th class="col-num" title="Number of seasons with playoff games">Playoff Seasons</th><th class="col-num" title="Total playoff points scored">Playoff PF</th><th class="col-num" title="Total playoff points allowed">Playoff PA</th></tr></thead>
            <tbody>
              {#each aggregatedPlayoff as row, idx (row.key)}
                <tr class:champion-row={(row.championships || 0) > 0}>
                  <td>
                    <div class="team-cell">
                      <img class="team-avatar small" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
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
                      <span class="num title-count" class:leader-cell={idx === 0}>{row.championships}</span>
                    {:else}
                      <span class="num muted">—</span>
                    {/if}
                  </td>
                  <td class="col-num"><span class="num">{row.wins}</span></td>
                  <td class="col-num"><span class="num">{row.losses}</span></td>
                  <td class="col-num"><span class="num">{row.winPct.toFixed(1)}%</span></td>
                  <td class="col-num"><span class="num muted">{row.seasons.length}</span></td>
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
      <div class="block-head"><h2 class="block-title">Most Weekly League Lows</h2><span class="block-sub">Lowest team total in each regular-season week · ties count</span></div>
      {#if lowestWeeklyTotals.length}
        <div class="table-wrap low-weeks-wrap"><table class="bfa-table low-weeks-table">
          <colgroup><col class="lw-rank-col" /><col class="lw-team-col" /><col class="lw-count-col" /><col class="lw-weeks-col" /></colgroup>
          <thead><tr><th>Rank</th><th>Team</th><th class="col-num">Weekly Lows</th><th>Weeks · Score</th></tr></thead>
          <tbody>{#each lowestWeeklyTotals as row, i (row.key)}
            <tr>
              <td class="num lw-rank">{i + 1}</td>
              <td>
                <div class="team-cell">
                  <img class="team-avatar small" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                  <div>
                    <div class="team-name-cell">{row.team_name}</div>
                    {#if row.owner_name}<div class="team-owner-cell">{row.owner_name}</div>{/if}
                  </div>
                </div>
              </td>
              <td class="col-num"><span class="lw-count num">{row.count}</span></td>
              <td><div class="lw-week-list">{#each row.weeks as w}<span class="lw-week"><span>{w.season} · W{w.week}</span><strong>{w.points.toFixed(1)} pts</strong></span>{/each}</div></td>
            </tr>
          {/each}</tbody>
        </table></div>
      {:else}<div class="empty-row">No completed regular-season weekly scores yet.</div>{/if}
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
                  <div class="m-side"><img class="team-avatar small" src={avatarOrPlaceholder(row.avatarA, row.teamAName)} alt={row.teamAName} /><div class="m-mini"><div class="m-mini-name">{row.teamAName}</div><div class="m-mini-score num">{row.scoreA}</div></div></div>
                  <div class="margin-value num">+{row.margin}</div>
                  <div class="m-side right"><div class="m-mini"><div class="m-mini-name">{row.teamBName}</div><div class="m-mini-score num">{row.scoreB}</div></div><img class="team-avatar small" src={avatarOrPlaceholder(row.avatarB, row.teamBName)} alt={row.teamBName} /></div>
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
                  <div class="m-side"><img class="team-avatar small" src={avatarOrPlaceholder(row.avatarA, row.teamAName)} alt={row.teamAName} /><div class="m-mini"><div class="m-mini-name">{row.teamAName}</div><div class="m-mini-score num">{row.scoreA}</div></div></div>
                  <div class="margin-value tight num">{row.margin}</div>
                  <div class="m-side right"><div class="m-mini"><div class="m-mini-name">{row.teamBName}</div><div class="m-mini-score num">{row.scoreB}</div></div><img class="team-avatar small" src={avatarOrPlaceholder(row.avatarB, row.teamBName)} alt={row.teamBName} /></div>
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
  .page.wrap { max-width: 1760px; }
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
  .table-wrap { width: 100%; overflow: hidden; }
  /* Compact tables preserve every column and statistic while using the page width efficiently. */
  .bfa-table { width: 100%; min-width: 0; table-layout: fixed; font-size: 0.84rem; }
  .bfa-table thead th { font-size: 0.66rem; line-height: 1.2; padding: 0.58rem 0.42rem; white-space: normal; }
  .bfa-table tbody td { padding: 0.58rem 0.42rem; line-height: 1.25; }
  .bfa-table .num { font-size: 0.88rem; }
  .bfa-table .team-cell { gap: 0.48rem; }
  .bfa-table .team-avatar.small { width: 32px; height: 32px; }
  .bfa-table .team-name-cell { font-size: 0.84rem; line-height: 1.15; }
  .bfa-table .team-owner-cell { font-size: 0.7rem; }
  .bfa-table .col-num { white-space: nowrap; }
  .team-cell { min-width: 0; }
  .team-name-cell { overflow-wrap: anywhere; }
  .career-totals-table .team-name-cell { overflow-wrap: normal; word-break: normal; }
  .career-totals-table .team-cell { min-width: 0; width: 100%; }
  .career-totals-table .team-avatar { flex: 0 0 auto; }
  .weekly-record-table .team-cell { min-width: 0; }
  .weekly-record-table .team-name-cell { overflow-wrap: anywhere; }
  .team-cell { display: flex; align-items: center; gap: 0.75rem; }
  .team-avatar.small { width: 42px; height: 42px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); }
  .team-name-cell { font-weight: 700; color: var(--text-primary); font-size: 0.98rem; line-height: 1.2; display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
  .team-owner-cell { color: var(--text-tertiary); font-size: 0.84rem; margin-top: 0.2rem; }
  /* Weekly-low history: give the dense weeks column room and make each score scannable. */
  .low-weeks-table { font-size: 0.8rem; }
  .low-weeks-table thead th { padding: 0.58rem 0.42rem; }
  .low-weeks-table tbody td { padding: 0.58rem 0.42rem; }
  .weekly-record-table .team-avatar.small { width: 30px; height: 30px; }
  .career-totals-table .team-name-cell { font-size: 0.78rem; }
  .career-totals-table .team-avatar.small { width: 29px; height: 29px; }
  .low-weeks-table .lw-rank-col { width: 7%; }
  .low-weeks-table .lw-team-col { width: 38%; }
  .low-weeks-table .lw-count-col { width: 14%; }
  .low-weeks-table .lw-weeks-col { width: 41%; }
  .low-weeks-table thead th { color: #fff; font-size: .76rem; letter-spacing: .08em; }
  .low-weeks-table tbody tr:nth-child(even) { background: rgba(72, 125, 220, .055); }
  .low-weeks-table .lw-rank { color: #d9e6ff; font-size: 1.02rem; font-weight: 650; font-variant-numeric: tabular-nums; }
  .low-weeks-table .lw-owner { color: #d4deef; font-weight: 600; overflow-wrap: anywhere; }
  .low-weeks-table .lw-count { display: inline-flex; justify-content: center; min-width: 2.2rem; padding: .35rem .55rem; border-radius: 6px; color: #fff; background: rgba(207, 118, 47, .2); border: 1px solid rgba(207, 118, 47, .62); font-size: 1.2rem; font-weight: 650; font-variant-numeric: tabular-nums; }
  .lw-week-list { display: flex; flex-wrap: wrap; gap: .4rem; }
  .lw-week { display: inline-flex; align-items: center; flex-wrap: wrap; gap: .25rem .45rem; padding: .35rem .55rem; border-radius: 5px; background: rgba(21, 84, 209, .14); border: 1px solid rgba(91, 145, 235, .3); color: #dce8ff; font-size: .76rem; line-height: 1.25; }
  .lw-week strong { color: #fff; font-size: .84rem; font-weight: 650; font-variant-numeric: tabular-nums; }

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
  .m-mini-name { font-weight: 600; font-size: 0.76rem; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .m-mini-score { color: var(--text-secondary); font-size: 0.78rem; }
  .margin-value { background: var(--surface-2); border: 1px solid var(--border-subtle); padding: 0.25rem 0.55rem; border-radius: var(--r-sm); color: var(--accent); font-size: 1.1rem; }
  .margin-value.tight { color: var(--win); border-color: var(--win); }
  .margin-meta { color: var(--text-tertiary); font-size: 0.66rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
  @media (max-width: 1100px) { .record-highlights { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 980px) { .margins-grid { grid-template-columns: 1fr; } }
  @media (max-width: 720px) {
    .page { padding: 1.75rem 0 3rem; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .table-wrap::after { display: none; }
    .page-sub { font-size: 0.9rem; }
    .block-head { padding: 0.85rem 1rem; }
    .block-title { font-size: 1.05rem; }
    /* Keep tables within the viewport; allow labels and values to wrap. */
    .bfa-table { min-width: 0; font-size: 0.72rem; table-layout: fixed; }
    .bfa-table thead th { font-size: 0.68rem; padding: 0.7rem 0.55rem; letter-spacing: 0.04em; }
    .bfa-table tbody td { padding: 0.7rem 0.55rem; }
    .bfa-table .col-num { white-space: nowrap; }
    .bfa-table .team-cell { gap: 0.5rem; }
    .career-totals-table .team-name-cell { font-size: .82rem; line-height: 1.15; }
    .career-totals-table .team-avatar.small { width: 30px; height: 30px; }
    .bfa-table .team-avatar.small { width: 34px; height: 34px; }
    .bfa-table .num { font-size: 0.9rem; }
    .team-name-cell { font-size: 0.92rem; }
    .team-avatar.small { width: 38px; height: 38px; }
    .team-owner-cell { display: none; }
    .low-weeks-table { font-size: .72rem; }
    .low-weeks-table .lw-rank-col { width: 8%; }
    .low-weeks-table .lw-team-col { width: 40%; }
    .low-weeks-table .lw-count-col { width: 17%; }
    .low-weeks-table .lw-weeks-col { width: 35%; }
    .low-weeks-table thead th { font-size: .62rem; padding: .65rem .35rem; letter-spacing: .02em; }
    .low-weeks-table tbody td { padding: .6rem .35rem; }
    .low-weeks-table .team-cell { gap: .35rem; }
    .low-weeks-table .team-avatar.small { width: 28px; height: 28px; }
    .low-weeks-table .lw-count { min-width: 1.7rem; padding: .25rem .35rem; font-size: 1rem; font-weight: 650; }
    .lw-week strong { font-size: .72rem; }
    .lw-week-list { gap: .25rem; }
    .lw-week { gap: .15rem .3rem; padding: .25rem .35rem; font-size: .64rem; }

    .margin-row { grid-template-columns: 40px 1fr; padding: 0.55rem 0.75rem; }
    .margin-meta { grid-column: 2; }
    .margin-teams { grid-template-columns: 1fr; gap: 0.4rem; }
    .m-side.right { justify-content: flex-start; flex-direction: row-reverse; }
    .margin-value { justify-self: start; }
  }
</style>
