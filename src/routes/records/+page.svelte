<script>
  // Aggregated Standings page — no season selector, just aggregate all seasonsResults.
  export let data;

  import { onMount } from 'svelte';

  // debug panel state
  let showDebug = true;
  let expanded = false;

  function toggleExpanded() { expanded = !expanded; }
  function dismissDebug() { showDebug = false; }

  // helper
  function avatarOrPlaceholder(url, name) {
    return url || `https://via.placeholder.com/56?text=${encodeURIComponent(name ? name[0] : 'T')}`;
  }

  // raw seasonsResults from server
  $: serverSeasonsResults = (data && data.seasonsResults && Array.isArray(data.seasonsResults)) ? data.seasonsResults : [];

  // optional json links surfaced by server loader (if present)
  $: jsonLinks = (data && Array.isArray(data.jsonLinks)) ? data.jsonLinks : [];

  // client-side derived seasons parsed from JSON files (if any)
  let jsonSeasonsResults = [];

  // Combined list used for aggregation: server results + json-derived results.
  $: seasonsResults = (() => {
    // make shallow copies to avoid mutation issues
    const combined = [];
    if (Array.isArray(serverSeasonsResults)) combined.push(...serverSeasonsResults);
    if (Array.isArray(jsonSeasonsResults)) combined.push(...jsonSeasonsResults);
    return combined;
  })();

  // -------------------------
  // Client-side: if the server didn't return all seasons,
  // try to fetch any season_matchups JSON files provided by the loader.
  // These are expected to be the season_matchups/<year>.json files the server may expose.
  // -------------------------
  onMount(async () => {
    if (!jsonLinks || !jsonLinks.length) return;

    const fetched = [];
    for (const jl of jsonLinks) {
      // jl may be a string or object { url, title }
      const url = (typeof jl === 'string') ? jl : (jl.url || jl);
      if (!url) continue;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          // keep message for debug panel
          continue;
        }
        const obj = await res.json();
        // try to derive season year from filename or object
        // fallback: look for top-level keys like 'season' or filename match
        let seasonYear = null;
        try {
          // attempt parse year from url like '/season_matchups/2022.json'
          const m = String(url).match(/(\d{4})\.json$/);
          if (m) seasonYear = m[1];
        } catch (e) { /* ignore */ }

        // build standings from the raw matchup object
        const built = buildSeasonFromMatchups(obj, seasonYear);
        if (built) {
          // attach source url for debug inspection
          built._sourceUrl = url;
          fetched.push(built);
        }
      } catch (e) {
        // ignore per-file errors — debug panel will still show server messages
      }
    }
    if (fetched.length) {
      jsonSeasonsResults = fetched;
    }
  });

  // ---------- Helper functions to compute standings from season_matchups JSON ----------
  // safe number
  function safeNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  // compute streaks (same as server)
  function computeStreaks(resultsArray) {
    let maxW = 0, maxL = 0, curW = 0, curL = 0;
    if (!resultsArray || !Array.isArray(resultsArray)) return { maxW: 0, maxL: 0 };
    for (let i = 0; i < resultsArray.length; i++) {
      const r = resultsArray[i];
      if (r === 'W') {
        curW += 1; curL = 0; if (curW > maxW) maxW = curW;
      } else if (r === 'L') {
        curL += 1; curW = 0; if (curL > maxL) maxL = curL;
      } else {
        curW = 0; curL = 0;
      }
    }
    return { maxW, maxL };
  }

  // Build season object from the structure shown in your sample season_matchups JSON.
  // Returns an object shaped like server seasonsResults entries:
  // { season: '2022', leagueName: 'Season 2022 (JSON)', regularStandings: [...], playoffStandings: [...] }
  function buildSeasonFromMatchups(matchupsObj, seasonYearHint) {
    if (!matchupsObj || typeof matchupsObj !== 'object') return null;

    // Default playoff start week (matches server fallback)
    const PLAYOFF_START_DEFAULT = 15;
    const playoffStart = PLAYOFF_START_DEFAULT;
    const playoffEnd = playoffStart + 2;

    // We'll keep maps like server code: statsByRosterRegular, resultsByRosterRegular, paByRosterRegular, plus playoff versions
    const statsByRosterRegular = {}, resultsByRosterRegular = {}, paByRosterRegular = {};
    const statsByRosterPlayoff = {}, resultsByRosterPlayoff = {}, paByRosterPlayoff = {};

    // roster metadata map (team name, ownerName, avatar unknown in static JSON)
    const rosterMeta = {};

    // matchupsObj keys are week numbers as strings; iterate numeric weeks ascending
    const weekKeys = Object.keys(matchupsObj || {}).map(w => Number(w)).filter(n => !isNaN(n)).sort((a,b) => a - b);

    for (const week of weekKeys) {
      const entries = matchupsObj[String(week)];
      if (!entries || !entries.length) continue;

      const isRegularWeek = (week >= 1 && week < playoffStart);
      const isPlayoffWeek = (week >= playoffStart && week <= playoffEnd);
      if (!isRegularWeek && !isPlayoffWeek) continue;

      const statsByRoster = isPlayoffWeek ? statsByRosterPlayoff : statsByRosterRegular;
      const resultsByRoster = isPlayoffWeek ? resultsByRosterPlayoff : resultsByRosterRegular;
      const paByRoster = isPlayoffWeek ? paByRosterPlayoff : paByRosterRegular;

      // entries are arrays of matchup objects similar to your sample (teamA, teamB, teamAScore, teamBScore)
      // group by matchup_id to support single participant entries (matchup_id null)
      const byMatch = {};
      for (let mi = 0; mi < entries.length; mi++) {
        const e = entries[mi];
        const mid = (e.matchup_id !== undefined && e.matchup_id !== null) ? String(e.matchup_id) : ('auto|' + mi);
        if (!byMatch[mid]) byMatch[mid] = [];
        byMatch[mid].push(e);
      }

      const mids = Object.keys(byMatch);
      for (const mid of mids) {
        const group = byMatch[mid];
        if (!group || group.length === 0) continue;

        if (group.length === 1) {
          // single participant (no opponent): attribute pf only
          const g = group[0];
          // determine teamA or team (some files may use teamA only)
          const teamA = g.teamA || g.team || null;
          const rid = teamA && (teamA.rosterId ?? teamA.roster_id ?? teamA.id) ? String(teamA.rosterId ?? teamA.roster_id ?? teamA.id) : null;
          const pts = safeNum(g.teamAScore ?? g.teamA?.score ?? g.teamA?.points ?? g.points ?? 0);
          if (!rid) continue;
          paByRoster[rid] = paByRoster[rid] || 0;
          resultsByRoster[rid] = resultsByRoster[rid] || [];
          statsByRoster[rid] = statsByRoster[rid] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
          statsByRoster[rid].pf += pts;

          // store metadata
          if (teamA) rosterMeta[rid] = rosterMeta[rid] || { team_name: teamA.name ?? null, owner_name: teamA.ownerName ?? null, avatar: null };
          continue;
        }

        // Multi-participant: build participants array
        const participants = [];
        for (const en of group) {
          const a = en.teamA || en.team || null;
          const b = en.teamB || null;
          if (a && b) {
            // both present -> two participants covered in same object; push both once
            const ridA = a.rosterId ?? a.roster_id ?? a.id ?? null;
            const ridB = b.rosterId ?? b.roster_id ?? b.id ?? null;
            const ptsA = safeNum(en.teamAScore ?? en.teamA?.score ?? en.teamA?.points ?? 0);
            const ptsB = safeNum(en.teamBScore ?? en.teamB?.score ?? en.teamB?.points ?? 0);

            if (ridA != null) {
              const rA = String(ridA);
              participants.push({ rosterId: rA, points: ptsA });
              rosterMeta[rA] = rosterMeta[rA] || { team_name: a.name ?? null, owner_name: a.ownerName ?? null, avatar: null };
            }
            if (ridB != null) {
              const rB = String(ridB);
              participants.push({ rosterId: rB, points: ptsB });
              rosterMeta[rB] = rosterMeta[rB] || { team_name: b.name ?? null, owner_name: b.ownerName ?? null, avatar: null };
            }
            // if both were pushed, skip further processing for this group
            break;
          } else {
            // handle alternate formats: teamA and teamB as separate objects in array (rare)
            const maybeA = en.teamA ?? en.team;
            if (maybeA) {
              const rid = maybeA.rosterId ?? maybeA.roster_id ?? maybeA.id ?? null;
              const pts = safeNum(en.teamAScore ?? en.points ?? maybeA.points ?? 0);
              if (rid != null) {
                const rS = String(rid);
                participants.push({ rosterId: rS, points: pts });
                rosterMeta[rS] = rosterMeta[rS] || { team_name: maybeA.name ?? null, owner_name: maybeA.ownerName ?? null, avatar: null };
              }
            }
            const maybeB = en.teamB;
            if (maybeB) {
              const rid = maybeB.rosterId ?? maybeB.roster_id ?? maybeB.id ?? null;
              const pts = safeNum(en.teamBScore ?? maybeB.points ?? 0);
              if (rid != null) {
                const rS = String(rid);
                participants.push({ rosterId: rS, points: pts });
                rosterMeta[rS] = rosterMeta[rS] || { team_name: maybeB.name ?? null, owner_name: maybeB.ownerName ?? null, avatar: null };
              }
            }
          }
        }

        // If after attempting to parse we still have no participants, skip
        if (!participants.length) continue;

        // For participants we now update stats and compute W/L/T vs opponent average
        for (const part of participants) {
          const pid = String(part.rosterId);
          paByRoster[pid] = paByRoster[pid] || 0;
          resultsByRoster[pid] = resultsByRoster[pid] || [];
          statsByRoster[pid] = statsByRoster[pid] || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, roster: null };
          statsByRoster[pid].pf += Number(part.points || 0);
        }

        for (let pi = 0; pi < participants.length; pi++) {
          const part = participants[pi];
          const opponents = participants.filter((_, idx) => idx !== pi);
          let oppAvg = 0;
          if (opponents.length) {
            for (const o of opponents) oppAvg += Number(o.points || 0);
            oppAvg = oppAvg / opponents.length;
          }
          paByRoster[part.rosterId] = paByRoster[part.rosterId] || 0;
          paByRoster[part.rosterId] += oppAvg;

          if (part.points > oppAvg + 1e-9) { resultsByRoster[part.rosterId].push('W'); statsByRoster[part.rosterId].wins += 1; }
          else if (part.points < oppAvg - 1e-9) { resultsByRoster[part.rosterId].push('L'); statsByRoster[part.rosterId].losses += 1; }
          else { resultsByRoster[part.rosterId].push('T'); statsByRoster[part.rosterId].ties += 1; }
        }
      } // end by-match loop
    } // end weeks loop

    // Build standings array from maps
    function buildStandings(statsMap, resultsMap, paMap) {
      const out = [];
      const keys = Object.keys(resultsMap);
      if (keys.length === 0) {
        // fallback: use rosterMeta keys
        for (const rk in rosterMeta) keys.push(rk);
      }
      for (const k of keys) {
        const s = statsMap[k] || { wins:0, losses:0, ties:0, pf:0, pa:0, roster: null };
        const pfVal = Math.round((s.pf || 0) * 100) / 100;
        const paVal = Math.round((paMap[k] || s.pa || 0) * 100) / 100;
        const meta = rosterMeta[k] || {};
        const team_name = meta.team_name ?? ('Roster ' + k);
        const owner_name = meta.owner_name ?? null;
        const avatar = meta.avatar ?? null;

        const resArr = resultsMap[k] || [];
        const streaks = computeStreaks(resArr);

        out.push({
          rosterId: k,
          owner_id: null,
          team_name,
          owner_name,
          avatar,
          wins: s.wins || 0,
          losses: s.losses || 0,
          ties: s.ties || 0,
          pf: pfVal,
          pa: paVal,
          champion: false,
          maxWinStreak: streaks.maxW,
          maxLoseStreak: streaks.maxL
        });
      }

      out.sort((a,b) => {
        if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
        return (b.pf || 0) - (a.pf || 0);
      });

      return out;
    }

    const regularStandings = buildStandings(statsByRosterRegular, resultsByRosterRegular, paByRosterRegular);
    const playoffStandings = buildStandings(statsByRosterPlayoff, resultsByRosterPlayoff, paByRosterPlayoff);

    // try to determine season label from hint or object
    let seasonLabel = seasonYearHint || (matchupsObj && matchupsObj.season) || null;
    if (!seasonLabel) {
      // attempt to infer from source keys or first roster metadata values (best-effort)
      seasonLabel = null;
    }

    return {
      leagueId: seasonLabel ? ('json-' + String(seasonLabel)) : ('json-' + Math.random().toString(36).slice(2,8)),
      season: seasonLabel,
      leagueName: seasonLabel ? `Season ${seasonLabel} (JSON)` : 'Season (JSON)',
      regularStandings,
      playoffStandings
    };
  }

  // -------------------------
  // Aggregation across seasons
  // -------------------------
  function aggregateStandingsList(list, map) {
    if (!list || !Array.isArray(list)) return;
    for (const row of list) {
      if (!row) continue;
      // choose a stable key: prefer rosterId, then owner_id, then team_name
      let key = row.rosterId ?? row.roster_id ?? row.owner_id ?? null;
      if (!key) {
        key = (row.team_name ? ('team:' + String(row.team_name).toLowerCase()) : null);
      } else {
        key = String(key);
      }
      if (!key) continue;

      if (!map[key]) {
        map[key] = {
          rosterId: row.rosterId ?? row.roster_id ?? null,
          team_name: row.team_name ?? null,
          owner_name: row.owner_name ?? null,
          avatar: row.avatar ?? null,
          wins: 0,
          losses: 0,
          ties: 0,
          pf: 0,
          pa: 0,
          maxWinStreak: 0,
          maxLoseStreak: 0,
          seasonsCount: 0,
          championCount: 0
        };
      }

      const dest = map[key];
      dest.wins += Number(row.wins || 0);
      dest.losses += Number(row.losses || 0);
      dest.ties += Number(row.ties || 0);
      dest.pf += Number(row.pf || 0);
      dest.pa += Number(row.pa || 0);

      // keep latest display fields if present
      if (row.team_name) dest.team_name = row.team_name;
      if (row.owner_name) dest.owner_name = row.owner_name;
      if (row.avatar) dest.avatar = row.avatar;

      // max streaks (take the maximum observed)
      dest.maxWinStreak = Math.max(dest.maxWinStreak || 0, Number(row.maxWinStreak || 0));
      dest.maxLoseStreak = Math.max(dest.maxLoseStreak || 0, Number(row.maxLoseStreak || 0));

      // champion
      if (row.champion === true) dest.championCount = (dest.championCount || 0) + 1;

      dest.seasonsCount = (dest.seasonsCount || 0) + 1;
    }
  }

  // aggregated regular / playoff maps -> arrays
  $: {
    const regMap = {};
    const poMap = {};
    if (seasonsResults && Array.isArray(seasonsResults)) {
      for (const sr of seasonsResults) {
        // regular standings can be in sr.regularStandings or sr.regular or sr.standings
        const regular = sr.regularStandings ?? sr.regular ?? sr.standings ?? [];
        aggregateStandingsList(regular, regMap);

        // playoff standings: prefer explicit playoffStandings, fallback cautiously
        if (sr.playoffStandings && sr.playoffStandings.length) {
          aggregateStandingsList(sr.playoffStandings, poMap);
        } else if (sr.playoffs && sr.playoffs.length) {
          aggregateStandingsList(sr.playoffs, poMap);
        } else if (!sr.regularStandings && sr.standings && sr.standings.length) {
          // edge-case: treat `standings` as playoff data only if no explicit regularStandings present
          aggregateStandingsList(sr.standings, poMap);
        }
      }
    }

    aggregatedRegular = Object.keys(regMap).map(k => {
      const r = regMap[k];
      r.pf = Math.round((r.pf || 0) * 100) / 100;
      r.pa = Math.round((r.pa || 0) * 100) / 100;
      r.champion = (r.championCount || 0) > 0;
      return r;
    });

    aggregatedPlayoff = Object.keys(poMap).map(k => {
      const r = poMap[k];
      r.pf = Math.round((r.pf || 0) * 100) / 100;
      r.pa = Math.round((r.pa || 0) * 100) / 100;
      r.champion = (r.championCount || 0) > 0;
      return r;
    });

    // sorting: wins desc, then pf desc
    aggregatedRegular.sort((a,b) => {
      const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
      if (wb !== wa) return wb - wa;
      return (b.pf || 0) - (a.pf || 0);
    });

    aggregatedPlayoff.sort((a,b) => {
      const wa = Number(a.wins || 0), wb = Number(b.wins || 0);
      if (wb !== wa) return wb - wa;
      return (b.pf || 0) - (a.pf || 0);
    });
  }

  // reactive arrays to be used inside template
  let aggregatedRegular = [];
  let aggregatedPlayoff = [];
