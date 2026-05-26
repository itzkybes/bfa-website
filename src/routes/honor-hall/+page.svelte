<!-- src/routes/honor-hall/+page.svelte — Final standings & season outcomes -->
<script>
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);

  const finalStandingsBySeason = data?.finalStandingsBySeason ?? {};
  const finalStandingsFallback = Array.isArray(data?.finalStandings) ? data.finalStandings : [];

  $: selectedKey = String(selectedSeason);
  $: selectedResult = finalStandingsBySeason[selectedKey] ?? { finalStandings: finalStandingsFallback };
  $: finalStandings = Array.isArray(selectedResult.finalStandings) ? selectedResult.finalStandings : [];

  const finalsMvp = data?.finalsMvp ?? null;
  const overallMvp = data?.overallMvp ?? null;

  $: champion = finalStandings.length ? finalStandings[0] : null;
  $: biggestLoser = finalStandings.length ? finalStandings[finalStandings.length - 1] : null;

  function headshot(pid) { return pid ? `https://sleepercdn.com/content/nba/players/${pid}.jpg` : ''; }

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? name[0].toUpperCase() : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }

  function fmt(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function placeEmoji(rank) {
    if (rank === 1) return '🏆';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  }

  function submitForm(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="head-row">
      <div>
        <div class="eyebrow">Honors · Season {selectedSeason}</div>
        <h1 class="page-title">Honor Hall</h1>
        <p class="page-sub">Final placements derived from bracket simulation across the playoff window.</p>
      </div>
      <form id="filters" method="get" data-sveltekit-reload>
        <label for="season-select" class="visually-hidden">Season</label>
        <select id="season-select" name="season" on:change={submitForm} data-testid="honor-season-select">
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>
              {s.season ?? s.name ?? s.league_id}
            </option>
          {/each}
        </select>
      </form>
    </div>
  </header>

  <!-- Hero: Champion + Biggest Loser + MVPs (bento) -->
  <section class="bento">
    {#if champion}
      <div class="bento-card champion-card" data-testid="champion-card">
        <div class="card-corner">
          <span class="rank-tag num">#1</span>
        </div>
        <div class="champion-trophy">🏆</div>
        <div class="card-eyebrow">Champion</div>
        <img class="champion-avatar" src={avatarOrPh(champion.avatar, champion.team_name)} alt={champion.team_name} />
        <div class="champion-name">{champion.team_name}</div>
        <div class="champion-owner">
          {#if champion.owner_name}{champion.owner_name} · {/if}Seed #{champion.seed ?? '—'}
        </div>
      </div>
    {/if}

    {#if biggestLoser && biggestLoser !== champion}
      <div class="bento-card loser-card" data-testid="biggest-loser-card">
        <div class="card-corner">
          <span class="rank-tag num">#{biggestLoser.rank ?? finalStandings.length}</span>
        </div>
        <div class="loser-icon">😵‍💫</div>
        <div class="card-eyebrow">Biggest Loser</div>
        <img class="champion-avatar" src={avatarOrPh(biggestLoser.avatar, biggestLoser.team_name)} alt={biggestLoser.team_name} />
        <div class="champion-name dim">{biggestLoser.team_name}</div>
        <div class="champion-owner">
          {#if biggestLoser.owner_name}{biggestLoser.owner_name} · {/if}Seed #{biggestLoser.seed ?? '—'}
        </div>
      </div>
    {/if}

    {#if finalsMvp}
      <div class="bento-card mvp-card" data-testid="finals-mvp-card">
        <div class="card-eyebrow accent">Finals MVP</div>
        <img
          class="mvp-headshot"
          src={headshot(finalsMvp.playerId) || avatarOrPh(finalsMvp.roster_meta?.team_avatar, finalsMvp.playerName)}
          alt={finalsMvp.playerName}
          on:error={(e) => (e.currentTarget.src = avatarOrPh(finalsMvp.roster_meta?.team_avatar, finalsMvp.playerName))}
        />
        <div class="mvp-name">{finalsMvp.playerName ?? '—'}</div>
        <div class="mvp-pts num">{fmt(finalsMvp.points)}<span class="pts-suffix"> PTS</span></div>
        <div class="mvp-sub">{finalsMvp.roster_meta?.owner_name ?? `Roster ${finalsMvp.rosterId ?? '—'}`}</div>
      </div>
    {/if}

    {#if overallMvp}
      <div class="bento-card mvp-card" data-testid="overall-mvp-card">
        <div class="card-eyebrow accent">Overall MVP</div>
        <img
          class="mvp-headshot"
          src={headshot(overallMvp.playerId) || avatarOrPh(overallMvp.roster_meta?.team_avatar, overallMvp.playerName)}
          alt={overallMvp.playerName}
          on:error={(e) => (e.currentTarget.src = avatarOrPh(overallMvp.roster_meta?.team_avatar, overallMvp.playerName))}
        />
        <div class="mvp-name">{overallMvp.playerName ?? '—'}</div>
        <div class="mvp-pts num">{fmt(overallMvp.points)}<span class="pts-suffix"> PTS</span></div>
        <div class="mvp-sub">{overallMvp.roster_meta?.owner_name ?? `Roster ${overallMvp.rosterId ?? overallMvp.topRosterId ?? '—'}`}</div>
      </div>
    {/if}
  </section>

  <!-- Final standings list -->
  <section class="block">
    <div class="block-head">
      <h2 class="block-title">Final Standings</h2>
      <span class="block-sub">Computed from bracket simulation</span>
    </div>

    {#if finalStandings.length}
      <ol class="standings-list" data-testid="honor-standings-list">
        {#each finalStandings as row, idx (row.rosterId)}
          <li class="standings-row" class:gold={row.rank === 1}>
            <div class="rank-col num">
              {row.rank}
              {#if placeEmoji(row.rank)}
                <span class="medal">{placeEmoji(row.rank)}</span>
              {/if}
            </div>
            <img class="team-avatar small" src={avatarOrPh(row.avatar, row.team_name)} alt={row.team_name} />
            <div class="team-meta">
              <div class="team-name">{row.team_name}</div>
              <div class="team-owner">{row.owner_name ?? `Roster ${row.rosterId}`}</div>
            </div>
            <div class="seed-col">
              <span class="num">#{row.seed ?? '—'}</span>
              <span class="seed-label">Seed</span>
            </div>
          </li>
        {/each}
      </ol>
    {:else}
      <div class="empty-card">No standings available.</div>
    {/if}
  </section>
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }

  .head-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .page-title {
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 6vw, 4rem);
    line-height: 1;
    text-transform: uppercase;
    margin: 0.4rem 0 0.5rem;
  }

  .page-sub { color: var(--text-secondary); max-width: 60ch; }

  /* Bento grid */
  .bento {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    grid-template-rows: auto auto;
    gap: 0.85rem;
    margin-bottom: 2rem;
  }

  .bento-card {
    position: relative;
    padding: 1.75rem 1.5rem;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    overflow: hidden;
    transition: border-color var(--t-fast), transform var(--t-fast);
  }

  .bento-card:hover {
    border-color: var(--border-strong);
    transform: translateY(-2px);
  }

  .champion-card {
    grid-row: span 2;
    background:
      radial-gradient(600px 200px at 100% 0%, rgba(245, 180, 0, 0.18), transparent 60%),
      linear-gradient(180deg, var(--surface-1), var(--surface-2));
    border-color: var(--gold);
    border-left: 4px solid var(--gold);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    min-height: 320px;
  }

  .champion-trophy {
    font-size: 4rem;
    margin-bottom: 0.5rem;
    line-height: 1;
  }

  .loser-card {
    border-color: var(--loss);
    border-left: 4px solid var(--loss);
  }

  .loser-icon {
    font-size: 2rem;
    margin-bottom: 0.4rem;
    line-height: 1;
  }

  .card-corner {
    position: absolute;
    top: 1rem;
    right: 1rem;
  }

  .rank-tag {
    font-size: 1.4rem;
    color: var(--text-tertiary);
  }

  .card-eyebrow {
    font-family: var(--font-body);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: 0.72rem;
    color: var(--text-tertiary);
    margin-bottom: 0.75rem;
  }

  .card-eyebrow.accent { color: var(--accent); }

  .champion-avatar {
    width: 80px;
    height: 80px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    margin-bottom: 0.85rem;
  }

  .champion-name {
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 3vw, 2.4rem);
    line-height: 1;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.5rem;
    word-break: break-word;
  }

  .champion-name.dim { color: var(--text-secondary); font-size: 1.6rem; }

  .champion-owner {
    color: var(--text-secondary);
    font-size: 0.88rem;
  }

  .mvp-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .mvp-headshot {
    width: 64px;
    height: 64px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    margin-bottom: 0.6rem;
  }

  .mvp-name {
    font-family: var(--font-display);
    font-size: 1.3rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    line-height: 1;
    margin-bottom: 0.3rem;
  }

  .mvp-pts {
    font-size: 1.5rem;
    color: var(--accent);
    line-height: 1;
    margin-bottom: 0.3rem;
  }

  .pts-suffix {
    font-family: var(--font-body);
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.2em;
    color: var(--text-tertiary);
  }

  .mvp-sub {
    color: var(--text-tertiary);
    font-size: 0.78rem;
  }

  /* Final standings */
  .block {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    overflow: hidden;
  }

  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-subtle);
    gap: 1rem;
  }

  .block-title {
    font-family: var(--font-display);
    font-size: 1.3rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .block-sub {
    color: var(--text-tertiary);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-weight: 700;
  }

  .standings-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .standings-row {
    display: grid;
    grid-template-columns: 70px 56px 1fr auto;
    gap: 1rem;
    align-items: center;
    padding: 0.85rem 1.25rem;
    border-bottom: 1px solid var(--border-subtle);
    transition: background var(--t-fast);
  }

  .standings-row:last-child { border-bottom: none; }
  .standings-row:hover { background: rgba(255, 255, 255, 0.03); }

  .standings-row.gold {
    background: linear-gradient(90deg, rgba(245, 180, 0, 0.08), transparent);
    border-left: 3px solid var(--gold);
    padding-left: calc(1.25rem - 3px);
  }

  .rank-col {
    font-size: 1.4rem;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .medal {
    font-family: var(--font-body);
    font-size: 1rem;
  }

  .team-avatar.small {
    width: 56px;
    height: 56px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
  }

  .team-meta { min-width: 0; }

  .team-name {
    font-family: var(--font-display);
    font-size: 1.2rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-primary);
    line-height: 1.15;
  }

  .team-owner {
    color: var(--text-tertiary);
    font-size: 0.8rem;
    margin-top: 0.2rem;
  }

  .seed-col {
    text-align: right;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .seed-col .num {
    font-size: 1.2rem;
    color: var(--accent);
  }

  .seed-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-tertiary);
    font-weight: 700;
  }

  .empty-card {
    padding: 1.5rem;
    text-align: center;
    color: var(--text-secondary);
  }

  @media (max-width: 980px) {
    .bento {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: auto;
    }
    .champion-card {
      grid-row: span 1;
      grid-column: span 2;
    }
  }

  @media (max-width: 600px) {
    .bento { grid-template-columns: 1fr; }
    .champion-card { grid-column: span 1; }

    .standings-row {
      grid-template-columns: 50px 44px 1fr auto;
      padding: 0.7rem 0.85rem;
      gap: 0.6rem;
    }
    .team-avatar.small { width: 44px; height: 44px; }
    .team-name { font-size: 1rem; }
  }
</style>
