<!-- src/routes/matchups/+page.svelte -->
<script>
  import { goto } from '$app/navigation';
  export let data;

  const matchupPairs = data.matchupPairs || [];
  const rosters = data.rosters || [];
  const users = data.users || [];
  const weekRanges = data.weekRanges || [];
  let selectedWeek = data.selectedWeek || null;
  const weekOptions = data.weekOptions || { regular: [], playoffs: [] };
  const weekLabel = data.weekLabel || null;

  function findRoster(id) {
    if (!rosters) return null;
    for (let i = 0; i < rosters.length; i++) {
      const r = rosters[i];
      if (String(r.roster_id) === String(id) || r.roster_id === id) return r;
    }
    return null;
  }

  function findUserByOwner(ownerId) {
    if (!users) return null;
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      if (String(u.user_id) === String(ownerId) || u.user_id === ownerId) return u;
    }
    return null;
  }

  function avatarForRoster(rosterOrId) {
    const roster = rosterOrId && typeof rosterOrId === 'object' ? rosterOrId : findRoster(rosterOrId);
    if (!roster) return null;
    const md = roster.metadata || {};
    const settings = roster.settings || {};
    let candidate = null;
    if (md && md.team_avatar) candidate = md.team_avatar;
    if (!candidate && md && md.avatar) candidate = md.avatar;
    if (!candidate && settings && settings.team_avatar) candidate = settings.team_avatar;
    if (!candidate && settings && settings.avatar) candidate = settings.avatar;
    if (!candidate) {
      const u = findUserByOwner(roster.owner_id);
      if (u) {
        if (u.metadata && u.metadata.avatar) candidate = u.metadata.avatar;
        else if (u.avatar) candidate = u.avatar;
      }
    }
    if (!candidate) return null;
    if (typeof candidate === 'string' && (candidate.indexOf('http://') === 0 || candidate.indexOf('https://') === 0)) {
      return candidate;
    }
    return 'https://sleepercdn.com/avatars/' + encodeURIComponent(String(candidate));
  }

  function displayNameForRoster(rosterOrId) {
    const roster = rosterOrId && typeof rosterOrId === 'object' ? rosterOrId : findRoster(rosterOrId);
    if (roster) {
      const md = roster.metadata || {};
      const settings = roster.settings || {};
      const nameCandidates = [
        md.team_name, md.teamName, md.team, md.name,
        settings.team_name, settings.teamName, settings.team, settings.name
      ];
      for (let i = 0; i < nameCandidates.length; i++) {
        const cand = nameCandidates[i];
        if (cand && typeof cand === 'string' && cand.trim() !== '') {
          return cand.trim();
        }
      }
      if (roster.name && typeof roster.name === 'string' && roster.name.trim() !== '') {
        return roster.name.trim();
      }
    }

    let ownerId = null;
    if (roster && roster.owner_id) ownerId = roster.owner_id;
    if (!ownerId && roster) ownerId = roster.user_id || roster.owner || roster.user;

    if (!ownerId && typeof rosterOrId !== 'object') ownerId = rosterOrId;

    if (ownerId) {
      const u = findUserByOwner(ownerId);
      if (u) {
        if (u.metadata && u.metadata.team_name && u.metadata.team_name.trim() !== '') return u.metadata.team_name.trim();
        if (u.display_name && u.display_name.trim() !== '') return u.display_name.trim();
        if (u.username && u.username.trim() !== '') return u.username.trim();
      }
    }

    if (roster && roster.roster_id != null) return 'Roster ' + roster.roster_id;
    if (typeof rosterOrId === 'string' || typeof rosterOrId === 'number') return 'Roster ' + rosterOrId;
    return 'Roster';
  }

  function ownerNameForRoster(rosterOrId) {
    const roster = rosterOrId && typeof rosterOrId === 'object' ? rosterOrId : findRoster(rosterOrId);
    let ownerId = roster && (roster.owner_id || roster.user_id || roster.owner || roster.user);
    if (!ownerId && typeof rosterOrId !== 'object') ownerId = rosterOrId;
    if (!ownerId) return null;
    const u = findUserByOwner(ownerId);
    if (!u) return null;
    return u.display_name || u.username || (u.metadata && u.metadata.team_name) || null;
  }

  function fmt(n) {
    if (n == null) return '-';
    if (typeof n === 'number') return (Math.round(n * 10) / 10).toFixed(1);
    return String(n);
  }

  // when user changes week, navigate with query param so +page.js load runs again
  function onWeekChange(e) {
    const wk = e.target.value;
    if (!wk) return;
    const url = new URL(window.location.href);
    url.searchParams.set('week', wk);
    // preserve league param if present (already included)
    goto(url.pathname + url.search, { replaceState: false });
  }
