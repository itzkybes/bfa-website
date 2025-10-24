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

  // DEFAULT: selector should start at Week 1 unless a ?week= param is provided
  let selectedWeek = (forcedWeek && !isNaN(forcedWeek)) ? forcedWeek : 1;

  function parseLocalDateYMD(ymd) {
    return new Date(ymd + 'T00:00:00');
  }

  function computeEffectiveWeekFromRanges(ranges) {
    if (forcedWeek && !isNaN(forcedWeek)) return forcedWeek;
    if (!Array.isArray(ranges) || ranges.length === 0) return 1;
    const now = new Date();

    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const start = parseLocalDateYMD(r.start);
      const end = parseLocalDateYMD(r.end);
      const endInclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
      if (now >= start && now <= endInclusive) {
        const rotateAt = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0, 0);
        rotateAt.setDate(rotateAt.getDate() + 1); // rotate the week at noon the day after
        if (now >= rotateAt) {
          const next = (i + 1 < ranges.length) ? ranges[i + 1] : null;
          return next ? next.week : r.week;
        } else {
          return r.week;
        }
      }
    }

    // If before first start, return first week
    const first = ranges[0];
    const firstStart = parseLocalDateYMD(first.start);
    if (now < firstStart) return first.week;

    // If after last rotate, return last week
    const last = ranges[ranges.length - 1];
    const lastEnd = parseLocalDateYMD(last.end);
    const lastRotateAt = new Date(lastEnd.getFullYear(), lastEnd.getMonth(), lastEnd.getDate(), 12, 0, 0, 0);
    lastRotateAt.setDate(lastRotateAt.getDate() + 1);
    if (now >= lastRotateAt) return last.week;

    // Otherwise, fallback: find last range that ended and return its week
    for (let j = ranges.length - 1; j >= 0; j--) {
      const rr = ranges[j];
      const rrEnd = parseLocalDateYMD(rr.end);
      const rrEndInclusive = new Date(rrEnd.getFullYear(), rrEnd.getMonth(), rrEnd.getDate(), 23, 59, 59, 999);
      if (now > rrEndInclusive) {
        const rotateAtPast = new Date(rrEnd.getFullYear(), rrEnd.getMonth(), rrEnd.getDate(), 12, 0, 0, 0);
        rotateAtPast.setDate(rotateAtPast.getDate() + 1);
        if (now >= rotateAtPast) {
          const nx = (j + 1 < ranges.length) ? ranges[j + 1] : null;
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

  function normalizeMatchups(raw) {
    const pairs = [];
    if (!raw) return pairs;

    if (Array.isArray(raw)) {
      const map = {};
      for (let i = 0; i < raw.length; i++) {
        const e = raw[i];
        const mid = e.matchup_id != null ? String(e.matchup_id) : null;
        if (mid) {
          if (!map[mid]) map[mid] = [];
          map[mid].push(e);
        } else if (e.opponent_roster_id != null) {
          let attached = false;
          const keys = Object.keys(map);
          for (let k = 0; k < keys.length && !attached; k++) {
            const arr = map[keys[k]];
            for (let j = 0; j < arr.length; j++) {
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

      const mids = Object.keys(map);
      for (let m = 0; m < mids.length; m++) {
        const bucket = map[mids[m]];
        if (bucket.length === 2) {
          pairs.push({ matchup_id: mids[m], home: normalizeEntry(bucket[0]), away: normalizeEntry(bucket[1]) });
        } else if (bucket.length === 1) {
          pairs.push({ matchup_id: mids[m], home: normalizeEntry(bucket[0]), away: null });
        } else if (bucket.length > 2) {
          for (let s = 0; s < bucket.length; s += 2) {
            pairs.push({ matchup_id: mids[m] + '_' + s, home: normalizeEntry(bucket[s]), away: normalizeEntry(bucket[s + 1] || null) });
          }
        }
      }
    } else if (typeof raw === 'object') {
      const arrFromObj = [];
      Object.keys(raw).forEach(k => {
        const v = raw[k];
        if (v && typeof v === 'object') arrFromObj.push(v);
      });
      if (arrFromObj.length > 0) {
        const grouping = {};
        for (let ii = 0; ii < arrFromObj.length; ii++) {
          const ee = arrFromObj[ii];
          const gm = ee.matchup_id != null ? String(ee.matchup_id) : 'p_' + ii;
          if (!grouping[gm]) grouping[gm] = [];
          grouping[gm].push(ee);
        }
        const gkeys = Object.keys(grouping);
        for (let g = 0; g < gkeys.length; g++) {
          const b = grouping[gkeys[g]];
          if (b.length >= 2) {
            for (let z = 0; z < b.length; z += 2) {
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
      const entry = {
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
    for (let i = 0; i < weekRanges.length; i++) {
      if (weekRanges[i] && Number(weekRanges[i].week) === Number(weekNum)) {
        const s = weekRanges[i].start;
        const e = weekRanges[i].end;
        try {
          const sd = new Date(s + 'T00:00:00');
          const ed = new Date(e + 'T00:00:00');
          const opts = { month: 'short', day: 'numeric' };
          const sdStr = sd.toLocaleDateString(undefined, opts);
          const edStr = ed.toLocaleDateString(undefined, opts);
          return sdStr + ' — ' + edStr;
        } catch (err) {
          return s + ' — ' + e;
        }
      }
    }
    return null;
  }

  /* -------------------------
     Lifecycle
     ------------------------- */

  async function loadForWeek(week) {
    loading = true;
    error = null;
    matchupPairs = [];
    rosters = [];
    users = [];

    try {
      const cfgRes = await fetch(CONFIG_PATH);
      if (cfgRes.ok) weekRanges = await cfgRes.json();

      fetchWeek = (week && !isNaN(week)) ? Number(week) : 1;

      const mRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/matchups/' + fetchWeek);
      if (!mRes.ok) throw new Error('matchups fetch failed: ' + mRes.status);
      const matchupsRaw = await mRes.json();

      const rRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/rosters');
      if (rRes.ok) rosters = await rRes.json();

      const uRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/users');
      if (uRes.ok) users = await uRes.json();

      matchupPairs = normalizeMatchups(matchupsRaw);
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    } finally {
      loading = false;
    }
  }

  onMount(async function() {
    loading = true;
    error = null;
    matchupPairs = [];
    rosters = [];
    users = [];

    try {
      // we still fetch week ranges for labels, but we intentionally leave selectedWeek default at 1
      try {
        const cfgRes = await fetch(CONFIG_PATH);
        if (cfgRes.ok) weekRanges = await cfgRes.json();
      } catch (e) {}

      await loadForWeek(selectedWeek);
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    } finally {
      loading = false;
    }
  });

  // reload when user changes the dropdown
  $: if (selectedWeek != null) {
    // call loadForWeek when selectedWeek changes (guard: only after initial mount)
    // small debounce not necessary here
    loadForWeek(selectedWeek);
  }
</script>

<main class="matchups-page">
  <section class="wrap header">
    <div class="header-left">
      <h1>Matchups</h1>
      <p class="sub">Browse head-to-head matchups for your league.</p>
    </div>

    <div class="header-right">
      <label for="week-select" class="visually-hidden">Select week</label>
      <select id="week-select" bind:value={selectedWeek} aria-label="Select week">
        {#if weekRanges && weekRanges.length}
          {#each weekRanges as w}
            <option value={w.week}>Week {w.week}</option>
          {/each}
        {:else}
          {#each Array.from({length: 20}, (_, i) => i + 1) as w}
            <option value={w}>Week {w}</option>
          {/each}
        {/if}
      </select>
    </div>
  </section>

  <section class="wrap matchups-section" aria-labelledby="matchups-heading">
    <div class="matchups-header">
      <h2 id="matchups-heading" class="section-title">This week's matchups</h2>
      <div class="week-pill">
        Week {fetchWeek || selectedWeek}
        {#if weekRanges}
          <span class="week-range-label">{weekDateRangeLabel(fetchWeek || selectedWeek)}</span>
        {/if}
      </div>
    </div>

    {#if loading}
      <div class="notice">Loading matchups for week {selectedWeek || '...' }...</div>
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

            <!-- SCORES (center by default) -->
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
      <div class="notice">No matchups found for week {selectedWeek}. Try a different week via <code>?week=</code>.</div>
    {/if}
  </section>
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
  .matchups-page { padding: 2rem 0 4rem; min-height: 100vh; display: flex; flex-direction: column; gap: 1.25rem; }

  .header { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; padding:0.75rem 0; }
  .header-left { flex:1 1 auto; }
  .header-right { width:160px; }

  .header-left h1 { font-size:1.6rem; margin:0; color:var(--nav-text); }
  .header-left .sub { color:var(--muted); margin:0.25rem 0 0; }

  select { width:100%; padding:0.45rem 0.6rem; border-radius:8px; background:var(--bg-card); color:var(--nav-text); border:1px solid rgba(255,255,255,0.03); font-weight:700; }

  .matchups-section { margin-top:0.6rem; }
  .matchups-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:0.7rem; }
  .section-title{ font-size:1.02rem; color:var(--nav-text); margin:0; font-weight:800; }
  .week-pill{ background:var(--muted-bg); padding:6px 10px; border-radius:999px; font-weight:700; color:var(--nav-text); font-size:0.88rem; display:inline-flex; align-items:center; gap:8px; }
  .week-range-label{ color:var(--muted); font-weight:600; font-size:0.82rem; margin-left:6px; }

  .notice { padding:10px 12px; background: rgba(255,255,255,0.01); border-radius:8px; margin-bottom:1rem; color:var(--muted); font-size:0.95rem; text-align:center; }
  .notice.error { background: rgba(255,80,80,0.04); color:#ffb6b6; }

  .matchups { display:grid; grid-template-columns:1fr; gap:12px; align-items:start; justify-content:center; }
  .matchup-card { display:flex; align-items:center; gap:12px; text-decoration:none; background:var(--bg-card); border-radius:10px; padding:12px; width:100%; border: 1px solid rgba(255,255,255,0.03); box-sizing: border-box; }
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

  /* Scores centered by default */
  .score-pair { display:flex; align-items:center; gap:6px; margin:0 6px; width:130px; justify-content:center; text-align:center; flex-shrink:0; }
  .score-number { font-weight:900; font-size:1.12rem; color:var(--nav-text); }
  .score-label { font-size:0.72rem; color:var(--muted); font-weight:700; }
  .score-divider { font-size:1rem; color:var(--muted); margin:0 6px; }

  /* MOBILE: move score to the right-most side only on mobile */
  @media (max-width: 560px) {
    .matchup-card { align-items:flex-start; gap:8px; }
    /* keep teams stacked naturally, then force score to the right */
    .team-right { flex-direction:row; text-align:left; }
    .score-pair {
      order: 3;
      margin-left: auto;
      width:92px;
      justify-content:flex-end;
      align-self:flex-start;
    }
    .team-left, .team-right { flex: 1 1 100%; }
    .team-name { max-width: 100%; white-space:normal; }
  }

  @media (max-width:900px){
    .team-avatar{ width:48px; height:48px; }
    .score-pair{ width:92px; }
  }

  @media (max-width:520px){
    .wrap{ padding:0 0.75rem; }
    .team-avatar{ width:40px; height:40px; }
  }
</style>
