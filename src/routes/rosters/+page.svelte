<!-- src/routes/rosters/+page.svelte -->
<script>
  export let data;

  // Defensive defaults
  const leagueId = data && data.leagueId;
  let rosters = Array.isArray(data && data.rosters) ? data.rosters : [];
  let users = Array.isArray(data && data.users) ? data.users : [];
  let playersMap = data && data.playersMap ? data.playersMap : null;
  let fetchInfo = {
    ok: data && data.ok,
    errors: data && data.errors ? data.errors : [],
    rostersStatus: data && data.rostersStatus,
    usersStatus: data && data.usersStatus,
    playersMapStatus: data && data.playersMapStatus
  };

  /* --- helpers (same robust helpers as before) --- */
  function findUserByOwner(ownerId) {
    if (!users) return null;
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      if (String(u.user_id) === String(ownerId) || u.user_id === ownerId) return u;
    }
    return null;
  }

  function displayNameForRoster(roster) {
    if (!roster) return 'Roster';
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
    const owner = findUserByOwner(roster.owner_id || roster.user_id || roster.owner || roster.user);
    if (owner) {
      if (owner.metadata && owner.metadata.team_name) return owner.metadata.team_name;
      if (owner.display_name) return owner.display_name;
      if (owner.username) return owner.username;
    }
    return 'Roster ' + (roster.roster_id != null ? roster.roster_id : '');
  }

  function avatarForRoster(roster) {
    if (!roster) return null;
    const md = roster.metadata || {};
    const settings = roster.settings || {};
    let candidate = md.team_avatar || md.avatar || settings.team_avatar || settings.avatar;
    if (!candidate) {
      const u = findUserByOwner(roster.owner_id || roster.user_id || roster.owner || roster.user);
      if (u) candidate = (u.metadata && u.metadata.avatar) || u.avatar;
    }
    if (!candidate) return null;
    if (typeof candidate === 'string' && (candidate.indexOf('http://') === 0 || candidate.indexOf('https://') === 0)) {
      return candidate;
    }
    return 'https://sleepercdn.com/avatars/' + encodeURIComponent(String(candidate));
  }

  function prettyNameFromId(id) {
    if (!id) return '';
    let s = String(id).replace(/[_-]+/g, ' ').replace(/\d+/g, '').trim();
    if (!s) return id;
    return s.split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  function normalizeForCompare(s) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  }

  function resolvePlayerInfo(playerId) {
    if (!playersMap || !playerId) return null;

    if (playersMap[playerId]) return playersMap[playerId];
    if (playersMap[String(playerId)]) return playersMap[String(playerId)];
    const lower = String(playerId).toLowerCase();
    if (playersMap[lower]) return playersMap[lower];
    const upper = String(playerId).toUpperCase();
    if (playersMap[upper]) return playersMap[upper];

    const vals = Object.values(playersMap);
    const targetStr = String(playerId).trim();

    for (let i = 0; i < vals.length; i++) {
      const p = vals[i];
      if (!p) continue;
      if (p.player_id != null && String(p.player_id) === targetStr) return p;
      if (p.full_name && normalizeForCompare(p.full_name) === normalizeForCompare(targetStr)) return p;
      if (p.search_full_name && normalizeForCompare(p.search_full_name) === normalizeForCompare(targetStr)) return p;
    }

    const parts = targetStr.split(/[\s-_]+/).filter(Boolean).map(s => s.toLowerCase());
    if (parts.length > 0) {
      for (let i = 0; i < vals.length; i++) {
        const p = vals[i];
        if (!p) continue;
        const fullLower = (p.full_name || '').toLowerCase();
        let allMatch = true;
        for (let j = 0; j < parts.length; j++) {
          if (parts[j] === '') continue;
          if (fullLower.indexOf(parts[j]) === -1) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) return p;
      }
    }

    return null;
  }

  function getPlayerName(playerInfo, playerId) {
    if (!playerInfo) {
      const pretty = prettyNameFromId(playerId);
      if (!pretty || /^[0-9]+$/.test(String(pretty).trim())) return 'Player ' + String(playerId);
      return pretty;
    }
    if (playerInfo.full_name && String(playerInfo.full_name).trim() !== '') return playerInfo.full_name;
    if ((playerInfo.first_name || playerInfo.last_name) &&
        ((playerInfo.first_name || '').trim() !== '' || (playerInfo.last_name || '').trim() !== '')) {
      const first = playerInfo.first_name ? String(playerInfo.first_name).trim() : '';
      const last = playerInfo.last_name ? String(playerInfo.last_name).trim() : '';
      return (first + ' ' + last).trim();
    }
    const pretty = prettyNameFromId(playerId);
    if (!pretty || /^[0-9]+$/.test(String(pretty).trim())) return 'Player ' + String(playerId);
    return pretty;
  }

  function getPlayerHeadshot(playerId) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  function playerDisplayInfo(playerId) {
    const pi = resolvePlayerInfo(playerId);
    if (pi) {
      const name = getPlayerName(pi, playerId);
      const position = pi.position || pi.position_type || '';
      const team = pi.team || '';
      return { name, position, team, headshot: getPlayerHeadshot(pi.player_id || playerId) };
    }
    const name = getPlayerName(null, playerId);
    return { name, position: '', team: '', headshot: getPlayerHeadshot(playerId) };
  }
</script>

