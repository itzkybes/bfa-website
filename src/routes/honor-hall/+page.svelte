<script>
  // Honor Hall view
  export let data;

  // server-provided
  const seasons = (data && Array.isArray(data.seasons)) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);
  const messages = (data && Array.isArray(data.messages)) ? data.messages : [];
  const jsonLinks = (data && Array.isArray(data.jsonLinks)) ? data.jsonLinks : [];

  const champion = data?.champion ?? null;
  const lastPlace = data?.lastPlace ?? null;
  const overallMvp = data?.overallMvp ?? null;
  const finalsMvp = data?.finalsMvp ?? null;
  const playoffStart = data?.playoffStart ?? null;
  const playoffEnd = data?.playoffEnd ?? null;
  const matchupsRows = (data && Array.isArray(data.matchupsRows)) ? data.matchupsRows : [];
  const regularStandings = (data && Array.isArray(data.regularStandings)) ? data.regularStandings : [];
  const finalStandings = (data && Array.isArray(data.finalStandings)) ? data.finalStandings : [];

  // navigate to other season (preserve other query params if any)
  function changeSeason(ev) {
    const val = ev.target.value;
    const u = new URL(location.href);
    if (val === '' || val === null) {
      u.searchParams.delete('season');
    } else {
      u.searchParams.set('season', val);
    }
    // reload page for server to compute chosen season
    location.href = u.toString();
  }

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const ch = name ? String(name)[0].toUpperCase() : 'T';
    // small placeholder
    return `https://via.placeholder.com/${size}?text=${encodeURIComponent(ch)}`;
  }
</script>

