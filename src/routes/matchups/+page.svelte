<script>
  import { onMount } from 'svelte';

  const CONFIG_PATH = '/week-ranges.json';
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const forcedWeekParam = (urlParams && urlParams.get('week')) ? parseInt(urlParams.get('week'), 10) : null;
  const leagueId = (urlParams && urlParams.get('league')) || import.meta.env.VITE_LEAGUE_ID || '1219816671624048640';

  let loading = true;
  let error = null;
  let matchupPairs = [];
  let rosters = [];
  let users = [];
  let weekRanges = null;
  let fetchWeek = null;

  // IMPORTANT: default the dropdown to week 1 unless the URL provided a week explicitly.
  // This satisfies "default the week dropdown selector to week 1".
  let selectedWeek = forcedWeekParam && !isNaN(forcedWeekParam) ? forcedWeekParam : 1;

  /* -------------------------
     Utility & helper methods (kept consistent with other pages)
     ------------------------- */

  function parseLocalDateYMD(ymd) {
    return new Date(ymd + 'T00:00:00');
  }

  function computeEffectiveWeekFromRanges(ranges) {
    if (forcedWeekParam && !isNaN(forcedWeekParam)) return forcedWeekParam;
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
      if (String(r.roster_id) === String(id) || r.roster_id === id || String(r.rosterId) === String(id)) return r;
    }
    return null;
  }

  function findUserByOwner(ownerId) {
    if (!users) return null;
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      if (String(u.user_id) === String(ownerId) || u.user_id === ownerId || u.id === ownerId) return u;
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
     Lifecycle & fetching
     ------------------------- */

  async function loadForWeek(week) {
    loading = true;
    error = null;
    matchupPairs = [];
    rosters = [];
    users = [];

    try {
      // fetch week ranges if not loaded
      if (!weekRanges) {
        try {
          const cfgRes = await fetch(CONFIG_PATH);
          if (cfgRes.ok) weekRanges = await cfgRes.json();
        } catch (e) {
          // ignore — optional
        }
      }

      // ensure selectedWeek exists
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

  onMount(async () => {
    // If weekRanges exist, we might consider showing a particular week — but user wanted default=1,
    // so only override if URL param provided (handled above).
    // We'll still compute an effectiveWeek for info display where useful, but we leave selectedWeek default = 1.
    try {
      const cfgRes = await fetch(CONFIG_PATH);
      if (cfgRes.ok) {
        weekRanges = await cfgRes.json();
        // if no explicit ?week param, do NOT override selectedWeek; it remains 1 per request.
        if (forcedWeekParam && !isNaN(forcedWeekParam)) {
          selectedWeek = forcedWeekParam;
        }
      }
    } catch (e) {
      // ignore
    }

    await loadForWeek(selectedWeek);
  });

  // watch for dropdown changes
  $: if (selectedWeek) {
    // load only when selectedWeek changes (prevent firing while mounting before initial load)
    // debounce/guard could be added, but keep it simple: run loadForWeek
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
            <option value={w.week}>Week {w.week}{w.start && w.end ? ` — ${w.start}` : ''}</option>
          {/each}
        {:else}
          {#each Array.from({length: 20}, (_, i) => i + 1) as w}
            <option value={w}>Week {w}</option>
          {/each}
        {/if}
      </select>
    </div>
  </section>

  <section class="wrap content">
    <div class="matchups-header">
      <h2>This week's matchups</h2>
      <div class="week-pill">Week {fetchWeek || selectedWeek}
        {#if weekRanges}
          <span class="week-range">{weekDateRangeLabel(fetchWeek || selectedWeek)}</span>
        {/if}
      </div>
    </div>

    {#if loading}
      <div class="notice">Loading matchups for week {selectedWeek}...</div>
    {:else if error}
      <div class="notice error">Error: {error}</div>
    {:else if matchupPairs && matchupPairs.length > 0}
      <div class="matchups">
        {#each matchupPairs as p (p.matchup_id)}
          <article class="matchup-card" role="group" aria-labelledby={"matchup-" + p.matchup_id}>
            <div class="teams">
              <div class="team team-left">
                {#if p.home}
                  {#if findRoster(p.home.roster_id)}
                    <img class="avatar" src={avatarForRoster(findRoster(p.home.roster_id))} alt={displayNameForRoster(findRoster(p.home.roster_id))} on:error={(e)=>e.target.style.visibility='hidden'} />
                    <div class="meta">
                      <div class="name" id={"matchup-" + p.matchup_id} title={displayNameForRoster(findRoster(p.home.roster_id))}>{displayNameForRoster(findRoster(p.home.roster_id))}</div>
                      <div class="sub">{ownerNameForRoster(findRoster(p.home.roster_id)) || ('Roster ' + p.home.roster_id)}</div>
                    </div>
                  {:else}
                    <div class="avatar placeholder"></div>
                    <div class="meta">
                      <div class="name">Roster {p.home.roster_id}</div>
                    </div>
                  {/if}
                {:else}
                  <div class="avatar placeholder"></div>
                  <div class="meta"><div class="name">TBD</div></div>
                {/if}
              </div>

              <div class="vs">vs</div>

              <div class="team team-right">
                {#if p.away}
                  {#if findRoster(p.away.roster_id)}
                    <img class="avatar" src={avatarForRoster(findRoster(p.away.roster_id))} alt={displayNameForRoster(findRoster(p.away.roster_id))} on:error={(e)=>e.target.style.visibility='hidden'} />
                    <div class="meta">
                      <div class="name" title={displayNameForRoster(findRoster(p.away.roster_id))}>{displayNameForRoster(findRoster(p.away.roster_id))}</div>
                      <div class="sub">{ownerNameForRoster(findRoster(p.away.roster_id)) || ('Roster ' + p.away.roster_id)}</div>
                    </div>
                  {:else}
                    <div class="avatar placeholder"></div>
                    <div class="meta">
                      <div class="name">Roster {p.away.roster_id}</div>
                    </div>
                  {/if}
                {:else}
                  <div class="avatar placeholder"></div>
                  <div class="meta"><div class="name">TBD</div></div>
                {/if}
              </div>
            </div>

            <!-- Score block pushed to the far right -->
            <div class="score-block" aria-hidden="true">
              <div class="score">
                <div class="score-num">{fmt(p.home && p.home.points)}</div>
                <div class="score-divider">—</div>
                <div class="score-num">{fmt(p.away && p.away.points)}</div>
              </div>
              <div class="score-label">PTS</div>
            </div>
          </article>
        {/each}
      </div>
    {:else}
      <div class="notice">No matchups found for week {selectedWeek}. Try a different week via the selector.</div>
    {/if}
  </section>
</main>

<style>
  :root {
    --muted: #9fb0c4;
    --bg-card: rgba(255,255,255,0.02);
    --accent: #00c6d8;
    --nav-text: #e6eef6;
  }

  .wrap { max-width: 1100px; margin: 0 auto; padding: 0 1rem; }
  main.matchups-page { padding: 1.25rem 0 3rem; min-height: 100vh; color: var(--nav-text); }

  .header { display:flex; justify-content:space-between; align-items:center; gap:1rem; margin-bottom: 0.6rem; }
  .header-left h1 { margin:0; font-size:1.4rem; }
  .header-left .sub { margin:0; color:var(--muted); font-size:0.95rem; }

  .header-right { display:flex; align-items:center; gap:0.5rem; }
  select { background: var(--bg-card); color: var(--nav-text); border: 1px solid rgba(255,255,255,0.03); padding: 0.5rem 0.6rem; border-radius:8px; font-weight:700; }

  .matchups-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem; gap:1rem; }
  .matchups-header h2 { margin:0; font-size:1.02rem; font-weight:800; }
  .week-pill { background: rgba(255,255,255,0.02); padding:6px 10px; border-radius:999px; font-weight:700; color:var(--nav-text); display:inline-flex; align-items:center; gap:8px; }
  .week-range { color:var(--muted); font-weight:600; font-size:0.86rem; margin-left:6px; }

  .notice { padding:10px 12px; background: rgba(255,255,255,0.01); border-radius:8px; margin-bottom:1rem; color:var(--muted); font-size:0.95rem; text-align:center; }
  .notice.error { background: rgba(255,80,80,0.04); color:#ffb6b6; }

  .matchups { display:flex; flex-direction:column; gap:10px; }

  .matchup-card {
    display:flex;
    align-items:center;
    gap:12px;
    background: var(--bg-card);
    padding:12px;
    border-radius:10px;
    border: 1px solid rgba(255,255,255,0.03);
    width:100%;
    box-sizing:border-box;
    justify-content:space-between; /* push score-block to right */
  }

  .matchup-card:hover { transform: translateY(-3px); }

  .teams { display:flex; align-items:center; gap:12px; min-width:0; flex:1 1 auto; }
  .team { display:flex; align-items:center; gap:10px; min-width:0; }
  .team-left { justify-content:flex-start; }
  .team-right { justify-content:flex-end; flex-direction:row-reverse; text-align:right; }

  .avatar { width:56px; height:56px; border-radius:999px; object-fit:cover; background: rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.03); flex-shrink:0; }
  .avatar.placeholder { background: var(--bg-card); }

  .meta { display:flex; flex-direction:column; min-width:0; }
  .name { font-weight:800; font-size:1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:18rem; }
  .sub { color:var(--muted); font-size:0.88rem; margin-top:4px; }

  .vs { color:var(--muted); font-weight:800; padding:0 0.4rem; }

  /* Score block forced to right */
  .score-block { display:flex; flex-direction:column; align-items:flex-end; min-width:96px; margin-left:12px; flex-shrink:0; }
  .score { display:flex; align-items:center; gap:8px; justify-content:flex-end; }
  .score-num { font-weight:900; font-size:1.12rem; color:var(--nav-text); min-width:36px; text-align:right; }
  .score-divider { color:var(--muted); }
  .score-label { font-size:0.72rem; color:var(--muted); font-weight:700; margin-top:4px; }

  /* Responsive: collapse avatars and keep score readable */
  @media (max-width: 900px) {
    .avatar { width:48px; height:48px; }
    .name { max-width:12rem; font-size:0.98rem; }
    .score-block { min-width:82px; }
  }

  @media (max-width: 560px) {
    .header { flex-direction:column; align-items:flex-start; gap:0.6rem; }
    .teams { gap:8px; }
    .matchup-card { gap:8px; padding:10px; align-items:flex-start; }
    .team-right { text-align:left; flex-direction:row; } /* stack right team under left on very small screens */
    .vs { display:none; }
    .meta .name { white-space:normal; max-width:100%; }
    .score-block { align-self:flex-start; margin-left:0; margin-top:6px; }
  }

  /* accessibility helper */
  .visually-hidden {
    position:absolute !important;
    height:1px; width:1px;
    overflow:hidden;
    clip:rect(1px,1px,1px,1px);
    white-space:nowrap;
    border:0;
    padding:0;
    margin:-1px;
  }
</style>
