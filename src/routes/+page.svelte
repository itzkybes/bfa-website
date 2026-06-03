<!-- src/routes/+page.svelte — Home: hero + Rando Player spotlight + current-week matchups -->
<script>
  import { onMount } from 'svelte';
  import { fetchWithCache } from '$lib/cache';
  import {
    getSeasonsChain, BASE_LEAGUE_ID,
    pickActiveLeague, getCurrentWeekForLeague, getRecentTrades,
    getPlayersNba, getRosterMapWithOwners, playerHeadshot
  } from '$lib/sleeperClient.client';
  import { fmt1 as fmt } from '$lib/format';
  import SkeletonLoader from '$lib/SkeletonLoader.svelte';
  import ErrorBoundary from '$lib/ErrorBoundary.svelte';

  const CONFIG_PATH = '/week-ranges.json';
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const forcedWeek = (urlParams && urlParams.get('week')) ? parseInt(urlParams.get('week'), 10) : null;
  // URL override > env override > resolved-at-runtime "live" league
  // (resolved inside loadData via pickActiveLeague). Falls back to BASE_LEAGUE_ID.
  const leagueOverride = (urlParams && urlParams.get('league')) || import.meta.env.VITE_LEAGUE_ID || null;
  let leagueId = leagueOverride || BASE_LEAGUE_ID;
  let seasonLabel = '';
  let leagueStatus = null;          // 'in_season' | 'complete' | 'pre_draft' | ...
  let recentTrades = [];            // [{ ...transaction, _week, _teamA, _teamB }]
  let tradesLoading = true;
  let playersMap = {};
  let rosterMap = {};               // for trade ledger team names + avatars

  const CACHE_5_MIN = 5 * 60 * 1000;
  const CACHE_10_MIN = 10 * 60 * 1000;

  let loading = true;
  let error = null;
  let matchupPairs = [];
  let rosters = [];
  let users = [];
  let weekRanges = null;
  let fetchWeek = null;
  let potw = null;

  function parseYMD(ymd) { return new Date(ymd + 'T00:00:00'); }

  function computeEffectiveWeek(ranges) {
    if (forcedWeek && !isNaN(forcedWeek)) return forcedWeek;
    if (!Array.isArray(ranges) || ranges.length === 0) return 1;
    const now = new Date();
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const start = parseYMD(r.start);
      const end = parseYMD(r.end);
      const endInclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
      if (now >= start && now <= endInclusive) {
        const rotateAt = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0, 0);
        rotateAt.setDate(rotateAt.getDate() + 1);
        if (now >= rotateAt) {
          const next = (i + 1 < ranges.length) ? ranges[i + 1] : null;
          return next ? next.week : r.week;
        }
        return r.week;
      }
    }
    if (now < parseYMD(ranges[0].start)) return ranges[0].week;
    return ranges[ranges.length - 1].week;
  }

  function findRoster(id) {
    if (!rosters || !id) return null;
    return rosters.find((r) => String(r.roster_id) === String(id)) || null;
  }

  function findUserByOwner(ownerId) {
    if (!users || !ownerId) return null;
    return users.find((u) => String(u.user_id) === String(ownerId)) || null;
  }

  function avatarForRoster(roster) {
    if (!roster) return null;
    const md = roster.metadata || {};
    const settings = roster.settings || {};
    let candidate = md.team_avatar || md.avatar || settings.team_avatar || settings.avatar;
    if (!candidate) {
      const u = findUserByOwner(roster.owner_id);
      if (u) candidate = (u.metadata && u.metadata.avatar) || u.avatar;
    }
    if (!candidate) return null;
    if (String(candidate).startsWith('http')) return candidate;
    return 'https://sleepercdn.com/avatars/' + encodeURIComponent(String(candidate));
  }

  function displayNameForRoster(roster) {
    if (!roster) return 'Roster';
    const md = roster.metadata || {};
    const settings = roster.settings || {};
    const candidates = [
      md.team_name, md.teamName, md.team, md.name,
      settings.team_name, settings.teamName, settings.team, settings.name
    ];
    for (const c of candidates) if (c && String(c).trim()) return String(c).trim();
    const u = findUserByOwner(roster.owner_id);
    if (u) {
      if (u.metadata && u.metadata.team_name) return u.metadata.team_name;
      if (u.display_name) return u.display_name;
      if (u.username) return u.username;
    }
    return 'Roster ' + roster.roster_id;
  }

  function ownerNameForRoster(roster) {
    if (!roster) return null;
    const u = findUserByOwner(roster.owner_id);
    if (!u) return null;
    return u.display_name || u.username || (u.metadata && u.metadata.team_name) || null;
  }

  function normalizeMatchups(raw) {
    const pairs = [];
    if (!raw) return pairs;
    if (Array.isArray(raw)) {
      const map = {};
      for (let i = 0; i < raw.length; i++) {
        const e = raw[i];
        const mid = e.matchup_id != null ? String(e.matchup_id) : 'p_' + i;
        if (!map[mid]) map[mid] = [];
        map[mid].push(e);
      }
      for (const mid of Object.keys(map)) {
        const bucket = map[mid];
        if (bucket.length === 2) pairs.push({ matchup_id: mid, home: normalizeEntry(bucket[0]), away: normalizeEntry(bucket[1]) });
        else if (bucket.length === 1) pairs.push({ matchup_id: mid, home: normalizeEntry(bucket[0]), away: null });
      }
    }
    return pairs;

    function normalizeEntry(e) {
      if (!e) return null;
      return {
        roster_id: e.roster_id ?? null,
        points: e.points ?? e.points_for ?? e.starters_points ?? null,
        matchup_id: e.matchup_id ?? null
      };
    }
  }

  function weekDateRange(weekNum) {
    if (!Array.isArray(weekRanges)) return null;
    const found = weekRanges.find((r) => Number(r.week) === Number(weekNum));
    if (!found) return null;
    try {
      const opts = { month: 'short', day: 'numeric' };
      const sd = new Date(found.start + 'T00:00:00').toLocaleDateString(undefined, opts);
      const ed = new Date(found.end + 'T00:00:00').toLocaleDateString(undefined, opts);
      return sd + ' — ' + ed;
    } catch (_) {
      return found.start + ' — ' + found.end;
    }
  }

  function getHeadshot(playerId) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  function prettyNameFromId(id) {
    if (!id) return '';
    let s = String(id).replace(/[_-]+/g, ' ').replace(/\d+/g, '').trim();
    if (!s) return id;
    return s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  function getPlayerName(info, id) {
    if (!info) return prettyNameFromId(id);
    if (info.full_name) return info.full_name;
    if (info.first_name || info.last_name) return `${info.first_name ?? ''} ${info.last_name ?? ''}`.trim();
    return prettyNameFromId(id);
  }

  function chooseRandom(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  async function pickRandoPlayer() {
    potw = null;
    try {
      const candidates = (rosters || []).filter((r) => Array.isArray(r.players) && r.players.length > 0);
      if (!candidates.length) return;
      const r = chooseRandom(candidates);
      const pid = chooseRandom(r.players);
      if (!pid) return;
      let playerInfo = null;
      try {
        const res = await fetch('https://api.sleeper.app/v1/players/nba');
        if (res.ok) {
          const map = await res.json();
          playerInfo = map[pid] || null;
        }
      } catch (_) { /* noop */ }
      if (!playerInfo) playerInfo = { player_id: pid, full_name: prettyNameFromId(pid) || ('Player ' + pid), team: '', position: '' };
      potw = {
        playerId: pid,
        playerInfo,
        roster: r,
        rosterName: displayNameForRoster(r),
        ownerName: ownerNameForRoster(r)
      };
    } catch (e) {
      console.warn('rando player error', e);
    }
  }

  async function loadData() {
    loading = true;
    error = null;
    try {
      // Resolve which league_id is "live" — newest in_season league preferred,
      // else newest complete league, else newest overall. This makes the home
      // page Always Show Real Data, even when the upcoming season hasn't drafted
      // yet (in which case we show last year's championship week + trades).
      if (!leagueOverride) {
        try {
          const { seasons } = await getSeasonsChain(BASE_LEAGUE_ID);
          const active = pickActiveLeague(seasons);
          if (active?.league_id) leagueId = String(active.league_id);
          if (active?.season) seasonLabel = String(active.season);
          leagueStatus = active?.status || null;
        } catch (_) { /* keep fallback leagueId */ }
      }

      // Find the current/most-recent week with real scoring data. For an
      // in_season league this is "this week"; for a complete league it's the
      // championship week. We skip the static week-ranges.json calendar
      // approach because it lags whenever the season schedule shifts.
      const cfgRes = await fetch(CONFIG_PATH).catch(() => null);
      weekRanges = cfgRes && cfgRes.ok ? await cfgRes.json() : null;

      if (forcedWeek && !isNaN(forcedWeek)) {
        fetchWeek = forcedWeek;
      } else {
        const detected = await getCurrentWeekForLeague(leagueId).catch(() => null);
        if (detected?.week) {
          fetchWeek = detected.week;
        } else {
          // Last resort — use the static date-range calendar.
          fetchWeek = computeEffectiveWeek(weekRanges || []);
        }
      }

      const [matchupsRaw, _rosters, _users] = await Promise.all([
        fetchWithCache(`https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/matchups/${fetchWeek}`, {}, CACHE_5_MIN),
        fetchWithCache(`https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/rosters`, {}, CACHE_10_MIN),
        fetchWithCache(`https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/users`, {}, CACHE_10_MIN)
      ]);
      rosters = _rosters;
      users = _users;
      matchupPairs = normalizeMatchups(matchupsRaw);
      await pickRandoPlayer();

      // Trade ledger loads in the background (independent of matchups). We don't
      // block the page on it — it gets its own loading state.
      loadTradeLedger().catch((e) => console.warn('[Home] trade ledger failed', e));
    } catch (err) {
      error = err;
      console.error('[Home] load error:', err);
    } finally {
      loading = false;
    }
  }

  /**
   * Fetch the most recent ~10 completed trades from the live league and
   * enrich each one with team metadata + player names so the UI can render
   * them without any extra lookups.
   */
  async function loadTradeLedger() {
    tradesLoading = true;
    try {
      const [trades, rmap, pmap] = await Promise.all([
        getRecentTrades(leagueId, { weekFrom: 1, weekTo: 25, limit: 10 }),
        getRosterMapWithOwners(leagueId).catch(() => ({})),
        getPlayersNba().catch(() => ({}))
      ]);
      rosterMap = rmap;
      playersMap = pmap;
      recentTrades = trades.map((t) => enrichTrade(t, rmap, pmap));
    } finally {
      tradesLoading = false;
    }
  }

  /** Turn one raw Sleeper transaction into the per-roster summary the UI shows. */
  function enrichTrade(t, rmap, pmap) {
    const sides = {}; // rosterId -> { meta, adds[], drops[], picks[], cash }
    const ridList = (t.roster_ids || []).map(String);
    for (const rid of ridList) {
      sides[rid] = {
        rosterId: rid,
        meta: rmap[rid] || { team_name: `Roster ${rid}`, owner_name: null, team_avatar: null },
        adds: [],
        drops: [],
        picks: [],
        cash: 0
      };
    }
    for (const [pid, rid] of Object.entries(t.adds || {})) {
      const s = sides[String(rid)];
      if (!s) continue;
      const p = pmap[pid];
      s.adds.push({
        pid,
        name: p?.full_name || `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || `Player ${pid}`,
        team: p?.team || '',
        position: (p?.fantasy_positions && p.fantasy_positions[0]) || p?.position || ''
      });
    }
    for (const dp of (t.draft_picks || [])) {
      const s = sides[String(dp.owner_id)];
      if (!s) continue;
      s.picks.push({ season: dp.season, round: dp.round, from: dp.previous_owner_id });
    }
    for (const wb of (t.waiver_budget || [])) {
      const s = sides[String(wb.receiver)];
      if (!s) continue;
      s.cash += Number(wb.amount) || 0;
    }
    const sideArr = ridList.map((rid) => sides[rid]);
    const tsMs = Number(t.status_updated) || 0;
    return {
      id: String(t.transaction_id || t.created || `${t._week}-${ridList.join('-')}`),
      week: t._week,
      timestamp: tsMs,
      sides: sideArr
    };
  }

  function relativeTime(ms) {
    if (!ms) return '';
    const now = Date.now();
    const diff = Math.max(0, now - ms);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  onMount(loadData);
</script>

<section class="hero" data-testid="hero-section">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="hero-grid-overlay" aria-hidden="true"></div>

  <div class="wrap hero-inner">
    <div class="hero-copy rise">
      <div class="eyebrow">{seasonLabel ? `Season ${Number(seasonLabel) - 1} / ${String(seasonLabel).slice(-2)} · Live` : 'Live'}</div>
      <h1 class="hero-title">
        Welcome to the<br />
        <span class="title-accent">Badger Bowl</span>
      </h1>
      <p class="hero-sub">
        Track rosters, standings, matchups, and league records. Real-time data straight from Sleeper —
        no fluff, just the cold hard buckets.
      </p>
      <div class="hero-actions">
        <a class="btn primary" href="/rosters" data-testid="hero-cta-rosters">View Rosters →</a>
        <a class="btn" href="/standings" data-testid="hero-cta-standings">See Standings</a>
      </div>
    </div>

    <aside class="rando rise" aria-label="Rando Player spotlight" data-testid="rando-card">
      <div class="rando-label">
        <span class="rando-dot"></span>
        Rando Player
      </div>

      {#if potw}
        <div class="rando-body">
          {#if potw.playerInfo.player_id}
            <img
              class="rando-headshot"
              src={getHeadshot(potw.playerInfo.player_id)}
              alt={getPlayerName(potw.playerInfo, potw.playerId)}
              on:error={(e) => (e.currentTarget.style.opacity = '0')}
              loading="lazy"
              data-testid="rando-headshot"
            />
          {:else}
            <div class="rando-headshot placeholder">🏀</div>
          {/if}

          <div class="rando-info">
            <div class="rando-name" title={getPlayerName(potw.playerInfo, potw.playerId)} data-testid="rando-name">
              {getPlayerName(potw.playerInfo, potw.playerId)}
            </div>
            <div class="rando-meta">
              {#if potw.playerInfo.position}<span class="meta-tag">{potw.playerInfo.position}</span>{/if}
              {#if potw.playerInfo.team}<span class="meta-sep">·</span><span>{potw.playerInfo.team}</span>{/if}
            </div>
            <div class="rando-owner" title={potw.rosterName}>
              {potw.rosterName}
              {#if potw.ownerName}<span class="meta-sep">·</span><span>{potw.ownerName}</span>{/if}
            </div>
          </div>
        </div>

        <div class="rando-actions">
          <a class="btn sm" href={`/rosters?owner=${potw.roster.roster_id ?? ''}`} data-testid="rando-view-roster">Roster</a>
          <button class="btn sm primary" on:click={pickRandoPlayer} data-testid="rando-shuffle" aria-label="Shuffle">
            ⟲ Shuffle
          </button>
        </div>
      {:else if loading}
        <div class="rando-body">
          <div class="shimmer rando-headshot" style="opacity:0.5"></div>
          <div style="flex:1;">
            <div class="shimmer" style="height:18px; width:60%; margin-bottom:8px;"></div>
            <div class="shimmer" style="height:12px; width:40%;"></div>
          </div>
        </div>
      {:else}
        <div class="rando-empty">No player available.</div>
      {/if}
    </aside>
  </div>
</section>

<section class="wrap matchups-section" aria-labelledby="matchups-h">
  <div class="section-head">
    <div>
      <div class="eyebrow">
        {#if leagueStatus === 'complete'}Final · Championship Week
        {:else if leagueStatus === 'in_season'}This Week
        {:else}Latest{/if}
      </div>
      <h2 id="matchups-h" class="section-title">Matchups</h2>
    </div>
    <div class="week-pill" data-testid="current-week-pill">
      <span class="week-num">W{fetchWeek || '?'}</span>
      {#if seasonLabel}<span class="week-range">'{String(seasonLabel).slice(-2)} Season</span>{/if}
    </div>
  </div>

  {#if loading}
    <SkeletonLoader variant="matchup" count={5} />
  {:else if error}
    <ErrorBoundary {error} onRetry={loadData} context="matchups" />
  {:else if matchupPairs && matchupPairs.length}
    <div class="matchups-grid" data-testid="matchups-grid">
      {#each matchupPairs as p, idx}
        <a
          class="matchup-card rise"
          style="animation-delay: {idx * 50}ms;"
          href={`/rosters?owner=${p.home && p.home.roster_id ? p.home.roster_id : ''}`}
          data-testid={`matchup-card-${idx}`}
        >
          <div class="m-side m-left">
            {#if p.home && findRoster(p.home.roster_id)}
              {@const r = findRoster(p.home.roster_id)}
              {#if avatarForRoster(r)}
                <img class="m-avatar" src={avatarForRoster(r)} alt={displayNameForRoster(r)} loading="lazy" />
              {:else}
                <div class="m-avatar placeholder"></div>
              {/if}
              <div class="m-meta">
                <div class="m-name">{displayNameForRoster(r)}</div>
                <div class="m-owner">{ownerNameForRoster(r) || ''}</div>
              </div>
            {:else}
              <div class="m-avatar placeholder"></div>
              <div class="m-meta"><div class="m-name">TBD</div></div>
            {/if}
          </div>

          <div class="m-score">
            <span class="score-num" class:winner={p.home && p.away && Number(p.home.points) > Number(p.away.points)}>{fmt(p.home && p.home.points)}</span>
            <span class="score-vs">vs</span>
            <span class="score-num" class:winner={p.home && p.away && Number(p.away.points) > Number(p.home.points)}>{fmt(p.away && p.away.points)}</span>
          </div>

          <div class="m-side m-right">
            {#if p.away && findRoster(p.away.roster_id)}
              {@const r = findRoster(p.away.roster_id)}
              <div class="m-meta right">
                <div class="m-name">{displayNameForRoster(r)}</div>
                <div class="m-owner">{ownerNameForRoster(r) || ''}</div>
              </div>
              {#if avatarForRoster(r)}
                <img class="m-avatar" src={avatarForRoster(r)} alt={displayNameForRoster(r)} loading="lazy" />
              {:else}
                <div class="m-avatar placeholder"></div>
              {/if}
            {:else}
              <div class="m-meta right"><div class="m-name">TBD</div></div>
              <div class="m-avatar placeholder"></div>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {:else}
    <div class="empty-card" data-testid="matchups-empty">
      No matchups found for week {fetchWeek}. Try a different week via <code>?week=N</code>.
    </div>
  {/if}
</section>

<!--
  Trade Ledger — most recent completed trades pulled from Sleeper's
  /transactions/{week} endpoint, aggregated across every week of the live
  league. Independent loading state so the matchups grid above isn't gated
  on the slower multi-week transactions roll-up.
-->
<section class="wrap trades-section" aria-labelledby="trades-h" data-testid="trade-ledger">
  <div class="section-head">
    <div>
      <div class="eyebrow">League Activity</div>
      <h2 id="trades-h" class="section-title">Recent Trades</h2>
    </div>
    {#if !tradesLoading && recentTrades.length}
      <div class="trades-count">{recentTrades.length} most recent</div>
    {/if}
  </div>

  {#if tradesLoading}
    <SkeletonLoader variant="row" count={3} />
  {:else if !recentTrades.length}
    <div class="empty-card" data-testid="trades-empty">No completed trades on the books yet.</div>
  {:else}
    <div class="trades-list" data-testid="trades-list">
      {#each recentTrades as t (t.id)}
        <article class="trade-card rise" data-testid={`trade-${t.id}`}>
          <header class="trade-head">
            <span class="trade-week">Wk {t.week}</span>
            <span class="trade-when">{relativeTime(t.timestamp)}</span>
          </header>
          <div class="trade-sides">
            {#each t.sides as side, i (side.rosterId)}
              <div class="trade-side">
                <div class="trade-team">
                  <img
                    class="trade-avatar"
                    src={side.meta.team_avatar || side.meta.owner_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((side.meta.team_name || 'T')[0])}&background=1a1a1e&color=a1a1aa&size=48&format=svg`}
                    alt={side.meta.team_name}
                    on:error={(e) => (e.currentTarget.style.visibility = 'hidden')}
                  />
                  <div class="trade-team-meta">
                    {#if side.meta.owner_username}
                      <a class="trade-team-name" href={`/team/${encodeURIComponent(side.meta.owner_username)}`}>{side.meta.team_name}</a>
                    {:else}
                      <div class="trade-team-name">{side.meta.team_name}</div>
                    {/if}
                    {#if side.meta.owner_name}<div class="trade-owner">{side.meta.owner_name}</div>{/if}
                  </div>
                </div>
                <div class="trade-gets">
                  <div class="gets-label">Receives</div>
                  {#if side.adds.length || side.picks.length || side.cash > 0}
                    {#each side.adds as a (a.pid)}
                      <div class="trade-player">
                        <img class="trade-player-headshot" src={playerHeadshot(a.pid)} alt={a.name} on:error={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                        <div class="trade-player-info">
                          <div class="trade-player-name">{a.name}</div>
                          <div class="trade-player-meta">{a.position}{a.team ? ` · ${a.team}` : ''}</div>
                        </div>
                      </div>
                    {/each}
                    {#each side.picks as pk (`${pk.season}-${pk.round}-${pk.from}`)}
                      <div class="trade-pick">{pk.season} Round {pk.round} Pick</div>
                    {/each}
                    {#if side.cash > 0}<div class="trade-cash">+${side.cash} FAAB</div>{/if}
                  {:else}
                    <div class="trade-empty">—</div>
                  {/if}
                </div>
              </div>
              {#if i < t.sides.length - 1}<div class="trade-swap" aria-hidden="true">⇄</div>{/if}
            {/each}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  /* ----- HERO ----- */
  .hero {
    position: relative;
    overflow: hidden;
    border-bottom: 1px solid var(--border-subtle);
    padding-top: 4rem;
    padding-bottom: 4rem;
  }

  .hero-bg {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(800px 400px at 80% 30%, rgba(255, 69, 0, 0.18), transparent 70%),
      radial-gradient(600px 500px at 10% 90%, rgba(255, 69, 0, 0.08), transparent 70%);
    z-index: 0;
  }

  .hero-grid-overlay {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.5), transparent 80%);
    -webkit-mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.5), transparent 80%);
    z-index: 0;
  }

  .hero-inner {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 3rem;
    align-items: center;
  }

  .hero-copy { max-width: 640px; }

  .eyebrow {
    margin-bottom: 1.2rem;
  }

  .hero-title {
    font-family: var(--font-display);
    font-size: clamp(3rem, 7vw, 6rem);
    line-height: 0.9;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin-bottom: 1.25rem;
  }

  .title-accent {
    color: var(--brand);
    display: inline-block;
    position: relative;
  }

  .title-accent::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -8px;
    height: 4px;
    background: var(--accent);
  }

  .hero-sub {
    font-size: 1.05rem;
    color: var(--text-secondary);
    margin-bottom: 1.75rem;
    max-width: 52ch;
    line-height: 1.6;
  }

  .hero-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  /* ----- RANDO ----- */
  .rando {
    position: relative;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--accent);
    padding: 1.5rem;
    border-radius: var(--r-sm);
  }

  .rando-label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-body);
    font-weight: 800;
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.2em;
    color: var(--accent);
    margin-bottom: 1.25rem;
  }

  .rando-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .rando-body {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .rando-headshot {
    width: 100px;
    height: 100px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    flex-shrink: 0;
    border: 1px solid var(--border-subtle);
  }

  .rando-headshot.placeholder {
    display: grid;
    place-items: center;
    font-size: 2.5rem;
  }

  .rando-info { min-width: 0; flex: 1; }

  .rando-name {
    font-family: var(--font-display);
    font-size: 1.6rem;
    line-height: 1;
    letter-spacing: 0.03em;
    color: var(--text-primary);
    text-transform: uppercase;
    margin-bottom: 0.4rem;
    word-break: break-word;
  }

  .rando-meta {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-bottom: 0.4rem;
    font-weight: 500;
  }

  .meta-tag {
    display: inline-block;
    background: var(--accent);
    color: #fff;
    padding: 0.1rem 0.45rem;
    border-radius: var(--r-sm);
    font-weight: 800;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
  }

  .meta-sep { opacity: 0.5; }

  .rando-owner {
    font-size: 0.85rem;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rando-actions {
    margin-top: 1.25rem;
    display: flex;
    gap: 0.5rem;
  }

  .rando-empty {
    color: var(--text-secondary);
    padding: 2rem 0;
    text-align: center;
  }

  /* ----- MATCHUPS ----- */
  .matchups-section {
    padding-top: 3rem;
  }

  .section-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .section-title {
    font-family: var(--font-display);
    font-size: clamp(2rem, 4vw, 3rem);
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin-top: 0.4rem;
  }

  .week-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.55rem 0.9rem;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    font-size: 0.85rem;
  }

  .week-num {
    font-family: var(--font-display);
    font-size: 1.1rem;
    color: var(--accent);
    letter-spacing: 0.05em;
  }

  .week-range {
    color: var(--text-secondary);
    font-weight: 500;
    font-size: 0.8rem;
  }

  .matchups-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
    gap: 0.85rem;
  }

  .matchup-card {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.1rem;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    text-decoration: none;
    transition: border-color var(--t-fast), transform var(--t-fast), background var(--t-fast);
    cursor: pointer;
  }

  .matchup-card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
    background: var(--surface-2);
  }

  .m-side {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .m-right {
    justify-content: flex-end;
  }

  .m-avatar {
    width: 48px;
    height: 48px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    flex-shrink: 0;
    border: 1px solid var(--border-subtle);
  }

  .m-avatar.placeholder { background: var(--surface-2); }

  .m-meta { min-width: 0; }
  .m-meta.right { text-align: right; }

  .m-name {
    font-family: var(--font-body);
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--text-primary);
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .m-owner {
    color: var(--text-tertiary);
    font-size: 0.78rem;
    margin-top: 0.15rem;
  }

  .m-score {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
  }

  .score-num {
    font-family: var(--font-display);
    font-size: 1.6rem;
    line-height: 1;
    letter-spacing: 0.03em;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .score-num.winner { color: var(--win); }

  .score-vs {
    font-family: var(--font-body);
    font-weight: 800;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--text-tertiary);
    margin: 0.1rem 0;
  }

  .empty-card {
    padding: 2rem;
    text-align: center;
    background: var(--surface-1);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-sm);
    color: var(--text-secondary);
  }

  .empty-card code {
    color: var(--accent);
    background: var(--surface-2);
    padding: 0.15rem 0.4rem;
    border-radius: var(--r-sm);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }

  /* ----- TRADE LEDGER ----- */
  .trades-section { padding-top: 2rem; padding-bottom: 3rem; }
  .trades-count { color: var(--text-tertiary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700; }
  .trades-list { display: grid; grid-template-columns: 1fr; gap: 0.85rem; }
  .trade-card {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 1.1rem 1.25rem;
    transition: border-color var(--t-fast);
  }
  .trade-card:hover { border-color: var(--border-strong); }
  .trade-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.9rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border-subtle);
  }
  .trade-week {
    font-family: var(--font-body);
    font-weight: 800;
    font-size: 0.72rem;
    letter-spacing: 0.18em;
    color: var(--brand);
    text-transform: uppercase;
  }
  .trade-when { color: var(--text-tertiary); font-size: 0.78rem; }

  .trade-sides {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 1rem;
    align-items: stretch;
  }
  .trade-side { display: flex; flex-direction: column; gap: 0.7rem; min-width: 0; }
  .trade-team { display: flex; align-items: center; gap: 0.65rem; }
  .trade-avatar {
    width: 40px; height: 40px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .trade-team-name {
    font-family: var(--font-display);
    font-size: 1.05rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-primary);
    text-decoration: none;
    line-height: 1.1;
  }
  a.trade-team-name:hover { color: var(--accent); }
  .trade-owner { color: var(--text-tertiary); font-size: 0.72rem; margin-top: 0.15rem; }
  .gets-label {
    font-family: var(--font-body);
    font-weight: 800;
    font-size: 0.62rem;
    letter-spacing: 0.18em;
    color: var(--text-tertiary);
    text-transform: uppercase;
    margin-bottom: 0.3rem;
  }
  .trade-gets {
    background: var(--surface-2);
    border-radius: var(--r-sm);
    padding: 0.65rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    flex: 1;
  }
  .trade-player { display: flex; align-items: center; gap: 0.6rem; }
  .trade-player-headshot {
    width: 32px; height: 32px;
    border-radius: 50%;
    object-fit: cover;
    background: var(--surface-1);
    flex-shrink: 0;
  }
  .trade-player-info { min-width: 0; line-height: 1.15; }
  .trade-player-name { font-weight: 700; color: var(--text-primary); font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trade-player-meta { color: var(--text-tertiary); font-size: 0.7rem; }
  .trade-pick { color: var(--brand); font-weight: 700; font-size: 0.82rem; }
  .trade-cash { color: var(--accent); font-weight: 700; font-size: 0.82rem; }
  .trade-empty { color: var(--text-tertiary); font-size: 0.85rem; padding: 0.5rem 0; }
  .trade-swap {
    align-self: center;
    font-size: 1.5rem;
    color: var(--accent);
    padding: 0 0.25rem;
  }

  /* Score flipped layout for compact matchup: switch to row on small screens */
  @media (max-width: 980px) {
    .hero-inner { grid-template-columns: 1fr; gap: 2rem; }
    .rando { max-width: 100%; }
  }

  @media (max-width: 720px) {
    .hero { padding: 2.5rem 0 3rem; }
    .matchups-grid { grid-template-columns: 1fr; gap: 0.75rem; }
    .matchup-card { grid-template-columns: 1fr 1fr; padding: 0.9rem 1rem; }
    .m-score { grid-column: 1 / -1; flex-direction: row; gap: 0.75rem; justify-content: center; padding-top: 0.5rem; border-top: 1px solid var(--border-subtle); }
    .score-num { font-size: 1.3rem; }
    .m-avatar { width: 40px; height: 40px; }
    .trade-sides { grid-template-columns: 1fr; }
    .trade-swap { transform: rotate(90deg); justify-self: center; padding: 0.25rem 0; }
    .trade-card { padding: 0.9rem 0.95rem; }
    .trade-team-name { font-size: 0.95rem; }
    .trade-avatar { width: 36px; height: 36px; }
    .trade-player-headshot { width: 28px; height: 28px; }
    .trade-player-name { font-size: 0.82rem; }
    .trade-player-meta { font-size: 0.65rem; }
    /* Buttons stack full-width on phones so they never overflow the viewport */
    .hero-actions { flex-direction: column; align-items: stretch; gap: 0.6rem; }
    .hero-actions :global(.btn) { width: 100%; }
    .hero-sub { font-size: 0.95rem; }
    .section-head { flex-direction: column; align-items: flex-start; gap: 0.75rem; }
    .rando { padding: 1.1rem; }
    .rando-headshot { width: 80px; height: 80px; }
    .rando-name { font-size: 1.35rem; }
  }

  @media (max-width: 480px) {
    .hero-title { font-size: clamp(2.2rem, 10vw, 3rem); }
    .hero-sub { font-size: 0.9rem; }
  }
</style>
