<!-- src/routes/+page.svelte -->
<script>
  import { onMount } from 'svelte';

  var CONFIG_PATH = '/week-ranges.json';
  var urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  var forcedWeek = (urlParams && urlParams.get('week')) ? parseInt(urlParams.get('week'), 10) : null;
  var leagueId = (urlParams && urlParams.get('league')) || import.meta.env.VITE_LEAGUE_ID || '1219816671624048640';

  var loading = true;
  var error = null;
  var matchupPairs = [];
  var rosters = [];
  var users = [];
  var weekRanges = null;
  var fetchWeek = null;

  function parseLocalDateYMD(ymd) {
    return new Date(ymd + 'T00:00:00');
  }

  function computeEffectiveWeekFromRanges(ranges) {
    if (forcedWeek && !isNaN(forcedWeek)) {
      return forcedWeek;
    }
    if (!Array.isArray(ranges) || ranges.length === 0) return 1;

    var now = new Date();

    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      var start = parseLocalDateYMD(r.start);
      var end = parseLocalDateYMD(r.end);
      var endInclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
      if (now >= start && now <= endInclusive) {
        var rotateAt = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0, 0);
        rotateAt.setDate(rotateAt.getDate() + 1);
        if (now >= rotateAt) {
          var next = (i + 1 < ranges.length) ? ranges[i + 1] : null;
          return next ? next.week : r.week;
        } else {
          return r.week;
        }
      }
    }

    var first = ranges[0];
    var firstStart = parseLocalDateYMD(first.start);
    if (now < firstStart) return first.week;

    var last = ranges[ranges.length - 1];
    var lastEnd = parseLocalDateYMD(last.end);
    var lastRotateAt = new Date(lastEnd.getFullYear(), lastEnd.getMonth(), lastEnd.getDate(), 12, 0, 0, 0);
    lastRotateAt.setDate(lastRotateAt.getDate() + 1);
    if (now >= lastRotateAt) return last.week;

    for (var j = ranges.length - 1; j >= 0; j--) {
      var rr = ranges[j];
      var rrEnd = parseLocalDateYMD(rr.end);
      var rrEndInclusive = new Date(rrEnd.getFullYear(), rrEnd.getMonth(), rrEnd.getDate(), 23, 59, 59, 999);
      if (now > rrEndInclusive) {
        var rotateAtPast = new Date(rrEnd.getFullYear(), rrEnd.getMonth(), rrEnd.getDate(), 12, 0, 0, 0);
        rotateAtPast.setDate(rotateAtPast.getDate() + 1);
        if (now >= rotateAtPast) {
          var nx = (j + 1 < ranges.length) ? ranges[j + 1] : null;
          return nx ? nx.week : rr.week;
        } else {
          return rr.week;
        }
      }
    }

    return first.week;
  }

  function findRoster(id) {
    if (!rosters) return null;
    for (var i = 0; i < rosters.length; i++) {
      var r = rosters[i];
      if (String(r.roster_id) === String(id) || r.roster_id === id) return r;
    }
    return null;
  }

  function findUserByOwner(ownerId) {
    if (!users) return null;
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (String(u.user_id) === String(ownerId) || u.user_id === ownerId) return u;
    }
    return null;
  }

  function avatarForRoster(rosterOrId) {
    var roster = rosterOrId && typeof rosterOrId === 'object' ? rosterOrId : findRoster(rosterOrId);
    if (!roster) return null;
    var md = roster.metadata || {};
    var settings = roster.settings || {};
    var candidate = null;
    if (md && md.team_avatar) candidate = md.team_avatar;
    if (!candidate && md && md.avatar) candidate = md.avatar;
    if (!candidate && settings && settings.team_avatar) candidate = settings.team_avatar;
    if (!candidate && settings && settings.avatar) candidate = settings.avatar;
    if (!candidate) {
      var u = findUserByOwner(roster.owner_id);
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
    var roster = rosterOrId && typeof rosterOrId === 'object' ? rosterOrId : findRoster(rosterOrId);
    if (roster) {
      var md = roster.metadata || {};
      var settings = roster.settings || {};
      var nameCandidates = [
        md.team_name, md.teamName, md.team, md.name,
        settings.team_name, settings.teamName, settings.team, settings.name
      ];
      for (var i = 0; i < nameCandidates.length; i++) {
        var cand = nameCandidates[i];
        if (cand && typeof cand === 'string' && cand.trim() !== '') {
          return cand.trim();
        }
      }
      if (roster.name && typeof roster.name === 'string' && roster.name.trim() !== '') {
        return roster.name.trim();
      }
    }

    var ownerId = null;
    if (roster && roster.owner_id) ownerId = roster.owner_id;
    if (!ownerId && roster) ownerId = roster.user_id || roster.owner || roster.user;

    if (!ownerId && typeof rosterOrId !== 'object') {
      ownerId = rosterOrId;
    }

    if (ownerId) {
      var u = findUserByOwner(ownerId);
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
    var roster = rosterOrId && typeof rosterOrId === 'object' ? rosterOrId : findRoster(rosterOrId);
    var ownerId = roster && (roster.owner_id || roster.user_id || roster.owner || roster.user);
    if (!ownerId && typeof rosterOrId !== 'object') ownerId = rosterOrId;
    if (!ownerId) return null;
    var u = findUserByOwner(ownerId);
    if (!u) return null;
    return u.display_name || u.username || (u.metadata && u.metadata.team_name) || null;
  }

  function fmt(n) {
    if (n == null) return '-';
    if (typeof n === 'number') return (Math.round(n * 10) / 10).toFixed(1);
    return String(n);
  }

  function normalizeMatchups(raw) {
    var pairs = [];
    if (!raw) return pairs;

    if (Array.isArray(raw)) {
      var map = {};
      for (var i = 0; i < raw.length; i++) {
        var e = raw[i];
        var mid = e.matchup_id != null ? String(e.matchup_id) : null;
        if (mid) {
          if (!map[mid]) map[mid] = [];
          map[mid].push(e);
        } else if (e.opponent_roster_id != null) {
          var attached = false;
          var keys = Object.keys(map);
          for (var k = 0; k < keys.length && !attached; k++) {
            var arr = map[keys[k]];
            for (var j = 0; j < arr.length; j++) {
              if (String(arr[j].roster_id) === String(e.opponent_roster_id) || String(arr[j].roster_id) === String(e.roster_id)) {
                arr.push(e);
                attached = true;
                break;
              }
            }
          }
          if (!attached) map['p_' + i] = [e];
        } else {
          map['p_' + i] = [e];
        }
      }

      var mids = Object.keys(map);
      for (var m = 0; m < mids.length; m++) {
        var bucket = map[mids[m]];
        if (bucket.length === 2) {
          pairs.push({ matchup_id: mids[m], home: normalizeEntry(bucket[0]), away: normalizeEntry(bucket[1]) });
        } else if (bucket.length === 1) {
          pairs.push({ matchup_id: mids[m], home: normalizeEntry(bucket[0]), away: null });
        } else if (bucket.length > 2) {
          for (var s = 0; s < bucket.length; s += 2) {
            pairs.push({ matchup_id: mids[m] + '_' + s, home: normalizeEntry(bucket[s]), away: normalizeEntry(bucket[s + 1] || null) });
          }
        }
      }
    } else if (typeof raw === 'object') {
      var arrFromObj = [];
      Object.keys(raw).forEach(function(k) {
        var v = raw[k];
        if (v && typeof v === 'object') arrFromObj.push(v);
      });
      if (arrFromObj.length > 0) {
        var grouping = {};
        for (var ii = 0; ii < arrFromObj.length; ii++) {
          var ee = arrFromObj[ii];
          var gm = ee.matchup_id != null ? String(ee.matchup_id) : 'p_' + ii;
          if (!grouping[gm]) grouping[gm] = [];
          grouping[gm].push(ee);
        }
        var gkeys = Object.keys(grouping);
        for (var g = 0; g < gkeys.length; g++) {
          var b = grouping[gkeys[g]];
          if (b.length >= 2) {
            for (var z = 0; z < b.length; z += 2) {
              pairs.push({ matchup_id: gkeys[g] + '_' + z, home: normalizeEntry(b[z]), away: normalizeEntry(b[z + 1] || null) });
            }
          } else {
            pairs.push({ matchup_id: gkeys[g], home: normalizeEntry(b[0]), away: null });
          }
        }
      }
    }
    return pairs;

    function normalizeEntry(rawEntry) {
      if (!rawEntry) return null;
      var entry = {
        roster_id: rawEntry.roster_id != null ? rawEntry.roster_id : (rawEntry.roster || rawEntry.owner_id || null),
        points: rawEntry.points != null ? rawEntry.points : (rawEntry.points_for != null ? rawEntry.points_for : (rawEntry.starters_points != null ? rawEntry.starters_points : null)),
        matchup_id: rawEntry.matchup_id != null ? rawEntry.matchup_id : null,
        raw: rawEntry
      };
      if (rawEntry.opponent_roster_id != null) entry.opponent_roster_id = rawEntry.opponent_roster_id;
      return entry;
    }
  }

  function weekDateRangeLabel(weekNum) {
    if (!Array.isArray(weekRanges)) return null;
    for (var i = 0; i < weekRanges.length; i++) {
      if (weekRanges[i] && Number(weekRanges[i].week) === Number(weekNum)) {
        var s = weekRanges[i].start;
        var e = weekRanges[i].end;
        try {
          var sd = new Date(s + 'T00:00:00');
          var ed = new Date(e + 'T00:00:00');
          var opts = { month: 'short', day: 'numeric' };
          var sdStr = sd.toLocaleDateString(undefined, opts);
          var edStr = ed.toLocaleDateString(undefined, opts);
          return sdStr + ' — ' + edStr;
        } catch (err) {
          return s + ' — ' + e;
        }
      }
    }
    return null;
  }

  onMount(async function() {
    loading = true;
    error = null;
    matchupPairs = [];
    rosters = [];
    users = [];

    try {
      var cfgRes = await fetch(CONFIG_PATH);
      if (!cfgRes.ok) {
        weekRanges = null;
      } else {
        weekRanges = await cfgRes.json();
      }

      fetchWeek = computeEffectiveWeekFromRanges(weekRanges || []);

      var mRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/matchups/' + fetchWeek);
      if (!mRes.ok) throw new Error('matchups fetch failed: ' + mRes.status);
      var matchupsRaw = await mRes.json();

      var rRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/rosters');
      if (rRes.ok) rosters = await rRes.json();

      var uRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/users');
      if (uRes.ok) users = await uRes.json();

      matchupPairs = normalizeMatchups(matchupsRaw);
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    } finally {
      loading = false;
    }
  });
</script>

<main class="home-page">
  <!-- Simplified hero: removed the league snapshot card per request -->
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
      <!-- hero-right removed to keep header area clean -->
    </div>
  </section>

  <section class="wrap matchups-section" aria-labelledby="matchups-heading">
    <div class="matchups-header">
      <h2 id="matchups-heading" class="section-title">This week's matchups</h2>
      <div class="week-pill">
        Week {fetchWeek || '?'}
        {#if weekRanges}
          <span class="week-range-label">{weekDateRangeLabel(fetchWeek)}</span>
        {/if}
      </div>
    </div>

    {#if loading}
      <div class="notice">Loading matchups for week {fetchWeek || '...' }...</div>
    {:else if error}
      <div class="notice error">Error fetching matchups: {error}</div>
    {:else if matchupPairs && matchupPairs.length > 0}
      <div class="matchups">
        {#each matchupPairs as p}
          <a class="matchup-card" href={'/rosters?owner=' + (p.home && p.home.roster_id ? p.home.roster_id : '')} >
            <!-- LEFT TEAM -->
            <div class="side team-left">
              {#if p.home}
                {#if findRoster(p.home.roster_id)}
                  {#if avatarForRoster(findRoster(p.home.roster_id))}
                    <img class="team-avatar" src={avatarForRoster(findRoster(p.home.roster_id))} alt={"Avatar for " + displayNameForRoster(findRoster(p.home.roster_id))} loading="lazy">
                  {:else}
                    <div class="team-avatar placeholder" aria-hidden="true"></div>
                  {/if}
                  <div class="team-meta">
                    <!-- Enforce single-line team names -->
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
                    <img class="team-avatar" src={avatarForRoster(findRoster(p.away.roster_id))} alt={"Avatar for " + displayNameForRoster(findRoster(p.away.roster_id))} loading="lazy">
                  {:else}
                    <div class="team-avatar placeholder" aria-hidden="true"></div>
                  {/if}
                  <div class="team-meta">
                    <!-- single-line for right side as well -->
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
    {:else}
      <div class="notice">No matchups found for week {fetchWeek}. Try a different week via <code>?week=</code>.</div>
    {/if}
  </section>
</main>

<style>
  /* layout variables (matches site's current color tokens if available) */
  :root {
    --nav-text: #e6eef6;
    --muted: #9fb0c4;
    --muted-bg: rgba(255,255,255,0.02);
    --accent: #00c6d8;
    --accent-dark: #008fa6;
    --nav-bg: #071022;
  }

  .wrap { max-width: 1100px; margin: 0 auto; padding: 0 1rem; }

  .home-page { padding: 2rem 0 4rem; min-height: 100vh; display: flex; flex-direction: column; gap: 1.25rem; }

  /* HERO - simplified and tighter (hero-right removed) */
  .hero { padding: 1.25rem 0 0; }
  .hero-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.75rem 0; }
  .hero-left { flex: 1 1 auto; }
  .hero-title { font-size: clamp(1.6rem, 3.6vw, 2.6rem); line-height: 1.05; margin: 0 0 0.4rem 0; color: var(--nav-text); font-weight: 800; }
  .hero-sub { margin: 0 0 0.9rem 0; color: var(--muted); font-size: 0.98rem; max-width: 56ch; }

  .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.56rem 1rem; border-radius: 8px; font-weight: 700; text-decoration: none; color: var(--nav-text); background: transparent; border: 1px solid rgba(255,255,255,0.03); }
  .btn.primary { background: linear-gradient(90deg, var(--accent), var(--accent-dark)); color: #fff; border: none; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
  .btn:hover { transform: translateY(-2px); }

  /* Matchups header */
  .matchups-section { margin-top: 0.6rem; }
  .matchups-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.7rem; }
  .section-title { font-size: 1.05rem; color: var(--nav-text); margin: 0; font-weight: 800; }
  .week-pill { background: var(--muted-bg); padding: 0.35rem 0.6rem; border-radius: 999px; font-weight: 700; color: var(--nav-text); font-size: 0.92rem; display: inline-flex; align-items: center; gap: 0.5rem; }
  .week-range-label { color: var(--muted); font-weight: 600; font-size: 0.85rem; margin-left: 0.25rem; }

  .notice { padding: 0.5rem 0.75rem; background: rgba(255,255,255,0.01); border-radius: 8px; margin-bottom: 1rem; color: var(--muted); font-size: 0.95rem; text-align: center; }
  .notice.error { background: rgba(255,80,80,0.04); color: #ffb6b6; }

  /* Matchups grid/cards
     - grid centered so the overall block sits centered on the page
     - ensure last child (odd item) spans full width and is centered */
  .matchups {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.9rem;
    align-items: start;
    justify-content: center; /* center the grid within the container */
  }
  .matchup-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    text-decoration: none;
    background: rgba(255,255,255,0.02);
    border-radius: 10px;
    padding: 0.9rem;
    transition: transform .12s ease, box-shadow .12s ease;
    width: 100%;
    max-width: 560px; /* limit card width so grid centering works */
  }
  .matchup-card:hover { transform: translateY(-3px); box-shadow: 0 8px 18px rgba(0,0,0,0.18); }

  /* If the last card is alone (odd number), make it span full width and center */
  .matchups > .matchup-card:last-child {
    grid-column: 1 / -1;
    justify-self: center;
    max-width: 640px;
  }

  .side { display: flex; align-items: center; gap: 0.9rem; min-width: 0; flex: 1 1 0; }
  .team-left { justify-content: flex-start; }
  .team-right { justify-content: flex-end; flex-direction: row-reverse; text-align: right; }

  .team-avatar { width: 52px; height: 52px; border-radius: 999px; object-fit: cover; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); flex-shrink: 0; }
  .team-avatar.placeholder { background: var(--muted-bg); }

  .team-meta { display: flex; flex-direction: column; min-width: 0; }
  /* Ensure team name stays on one line with ellipsis */
  .team-meta .team-name {
    font-weight: 800;
    color: var(--nav-text);
    font-size: 1rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 12.5rem; /* reasonable cap so it truncates early on smaller screens */
  }
  .team-right .team-meta .team-name { max-width: 11rem; }

  .team-sub { font-size: 0.82rem; color: var(--muted); font-weight: 600; margin-top: 0.15rem; }

  .score-pair { display: flex; align-items: center; gap: 0.5rem; margin: 0 0.4rem; width: 130px; justify-content: center; text-align: center; flex-shrink: 0; }
  .score-number { font-weight: 900; font-size: 1.15rem; color: var(--nav-text); }
  .score-label { font-size: 0.72rem; color: var(--muted); font-weight: 700; }
  .score-divider { font-size: 1rem; color: var(--muted); margin: 0 0.3rem; }

  /* Smaller / mobile layout */
  @media (max-width: 900px) {
    .matchups { grid-template-columns: 1fr; }
    .team-avatar { width: 48px; height: 48px; }
    .team-meta .team-name { max-width: 10rem; font-size: 0.98rem; }
    .team-right .team-meta .team-name { max-width: 9rem; }
    .score-pair { width: 110px; }
  }

  @media (max-width: 520px) {
    .wrap { padding: 0 0.75rem; }
    .hero-row { flex-direction: column; align-items: flex-start; gap: 0.6rem; }
    .team-avatar { width: 40px; height: 40px; }
    .team-meta .team-name { max-width: calc(100% - 56px); font-size: 0.95rem; }
    .team-right .team-meta .team-name { max-width: calc(100% - 56px); }
    .score-pair { width: 92px; margin: 0 0.3rem; }
    .btn { padding: 0.5rem 0.85rem; font-size: 0.95rem; }
    .matchup-card { max-width: 100%; padding-left: 0.75rem; padding-right: 0.75rem; }
    .matchups > .matchup-card:last-child { grid-column: 1 / -1; justify-self: center; max-width: 100%; }
  }
</style>
