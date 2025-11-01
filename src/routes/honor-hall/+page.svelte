<!-- src/routes/honor-hall/+page.svelte -->
<script>
  export let data;

  // seasons list and selection
  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  // finalStandingsBySeason mapping returned by server
  const finalStandingsBySeason = data?.finalStandingsBySeason ?? {};
  // top-level fallbacks
  const finalStandingsFallback = Array.isArray(data?.finalStandings) ? data.finalStandings : [];

  // pick the season result
  $: selectedSeasonKey = String(selectedSeason);
  $: selectedSeasonResult = finalStandingsBySeason[selectedSeasonKey] ?? { finalStandings: finalStandingsFallback, debug: data?.debug ?? [] };
  $: finalStandings = Array.isArray(selectedSeasonResult.finalStandings) ? selectedSeasonResult.finalStandings : [];

  // helper to build player headshot URL (NBA)
  function playerHeadshot(playerId, size = 56) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // format points to a single decimal place safely
  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  // MVPs from server (already include playerName / roster_meta where possible)
  const finalsMvp = data?.finalsMvp ?? null;
  const overallMvp = data?.overallMvp ?? null;

  // champion/biggest loser from finalStandings
  $: champion = finalStandings && finalStandings.length ? finalStandings[0] : null;
  $: biggestLoser = finalStandings && finalStandings.length ? finalStandings[finalStandings.length - 1] : null;

  // messages & other
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function placeEmoji(rank) {
    if (rank === 1) return '🏆';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  }
</script>