<section class="wrap page-rosters">
  <h1 class="title">Rosters</h1>

  <!-- Diagnostic area: shows fetch status & errors (helpful in dev) -->
  {#if !fetchInfo.ok}
    <div class="diagnostic">
      <strong>Data fetch issues detected</strong>
      <div>League ID: {leagueId}</div>
      <div>Rosters status: {fetchInfo.rostersStatus}</div>
      <div>Users status: {fetchInfo.usersStatus}</div>
      <div>PlayersMap status: {fetchInfo.playersMapStatus}</div>
      <ul>
        {#each fetchInfo.errors as e}
          <li><strong>{e.key}</strong>: {e.status || 'no status'} — {e.fetchError || 'error'}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if !rosters || rosters.length === 0}
    <div class="notice">No rosters found.</div>
  {:else}
    <div class="teams">
      {#each rosters as roster (roster.roster_id)}
        <article class="team-card" aria-labelledby={"team-" + roster.roster_id}>
          <div class="team-top">
            <div class="team-left">
              {#if avatarForRoster(roster)}
                <img src={avatarForRoster(roster)} alt={"Avatar for " + displayNameForRoster(roster)} class="team-avatar" loading="lazy" />
              {:else}
                <div class="team-avatar placeholder" aria-hidden="true"></div>
              {/if}
            </div>

            <div class="team-meta">
              <h2 id={"team-" + roster.roster_id} class="team-name">{displayNameForRoster(roster)}</h2>
              <div class="team-sub">{(findUserByOwner(roster.owner_id) || {}).display_name || (findUserByOwner(roster.user_id) || {}).username || ('Roster ' + roster.roster_id)}</div>
            </div>
          </div>

          <div class="players-list">
            {#if Array.isArray(roster.players) && roster.players.length > 0}
              {#each roster.players as pid}
                {#key pid}
                  {#await Promise.resolve(playerDisplayInfo(pid)) then pinfo}
                    <div class="player">
                      <img class="headshot" src={pinfo.headshot} alt={"Headshot of " + pinfo.name} on:error={(e) => (e.target.style.visibility = 'hidden')} loading="lazy" />
                      <div class="player-meta">
                        <div class="player-name" title={pinfo.name}>{pinfo.name}</div>
                        <div class="player-sub">
                          {#if pinfo.position}{pinfo.position}{/if}
                          {#if pinfo.position && pinfo.team} &nbsp;•&nbsp; {/if}
                          {#if pinfo.team}{pinfo.team}{/if}
                        </div>
                      </div>
                    </div>
                  {/await}
                {/key}
              {/each}
            {:else}
              <div class="notice small">No players listed on this roster.</div>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}

  <!-- Raw debug dump (only show in dev) -->
  <details class="debug" open>
    <summary>Raw payload (debug)</summary>
    <pre style="max-height:320px; overflow:auto; font-size:12px; line-height:1.3">{JSON.stringify({ leagueId, rostersCount: rosters.length, usersCount: users.length, hasPlayersMap: !!playersMap, fetchInfo }, null, 2)}</pre>
  </details>
</section>

<style>
  :root{
    --nav-text: #e6eef6;
    --muted: #9fb0c4;
    --bg-card: rgba(255,255,255,0.02);
    --accent: #00c6d8;
  }

  .wrap { max-width: 1100px; margin: 0 auto; padding: 1rem; box-sizing: border-box; }
  .title { margin: 0 0 1rem 0; color: var(--nav-text); font-size: 1.35rem; font-weight: 800; }

  .diagnostic { padding:12px; background: rgba(255,80,80,0.04); border-radius:8px; color: #ffb6b6; margin-bottom: 1rem; }
  .notice { padding: 10px 12px; background: var(--bg-card); border-radius: 8px; color: var(--muted); text-align:center; }
  .notice.small { padding:6px 8px; font-size:0.95rem; }

  .teams {
    display:grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
    align-items: start;
  }

  .team-card {
    background: var(--bg-card);
    padding: 12px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.03);
    color: var(--nav-text);
    display:flex;
    flex-direction:column;
    gap: 10px;
  }

  .team-top { display:flex; gap:12px; align-items:center; }
  .team-left { flex: 0 0 auto; }
  .team-avatar { width:64px; height:64px; object-fit:cover; background: rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.03); }
  .team-avatar.placeholder { width:64px; height:64px; background: rgba(255,255,255,0.02); border-radius:8px; }

  .team-meta { display:flex; flex-direction:column; min-width:0; }
  .team-name { margin:0; font-size:1.02rem; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:calc(100% - 8px); }
  .team-sub { font-size:0.88rem; color:var(--muted); margin-top:6px; font-weight:700; }

  .players-list { display:flex; flex-direction:column; gap:8px; margin-top:6px; }
  .player { display:flex; gap:10px; align-items:center; min-width:0; }
  .headshot { width:44px; height:44px; border-radius:8px; object-fit:cover; background:#0b1220; border:1px solid rgba(255,255,255,0.03); flex-shrink:0; }
  .player-meta { display:flex; flex-direction:column; min-width:0; }
  .player-name { font-weight:700; color:var(--nav-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:18rem; }
  .player-sub { color:var(--muted); font-size:0.85rem; margin-top:2px; }

  details.debug { margin-top:1rem; color:var(--muted); background: rgba(255,255,255,0.01); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.03); }

  @media (max-width:520px){
    .wrap { padding: 0.75rem; }
    .team-avatar, .team-avatar.placeholder { width:56px; height:56px; }
    .headshot { width:40px; height:40px; }
    .team-name { font-size:0.98rem; }
    .player-name { max-width:12rem; font-size:0.97rem; }
  }
</style>
