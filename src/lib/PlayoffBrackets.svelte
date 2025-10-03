<script>
  // src/lib/PlayoffBrackets.svelte
  // Prefer display_name from standings and robust avatar fallbacks

  export let standings = [];       // ordered by placement (index 0 == 1st)
  export let season = null;
  export let titlePrefix = '';
  export let matchupsRows = [];    // server-provided match rows; expected to have teamA/teamB/round/points/placement/roster_id etc.

  const is2022 = String(season) === '2022';
  const winnersSize = is2022 ? 6 : 8;
  const losersSize = is2022 ? 8 : 6;

  function pickAvatar(entry) {
    if (!entry) return null;
    return entry.avatar ?? entry.photo_url ?? entry.logo ?? entry.team_avatar ?? entry.owner_avatar ?? entry.image_url ?? null;
  }

  function pickName(entry, idx) {
    if (!entry) return null;
    // prefer display_name which your loader uses
    return entry.display_name ?? entry.name ?? entry.owner_display ?? entry.owner ?? entry.team ?? `Team ${idx + 1}`;
  }

  function teamObj(entry, idx) {
    if (!entry) return null;
    if (typeof entry === 'string') return { id: null, name: entry, placement: idx + 1, avatar: null, owner_display: null };
    return {
      id: entry.id ?? entry.roster_id ?? null,
      name: pickName(entry, idx),
      avatar: pickAvatar(entry),
      placement: entry.placement ?? (idx + 1),
      owner_display: entry.owner_display ?? entry.owner ?? null
    };
  }

  function fill(arr, n) {
    const out = arr.slice(0, n);
    while (out.length < n) out.push(null);
    return out;
  }

  // normalized standings use the correct display_name & avatar fallback
  const normalized = (standings || []).map((s, i) => teamObj(s, i));
  const winnersParticipants = fill(normalized.slice(0, winnersSize), winnersSize);
  const losersParticipants = fill(normalized.slice(winnersSize, winnersSize + losersSize), losersSize);

  function build8(participants) {
    const qPairs = [[0,7],[3,4],[2,5],[1,6]];
    const quarter = qPairs.map((p, i) => ({ a: participants[p[0]] ?? null, b: participants[p[1]] ?? null, id: `q${i+1}` }));
    const semi = [
      { a: { from: { round: 0, match: 0 } }, b: { from: { round: 0, match: 1 } }, id: 's1' },
      { a: { from: { round: 0, match: 2 } }, b: { from: { round: 0, match: 3 } }, id: 's2' }
    ];
    const final = [{ a: { from: { round: 1, match: 0 } }, b: { from: { round: 1, match: 1 } }, id: 'f1' }];
    return [quarter, semi, final];
  }

  function build6(participants) {
    const quarter = [
      { a: participants[2] ?? null, b: participants[5] ?? null, id: 'q1' },
      { a: participants[3] ?? null, b: participants[4] ?? null, id: 'q2' }
    ];
    const semi = [
      { a: participants[0] ?? null, b: { from: { round: 0, match: 1 } }, id: 's1' },
      { a: participants[1] ?? null, b: { from: { round: 0, match: 0 } }, id: 's2' }
    ];
    const final = [{ a: { from: { round: 1, match: 0 } }, b: { from: { round: 1, match: 1 } }, id: 'f1' }];
    return [quarter, semi, final];
  }

  function buildBracket(participants) {
    if (!participants || participants.length === 0) return [];
    if (participants.length === 8) return build8(participants);
    if (participants.length === 6) return build6(participants);
    const arr = participants.slice(0, 8);
    while (arr.length < 8) arr.push(null);
    return build8(arr);
  }

  const winnersBracket = buildBracket(winnersParticipants);
  const losersBracket = buildBracket(losersParticipants);

  // maps for easy enrichment from standings
  const placementMap = {};
  const idMap = {};
  const lowerNameMap = {};
  for (const t of normalized) {
    if (!t) continue;
    if (t.placement != null) placementMap[Number(t.placement)] = t;
    if (t.id != null) idMap[String(t.id)] = t;
    if (t.name) lowerNameMap[String(t.name).trim().toLowerCase()] = t;
  }

  function lc(x){ return x ? String(x).trim().toLowerCase() : ''; }
  function fuzzyMatchName(a, b) {
    if (!a || !b) return false;
    const A = lc(a), B = lc(b);
    if (!A || !B) return false;
    if (A === B) return true;
    if (A.includes(B) || B.includes(A)) return true;
    const a2 = A.replace(/[^a-z0-9]/g,''), b2 = B.replace(/[^a-z0-9]/g,'');
    if (a2 && b2 && (a2 === b2 || a2.includes(b2) || b2.includes(a2))) return true;
    return false;
  }

  // enrich match side using standings (prefer roster_id / id -> placement -> fuzzy name)
  function enrichSide(side) {
    if (!side) return side;
    const s = { ...(side || {}) };

    if (s.roster_id && idMap[String(s.roster_id)]) {
      const seed = idMap[String(s.roster_id)];
      s._seedMatched = true;
      s.name = seed.name || s.name;
      s.avatar = s.avatar || seed.avatar;
      s.placement = seed.placement ?? s.placement;
      return s;
    }
    if (s.id && idMap[String(s.id)]) {
      const seed = idMap[String(s.id)];
      s._seedMatched = true;
      s.name = seed.name || s.name;
      s.avatar = s.avatar || seed.avatar;
      s.placement = seed.placement ?? s.placement;
      return s;
    }

    if (s.placement && placementMap[Number(s.placement)]) {
      const seed = placementMap[Number(s.placement)];
      s._seedMatched = true;
      s.name = seed.name || s.name;
      s.avatar = s.avatar || seed.avatar;
      s.placement = seed.placement ?? s.placement;
      return s;
    }

    if (s.name) {
      const lower = lc(s.name);
      if (lowerNameMap[lower]) {
        const seed = lowerNameMap[lower];
        s._seedMatched = true;
        s.name = seed.name || s.name;
        s.avatar = s.avatar || seed.avatar;
        s.placement = seed.placement ?? s.placement;
        return s;
      }
      for (const cand of normalized) {
        if (!cand || !cand.name) continue;
        if (fuzzyMatchName(cand.name, s.name)) {
          s._seedMatched = true;
          s.name = cand.name || s.name;
          s.avatar = s.avatar || cand.avatar;
          s.placement = cand.placement ?? s.placement;
          return s;
        }
      }
    }

    return s;
  }

  // find match in matchupsRows for seeded slot (aSeed,bSeed) using roundNumber (1-based)
  function findMatchForSlot(aSeed, bSeed, roundNumber, isWinners) {
    if (!Array.isArray(matchupsRows) || matchupsRows.length === 0) return null;
    const cand = matchupsRows.filter(r => Number(r.round ?? 0) === Number(roundNumber));
    if (!cand.length) return null;

    const aName = aSeed?.name ?? null;
    const bName = bSeed?.name ?? null;
    const aPlace = aSeed?.placement ?? null;
    const bPlace = bSeed?.placement ?? null;

    // 1) exact placement match
    for (const r of cand) {
      const rAplace = r.teamA?.placement ?? r.teamA?.seed ?? null;
      const rBplace = r.teamB?.placement ?? r.teamB?.seed ?? null;
      if (aPlace && bPlace && rAplace && rBplace) {
        if ((Number(rAplace) === Number(aPlace) && Number(rBplace) === Number(bPlace)) ||
            (Number(rAplace) === Number(bPlace) && Number(rBplace) === Number(aPlace))) {
          return { teamA: enrichSide(r.teamA), teamB: enrichSide(r.teamB) };
        }
      }
    }

    // 2) fuzzy both-team match
    for (const r of cand) {
      const ra = r.teamA?.name ?? null, rb = r.teamB?.name ?? null;
      if (ra && rb && aName && bName) {
        if ((fuzzyMatchName(ra, aName) && fuzzyMatchName(rb, bName)) ||
            (fuzzyMatchName(ra, bName) && fuzzyMatchName(rb, aName))) {
          return { teamA: enrichSide(r.teamA), teamB: enrichSide(r.teamB) };
        }
      }
    }

    // 3) single-side fuzzy / placement heuristics
    for (const r of cand) {
      const ra = r.teamA?.name ?? null, rb = r.teamB?.name ?? null;
      const rAplace = r.teamA?.placement ?? null, rBplace = r.teamB?.placement ?? null;

      const aMatches = aName && (fuzzyMatchName(ra, aName) || (aPlace && Number(rAplace) === Number(aPlace)));
      const bMatches = bName && (fuzzyMatchName(rb, bName) || (bPlace && Number(rBplace) === Number(bPlace)));
      const altAMatches = aName && (fuzzyMatchName(rb, aName) || (aPlace && Number(rBplace) === Number(aPlace)));
      const altBMatches = bName && (fuzzyMatchName(ra, bName) || (bPlace && Number(rAplace) === Number(bPlace)));

      if ((aMatches && !bName) || (bMatches && !aName)) return { teamA: enrichSide(r.teamA), teamB: enrichSide(r.teamB) };
      if (aMatches && bMatches) return { teamA: enrichSide(r.teamA), teamB: enrichSide(r.teamB) };
      if (altAMatches && altBMatches) return { teamA: enrichSide(r.teamA), teamB: enrichSide(r.teamB) };
      if (aMatches || bMatches || altAMatches || altBMatches) return { teamA: enrichSide(r.teamA), teamB: enrichSide(r.teamB) };
    }

    // 4) fallback by bracket membership (winners vs losers)
    for (const r of cand) {
      const rAplace = r.teamA?.placement ?? null, rBplace = r.teamB?.placement ?? null;
      if (rAplace || rBplace) {
        if (isWinners) {
          if ((rAplace && rAplace <= winnersSize) || (rBplace && rBplace <= winnersSize)) return { teamA: enrichSide(r.teamA), teamB: enrichSide(r.teamB) };
        } else {
          if ((rAplace && rAplace > winnersSize) || (rBplace && rBplace > winnersSize)) return { teamA: enrichSide(r.teamA), teamB: enrichSide(r.teamB) };
        }
      }
    }

    return null;
  }

  // precompute found maps using safe concatenated keys (no template literal in template)
  $: winnersFoundMap = {};
  $: {
    winnersFoundMap = {};
    winnersBracket.forEach((round, rIdx) => {
      round.forEach((match, mIdx) => {
        const key = rIdx + '_' + mIdx;
        winnersFoundMap[key] = findMatchForSlot(match.a, match.b, rIdx + 1, true);
      });
    });
  }

  $: losersFoundMap = {};
  $: {
    losersFoundMap = {};
    losersBracket.forEach((round, rIdx) => {
      round.forEach((match, mIdx) => {
        const key = rIdx + '_' + mIdx;
        losersFoundMap[key] = findMatchForSlot(match.a, match.b, rIdx + 1, false);
      });
    });
  }

  function fmtScore(v) {
    if (v == null) return '—';
    const n = Number(v);
    if (Number.isNaN(n)) return '—';
    let s = n.toFixed(2);
    s = s.replace(/\.?0+$/, '');
    return s;
  }

  function avatarOrPlaceholder(url, name, size=48) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?size=${size}&name=${encodeURIComponent(letter)}&background=0D1B2A&color=fff`;
  }
</script>

<style>
  :global(:root) {
    --bg-card: rgba(255,255,255,0.02);
    --muted: #9ca3af;
    --accent: #9ec6ff;
    --text: #e6eef8;
  }

  .col { display:flex; flex-direction:column; gap:18px; width:100%; max-width:1100px; margin:0 auto; padding:12px; box-sizing:border-box; }
  .section { background: var(--bg-card); padding:12px; border-radius:12px; }
  .titleRow { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
  .title { font-weight:800; color:var(--text); font-size:1.05rem; }
  .subtitle { color:var(--muted); font-size:.9rem; }

  .roundBlock { margin-top:6px; }
  .roundHeader { font-weight:700; color:var(--accent); font-size:.95rem; margin-bottom:6px; }
  .matches { display:flex; flex-direction:column; gap:10px; }

  .matchRow { display:flex; align-items:center; gap:12px; padding:10px; border-radius:10px; background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.02)); }
  .teamCol { display:flex; align-items:center; gap:10px; min-width:0; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; }
  .teamName { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:240px; color:var(--text); }
  .teamMeta { color:var(--muted); font-size:.85rem; }
  .scoreBox { margin-left:auto; min-width:90px; text-align:center; font-weight:800; color:var(--text); }
  .vs { color:var(--muted); font-weight:700; padding:0 8px; }

  .seedBadge { background:#071628; color:var(--accent); border-radius:999px; padding:4px 8px; font-weight:800; margin-right:6px; font-size:12px; border:1px solid rgba(255,255,255,0.03); }

  @media (max-width:900px) {
    .teamName { max-width:140px; }
    .scoreBox { min-width:72px; font-size:.95rem; }
    .avatar { width:40px; height:40px; }
  }
</style>

<div class="col">
  <!-- Winners bracket -->
  <div class="section">
    <div class="titleRow">
      <div>
        <div class="title">{titlePrefix ? `${titlePrefix} ` : ''}Winners Bracket</div>
        <div class="subtitle">Seeded top → bottom</div>
      </div>
      <div class="subtitle">Quarterfinals • Semifinals • Final</div>
    </div>

    {#each winnersBracket as round, rIdx}
      <div class="roundBlock">
        <div class="roundHeader">
          {#if rIdx === 0}Quarterfinals{:else if rIdx === 1}Semifinals{:else}Final{/if}
        </div>

        <div class="matches">
          {#each round as match, mIdx}
            {#if winnersFoundMap[rIdx + '_' + mIdx]}
              <div class="matchRow">
                <div class="teamCol">
                  {#if winnersFoundMap[rIdx + '_' + mIdx].teamA?.placement}
                    <div class="seedBadge">#{winnersFoundMap[rIdx + '_' + mIdx].teamA.placement}</div>
                  {/if}
                  <img class="avatar" src={winnersFoundMap[rIdx + '_' + mIdx].teamA?.avatar ? winnersFoundMap[rIdx + '_' + mIdx].teamA.avatar : avatarOrPlaceholder(winnersFoundMap[rIdx + '_' + mIdx].teamA?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{winnersFoundMap[rIdx + '_' + mIdx].teamA?.name ?? 'TBD'}</div>
                    {#if winnersFoundMap[rIdx + '_' + mIdx].teamA?.owner_display}<div class="teamMeta">{winnersFoundMap[rIdx + '_' + mIdx].teamA.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="vs">vs</div>

                <div class="teamCol" style="margin-left:8px;">
                  <img class="avatar" src={winnersFoundMap[rIdx + '_' + mIdx].teamB?.avatar ? winnersFoundMap[rIdx + '_' + mIdx].teamB.avatar : avatarOrPlaceholder(winnersFoundMap[rIdx + '_' + mIdx].teamB?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{winnersFoundMap[rIdx + '_' + mIdx].teamB?.name ?? 'TBD'}</div>
                    {#if winnersFoundMap[rIdx + '_' + mIdx].teamB?.owner_display}<div class="teamMeta">{winnersFoundMap[rIdx + '_' + mIdx].teamB.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="scoreBox">{fmtScore(winnersFoundMap[rIdx + '_' + mIdx].teamA?.points)} — {fmtScore(winnersFoundMap[rIdx + '_' + mIdx].teamB?.points)}</div>
              </div>
            {:else}
              <div class="matchRow">
                <div class="teamCol">
                  {#if match.a?.placement}
                    <div class="seedBadge">#{match.a.placement}</div>
                  {/if}
                  <img class="avatar" src={match.a?.avatar ? match.a.avatar : avatarOrPlaceholder(match.a?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{match.a?.name ?? 'TBD'}</div>
                    {#if match.a?.owner_display}<div class="teamMeta">{match.a.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="vs">vs</div>

                <div class="teamCol" style="margin-left:8px;">
                  <img class="avatar" src={match.b?.avatar ? match.b.avatar : avatarOrPlaceholder(match.b?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{match.b?.name ?? 'TBD'}</div>
                    {#if match.b?.owner_display}<div class="teamMeta">{match.b.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="scoreBox">—</div>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Losers bracket -->
  <div class="section">
    <div class="titleRow">
      <div>
        <div class="title">{titlePrefix ? `${titlePrefix} ` : ''}Losers Bracket</div>
        <div class="subtitle">Seeded top → bottom</div>
      </div>
      <div class="subtitle">Quarterfinals • Semifinals • Final</div>
    </div>

    {#each losersBracket as round, rIdx}
      <div class="roundBlock">
        <div class="roundHeader">
          {#if rIdx === 0}Quarterfinals{:else if rIdx === 1}Semifinals{:else}Final{/if}
        </div>

        <div class="matches">
          {#each round as match, mIdx}
            {#if losersFoundMap[rIdx + '_' + mIdx]}
              <div class="matchRow">
                <div class="teamCol">
                  {#if losersFoundMap[rIdx + '_' + mIdx].teamA?.placement}
                    <div class="seedBadge">#{losersFoundMap[rIdx + '_' + mIdx].teamA.placement}</div>
                  {/if}
                  <img class="avatar" src={losersFoundMap[rIdx + '_' + mIdx].teamA?.avatar ? losersFoundMap[rIdx + '_' + mIdx].teamA.avatar : avatarOrPlaceholder(losersFoundMap[rIdx + '_' + mIdx].teamA?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{losersFoundMap[rIdx + '_' + mIdx].teamA?.name ?? 'TBD'}</div>
                    {#if losersFoundMap[rIdx + '_' + mIdx].teamA?.owner_display}<div class="teamMeta">{losersFoundMap[rIdx + '_' + mIdx].teamA.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="vs">vs</div>

                <div class="teamCol" style="margin-left:8px;">
                  <img class="avatar" src={losersFoundMap[rIdx + '_' + mIdx].teamB?.avatar ? losersFoundMap[rIdx + '_' + mIdx].teamB.avatar : avatarOrPlaceholder(losersFoundMap[rIdx + '_' + mIdx].teamB?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{losersFoundMap[rIdx + '_' + mIdx].teamB?.name ?? 'TBD'}</div>
                    {#if losersFoundMap[rIdx + '_' + mIdx].teamB?.owner_display}<div class="teamMeta">{losersFoundMap[rIdx + '_' + mIdx].teamB.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="scoreBox">{fmtScore(losersFoundMap[rIdx + '_' + mIdx].teamA?.points)} — {fmtScore(losersFoundMap[rIdx + '_' + mIdx].teamB?.points)}</div>
              </div>
            {:else}
              <div class="matchRow">
                <div class="teamCol">
                  {#if match.a?.placement}
                    <div class="seedBadge">#{match.a.placement}</div>
                  {/if}
                  <img class="avatar" src={match.a?.avatar ? match.a.avatar : avatarOrPlaceholder(match.a?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{match.a?.name ?? 'TBD'}</div>
                    {#if match.a?.owner_display}<div class="teamMeta">{match.a.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="vs">vs</div>

                <div class="teamCol" style="margin-left:8px;">
                  <img class="avatar" src={match.b?.avatar ? match.b.avatar : avatarOrPlaceholder(match.b?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{match.b?.name ?? 'TBD'}</div>
                    {#if match.b?.owner_display}<div class="teamMeta">{match.b.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="scoreBox">—</div>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>