<style>
  :global(body) {
    color: #e6eef8;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
    margin: 0;
    padding: 0;
    background: transparent;
  }

  /* container */
  .container {
    max-width: 1180px;
    margin: 16px auto;
    padding: 12px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    align-items: start;
    box-sizing: border-box;
  }

  /* header should span full width on desktop */
  .header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
  .header-left { display:flex; flex-direction:column; gap:6px; }

  h1 { font-size: 1.4rem; margin:0; color: #e6eef8; line-height:1; }
  .subtitle { color: rgba(230,238,248,0.7); margin:0; font-size:.95rem; }

  .main, .side {
    background: rgba(6,8,12,0.65);
    border-radius: 12px;
    padding: 12px;
    border: 1px solid rgba(255,255,255,0.04);
    box-shadow: 0 10px 30px rgba(2,6,23,0.55);
    backdrop-filter: blur(6px);
    color: inherit;
  }

  /* filters */
  .filters { display:flex; align-items:center; gap:.6rem; }
  .season-label { color: #cbd5e1; font-weight:700; margin-right:.4rem; font-size:.95rem; }

  /* === Standings exact-style select ===
     Copied styling to match the dropdown on the Standings page:
     - slightly taller rounded corner
     - subtle gradient/inset to match card color
     - thicker right padding for caret
     - caret color tuned to the other pages
  */
  .select-wrap { position: relative; display:inline-block; }
  select.season-select {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;

    /* match the standings select visual: subtle card-like background */
    background: linear-gradient(180deg, rgba(255,255,255,0.018) 0%, rgba(255,255,255,0.008) 100%);
    border: 1px solid rgba(255,255,255,0.06);
    color: #e6eef8;
    padding: 9px 14px;
    padding-right: 40px; /* room for caret */
    border-radius: 10px;
    font-weight: 700;
    min-width: 140px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.02), 0 6px 18px rgba(2,6,23,0.45);
    font-size: .95rem;
    line-height: 1;
  }
  .select-wrap::after {
    content: "▾";
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: rgba(156, 170, 174, 0.95); /* caret color matched to standings */
    font-size: 0.92rem;
    text-shadow: 0 1px 0 rgba(0,0,0,0.25);
  }
  select.season-select option {
    background: rgba(6,8,12,0.92);
    color: #e6eef8;
  }

  /* standings list */
  .standings-list { list-style:none; margin:0; padding:0; }
  .stand-row {
    display:flex;
    align-items:center;
    gap:12px;
    padding:10px;
    border-bottom:1px solid rgba(255,255,255,0.03);
  }
  .rank { min-width:48px; font-weight:800; display:flex; align-items:center; gap:8px; color:#e6eef8; justify-content:flex-start; font-size:.95rem; }
  .player { display:flex; align-items:center; gap:12px; min-width:0; }
  .avatar { width:clamp(44px,8vw,64px); height:clamp(44px,8vw,64px); border-radius:8px; object-fit:cover; flex-shrink:0; border:1px solid rgba(255,255,255,0.04); }
  .teamName { font-weight:800; color:#e6eef8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:calc(100vw - 220px); }
  .teamMeta { color: #9aa3ad; font-size:.9rem; margin-top:4px; }
  .seedCol { margin-left:auto; color:#9aa3ad; font-weight:700; min-width:56px; text-align:right; font-size:.95rem; }

  @media (max-width: 420px) {
    .teamName { max-width: calc(100vw - 160px); font-size:.95rem; }
    .seedCol { display:none; }
    .rank { min-width:36px; font-size:.9rem; }
    .avatar { width:48px; height:48px; }
  }

  /* outcomes (side) */
  .outcome-row { display:flex; gap:12px; align-items:center; margin-bottom:12px; }
  .outcome-name { font-weight:700; color:#e6eef8; font-size:1rem; }
  .small { color:#9aa3ad; font-size:.9rem; }

  .no-standings { color:#9aa3ad; padding:12px 0; }

  /* DESKTOP: grid with sidebar */
  @media (min-width: 980px) {
    .container {
      grid-template-columns: 1fr 360px;
      gap: 20px;
      padding: 20px;
    }

    /* make header span both columns */
    .header { grid-column: 1 / -1; }

    /* keep side sticky */
    .side { position: sticky; top: 16px; align-self: start; }
  }
</style>

<div class="container">
  <div class="header">
    <div class="header-left">
      <h1>Honors Hall</h1>
      <div class="subtitle">Final placements computed from playoff results — season {selectedSeason}</div>
    </div>

    <form id="filters" method="get" class="filters" aria-hidden="false">
      <label class="season-label" for="season">Season</label>
      <div class="select-wrap">
        <select id="season" name="season" class="season-select" on:change={submitFilters}>
          {#if seasons && seasons.length}
            {#each seasons as s}
              <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeason)}>
                {s.season ?? s.name ?? s.league_id}
              </option>
            {/each}
          {:else}
            <option value={selectedSeason}>{selectedSeason}</option>
          {/if}
        </select>
      </div>
    </form>
  </div>

  <div class="main" aria-live="polite">
    <h3 style="margin:0 0 12px 0">Final Standings</h3>
    <ul class="standings-list" role="list" aria-label="Final standings">
      {#if finalStandings && finalStandings.length}
        {#each finalStandings as row (row.rosterId)}
          <li class="stand-row" role="listitem">
            <div class="rank" aria-hidden="true">
              <span>{row.rank}</span>
              <span style="font-size:1rem">{placeEmoji(row.rank)}</span>
            </div>

            <div class="player" style="min-width:0;">
              <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt="team avatar">
              <div style="min-width:0;">
                <div class="teamName" title={row.team_name}>{row.team_name}</div>
                <div class="teamMeta">
                  {#if row.owner_name}
                    {row.owner_name}
                  {:else}
                    {`Roster ${row.rosterId}`}
                  {/if}
                </div>
              </div>
            </div>

            <div class="seedCol" aria-hidden="true">Seed #{row.seed ?? '—'}</div>
          </li>
        {/each}
      {:else}
        <li class="no-standings">No final standings available.</li>
      {/if}
    </ul>
  </div>

  <aside class="side" aria-labelledby="outcomes-title">
    <h3 id="outcomes-title" style="margin-top:0">Season outcomes</h3>

    {#if champion}
      <div class="outcome-row" style="margin-top:6px;">
        <img class="avatar" src={avatarOrPlaceholder(champion.avatar, champion.team_name)} alt="champion avatar" style="width:64px;height:64px">
        <div>
          <div class="outcome-name">Champion <span style="margin-left:6px">🏆</span></div>
          <div class="small">{champion.team_name} • {champion.owner_name ?? `Roster ${champion.rosterId}`} • Seed #{champion.seed ?? '—'}</div>
        </div>
      </div>
    {/if}

    {#if biggestLoser}
      <div style="margin-top:8px" class="outcome-row">
        <img class="avatar" src={avatarOrPlaceholder(biggestLoser.avatar, biggestLoser.team_name)} alt="biggest loser avatar" style="width:64px;height:64px">
        <div>
          <div class="outcome-name">Biggest loser <span style="margin-left:6px">😵‍💫</span></div>
          <div class="small">{biggestLoser.team_name} • {biggestLoser.owner_name ?? `Roster ${biggestLoser.rosterId}`} • Seed #{biggestLoser.seed ?? '—'}</div>
        </div>
      </div>
    {/if}

    {#if finalsMvp}
      <div style="margin-top:12px" class="outcome-row">
        <img
          class="avatar"
          src={playerHeadshot(finalsMvp.playerId) || avatarOrPlaceholder(finalsMvp.roster_meta?.owner_avatar, finalsMvp.playerName)}
          alt="finals mvp avatar"
          style="width:56px;height:56px"
          on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(finalsMvp.roster_meta?.owner_avatar, finalsMvp.playerName); }}
        />
        <div>
          <div class="outcome-name">Finals MVP</div>
          <div class="small">
            {finalsMvp.playerName ?? finalsMvp.playerObj?.full_name ?? `Player ${finalsMvp.playerId ?? '—'}`}
            • {formatPts(finalsMvp.points ?? finalsMvp.score ?? finalsMvp.pts ?? 0)} pts
            • {finalsMvp.roster_meta?.owner_name ?? `Roster ${finalsMvp.rosterId ?? finalsMvp.topRosterId ?? '—'}`}
          </div>
        </div>
      </div>
    {:else}
      <div style="margin-top:12px" class="outcome-row">
        <div style="width:56px;height:56px;border-radius:8px;background:rgba(255,255,255,0.02);display:flex;align-items:center;justify-content:center">—</div>
        <div>
          <div class="outcome-name">Finals MVP</div>
          <div class="small">Not available</div>
        </div>
      </div>
    {/if}

    {#if overallMvp}
      <div style="margin-top:12px" class="outcome-row">
        <img
          class="avatar"
          src={playerHeadshot(overallMvp.playerId || overallMvp.topPlayerId) || avatarOrPlaceholder(overallMvp.roster_meta?.owner_avatar, overallMvp.playerName)}
          alt="overall mvp avatar"
          style="width:56px;height:56px"
          on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(overallMvp.roster_meta?.owner_avatar, overallMvp.playerName); }}
        />
        <div>
          <div class="outcome-name">Overall MVP</div>
          <div class="small">
            {overallMvp.playerName ?? overallMvp.playerObj?.full_name ?? `Player ${overallMvp.playerId ?? overallMvp.topPlayerId ?? '—'}`}
            • {formatPts(overallMvp.points ?? overallMvp.total ?? overallMvp.score ?? 0)} pts
            • {overallMvp.roster_meta?.owner_name ?? `Roster ${overallMvp.rosterId ?? overallMvp.topRosterId ?? '—'}`}
          </div>
        </div>
      </div>
    {:else}
      <div style="margin-top:12px" class="outcome-row">
        <div style="width:56px;height:56px;border-radius:8px;background:rgba(255,255,255,0.02);display:flex;align-items:center;justify-content:center">—</div>
        <div>
          <div class="outcome-name">Overall MVP</div>
          <div class="small">Not available</div>
        </div>
      </div>
    {/if}

    <div style="margin-top:12px; color:#9aa3ad; font-size:.9rem">
      Final standings are derived from server-scrubbed matchups and the bracket simulation logic.
    </div>
  </aside>
</div>
