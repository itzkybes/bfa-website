<!-- src/routes/honor-hall/+page.svelte -->
<script>
  import { onMount } from 'svelte';

  export let data;

  // seasons list and selection (server-provided)
  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  // server-provided payload pieces
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const jsonLinks = Array.isArray(data?.jsonLinks) ? data.jsonLinks : [];

  // finalStandingsBySeason mapping (optional server-provided grouped results)
  const finalStandingsBySeason = data?.finalStandingsBySeason ?? {};
  const finalStandingsFallback = Array.isArray(data?.finalStandings) ? data.finalStandings : [];

  // select the finalStandings for the chosen season (keeps backward compatibility)
  $: selectedSeasonKey = String(selectedSeason);
  $: selectedSeasonResult = finalStandingsBySeason[selectedSeasonKey] ?? { finalStandings: finalStandingsFallback, debug: data?.debug ?? [] };
  $: finalStandings = Array.isArray(selectedSeasonResult.finalStandings) ? selectedSeasonResult.finalStandings : [];
  $: debugLines = Array.isArray(selectedSeasonResult.debug) ? selectedSeasonResult.debug : [];

  // top-level objects (server may provide these directly)
  // fallback to computed values from finalStandings if server didn't attach
  $: champion = data?.champion ?? (finalStandings && finalStandings.length ? finalStandings[0] : null);
  $: lastPlace = data?.lastPlace ?? (finalStandings && finalStandings.length ? finalStandings[finalStandings.length - 1] : null);

  // MVP objects (server may have computed)
  let overallMvp = data?.overallMvp ?? null;
  let finalsMvp = data?.finalsMvp ?? null;

  // playoff info / matchups count helpful footnote
  const playoffStart = data?.playoffStart ?? data?.playoff_week_start ?? null;
  const playoffEnd = data?.playoffEnd ?? data?.playoff_end ?? null;
  const matchupsRows = Array.isArray(data?.matchupsRows) ? data.matchupsRows : [];

  // attempt to resolve playerIds -> names & avatars client-side (Sleeper players endpoint)
  // we'll fetch the /players/nba map and then attach names/avatars to MVP objects when possible.
  let playerMap = {};
  let playerMeta = {};

  onMount(async () => {
    try {
      // gather candidate player IDs from server payloads
      const ids = new Set();
      if (overallMvp) {
        if (overallMvp.playerId) ids.add(String(overallMvp.playerId));
        if (overallMvp.topPlayerId) ids.add(String(overallMvp.topPlayerId));
      }
      if (finalsMvp && finalsMvp.playerId) ids.add(String(finalsMvp.playerId));

      if (ids.size === 0) return;

      // fetch the players map once (may be large but convenient for client-side resolution)
      // If CORS blocks this for your deployment, this step will silently fail and we show fallback UI.
      const res = await fetch('https://api.sleeper.app/v1/players/nba');
      if (!res.ok) return;
      playerMap = await res.json();

      for (const pid of ids) {
        if (playerMap && playerMap[pid]) playerMeta[pid] = playerMap[pid];
      }

      // enrich overallMvp
      if (overallMvp) {
        const pid = overallMvp.playerId ?? overallMvp.topPlayerId ?? null;
        if (pid && playerMeta[pid]) {
          overallMvp.playerName = playerMeta[pid].full_name ?? playerMeta[pid].name ?? overallMvp.playerId;
          overallMvp.avatar = `https://sleepercdn.com/content/nba/players/${pid}.jpg`;
        }
      }
      // enrich finalsMvp
      if (finalsMvp) {
        const pid = finalsMvp.playerId ?? null;
        if (pid && playerMeta[pid]) {
          finalsMvp.playerName = playerMeta[pid].full_name ?? playerMeta[pid].name ?? finalsMvp.playerId;
          finalsMvp.avatar = `https://sleepercdn.com/content/nba/players/${pid}.jpg`;
        }
      }
    } catch (e) {
      // non-fatal: if fetch fails (CORS / network) we keep fallback text
      // console.warn("Could not fetch player map:", e);
    }
  });

  // navigation: change season (reload to let server recompute)
  function changeSeason(ev) {
    const val = ev.target.value;
    const u = new URL(location.href);
    if (!val) u.searchParams.delete('season'); else u.searchParams.set('season', val);
    location.href = u.toString();
  }

  // format helpers
  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const ch = name ? String(name)[0].toUpperCase() : 'T';
    // use ui-avatars-like placeholder (keeps look consistent)
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function formatPts(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return Math.round(n * 10) / 10;
  }

  // Filter debug lines a bit for brevity (keeps traces helpful)
  function filteredDebug(lines=[]) {
    return (lines || []).filter(l => {
      if (!l) return false;
      const s = String(l);
      if (s.startsWith('Assign place')) return false;
      if (s.startsWith('Fallback assign')) return false;
      return true;
    });
  }

  $: visibleDebug = filteredDebug(debugLines);
