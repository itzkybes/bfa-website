<!-- src/routes/records-player/+page.svelte — Player MVPs & all-time bests -->
<script>
  export let data;

  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id) : null);

  const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];
  const allTimePlayoff = Array.isArray(data?.allTimePlayoffBestPerRoster) ? data.allTimePlayoffBestPerRoster : [];
  const allTimeFull = Array.isArray(data?.allTimeFullSeasonBestPerRoster) ? data.allTimeFullSeasonBestPerRoster : [];

  $: selectedRow = seasonsResults.find((r) => String(r.season) === String(selectedSeason)) ?? null;
  $: om = selectedRow?.overallMvp ?? null;
  $: fm = selectedRow?.finalsMvp ?? null;

  function headshot(pid) {
    return pid ? `https://sleepercdn.com/content/nba/players/${pid}.jpg` : '';
  }

  function avatarOrPh(url, name) {
    if (url) return url;
    const ch = name ? name[0].toUpperCase() : 'P';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
  }

  function fmt(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  // Roster info resolver (preserved from original)
  const rosterNameMap = {};
  (function () {
    for (const sr of seasonsResults) {
      if (!Array.isArray(sr?.teamLeaders)) continue;
      for (const t of sr.teamLeaders) {
        const rid = String(t.rosterId);
        const meta = t._roster_meta || {};
        if (!rosterNameMap[rid]) {
          rosterNameMap[rid] = {
            teamName: meta.team_name || meta.owner_name || t.owner_name || null,
            ownerName: t.owner_name || meta.owner_name || null,
            teamAvatar: t.teamAvatar || meta.team_avatar || null
          };
        }
      }
    }
  })();

  function rosterInfo(row) {
    if (!row) return { teamName: null, ownerName: null, teamAvatar: null };
    const rid = String(row.rosterId ?? row.topRosterId ?? '');
    const rm = row.roster_meta || row._roster_meta || {};
    const map = rid ? rosterNameMap[rid] || {} : {};
    return {
      teamName: row.teamName || row.team_name || rm.team_name || map.teamName || row.owner_name || `Roster ${rid}`,
      ownerName: row.owner_name || rm.owner_name || map.ownerName || (rid ? `Roster ${rid}` : null),
      teamAvatar: row.teamAvatar || row.team_avatar || rm.team_avatar || rm.owner_avatar || map.teamAvatar || null
    };
  }

  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="head-row">
      <div>
        <div class="eyebrow">All-Time · Player Records</div>
        <h1 class="page-title">Player Records</h1>
      </div>
      <form id="filters" method="get">
        <label for="season-select" class="visually-hidden">Season</label>
        <select id="season-select" name="season" on:change={submitFilters} data-testid="player-season-select">
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={String(s.season ?? s.league_id) === String(selectedSeason)}>
              {s.season ?? s.name ?? s.league_id}
            </option>
          {/each}
        </select>
      </form>
    </div>
  </header>

  <!-- MVPs for selected season -->
  <section class="block">
    <div class="block-head">
      <h2 class="block-title">Season MVPs · {selectedSeason}</h2>
      <span class="block-sub">Overall & Finals</span>
    </div>

    <div class="mvp-grid">
      <!-- Overall MVP -->
      <div class="mvp-card" data-testid="mvp-overall">
        <div class="mvp-label">Overall MVP</div>
        {#if om}
          <div class="mvp-body">
            <img
              class="mvp-headshot"
              src={headshot(om.playerId) || avatarOrPh(rosterInfo(om).teamAvatar, om.playerName)}
              alt={om.playerName}
              on:error={(e) => (e.currentTarget.src = avatarOrPh(rosterInfo(om).teamAvatar, om.playerName))}
            />
            <div>
              <div class="mvp-player-name">{om.playerName}</div>
              <div class="mvp-pts num">{fmt(om.points)}<span class="pts-label"> PTS</span></div>
              <div class="mvp-team">
                <img class="team-mini" src={avatarOrPh(rosterInfo(om).teamAvatar, rosterInfo(om).teamName)} alt={rosterInfo(om).teamName} />
                <div>
                  <div class="t-name">{rosterInfo(om).teamName}</div>
                  <div class="t-owner">{rosterInfo(om).ownerName}</div>
                </div>
              </div>
            </div>
          </div>
        {:else}
          <div class="mvp-empty">No Overall MVP data.</div>
        {/if}
      </div>

      <!-- Finals MVP -->
      <div class="mvp-card finals" data-testid="mvp-finals">
        <div class="mvp-label finals">Finals MVP</div>
        {#if fm}
          <div class="mvp-body">
            <img
              class="mvp-headshot"
              src={headshot(fm.playerId) || avatarOrPh(rosterInfo(fm).teamAvatar, fm.playerName)}
              alt={fm.playerName}
              on:error={(e) => (e.currentTarget.src = avatarOrPh(rosterInfo(fm).teamAvatar, fm.playerName))}
            />
            <div>
              <div class="mvp-player-name">{fm.playerName}</div>
              <div class="mvp-pts num">{fmt(fm.points)}<span class="pts-label"> PTS</span></div>
              <div class="mvp-team">
                <img class="team-mini" src={avatarOrPh(rosterInfo(fm).teamAvatar, rosterInfo(fm).teamName)} alt={rosterInfo(fm).teamName} />
                <div>
                  <div class="t-name">{rosterInfo(fm).teamName}</div>
                  <div class="t-owner">{rosterInfo(fm).ownerName}</div>
                </div>
              </div>
            </div>
          </div>
        {:else}
          <div class="mvp-empty">No Finals MVP data.</div>
        {/if}
      </div>
    </div>
  </section>

  <!-- All-time playoff best -->
  <section class="block">
    <div class="block-head">
      <h2 class="block-title">All-Time Single-Season Playoff Best</h2>
      <span class="block-sub">Per team · 2022 → present</span>
    </div>
    {#if allTimePlayoff.length}
      <div class="table-wrap">
        <table class="bfa-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Player</th>
              <th>Season</th>
              <th class="col-num">PTS</th>
            </tr>
          </thead>
          <tbody>
            {#each allTimePlayoff as row (row.rosterId)}
              {@const info = rosterInfo(row)}
              <tr>
                <td>
                  <div class="team-cell">
                    <img class="team-avatar small" src={avatarOrPh(info.teamAvatar, info.teamName)} alt={info.teamName} />
                    <div>
                      <div class="team-name-cell">{row.teamName ?? info.teamName}</div>
                      <div class="team-owner-cell">{row.owner_name ?? info.ownerName}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="player-cell">
                    <img class="headshot" src={headshot(row.playerId)} alt={row.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    <div class="player-name-cell">{row.playerName ?? `Player ${row.playerId}`}</div>
                  </div>
                </td>
                <td><span class="num accent-text">{row.season}</span></td>
                <td class="col-num"><span class="num bigpts">{fmt(row.points)}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="empty-card">No playoff data.</div>
    {/if}
  </section>

  <!-- All-time full-season best -->
  <section class="block">
    <div class="block-head">
      <h2 class="block-title">All-Time Single-Season Full-Season Best</h2>
      <span class="block-sub">Per team · regular + playoffs · 2022 → present</span>
    </div>
    {#if allTimeFull.length}
      <div class="table-wrap">
        <table class="bfa-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Player</th>
              <th>Season</th>
              <th class="col-num">PTS</th>
            </tr>
          </thead>
          <tbody>
            {#each allTimeFull as row (row.rosterId)}
              {@const info = rosterInfo(row)}
              <tr>
                <td>
                  <div class="team-cell">
                    <img class="team-avatar small" src={avatarOrPh(info.teamAvatar, info.teamName)} alt={info.teamName} />
                    <div>
                      <div class="team-name-cell">{row.teamName ?? info.teamName}</div>
                      <div class="team-owner-cell">{row.owner_name ?? info.ownerName}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="player-cell">
                    <img class="headshot" src={headshot(row.playerId)} alt={row.playerName} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    <div class="player-name-cell">{row.playerName ?? `Player ${row.playerId}`}</div>
                  </div>
                </td>
                <td><span class="num accent-text">{row.season}</span></td>
                <td class="col-num"><span class="num bigpts">{fmt(row.points)}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="empty-card">No full-season data.</div>
    {/if}
  </section>
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }

  .head-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .page-title {
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 6vw, 4rem);
    line-height: 1;
    text-transform: uppercase;
    margin: 0.4rem 0 0;
  }

  .block {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    overflow: hidden;
    margin-bottom: 1.25rem;
  }

  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-subtle);
    gap: 1rem;
    flex-wrap: wrap;
  }

  .block-title {
    font-family: var(--font-display);
    font-size: 1.3rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .block-sub {
    color: var(--text-tertiary);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-weight: 700;
  }

  /* MVP grid */
  .mvp-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
  }

  .mvp-card {
    padding: 1.5rem;
    border-right: 1px solid var(--border-subtle);
  }

  .mvp-card.finals { border-right: none; background: linear-gradient(180deg, rgba(255, 69, 0, 0.05), transparent); }

  .mvp-label {
    font-family: var(--font-body);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: 0.72rem;
    color: var(--text-tertiary);
    margin-bottom: 1.25rem;
  }

  .mvp-label.finals {
    color: var(--accent);
  }

  .mvp-body {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }

  .mvp-headshot {
    width: 96px;
    height: 96px;
    object-fit: cover;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .mvp-player-name {
    font-family: var(--font-display);
    font-size: 1.6rem;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }

  .mvp-pts {
    color: var(--accent);
    font-size: 1.8rem;
    margin-bottom: 0.6rem;
    line-height: 1;
  }

  .pts-label {
    font-family: var(--font-body);
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.2em;
    color: var(--text-tertiary);
    margin-left: 0.25rem;
  }

  .mvp-team {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-subtle);
  }

  .team-mini {
    width: 32px;
    height: 32px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
  }

  .t-name {
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--text-primary);
  }

  .t-owner {
    color: var(--text-tertiary);
    font-size: 0.75rem;
  }

  .mvp-empty {
    color: var(--text-tertiary);
    padding: 1rem 0;
    font-style: italic;
  }

  /* Tables */
  .table-wrap { overflow-x: auto; }
  .bfa-table { min-width: 720px; }

  .team-cell, .player-cell {
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }

  .team-avatar.small { width: 42px; height: 42px; }

  .team-name-cell, .player-name-cell {
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.15;
  }

  .team-owner-cell {
    color: var(--text-tertiary);
    font-size: 0.78rem;
    margin-top: 0.15rem;
  }

  .bigpts {
    font-size: 1.15rem;
    color: var(--accent);
    font-weight: 700;
  }

  .accent-text { color: var(--accent); }

  .empty-card {
    padding: 1.5rem;
    text-align: center;
    color: var(--text-secondary);
  }

  @media (max-width: 720px) {
    .mvp-grid { grid-template-columns: 1fr; }
    .mvp-card { border-right: none; border-bottom: 1px solid var(--border-subtle); }
    .mvp-card.finals { border-bottom: none; }
    .mvp-body { flex-direction: column; align-items: center; text-align: center; }
    .mvp-team { justify-content: center; }
  }
</style>
