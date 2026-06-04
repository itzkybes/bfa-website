<!-- src/routes/admin/generate-season-matchups/+page.svelte (client-side fetched) -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { getSeasonsChain, getMatchupsForWeek, getRosterMapWithOwners, getLeague, BASE_LEAGUE_ID } from '$lib/api';
  import { computeParticipantPoints } from '$lib/compute';
  import SkeletonLoader from '$lib/components/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';

  let loading = true;
  let error = null;
  let messages = [];
  let outputs = [];

  function copyJSON(jsonStr) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(jsonStr).then(
        () => alert('JSON copied to clipboard — paste into GitHub file.'),
        (err) => alert('Copy failed: ' + String(err))
      );
    } else {
      window.prompt('Copy the JSON below (Ctrl+C / Cmd+C):', jsonStr);
    }
  }

  async function generate() {
    loading = true; error = null; messages = []; outputs = [];
    try {
      const yearsParam = $page.url.searchParams.get('years');
      const { seasons } = await getSeasonsChain(BASE_LEAGUE_ID);
      // Default = every COMPLETED season in the chain. The "current" in-progress
      // season is intentionally skipped — we don't want to freeze partial data
      // into the static snapshot. Override via `?years=2025,2026` if needed.
      const completedYears = seasons
        .filter((s) => s.status === 'complete' && s.season)
        .map((s) => String(s.season));
      const years = yearsParam
        ? yearsParam.split(',').map(y => y.trim()).filter(Boolean)
        : completedYears;
      messages = [`Requested years: ${years.join(', ') || '(none — all seasons appear in-progress)'}`];
      for (const yr of years) {
        const target = seasons.find(s => String(s.season) === yr);
        if (!target) { messages = [...messages, `Skip ${yr}: no league found in chain`]; continue; }
        messages = [...messages, `Processing ${yr} (league ${target.league_id})…`];

        const league = await getLeague(target.league_id);
        let playoffStart = league?.settings?.playoff_week_start ? Number(league.settings.playoff_week_start) : 15;
        if (isNaN(playoffStart) || playoffStart < 1) playoffStart = 15;
        const rosterMap = await getRosterMapWithOwners(target.league_id);
        const weeks = {};
        for (let week = 1; week <= 22; week++) {
          let raw = null;
          try { raw = await getMatchupsForWeek(target.league_id, week); } catch (e) { continue; }
          if (!Array.isArray(raw) || !raw.length) continue;
          const byM = {};
          for (let i = 0; i < raw.length; i++) {
            const m = raw[i];
            const mid = m.matchup_id ?? m.matchupId ?? ('auto'+i);
            if (!byM[mid]) byM[mid] = [];
            byM[mid].push(m);
          }
          weeks[String(week)] = Object.entries(byM).map(([mid, arr]) => {
            if (arr.length !== 2) return null;
            const [a, b] = arr;
            const aId = String(a.roster_id ?? '');
            const bId = String(b.roster_id ?? '');
            const aMeta = rosterMap[aId] || {};
            const bMeta = rosterMap[bId] || {};
            const teamA = {
              rosterId: aId, name: aMeta.team_name, ownerName: aMeta.owner_name,
              avatar: aMeta.team_avatar, starters: a.starters || [], starters_points: a.starters_points
            };
            const teamB = {
              rosterId: bId, name: bMeta.team_name, ownerName: bMeta.owner_name,
              avatar: bMeta.team_avatar, starters: b.starters || [], starters_points: b.starters_points
            };
            return {
              matchup_id: Number(mid) || mid,
              teamA,
              teamAScore: computeParticipantPoints(a),
              teamB,
              teamBScore: computeParticipantPoints(b)
            };
          }).filter(Boolean);
        }
        outputs = [...outputs, { year: yr, meta: { playoff_week_start: playoffStart }, weeks }];
        messages = [...messages, `Done ${yr}: ${Object.keys(weeks).length} weeks`];
      }
    } catch (e) {
      console.error('[Admin] failed', e);
      error = e;
    } finally {
      loading = false;
    }
  }

  onMount(generate);
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="eyebrow">Admin · Tooling</div>
    <h1 class="page-title">Generate Season Matchups JSON</h1>
    <p class="page-sub">Fetches matchups + roster metadata from Sleeper and produces JSON payloads mirroring <code>/season_matchups/&lt;year&gt;.json</code>. Files are NOT written — copy the JSON into GitHub. Pass <code>?years=2022,2023,2024</code> in the URL.</p>
  </header>

  {#if loading}
    <SkeletonLoader variant="text" count={6} />
  {:else if error}
    <ErrorBoundary {error} onRetry={generate} context="admin tool" />
  {:else}
    <section class="block">
      <div class="block-head"><h2 class="block-title">Messages</h2></div>
      {#if messages.length}
        <ol class="msg-list">{#each messages as m}<li>{m}</li>{/each}</ol>
      {:else}<div class="empty-card">No messages.</div>{/if}
    </section>

    {#each outputs as out}
      <section class="block">
        <div class="block-head">
          <div>
            <h2 class="block-title">Season {out.year}</h2>
            <div class="meta-line">Playoff start: <strong>{out.meta.playoff_week_start ?? '15'}</strong> · Weeks: <strong>{Object.keys(out.weeks).length}</strong></div>
          </div>
          <button class="btn primary sm" on:click={() => copyJSON(JSON.stringify(out.weeks, null, 2))} data-testid={`admin-copy-${out.year}`}>Copy JSON</button>
        </div>
        <div class="block-body"><pre class="jsonblob">{JSON.stringify(out.weeks, null, 2)}</pre></div>
      </section>
    {/each}
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }
  .page-title { font-family: var(--font-display); font-size: clamp(2rem, 5vw, 3.5rem); line-height: 1; text-transform: uppercase; margin: 0.4rem 0 0.5rem; }
  .page-sub { color: var(--text-secondary); max-width: 70ch; }
  .page-sub code { background: var(--surface-2); color: var(--accent); padding: 0.1rem 0.4rem; border-radius: var(--r-sm); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; }
  .block { background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); overflow: hidden; margin-bottom: 1rem; }
  .block-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); gap: 1rem; flex-wrap: wrap; }
  .block-title { font-family: var(--font-display); font-size: 1.3rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .meta-line { color: var(--text-tertiary); font-size: 0.85rem; margin-top: 0.25rem; }
  .meta-line strong { color: var(--accent); }
  .block-body { padding: 1rem 1.25rem; }
  .msg-list { padding: 1rem 2.25rem; margin: 0; color: var(--text-secondary); font-size: 0.9rem; display: flex; flex-direction: column; gap: 0.4rem; }
  .jsonblob { background: var(--bg-base); color: var(--text-secondary); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); padding: 1rem; overflow: auto; max-height: 480px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; line-height: 1.5; }
  .empty-card { padding: 1.5rem; text-align: center; color: var(--text-secondary); }
</style>
