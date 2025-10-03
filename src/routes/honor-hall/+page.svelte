<script>
  // src/routes/honor-hall/+page.svelte
  export let data;

  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  const matchupsRows = Array.isArray(data?.matchupsRows) ? data.matchupsRows : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];

  // ---------------------------
  // Hard-coded final standings (owner display names in finishing order)
  // ---------------------------
  const FINAL_STANDINGS = {
    '2024': [
      'riguy506','smallvt','JakePratt','Kybes','TLupinetti','samsilverman12','armyjunior','JFK4312','WebbWarrior','slawflesh','jewishhorsemen','noahlap01','zamt','WillMichael'
    ],
    '2023': [
      'armyjunior','jewishhorsemen','Kybes','riguy506','zamt','slawflesh','JFK4312','smallvt','samsilverman12','WebbWarrior','TLupinetti','noahlap01','JakePratt','WillMichael'
    ],
    '2022': [
      'riguy506','smallvt','jewishhorsemen','zamt','noahlap01','Kybes','armyjunior','slawflesh','WillMichael','JFK4312','WebbWarrior','TLupinetti','JakePratt','samsilverman12'
    ]
  };

  function nameKey(name) {
    if (!name) return '';
    return String(name).toLowerCase().trim();
  }

  // Create a roster lookup (map rosterId -> enriched info from matchupsRows)
  const rosterInfo = {};
  for (const r of matchupsRows) {
    if (r.teamA) {
      rosterInfo[String(r.teamA.rosterId)] = rosterInfo[String(r.teamA.rosterId)] || {
        rosterId: String(r.teamA.rosterId),
        name: r.teamA.name || null,
        avatar: r.teamA.avatar || null
      };
    }
    if (r.teamB) {
      rosterInfo[String(r.teamB.rosterId)] = rosterInfo[String(r.teamB.rosterId)] || {
        rosterId: String(r.teamB.rosterId),
        name: r.teamB.name || null,
        avatar: r.teamB.avatar || null
      };
    }
    if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
      for (const p of r.combinedParticipants) {
        rosterInfo[String(p.rosterId)] = rosterInfo[String(p.rosterId)] || {
          rosterId: String(p.rosterId),
          name: p.name || null,
          avatar: p.avatar || null
        };
      }
    }
  }

  // ---------------------------
  // Determine playoff weeks from matchupsRows (unique weeks sorted ascending)
  const uniqueWeeks = Array.from(new Set(matchupsRows.map(m => m.week).filter(w => w != null))).map(x => Number(x)).filter(n => !isNaN(n));
  uniqueWeeks.sort((a,b) => a - b);
  const ROUND_LABELS = ['Quarterfinals','Semifinals','Final'];
  const weekToRoundLabel = {};
  for (let i = 0; i < uniqueWeeks.length; i++) {
    weekToRoundLabel[uniqueWeeks[i]] = (ROUND_LABELS[i] || `Round ${i+1}`);
  }

  // Utility: find a matchup row by two roster ids (order-agnostic) and week optional
  function findMatchup(rosterA, rosterB, week = null) {
    if (rosterA == null && rosterB == null) return null;
    rosterA = rosterA != null ? String(rosterA) : null;
    rosterB = rosterB != null ? String(rosterB) : null;
    for (const r of matchupsRows) {
      if (r.teamA && r.teamB) {
        const a = String(r.teamA.rosterId);
        const b = String(r.teamB.rosterId);
        const samePair = ((a === rosterA && b === rosterB) || (a === rosterB && b === rosterA));
        const wkMatch = (week == null || Number(r.week) === Number(week));
        if (samePair && wkMatch) return r;
      } else if (r.combinedParticipants && Array.isArray(r.combinedParticipants)) {
        const ids = r.combinedParticipants.map(p => String(p.rosterId));
        if (rosterA && rosterB && ids.includes(rosterA) && ids.includes(rosterB)) {
          if (week == null || Number(r.week) === Number(week)) return r;
        }
      } else if (r.teamA && !r.teamB) {
        const a = String(r.teamA.rosterId);
        if (rosterA && a === rosterA && !rosterB && (week == null || Number(r.week) === Number(week))) return r;
      }
    }
    return null;
  }

  // Build seed map for season
  function buildSeedMapForSeason(seasonKey) {
    const arr = FINAL_STANDINGS[String(seasonKey)] || [];
    const map = {};
    for (let i = 0; i < arr.length; i++) map[String(arr[i]).toLowerCase()] = i + 1;
    return map;
  }

  // Build seeds list (match final standings to rosterInfo heuristically)
  function buildSeeds(seasonKey) {
    const rosterEntries = Object.values(rosterInfo);
    const final = FINAL_STANDINGS[String(seasonKey)] || [];
    const seeds = [];
    const used = new Set();

    for (let i = 0; i < final.length; i++) {
      const owner = final[i];
      const lowOwner = String(owner).toLowerCase();
      let matched = null;
      for (const entry of rosterEntries) {
        if (used.has(entry.rosterId)) continue;
        const nm = nameKey(entry.name || '');
        if (!nm) continue;
        if (nm === lowOwner) { matched = entry; break; }
      }
      if (!matched) {
        for (const entry of rosterEntries) {
          if (used.has(entry.rosterId)) continue;
          const nm = nameKey(entry.name || '');
          if (!nm) continue;
          if (nm.includes(lowOwner) || lowOwner.includes(nm)) { matched = entry; break; }
        }
      }
      if (!matched) {
        for (const entry of rosterEntries) {
          if (used.has(entry.rosterId)) continue;
          const nm = nameKey(entry.name || '');
          if (!nm) continue;
          if (nm.indexOf(lowOwner) !== -1) { matched = entry; break; }
        }
      }

      if (matched) {
        used.add(matched.rosterId);
        seeds.push({
          seed: i+1,
          ownerName: owner,
          rosterId: matched.rosterId,
          displayName: matched.name || owner,
          avatar: matched.avatar || null
        });
      } else {
        seeds.push({
          seed: i+1,
          ownerName: owner,
          rosterId: null,
          displayName: owner,
          avatar: null
        });
      }
    }

    // append any leftover rosters
    for (const entry of rosterEntries) {
      if (!used.has(entry.rosterId)) {
        seeds.push({
          seed: null,
          ownerName: entry.name || entry.rosterId,
          rosterId: entry.rosterId,
          displayName: entry.name || ('Roster '+entry.rosterId),
          avatar: entry.avatar || null
        });
      }
    }
    return seeds;
  }

  // Build brackets per requested seeding rules
  function buildBracketsForSeason(seasonKey) {
    const seeds = buildSeeds(seasonKey);
    const winnersSize = (String(seasonKey) === '2022') ? 6 : 8;
    const winnersSeeds = seeds.slice(0, winnersSize);
    const losersSeeds = seeds.slice(winnersSize);

    const winnersPairsRound1Indices = [];
    if (winnersSize >= 8) winnersPairsRound1Indices.push([0,7],[1,6],[5,2],[3,4]);
    else if (winnersSize === 6) winnersPairsRound1Indices.push([2,5],[3,4]);
    else {
      const n = winnersSeeds.length;
      for (let i = 0; i < Math.floor(n/2); i++) winnersPairsRound1Indices.push([i, n-1-i]);
    }

    const winnersRound1 = winnersPairsRound1Indices.map(([iA,iB]) => {
      const a = winnersSeeds[iA] || null;
      const b = winnersSeeds[iB] || null;
      return {
        seedA: a ? a.seed : null,
        seedB: b ? b.seed : null,
        rosterA: a ? a.rosterId : null,
        rosterB: b ? b.rosterId : null,
        displayA: a ? a.displayName : (a ? a.ownerName : 'TBD'),
        displayB: b ? b.displayName : (b ? b.ownerName : 'TBD'),
        avatarA: a ? a.avatar : null,
        avatarB: b ? b.avatar : null
      };
    });

    const loserSeedList = losersSeeds.map(s => ({ seed: s.seed, rosterId: s.rosterId, display: s.displayName, avatar: s.avatar }));
    const losersPairsRound1 = [];
    for (let i = 0; i < Math.floor(loserSeedList.length/2); i++) {
      const top = loserSeedList[i];
      const bot = loserSeedList[loserSeedList.length - 1 - i];
      losersPairsRound1.push({
        seedA: top ? top.seed : null,
        seedB: bot ? bot.seed : null,
        rosterA: top ? top.rosterId : null,
        rosterB: bot ? bot.rosterId : null,
        displayA: top ? top.display : 'TBD',
        displayB: bot ? bot.display : 'TBD',
        avatarA: top ? top.avatar : null,
        avatarB: bot ? bot.avatar : null
      });
    }

    return { winnersSeeds, winnersRound1, loserSeedList, losersPairsRound1 };
  }

  $: brackets = buildBracketsForSeason(selectedSeason);

  const quarterWeek = uniqueWeeks[0] ?? null;
  const semiWeek = uniqueWeeks[1] ?? null;
  const finalWeek = uniqueWeeks[2] ?? null;

  function fmtPts(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return '—';
    return (Math.round(Number(n) * 100) / 100).toFixed(2);
  }

  function avatarOrPlaceholder(url, name, size = 48) {
    if (url) return url;
    const letter = name ? String(name)[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }
</script>

<style>
  :global(body) { background:#0b0c0f; color:#e6eef8; }
  .wrap { max-width:1200px; margin:0 auto; padding:1.5rem; }
  h1 { margin-bottom:.5rem; }
  .topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; }
  .filters { display:flex; gap:.75rem; align-items:center; }
  .season-select { padding:8px 10px; background:rgba(255,255,255,0.02); border-radius:8px; color:#fff; border:1px solid rgba(255,255,255,0.04); }

  .messages { background:rgba(255,255,255,0.02); border-radius:8px; padding:12px; margin-bottom:1rem; color:#bfcbdc; }

  .bracketColumns { display:flex; gap:20px; align-items:flex-start; flex-wrap:wrap; }
  .col { flex:1 1 480px; min-width:320px; background:rgba(255,255,255,0.02); border-radius:10px; padding:12px; border:1px solid rgba(255,255,255,0.03); }
  .col h2 { margin:0 0 10px 0; font-size:1.05rem; }

  .pair { display:flex; align-items:center; gap:12px; background:rgba(255,255,255,0.01); padding:10px; border-radius:8px; margin-bottom:10px; border:1px solid rgba(255,255,255,0.02); }
  .team { display:flex; align-items:center; gap:10px; min-width:0; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; flex-shrink:0; }
  .teamInfo { display:flex; flex-direction:column; min-width:0; }
  .teamName { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; }
  .seed { background:rgba(255,255,255,0.03); padding:4px 6px; border-radius:6px; font-weight:700; color:#cbd5e1; font-size:.85rem; }
  .score { margin-left:auto; text-align:right; min-width:110px; }
  .scoreVal { font-weight:800; color:#fff; display:block; }
  .sub { color:#9aa3ad; font-size:.9rem; }

  .label { font-weight:800; color:#cbd5e1; margin-bottom:6px; }

  @media (max-width:900px) {
    .bracketColumns { flex-direction:column; }
  }
</style>

<div class="wrap">
  <div class="topbar">
    <div>
      <h1>Honor Hall — Playoff Brackets</h1>
      <div class="sub">Seeded via final standings arrays; rounds derived from playoff weeks present in the matchups rows.</div>
    </div>

    <form id="filters" method="get" class="filters">
      <select id="season" name="season" class="season-select" on:change={() => document.getElementById('filters')?.requestSubmit?.()}>
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
    <div class="messages" role="status" aria-live="polite">
      {#each messages as m}
        <div>• {m}</div>
      {/each}
    </div>
  {/if}

  <div class="bracketColumns">
    <!-- Winners Bracket Column -->
    <div class="col">
      <h2>Winners Bracket</h2>

      <div class="label">Round 1 — {quarterWeek ? `Week ${quarterWeek}` : 'Quarterfinals'}</div>
      {#each brackets.winnersRound1 as p, idx}
        <!-- find actual matchup row for this pair in quarterWeek if exists -->
        {@const match = findMatchup(p.rosterA, p.rosterB, quarterWeek)}
        <div class="pair">
          <div class="team" style="min-width:220px">
            <img class="avatar" src={avatarOrPlaceholder(p.avatarA, p.displayA)} alt="">
            <div class="teamInfo">
              <div class="teamName">{p.displayA}</div>
              <div class="sub"><span class="seed">#{p.seedA ?? '-'}</span></div>
            </div>
          </div>

          <div style="width:28px; text-align:center; color:#9aa3ad; font-weight:700;">vs</div>

          <div class="team" style="min-width:180px">
            <img class="avatar" src={avatarOrPlaceholder(p.avatarB, p.displayB)} alt="">
            <div class="teamInfo">
              <div class="teamName">{p.displayB}</div>
              <div class="sub"><span class="seed">#{p.seedB ?? '-'}</span></div>
            </div>
          </div>

          <div class="score">
            {#if match && match.teamA && match.teamB}
              <div class="scoreVal">
                <span class={match.teamA.points > match.teamB.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(match.teamA.points)}</span>
                &nbsp;—&nbsp;
                <span class={match.teamB.points > match.teamA.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(match.teamB.points)}</span>
              </div>
              <div class="sub">Week {match.week}</div>
            {:else}
              <div class="scoreVal">TBD</div>
              <div class="sub">Week {quarterWeek ?? '—'}</div>
            {/if}
          </div>
        </div>
      {/each}

      <div style="height:6px"></div>
      <div class="label">Round 2 — {semiWeek ? `Week ${semiWeek}` : 'Semifinals'}</div>

      {#each Array(Math.max(1, Math.floor(brackets.winnersRound1.length / 2))) as _, i}
        {@const semiMatch = (() => {
          const pA = brackets.winnersRound1[i*2];
          const pB = brackets.winnersRound1[i*2 + 1];
          if (!pA || !pB) return null;
          for (const r of matchupsRows) {
            if (Number(r.week) !== Number(semiWeek)) continue;
            const a = r.teamA && r.teamA.rosterId ? String(r.teamA.rosterId) : null;
            const b = r.teamB && r.teamB.rosterId ? String(r.teamB.rosterId) : null;
            if (!a || !b) continue;
            const candidates = [String(pA.rosterA), String(pA.rosterB), String(pB.rosterA), String(pB.rosterB)];
            if (candidates.includes(a) || candidates.includes(b)) return r;
          }
          return null;
        })()}

        <div class="pair">
          {#if semiMatch && semiMatch.teamA && semiMatch.teamB}
            <div class="team">
              <img class="avatar" src={avatarOrPlaceholder(semiMatch.teamA.avatar, semiMatch.teamA.name)} alt="">
              <div class="teamInfo">
                <div class="teamName">{semiMatch.teamA.name}</div>
                <div class="sub"><span class="seed">#{semiMatch.teamA.rosterId ?? '-'}</span></div>
              </div>
            </div>
            <div style="width:28px; text-align:center; color:#9aa3ad; font-weight:700;">vs</div>
            <div class="team">
              <img class="avatar" src={avatarOrPlaceholder(semiMatch.teamB.avatar, semiMatch.teamB.name)} alt="">
              <div class="teamInfo">
                <div class="teamName">{semiMatch.teamB.name}</div>
                <div class="sub"><span class="seed">#{semiMatch.teamB.rosterId ?? '-'}</span></div>
              </div>
            </div>
            <div class="score">
              <div class="scoreVal">
                <span class={semiMatch.teamA.points > semiMatch.teamB.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(semiMatch.teamA.points)}</span>
                &nbsp;—&nbsp;
                <span class={semiMatch.teamB.points > semiMatch.teamA.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(semiMatch.teamB.points)}</span>
              </div>
              <div class="sub">Week {semiMatch.week}</div>
            </div>
          {:else}
            <div class="team">
              <div class="teamInfo"><div class="teamName">TBD</div></div>
            </div>
            <div style="width:28px; text-align:center; color:#9aa3ad; font-weight:700;">vs</div>
            <div class="team"><div class="teamInfo"><div class="teamName">TBD</div></div></div>
            <div class="score"><div class="scoreVal">TBD</div><div class="sub">Week {semiWeek ?? '—'}</div></div>
          {/if}
        </div>
      {/each}

      <div style="height:6px"></div>
      <div class="label">Final — {finalWeek ? `Week ${finalWeek}` : 'Final'}</div>
      {#if finalWeek}
        {@const finalMatch = matchupsRows.find(r => Number(r.week) === Number(finalWeek) && r.teamA && r.teamB)}
        <div class="pair">
          {#if finalMatch}
            <div class="team">
              <img class="avatar" src={avatarOrPlaceholder(finalMatch.teamA.avatar, finalMatch.teamA.name)} alt="">
              <div class="teamInfo"><div class="teamName">{finalMatch.teamA.name}</div></div>
            </div>
            <div style="width:28px; text-align:center; color:#9aa3ad; font-weight:700;">vs</div>
            <div class="team">
              <img class="avatar" src={avatarOrPlaceholder(finalMatch.teamB.avatar, finalMatch.teamB.name)} alt="">
              <div class="teamInfo"><div class="teamName">{finalMatch.teamB.name}</div></div>
            </div>
            <div class="score">
              <div class="scoreVal">
                <span class={finalMatch.teamA.points > finalMatch.teamB.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(finalMatch.teamA.points)}</span>
                &nbsp;—&nbsp;
                <span class={finalMatch.teamB.points > finalMatch.teamA.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(finalMatch.teamB.points)}</span>
              </div>
              <div class="sub">Week {finalMatch.week}</div>
            </div>
          {:else}
            <div class="team"><div class="teamInfo"><div class="teamName">TBD</div></div></div>
            <div style="width:28px; text-align:center; color:#9aa3ad; font-weight:700;">vs</div>
            <div class="team"><div class="teamInfo"><div class="teamName">TBD</div></div></div>
            <div class="score"><div class="scoreVal">TBD</div><div class="sub">Week {finalWeek}</div></div>
          {/if}
        </div>
      {:else}
        <div class="pair"><div class="teamInfo"><div class="teamName">Final not available</div></div></div>
      {/if}
    </div>

    <!-- Losers Bracket Column -->
    <div class="col">
      <h2>Losers Bracket</h2>

      <div class="label">Losers Round 1 — {quarterWeek ? `Week ${quarterWeek}` : 'Round 1'}</div>
      {#each brackets.losersPairsRound1 as lp, i}
        {@const lm = findMatchup(lp.rosterA, lp.rosterB, quarterWeek)}
        <div class="pair">
          <div class="team">
            <img class="avatar" src={avatarOrPlaceholder(lp.avatarA, lp.displayA)} alt="">
            <div class="teamInfo">
              <div class="teamName">{lp.displayA}</div>
              <div class="sub"><span class="seed">#{lp.seedA ?? '-'}</span></div>
            </div>
          </div>

          <div style="width:28px; text-align:center; color:#9aa3ad; font-weight:700;">vs</div>

          <div class="team">
            <img class="avatar" src={avatarOrPlaceholder(lp.avatarB, lp.displayB)} alt="">
            <div class="teamInfo">
              <div class="teamName">{lp.displayB}</div>
              <div class="sub"><span class="seed">#{lp.seedB ?? '-'}</span></div>
            </div>
          </div>

          <div class="score">
            {#if lm && lm.teamA && lm.teamB}
              <div class="scoreVal">
                <span class={lm.teamA.points > lm.teamB.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(lm.teamA.points)}</span>
                &nbsp;—&nbsp;
                <span class={lm.teamB.points > lm.teamA.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(lm.teamB.points)}</span>
              </div>
              <div class="sub">Week {lm.week}</div>
            {:else}
              <div class="scoreVal">TBD</div>
              <div class="sub">Week {quarterWeek ?? '—'}</div>
            {/if}
          </div>
        </div>
      {/each}

      <div style="height:6px"></div>
      <div class="label">Losers Round 2 / Consolations — {semiWeek ? `Week ${semiWeek}` : 'Round 2'}</div>

      {#each brackets.losersPairsRound1 as lp, idx}
        {@const possible5th = (() => {
          for (const r of matchupsRows) {
            if (Number(r.week) !== Number(semiWeek)) continue;
            const a = r.teamA && r.teamA.rosterId ? String(r.teamA.rosterId) : null;
            const b = r.teamB && r.teamB.rosterId ? String(r.teamB.rosterId) : null;
            if (!a || !b) continue;
            const candidates = [String(lp.rosterA), String(lp.rosterB)];
            if (candidates.includes(a) || candidates.includes(b)) return r;
          }
          return null;
        })()}

        <div class="pair">
          {#if possible5th}
            <div class="team">
              <img class="avatar" src={avatarOrPlaceholder(possible5th.teamA.avatar, possible5th.teamA.name)} alt="">
              <div class="teamInfo"><div class="teamName">{possible5th.teamA.name}</div></div>
            </div>
            <div style="width:28px; text-align:center; color:#9aa3ad; font-weight:700;">vs</div>
            <div class="team">
              <img class="avatar" src={avatarOrPlaceholder(possible5th.teamB.avatar, possible5th.teamB.name)} alt="">
              <div class="teamInfo"><div class="teamName">{possible5th.teamB.name}</div></div>
            </div>
            <div class="score">
              <div class="scoreVal">
                <span class={possible5th.teamA.points > possible5th.teamB.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(possible5th.teamA.points)}</span>
                &nbsp;—&nbsp;
                <span class={possible5th.teamB.points > possible5th.teamA.points ? 'scoreVal winner' : 'scoreVal'}>{fmtPts(possible5th.teamB.points)}</span>
              </div>
              <div class="sub">Week {possible5th.week} — Consolation</div>
            </div>
          {:else}
            <div class="team"><div class="teamInfo"><div class="teamName">TBD</div></div></div>
            <div style="width:28px; text-align:center; color:#9aa3ad; font-weight:700;">vs</div>
            <div class="team"><div class="teamInfo"><div class="teamName">TBD</div></div></div>
            <div class="score"><div class="scoreVal">TBD</div><div class="sub">Week {semiWeek ?? '—'}</div></div>
          {/if}
        </div>
      {/each>

    </div>
  </div>
</div>
