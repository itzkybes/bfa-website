<!-- src/routes/matchups/+page.svelte -->
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
  let weekRanges = [];
  let selectedWeek = null;
  let fetchWeek = null;

  /* -------------------------
     Utility & helper methods
     ------------------------- */

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

  // detect if a week-range entry represents playoffs
  function isPlayoffRange(r) {
    if (!r) return false;
    if (r.playoff === true || r.is_playoff === true) return true;
    if (r.type && typeof r.type === 'string' && r.type.toLowerCase().includes('play')) return true;
    if (r.label && typeof r.label === 'string' && r.label.toLowerCase().includes('play')) return true;
    if (r.name && typeof r.name === 'string' && r.name.toLowerCase().includes('play')) return true;
    // fallback: if week is > typical regular season length (e.g., > 20), treat as playoff candidate
    if (typeof r.week === 'number' && r.week > 20) return true;
    return false;
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

  /* -------------------------
     Matchup normalization (same logic used on homepage)
     ------------------------- */
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

  /* -------------------------
     Fetching helpers
     ------------------------- */

  async function fetchAllForWeek(week) {
    loading = true;
    error = null;
    matchupPairs = [];
    try {
      const mRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/matchups/' + week);
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

  function buildWeekOptions(ranges) {
    if (!Array.isArray(ranges)) return { regular: [], playoffs: [] };
    const regular = [];
    const playoffs = [];
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const wk = Number(r.week);
      const label = (r.label || r.name || ('Week ' + wk));
      if (isPlayoffRange(r)) {
        playoffs.push({ week: wk, label });
      } else {
        regular.push({ week: wk, label });
      }
    }
    // sort by week ascending
    regular.sort((a,b) => a.week - b.week);
    playoffs.sort((a,b) => a.week - b.week);
    return { regular, playoffs };
  }

  /* -------------------------
     Lifecycle & interactions
     ------------------------- */

  onMount(async () => {
    loading = true;
    error = null;
    matchupPairs = [];
    rosters = [];
    users = [];
    try {
      const cfgRes = await fetch(CONFIG_PATH);
      if (cfgRes.ok) {
        weekRanges = await cfgRes.json();
      } else {
        weekRanges = [];
      }
    } catch (err) {
      weekRanges = [];
    }

    fetchWeek = computeEffectiveWeekFromRanges(weekRanges || []);
    // default to forcedWeek if present
    selectedWeek = forcedWeek && !isNaN(forcedWeek) ? forcedWeek : fetchWeek;

    // initial fetch
    await fetchAllForWeek(selectedWeek);
  });

  // allow user change week — refetch
  async function onWeekChange(e) {
    const wk = Number(e.target.value);
    if (!wk || isNaN(wk)) return;
    selectedWeek = wk;
    await fetchAllForWeek(selectedWeek);
    // update URL param so linking/bookmarking works
    if (typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      u.searchParams.set('week', String(selectedWeek));
      history.replaceState({}, '', u.toString());
    }
  }
</script>

<main class="matchups-page wrap">
  <header class="matchups-header">
    <div>
      <h1>This week's matchups</h1>
      <div class="muted">Showing matchups for week <strong>{selectedWeek || '?'}</strong>
        {#if weekRanges && weekRanges.length}
          <span class="week-range"> — {weekDateRangeLabel(selectedWeek)}</span>
        {/if}
      </div>
    </div>

    <!-- Week selector with Regular / Playoffs groupings -->
    <div class="week-selector">
      {#if weekRanges && weekRanges.length > 0}
        {#key weekRanges}
          {#await Promise.resolve(buildWeekOptions(weekRanges)) then opts}
            <select aria-label="Select week" on:change={onWeekChange} bind:value={selectedWeek}>
              {#if opts.regular && opts.regular.length}
                <optgroup label="Regular Season">
                  {#each opts.regular as w}
                    <option value={w.week}>{w.label}</option>
                  {/each}
                </optgroup>
              {/if}
              {#if opts.playoffs && opts.playoffs.length}
                <optgroup label="Playoffs">
                  {#each opts.playoffs as w}
                    <option value={w.week}>{w.label}</option>
                  {/each}
                </optgroup>
              {/if}
            </select>
          {/await}
        {/key}
      {:else}
        <!-- fallback: simple numeric input if weekRanges unavailable -->
        <input type="number" min="1" bind:value={selectedWeek} on:change={onWeekChange} />
      {/if}
    </div>
  </header>

  {#if loading}
    <div class="notice">Loading matchups for week {selectedWeek || '...'}...</div>
  {:else if error}
    <div class="notice error">Error fetching matchups: {error}</div>
  {:else if matchupPairs && matchupPairs.length > 0}
    <div class="matchups-grid">
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
    <div class="notice">No matchups found for week {selectedWeek}. Try a different week via the selector.</div>
  {/if}
</main>

<style>
  :root {
    --nav-text: #e6eef6;
    --muted: #9fb0c4;
    --muted-bg: rgba(255,255,255,0.02);
    --accent: #00c6d8;
    --accent-dark: #008fa6;
    --bg-card: rgba(255,255,255,0.02);
  }

  .wrap { max-width: 1100px; margin: 0 auto; padding: 1rem; }
  main.matchups-page { padding: 1.25rem 0 3rem; min-height: 60vh; }

  .matchups-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem; }
  .matchups-header h1 { margin:0; color:var(--nav-text); font-size:1.25rem; font-weight:800; }
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

  /* grid for matchups */
  .matchups-grid {
    display:grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 14px;
  }

  .matchup-card {
    display:flex;
    align-items:center;
    gap:12px;
    text-decoration:none;
    background:var(--bg-card);
    border-radius:10px;
    padding:12px;
    width:100%;
    border: 1px solid rgba(255,255,255,0.03);
    box-sizing:border-box;
  }
  .matchup-card:hover { transform: translateY(-3px); transition: transform 140ms ease; }

  .side { display:flex; align-items:center; gap:12px; min-width:0; flex:1 1 0; }
  .team-left { justify-content:flex-start; }
  .team-right { justify-content:flex-end; flex-direction:row-reverse; text-align:right; }

  .team-avatar { width:56px; height:56px; border-radius:999px; object-fit:cover; background: rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.03); flex-shrink:0; }
  .team-avatar.placeholder { background: var(--muted-bg); }

  .team-meta { display:flex; flex-direction:column; min-width:0; }
  .team-name { font-weight:800; color:var(--nav-text); font-size:1rem; white-space:normal; line-height:1.1; }
  .team-sub { font-size:0.82rem; color:var(--muted); font-weight:600; margin-top:4px; }

  .score-pair { display:flex; align-items:center; gap:6px; margin:0 8px; width:120px; justify-content:center; text-align:center; flex-shrink:0; }
  .score-number { font-weight:900; font-size:1.05rem; color:var(--nav-text); }
  .score-label { font-size:0.74rem; color:var(--muted); font-weight:700; }
  .score-divider { font-size:1rem; color:var(--muted); margin:0 6px; }

  /* responsive tweaks */
  @media (max-width:900px) {
    .matchups-header { flex-direction:column; align-items:flex-start; gap:0.6rem; }
    .team-avatar { width:48px; height:48px; }
    .score-pair { width:100px; }
  }

  @media (max-width:520px) {
    .wrap { padding: 0.6rem; }
    .team-avatar { width:40px; height:40px; }
    .score-pair { width:86px; }
    .team-name { font-size:0.98rem; }
  }
</style>
