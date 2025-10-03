<script>
  // Records page: all-time regular season and playoff standings + extra record tables.
  export let data;

  // Helpers
  function avatarOrPlaceholder(url, name, size = 56) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://via.placeholder.com/${size}?text=${encodeURIComponent(letter)}`;
  }

  function safeNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  // Return string with two decimals for numbers (safe)
  function fmt2(v) {
    return Number(v ?? 0).toFixed(2);
  }

  // Try a bunch of common team avatar fields and fall back to owner avatar
  function teamAvatarFor(row, side = 'team') {
    if (!row || typeof row !== 'object') return null;
    const keys = [
      `${side}_avatar`, `${side}Avatar`, `${side}avatar`, `${side}_team_avatar`, `${side}TeamAvatar`, `${side}AvatarUrl`, `${side}AvatarUrl`,
      'team_avatar', 'teamAvatar', 'avatar', 'latest_avatar'
    ];
    for (const k of keys) {
      if (row[k]) return row[k];
    }
    if (row.owner_avatar) return row.owner_avatar;
    if (row.ownerAvatar) return row.ownerAvatar;
    if (row.owner_avatar_url) return row.owner_avatar_url;
    return null;
  }

  function teamNameFor(row, side = 'team') {
    if (!row || typeof row !== 'object') return '';
    const keys = [`${side}_name`, `${side}Name`, `${side}team`, `${side}_team`, 'team', 'team_name', 'teamName', 'latest_team'];
    for (const k of keys) {
      if (row[k]) return row[k];
    }
    if (row.team) return row.team;
    return '';
  }

  // Player headshot helper
  function playerHeadshot(playerId) {
    if (!playerId) return '';
    return `https://sleepercdn.com/content/nba/players/${playerId}.jpg`;
  }

  // Data sources (from server)
  const regularAllTime = (data && data.regularAllTime) ? data.regularAllTime : [];
  const playoffAllTime = (data && data.playoffAllTime) ? data.playoffAllTime : [];
  const originalRecords = (data && data.originalRecords) ? data.originalRecords : {};

  const topTeamMatchups = (data && data.topTeamMatchups) ? data.topTeamMatchups : [];
  const topPlayerMatchups = (data && data.topPlayerMatchups) ? data.topPlayerMatchups : [];
  const closestMatches = (data && data.closestMatches) ? data.closestMatches : [];
  const largestMargins = (data && data.largestMargins) ? data.largestMargins : [];

  const headToHeadByOwner = (data && data.headToHeadByOwner) ? data.headToHeadByOwner : {};
  const ownersList = (data && data.ownersList) ? data.ownersList : [];
  const playersMap = (data && data.players) ? data.players : {};

  // default selected ownerKey (first in ownersList)
  let selectedOwnerKey = ownersList && ownersList.length ? ownersList[0].ownerKey : null;

  // reactive filtered head-to-head
  $: filteredHeadToHead = (selectedOwnerKey && headToHeadByOwner[selectedOwnerKey]) ? headToHeadByOwner[selectedOwnerKey] : [];

  // UI helpers
  function ownerLabel(o) {
    if (!o) return '';
    return o.team || o.owner_name || o.owner_username || o.ownerKey || '';
  }
</script>

