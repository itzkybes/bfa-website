<script>
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  const matchupsRows = data?.matchupsRows ?? [];
  const messages = data?.messages ?? [];
  const originalRecords = data?.originalRecords ?? {};

  // Final standings arrays you supplied (owner display_name values)
  const FINAL_STANDINGS = {
    "2024": [
      "riguy506","smallvt","JakePratt","Kybes","TLupinetti","samsilverman12","armyjunior",
      "JFK4312","WebbWarrior","slawflesh","jewishhorsemen","noahlap01","zamt","WillMichael"
    ],
    "2023": [
      "armyjunior","jewishhorsemen","Kybes","riguy506","zamt","slawflesh","JFK4312","smallvt",
      "samsilverman12","WebbWarrior","TLupinetti","noahlap01","JakePratt","WillMichael"
    ],
    "2022": [
      "riguy506","smallvt","jewishhorsemen","zamt","noahlap01","Kybes","armyjunior","slawflesh",
      "WillMichael","JFK4312","WebbWarrior","TLupinetti","JakePratt","samsilverman12"
    ]
  };

  // normalize string helper
  function norm(s) {
    return (s || '').toString().trim().toLowerCase();
  }

  // attempt to find placement using a few heuristics
  function findPlacementForName(name, season) {
    if (!name) return null;
    const list = FINAL_STANDINGS[String(season)] ?? null;
    if (!list) return null;

    const target = norm(name);

    // exact match
    for (let i = 0; i < list.length; i++) {
      if (norm(list[i]) === target) return i + 1;
    }

    // relaxed: substring match (owner name inside team display)
    for (let i = 0; i < list.length; i++) {
      const candidate = norm(list[i]);
      if (candidate && target.includes(candidate)) return i + 1;
      if (candidate && candidate.includes(target)) return i + 1;
    }

    // try split tokens
    const tokens = target.split(/[\s._-]+/).filter(Boolean);
    if (tokens.length) {
      for (let i = 0; i < list.length; i++) {
        const candidate = norm(list[i]);
        for (const t of tokens) {
          if (candidate.includes(t)) return i + 1;
        }
      }
    }

    return null;
  }

  // return label and optional winnerPosition (number) for consolation
  // Uses placements first; if placements missing, falls back to week-based inference
  function getLabelAndWinnerPosition(row, maxWeekForSeason) {
    if (!row) return { label: 'Match', winnerPosition: null };
    if (row.participantsCount === 1) return { label: 'Bye', winnerPosition: null };

    // Use season from row if available; otherwise fallback to selectedSeason
    const season = row.season ?? selectedSeason;

    const aNames = [row.teamA?.name, row.teamA?.ownerName, row.teamA?.displayName].filter(Boolean);
    const bNames = [row.teamB?.name, row.teamB?.ownerName, row.teamB?.displayName].filter(Boolean);

    let aPlacement = null;
    for (const nm of aNames) {
      aPlacement = findPlacementForName(nm, season);
      if (aPlacement) break;
    }
    if (!aPlacement && row.teamA?.rosterId) {
      aPlacement = findPlacementForName(String(row.teamA.rosterId), season);
    }

    let bPlacement = null;
    for (const nm of bNames) {
      bPlacement = findPlacementForName(nm, season);
      if (bPlacement) break;
    }
    if (!bPlacement && row.teamB?.rosterId) {
      bPlacement = findPlacementForName(String(row.teamB.rosterId), season);
    }

    // If at least one placement exists, prefer placement-based labeling
    if (aPlacement || bPlacement) {
      const maxPlacement = Math.max(aPlacement || 999, bPlacement || 999);

      if (maxPlacement <= 2) return { label: 'Championship', winnerPosition: null };
      if (maxPlacement <= 4) return { label: 'Semi Finals', winnerPosition: null };
      if (maxPlacement <= 8) return { label: 'Quarter Finals', winnerPosition: null };

      // Consolation match: compute winner position (better placement = smaller number)
      const winnerPos = Math.min(aPlacement || Infinity, bPlacement || Infinity);
      return { label: 'Consolation match', winnerPosition: Number.isFinite(winnerPos) ? winnerPos : null };
    }

    // --- Fallback: use week-based inference when placements unavailable ---
    const wk = Number(row.week ?? 0);
    if (maxWeekForSeason && wk > 0) {
      if (wk === maxWeekForSeason) return { label: 'Championship', winnerPosition: null };
      if (wk === maxWeekForSeason - 1) return { label: 'Semi Finals', winnerPosition: null };
      if (wk === maxWeekForSeason - 2) return { label: 'Quarter Finals', winnerPosition: null };
      return { label: 'Consolation match', winnerPosition: null }; // can't infer winner position without placements
    }

    // final fallback
    return { label: 'Match', winnerPosition: null };
  }

  function ordinal(n) {
    if (n == null) return 'TBD';
    const s = ["th","st","nd","rd"];
    const v = n % 100;
    return n + (s[(v-20)%10] || s[v] || s[0]);
  }

  // Determine winnersSize per season rule you specified
  function winnersSizeForSeason(season) {
    if (String(season) === '2022') return 6;
    return 8;
  }

  function avatarOrPlaceholder(url, name, size = 40) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0D1B2A&color=fff&size=${size}`;
  }

  function fmt2(n) {
    const x = Number(n);
    if (isNaN(x)) return '0.0';
    return x.toFixed(1);
  }

  // Create filteredRows (by selectedSeason)
  $: filteredRows = Array.isArray(matchupsRows) && selectedSeason
    ? matchupsRows.filter(r => String(r.season ?? '') === String(selectedSeason))
    : matchupsRows.slice();

  // compute maxWeek present for the selected season (used for week-based labeling fallback)
  $: {
    const weeksPresent = (filteredRows || []).map(r => Number(r.week ?? 0)).filter(v => Number.isFinite(v) && v > 0);
    maxWeekForSeason = weeksPresent.length ? Math.max(...weeksPresent) : null;
  }
  let maxWeekForSeason = null;

  // compute label and winnerPosition for each row
  const LABEL_ORDER = {
    'Championship': 0,
    'Semi Finals': 1,
    'Quarter Finals': 2,
    'Consolation match': 3,
    'Bye': 4,
    'Match': 5
  };

  $: labeledRows = filteredRows.map(r => {
    const info = getLabelAndWinnerPosition(r, maxWeekForSeason);
    return { ...r, _label: info.label, _winnerPosition: info.winnerPosition ?? null };
  });

  // A helper to determine bracket membership (winners/losers/unassigned)
  function bracketForRow(row) {
    if (!row) return 'unassigned';
    // winnersSize depends on season
    const season = row.season ?? selectedSeason;
    const winnersSize = winnersSizeForSeason(season);

    // find placements for both teams (reuse previous heuristics)
    const aNames = [row.teamA?.name, row.teamA?.ownerName, row.teamA?.displayName].filter(Boolean);
    const bNames = [row.teamB?.name, row.teamB?.ownerName, row.teamB?.displayName].filter(Boolean);

    let aPlacement = null;
    for (const nm of aNames) {
      aPlacement = findPlacementForName(nm, season);
      if (aPlacement) break;
    }
    if (!aPlacement && row.teamA?.rosterId) aPlacement = findPlacementForName(String(row.teamA.rosterId), season);

    let bPlacement = null;
    for (const nm of bNames) {
      bPlacement = findPlacementForName(nm, season);
      if (bPlacement) break;
    }
    if (!bPlacement && row.teamB?.rosterId) bPlacement = findPlacementForName(String(row.teamB.rosterId), season);

    // If both placements known:
    if (aPlacement && bPlacement) {
      const aIsWinner = aPlacement <= winnersSize;
      const bIsWinner = bPlacement <= winnersSize;
      if (aIsWinner && bIsWinner) return 'winners';
      if (!aIsWinner && !bIsWinner) return 'losers';
      // mixed case: prefer winners bracket if one of them is in winners seeds
      if (aIsWinner || bIsWinner) return 'winners';
    }

    // If only one side has placement:
    if (aPlacement && !bPlacement) return (aPlacement <= winnersSize) ? 'winners' : 'losers';
    if (bPlacement && !aPlacement) return (bPlacement <= winnersSize) ? 'winners' : 'losers';

    // If neither placement available, use label inference: championship/semi/quarter => winners, else losers
    const label = row._label ?? null;
    if (label === 'Championship' || label === 'Semi Finals' || label === 'Quarter Finals') return 'winners';
    if (label === 'Consolation match' || label === 'Bye' || label === 'Match') return 'losers';

    return 'unassigned';
  }

  // split rows into winners / losers / unassigned and sort within bracket
  $: {
    winnersRows = [];
    losersRows = [];
    unassignedRows = [];

    // pre-sort labeledRows by label order and tie-breakers (week/points)
    const preSorted = labeledRows.slice().sort((a,b) => {
      const la = LABEL_ORDER[a._label] ?? 99;
      const lb = LABEL_ORDER[b._label] ?? 99;
      if (la !== lb) return la - lb;
      // tie-breaker: teamA.points desc, then week desc
      const ap = Number(a.teamA?.points ?? 0), bp = Number(b.teamA?.points ?? 0);
      if (ap !== bp) return bp - ap;
      const aw = Number(a.week ?? 0), bw = Number(b.week ?? 0);
      return bw - aw;
    });

    for (const r of preSorted) {
      const b = bracketForRow(r);
      if (b === 'winners') winnersRows.push(r);
      else if (b === 'losers') losersRows.push(r);
      else unassignedRows.push(r);
    }
  }

  // helpers
  function submitFilters(e) {
    const form = e.currentTarget.form || document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }
</script>

<style>
  :global(body) { background: #0b0c0f; color: #e6eef8; }

  .page { padding: 1.2rem 1.6rem; max-width: 1100px; margin: 0 auto; }

  h1 { margin-bottom: 0.4rem; }

  form { margin-bottom: 1rem; }

  .season-label {
    font-weight: 700;
    margin-right: 0.5rem;
    color: #e6eef8;
  }

  .season-select {
    font-size: 1.05rem;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.15);
    background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
    color: #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  }

  .messages {
    margin-bottom: 1rem;
    color: #cbd5e1;
    background: rgba(255,255,255,0.02);
    padding: 10px;
    border-radius: 8px;
  }

  .brackets { display:flex; flex-direction:column; gap:18px; }

  .bracket { background: rgba(255,255,255,0.02); padding:12px; border-radius:10px; }
  .bracketTitle { font-weight:800; color:#e6eef8; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; }

  table { width:100%; border-collapse: collapse; margin-top: 8px; }
  th, td { padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  th { text-align: left; font-weight: 700; color:#9ca3af; }
  td { vertical-align: middle; }

  .team { display:flex; align-items:center; gap:.6rem; }
  .team-name { font-weight: 600; }
  .avatar { width:40px; height:40px; border-radius:6px; object-fit:cover; }
  .score { font-weight:600; text-align:center; }
  .winner { color:#fff; background: rgba(99,102,241,0.25); padding:4px 6px; border-radius:6px; }
  .bye { color:#9ca3af; font-style:italic; }

  .label-badge {
    display:inline-block;
    padding:6px 10px;
    border-radius:999px;
    font-weight:700;
    font-size:0.85rem;
    color:#0b1220;
  }
  .lbl-champ { background: #FFD166; }       /* Championship (goldish) */
  .lbl-semi { background: #9EC6FF; }        /* Semi (blue) */
  .lbl-quarter { background: #7FD3A8; }     /* Quarter (green) */
  .lbl-consol { background: #9CA3AF; }      /* Consolation (muted) */
  .lbl-match { background: #6B7280; }       /* generic */
  .lbl-bye { background: #334155; color: #cbd5e1; }
</style>

<div class="page">
  <h1>Honor Hall</h1>

  <form id="filters" method="get" style="margin-bottom:12px;">
    <label class="season-label" for="season">Season</label>
    <select id="season" name="season" class="season-select" on:change={submitFilters}>
      {#each seasons as s}
        <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeason)}>
          {s.season ?? s.name}
        </option>
      {/each}
    </select>
  </form>

  {#if messages && messages.length}
    <div class="messages">
      {#each messages as m}
        <div>{m}</div>
      {/each}
      {#if maxWeekForSeason}
        <div style="margin-top:8px;color:#9ca3af;font-size:0.93rem;">Detected highest playoff week for season: {maxWeekForSeason}</div>
      {/if}
    </div>
  {/if}

  <div class="brackets">
    <!-- Winners bracket -->
    <div class="bracket">
      <div class="bracketTitle">
        <div>Winners Bracket</div>
        <div style="color:#9ca3af; font-size:.95rem;">Top seeds (per final standings)</div>
      </div>

      {#if winnersRows.length}
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Team A</th>
              <th style="text-align:center;">Score</th>
              <th>Team B</th>
              <th style="text-align:center;">Week</th>
            </tr>
          </thead>
          <tbody>
            {#each winnersRows as row (row.matchup_id ?? row.key)}
              {#if row.participantsCount === 2}
                {@const label = row._label}
                <tr>
                  <td>
                    {#if label === 'Championship'}
                      <span class="label-badge lbl-champ">{label}</span>
                    {:else if label === 'Semi Finals'}
                      <span class="label-badge lbl-semi">{label}</span>
                    {:else if label === 'Quarter Finals'}
                      <span class="label-badge lbl-quarter">{label}</span>
                    {:else if label === 'Consolation match'}
                      <span class="label-badge lbl-consol">
                        {label}
                        {#if row._winnerPosition}
                          &nbsp; (Winner: {ordinal(row._winnerPosition)})
                        {:else}
                          &nbsp; (Winner: TBD)
                        {/if}
                      </span>
                    {:else if label === 'Bye'}
                      <span class="label-badge lbl-bye">{label}</span>
                    {:else}
                      <span class="label-badge lbl-match">{label}</span>
                    {/if}
                  </td>

                  <td>
                    <div class="team">
                      <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="">
                      <div>
                        <div class="team-name">{row.teamA.name}</div>
                        {#if row.teamA.ownerName}<div class="small">{row.teamA.ownerName}</div>{/if}
                      </div>
                    </div>
                  </td>

                  <td class="score">
                    <span class={row.teamA.points > row.teamB.points ? 'winner' : ''}>{fmt2(row.teamA.points)}</span>
                    –
                    <span class={row.teamB.points > row.teamA.points ? 'winner' : ''}>{fmt2(row.teamB.points)}</span>
                  </td>

                  <td>
                    <div class="team">
                      <img class="avatar" src={avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} alt="">
                      <div>
                        <div class="team-name">{row.teamB.name}</div>
                        {#if row.teamB.ownerName}<div class="small">{row.teamB.ownerName}</div>{/if}
                      </div>
                    </div>
                  </td>

                  <td style="text-align:center;">{row.week}</td>
                </tr>
              {:else if row.participantsCount === 1}
                <tr>
                  <td><span class="label-badge lbl-bye">Bye</span></td>
                  <td>
                    <div class="team">
                      <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="">
                      <div>
                        <div class="team-name">{row.teamA.name}</div>
                        {#if row.teamA.ownerName}<div class="small">{row.teamA.ownerName}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td class="score">–</td>
                  <td class="bye">BYE</td>
                  <td style="text-align:center;">{row.week}</td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {:else}
        <div style="color:#9ca3af;">No winners bracket matchups found for the selected season.</div>
      {/if}
    </div>

    <!-- Losers bracket -->
    <div class="bracket">
      <div class="bracketTitle">
        <div>Losers Bracket</div>
        <div style="color:#9ca3af; font-size:.95rem;">Lower seeds (per final standings)</div>
      </div>

      {#if losersRows.length}
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Team A</th>
              <th style="text-align:center;">Score</th>
              <th>Team B</th>
              <th style="text-align:center;">Week</th>
            </tr>
          </thead>
          <tbody>
            {#each losersRows as row (row.matchup_id ?? row.key)}
              {#if row.participantsCount === 2}
                {@const label = row._label}
                <tr>
                  <td>
                    {#if label === 'Championship'}
                      <span class="label-badge lbl-champ">{label}</span>
                    {:else if label === 'Semi Finals'}
                      <span class="label-badge lbl-semi">{label}</span>
                    {:else if label === 'Quarter Finals'}
                      <span class="label-badge lbl-quarter">{label}</span>
                    {:else if label === 'Consolation match'}
                      <span class="label-badge lbl-consol">
                        {label}
                        {#if row._winnerPosition}
                          &nbsp; (Winner: {ordinal(row._winnerPosition)})
                        {:else}
                          &nbsp; (Winner: TBD)
                        {/if}
                      </span>
                    {:else if label === 'Bye'}
                      <span class="label-badge lbl-bye">{label}</span>
                    {:else}
                      <span class="label-badge lbl-match">{label}</span>
                    {/if}
                  </td>

                  <td>
                    <div class="team">
                      <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="">
                      <div>
                        <div class="team-name">{row.teamA.name}</div>
                        {#if row.teamA.ownerName}<div class="small">{row.teamA.ownerName}</div>{/if}
                      </div>
                    </div>
                  </td>

                  <td class="score">
                    <span class={row.teamA.points > row.teamB.points ? 'winner' : ''}>{fmt2(row.teamA.points)}</span>
                    –
                    <span class={row.teamB.points > row.teamA.points ? 'winner' : ''}>{fmt2(row.teamB.points)}</span>
                  </td>

                  <td>
                    <div class="team">
                      <img class="avatar" src={avatarOrPlaceholder(row.teamB.avatar, row.teamB.name)} alt="">
                      <div>
                        <div class="team-name">{row.teamB.name}</div>
                        {#if row.teamB.ownerName}<div class="small">{row.teamB.ownerName}</div>{/if}
                      </div>
                    </div>
                  </td>

                  <td style="text-align:center;">{row.week}</td>
                </tr>
              {:else if row.participantsCount === 1}
                <tr>
                  <td><span class="label-badge lbl-bye">Bye</span></td>
                  <td>
                    <div class="team">
                      <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="">
                      <div>
                        <div class="team-name">{row.teamA.name}</div>
                        {#if row.teamA.ownerName}<div class="small">{row.teamA.ownerName}</div>{/if}
                      </div>
                    </div>
                  </td>
                  <td class="score">–</td>
                  <td class="bye">BYE</td>
                  <td style="text-align:center;">{row.week}</td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {:else}
        <div style="color:#9ca3af;">No losers bracket matchups found for the selected season.</div>
      {/if}
    </div>

    {#if unassignedRows.length}
      <div class="bracket">
        <div class="bracketTitle"><div>Unassigned / Unknown</div><div style="color:#9ca3af;">Matches we couldn't classify</div></div>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Team A</th>
              <th style="text-align:center;">Score</th>
              <th>Team B</th>
              <th style="text-align:center;">Week</th>
            </tr>
          </thead>
          <tbody>
            {#each unassignedRows as row (row.matchup_id ?? row.key)}
              <tr>
                <td><span class="label-badge lbl-match">{row._label}</span></td>
                <td>
                  <div class="team">
                    <img class="avatar" src={avatarOrPlaceholder(row.teamA.avatar, row.teamA.name)} alt="">
                    <div>
                      <div class="team-name">{row.teamA.name}</div>
                    </div>
                  </div>
                </td>
                <td class="score">{fmt2(row.teamA.points)} – {fmt2(row.teamB?.points)}</td>
                <td>
                  <div class="team">
                    <img class="avatar" src={avatarOrPlaceholder(row.teamB?.avatar, row.teamB?.name)} alt="">
                    <div>
                      <div class="team-name">{row.teamB?.name ?? 'TBD'}</div>
                    </div>
                  </div>
                </td>
                <td style="text-align:center;">{row.week}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>
