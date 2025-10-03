<script>
  // src/routes/honor-hall/+page.svelte
  export let data;

  /********** incoming data **********/
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  const matchupsRows = Array.isArray(data?.matchupsRows) ? data.matchupsRows : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  /********** helper formatting **********/
  function fmtPts(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return '—';
    return (Math.round(Number(n) * 100) / 100).toFixed(2);
  }
  function avatarOrPlaceholder(url, name, size = 48) {
    if (url) return url;
    const letter = name ? String(name)[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  /********** FINAL STANDINGS (owner display_name lists you provided) **********/
  // These are *owner* display names, in order from 1st -> last.
  const FINAL_STANDINGS = {
    '2024': [
      'riguy506','smallvt','JakePratt','Kybes','TLupinetti','samsilverman12',
      'armyjunior','JFK4312','WebbWarrior','slawflesh','jewishhorsemen',
      'noahlap01','zamt','WillMichael'
    ],
    '2023': [
      'armyjunior','jewishhorsemen','Kybes','riguy506','zamt','slawflesh',
      'JFK4312','smallvt','samsilverman12','WebbWarrior','TLupinetti',
      'noahlap01','JakePratt','WillMichael'
    ],
    '2022': [
      'riguy506','smallvt','jewishhorsemen','zamt','noahlap01','Kybes',
      'armyjunior','slawflesh','WillMichael','JFK4312','WebbWarrior','TLupinetti','JakePratt','samsilverman12'
    ]
  };

  /********** Filter matchups for selected season **********/
  $: filteredRows = (Array.isArray(matchupsRows) && selectedSeason != null)
    ? matchupsRows.filter(r => String(r.season ?? '') === String(selectedSeason))
    : (Array.isArray(matchupsRows) ? matchupsRows.slice() : []);

  /********** Build roster info map from matchupsRows **********/
  // rosterInfo: { rosterId -> { rosterId, name, avatar, ownerName? } }
  $: rosterInfo = {};
  $: {
    rosterInfo = {};
    for (const r of filteredRows) {
      if (r.teamA && r.teamA.rosterId != null) {
        rosterInfo[String(r.teamA.rosterId)] = rosterInfo[String(r.teamA.rosterId)] || {
          rosterId: String(r.teamA.rosterId),
          name: r.teamA.name ?? null,
          avatar: r.teamA.avatar ?? null,
          ownerName: r.teamA.ownerName ?? null
        };
      }
      if (r.teamB && r.teamB.rosterId != null) {
        rosterInfo[String(r.teamB.rosterId)] = rosterInfo[String(r.teamB.rosterId)] || {
          rosterId: String(r.teamB.rosterId),
          name: r.teamB.name ?? null,
          avatar: r.teamB.avatar ?? null,
          ownerName: r.teamB.ownerName ?? null
        };
      }
      if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
        for (const p of r.combinedParticipants) {
          if (p.rosterId != null) {
            rosterInfo[String(p.rosterId)] = rosterInfo[String(p.rosterId)] || {
              rosterId: String(p.rosterId),
              name: p.name ?? null,
              avatar: p.avatar ?? null,
              ownerName: p.ownerName ?? null
            };
          }
        }
      }
    }
  }

  /********** Determine unique playoff weeks and label mapping **********/
  $: uniqueWeeks = Array.from(new Set(filteredRows.map(m => m.week).filter(w => w != null))).map(x => Number(x)).filter(n => !isNaN(n));
  $: uniqueWeeks.sort((a,b) => a - b);
  $: quarterWeek = uniqueWeeks[0] ?? null;
  $: semiWeek = uniqueWeeks[1] ?? null;
  $: finalWeek = uniqueWeeks[2] ?? null;
  $: weekLabelMap = {};
  $: {
    weekLabelMap = {};
    if (quarterWeek != null) weekLabelMap[quarterWeek] = 'Quarterfinals';
    if (semiWeek != null) weekLabelMap[semiWeek] = 'Semifinals';
    if (finalWeek != null) weekLabelMap[finalWeek] = 'Championship';
  }

  /********** Find a matchup row by two rosterIds (order-agnostic) and optional week **********/
  function findMatchup(aId, bId, week = null) {
    if (aId == null && bId == null) return null;
    const A = aId != null ? String(aId) : null;
    const B = bId != null ? String(bId) : null;

    for (const r of filteredRows) {
      if (week != null && Number(r.week) !== Number(week)) continue;

      if (r.teamA && r.teamB) {
        const ra = String(r.teamA.rosterId);
        const rb = String(r.teamB.rosterId);
        if ((A && B && ((ra === A && rb === B) || (ra === B && rb === A))) ||
            (A && !B && (ra === A || rb === A))) {
          return r;
        }
      }

      if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
        const ids = r.combinedParticipants.map(p => String(p.rosterId));
        if (A && B && ids.includes(A) && ids.includes(B)) return r;
        if (A && !B && ids.includes(A)) return r;
      }

      if (r.teamA && !r.teamB) {
        const ra = String(r.teamA.rosterId);
        if (A && ra === A) return r;
      }
    }
    return null;
  }

  /********** Helper: match roster object by owner display_name heuristically **********/
  // Attempts: 1) exact match on rosterInfo.name lower, 2) if roster name contains displayName, 3) check ownerName if present
  function findRosterIdByDisplayName(displayName) {
    if (!displayName) return null;
    const target = String(displayName).toLowerCase();
    // exact match first
    for (const k of Object.keys(rosterInfo)) {
      const r = rosterInfo[k];
      if (!r) continue;
      if (r.name && String(r.name).toLowerCase() === target) return r.rosterId;
      if (r.ownerName && String(r.ownerName).toLowerCase() === target) return r.rosterId;
    }
    // contains match
    for (const k of Object.keys(rosterInfo)) {
      const r = rosterInfo[k];
      if (!r) continue;
      if (r.name && String(r.name).toLowerCase().includes(target)) return r.rosterId;
      if (r.ownerName && String(r.ownerName).toLowerCase().includes(target)) return r.rosterId;
    }
    // fallback: look for any roster where display name contains roster name
    for (const k of Object.keys(rosterInfo)) {
      const r = rosterInfo[k];
      if (!r) continue;
      if (r.name && target.includes(String(r.name).toLowerCase())) return r.rosterId;
    }
    return null;
  }

  /********** Build seed list according to final standings for the selected season **********/
  $: seedList = [];
  $: {
    seedList = [];
    const seasonKey = String(selectedSeason ?? '');
    const standingsArr = FINAL_STANDINGS[seasonKey] ?? null;

    // all rosterIds we know from rosterInfo
    const allRosterIds = Object.keys(rosterInfo);

    if (standingsArr && Array.isArray(standingsArr) && standingsArr.length) {
      // attempt to map each display_name in final standings to rosterId
      const mapped = [];
      const used = new Set();
      for (const displayName of standingsArr) {
        const rid = findRosterIdByDisplayName(displayName);
        if (rid && rosterInfo[rid] && !used.has(rid)) {
          mapped.push({ rosterId: rid, name: rosterInfo[rid].name, avatar: rosterInfo[rid].avatar });
          used.add(rid);
        } else {
          // not found; ignore for now, we'll append later
        }
      }
      // Append mapped order first
      seedList = seedList.concat(mapped);

      // Append any remaining rosters that were not in the final standings mapping (to keep total)
      for (const rid of allRosterIds) {
        if (!used.has(rid)) {
          seedList.push({ rosterId: rid, name: rosterInfo[rid].name, avatar: rosterInfo[rid].avatar });
          used.add(rid);
        }
      }
    } else {
      // fallback: deterministic order by rosterId
      const arr = allRosterIds.map(rid => ({ rosterId: rid, name: rosterInfo[rid].name, avatar: rosterInfo[rid].avatar }));
      arr.sort((a,b) => {
        const na = Number(a.rosterId), nb = Number(b.rosterId);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(a.rosterId).localeCompare(String(b.rosterId));
      });
      seedList = arr;
    }
  }

  /********** Determine winners/losers bracket sizes **********/
  $: {
    const totalRosters = seedList.length;
    const seasonKey = String(selectedSeason ?? '');
    const winnersDefault = (seasonKey === '2022') ? 6 : 8;
    winnersSize = Math.min(winnersDefault, totalRosters);
  }

  /********** Build pairings using seedList and find matchups (quarter week) **********/
  $: brackets = {};
  $: {
    const total = seedList.length;
    const winners = seedList.slice(0, winnersSize);
    const losers = seedList.slice(winnersSize);

    // winners pairs: top vs bottom within winners
    const winnersPairs = [];
    for (let i = 0; i < Math.floor(winners.length / 2); i++) {
      const a = winners[i];
      const b = winners[winners.length - 1 - i];
      winnersPairs.push({
        seedA: i + 1,
        seedB: winners.length - i,
        rosterA: a ? a.rosterId : null,
        rosterB: b ? b.rosterId : null,
        displayA: a ? a.name : 'TBD',
        displayB: b ? b.name : 'TBD',
        avatarA: a ? a.avatar : null,
        avatarB: b ? b.avatar : null
      });
    }

    // losers pairs: seeded from top-to-bottom of losers (top -> bottom)
    const losersPairs = [];
    for (let i = 0; i < Math.floor(losers.length / 2); i++) {
      const a = losers[i];
      const b = losers[losers.length - 1 - i];
      losersPairs.push({
        seedA: winnersSize + i + 1,
        seedB: winnersSize + (losers.length - i),
        rosterA: a ? a.rosterId : null,
        rosterB: b ? b.rosterId : null,
        displayA: a ? a.name : 'TBD',
        displayB: b ? b.name : 'TBD',
        avatarA: a ? a.avatar : null,
        avatarB: b ? b.avatar : null
      });
    }

    // pre-resolve match rows for quarterWeek (round1)
    const winnersRound1WithMatch = winnersPairs.map(p => ({ ...p, match: findMatchup(p.rosterA, p.rosterB, quarterWeek) }));
    const losersRound1WithMatch  = losersPairs.map(p => ({ ...p, match: findMatchup(p.rosterA, p.rosterB, quarterWeek) }));

    brackets = {
      winners,
      winnersPairs,
      winnersRound1WithMatch,
      losers,
      losersPairs,
      losersRound1WithMatch
    };
  }

  /********** helper to submit filters form **********/
  function submitFilters() {
    const form = document.getElementById('filters');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }
