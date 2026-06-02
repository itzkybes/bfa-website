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
  import { computeStandingsForLeague } from '$lib/leagueCompute.client';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';

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

  function fmt(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? String(name)[0].toUpperCase() : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }

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
   */
  function buildMatchupsForRoster(collectedMatchups, myRosterId, rosterMap, playoffStart, playoffEnd) {
    const out = [];
    const weeks = Object.keys(collectedMatchups).map(Number).sort((a, b) => a - b);
    for (const week of weeks) {
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
        const myPts = Number(mine.points ?? 0) || 0;
        const oppPts = Number(opp?.points ?? 0) || 0;
        const oppRid = opp ? String(opp.roster_id ?? opp.rosterId ?? '') : null;
        const oppMeta = oppRid && rosterMap[oppRid] ? rosterMap[oppRid] : null;
        let result = 'T';
        if (myPts > oppPts + 1e-9) result = 'W';
        else if (myPts < oppPts - 1e-9) result = 'L';
        const isPlayoff = week >= playoffStart && week <= playoffEnd;
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

        const matchups = buildMatchupsForRoster(
          standings.collectedMatchups || {},
          rid,
          standings.rosterMap || {},
          standings.playoffStart,
          standings.playoffEnd
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
          playoffSummary: {
            wins: playoff.wins || 0,
            losses: playoff.losses || 0,
            pf: playoff.pf || 0,
            pa: playoff.pa || 0
          },
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
                  <th style="width:48px;">Wk</th>
                  <th>Opponent</th>
                  <th class="col-num">My PTS</th>
                  <th class="col-num">Opp PTS</th>
                  <th class="col-num">Margin</th>
                  <th class="col-num">Result</th>
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
                        <a class="team-cell-link" href={m.oppMeta.owner_username ? `/team/${encodeURIComponent(m.oppMeta.owner_username)}` : '/rosters'}>
                          <img class="team-avatar small" src={avatarOrPh(m.oppMeta.team_avatar, m.oppMeta.team_name)} alt={m.oppMeta.team_name} />
                          <div>
                            <div class="team-name-cell">{m.oppMeta.team_name}</div>
                            {#if m.oppMeta.owner_name}<div class="team-owner-cell">{m.oppMeta.owner_name}</div>{/if}
                          </div>
                        </a>
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
  .team-cell-link { display: flex; align-items: center; gap: 0.75rem; text-decoration: none; color: inherit; transition: opacity 0.2s; }
  .team-cell-link:hover { opacity: 0.72; }
  .team-avatar.small { width: 38px; height: 38px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); border: 1px solid var(--border-subtle); }
  .team-name-cell { font-weight: 700; color: var(--text-primary); line-height: 1.15; }
  .team-owner-cell { color: var(--text-tertiary); font-size: 0.78rem; margin-top: 0.15rem; }

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
    .team-avatar.small { width: 30px; height: 30px; }
    .team-owner-cell { display: none; }
    .team-name-cell { font-size: 0.85rem; }
    .wk-cell { padding: 0.55rem 0.55rem; gap: 0.35rem; }
    .playoff-pill { font-size: 0.55rem; padding: 0.08rem 0.3rem; }
    .result-pill { min-width: 22px; padding: 0.1rem 0.3rem; font-size: 0.7rem; }
  }
</style>
