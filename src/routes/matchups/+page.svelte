<script>
  export let data;

  // page data
  const seasons = data.seasons || [];
  // keep 'weeks' for backward compat; weekOptions contains grouped lists
  const weeks = data.weeks || [];
  const weekOptions = data.weekOptions || { regular: [], playoffs: [] };
  const playoffWeeks = data.playoffWeeks || [];
  let selectedSeason = data.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);
  let selectedWeek = Number(data.selectedWeek ?? (weeks.length ? weeks[weeks.length-1] : 1));
  const matchupsRows = data.matchupsRows || [];
  const messages = data.messages || [];
  const originalRecords = data.originalRecords || {};

  // helpers
  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://via.placeholder.com/${size}?text=${encodeURIComponent(letter)}`;
  }

  function fmt2(n) { return Number(n ?? 0).toFixed(2); }

  // used by the filter selects to submit the GET form
  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  }
</script>

<style>
  :global(body) {
    /* keep dark page but do not force global background changes here */
  }

  .page { max-width: 1100px; margin: 1.2rem auto; padding: 0 1rem; }
  .card { background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006)); border:1px solid rgba(255,255,255,0.03); padding:14px; border-radius:10px; margin-bottom:1rem; }
  .filters { display:flex; gap:.6rem; align-items:center; margin-bottom: .8rem; }
  /* improved select styling for visibility */
  .select {
    padding:.6rem .8rem;
    border-radius:8px;
    background: #07101a;
    color: #e6eef8;
    border: 1px solid rgba(99,102,241,0.25);
    box-shadow: 0 4px 14px rgba(2,6,23,0.45), inset 0 -1px 0 rgba(255,255,255,0.01);
    min-width: 160px;
    font-weight: 600;
    outline: none;
  }
  .select:focus {
    border-color: rgba(99,102,241,0.6);
    box-shadow: 0 6px 20px rgba(2,6,23,0.6), 0 0 0 4px rgba(99,102,241,0.06);
  }
  table { width:100%; border-collapse:collapse; }
  thead th { text-align:left; padding:8px 10px; font-size:.85rem; color:#9ca3af; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.03); }
  td { padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; color:#e6eef8; }
  .team-cell { display:flex; gap:.6rem; align-items:center; width:100%; min-width:0; }
  .team-meta { display:flex; flex-direction:column; min-width:0; }
  .team-name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 320px; }
  .muted { color: #9ca3af; font-size:.9rem; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; background:#081018; flex-shrink:0; }
  .score { margin-left:auto; font-weight:600; white-space:nowrap; padding:6px 10px; border-radius:10px; display:inline-block; min-width:72px; text-align:center; }
  /* winning score — made more prominent */
  .score.winner {
    background: linear-gradient(180deg, rgba(99,102,241,0.16), rgba(99,102,241,0.22));
    color: #f8fbff;
    font-weight:900;
    font-size:1.05rem;
    box-shadow: 0 6px 18px rgba(99,102,241,0.08), 0 1px 0 rgba(255,255,255,0.02) inset;
    border: 1px solid rgba(99,102,241,0.36);
  }
  /* subtle tie style */
  .score.tie {
    background: rgba(255,255,255,0.02);
    color: #e6eef8;
    font-weight:700;
  }
  @media (max-width:900px) { .avatar { width:44px; height:44px; } .score { padding:5px 8px; } }

  /* multi-matchup inner table */
  .inner-table { width:100%; border-collapse:collapse; margin-top:.6rem; }
  .inner-table th { text-align:left; color:#9ca3af; font-size:.82rem; padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.03); }
  .inner-table td { padding:8px 8px; }

  /* ownership note */
  details.note { padding: 12px; margin-top: 0.6rem; border-radius:8px; background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006)); border:1px solid rgba(255,255,255,0.03); color: #cfe2ff; }
  details.note summary { list-style: none; cursor: pointer; font-weight:700; font-size:1rem; outline: none; display:flex; gap:.6rem; align-items:center; }
  details.note summary::-webkit-details-marker { display: none; }
  details.note summary::before { content: '▸'; color: #9ca3af; width:1rem; display:inline-block; }
  details.note[open] summary::before { content: '▾'; color: #9ca3af; }
  .owner-record { margin-top: .5rem; display:flex; gap: .75rem; align-items:center; }
  .owner-small { color: #dbeafe; font-size:.95rem; }
</style>

<div class="page">
  <div class="muted" style="margin-bottom:.5rem;">
    {#if messages.length}
      <div><strong>Debug</strong></div>
      {#each messages as m, i}
        <div>{i+1}. {m}</div>
      {/each}
    {/if}
  </div>

  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: .6rem;">
      <div>
        <h2 style="margin:0 0 2px 0;">Matchups</h2>
        <div class="muted" style="font-size:.95rem;">Choose a season and week to view matchups</div>
      </div>

      <form id="filters" method="get" style="display:flex; gap:.6rem; align-items:center;">
        <label class="muted" for="season">Season</label>
        <select id="season" name="season" class="select" on:change={submitFilters} aria-label="Select season">
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>{s.season ?? s.name}</option>
          {/each}
        </select>

        <label class="muted" for="week">Week</label>

        {#if (weekOptions && (weekOptions.regular?.length || weekOptions.playoffs?.length))}
          <select id="week" name="week" class="select" on:change={submitFilters} aria-label="Select week">
            {#if weekOptions.regular && weekOptions.regular.length}
              <optgroup label="Regular Season">
                {#each weekOptions.regular as w}
                  <option value={w} selected={w === Number(selectedWeek)}>{w}</option>
                {/each}
              </optgroup>
            {/if}
            {#if weekOptions.playoffs && weekOptions.playoffs.length}
              <optgroup label="Playoffs">
                {#each weekOptions.playoffs as w}
                  <option value={w} selected={w === Number(selectedWeek)}>{w}</option>
                {/each}
              </optgroup>
            {/if}
          </select>
        {:else}
          <!-- fallback to previous simple weeks list -->
          <select id="week" name="week" class="select" on:change={submitFilters} aria-label="Select week">
            {#each weeks as w}
              <option value={w} selected={w === Number(selectedWeek)}>{w}</option>
            {/each}
          </select>
        {/if}

        <noscript>
          <button type="submit" class="select" style="cursor:pointer;">Go</button>
        </noscript>
      </form>
    </div>

    {#if matchupsRows.length}
      <table aria-label="Matchups table">
        <thead>
          <tr>
            <th style="width:50%;">Team A</th>
            <th style="width:50%;">Team B</th>
          </tr>
        </thead>

        <tbody>
          {#each matchupsRows as row}
            {#if row.participantsCount === 2}
              <!-- two-team matchup (unchanged) -->
              <tr>
                <td>
                  <div class="team-cell">
                    <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt={row.teamA.name} on:error={(e)=>e.target.style.visibility='hidden'} />
                    <div class="team-meta" style="min-width:0;">
                      <div class="team-name">{row.teamA.name}</div>
                      {#if row.teamA.ownerName}<div class="muted">{row.teamA.ownerName}</div>{/if}
                    </div>

                    {#if row.teamA.points != null}
                      {#if row.teamA.points > row.teamB.points}
                        <div class="score winner" title="Winning score">{fmt2(row.teamA.points)}</div>
                      {:else if row.teamA.points === row.teamB.points}
                        <div class="score tie" title="Tie">{fmt2(row.teamA.points)}</div>
                      {:else}
                        <div class="score" title="Score">{fmt2(row.teamA.points)}</div>
                      {/if}
                    {/if}
                  </div>
                </td>

                <td>
                  <div class="team-cell">
                    <img class="avatar" src={avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} alt={row.teamB.name} on:error={(e)=>e.target.style.visibility='hidden'} />
                    <div class="team-meta" style="min-width:0;">
                      <div class="team-name">{row.teamB.name}</div>
                      {#if row.teamB.ownerName}<div class="muted">{row.teamB.ownerName}</div>{/if}
                    </div>

                    {#if row.teamB.points != null}
                      {#if row.teamB.points > row.teamA.points}
                        <div class="score winner" title="Winning score">{fmt2(row.teamB.points)}</div>
                      {:else if row.teamB.points === row.teamA.points}
                        <div class="score tie" title="Tie">{fmt2(row.teamB.points)}</div>
                      {:else}
                        <div class="score" title="Score">{fmt2(row.teamB.points)}</div>
                      {/if}
                    {/if}
                  </div>
                </td>
              </tr>

            {:else if row.participantsCount === 1}
              <!-- BYE: single participant -->
              <tr>
                <td>
                  <div class="team-cell">
                    <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt={row.teamA.name} on:error={(e)=>e.target.style.visibility='hidden'} />
                    <div class="team-meta" style="min-width:0;">
                      <div class="team-name">{row.teamA.name}</div>
                      {#if row.teamA.ownerName}<div class="muted">{row.teamA.ownerName}</div>{/if}
                    </div>

                    {#if row.teamA.points != null}
                      <div class="score" title="Score">{fmt2(row.teamA.points)}</div>
                    {/if}
                  </div>
                </td>

                <td>
                  <div class="team-cell">
                    <!-- show a subtle BYE placeholder -->
                    <div class="avatar" style="display:flex; align-items:center; justify-content:center; background:transparent; border:1px dashed rgba(255,255,255,0.03); color:var(--muted); font-weight:700;">
                      BYE
                    </div>
                    <div class="team-meta" style="min-width:0;">
                      <div class="team-name">Bye</div>
                      <div class="muted">Bye week</div>
                    </div>
                  </div>
                </td>
              </tr>

            {:else}
              <!-- multi-team matchup -->
              <tr>
                <td colspan="2">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:700;">Multi-team matchup ({row.participantsCount})</div>
                    <div class="muted">Week {row.week ?? '-'} • Season {row.season ?? '-'}</div>
                  </div>

                  <table class="inner-table" aria-label="Multi-match participants">
                    <thead>
                      <tr><th>Team</th><th style="text-align:right">Points</th></tr>
                    </thead>
                    <tbody>
                      {#each row.combinedParticipants as p}
                        <tr>
                          <td>
                            <div style="display:flex; gap:.6rem; align-items:center;">
                              <img class="avatar" src={avatarOrPlaceholder(p.avatar, p.name)} alt={p.name} style="width:40px;height:40px;border-radius:8px;" on:error={(e)=>e.target.style.visibility='hidden'} />
                              <div style="font-weight:700;">{p.name}</div>
                            </div>
                          </td>
                          <td style="text-align:right;">
                            {#if p.points === row.combinedWinnerPoints}
                              <span class="score winner" style="display:inline-block;">{fmt2(p.points)}</span>
                            {:else}
                              <span class="score" style="display:inline-block;">{fmt2(p.points)}</span>
                            {/if}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="muted">No matchups found for the selected season/week or this week is outside the available window.</div>
    {/if}
  </div>

  <!-- Ownership note -->
  <div class="card" aria-labelledby="ownership-note">
    <div id="ownership-note" style="font-weight:700; font-size:1.05rem; margin-bottom:.3rem;">Ownership note</div>
    <div class="muted" style="margin-bottom:.6rem;">Lineage and preserved records (original owners before merging into canonical owners)</div>

    <details class="note" aria-label="Canonical ownership (click to expand)">
      <summary>Canonical owner mapping & preserved records</summary>

      <div style="margin-top:.6rem; color:#dbeafe;">
        <div>We canonicalize <strong>Bellooshio</strong> &amp; <strong>cholybevv</strong> into <strong>jakepratt</strong> for combined stats shown in the all-time tables.</div>

        {#if Object.keys(originalRecords).length}
          {#each Object.keys(originalRecords) as key}
            <div class="owner-record" style="margin-top:.6rem;">
              <img class="avatar" src={avatarOrPlaceholder(originalRecords[key].avatar, originalRecords[key].team)} alt={originalRecords[key].owner_username || key} on:error={(e)=>e.target.style.visibility='hidden'} />
              <div>
                <div style="font-weight:700">{originalRecords[key].owner_username || key}</div>
                <div class="owner-small">
                  {#if originalRecords[key].team}<div>Team: {originalRecords[key].team}</div>{/if}
                  <div>Regular: <strong>{originalRecords[key].regWins}</strong>-<strong>{originalRecords[key].regLosses}</strong> (PF {fmt2(originalRecords[key].regPF)}, PA {fmt2(originalRecords[key].regPA)})</div>
                  <div>Playoffs: <strong>{originalRecords[key].playoffWins}</strong>-<strong>{originalRecords[key].playoffLosses}</strong> (PF {fmt2(originalRecords[key].playoffPF)}, PA {fmt2(originalRecords[key].playoffPA)})</div>
                  <div>Championships: <strong>{originalRecords[key].championships}</strong></div>
                </div>
              </div>
            </div>
          {/each}
        {:else}
          <div class="muted" style="margin-top:.6rem;">No preserved original-owner records were returned by the server for this league view. If you expect to see preserved-owner stats here, add `originalRecords` to the page.server.js `load` return payload (same shape used by the Records page).</div>
        {/if}
      </div>
    </details>
  </div>
</div>
