<script>
  export let data;

  const seasons = data?.seasons ?? [];
  const weeks = data?.weeks ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);
  let selectedWeek = Number(data?.selectedWeek ?? (weeks.length ? weeks[weeks.length - 1] : 1));
  if (!selectedWeek || isNaN(selectedWeek) || selectedWeek < 1) selectedWeek = 1;

  const matchupsRows = data?.matchupsRows ?? [];
  const messages = data?.messages ?? [];
  const originalRecords = data?.originalRecords ?? {};

  function avatarOrPlaceholder(url, name, size = 64) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0D1B2A&color=fff&size=${size}`;
  }

  function fmt2(n) {
    const x = Number(n);
    if (isNaN(x)) return '0.0';
    return x.toFixed(1);
  }

  // compute playoff week range from matchupsRows (if loader returned playoff matchups)
  let playoffWeeks = { min: null, max: null };
  if (Array.isArray(matchupsRows) && matchupsRows.length) {
    for (const r of matchupsRows) {
      const w = Number(r.week ?? r.w ?? r.week_number ?? NaN);
      if (!isNaN(w)) {
        if (playoffWeeks.min === null || w < playoffWeeks.min) playoffWeeks.min = w;
        if (playoffWeeks.max === null || w > playoffWeeks.max) playoffWeeks.max = w;
      }
    }
  }
  $: playoffRangeLabel = (playoffWeeks.min === null) ? 'Playoff matchups' :
    (playoffWeeks.min === playoffWeeks.max) ? `Playoff matchups — Week ${playoffWeeks.min}` :
    `Playoff matchups — Weeks ${playoffWeeks.min}–${playoffWeeks.max}`;
</script>

<style>
  .page { padding: 1rem; }
  .muted { color: #9ca3af; font-size:.9rem; }
  .team-cell { display:flex; gap:.6rem; align-items:center; width:100%; min-width:0; }
  .team-meta { display:flex; flex-direction:column; min-width:0; }
  .team-name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 320px; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; background:#081018; flex-shrink:0; }
  .score { margin-left:auto; font-weight:600; white-space:nowrap; padding:6px 10px; display:inline-block; min-width:72px; text-align:center; }
  .score.winner { background: linear-gradient(180deg, rgba(99,102,241,0.16), rgba(99,102,241,0.22)); border-radius:8px; color:#eef8ff; }
  .score.tie { background: rgba(255,255,255,0.02); color: #e6eef8; font-weight:700; }
  table { width:100%; border-collapse:collapse; }
  thead th { text-align:left; padding:8px 10px; font-size:.85rem; color:#9ca3af; }
  td { padding:12px 10px; border-bottom:1px solid rgba(255,255,255,0.03); vertical-align:middle; color:#e6eef8; }
  .inner-table { width:100%; border-collapse:collapse; margin-top:.6rem; }
  .inner-table th { text-align:left; color:#9ca3af; font-size:.8rem; padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.03); }
  .inner-table td { padding:8px 8px; }
  .select { padding:6px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.06); background:transparent; color:inherit; }
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

  <div style="display:flex; gap:.8rem; align-items:center; margin-bottom:0.8rem;">
    <div>
      <label class="muted">Season</label><br/>
      <select class="select" bind:value={selectedSeason}>
        {#each seasons as s}
          <option value={s.league_id}>{s.name ?? s.season}</option>
        {/each}
      </select>
    </div>
    <div>
      <label class="muted">Week</label><br/>
      <select class="select" bind:value={selectedWeek}>
        {#each weeks as w}
          <option value={w}>{w}</option>
        {/each}
      </select>
    </div>
  </div>

  <div style="margin:1rem 0;">
    <h2>{playoffRangeLabel}</h2>
  </div>

  {#if matchupsRows && matchupsRows.length}
    <table>
      <thead>
        <tr>
          <th style="width:48%;">Team A</th>
          <th style="width:4%;"></th>
          <th style="width:48%;">Team B</th>
        </tr>
      </thead>
      <tbody>
        {#each matchupsRows as row (row.matchup_id ?? row.key)}
          {#if row.participantsCount === 2}
            <tr>
              <td>
                <div class="team-cell">
                  <img class="avatar" src={row.teamA.avatar ? row.teamA.avatar : avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} on:error={(e)=>e.target.style.visibility='hidden'} />
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

              <td style="text-align:center; vertical-align:middle;">
                <div class="muted">Week {row.week}</div>
              </td>

              <td>
                <div class="team-cell" style="justify-content:flex-end;">
                  {#if row.teamB.points != null}
                    {#if row.teamB.points > row.teamA.points}
                      <div class="score winner" title="Winning score">{fmt2(row.teamB.points)}</div>
                    {:else if row.teamB.points === row.teamA.points}
                      <div class="score tie" title="Tie">{fmt2(row.teamB.points)}</div>
                    {:else}
                      <div class="score" title="Score">{fmt2(row.teamB.points)}</div>
                    {/if}
                  {/if}
                  <div class="team-meta" style="text-align:right; min-width:0;">
                    <div class="team-name">{row.teamB.name}</div>
                    {#if row.teamB.ownerName}<div class="muted">{row.teamB.ownerName}</div>{/if}
                  </div>
                  <img class="avatar" src={row.teamB.avatar ? row.teamB.avatar : avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} on:error={(e)=>e.target.style.visibility='hidden'} />
                </div>
              </td>
            </tr>
          {:else if row.participantsCount === 1}
            <tr>
              <td>
                <div class="team-cell">
                  <img class="avatar" src={row.teamA.avatar ? row.teamA.avatar : avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} on:error={(e)=>e.target.style.visibility='hidden'} />
                  <div class="team-meta" style="min-width:0;">
                    <div class="team-name">{row.teamA.name}</div>
                    {#if row.teamA.ownerName}<div class="muted">{row.teamA.ownerName}</div>{/if}
                  </div>
                  {#if row.teamA.points != null}
                    <div class="score" title="Score">{fmt2(row.teamA.points)}</div>
                  {/if}
                </div>
              </td>
              <td style="text-align:center; vertical-align:middle;">
                <div class="muted">Week {row.week}</div>
              </td>
              <td>
                <div class="team-cell" style="justify-content:flex-end;">
                  <div class="team-meta" style="text-align:right; min-width:0;">
                    <div class="team-name">BYE</div>
                    <div class="muted">No opponent</div>
                  </div>
                </div>
              </td>
              </tr>
          {:else}
            <tr>
              <td colspan="3">
                <div style="font-weight:700; margin-bottom:.4rem;">Multi-Team Matchup — Week {row.week}</div>
                <table class="inner-table">
                  <thead><tr><th>Team</th><th style="text-align:right">Points</th></tr></thead>
                  <tbody>
                    {#each row.combinedParticipants as p}
                      <tr>
                        <td>
                          <div class="team-cell">
                            <img class="avatar" src={p.avatar ? p.avatar : avatarOrPlaceholder(p.avatar, p.name, 40)} alt="">
                            <div class="team-meta">
                              <div class="team-name">{p.name}</div>
                            </div>
                          </div>
                        </td>
                        <td style="text-align:right; font-weight:700;">{fmt2(p.points)}</td>
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
    <div class="muted">No playoff matchups found for the selected season/week. The loader returns the aggregated playoff weeks.</div>
  {/if}

  <details class="note" style="margin-top:1rem;">
    <summary>Ownership / Data notes</summary>
    <div style="padding:0.6rem;">
      {#if originalRecords && Object.keys(originalRecords).length}
        {#each Object.keys(originalRecords) as key}
          <div style="margin-bottom:0.6rem;">
            <div style="font-weight:700;">{key}</div>
            <div class="muted" style="font-size:.9rem;">
              <div>Regular: <strong>{originalRecords[key].regW}</strong> ({fmt2(originalRecords[key].regPF)}, PA {fmt2(originalRecords[key].regPA)})</div>
              <div>Playoffs: <strong>{originalRecords[key].playoffW}</strong> ({fmt2(originalRecords[key].playoffPF)}, PA {fmt2(originalRecords[key].playoffPA)})</div>
              <div>Championships: <strong>{originalRecords[key].championships}</strong></div>
            </div>
          </div>
        {/each}
      {:else}
        <div class="muted" style="margin-top:.6rem;">No preserved records were supplied in the loader payload — the `Records` page uses a different `load` return payload (same shape used by the Records page).</div>
      {/if}
    </div>
  </details>
</div>