<style>
  :global(body) {
    color-scheme: dark;
  }
  .page {
    max-width: 1100px;
    margin: 1.5rem auto;
    padding: 0 1rem;
  }
  h1 { margin: 0 0 .6rem 0; font-size: 1.6rem; }
  .debug { color: #9ca3af; font-size: .95rem; margin-bottom: .8rem; }
  .card {
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
    overflow: hidden;
  }
  .card-header {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:1rem;
    margin-bottom: .6rem;
  }
  .section-title { font-size:1.05rem; font-weight:700; margin:0; }
  .section-sub { color: #9ca3af; font-size:.9rem; margin-top: .15rem; }

  .select-wrap { display:flex; align-items:center; gap:.75rem; }
  select.season-select {
    background: rgba(255,255,255,0.02);
    color: #e6eef8;
    border: 1px solid rgba(255,255,255,0.04);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: .95rem;
  }

  .hall-grid {
    display:grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
    margin-top: .5rem;
  }

  .entry {
    display:flex;
    gap: 12px;
    align-items:center;
    padding: 10px;
    border-radius: 8px;
    background: linear-gradient(180deg, rgba(255,255,255,0.006), rgba(255,255,255,0.002));
  }

  .entry .avatar {
    width:72px;
    height:72px;
    border-radius:10px;
    object-fit:cover;
    flex-shrink:0;
    background:#111;
  }

  .entry .meta { min-width:0; }
  .entry .title { font-weight:700; font-size:1rem; margin-bottom:3px; }
  .entry .sub { color:#9ca3af; font-size:.92rem; line-height:1.05rem; }

  .mvp-meta { font-size:.96rem; color:#e6eef8; }
  .mvp-sub { color:#9ca3af; font-size:.9rem; margin-top:3px; }

  .json-links { margin-top: 14px; color: #9ca3af; font-size:.92rem; }
  .json-links a { display:block; color:#9ca3af; text-decoration: underline; word-break:break-all; margin-top:6px; }

  @media (max-width: 820px) {
    .hall-grid { grid-template-columns: 1fr; }
    .entry .avatar { width:56px; height:56px; }
  }
</style>

<div class="page">
  <h1>Honor Hall</h1>

  {#if messages && messages.length}
    <div class="debug" aria-live="polite">
      {#each messages as m, i}
        <div>{i+1}. {m}</div>
      {/each}
    </div>
  {/if}

  <div class="card" role="region" aria-labelledby="season-title">
    <div class="card-header">
      <div>
        <div id="season-title" class="section-title">Season</div>
        <div class="section-sub">Choose a season to view honors</div>
      </div>

      <div class="select-wrap" aria-hidden={seasons.length === 0 ? "true" : "false"}>
        <label for="seasonSelect" class="small-muted" style="color:#9ca3af">Season</label>
        <select id="seasonSelect" class="season-select" on:change={changeSeason} aria-label="Select season">
          {#if seasons && seasons.length}
            {#each seasons as s}
              <option value={s.season ?? s.league_id} selected={(String(s.season ?? s.league_id) === String(selectedSeason))}>
                {#if s.season}{`Season ${s.season}`}{:else}{s.name ?? s.league_id}{/if}
              </option>
            {/each}
          {:else}
            <option value="">Season {selectedSeason ?? '—'}</option>
          {/if}
        </select>
      </div>
    </div>

    <div class="hall-grid" role="list" aria-label="Honor hall entries">
      <!-- Champion -->
      <div class="entry" role="listitem" aria-label="Champion">
        <img class="avatar" src={avatarOrPlaceholder(champion?.avatar, champion?.team_name)} alt={champion?.team_name ?? 'Champion'} />
        <div class="meta">
          <div class="title">Champion</div>
          {#if champion}
            <div class="sub">{champion.team_name} — {champion.owner_name}</div>
            <div class="sub" style="margin-top:6px; color:#9ca3af">Seed: {champion.seed ?? '—'} · Rank: {champion.rank ?? '—'}</div>
          {:else}
            <div class="sub">No champion computed for this season.</div>
          {/if}
        </div>
      </div>

      <!-- Last place -->
      <div class="entry" role="listitem" aria-label="Last place">
        <img class="avatar" src={avatarOrPlaceholder(lastPlace?.avatar, lastPlace?.team_name)} alt={lastPlace?.team_name ?? 'Last place'} />
        <div class="meta">
          <div class="title">Last Place</div>
          {#if lastPlace}
            <div class="sub">{lastPlace.team_name} — {lastPlace.owner_name}</div>
            <div class="sub" style="margin-top:6px; color:#9ca3af">Rank: {lastPlace.rank ?? '—'}</div>
          {:else}
            <div class="sub">No last-place determined for this season.</div>
          {/if}
        </div>
      </div>

      <!-- Overall MVP -->
      <div class="entry" role="listitem" aria-label="Overall MVP">
        <img class="avatar" src={avatarOrPlaceholder(overallMvp?.avatar, overallMvp?.playerId ?? 'MVP', 72)} alt="Overall MVP" />
        <div class="meta">
          <div class="title">Overall MVP</div>
          {#if overallMvp}
            <div class="mvp-meta">{overallMvp.playerId} <span style="color:#9ca3af">· {overallMvp.points ?? 0} pts</span></div>
            <div class="mvp-sub">Most total points across the season (regular + playoffs)</div>
          {:else}
            <div class="mvp-sub">No player-level data available to compute overall MVP.</div>
          {/if}
        </div>
      </div>

      <!-- Finals MVP -->
      <div class="entry" role="listitem" aria-label="Finals MVP">
        <img class="avatar" src={avatarOrPlaceholder(finalsMvp?.avatar, finalsMvp?.playerId ?? 'FMVP', 72)} alt="Finals MVP" />
        <div class="meta">
          <div class="title">Finals MVP</div>
          {#if finalsMvp}
            <div class="mvp-meta">{finalsMvp.playerId} <span style="color:#9ca3af">· {finalsMvp.points ?? 0} pts</span></div>
            <div class="mvp-sub">Top scorer in the championship matchup</div>
          {:else}
            <div class="mvp-sub">No player-level data found for the championship matchup.</div>
          {/if}
        </div>
      </div>
    </div>

    <!-- optional note: other honor entries from JSON could be shown here -->
    <div style="margin-top:12px; color:#9ca3af; font-size:.95rem;">
      {#if matchupsRows && matchupsRows.length}
        <div>Playoff weeks processed: {playoffStart} → {playoffEnd} ({matchupsRows.length} matchup rows)</div>
      {:else}
        <div>No playoff matchup rows found in JSON/API for this season.</div>
      {/if}
    </div>
  </div>

  <!-- JSON Links -->
  {#if jsonLinks && jsonLinks.length}
    <div class="card" style="margin-top:14px;">
      <div style="font-weight:700; margin-bottom:8px; color:#9ca3af">Loaded JSON files</div>
      <div class="json-links" aria-live="polite">
        {#each jsonLinks as jl}
          <a href={jl} target="_blank" rel="noopener noreferrer">{jl}</a>
        {/each}
      </div>
    </div>
  {/if}
</div>
