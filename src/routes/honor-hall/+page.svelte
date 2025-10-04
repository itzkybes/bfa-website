<!-- src/routes/honor-hall/+page.svelte -->
<script>
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  // finalStandings expected shape:
  // [{ rank: 1, rosterId, team_name, owner_name, avatar, seed, pf }, ...]
  const finalStandings = Array.isArray(data?.finalStandings) ? data.finalStandings : [];
  const debugLog = Array.isArray(data?.debugLog) ? data.debugLog : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  /* helpers */
  function avatarOrPlaceholder(url, name, size = 56) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function fmtSeed(s) {
    if (s === null || s === undefined) return '—';
    return `#${s}`;
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }

  function placeEmoji(rank) {
    if (rank === 1) return '🏆';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  }

  // champion & biggest loser (derived from finalStandings)
  $: champion = finalStandings && finalStandings.length ? finalStandings[0] : null;
  $: biggestLoser = finalStandings && finalStandings.length ? finalStandings[finalStandings.length - 1] : null;

  // friendly display name: owner_name -> team_name fallback
  function displayOwnerName(entry) {
    if (!entry) return '';
    if (entry.owner_name) return entry.owner_name;
    if (entry.team_name) return entry.team_name;
    return `Roster ${entry.rosterId ?? '—'}`;
  }
</script>

