<!--
  src/routes/rules/+page.svelte — League rulebook.

  - Scoring rules: pulled live from Sleeper's `league.scoring_settings` so the
    numbers always match the actual league config. Switch settings in Sleeper
    and they show up here on the next page load.
  - House rules: hand-authored placeholder defaults. Edit the strings in the
    `HOUSE_RULES` block below to match your league's actual rules.
-->
<script>
  import { onMount } from 'svelte';
  import { getLeague, getSeasonsChain, pickActiveLeague, BASE_LEAGUE_ID } from '$lib/api';
  import { labelForScoringKey, groupForScoringKey, GROUP_ORDER, GROUP_LABELS } from '$lib/utils/scoringLabels';
  import SkeletonLoader from '$lib/components/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';

  let loading = true;
  let error = null;
  let league = null;
  let groupedScoring = {};        // group -> [{ key, label, value }]
  let rosterSlots = [];

  // ────────────────────────────────────────────────────────────────
  // House rules — EDIT THESE STRINGS to match your league. Sections
  // render in the order defined here.
  // ────────────────────────────────────────────────────────────────
  const HOUSE_RULES = [
    {
      title: 'League Format',
      bullets: [
        '14-team head-to-head NBA fantasy league.',
        'Each weekly matchup compares total points scored by each team\u2019s starting lineup.',
        'Owners manually select which of their player\u2019s games count toward each week\u2019s total via Sleeper\u2019s game-selection feature.'
      ]
    },
    {
      title: 'Roster Construction',
      bullets: [
        'Starters: PG · SG · G · SF · PF · F · C · UTIL · UTIL',
        'Bench: 4 slots.',
        'Reserve (IR): 2 slots — players must be inactive / out / GTD to qualify.',
        'Taxi: 2 slots — for younger players (vets allowed).'
      ]
    },
    {
      title: 'Draft',
      bullets: [
        'Rookie / startup draft happens before each season via the Sleeper draft room.',
        'Draft order set by reverse final standings (last place picks first), with the league champion picking last.',
        'Trading picks during the draft is allowed.'
      ]
    },
    {
      title: 'Waivers & Free Agency',
      bullets: [
        'FAAB-based bidding ($50 budget per owner per season).',
        'Waivers run daily at 9pm with a 2-day clearing period.',
        'Outside of waivers, players are added on a first-come, first-served free-agent basis.',
        'FAAB CAN be traded as part of a trade package.'
      ]
    },
    {
      title: 'Trades',
      bullets: [
        'Trade deadline: end of Week 18 (regular season).',
        'No commissioner review — trades process immediately once both sides accept in Sleeper.',
        'Collusion is grounds for league action; report any concerns to the commish.'
      ]
    },
    {
      title: 'Playoffs',
      bullets: [
        '8 teams qualify based on regular-season record (tiebreaker: points for).',
        'Bracket is 4 weeks total: 2 single-elimination rounds, then a 2-week merged championship final.',
        'Championship final score = sum of both weeks\u2019 starters_points.',
        'Toilet Bowl (consolation) runs for non-playoff teams.'
      ]
    },
    {
      title: 'Score Overrides',
      bullets: [
        'Sleeper\u2019s scoring engine is the source of truth during the live season.',
        'For finalized seasons in this site, any manual correction (forfeit, fixed missed lock, etc.) is applied by editing `teamAScore` / `teamBScore` directly in `/static/season_matchups/{year}.json`.',
        'See `CONTRIBUTING.md` in the repo for the full data-lifecycle write-up.'
      ]
    }
  ];

  async function loadData() {
    loading = true; error = null;
    try {
      let leagueId = BASE_LEAGUE_ID;
      try {
        const { seasons } = await getSeasonsChain(BASE_LEAGUE_ID);
        const active = pickActiveLeague(seasons);
        if (active?.league_id) leagueId = String(active.league_id);
      } catch (e) { /* fallback */ }

      league = await getLeague(leagueId);
      groupedScoring = groupScoring(league?.scoring_settings || {});
      rosterSlots = parseRosterSlots(league?.roster_positions || []);
    } catch (err) {
      error = err;
      console.error('[Rules] load error:', err);
    } finally {
      loading = false;
    }
  }

  function groupScoring(settings) {
    const groups = {};
    for (const k of Object.keys(settings)) {
      const v = settings[k];
      if (v == null || v === 0) continue;        // skip unused rules
      const group = groupForScoringKey(k);
      if (!groups[group]) groups[group] = [];
      groups[group].push({ key: k, label: labelForScoringKey(k), value: Number(v) });
    }
    // Sort each group: positives first (desc), then negatives (asc).
    for (const g of Object.keys(groups)) {
      groups[g].sort((a, b) => {
        if ((a.value >= 0) !== (b.value >= 0)) return a.value >= 0 ? -1 : 1;
        return Math.abs(b.value) - Math.abs(a.value);
      });
    }
    return groups;
  }

  function parseRosterSlots(positions) {
    const counts = {};
    for (const p of positions) counts[p] = (counts[p] || 0) + 1;
    const order = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'BN', 'IR', 'TAXI'];
    return order
      .filter((p) => counts[p])
      .map((p) => ({ pos: p, count: counts[p] }))
      .concat(
        Object.keys(counts)
          .filter((p) => !order.includes(p))
          .map((p) => ({ pos: p, count: counts[p] }))
      );
  }

  function fmtVal(v) {
    if (v === Math.trunc(v)) return String(v);
    return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  onMount(loadData);
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="eyebrow">League · Documentation</div>
    <h1 class="page-title">Rules &amp; Scoring</h1>
    <p class="page-sub">House rules and the full scoring system. Scoring values pulled live from Sleeper — change them in Sleeper and they update here on the next load.</p>
  </header>

  {#if loading}
    <SkeletonLoader variant="text" count={8} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadData} context="rules" />
  {:else}
    <!-- ROSTER ──────────────────────────────────────────────── -->
    {#if rosterSlots.length}
      <section class="block" data-testid="rules-roster">
        <div class="block-head">
          <h2 class="block-title">Roster Configuration</h2>
          <div class="meta-line">{league?.settings?.num_teams ?? '?'} owners · {league?.name ?? 'Badger Bowl'}</div>
        </div>
        <div class="slots">
          {#each rosterSlots as s}
            <div class="slot" data-testid={`roster-slot-${s.pos}`}>
              <span class="slot-pos">{s.pos}</span>
              <span class="slot-count">×{s.count}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- SCORING (data-driven) ──────────────────────────────── -->
    <section class="block" data-testid="rules-scoring">
      <div class="block-head">
        <h2 class="block-title">Scoring System</h2>
        <div class="meta-line">Live from Sleeper · Season {league?.season ?? '—'}</div>
      </div>

      <div class="scoring-grid">
        {#each GROUP_ORDER as g}
          {#if groupedScoring[g]?.length}
            <div class="scoring-group" data-testid={`scoring-group-${g}`}>
              <div class="group-title">{GROUP_LABELS[g]}</div>
              <table class="scoring-table">
                <tbody>
                  {#each groupedScoring[g] as row}
                    <tr class:negative={row.value < 0}>
                      <td class="lbl">{row.label}</td>
                      <td class="val">
                        <span class="pill" class:neg={row.value < 0} class:pos={row.value > 0}>
                          {row.value > 0 ? '+' : ''}{fmtVal(row.value)}
                        </span>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/each}
      </div>
    </section>

    <!-- HOUSE RULES ─────────────────────────────────────────── -->
    {#each HOUSE_RULES as section, i}
      <section class="block" data-testid={`house-rule-${i}`}>
        <div class="block-head">
          <h2 class="block-title">{section.title}</h2>
        </div>
        <ul class="rules-list">
          {#each section.bullets as b}
            <li>{b}</li>
          {/each}
        </ul>
      </section>
    {/each}

    <!-- Footer note -->
    <p class="footer-note">
      Rules questions? Ping the commish in the league chat. To edit this page, see <code>src/routes/rules/+page.svelte</code>.
    </p>
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }

  .page-head { margin-bottom: 2rem; }

  .page-title {
    font-family: var(--font-display);
    font-size: clamp(2.5rem, 5vw, 4rem);
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin: 0.25rem 0 0.75rem;
  }

  .page-sub {
    color: var(--text-secondary);
    font-size: 1rem;
    max-width: 68ch;
    line-height: 1.6;
  }

  .block {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    margin-bottom: 1.25rem;
    padding: 1.5rem;
  }

  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.1rem;
    padding-bottom: 0.8rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .block-title {
    font-family: var(--font-display);
    font-size: 1.4rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin: 0;
  }

  .meta-line {
    color: var(--text-tertiary);
    font-size: 0.75rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 700;
  }

  /* Roster slots */
  .slots {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .slot {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.55rem 0.85rem;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
  }

  .slot-pos {
    font-family: var(--font-display);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    font-size: 0.95rem;
  }

  .slot-count {
    color: var(--text-secondary);
    font-weight: 600;
    font-size: 0.85rem;
  }

  /* Scoring */
  .scoring-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.25rem;
  }

  .scoring-group {
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 0.85rem 1rem 1rem;
  }

  .group-title {
    font-family: var(--font-body);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.7rem;
    color: var(--brand);
    margin-bottom: 0.6rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .scoring-table {
    width: 100%;
    border-collapse: collapse;
  }

  .scoring-table td {
    padding: 0.4rem 0;
    vertical-align: middle;
  }

  .scoring-table .lbl {
    color: var(--text-secondary);
    font-size: 0.9rem;
  }

  .scoring-table .val {
    text-align: right;
    width: 1%;
    white-space: nowrap;
  }

  .pill {
    display: inline-block;
    min-width: 3.2rem;
    text-align: center;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.82rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .pill.pos {
    color: var(--win, #5eead4);
    background: rgba(94, 234, 212, 0.1);
    border: 1px solid rgba(94, 234, 212, 0.25);
  }

  .pill.neg {
    color: #fca5a5;
    background: rgba(252, 165, 165, 0.1);
    border: 1px solid rgba(252, 165, 165, 0.25);
  }

  /* Rules lists */
  .rules-list {
    margin: 0;
    padding-left: 1.3rem;
    list-style: square;
  }

  .rules-list li {
    color: var(--text-secondary);
    padding: 0.35rem 0;
    line-height: 1.55;
  }

  .rules-list li :global(code) {
    background: var(--surface-2);
    color: var(--accent);
    padding: 0.1rem 0.35rem;
    border-radius: var(--r-sm);
    font-size: 0.85em;
  }

  .footer-note {
    color: var(--text-tertiary);
    font-size: 0.85rem;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px dashed var(--border-subtle);
  }

  .footer-note code {
    background: var(--surface-2);
    color: var(--accent);
    padding: 0.1rem 0.35rem;
    border-radius: var(--r-sm);
    font-size: 0.9em;
  }

  @media (max-width: 640px) {
    .scoring-grid { grid-template-columns: 1fr; }
    .block { padding: 1.1rem; }
  }
</style>
