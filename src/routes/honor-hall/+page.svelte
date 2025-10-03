<script>
  // src/routes/honor-hall/+page.svelte
  export let data;

  // incoming data
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? (seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id) : null);

  const matchupsRows = Array.isArray(data?.matchupsRows) ? data.matchupsRows : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // helper: formatting
  function fmtPts(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return '—';
    return (Math.round(Number(n) * 100) / 100).toFixed(2);
  }
  function avatarOrPlaceholder(url, name, size = 48) {
    if (url) return url;
    const letter = name ? String(name)[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  // -------------------------
  // Filtered matchups for the selected season
  // -------------------------
  $: filteredRows = (Array.isArray(matchupsRows) && selectedSeason != null)
    ? matchupsRows.filter(r => String(r.season ?? '') === String(selectedSeason))
    : (Array.isArray(matchupsRows) ? matchupsRows.slice() : []);

  // -------------------------
  // Build roster info map from matchupsRows (rosterId -> { rosterId, name, avatar })
  // -------------------------
  $: rosterInfo = {};
  $: {
    rosterInfo = {};
    for (const r of filteredRows) {
      if (r.teamA && r.teamA.rosterId != null) {
        rosterInfo[String(r.teamA.rosterId)] = rosterInfo[String(r.teamA.rosterId)] || {
          rosterId: String(r.teamA.rosterId),
          name: r.teamA.name ?? null,
          avatar: r.teamA.avatar ?? null
        };
      }
      if (r.teamB && r.teamB.rosterId != null) {
        rosterInfo[String(r.teamB.rosterId)] = rosterInfo[String(r.teamB.rosterId)] || {
          rosterId: String(r.teamB.rosterId),
          name: r.teamB.name ?? null,
          avatar: r.teamB.avatar ?? null
        };
      }
      if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
        for (const p of r.combinedParticipants) {
          if (p.rosterId != null) {
            rosterInfo[String(p.rosterId)] = rosterInfo[String(p.rosterId)] || {
              rosterId: String(p.rosterId),
              name: p.name ?? null,
              avatar: p.avatar ?? null
            };
          }
        }
      }
    }
  }

  // -------------------------
  // Determine unique playoff weeks and assign round labels
  // -------------------------
  $: uniqueWeeks = Array.from(new Set(filteredRows.map(m => m.week).filter(w => w != null))).map(x => Number(x)).filter(n => !isNaN(n));
  $: uniqueWeeks.sort((a,b) => a - b);

  $: quarterWeek = uniqueWeeks[0] ?? null;
  $: semiWeek = uniqueWeeks[1] ?? null;
  $: finalWeek = uniqueWeeks[2] ?? null;

  // a simple map from week -> label
  $: weekLabelMap = {};
  $: {
    weekLabelMap = {};
    if (quarterWeek != null) weekLabelMap[quarterWeek] = 'Quarterfinals';
    if (semiWeek != null) weekLabelMap[semiWeek] = 'Semifinals';
    if (finalWeek != null) weekLabelMap[finalWeek] = 'Final';
  }

  // -------------------------
  // Find a matchup row by two rosterIds (order-agnostic) and optional week
  // -------------------------
  function findMatchup(aId, bId, week = null) {
    if (aId == null && bId == null) return null;
    const A = aId != null ? String(aId) : null;
    const B = bId != null ? String(bId) : null;

    for (const r of filteredRows) {
      // match week if requested
      if (week != null && Number(r.week) !== Number(week)) continue;

      // two-team explicit pairs
      if (r.teamA && r.teamB) {
        const ra = String(r.teamA.rosterId);
        const rb = String(r.teamB.rosterId);
        if ((A && B && ((ra === A && rb === B) || (ra === B && rb === A))) ||
            (A && !B && (ra === A || rb === A))) {
          return r;
        }
      }

      // combined participants (multi-team row)
      if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
        const ids = r.combinedParticipants.map(p => String(p.rosterId));
        if (A && B && ids.includes(A) && ids.includes(B)) return r;
        if (A && !B && ids.includes(A)) return r;
      }

      // bye case
      if (r.teamA && !r.teamB) {
        const ra = String(r.teamA.rosterId);
        if (A && ra === A) return r;
      }
    }
    return null;
  }

  // -------------------------
  // Build simple seeds list from rosterInfo (order: rosterId numeric sort)
  // -------------------------
  $: seedList = [];
  $: {
    seedList = Object.values(rosterInfo).map(r => ({ rosterId: r.rosterId, name: r.name, avatar: r.avatar }));
    // sort stable by rosterId (so results are deterministic)
    seedList.sort((a,b) => {
      const na = Number(a.rosterId);
      const nb = Number(b.rosterId);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(a.rosterId).localeCompare(String(b.rosterId));
    });
  }

  // -------------------------
  // Build winners/losers round-1 pairings using simple seeding rules:
  // - winnersSize defaults to 8 (except if roster count < 8)
  // - winnersRound1 pairing: top vs bottom, next vs next-bottom, etc.
  // - losers are the remainder (seed after winnersSize)
  // -------------------------
  $: brackets = {};
  $: {
    const total = seedList.length;
    const winnersSize = Math.min(8, total); // simple default; you can adjust based on season
    const winners = seedList.slice(0, winnersSize);
    const losers = seedList.slice(winnersSize);

    const winnersPairs = [];
    for (let i = 0; i < Math.floor(winners.length/2); i++) {
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

    const losersPairs = [];
    for (let i = 0; i < Math.floor(losers.length/2); i++) {
      const a = losers[i];
      const b = losers[losers.length - 1 - i];
      losersPairs.push({
        seedA: i + 1 + winnersSize,
        seedB: losers.length - i + winnersSize,
        rosterA: a ? a.rosterId : null,
        rosterB: b ? b.rosterId : null,
        displayA: a ? a.name : 'TBD',
        displayB: b ? b.name : 'TBD',
        avatarA: a ? a.avatar : null,
        avatarB: b ? b.avatar : null
      });
    }

    // pre-resolve match rows for each pair in quarterWeek
    const winnersRound1WithMatch = winnersPairs.map(p => {
      return {
        ...p,
        match: findMatchup(p.rosterA, p.rosterB, quarterWeek)
      };
    });
    const losersRound1WithMatch = losersPairs.map(p => {
      return {
        ...p,
        match: findMatchup(p.rosterA, p.rosterB, quarterWeek)
      };
    });

    brackets = {
      winners,
      winnersPairs,
      winnersRound1WithMatch,
      losers,
      losersPairs,
      losersRound1WithMatch
    };
  }

  // helper to submit filters form
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
      <div class="sub">Rendering matchupsRows filtered to the selected season</div>
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
                <span class={p.match.teamA.points > p.match.teamB.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(p.match.teamA.points)}</span>
                &nbsp;—&nbsp;
                <span class={p.match.teamB.points > p.match.teamA.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(p.match.teamB.points)}</span>
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
              <div class="scoreVal">
                <span class={lp.match.teamA.points > lp.match.teamB.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(lp.match.teamA.points)}</span>
                &nbsp;—&nbsp;
                <span class={lp.match.teamB.points > lp.match.teamA.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(lp.match.teamB.points)}</span>
              </div>
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
