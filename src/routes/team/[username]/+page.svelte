<!--
  src/routes/team/[username]/+page.svelte

  Per-owner matchup history across every BFA season. The route param is the
  Sleeper `username` because it stays stable across seasons (roster_id resets
  each year). We pull the full season chain, walk every week's matchups,
  filter to the rows where this owner is one of the participants, and group
  by season.

  Deep-linked from /rosters team cards.
-->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { getSeasonsChain, BASE_LEAGUE_ID, getRosterMapWithOwners } from '$lib/sleeperClient.client';
  import { computeStandingsForLeague, computeParticipantPoints } from '$lib/leagueCompute.client';
  import { avatarOrPh, fmt2 as fmt } from '$lib/format';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';
  import TeamBadge from '$lib/TeamBadge.svelte';

  let loading = true;
  let error = null;

  /** @type {string | null} */
  let username = null;

  /** @type {{
   *   team_name: string|null,
   *   owner_name: string|null,
   *   team_avatar: string|null,
   *   owner_avatar: string|null
   * }} */
  let owner = { team_name: null, owner_name: null, team_avatar: null, owner_avatar: null };

  /** @type {Array<{
   *   season: string|null,
   *   leagueId: string,
   *   rosterId: string|null,
   *   regSummary: { wins:number, losses:number, pf:number, pa:number },
   *   playoffSummary: { wins:number, losses:number, pf:number, pa:number },
   *   matchups: Array<{ week:number, isPlayoff:boolean, my:number, opp:number, oppMeta:any, result:'W'|'L'|'T' }>
   * }>}
   */
  let bySeason = [];

  /** Overall totals across every season. */
  $: totals = bySeason.reduce(
    (acc, s) => ({
      wins: acc.wins + (s.regSummary.wins + s.playoffSummary.wins),
      losses: acc.losses + (s.regSummary.losses + s.playoffSummary.losses),
      pf: acc.pf + (s.regSummary.pf + s.playoffSummary.pf),
      pa: acc.pa + (s.regSummary.pa + s.playoffSummary.pa),
      games: acc.games + s.matchups.length
    }),
    { wins: 0, losses: 0, pf: 0, pa: 0, games: 0 }
  );

  /**
   * Per-opponent head-to-head rollup across every season this owner has
   * played. Keyed by opponent owner_username (lowercased) so the same
   * franchise re-themed across seasons still aggregates to ONE row.
   * Moved here from /records-team since this is a team-specific view.
   */
  $: h2h = (() => {
    const byOpp = {};
    for (const season of bySeason) {
      for (const m of season.matchups) {
        const meta = m.oppMeta || {};
        const key = (meta.owner_username || meta.owner_name || meta.team_name || '').toLowerCase();
        if (!key) continue;
        if (!byOpp[key]) {
          byOpp[key] = {
            key,
            opponent_meta: meta,
            wins: 0, losses: 0, ties: 0, games: 0,
            pf: 0, pa: 0,
            lastSeason: null, lastWeek: null
          };
        }
        const row = byOpp[key];
        row.games += 1;
        row.pf += m.my;
        row.pa += m.opp;
        if (m.result === 'W') row.wins += 1;
        else if (m.result === 'L') row.losses += 1;
        else row.ties += 1;
        // Track most recent meeting — bySeason is newest-first so the first
        // season we encounter for each opponent IS the most recent.
        if (row.lastSeason == null) {
          row.lastSeason = season.season;
          row.lastWeek = m.week;
        }
      }
    }
    return Object.values(byOpp)
      .map((r) => ({
        ...r,
        pf: Math.round(r.pf * 100) / 100,
        pa: Math.round(r.pa * 100) / 100
      }))
      .sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses) || b.games - a.games);
  })();

  /** Find the rosterId belonging to `username` in this league's roster map. */
  function findRosterIdForUser(rosterMap, usernameLower) {
    for (const rid of Object.keys(rosterMap)) {
      const m = rosterMap[rid] || {};
      if (m.owner_username && String(m.owner_username).toLowerCase() === usernameLower) return rid;
    }
    return null;
  }

  /**
   * Walk every week of `collectedMatchups`, pair the entries by matchup_id,
   * and emit one row per week where `myRosterId` was a participant.
   *
   * Rules per user spec:
   *  - The season ends when the playoffs end → drop any matchups beyond
   *    `playoffEnd`. The regular season + playoff window is the entire
   *    season's matchup history.
   *  - A matchup is only flagged as a "playoff" game when BOTH participants
   *    were seeded into the winners bracket (their regular-season seed was
   *    in 1..playoffTeams). Anything else in the playoff weeks is a
   *    losers-bracket / consolation game and shows up unlabeled.
   */
  function buildMatchupsForRoster(collectedMatchups, myRosterId, rosterMap, playoffStart, playoffEnd, winnersBracketRosters) {
    const winnersSet = new Set((winnersBracketRosters || []).map(String));
    const out = [];
    const weeks = Object.keys(collectedMatchups).map(Number).sort((a, b) => a - b);
    for (const week of weeks) {
      // Stop at the playoffs-end boundary; the user wants every team's
      // history to end exactly when the championship is decided.
      if (week > playoffEnd) continue;
      const arr = collectedMatchups[week] || [];
      // Pair by matchup_id
      const byMid = {};
      for (const e of arr) {
        const mid = e.matchup_id ?? e.matchupId ?? `auto-${week}`;
        const k = String(mid);
        if (!byMid[k]) byMid[k] = [];
        byMid[k].push(e);
      }
      for (const k of Object.keys(byMid)) {
        const pair = byMid[k];
        const mine = pair.find((e) => String(e.roster_id ?? e.rosterId ?? '') === String(myRosterId));
        if (!mine) continue;
        const opp = pair.find((e) => e !== mine);
        // Use computeParticipantPoints so manual commish edits
        // (`custom_points`) override the auto-computed total.
        const myPts = computeParticipantPoints(mine);
        const oppPts = opp ? computeParticipantPoints(opp) : 0;
        const oppRid = opp ? String(opp.roster_id ?? opp.rosterId ?? '') : null;
        const oppMeta = oppRid && rosterMap[oppRid] ? rosterMap[oppRid] : null;
        let result = 'T';
        if (myPts > oppPts + 1e-9) result = 'W';
        else if (myPts < oppPts - 1e-9) result = 'L';
        // Winners-bracket-only playoff flag: both teams must have been
        // top-seeded into the playoffs. Losers-bracket / consolation games
        // played in the same weeks render as regular rows (no badge).
        const bothInWinners = winnersSet.has(String(myRosterId)) && oppRid && winnersSet.has(String(oppRid));
        const isPlayoff = week >= playoffStart && week <= playoffEnd && bothInWinners;
        out.push({ week, isPlayoff, my: myPts, opp: oppPts, oppMeta, result });
      }
    }
    return out;
  }

  async function loadAll() {
    loading = true;
    error = null;
    try {
      username = decodeURIComponent($page.params.username || '');
      const usernameLower = username.toLowerCase();
      if (!username) throw new Error('Missing username');

      const { seasons: chain } = await getSeasonsChain(BASE_LEAGUE_ID);
      if (!Array.isArray(chain) || chain.length === 0) throw new Error('No seasons discovered');

      // newest → oldest in the UI (most relevant first)
      const orderedChain = [...chain].reverse();

      const results = await Promise.all(orderedChain.map(async (s) => {
        const standings = await computeStandingsForLeague(s.league_id).catch(() => null);
        if (!standings) return null;
        const rid = findRosterIdForUser(standings.rosterMap || {}, usernameLower);
        if (!rid) return null; // owner wasn't in this season

        // Compute the winners-bracket roster set (top playoff_teams seeds
        // from the regular standings). Used to label playoff games and to
        // recompute the playoff summary so it excludes losers-bracket games.
        const playoffTeams = Number(standings.playoffTeams) || 8;
        const winnersBracketRosters = (standings.regularStandings || [])
          .slice(0, playoffTeams)
          .map((r) => String(r.rosterId));

        const matchups = buildMatchupsForRoster(
          standings.collectedMatchups || {},
          rid,
          standings.rosterMap || {},
          standings.playoffStart,
          standings.playoffEnd,
          winnersBracketRosters
        );

        // Recompute the playoff summary from the matchups we actually kept
        // (winners-bracket games only). Don't trust the upstream
        // playoffStandings row because it conflates winners + losers
        // bracket scoring.
        const playoffGames = matchups.filter((m) => m.isPlayoff);
        const playoffSummary = playoffGames.reduce(
          (acc, m) => {
            acc.pf += m.my;
            acc.pa += m.opp;
            if (m.result === 'W') acc.wins += 1;
            else if (m.result === 'L') acc.losses += 1;
            return acc;
          },
          { wins: 0, losses: 0, pf: 0, pa: 0 }
        );

        // Locate owner display info from THIS season's roster map. We prefer
        // the latest season's metadata for the page header (handled below).
        const myMeta = (standings.rosterMap || {})[rid] || {};

        const reg = (standings.regularStandings || []).find((r) => String(r.rosterId) === String(rid)) || {};
        const playoff = (standings.playoffStandings || []).find((r) => String(r.rosterId) === String(rid)) || {};

        return {
          season: s.season,
          leagueId: s.league_id,
          rosterId: rid,
          regSummary: {
            wins: reg.wins || 0,
            losses: reg.losses || 0,
            pf: reg.pf || 0,
            pa: reg.pa || 0
          },
          playoffSummary,
          champion: playoff.champion === true,
          matchups,
          myMeta
        };
      }));

      const filtered = results.filter(Boolean);
      if (filtered.length === 0) throw new Error(`No matchups found for @${username}`);

      // Header metadata = newest season's record (which is filtered[0]
      // because we reversed the chain). Fall back to oldest if metadata is
      // missing.
      const newestMeta = filtered[0].myMeta || filtered[filtered.length - 1].myMeta || {};
      owner = {
        team_name: newestMeta.team_name || null,
        owner_name: newestMeta.owner_name || null,
        team_avatar: newestMeta.team_avatar || null,
        owner_avatar: newestMeta.owner_avatar || null
      };

      bySeason = filtered;
    } catch (e) {
      console.error('[Team] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  onMount(loadAll);
</script>

<svelte:head>
  <title>{owner.team_name || username || 'Team'} · Matchup History · BFA</title>
</svelte:head>

<div class="page wrap">
  <header class="page-head rise">
    <div class="head-row">
      <div class="head-team">
        <img class="head-avatar" src={avatarOrPh(owner.team_avatar || owner.owner_avatar, owner.team_name)} alt={owner.team_name || username} />
        <div>
          <div class="eyebrow">Team · Matchup History</div>
          <h1 class="page-title">{owner.team_name || `@${username}`}</h1>
          <p class="page-sub">
            {#if owner.owner_name}{owner.owner_name} · {/if}<span class="num">{totals.games}</span> games · <span class="num">{totals.wins}</span>-<span class="num">{totals.losses}</span> · <span class="num">{fmt(totals.pf)}</span> PF / <span class="num">{fmt(totals.pa)}</span> PA
          </p>
        </div>
      </div>
      <a class="btn back-btn" href="/rosters" data-testid="back-to-rosters">← All Rosters</a>
    </div>
  </header>

  {#if loading}
    <SkeletonLoader variant="row" count={10} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadAll} context="team matchup history" />
  {:else}
    {#if h2h.length}
      <section class="block" data-testid="h2h-section">
        <div class="block-head">
          <h2 class="block-title">Head-to-Head</h2>
          <span class="block-sub">Career record vs every opponent</span>
        </div>
        <div class="table-wrap">
          <table class="bfa-table">
            <thead>
              <tr>
                <th>Opponent</th>
                <th class="col-num" title="Head-to-head wins">Wins</th>
                <th class="col-num" title="Head-to-head losses">Losses</th>
                <th class="col-num" title="Total games played">Games</th>
                <th class="col-num" title="Total points scored against this opponent">Points For</th>
                <th class="col-num" title="Total points allowed">Points Against</th>
                <th class="col-num" title="Most recent meeting">Last Met</th>
              </tr>
            </thead>
            <tbody>
              {#each h2h as row (row.key)}
                <tr data-testid={`h2h-row-${row.key}`}>
                  <td>
                    <TeamBadge meta={row.opponent_meta} size="sm" showOwner href={!!row.opponent_meta?.owner_username} />
                  </td>
                  <td class="col-num"><span class="num">{row.wins}</span></td>
                  <td class="col-num"><span class="num">{row.losses}</span></td>
                  <td class="col-num"><span class="num">{row.games}</span></td>
                  <td class="col-num"><span class="num">{fmt(row.pf)}</span></td>
                  <td class="col-num"><span class="num muted">{fmt(row.pa)}</span></td>
                  <td class="col-num"><span class="num muted">{row.lastSeason ?? '—'}{#if row.lastWeek} · W{row.lastWeek}{/if}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    {#each bySeason as season (season.leagueId)}
      <section class="block" data-testid={`season-${season.season}`}>
        <div class="block-head">
          <h2 class="block-title">
            Season {season.season}
            {#if season.champion}<span class="trophy" title="Champion">🏆</span>{/if}
          </h2>
          <span class="block-sub">
            REG {season.regSummary.wins}–{season.regSummary.losses}
            · PO {season.playoffSummary.wins}–{season.playoffSummary.losses}
            · PF <span class="num">{fmt(season.regSummary.pf + season.playoffSummary.pf)}</span>
          </span>
        </div>
        {#if season.matchups.length}
          <div class="table-wrap">
            <table class="bfa-table">
              <thead>
                <tr>
                  <th style="width:48px;" title="Week of the regular season or playoffs">Week</th>
                  <th>Opponent</th>
                  <th class="col-num" title="This team's points scored that week">My Score</th>
                  <th class="col-num" title="Opponent's points scored that week">Opp Score</th>
                  <th class="col-num" title="My Score minus Opp Score">Margin</th>
                  <th class="col-num" title="Win / Loss / Tie">Result</th>
                </tr>
              </thead>
              <tbody>
                {#each season.matchups as m (`${season.leagueId}-${m.week}`)}
                  <tr class:playoff-row={m.isPlayoff} class:win-row={m.result === 'W'} class:loss-row={m.result === 'L'}>
                    <td class="wk-cell">
                      <span class="num">{m.week}</span>
                      {#if m.isPlayoff}<span class="playoff-pill">PO</span>{/if}
                    </td>
                    <td>
                      {#if m.oppMeta}
                        <TeamBadge meta={m.oppMeta} size="sm" showOwner href={!!m.oppMeta.owner_username} />
                      {:else}
                        <span class="muted">BYE</span>
                      {/if}
                    </td>
                    <td class="col-num"><span class="num pf">{fmt(m.my)}</span></td>
                    <td class="col-num"><span class="num muted">{fmt(m.opp)}</span></td>
                    <td class="col-num"><span class="num" class:positive={m.my > m.opp} class:negative={m.my < m.opp}>{m.my > m.opp ? '+' : ''}{fmt(m.my - m.opp)}</span></td>
                    <td class="col-num"><span class={`result-pill ${m.result === 'W' ? 'w' : m.result === 'L' ? 'l' : 't'}`}>{m.result}</span></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="empty-card">No matchups in this season.</div>
        {/if}
      </section>
    {/each}
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .head-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; flex-wrap: wrap; }
  .head-team { display: flex; align-items: center; gap: 1.25rem; }
  .head-avatar { width: 88px; height: 88px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); flex-shrink: 0; }
  .page-title { font-family: var(--font-display); font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; margin: 0.4rem 0 0; text-transform: uppercase; }
  .page-sub { color: var(--text-secondary); margin-top: 0.4rem; }

  .block { background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; margin-bottom: 1.25rem; }
  .block-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); gap: 1rem; flex-wrap: wrap; }
  .block-title { font-family: var(--font-display); font-size: 1.4rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .block-sub { color: var(--text-tertiary); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700; }
  .trophy { margin-left: 0.4rem; }

  .table-wrap { width: 100%; overflow-x: auto; }
  .bfa-table { min-width: 720px; }
  .wk-cell { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.75rem; }
  .playoff-pill { background: var(--brand); color: var(--brand-foreground, #fff); font-size: 0.62rem; font-weight: 800; padding: 0.1rem 0.4rem; border-radius: 999px; letter-spacing: 0.08em; }

  .pf { color: var(--text-primary); font-weight: 700; }
  .muted { color: var(--text-tertiary); }
  .positive { color: var(--accent); font-weight: 700; }
  .negative { color: var(--text-tertiary); }

  .result-pill { display: inline-block; min-width: 26px; padding: 0.15rem 0.4rem; border-radius: var(--r-sm); font-weight: 800; font-size: 0.78rem; text-align: center; }
  .result-pill.w { background: rgba(52, 50, 200, 0.18); color: var(--brand); }
  .result-pill.l { background: rgba(200, 114, 50, 0.16); color: var(--accent); }
  .result-pill.t { background: var(--surface-2); color: var(--text-tertiary); }

  .playoff-row td { background: linear-gradient(90deg, rgba(52, 50, 200, 0.06), transparent 60%); }

  .empty-card { padding: 1.5rem; text-align: center; color: var(--text-secondary); }

  .back-btn { padding: 0.5rem 0.85rem; }

  @media (max-width: 720px) {
    .page { padding: 1.75rem 0 3rem; }
    .page-title { font-size: clamp(2rem, 9vw, 2.8rem); }
    .head-row { flex-direction: column; align-items: stretch; }
    .head-team { align-items: flex-start; gap: 0.85rem; }
    .head-avatar { width: 64px; height: 64px; }
    .back-btn { align-self: flex-start; }
    .block-head { padding: 0.85rem 1rem; }
    .block-title { font-size: 1.1rem; }
    .block-sub { font-size: 0.7rem; letter-spacing: 0.08em; }
    .wk-cell { padding: 0.55rem 0.55rem; gap: 0.35rem; }
    .playoff-pill { font-size: 0.55rem; padding: 0.08rem 0.3rem; }
    .result-pill { min-width: 22px; padding: 0.1rem 0.3rem; font-size: 0.7rem; }
  }
</style>
