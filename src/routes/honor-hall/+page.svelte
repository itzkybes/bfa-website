<!-- src/routes/honor-hall/+page.svelte -->
<script>
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  const matchupsRows = data?.matchupsRows ?? [];
  const finalStandings = data?.finalStandings ?? [];
  const regularStandings = data?.regularStandings ?? [];
  const debug = data?.debug ?? [];
  const messages = data?.messages ?? [];
  const jsonLinks = data?.jsonLinks ?? [];
  const seasonJsonLoaded = data?.seasonJsonLoaded ?? false;
  const seasonJsonPathsTried = data?.seasonJsonPathsTried ?? [];

  // top-level provided by server
  const champion = data?.champion ?? null;
  const biggestLoser = data?.biggestLoser ?? null;
  const finalsMvp = data?.finalsMvp ?? null;
  const overallMvp = data?.overallMvp ?? null;
  const winnersBracketSize = Number(data?.winnersBracketSize ?? data?.winnersBracketSize ?? 8);

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

  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function playerDisplayName(mvp) {
    if (!mvp) return null;
    return mvp.player_meta?.full_name ?? mvp.playerName ?? mvp.playerObj?.full_name ?? mvp.topPlayerName ?? null;
  }
  function playerDisplayHeadshot(mvp) {
    if (!mvp) return null;
    return mvp.player_meta?.headshot ?? mvp.roster_meta?.team_avatar ?? mvp.roster_meta?.owner_avatar ?? null;
  }
</script>