<style>
  :global(body) { background: var(--bg, #0b0c0f); color: #e6eef8; }
  .page { max-width: 1100px; margin: 0 auto; padding: 1.5rem; display:grid; grid-template-columns: 1fr 320px; gap: 24px; }

  header { grid-column: 1 / -1; display:flex; justify-content:space-between; align-items:start; gap:1rem; margin-bottom: .6rem; }
  h1 { font-size: 1.9rem; margin:0; }
  .subtitle { color:#9aa3ad; margin-top:.35rem; }

  /* dropdown */
  .filters { display:flex; align-items:center; gap:.75rem; }
  .season-label { color:#9aa3ad; margin-right:.5rem; font-weight:600; }
  .season-select {
    background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
    border: 1px solid rgba(99,102,241,0.14);
    padding: 10px 12px;
    border-radius: 12px;
    color:#e6eef8;
    font-weight:700;
    min-width:120px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
  }

  /* left content box */
  .card {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.03);
    padding: 18px;
    border-radius: 10px;
  }

  .debugList { color:#cbd5e1; margin:0; padding-left:1.2rem; max-height:320px; overflow:auto; }
  .debugList li { margin-bottom:.35rem; }

  .finalTitle { font-weight:700; margin-bottom:12px; }
  .standingsList { margin:0; padding:0; list-style:none; }
  .standingRow {
    display:flex; align-items:center; gap:12px; padding:14px; border-radius:8px;
    border: 1px solid rgba(255,255,255,0.02); margin-bottom:10px; background: rgba(255,255,255,0.01);
  }

  .rankCol { width:46px; text-align:center; font-weight:800; color:#e6eef8; font-size:1.05rem; }
  .teamCol { display:flex; align-items:center; gap:12px; min-width:0; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; flex-shrink:0; }
  .teamInfo { display:flex; flex-direction:column; min-width:0; }
  .teamName { font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:420px; }
  .teamMeta { color:#9aa3ad; font-size:.88rem; margin-top:4px; display:flex; gap:8px; align-items:center; }

  .seedCol { margin-left:auto; color:#9aa3ad; font-weight:700; }

  /* right column (season outcomes) */
  .sideBox { display:flex; flex-direction:column; gap:14px; }
  .outcomeCard { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.03); padding:12px; border-radius:10px; }
  .outcomeHeader { color:#9aa3ad; font-weight:700; margin-bottom:8px; }
  .outcomeRow { display:flex; gap:10px; align-items:center; }
  .outcomeMeta { color:#9aa3ad; font-size:.9rem; margin-top:3px; }

  @media (max-width: 980px) {
    .page { grid-template-columns: 1fr; }
    header { flex-direction:column; align-items:flex-start; gap:8px; }
    .season-select { min-width: 160px; }
  }
</style>

<div class="page">
  <header>
    <div>
      <h1>Honor Hall — Final Standings</h1>
      <div class="subtitle">Final placements computed from playoff results (server-scrubbed matchups)</div>
    </div>

    <form id="filters" method="get" class="filters" aria-hidden="false">
      <label for="season" class="season-label">Season</label>
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
    </form>
  </header>

  <!-- left: debug + final standings -->
  <div>
    <div class="card" aria-live="polite">
      <ul class="debugList">
        {#if messages && messages.length}
          {#each messages as m}
            <li>• {m}</li>
          {/each}
        {/if}

        {#if debugLog && debugLog.length}
          <li style="margin-top:.6rem; font-weight:700; color:#e6eef8;">Debug trace</li>
          {#each debugLog as d}
            <li>• {d}</li>
          {/each}
        {:else}
          <li style="margin-top:.6rem; font-weight:700; color:#e6eef8;">Debug trace</li>
          <li style="color:#9aa3ad;">• No debug trace available.</li>
        {/if}
      </ul>
    </div>

    <div style="height:18px;"></div>

    <div class="card">
      <div class="finalTitle">Final Standings</div>

      {#if finalStandings && finalStandings.length}
        <ol class="standingsList" start="1">
          {#each finalStandings as entry (entry.rosterId)}
            <li class="standingRow" role="listitem">
              <div class="rankCol">
                <div>{entry.rank}</div>
                <div style="font-size:.9rem; margin-top:6px;">{placeEmoji(entry.rank)}</div>
              </div>

              <div class="teamCol" style="min-width:0;">
                <img class="avatar" src={avatarOrPlaceholder(entry.avatar, entry.team_name)} alt="team avatar">
                <div class="teamInfo">
                  <div class="teamName">{entry.team_name}</div>
                  <div class="teamMeta">
                    <div>{displayOwnerName(entry)}</div>
                    {#if entry.pf != null}
                      <div>• {Math.round(entry.pf * 100) / 100} PF</div>
                    {/if}
                  </div>
                </div>
              </div>

              <div class="seedCol" title="Regular-season seed">
                {fmtSeed(entry.seed)}
              </div>
            </li>
          {/each}
        </ol>
      {:else}
        <div class="empty" style="color:#9aa3ad;">No final standings computed for the selected season.</div>
      {/if}
    </div>
  </div>

  <!-- right: season outcomes -->
  <aside class="sideBox">
    <div class="outcomeCard">
      <div class="outcomeHeader">Season outcomes</div>

      <div>
        <div style="font-weight:700; color:#9aa3ad; margin-bottom:8px;">Champion</div>
        {#if champion}
          <div class="outcomeRow">
            <img class="avatar" src={avatarOrPlaceholder(champion.avatar, champion.team_name, 48)} alt="champion avatar" style="width:48px;height:48px;border-radius:8px;">
            <div>
              <div style="font-weight:800;">{champion.team_name} <span style="margin-left:6px;">🏆</span></div>
              <div class="outcomeMeta">{displayOwnerName(champion)} • Seed {champion.seed ? `#${champion.seed}` : '—'} • Rank {champion.rank}</div>
            </div>
          </div>
        {:else}
          <div style="color:#9aa3ad;">No champion available</div>
        {/if}
      </div>

      <div style="height:12px;"></div>

      <div>
        <div style="font-weight:700; color:#9aa3ad; margin-bottom:8px;">Biggest loser</div>
        {#if biggestLoser}
          <div class="outcomeRow">
            <img class="avatar" src={avatarOrPlaceholder(biggestLoser.avatar, biggestLoser.team_name, 48)} alt="biggest loser avatar" style="width:48px;height:48px;border-radius:8px;">
            <div>
              <div style="font-weight:800;">{biggestLoser.team_name} <span style="margin-left:6px;">😵‍💫</span></div>
              <div class="outcomeMeta">{displayOwnerName(biggestLoser)} • Seed {biggestLoser.seed ? `#${biggestLoser.seed}` : '—'} • Rank {biggestLoser.rank}</div>
            </div>
          </div>
        {:else}
          <div style="color:#9aa3ad;">No biggest loser available</div>
        {/if}
      </div>

      <div style="margin-top:10px; color:#9aa3ad; font-size:.9rem;">
        Final standings are derived from server-scrubbed matchups and the bracket simulation logic (uses real matchup scores where present; falls back to regular-season PF then seed when needed).
      </div>
    </div>
  </aside>
</div>
