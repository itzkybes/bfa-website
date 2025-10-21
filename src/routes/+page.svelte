<!-- src/routes/+page.svelte -->
<script>
  import { onMount } from 'svelte';
  const CONFIG_PATH = '/week-ranges.json';
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const forcedWeek = (urlParams && urlParams.get('week')) ? parseInt(urlParams.get('week'), 10) : null;
  const leagueId = (urlParams && urlParams.get('league')) || import.meta.env.VITE_LEAGUE_ID || '1219816671624048640';

  let loading = true;
  let error = null;
  let matchupPairs = [];
  let rosters = [];
  let users = [];
  let weekRanges = null;
  let fetchWeek = null;

  // Player of the Week state (still called potw for convenience)
  let potw = null; // { playerId, playerInfo, roster, rosterName, ownerName }

  function parseLocalDateYMD(ymd) {
    return new Date(ymd + 'T00:00:00');
  }

  /* computeEffectiveWeekFromRanges, findRoster, findUserByOwner,
     avatarForRoster, displayNameForRoster, ownerNameForRoster,
     fmt, normalizeMatchups, weekDateRangeLabel omitted for brevity
     — keep the same implementations you already had */
  // (Paste your existing helper implementations here unchanged)
  // ... (existing helpers) ...

  // helpers used for POTW
  function chooseRandom(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function getPlayerHeadshot(playerId) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  function prettyNameFromId(id) {
    if (!id) return '';
    let s = String(id).replace(/[_-]+/g, ' ').replace(/\d+/g, '').trim();
    if (!s) return id;
    return s.split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  // prefer explicit full name, then first/last fields, then pretty id
  function getPlayerName(playerInfo, playerId) {
    if (!playerInfo) return prettyNameFromId(playerId);
    if (playerInfo.full_name && String(playerInfo.full_name).trim() !== '') return playerInfo.full_name;
    if ((playerInfo.first_name || playerInfo.last_name) &&
        ((playerInfo.first_name || '').trim() !== '' || (playerInfo.last_name || '').trim() !== '')) {
      const first = playerInfo.first_name ? String(playerInfo.first_name).trim() : '';
      const last = playerInfo.last_name ? String(playerInfo.last_name).trim() : '';
      return (first + ' ' + last).trim();
    }
    return prettyNameFromId(playerId);
  }

  async function pickPlayerOfTheWeek() {
    potw = null;
    try {
      const candidates = (rosters || []).filter(r => Array.isArray(r.players) && r.players.length > 0);
      if (!candidates || candidates.length === 0) return;

      const randomRoster = chooseRandom(candidates);
      const playerId = chooseRandom(randomRoster.players);
      if (!playerId) return;

      // fetch only NBA players map
      let playersMap = null;
      try {
        const resp = await fetch('/players/nba');
        if (resp.ok) playersMap = await resp.json();
      } catch (e) {
        // ignore; we'll fall back to derived name
      }

      let playerInfo = null;
      if (playersMap) {
        playerInfo = playersMap[playerId] || playersMap[playerId.toUpperCase()] || playersMap[String(playerId)];
        if (!playerInfo) {
          const vals = Object.values(playersMap);
          for (let i = 0; i < vals.length; i++) {
            const p = vals[i];
            if (!p) continue;
            if (p.player_id === playerId || p.full_name === playerId) {
              playerInfo = p;
              break;
            }
          }
        }
      }

      if (!playerInfo) {
        playerInfo = { player_id: playerId, full_name: prettyNameFromId(playerId), position: null, team: '' };
      } else {
        if (!playerInfo.full_name) playerInfo.full_name = getPlayerName(playerInfo, playerId);
      }

      potw = {
        playerId,
        playerInfo,
        roster: randomRoster,
        rosterName: displayNameForRoster(randomRoster),
        ownerName: ownerNameForRoster(randomRoster)
      };

    } catch (err) {
      console.warn('POTW error', err);
      potw = null;
    }
  }

  onMount(async function() {
    loading = true;
    error = null;
    matchupPairs = [];
    rosters = [];
    users = [];
    potw = null;

    try {
      const cfgRes = await fetch(CONFIG_PATH);
      if (!cfgRes.ok) weekRanges = null;
      else weekRanges = await cfgRes.json();

      fetchWeek = computeEffectiveWeekFromRanges(weekRanges || []);

      const mRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/matchups/' + fetchWeek);
      if (!mRes.ok) throw new Error('matchups fetch failed: ' + mRes.status);
      const matchupsRaw = await mRes.json();

      const rRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/rosters');
      if (rRes.ok) rosters = await rRes.json();

      const uRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/users');
      if (uRes.ok) users = await uRes.json();

      matchupPairs = normalizeMatchups(matchupsRaw);

      // pick rando player after rosters loaded
      await pickPlayerOfTheWeek();
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    } finally {
      loading = false;
    }
  });
</script>

<main class="home-page">
  <section class="hero">
    <div class="wrap hero-row">
      <div class="hero-left">
        <h1 class="hero-title">Your League — at a glance</h1>
        <p class="hero-sub">Quickly browse rosters, standings, and player lineups. Showing matchups for week <strong>{fetchWeek || '?'}</strong>.</p>
        <div class="actions">
          <a class="btn primary" href="/rosters">View Rosters</a>
          <a class="btn" href="/standings">View Standings</a>
        </div>
      </div>

      <!-- HERO-RIGHT: Rando Player card -->
      <div class="hero-right" aria-hidden={potw ? 'false' : 'true'}>
        {#if potw}
          <div class="potw-hero" role="region" aria-label="Rando Player">
            <div class="potw-left">
              {#if potw.playerInfo && potw.playerInfo.player_id}
                <img
                  class="headshot potw-headshot"
                  src={getPlayerHeadshot(potw.playerInfo.player_id)}
                  alt={"Headshot of " + getPlayerName(potw.playerInfo, potw.playerId)}
                  on:error={(e) => (e.target.style.visibility = 'hidden')}
                  loading="lazy"
                />
              {:else}
                <div class="potw-avatar">🏆</div>
              {/if}
            </div>

            <div class="potw-body">
              <!-- title changed per request -->
              <div class="potw-title">Rando Player</div>

              <!-- show readable name first -->
              <div class="potw-player-name" title={getPlayerName(potw.playerInfo, potw.playerId)}>
                {getPlayerName(potw.playerInfo, potw.playerId)}
              </div>

              <div class="potw-meta">
                {#if potw.playerInfo.position}
                  <span class="pill">{potw.playerInfo.position}</span>
                {/if}
                {#if potw.playerInfo.team}
                  <span class="pill">{potw.playerInfo.team}</span>
                {/if}
                <span class="pill">{potw.rosterName}</span>
                {#if potw.ownerName}
                  <span class="owner">• {potw.ownerName}</span>
                {/if}
              </div>

              {#if potw.playerInfo.player_id && potw.playerInfo.player_id !== (potw.playerInfo.full_name || '')}
                <div class="potw-subid">ID: <code>{potw.playerInfo.player_id}</code></div>
              {/if}
            </div>

            <div class="potw-actions">
              <a class="btn small" href={"/rosters?owner=" + (potw.roster && potw.roster.roster_id ? potw.roster.roster_id : '')}>View Roster</a>
              <button class="btn small" on:click={pickPlayerOfTheWeek} aria-label="Pick a different player">Shuffle</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </section>

  <!-- rest of page (matchups etc.) unchanged — keep your existing markup/styles -->
  <!-- ... -->
</main>

<style>
/* (include the CSS from your last version; only minor classname references matter) */
</style>