</script>

<main class="wrap matchups-page">
  <header class="matchups-header">
    <div>
      <h1>This week's matchups</h1>
      <div class="muted">Showing matchups for week <strong>{selectedWeek}</strong>{#if weekLabel}<span class="week-range"> — {weekLabel}</span>{/if}</div>
    </div>

    <div class="week-selector">
      {#if (weekOptions && (weekOptions.regular?.length || weekOptions.playoffs?.length))}
        <select aria-label="Select week" on:change={onWeekChange} bind:value={selectedWeek}>
          {#if weekOptions.regular && weekOptions.regular.length}
            <optgroup label="Regular Season">
              {#each weekOptions.regular as w}
                <option value={w.week}>{w.label}</option>
              {/each}
            </optgroup>
          {/if}
          {#if weekOptions.playoffs && weekOptions.playoffs.length}
            <optgroup label="Playoffs">
              {#each weekOptions.playoffs as w}
                <option value={w.week}>{w.label}</option>
              {/each}
            </optgroup>
          {/if}
        </select>
      {:else}
        <!-- fallback -->
        <input type="number" min="1" bind:value={selectedWeek} on:change={onWeekChange} />
      {/if}
    </div>
  </header>

  {#if !matchupPairs || matchupPairs.length === 0}
    <div class="notice">No matchups found for week {selectedWeek}. Try a different week via the selector.</div>
  {:else}
    <div class="matchups">
      {#each matchupPairs as p}
        <a class="matchup-card" href={'/rosters?owner=' + (p.home && p.home.roster_id ? p.home.roster_id : '')}>
          <!-- LEFT TEAM -->
          <div class="side team-left">
            {#if p.home}
              {#if findRoster(p.home.roster_id)}
                {#if avatarForRoster(findRoster(p.home.roster_id))}
                  <img class="team-avatar" src={avatarForRoster(findRoster(p.home.roster_id))} alt={"Avatar for " + displayNameForRoster(findRoster(p.home.roster_id))} loading="lazy" />
                {:else}
                  <div class="team-avatar placeholder" aria-hidden="true"></div>
                {/if}
                <div class="team-meta">
                  <div class="team-name" title={displayNameForRoster(findRoster(p.home.roster_id))}>{displayNameForRoster(findRoster(p.home.roster_id))}</div>
                  <div class="team-sub">{ownerNameForRoster(findRoster(p.home.roster_id)) || ('Roster ' + p.home.roster_id)}</div>
                </div>
              {:else}
                <div class="team-avatar placeholder" aria-hidden="true"></div>
                <div class="team-meta">
                  <div class="team-name">Roster {p.home.roster_id}</div>
                  <div class="team-sub"></div>
                </div>
              {/if}
            {:else}
              <div class="team-avatar placeholder" aria-hidden="true"></div>
              <div class="team-meta"><div class="team-name">TBD</div><div class="team-sub"></div></div>
            {/if}
          </div>

          <!-- SCORES -->
          <div class="score-pair" aria-hidden="true">
            <div class="score-left">
              <div class="score-number">{fmt(p.home && p.home.points)}</div>
              <div class="score-label">PTS</div>
            </div>
            <div class="score-divider">—</div>
            <div class="score-right">
              <div class="score-number">{fmt(p.away && p.away.points)}</div>
              <div class="score-label">PTS</div>
            </div>
          </div>

          <!-- RIGHT TEAM -->
          <div class="side team-right">
            {#if p.away}
              {#if findRoster(p.away.roster_id)}
                {#if avatarForRoster(findRoster(p.away.roster_id))}
                  <img class="team-avatar" src={avatarForRoster(findRoster(p.away.roster_id))} alt={"Avatar for " + displayNameForRoster(findRoster(p.away.roster_id))} loading="lazy" />
                {:else}
                  <div class="team-avatar placeholder" aria-hidden="true"></div>
                {/if}
                <div class="team-meta">
                  <div class="team-name" title={displayNameForRoster(findRoster(p.away.roster_id))}>{displayNameForRoster(findRoster(p.away.roster_id))}</div>
                  <div class="team-sub">{ownerNameForRoster(findRoster(p.away.roster_id)) || ('Roster ' + p.away.roster_id)}</div>
                </div>
              {:else}
                <div class="team-avatar placeholder" aria-hidden="true"></div>
                <div class="team-meta"><div class="team-name">Roster {p.away.roster_id}</div><div class="team-sub"></div></div>
              {/if}
            {:else}
              <div class="team-avatar placeholder" aria-hidden="true"></div>
              <div class="team-meta"><div class="team-name">TBD</div><div class="team-sub"></div></div>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</main>

<style>
  :root{
    --nav-text: #e6eef6;
    --muted: #9fb0c4;
    --muted-bg: rgba(255,255,255,0.02);
    --accent: #00c6d8;
    --accent-dark: #008fa6;
    --bg-card: rgba(255,255,255,0.02);
  }

  .wrap { max-width: 1100px; margin: 0 auto; padding: 0 1rem; }
  .matchups-page { padding: 1.5rem 0 3rem; }

  .matchups-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:0.75rem; }
  .matchups-header h1 { margin:0; color:var(--nav-text); font-size:1.1rem; font-weight:800; }
  .muted { color:var(--muted); font-weight:700; margin-top:6px; }
  .week-range { color:var(--muted); font-weight:600; margin-left:6px; font-size:0.95rem; }

  .week-selector select, .week-selector input[type="number"] {
    background: var(--bg-card);
    color: var(--nav-text);
    border: 1px solid rgba(255,255,255,0.03);
    padding: 8px 10px;
    border-radius: 8px;
    font-weight:700;
    min-width: 220px;
  }

  .notice { padding:10px 12px; background: rgba(255,255,255,0.01); border-radius:8px; margin-bottom:1rem; color:var(--muted); font-size:0.95rem; text-align:center; }
  .notice.error { background: rgba(255,80,80,0.04); color:#ffb6b6; }

  /* revert to the previous table-like two-column layout */
  .matchups { display:grid; grid-template-columns: repeat(2, 1fr); gap:12px; align-items:start; justify-content:center; }
  .matchup-card { display:flex; align-items:center; gap:12px; text-decoration:none; background:var(--bg-card); border-radius:10px; padding:12px; width:100%; max-width:560px; border: 1px solid rgba(255,255,255,0.03); }
  .matchup-card:hover { transform:translateY(-3px); }

  .side { display:flex; align-items:center; gap:12px; min-width:0; flex:1 1 0; }
  .team-left { justify-content:flex-start; }
  .team-right { justify-content:flex-end; flex-direction:row-reverse; text-align:right; }

  .team-avatar { width:52px; height:52px; border-radius:999px; object-fit:cover; background: rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.03); flex-shrink:0; }
  .team-avatar.placeholder { background: var(--muted-bg); }

  .team-meta { display:flex; flex-direction:column; min-width:0; }
  .team-name { font-weight:800; color:var(--nav-text); font-size:1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:12.5rem; }
  .team-right .team-name { max-width:11rem; }
  .team-sub { font-size:0.82rem; color:var(--muted); font-weight:600; margin-top:4px; }

  .score-pair { display:flex; align-items:center; gap:6px; margin:0 6px; width:130px; justify-content:center; text-align:center; flex-shrink:0; }
  .score-number { font-weight:900; font-size:1.12rem; color:var(--nav-text); }
  .score-label { font-size:0.72rem; color:var(--muted); font-weight:700; }
  .score-divider { font-size:1rem; color:var(--muted); margin:0 6px; }

  @media (max-width:900px){
    .matchups{ grid-template-columns: 1fr; }
    .team-avatar{ width:48px; height:48px; }
    .score-pair{ width:120px; }
  }

  @media (max-width:520px){
    .wrap{ padding:0 0.75rem; }
    .matchups-header{ flex-direction:column; align-items:flex-start; gap:0.6rem; }
    .team-avatar{ width:40px; height:40px; }
    .score-pair{ width:92px; }
    .team-name{ max-width:100%; white-space:normal; }
  }
</style>