</script>

<style>
  :global(body) {
    --bg: #0b1220;
    --card: #071025;
    --muted: #9ca3af;
    --accent: rgba(99,102,241,0.08);
    --text: #e6eef8;
    color-scheme: dark;
  }

  .page {
    max-width: 1100px;
    margin: 1.5rem auto;
    padding: 0 1rem;
  }

  h1 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
  }

  .debug {
    margin-bottom: 1rem;
    color: var(--muted);
    font-size: 0.95rem;
  }

  .controls-row {
    display:flex;
    justify-content:space-between;
    gap:1rem;
    align-items:center;
    margin: .6rem 0 1rem 0;
  }

  .card {
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
    overflow: hidden;
  }

  .card-header {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:1rem;
    margin-bottom: 0.5rem;
  }

  .section-title {
    font-size:1.05rem;
    font-weight:700;
    margin:0;
  }
  .section-sub {
    color: var(--muted);
    font-size: .9rem;
  }

  /* Table styling etc (unchanged) */
  .table-wrap {
    width:100%;
    overflow:auto;
    -webkit-overflow-scrolling: touch;
    margin-top: .5rem;
  }

  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
    overflow: hidden;
    border-radius: 8px;
    min-width: 740px;
  }

  thead th {
    text-align:left;
    padding: 10px 12px;
    font-size: 0.85rem;
    color: var(--muted);
    background: linear-gradient(180deg, rgba(255,255,255,0.012), rgba(255,255,255,0.004));
    text-transform: uppercase;
    letter-spacing: 0.02em;
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }

  tbody td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    color: #e6eef8;
    vertical-align: middle;
  }

  tbody tr:nth-child(odd) {
    background: rgba(255,255,255,0.005);
  }

  tbody tr:hover {
    background: rgba(99,102,241,0.06);
    transform: translateZ(0);
  }

  .team-row { display:flex; align-items:center; gap:0.75rem; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; background:#111; flex-shrink:0; }
  .team-name { font-weight:700; display:flex; align-items:center; gap:.5rem; }
  .owner { color: var(--muted); font-size:.9rem; margin-top:2px; }

  .col-numeric { text-align:right; white-space:nowrap; font-variant-numeric: tabular-nums; }

  .trophies { margin-left:.4rem; font-size:0.98rem; }
  .small-muted { color: var(--muted); font-size: .88rem; }

  /* JSON links list in debug panel */
  .json-links { margin-top: 0.5rem; display:flex; flex-direction:column; gap:6px; }
  .json-links a { color: #9fb0ff; font-weight:600; text-decoration: none; }
  .json-links a:hover { text-decoration: underline; }

  .rank {
    width:48px;
    text-align:right;
    font-weight:700;
    padding-right:12px;
    color: #e6eef8;
  }

  @media (max-width: 1000px) {
    .tbl { min-width: 720px; }
  }

  @media (max-width: 900px) {
    .avatar { width:44px; height:44px; }
    thead th, tbody td { padding: 8px; }
    .team-name { font-size: .95rem; }
    .table-wrap { overflow:auto; }
  }

  @media (max-width: 520px) {
    .avatar { width:40px; height:40px; }
    thead th, tbody td { padding: 6px 8px; }
    .team-name { font-size: .98rem; }
  }
</style>

<div class="page">
  {#if data?.messages && data.messages.length}
    <div class="debug">
      <strong>Debug</strong>
      <div style="margin-top:.35rem;">
        {#each data.messages as m, i}
          <div>{i + 1}. {m}</div>
        {/each}

        <!-- JSON links -->
        {#if jsonLinks && jsonLinks.length}
          <div style="margin-top:.5rem; font-weight:700; color:inherit">Loaded JSON files (client fetch):</div>
          <div class="json-links" aria-live="polite">
            {#each jsonLinks as jl}
              {#if typeof jl === 'string'}
                <a href={jl} target="_blank" rel="noopener noreferrer">{jl}</a>
              {:else}
                <a href={jl.url} target="_blank" rel="noopener noreferrer">{jl.title ?? jl.url}</a>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <h1>Standings (Aggregated)</h1>

  <div class="controls-row">
    <div class="small-muted">Aggregated seasons: <strong style="color:inherit">{seasonsResults.length}</strong></div>
    <div></div>
  </div>

  <!-- Aggregated Regular Season -->
  <div class="card" aria-labelledby="regular-title" style="margin-bottom:1rem;">
    <div class="card-header">
      <div>
        <div id="regular-title" class="section-title">Regular Season (Aggregated)</div>
        <div class="section-sub">Combined across available seasons</div>
      </div>
      <div class="small-muted">Sorted by Wins → PF</div>
    </div>

    {#if aggregatedRegular && aggregatedRegular.length}
      <div class="table-wrap" role="region" aria-label="Aggregated regular season standings table scrollable">
        <table class="tbl" role="table" aria-label="Aggregated regular season standings">
          <thead>
            <tr>
              <th>#</th>
              <th>Team / Owner</th>
              <th class="col-numeric">W</th>
              <th class="col-numeric">L</th>
              <th class="col-numeric">Longest W-Str</th>
              <th class="col-numeric">Longest L-Str</th>
              <th class="col-numeric">PF</th>
              <th class="col-numeric">PA</th>
            </tr>
          </thead>
          <tbody>
            {#each aggregatedRegular as row, idx}
              <tr>
                <td class="rank">{idx + 1}</td>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                    <div>
                      <div class="team-name">
                        {row.team_name}
                        {#if row.championCount > 0}
                          <span class="trophies" title="Champion seasons"> 🏆×{row.championCount}</span>
                        {/if}
                      </div>
                      {#if row.owner_name}
                        <div class="owner">{row.owner_name} <span class="small-muted">· {row.seasonsCount} seasons</span></div>
                      {/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{row.wins}</td>
                <td class="col-numeric">{row.losses}</td>
                <td class="col-numeric">{row.maxWinStreak ?? (row.maxWinStreak === 0 ? 0 : '')}</td>
                <td class="col-numeric">{row.maxLoseStreak ?? (row.maxLoseStreak === 0 ? 0 : '')}</td>
                <td class="col-numeric">{row.pf}</td>
                <td class="col-numeric">{row.pa}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No regular season results to show.</div>
    {/if}
  </div>

  <!-- Aggregated Playoffs -->
  <div class="card" aria-labelledby="playoff-title">
    <div class="card-header">
      <div>
        <div id="playoff-title" class="section-title">Playoffs (Aggregated)</div>
        <div class="section-sub">Combined playoff window across available seasons</div>
      </div>
      <div class="small-muted">Champion seasons pinned to top where applicable</div>
    </div>

    {#if aggregatedPlayoff && aggregatedPlayoff.length}
      <div class="table-wrap" role="region" aria-label="Aggregated playoff standings table scrollable">
        <table class="tbl" role="table" aria-label="Aggregated playoff standings">
          <thead>
            <tr>
              <th>Team / Owner</th>
              <th class="col-numeric">W</th>
              <th class="col-numeric">L</th>
              <th class="col-numeric">PF</th>
              <th class="col-numeric">PA</th>
            </tr>
          </thead>
          <tbody>
            {#each aggregatedPlayoff as row}
              <tr aria-current={row.champion === true ? 'true' : undefined}>
                <td>
                  <div class="team-row">
                    <img class="avatar" src={avatarOrPlaceholder(row.avatar, row.team_name)} alt={row.team_name} />
                    <div>
                      <div class="team-name">
                        <span>{row.team_name}</span>
                        {#if row.championCount > 0}
                          <span class="trophies" title="Champion seasons">🏆×{row.championCount}</span>
                        {/if}
                      </div>
                      {#if row.owner_name}
                        <div class="owner">{row.owner_name} <span class="small-muted">· {row.seasonsCount} seasons</span></div>
                      {/if}
                    </div>
                  </div>
                </td>
                <td class="col-numeric">{row.wins}</td>
                <td class="col-numeric">{row.losses}</td>
                <td class="col-numeric">{row.pf}</td>
                <td class="col-numeric">{row.pa}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="small-muted" style="padding:.5rem 0;">No playoff results to show.</div>
    {/if}
  </div>
</div>