<style>
  :global(body) { color: #e6eef8; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }

  .container {
    max-width: 1180px;
    margin: 24px auto;
    padding: 20px;
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: 20px;
    align-items: start;
  }
  .header { grid-column: 1 / span 2; display:flex; justify-content:space-between; align-items:center; gap:12px; }
  h1 { font-size: 1.6rem; margin:0; color: #e6eef8; }
  .subtitle { color: rgba(230,238,248,0.6); margin-top:6px; font-size:.95rem; }

  .main, .side {
    background: rgba(6,8,12,0.65);
    border-radius: 12px;
    padding: 16px;
    border: 1px solid rgba(255,255,255,0.04);
    box-shadow: 0 10px 30px rgba(2,6,23,0.6);
    backdrop-filter: blur(6px);
    color: inherit;
  }

  .filters { display:flex; align-items:center; gap:.75rem; }
  .season-label { color: #cbd5e1; font-weight:700; margin-right:.4rem; }
  select.season-select {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    color: #e6eef8;
    padding: 8px 12px;
    border-radius: 10px;
    font-weight: 700;
    min-width:140px;
    box-shadow: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
  }
  .select-wrap { position: relative; display:inline-block; }
  .select-wrap::after {
    content: "▾";
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: #9aa3ad;
    font-size: 0.9rem;
  }
  select.season-select option { background: rgba(6,8,12,0.85); color: #e6eef8; }

  .debug { background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); padding:12px; border-radius:10px; margin-bottom:12px; color:#cbd5e1; max-height:260px; overflow:auto; }
  .debug ul { margin:0; padding-left:18px; }

  .standings-list { list-style:none; margin:0; padding:0; }
  .stand-row { display:flex; align-items:center; gap:14px; padding:12px; border-bottom:1px solid rgba(255,255,255,0.03); }
  .rank { width:56px; font-weight:800; display:flex; align-items:center; gap:8px; color:#e6eef8; justify-content:flex-start; }
  .player { display:flex; align-items:center; gap:12px; min-width:0; }
  .avatar { width:56px; height:56px; border-radius:8px; object-fit:cover; flex-shrink:0; border:1px solid rgba(255,255,255,0.04); }
  .teamName { font-weight:800; color:#e6eef8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:420px; }
  .teamMeta { color: #9aa3ad; font-size:.9rem; margin-top:4px; }
  .seedCol { margin-left:auto; color:#9aa3ad; font-weight:700; min-width:56px; text-align:right; }

  .outcome-row { display:flex; gap:12px; align-items:center; margin-bottom:12px; }
  .outcome-name { font-weight:700; color:#e6eef8; }
  .small { color:#9aa3ad; font-size:.9rem; }

  .no-debug { color:#9aa3ad; }

  @media (max-width: 980px) {
    .container { grid-template-columns: 1fr; padding:12px; }
    .side { order: 2; }
  }
</style>

<div class="container">
  <div class="header">
    <div>
      <h1>Honor Hall</h1>
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

  <div class="main">
    <div class="debug" aria-live="polite">
      <ul>
        {#if messages && messages.length}
          {#each messages as m}
            <li>{@html (String(m).replace(/</g,'&lt;'))}</li>
          {/each}
        {:else if debug && debug.length}
          {#each debug as d}
            <li>{@html (String(d).replace(/</g,'&lt;'))}</li>
          {/each}
        {:else}
          <li>No debug trace available.</li>
        {/if}
      </ul>
    </div>

    <h3 style="margin:0 0 12px 0">Final Standings</h3>
    <ul class="standings-list" role="list" aria-label="Final standings">
      {#if finalStandings && finalStandings.length}
        {#each finalStandings as row (row.rosterId)}
          <li class="stand-row" role="listitem">
            <div class="rank" aria-hidden="true">
              <span>{row.rank}</span>
            </div>

            <div class="player" style="min-width:0;">
              <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt="team avatar">
              <div style="min-width:0;">
                <div class="teamName">{row.team_name}</div>
                <div class="teamMeta">
                  {#if row.owner_name}
                    {row.owner_name}
                  {:else}
                    {`Roster ${row.rosterId}`}
                  {/if}
                </div>
              </div>
            </div>

            <div class="seedCol">Seed #{row.seed ?? '—'}</div>
          </li>
        {/each}
      {:else}
        <li class="no-debug">No final standings available.</li>
      {/if}
    </ul>
  </div>

  <aside class="side" aria-labelledby="outcomes-title">
    <h3 id="outcomes-title" style="margin-top:0">Season outcomes</h3>

    {#if champion}
      <div class="outcome-row">
        <img class="avatar" src={avatarOrPlaceholder(champion.avatar ?? champion.roster_meta?.team_avatar, champion.team_name)} alt="champion avatar" style="width:64px;height:64px">
        <div>
          <div class="outcome-name">Champion <span style="margin-left:6px">🏆</span></div>
          <div class="small">{champion.team_name} • {champion.owner_name ?? `Roster ${champion.rosterId}`} • Seed #{champion.seed}</div>
        </div>
      </div>
    {/if}

    {#if biggestLoser}
      <div style="margin-top:8px" class="outcome-row">
        <img class="avatar" src={avatarOrPlaceholder(biggestLoser.avatar ?? biggestLoser.roster_meta?.team_avatar, biggestLoser.team_name)} alt="biggest loser avatar" style="width:64px;height:64px">
        <div>
          <div class="outcome-name">Last Place <span style="margin-left:6px">😵‍💫</span></div>
          <div class="small">{biggestLoser.team_name} • {biggestLoser.owner_name ?? `Roster ${biggestLoser.rosterId}`} • Rank: {biggestLoser.rank}</div>
        </div>
      </div>
    {/if}

    {#if finalsMvp}
      <div style="margin-top:12px" class="outcome-row">
        <img
          class="avatar"
          src={playerDisplayHeadshot(finalsMvp) || avatarOrPlaceholder(finalsMvp?.roster_meta?.owner_avatar, playerDisplayName(finalsMvp))}
          alt="finals mvp avatar"
          style="width:56px;height:56px"
          on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(finalsMvp?.roster_meta?.owner_avatar, playerDisplayName(finalsMvp)); }}
        />
        <div>
          <div class="outcome-name">Finals MVP</div>
          <div class="small">
            {playerDisplayName(finalsMvp) ?? `Player ${finalsMvp.playerId ?? finalsMvp.player_id}`}
            {#if finalsMvp.points} • {formatPts(finalsMvp.points)} pts{/if}
            {#if finalsMvp.roster_meta}
              • {finalsMvp.roster_meta.owner_name ?? finalsMvp.roster_meta.team_name}
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <div style="margin-top:12px" class="outcome-row">
        <div style="width:56px;height:56px;border-radius:8px;background:rgba(255,255,255,0.02)"></div>
        <div>
          <div class="outcome-name">Finals MVP</div>
          <div class="small">No player-level data found for the championship matchup.</div>
        </div>
      </div>
    {/if}

    {#if overallMvp}
      <div style="margin-top:12px" class="outcome-row">
        <img
          class="avatar"
          src={playerDisplayHeadshot(overallMvp) || avatarOrPlaceholder(overallMvp?.roster_meta?.owner_avatar, playerDisplayName(overallMvp))}
          alt="overall mvp avatar"
          style="width:56px;height:56px"
          on:error={(e) => { e.currentTarget.src = avatarOrPlaceholder(overallMvp?.roster_meta?.owner_avatar, playerDisplayName(overallMvp)); }}
        />
        <div>
          <div class="outcome-name">Overall MVP</div>
          <div class="small">
            {playerDisplayName(overallMvp) ?? `Player ${overallMvp.playerId ?? overallMvp.topPlayerId ?? overallMvp.player_id}`}
            {#if overallMvp.points} • {formatPts(overallMvp.points)} pts{/if}
            {#if overallMvp.topRosterId || overallMvp.roster_meta}
              • {overallMvp.roster_meta?.owner_name ?? overallMvp.roster_meta?.team_name ?? `Roster ${overallMvp.topRosterId ?? overallMvp.rosterId}`}
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <div style="margin-top:12px" class="outcome-row">
        <div style="width:56px;height:56px;border-radius:8px;background:rgba(255,255,255,0.02)"></div>
        <div>
          <div class="outcome-name">Overall MVP</div>
          <div class="small">No player-level data available to compute overall MVP.</div>
        </div>
      </div>
    {/if}

    <div style="margin-top:12px; color:#9aa3ad; font-size:.9rem">
      Final standings are derived from server-scrubbed matchups and bracket simulation logic.
      <div style="margin-top:8px; font-size:.85rem; color:#80909a">
        Playoff weeks processed: {data?.playoffStart} → {data?.playoffEnd} ({matchupsRows.length} matchup rows)
        <div>JSON loaded: {seasonJsonLoaded ? 'yes' : 'no'} {#if seasonJsonPathsTried.length} — tried: {seasonJsonPathsTried.join(', ')}{/if}</div>
        {#if jsonLinks && jsonLinks.length}
          <div style="margin-top:6px;">Loaded JSON files:</div>
          <ul style="margin:6px 0 0 18px; color:#9aa3ad;">
            {#each jsonLinks as jl}
              <li>{@html jl}</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </aside>
</div>