<style>
  :global(body) {
    --bg: transparent; /* keep page background as site default; do not color the whole page */
    --card: #071025;
    --muted: #9ca3af;
    --accent: rgba(99,102,241,0.08);
    color-scheme: dark;
  }

  .page {
    max-width: 1200px;
    margin: 1.25rem auto;
    padding: 0 1rem;
  }

  h1 { margin: 0 0 0.5rem 0; font-size: 1.5rem; }
  .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; align-items:start; }

  .card {
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
    overflow: hidden;
  }

  .card-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom: 0.5rem; }
  .section-title { font-size:1.05rem; font-weight:700; margin:0; }
  .section-sub { color: var(--muted); font-size: .9rem; }

  .tbl { width: 100%; border-collapse: collapse; font-size: 0.95rem; overflow: hidden; border-radius: 8px; }
  thead th { text-align:left; padding: 10px 12px; font-size: 0.85rem; color: var(--muted); background: linear-gradient(180deg, rgba(255,255,255,0.012), rgba(255,255,255,0.004)); text-transform: uppercase; letter-spacing: 0.02em; border-bottom: 1px solid rgba(255,255,255,0.03); }
  tbody td { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.03); color: #e6eef8; vertical-align: middle; }
  tbody tr:nth-child(odd) { background: rgba(255,255,255,0.005); }
  tbody tr:hover { background: rgba(99,102,241,0.06); transform: translateZ(0); }

  .team-row { display:flex; align-items:center; gap:0.75rem; }
  .avatar { width:56px; height:56px; border-radius:10px; object-fit:cover; background:#111; flex-shrink:0; }
  .player-avatar { width:44px; height:44px; border-radius:8px; object-fit:cover; background:#111; flex-shrink:0; }
  .team-name { font-weight:700; display:flex; align-items:center; gap:.5rem; }
  .owner { color: var(--muted); font-size:.9rem; margin-top:2px; }
  .col-numeric { text-align:right; white-space:nowrap; font-variant-numeric: tabular-nums; }
  .small-muted { color: var(--muted); font-size: .88rem; }

  .note { margin-top: 0.6rem; padding: 12px; border-radius: 10px; background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006)); border:1px solid rgba(255,255,255,0.03); color: #cfe2ff; font-size: .95rem; }

  .owner-record { margin-top: .5rem; display:flex; gap: .75rem; align-items:center; }

  .right-card-list { display:flex; flex-direction:column; gap:.75rem; }
  .team-card { display:flex; align-items:center; gap:.75rem; padding:10px; background: rgba(0,0,0,0.25); border-radius:10px; }
  .team-card .meta { display:flex; flex-direction:column; }
  .team-card .season { color: var(--muted); font-size:0.8rem; margin-top:2px; }

  @media (max-width: 1100px) {
    .grid { grid-template-columns: 1fr; }
    .avatar { width:44px; height:44px; }
    thead th, tbody td { padding: 8px; }
    .col-hide-sm { display:none; }
  }

  .select-inline { margin-left:0.5rem; }
  .fallback { color: var(--muted); padding: 12px 0; }
</style>

<div class="page">
  {#if data?.messages && data.messages.length}
    <div class="small-muted" style="margin-bottom:1rem;">
      <strong>Debug</strong>
      <div style="margin-top:.35rem;">
        {#each data.messages as m, i}
          <div>{i + 1}. {m}</div>
        {/each}
      </div>
    </div>
  {/if}

  <h1>All-time Records</h1>

  <div class="grid">
    <!-- LEFT COLUMN -->
    <div>
      <!-- Regular Season -->
      <div class="card" aria-labelledby="regular-title">
        <div class="card-header">
          <div>
            <div id="regular-title" class="section-title">All-time Regular Season</div>
            <div class="section-sub">Aggregated across seasons (weeks 1 → playoff start - 1)</div>
          </div>
          <div class="small-muted">Rows sorted by Wins → PF</div>
        </div>

        {#if regularAllTime && regularAllTime.length}
          <table class="tbl" role="table" aria-label="All-time regular season standings">
            <thead>
              <tr>
                <th>Team / Owner</th>
                <th class="col-numeric">W</th>
                <th class="col-numeric">L</th>
                <th class="col-numeric">Longest W-Str</th>
                <th class="col-numeric">Longest L-Str</th>
                <th class="col-numeric col-hide-sm">PF</th>
                <th class="col-numeric col-hide-sm">PA</th>
              </tr>
            </thead>
            <tbody>
              {#each regularAllTime as row}
                <tr>
                  <td>
                    <div class="team-row">
                      <img class="avatar" src={avatarOrPlaceholder(row.avatar || row.latest_avatar || row.team_avatar, row.team)} alt={row.team} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div>
                        <div class="team-name">{row.team}</div>
                        {#if row.owner_name}
                          <div class="owner">{row.owner_name}</div>
                        {:else if row.owner_username}
                          <div class="owner">{row.owner_username}</div>
                        {/if}
                      </div>
                    </div>
                  </td>
                  <td class="col-numeric">{row.wins}</td>
                  <td class="col-numeric">{row.losses}</td>
                  <td class="col-numeric">{row.maxWinStreak}</td>
                  <td class="col-numeric">{row.maxLoseStreak}</td>
                  <td class="col-numeric col-hide-sm">{fmt2(row.pf)}</td>
                  <td class="col-numeric col-hide-sm">{fmt2(row.pa)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="small-muted" style="padding:.5rem 0;">No regular-season records available.</div>
        {/if}
      </div>

      <!-- Playoffs -->
      <div class="card" aria-labelledby="playoff-title" style="margin-top:1rem;">
        <div class="card-header">
          <div>
            <div id="playoff-title" class="section-title">All-time Playoffs</div>
            <div class="section-sub">Aggregated playoff stats (playoff window only)</div>
          </div>
          <div class="small-muted">Sorted by Championships → Playoff Wins → PF</div>
        </div>

        {#if playoffAllTime && playoffAllTime.length}
          <table class="tbl" role="table" aria-label="All-time playoff standings">
            <thead>
              <tr>
                <th>Team / Owner</th>
                <th class="col-numeric">W</th>
                <th class="col-numeric">L</th>
                <th class="col-numeric col-hide-sm">PF</th>
                <th class="col-numeric col-hide-sm">PA</th>
              </tr>
            </thead>
            <tbody>
              {#each playoffAllTime as row}
                <tr>
                  <td>
                    <div class="team-row">
                      <img class="avatar" src={avatarOrPlaceholder(row.avatar || row.latest_avatar || row.team_avatar, row.team)} alt={row.team} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div>
                        <div class="team-name">
                          <span>{row.team}</span>
                          {#if row.championships && row.championships > 0}
                            <span style="margin-left:.4rem">{'🏆'.repeat(row.championships)}</span>
                          {/if}
                        </div>
                        {#if row.owner_name}
                          <div class="owner">{row.owner_name}</div>
                        {:else if row.owner_username}
                          <div class="owner">{row.owner_username}</div>
                        {/if}
                      </div>
                    </div>
                  </td>

                  <td class="col-numeric">{row.playoffWins}</td>
                  <td class="col-numeric">{row.playoffLosses}</td>
                  <td class="col-numeric col-hide-sm">{fmt2(row.pf)}</td>
                  <td class="col-numeric col-hide-sm">{fmt2(row.pa)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="small-muted" style="padding:.5rem 0;">No playoff records available.</div>
        {/if}
      </div>

      <!-- Head-to-Head Records (bottom of left column) -->
      <div class="card" style="margin-top:1rem;">
        <div class="card-header">
          <div>
            <div class="section-title">Head-to-Head Records</div>
            <div class="section-sub">Pick a team to view its record vs every opponent</div>
          </div>
          <div class="small-muted">
            Show:
            <select class="select-inline" bind:value={selectedOwnerKey} aria-label="Select team to view head-to-head">
              {#each ownersList as o}
                <option value={o.ownerKey}>{ownerLabel(o)}</option>
              {/each}
            </select>
          </div>
        </div>

        {#if selectedOwnerKey && filteredHeadToHead && filteredHeadToHead.length}
          <table class="tbl" role="table" aria-label="Head to Head records">
            <thead>
              <tr>
                <th>Opponent</th>
                <th class="col-numeric">Reg Record</th>
                <th class="col-numeric">Reg GP</th>
                <th class="col-numeric">Play Record</th>
                <th class="col-numeric">Play GP</th>
                <th class="col-numeric col-hide-sm">PF</th>
                <th class="col-numeric col-hide-sm">PA</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredHeadToHead as hh}
                <tr>
                  <td>
                    <div class="team-row">
                      <img class="avatar" src={avatarOrPlaceholder(teamAvatarFor(hh,'opponent') || hh.opponent_avatar, hh.opponent_name)} alt={hh.opponent_name} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div>
                        <div class="team-name">{hh.opponent_name}</div>
                      </div>
                    </div>
                  </td>

                  <td class="col-numeric">{(hh.regWins ?? 0)} - {(hh.regLosses ?? 0)}</td>
                  <td class="col-numeric">{(hh.regGP ?? ( (hh.regWins||0) + (hh.regLosses||0) ))}</td>

                  <td class="col-numeric">{(hh.playWins ?? 0)} - {(hh.playLosses ?? 0)}</td>
                  <td class="col-numeric">{(hh.playGP ?? ( (hh.playWins||0) + (hh.playLosses||0) ))}</td>

                  <td class="col-numeric col-hide-sm">{fmt2(hh.regPF ?? 0)}</td>
                  <td class="col-numeric col-hide-sm">{fmt2(hh.regPA ?? 0)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="fallback">
            No head-to-head records found for the selected team. If you expect data, double-check the server <code>headToHeadByOwner</code> payload or try selecting a different team.
          </div>
        {/if}
      </div>

      <!-- Ownership note -->
      <div class="card" style="margin-top:1rem;">
        <div class="section-title">Ownership note</div>
        <div class="section-sub" style="margin-bottom:.6rem;">Lineage and preserved records (original owners before merging into canonical owners)</div>

        <details class="note" aria-label="Canonicalization lineage">
          <summary>Canonical owner mapping</summary>

          <div style="margin-top:.6rem; color:#dbeafe;">
            <div>We canonicalize Bellooshio &amp; cholybevv into <strong>jakepratt</strong> for combined stats shown in the all-time tables.</div>

            {#if originalRecords.bellooshio}
              <div class="owner-record" style="margin-top:.6rem;">
                <img class="avatar" src={avatarOrPlaceholder(originalRecords.bellooshio.avatar, originalRecords.bellooshio.team)} alt="Bellooshio avatar" on:error={(e)=>e.target.style.visibility='hidden'} />
                <div>
                  <div style="font-weight:700">Bellooshio</div>
                  <div class="small-muted">
                    {#if originalRecords.bellooshio.team}Team: {originalRecords.bellooshio.team}{' • '}{/if}
                    Regular: <strong>{originalRecords.bellooshio.regWins}</strong>-<strong>{originalRecords.bellooshio.regLosses}</strong> (PF {fmt2(originalRecords.bellooshio.regPF)}, PA {fmt2(originalRecords.bellooshio.regPA)})<br/>
                    Playoffs: <strong>{originalRecords.bellooshio.playoffWins}</strong>-<strong>{originalRecords.bellooshio.playoffLosses}</strong> (PF {fmt2(originalRecords.bellooshio.playoffPF)}, PA {fmt2(originalRecords.bellooshio.playoffPA)})<br/>
                    Championships: <strong>{originalRecords.bellooshio.championships}</strong>
                  </div>
                </div>
              </div>
            {:else}
              <div class="small-muted" style="margin-top:.6rem;">No preserved record found for Bellooshio.</div>
            {/if}

            {#if originalRecords.cholybevv}
              <div class="owner-record" style="margin-top:.6rem;">
                <img class="avatar" src={avatarOrPlaceholder(originalRecords.cholybevv.avatar, originalRecords.cholybevv.team)} alt="cholybevv avatar" on:error={(e)=>e.target.style.visibility='hidden'} />
                <div>
                  <div style="font-weight:700">cholybevv</div>
                  <div class="small-muted">
                    {#if originalRecords.cholybevv.team}Team: {originalRecords.cholybevv.team}{' • '}{/if}
                    Regular: <strong>{originalRecords.cholybevv.regWins}</strong>-<strong>{originalRecords.cholybevv.regLosses}</strong> (PF {fmt2(originalRecords.cholybevv.regPF)}, PA {fmt2(originalRecords.cholybevv.regPA)})<br/>
                    Playoffs: <strong>{originalRecords.cholybevv.playoffWins}</strong>-<strong>{originalRecords.cholybevv.playoffLosses}</strong> (PF {fmt2(originalRecords.cholybevv.playoffPF)}, PA {fmt2(originalRecords.cholybevv.playoffPA)})<br/>
                    Championships: <strong>{originalRecords.cholybevv.championships}</strong>
                  </div>
                </div>
              </div>
            {:else}
              <div class="small-muted" style="margin-top:.6rem;">No preserved record found for cholybevv.</div>
            {/if}
          </div>
        </details>
      </div>
    </div>

    <!-- RIGHT COLUMN -->
    <div>
      <!-- Top team single-matchup -->
      <div class="card" aria-labelledby="top-team-title">
        <div class="card-header">
          <div>
            <div id="top-team-title" class="section-title">Top 10 Single-Matchup Team Scores (All-time)</div>
            <div class="section-sub">Highest scoring team performances in one matchup</div>
          </div>
          <div class="small-muted">Sorted by Winning Score</div>
        </div>

        {#if topTeamMatchups && topTeamMatchups.length}
          <table class="tbl" role="table" aria-label="Top single-matchup team scores">
            <thead>
              <tr>
                <th>Team</th>
                <th>Opponent</th>
                <th class="col-numeric">Scoring</th>
                <th class="col-numeric col-hide-sm">Season</th>
                <th class="col-numeric col-hide-sm">Week</th>
              </tr>
            </thead>
            <tbody>
              {#each topTeamMatchups as row}
                <tr>
                  <td>
                    <div class="team-row">
                      <img class="avatar" src={avatarOrPlaceholder(teamAvatarFor(row,'team') || row.team_avatar || row.teamAvatar, teamNameFor(row,'team'))} alt={teamNameFor(row,'team')} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div>
                        <div class="team-name">{teamNameFor(row,'team')}</div>
                        <div class="small-muted">{row.team_rosterId ? '' : ''}</div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <div class="team-row">
                      <img class="avatar" src={avatarOrPlaceholder(teamAvatarFor(row,'opponent') || row.opponent_avatar || row.opponentAvatar, teamNameFor(row,'opponent'))} alt={teamNameFor(row,'opponent')} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div>
                        <div class="team-name">{teamNameFor(row,'opponent')}</div>
                      </div>
                    </div>
                  </td>

                  <td class="col-numeric">{fmt2(row.winning_score ?? row.team_score ?? row.points ?? row.score ?? 0)} - {fmt2(row.losing_score ?? row.opponent_score ?? row.opp_points ?? 0)}</td>
                  <td class="col-numeric col-hide-sm">{row.season ?? ''}</td>
                  <td class="col-numeric col-hide-sm">{row.week ?? ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="small-muted" style="padding:.5rem 0;">No team single-matchup records available.</div>
        {/if}
      </div>

      <!-- Top player single-matchup -->
      <div class="card" aria-labelledby="top-player-title" style="margin-top:1rem;">
        <div class="card-header">
          <div>
            <div id="top-player-title" class="section-title">Top 10 Single-Matchup Player Scores (All-time)</div>
            <div class="section-sub">Highest scoring player performances in a single matchup</div>
          </div>
          <div class="small-muted">Sorted by Points</div>
        </div>

        {#if topPlayerMatchups && topPlayerMatchups.length}
          <table class="tbl" role="table" aria-label="Top single-matchup player scores">
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th class="col-numeric">Scoring</th>
                <th class="col-numeric col-hide-sm">Season</th>
                <th class="col-numeric col-hide-sm">Week</th>
              </tr>
            </thead>
            <tbody>
              {#each topPlayerMatchups as p}
                <tr>
                  <td>
                    <div class="team-row">
                      <img class="player-avatar" src={playerHeadshot(p.player_id || p.playerId || p.player)} alt={p.player_name || p.playerName || p.player || 'Player'} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div>
                        <div class="team-name">{p.player_name || p.playerName || p.player || 'Unknown'}</div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <div class="team-row">
                      <img class="avatar" src={avatarOrPlaceholder(teamAvatarFor(p,'team') || p.team_avatar || p.teamAvatar, p.team_name || p.team)} alt={p.team_name || p.team} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div>
                        <div class="team-name">{p.team_name || p.team}</div>
                      </div>
                    </div>
                  </td>

                  <td class="col-numeric">{fmt2(p.points ?? p.player_points ?? p.score ?? 0)}</td>
                  <td class="col-numeric col-hide-sm">{p.season ?? ''}</td>
                  <td class="col-numeric col-hide-sm">{p.week ?? ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="small-muted" style="padding:.5rem 0;">No player single-matchup records available.</div>
        {/if}
      </div>

      <!-- Closest matches -->
      <div class="card" aria-labelledby="closest-title" style="margin-top:1rem;">
        <div class="card-header">
          <div>
            <div id="closest-title" class="section-title">Top 10 Closest Matches (All-time)</div>
            <div class="section-sub">Smallest margin victories (ties excluded)</div>
          </div>
          <div class="small-muted">Sorted by Margin (ascending)</div>
        </div>

        {#if closestMatches && closestMatches.length}
          <table class="tbl" role="table" aria-label="Closest matches">
            <thead>
              <tr>
                <th>Team</th>
                <th>Opponent</th>
                <th class="col-numeric">Margin</th>
                <th class="col-numeric">Scoring</th>
                <th class="col-numeric col-hide-sm">Season</th>
                <th class="col-numeric col-hide-sm">Week</th>
              </tr>
            </thead>
            <tbody>
              {#each closestMatches as row}
                <tr>
                  <td>
                    <div class="team-row">
                      <img class="avatar" src={avatarOrPlaceholder(teamAvatarFor(row,'team') || row.team_avatar || row.teamAvatar, teamNameFor(row,'team'))} alt={teamNameFor(row,'team')} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div>
                        <div class="team-name">{teamNameFor(row,'team')}</div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <div class="team-row">
                      <img class="avatar" src={avatarOrPlaceholder(teamAvatarFor(row,'opponent') || row.opponent_avatar || row.opponentAvatar, teamNameFor(row,'opponent'))} alt={teamNameFor(row,'opponent')} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div>
                        <div class="team-name">{teamNameFor(row,'opponent')}</div>
                      </div>
                    </div>
                  </td>

                  <td class="col-numeric">{fmt2(Math.abs(safeNum(row.margin ?? row.team_score ?? 0) - safeNum(row.opponent_score ?? row.opp_points ?? 0)))}</td>
                  <td class="col-numeric">{fmt2(row.winning_score ?? 0)} - {fmt2(row.losing_score ?? 0)}</td>
                  <td class="col-numeric col-hide-sm">{row.season ?? ''}</td>
                  <td class="col-numeric col-hide-sm">{row.week ?? ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="small-muted" style="padding:.5rem 0;">No closest match records available.</div>
        {/if}
      </div>

      <!-- Largest margins -->
      <div class="card" aria-labelledby="largest-title" style="margin-top:1rem;">
        <div class="card-header">
          <div>
            <div id="largest-title" class="section-title">Top 10 Largest Margins (All-time)</div>
            <div class="section-sub">Largest margin of victory across seasons</div>
          </div>
          <div class="small-muted">Sorted by Margin (descending)</div>
        </div>

        {#if largestMargins && largestMargins.length}
          <table class="tbl" role="table" aria-label="Largest margin matches">
            <thead>
              <tr>
                <th>Team</th>
                <th>Opponent</th>
                <th class="col-numeric">Margin</th>
                <th class="col-numeric">Scoring</th>
                <th class="col-numeric col-hide-sm">Season</th>
                <th class="col-numeric col-hide-sm">Week</th>
              </tr>
            </thead>
            <tbody>
              {#each largestMargins as row}
                <tr>
                  <td>
                    <div class="team-row">
                      <img class="avatar" src={avatarOrPlaceholder(teamAvatarFor(row,'team') || row.team_avatar || row.teamAvatar, teamNameFor(row,'team'))} alt={teamNameFor(row,'team')} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div>
                        <div class="team-name">{teamNameFor(row,'team')}</div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <div class="team-row">
                      <img class="avatar" src={avatarOrPlaceholder(teamAvatarFor(row,'opponent') || row.opponent_avatar || row.opponentAvatar, teamNameFor(row,'opponent'))} alt={teamNameFor(row,'opponent')} on:error={(e)=>e.target.style.visibility='hidden'} />
                      <div>
                        <div class="team-name">{teamNameFor(row,'opponent')}</div>
                      </div>
                    </div>
                  </td>

                  <td class="col-numeric">{fmt2(row.margin ?? 0)}</td>
                  <td class="col-numeric">{fmt2(row.winning_score ?? 0)} - {fmt2(row.losing_score ?? 0)}</td>
                  <td class="col-numeric col-hide-sm">{row.season ?? ''}</td>
                  <td class="col-numeric col-hide-sm">{row.week ?? ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="small-muted" style="padding:.5rem 0;">No large-margin records available.</div>
        {/if}
      </div>
    </div>
  </div>
</div>
