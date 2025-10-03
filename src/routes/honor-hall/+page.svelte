<!-- src/routes/honor-hall/+page.svelte -->
<script>
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

  function groupByWeek(rows) {
    const map = new Map();
    for (const r of rows) {
      const w = r.week ?? 'unknown';
      if (!map.has(w)) map.set(w, []);
      map.get(w).push(r);
    }
    return map;
  }

  const matchupsByWeek = groupByWeek(matchupsRows);

  function fmtScore(v) {
    if (v == null) return '—';
    const n = Number(v);
    if (Number.isNaN(n)) return '—';
    const s = n.toFixed(2).replace(/\.?0+$/, '');
    return s;
  }

  function avatarOrPlaceholder(url, name, size=48) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?size=${size}&name=${encodeURIComponent(letter)}&background=0D1B2A&color=fff`;
  }

  const roundLabel = (index) => {
    if (index === 0) return 'Quarterfinals';
    if (index === 1) return 'Semifinals';
    return 'Final';
  };
</script>

<style>
  .page { max-width:1100px; margin:0 auto; padding:18px; }
  .heading { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
  .title { font-size:1.8rem; font-weight:800; color:#e6eef8; }
  .subtitle { color:#9ca3af; }

  .notice { background:rgba(255,255,255,0.02); padding:12px; border-radius:8px; color:#cbd5e1; margin-bottom:12px; }

  .bracketContainer { display:flex; gap:18px; flex-direction:column; }
  .block { background:rgba(255,255,255,0.02); padding:12px; border-radius:10px; }

  .roundHeader { color:#9ec6ff; font-weight:700; margin-bottom:8px; }

  .matchRow { display:flex; align-items:center; gap:12px; padding:10px; border-radius:8px; background:linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.02)); margin-bottom:8px; }
  .teamCol { display:flex; align-items:center; gap:10px; min-width:0; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; background:#081018; }
  .teamName { font-weight:700; color:#e6eef8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:260px; }
  .teamMeta { color:#9ca3af; font-size:.85rem;}
  .vs { color:#9ca3af; margin:0 8px; }
  .scoreBox { margin-left:auto; font-weight:800; color:#e6eef8; min-width:90px; text-align:center; }

  .seedBadge { background:#071628; color:#9ec6ff; padding:4px 8px; border-radius:999px; font-weight:800; margin-right:6px; font-size:12px; border:1px solid rgba(255,255,255,0.03); }
</style>

<div class="page">
  <div class="heading">
    <div>
      <div class="title">Honor Hall</div>
      <div class="subtitle">Playoff matchups (showing selected season)</div>
    </div>

    <div>
      <label class="subtitle" for="seasonSelect">Season</label>
      <select id="seasonSelect" on:change={(e) => {
        const s = e.target.value;
        const u = new URL(window.location.href);
        u.searchParams.set('season', s);
        window.location.href = u.toString();
      }}>
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

  <div class="bracketContainer">
    {#each playoffWeeks as week, wIdx}
      <div class="block">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:800; color:#e6eef8;">{selectedSeason} {roundLabel(wIdx)}</div>
            <div style="color:#9ca3af; font-size:.9rem;">Round {wIdx + 1} — Week {week}</div>
          </div>
          <div style="color:#9ca3af; font-weight:700;">Showing playoff matchups</div>
        </div>

        <div style="margin-top:12px;">
          {#if matchupsByWeek.get(week) && matchupsByWeek.get(week).length}
            {#each matchupsByWeek.get(week) as m}
              <div class="matchRow">
                <div class="teamCol">
                  {#if m.teamA?.placement}
                    <div class="seedBadge">#{m.teamA.placement}</div>
                  {/if}
                  <img class="avatar" src={m.teamA?.avatar ?? avatarOrPlaceholder(m.teamA?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{m.teamA?.name ?? (rosterMap[String(m.teamA?.roster_id)]?.display_name ?? 'TBD')}</div>
                    {#if rosterMap[String(m.teamA?.roster_id)]?.display_name}
                      <div class="teamMeta">{rosterMap[String(m.teamA?.roster_id)]?.display_name}</div>
                    {/if}
                  </div>
                </div>

                <div class="vs">vs</div>

                <div class="teamCol" style="margin-left:8px;">
                  <img class="avatar" src={m.teamB?.avatar ?? avatarOrPlaceholder(m.teamB?.name)} alt="">
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
