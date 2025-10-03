<!-- src/routes/honor-hall/+page.svelte -->
<script>
  // Expecting server-provided shape:
  // { seasons, selectedSeason, playoffWeeks, matchupsRows, rosterMap, league, errors }
  export let data;

  const {
    seasons = [],
    selectedSeason,
    playoffWeeks = [],
    matchupsRows = [],
    rosterMap = {},
    league = null,
    errors = []
  } = data ?? {};

  // group matchups by week for display
  function groupByWeek(rows) {
    const m = new Map();
    for (const r of rows) {
      const w = r.week ?? 'unknown';
      if (!m.has(w)) m.set(w, []);
      m.get(w).push(r);
    }
    return m;
  }

  const matchupsByWeek = groupByWeek(matchupsRows);

  function fmtScore(v) {
    if (v == null) return '—';
    const n = Number(v);
    if (Number.isNaN(n)) return '—';
    // Trim trailing zeros
    return n.toFixed(2).replace(/\.?0+$/, '');
  }

  function avatarOrPlaceholder(url, name, size = 48) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    // lightweight avatar fallback
    return `https://ui-avatars.com/api/?size=${size}&name=${encodeURIComponent(letter)}&background=0D1B2A&color=fff`;
  }

  const roundLabel = (index) => {
    if (index === 0) return 'Quarterfinals';
    if (index === 1) return 'Semifinals';
    return 'Final';
  };

  function onSeasonChange(e) {
    const s = e.target.value;
    const u = new URL(window.location.href);
    u.searchParams.set('season', s);
    window.location.href = u.toString();
  }
</script>

<style>
  .page { max-width:1100px; margin:0 auto; padding:20px; box-sizing:border-box; }
  .heading { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; gap:12px; }
  .title { font-size:1.8rem; font-weight:800; color:#e6eef8; }
  .subtitle { color:#9ca3af; font-size:.95rem; }

  .topControls { display:flex; gap:12px; align-items:center; }

  .notice { background:rgba(255,255,255,0.02); padding:12px; border-radius:8px; color:#cbd5e1; margin-bottom:12px; white-space:pre-wrap; }

  .blocks { display:flex; flex-direction:column; gap:18px; }
  .block { background:rgba(255,255,255,0.02); padding:12px; border-radius:10px; }

  .blockHeader { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
  .blockTitle { font-weight:800; color:#e6eef8; }
  .blockMeta { color:#9ca3af; font-size:.9rem; }

  .roundHeader { color:#9ec6ff; font-weight:700; margin-bottom:8px; }

  .matches { display:flex; flex-direction:column; gap:8px; }

  .matchRow { display:flex; align-items:center; gap:12px; padding:10px; border-radius:8px; background:linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.02)); }
  .teamCol { display:flex; align-items:center; gap:10px; min-width:0; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; }
  .teamName { font-weight:700; color:#e6eef8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:320px; }
  .teamMeta { color:#9ca3af; font-size:.85rem; }
  .vs { color:#9ca3af; font-weight:700; margin:0 8px; }
  .scoreBox { margin-left:auto; text-align:center; font-weight:800; color:#e6eef8; min-width:90px; }

  .seedBadge { background:#071628; color:#9ec6ff; border-radius:999px; padding:4px 8px; font-weight:800; margin-right:8px; font-size:12px; border:1px solid rgba(255,255,255,0.03); }

  @media (max-width:900px) {
    .teamName { max-width:180px; }
    .avatar { width:40px; height:40px; }
    .scoreBox { min-width:72px; font-size:.95rem; }
  }
</style>

<div class="page">
  <div class="heading">
    <div>
      <div class="title">Honor Hall</div>
      <div class="subtitle">Playoff matchups (showing selected season)</div>
    </div>

    <div class="topControls">
      <label class="subtitle" for="seasonSelect">Season</label>
      <select id="seasonSelect" on:change={onSeasonChange}>
        {#each seasons as s}
          <option value={s} selected={String(s) === String(selectedSeason)}>{s}</option>
        {/each}
      </select>
    </div>
  </div>

  {#if errors && errors.length}
    <div class="notice">
      {#each errors as err}
        <div>{err}</div>
      {/each}
    </div>
  {/if}

  {#if !playoffWeeks || playoffWeeks.length === 0}
    <div class="notice">No playoff weeks discovered for this league/season.</div>
  {/if}

  <div class="blocks">
    {#each playoffWeeks as week, wIdx}
      <div class="block">
        <div class="blockHeader">
          <div>
            <div class="blockTitle">{selectedSeason} {roundLabel(wIdx)}</div>
            <div class="blockMeta">Round {wIdx + 1} — Week {week}</div>
          </div>
          <div class="blockMeta">Showing playoff matchups</div>
        </div>

        <div class="roundHeader">{roundLabel(wIdx)} — Round {wIdx + 1}</div>

        <div class="matches">
          {#if (matchupsByWeek.get(week) ?? []).length}
            {#each (matchupsByWeek.get(week) ?? []) as m}
              <div class="matchRow">
                <div class="teamCol">
                  {#if m.teamA?.placement}
                    <div class="seedBadge">#{m.teamA.placement}</div>
                  {/if}
                  <img class="avatar" src={m.teamA?.avatar ?? avatarOrPlaceholder(m.teamA?.name)} alt="avatar">
                  <div style="min-width:0;">
                    <div class="teamName">{m.teamA?.name ?? (rosterMap[String(m.teamA?.roster_id)]?.display_name ?? 'TBD')}</div>
                    {#if rosterMap[String(m.teamA?.roster_id)]?.display_name}
                      <div class="teamMeta">{rosterMap[String(m.teamA?.roster_id)]?.display_name}</div>
                    {/if}
                  </div>
                </div>

                <div class="vs">vs</div>

                <div class="teamCol" style="margin-left:8px;">
                  <img class="avatar" src={m.teamB?.avatar ?? avatarOrPlaceholder(m.teamB?.name)} alt="avatar">
                  <div style="min-width:0;">
                    <div class="teamName">{m.teamB?.name ?? (rosterMap[String(m.teamB?.roster_id)]?.display_name ?? 'TBD')}</div>
                    {#if rosterMap[String(m.teamB?.roster_id)]?.display_name}
                      <div class="teamMeta">{rosterMap[String(m.teamB?.roster_id)]?.display_name}</div>
                    {/if}
                  </div>
                </div>

                <div class="scoreBox">{fmtScore(m.teamA?.points)} — {fmtScore(m.teamB?.points)}</div>
              </div>
            {/each}
          {:else}
            <div class="notice">No playoff matchups found for week {week}.</div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
