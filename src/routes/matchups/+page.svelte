<script>
  // src/routes/matchups/+page.svelte
  export let data;

  // Page inputs (from server loader)
  const seasons = data.seasons || [];
  const weekOptions = data.weekOptions || { regular: [], playoffs: [] };
  let selectedSeason = data.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);
  let selectedWeek = Number(data.week ?? 1);

  // participants grouped by week (server-provided)
  const weeksParticipants = data.weeksParticipants || {};

  // debug info (server sends debug array)
  const serverDebug = data.debug || [];

  // helper: safely read participants for current week
  $: participantsForWeek = (weeksParticipants && (weeksParticipants[String(selectedWeek)] || weeksParticipants[selectedWeek])) ? (weeksParticipants[String(selectedWeek)] || weeksParticipants[selectedWeek]) : [];

  // Build matchups for rendering:
  // - prefer grouping by matchup_id
  // - if no matchup_id present, fallback to pairing participants two-by-two (deterministic by rosterId)
  function buildMatchups(participants = []) {
    if (!participants || !participants.length) return [];

    // normalize all participants first
    const normalized = participants.map(enrichParticipant).filter(Boolean);

    // check if any participant has a matchup_id
    const hasMatchupId = normalized.some(p => p && p.matchup_id);

    if (hasMatchupId) {
      // group by matchup_id (string)
      const map = new Map();
      for (const p of normalized) {
        const key = (p && p.matchup_id) ? String(p.matchup_id) : `__nomatch__${p.rosterId ?? Math.random()}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(p);
      }
      // return groups (order participants by points desc so winner is first)
      return Array.from(map.entries()).map(([matchup_id, parts]) => ({
        matchup_id,
        participants: parts.sort((a,b) => (b.points || 0) - (a.points || 0))
      }));
    } else {
      // fallback pairing: sort by rosterId then chunk into pairs
      const sorted = normalized.slice().sort((a, b) => {
        const A = String(a.rosterId ?? '');
        const B = String(b.rosterId ?? '');
        return A.localeCompare(B);
      });
      const out = [];
      for (let i = 0; i < sorted.length; i += 2) {
        const a = sorted[i];
        const b = sorted[i + 1] ?? null;
        const id = `pair-${i}-${selectedWeek}`;
        out.push({ matchup_id: id, participants: [a, b].filter(Boolean) });
      }
      return out;
    }
  }

  // Robust enrichment: try many keys found across different server shapes / Sleeper responses.
  function enrichParticipant(p) {
    if (!p) return null;

    // helpers
    const raw = p.raw ?? p;
    // possible team name sources
    const teamName =
      p.team_name ||
      p.teamName ||
      p.team ||
      raw?.team_name ||
      raw?.teamName ||
      raw?.metadata?.team_name ||
      raw?.metadata?.teamName ||
      raw?.name ||
      p.name ||
      p.display_name ||
      p.owner_name ||
      null;

    // possible owner name sources
    const ownerName =
      p.owner_name ||
      p.ownerName ||
      raw?.owner_name ||
      raw?.owner ||
      (raw?.user ? (raw.user.display_name || raw.user.username) : null) ||
      p.owner ||
      null;

    // avatar candidates
    const avatarCandidate =
      p.avatar ||
      p.team_avatar ||
      p.teamAvatar ||
      p.owner_avatar ||
      p.ownerAvatar ||
      raw?.team_avatar ||
      raw?.owner_avatar ||
      raw?.metadata?.team_avatar ||
      raw?.metadata?.owner_avatar ||
      (raw?.user && (raw.user.avatar || raw.user.metadata && raw.user.metadata.avatar)) ||
      null;

    // make valid URL out of short avatar tokens used by sleeper CDN
    let avatar = null;
    if (avatarCandidate) {
      try {
        const s = String(avatarCandidate);
        if (s.startsWith('http')) avatar = s;
        else if (/^[0-9a-fA-F]{8,}$/.test(s) || s.indexOf('/') === -1) {
          // looks like sleeper avatar id -> build CDN url
          avatar = 'https://sleepercdn.com/avatars/' + s;
        } else avatar = s;
      } catch (e) { avatar = null; }
    }

    // Determine points - check many possible keys (points, starters_points, starter_points, startersPoints, etc.)
    // We intentionally coerce to Number and fall back to 0 when missing.
    const pointsCandidates = [
      p.points,
      p.points_for,
      p.pointsFor,
      p.total_points,
      p.totalPoints,
      p.starters_points,
      p.startersPoints,
      p.starter_points,
      p.starterPoints,
      p.starter_points_total,
      p.starters_points_total,
      p.starters?.points,
      p.startersPointsRaw,
      raw?.points,
      raw?.points_for,
      raw?.starters_points,
      raw?.starters?.points
    ];

    let points = null;
    for (const v of pointsCandidates) {
      if (v == null) continue;
      const n = Number(v);
      if (!Number.isNaN(n)) { points = n; break; }
    }
    if (points == null) points = 0;

    // rosterId detection
    const rosterId = (p.rosterId ?? p.roster_id ?? p.owner_id ?? p.ownerId ?? raw?.roster_id ?? raw?.owner_id ?? raw?.id ?? null);

    return {
      raw,
      rosterId: rosterId != null ? String(rosterId) : null,
      matchup_id: p.matchup_id ?? p.matchupId ?? p.matchup ?? null,
      week: p.week ?? p.w ?? raw?.week ?? selectedWeek,
      team_name: teamName,
      owner_name: ownerName,
      avatar,
      points
    };
  }

  $: matchups = buildMatchups(participantsForWeek);

  // format score to two decimals (but show integer if whole)
  function fmtScore(n) {
    if (n == null) return '-';
    const num = Number(n);
    if (Number.isInteger(num)) return String(num);
    return num.toFixed(2);
  }

  // helpers to determine winner/tie (note: matchups participants may be sorted by points already)
  function matchupResult(parts) {
    if (!parts || parts.length < 2) return { winnerIndex: parts && parts.length === 1 ? 0 : -1, tie: false };
    const a = parts[0].points ?? 0;
    const b = parts[1].points ?? 0;
    if (Math.abs(a - b) < 1e-9) return { winnerIndex: -1, tie: true };
    return { winnerIndex: a > b ? 0 : 1, tie: false };
  }

  // used to submit filters (preserve existing GET behavior)
  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  }
</script>

<style>
  :global(body) { font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; color: #e6eef8; }
  .page { max-width: 1100px; margin: 1.2rem auto; padding: 0 1rem; }

  .debug-panel { background: rgba(255,255,255,0.02); padding: .8rem; border-radius: 8px; margin-bottom: 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", monospace; color: #cbd5e1; }
  .card { background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006)); border:1px solid rgba(255,255,255,0.03); padding:14px; border-radius:10px; margin-bottom:1rem; }

  .controls-row { display:flex; justify-content:space-between; align-items:center; gap:.75rem; margin-bottom: .8rem; flex-wrap:wrap; }
  .select { padding:.6rem .8rem; border-radius:8px; background: #07101a; color: #e6eef8; border: 1px solid rgba(99,102,241,0.25); min-width:160px; font-weight:600; }

  /* matchup grid */
  .matchups-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap:1rem; }
  @media (max-width:900px) { .matchups-grid { grid-template-columns: 1fr; } }

  .matchup { border-radius:10px; padding:12px; background: rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.02); display:flex; gap:12px; align-items:stretch; min-height:80px; }
  .team { flex:1; display:flex; gap:10px; align-items:center; min-width:0; }
  .team .meta { display:flex; flex-direction:column; overflow:hidden; }
  .team .team-name { font-weight:700; font-size:1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .team .owner { color:#9ca3af; font-size:.9rem; margin-top:2px; }

  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; }

  .score { display:flex; align-items:center; justify-content:center; min-width:84px; font-weight:800; border-radius:8px; padding:10px; background: rgba(255,255,255,0.02); color:#e6eef8; }
  .score.winner { background: linear-gradient(180deg, rgba(99,102,241,0.16), rgba(99,102,241,0.22)); color: #fff; }
  .score.tie { background: rgba(255,255,255,0.02); color:#e6eef8; font-weight:700; }

  /* mobile: push score to far right */
  @media (max-width:900px) {
    .matchup { align-items:center; }
    .team { min-width:0; }
    .score { margin-left:auto; }
    .team .team-name { max-width: 55%; }
  }

  .empty { color:#9ca3af; padding:.6rem; }
</style>

<div class="page">
  <div class="debug-panel" role="status" aria-live="polite">
    <div style="font-weight:700; margin-bottom:.4rem;">Debug — participants & week</div>
    <div style="font-size:.9rem; color:#94a3b8; margin-bottom:.4rem;">(server-returned <code>data.participants</code> or fallback to <code>data.weeksParticipants</code> and <code>week</code>)</div>
    <pre style="margin:0; white-space:pre-wrap;">{JSON.stringify({ week: selectedWeek, participants: participantsForWeek }, null, 2)}</pre>
  </div>

  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;">
      <div style="min-width:0;">
        <h2 style="margin:0 0 .25rem 0;">Matchups</h2>
        <div style="color:#9ca3af;">Choose a season and week to view matchups</div>
      </div>

      <form id="filters" method="get" style="display:flex; gap:.6rem; align-items:center; flex-wrap:wrap;">
        <label class="small-muted" for="season">Season</label>
        <select id="season" name="season" class="select" bind:value={selectedSeason} on:change={submitFilters} aria-label="Select season">
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>{s.season ?? s.name}</option>
          {/each}
        </select>

        <label class="small-muted" for="week">Week</label>
        {#if weekOptions && (weekOptions.regular?.length || weekOptions.playoffs?.length)}
          <select id="week" name="week" class="select" bind:value={selectedWeek} on:change={submitFilters} aria-label="Select week">
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
          <select id="week" name="week" class="select" bind:value={selectedWeek} on:change={submitFilters} aria-label="Select week">
            {#each Array.from({length:18}, (_,i) => i+1) as w}
              <option value={w} selected={w === Number(selectedWeek)}>{w}</option>
            {/each}
          </select>
        {/if}

        <noscript>
          <button type="submit" class="select" style="cursor:pointer;">Go</button>
        </noscript>
      </form>
    </div>

    {#if matchups && matchups.length}
      <div style="margin-top:1rem;" class="matchups-grid">
        {#each matchups as m}
          <div class="matchup" aria-label={"Matchup " + (m.matchup_id || '')}>
            <!-- participant A -->
            <div class="team" style="padding-left:.25rem;">
              {#if m.participants[0]?.avatar}
                <img class="avatar" src={m.participants[0].avatar} alt={m.participants[0].team_name ?? 'team'} on:error={(e)=>e.target.style.visibility='hidden'} />
              {:else}
                <div class="avatar" style="display:flex; align-items:center; justify-content:center; color:#94a3af; font-weight:700;">T</div>
              {/if}
              <div class="meta">
                <div class="team-name">{m.participants[0]?.team_name ?? `Roster ${m.participants[0]?.rosterId ?? '?'}`}</div>
                {#if m.participants[0]?.owner_name}
                  <div class="owner">{m.participants[0].owner_name}</div>
                {/if}
              </div>
            </div>

            <!-- participant B -->
            <div class="team" style="padding-left:.25rem;">
              {#if m.participants[1]?.avatar}
                <img class="avatar" src={m.participants[1].avatar} alt={m.participants[1].team_name ?? 'team'} on:error={(e)=>e.target.style.visibility='hidden'} />
              {:else}
                <div class="avatar" style="display:flex; align-items:center; justify-content:center; color:#94a3af; font-weight:700;">T</div>
              {/if}
              <div class="meta">
                <div class="team-name">{m.participants[1]?.team_name ?? (m.participants.length === 1 ? 'BYE' : `Roster ${m.participants[1]?.rosterId ?? '?'}`)}</div>
                {#if m.participants[1]?.owner_name}
                  <div class="owner">{m.participants[1].owner_name}</div>
                {/if}
              </div>
            </div>

            <!-- score box(s) -->
            <div style="display:flex; flex-direction:column; gap:.5rem; align-items:flex-end;">
              {#if m.participants && m.participants.length >= 2}
                {#if matchupResult(m.participants).tie}
                  <div class="score tie">{fmtScore(m.participants[0].points)} - {fmtScore(m.participants[1].points)}</div>
                {:else}
                  <!-- show winner's score with winner style -->
                  {#if matchupResult(m.participants).winnerIndex === 0}
                    <div class="score winner">{fmtScore(m.participants[0].points)} - {fmtScore(m.participants[1].points)}</div>
                  {:else}
                    <div class="score winner">{fmtScore(m.participants[1].points)} - {fmtScore(m.participants[0].points)}</div>
                  {/if}
                {/if}
              {:else if m.participants && m.participants.length === 1}
                <div class="score">{fmtScore(m.participants[0].points)}</div>
              {:else}
                <div class="score">-</div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty" style="margin-top:1rem;">No matchups found for the selected season/week.</div>
    {/if}
  </div>

  <!-- server debug messages (minimal) -->
  {#if serverDebug && serverDebug.length}
    <div style="margin-top:1rem; color:#9ca3af;">
      <strong>Server debug</strong>
      <ul>
        {#each serverDebug as d}
          <li style="margin-top:.25rem;">{d}</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