</script>

<style>
  :global(body) { background: #0b0c0f; color: #e6eef8; }
  .wrap { max-width:1100px; margin:0 auto; padding:1.2rem; }
  .top { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:1rem; }
  .season-select { padding:8px 10px; border-radius:8px; background:rgba(255,255,255,0.02); color:#fff; border:1px solid rgba(255,255,255,0.04); }
  .messages { background:rgba(255,255,255,0.02); padding:10px; border-radius:8px; margin-bottom:12px; color:#bfcbdc; }
  .cols { display:flex; gap:20px; flex-wrap:wrap; }
  .col { flex:1 1 420px; min-width:320px; background:rgba(255,255,255,0.02); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.03); }
  .pair { display:flex; align-items:center; gap:12px; padding:10px; border-radius:8px; margin-bottom:10px; background:rgba(255,255,255,0.01); }
  .team { display:flex; align-items:center; gap:10px; min-width:0; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; }
  .teamName { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; }
  .seed { font-size:.85rem; color:#cbd5e1; background:rgba(255,255,255,0.03); padding:4px 6px; border-radius:6px; }
  .score { margin-left:auto; text-align:right; min-width:110px; }
  .scoreVal { font-weight:800; color:#fff; display:block; }
  .sub { color:#9aa3ad; font-size:.9rem; }
  @media (max-width:900px) { .cols { flex-direction:column; } }
</style>

<div class="wrap">
  <div class="top">
    <div>
      <h1>Honor Hall — Playoff matchups (showing selected season)</h1>
      <div class="sub">Seeding comes from final standings arrays for the selected season.</div>
    </div>

    <form id="filters" method="get" class="filters" on:change={submitFilters}>
      <select name="season" class="season-select" bind:value={selectedSeason}>
        {#if seasons && seasons.length}
          {#each seasons as s}
            <option value={s.season ?? s.league_id} selected={(s.season ?? s.league_id) === String(selectedSeason)}>
              {s.season ?? s.name ?? s.league_id}
            </option>
          {/each}
        {:else}
          <option>{selectedSeason}</option>
        {/if}
      </select>
    </form>
  </div>

  {#if messages && messages.length}
    <div class="messages" role="status">
      {#each messages as m}
        <div>• {m}</div>
      {/each}
    </div>
  {/if}

  <div class="cols">
    <!-- Winners column -->
    <div class="col">
      <h2>Winners Bracket</h2>
      <div class="sub">{quarterWeek ? `Round 1 — Week ${quarterWeek}` : 'Round 1'}</div>
      {#each brackets.winnersRound1WithMatch as p (p.rosterA + '-' + p.rosterB)}
        <div class="pair">
          <div class="team" style="min-width:220px">
            <img class="avatar" src={avatarOrPlaceholder(p.avatarA, p.displayA)} alt="">
            <div>
              <div class="teamName">{p.displayA}</div>
              <div class="sub"><span class="seed">#{p.seedA ?? '-'}</span></div>
            </div>
          </div>

          <div style="width:28px; text-align:center; color:#9aa3ad; font-weight:700;">vs</div>

          <div class="team" style="min-width:180px">
            <img class="avatar" src={avatarOrPlaceholder(p.avatarB, p.displayB)} alt="">
            <div>
              <div class="teamName">{p.displayB}</div>
              <div class="sub"><span class="seed">#{p.seedB ?? '-'}</span></div>
            </div>
          </div>

          <div class="score">
            {#if p.match && p.match.teamA && p.match.teamB}
              <div class="scoreVal">
                <span>{fmtPts(p.match.teamA.points)}</span>&nbsp;—&nbsp;<span>{fmtPts(p.match.teamB.points)}</span>
              </div>
              <div class="sub">Week {p.match.week}</div>
            {:else}
              <div class="scoreVal">TBD</div>
              <div class="sub">Week {quarterWeek ?? '—'}</div>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <!-- Losers column -->
    <div class="col">
      <h2>Losers Bracket</h2>
      <div class="sub">{quarterWeek ? `Round 1 — Week ${quarterWeek}` : 'Round 1'}</div>
      {#each brackets.losersRound1WithMatch as lp (lp.rosterA + '-' + lp.rosterB)}
        <div class="pair">
          <div class="team">
            <img class="avatar" src={avatarOrPlaceholder(lp.avatarA, lp.displayA)} alt="">
            <div>
              <div class="teamName">{lp.displayA}</div>
              <div class="sub"><span class="seed">#{lp.seedA ?? '-'}</span></div>
            </div>
          </div>

          <div style="width:28px; text-align:center; color:#9aa3ad; font-weight:700;">vs</div>

          <div class="team">
            <img class="avatar" src={avatarOrPlaceholder(lp.avatarB, lp.displayB)} alt="">
            <div>
              <div class="teamName">{lp.displayB}</div>
              <div class="sub"><span class="seed">#{lp.seedB ?? '-'}</span></div>
            </div>
          </div>

          <div class="score">
            {#if lp.match && lp.match.teamA && lp.match.teamB}
              <div class="scoreVal">{fmtPts(lp.match.teamA.points)} &nbsp;—&nbsp; {fmtPts(lp.match.teamB.points)}</div>
              <div class="sub">Week {lp.match.week}</div>
            {:else}
              <div class="scoreVal">TBD</div>
              <div class="sub">Week {quarterWeek ?? '—'}</div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