</script>

<style>
  :global(body) { color-scheme: dark; }
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

  /* season select (consistent with other pages) */
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
    border:1px solid rgba(255,255,255,0.03);
  }

  .team-title { font-weight:800; color:#e6eef8; font-size:1rem; line-height:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:420px; }
  .owner-name { color:#9ca3af; font-size:.95rem; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:420px; }

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
        <div>{i + 1}. {m}</div>
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
                {#if s.season}Season {s.season}{:else}{s.name ?? s.league_id}{/if}
              </option>
            {/each}
          {:else}
            <option value={selectedSeason}>{selectedSeason}</option>
          {/if}
        </select>
      </div>
    </div>

    <div class="hall-grid" role="list" aria-label="Honor hall entries">
      <!-- Champion -->
      <div class="entry" role="listitem" aria-label="Champion">
        <img class="avatar" src={avatarOrPlaceholder(champion?.avatar, champion?.team_name)} alt={champion?.team_name ?? 'Champion'} />
        <div style="min-width:0;">
          <div class="team-title">{champion?.team_name ?? '—'}</div>
          <div class="owner-name">{champion?.owner_name ?? `Roster ${champion?.rosterId ?? '—'}`}</div>
          <div style="margin-top:6px; color:#9ca3af; font-size:.88rem">Seed: {champion?.seed ?? '—'} · Rank: {champion?.rank ?? '—'}</div>
        </div>
      </div>

      <!-- Last Place -->
      <div class="entry" role="listitem" aria-label="Last place">
        <img class="avatar" src={avatarOrPlaceholder(lastPlace?.avatar, lastPlace?.team_name)} alt={lastPlace?.team_name ?? 'Last place'} />
        <div style="min-width:0;">
          <div class="team-title">{lastPlace?.team_name ?? '—'}</div>
          <div class="owner-name">{lastPlace?.owner_name ?? `Roster ${lastPlace?.rosterId ?? '—'}`}</div>
          <div style="margin-top:6px; color:#9ca3af; font-size:.88rem">Rank: {lastPlace?.rank ?? '—'}</div>
        </div>
      </div>

      <!-- Overall MVP -->
      <div class="entry" role="listitem" aria-label="Overall MVP">
        <img class="avatar" src={avatarOrPlaceholder(overallMvp?.avatar, overallMvp?.playerName ?? overallMvp?.playerId)} alt="Overall MVP" />
        <div style="min-width:0;">
          <div class="team-title">Overall MVP</div>
          {#if overallMvp}
            <div class="mvp-meta">{overallMvp.playerName ?? (overallMvp.playerId ? `Player ${overallMvp.playerId}` : '—')} <span style="color:#9ca3af">· {formatPts(overallMvp.points ?? overallMvp.total ?? overallMvp.score ?? 0)} pts</span></div>
            <div class="mvp-sub">Most total points across the season</div>
          {:else}
            <div class="mvp-sub">No player-level data available to compute Overall MVP.</div>
          {/if}
        </div>
      </div>

      <!-- Finals MVP -->
      <div class="entry" role="listitem" aria-label="Finals MVP">
        <img class="avatar" src={avatarOrPlaceholder(finalsMvp?.avatar, finalsMvp?.playerName ?? finalsMvp?.playerId)} alt="Finals MVP" />
        <div style="min-width:0;">
          <div class="team-title">Finals MVP</div>
          {#if finalsMvp}
            <div class="mvp-meta">{finalsMvp.playerName ?? (finalsMvp.playerId ? `Player ${finalsMvp.playerId}` : '—')} <span style="color:#9ca3af">· {formatPts(finalsMvp.points ?? finalsMvp.score ?? finalsMvp.pts ?? 0)} pts</span></div>
            <div class="mvp-sub">Top scorer in the championship matchup</div>
          {:else}
            <div class="mvp-sub">No player-level data found for the championship matchup.</div>
          {/if}
        </div>
      </div>
    </div>

    <div style="margin-top:12px; color:#9ca3af; font-size:.95rem;">
      {#if playoffStart && playoffEnd}
        <div>Playoff weeks processed: {playoffStart} → {playoffEnd} ({matchupsRows.length} matchup rows)</div>
      {:else}
        <div>Playoff weeks processed: {matchupsRows.length ? `${matchupsRows.length} matchup rows` : 'none found'}</div>
      {/if}
    </div>
  </div>

  {#if visibleDebug && visibleDebug.length}
    <div style="margin-top:12px;" class="card">
      <div style="font-weight:700; margin-bottom:8px; color:#9ca3af">Debug trace</div>
      <div style="color:#cbd5e1; max-height:260px; overflow:auto; padding-right:6px;">
        <ul style="margin:0; padding-left:18px;">
          {#each visibleDebug as d}
            <li>{@html d.replace(/</g,'&lt;')}</li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}

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
