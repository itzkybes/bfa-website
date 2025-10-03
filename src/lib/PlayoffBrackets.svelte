<script>
  // src/lib/PlayoffBrackets.svelte
  // Single-column bracket renderer that shows actual scores if matchupsRows contains them.
  export let standings = [];
  export let season = null;
  export let titlePrefix = '';
  export let matchupsRows = []; // array of matchup rows from loader

  const is2022 = String(season) === '2022';
  const winnersSize = is2022 ? 6 : 8;
  const losersSize = is2022 ? 8 : 6;

  // normalize an entry
  function teamObj(entry, idx) {
    if (!entry) return null;
    if (typeof entry === 'string') return { id: null, name: entry, placement: idx + 1, avatar: null };
    return {
      id: entry.id ?? entry.roster_id ?? null,
      name: entry.name ?? entry.display_name ?? entry.team ?? `Team ${idx + 1}`,
      avatar: entry.avatar ?? null,
      placement: entry.placement ?? idx + 1,
      owner_display: entry.owner_display ?? null
    };
  }

  function fill(arr, n) {
    const out = arr.slice(0, n);
    while (out.length < n) out.push(null);
    return out;
  }

  const normalized = (standings || []).map((s, i) => teamObj(s, i));
  const winnersParticipants = fill(normalized.slice(0, winnersSize), winnersSize);
  const losersParticipants = fill(normalized.slice(winnersSize, winnersSize + losersSize), losersSize);

  // Build seeded bracket structure (8 or 6)
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

  // helper maps for matching
  const placementByName = {};
  for (const t of normalized) {
    if (t && t.name) placementByName[String(t.name).trim().toLowerCase()] = t.placement;
  }

  function lc(x){ return x ? String(x).trim().toLowerCase() : ''; }
  function fuzzyMatchName(a, b) {
    if (!a || !b) return false;
    const A = lc(a), B = lc(b);
    if (!A || !B) return false;
    if (A === B) return true;
    // loosened matching: if one contains the other
    if (A.includes(B) || B.includes(A)) return true;
    // remove non-alphanumerics and compare
    const a2 = A.replace(/[^a-z0-9]/g,''), b2 = B.replace(/[^a-z0-9]/g,'');
    if (a2 && b2 && (a2 === b2 || a2.includes(b2) || b2.includes(a2))) return true;
    return false;
  }

  // find a matchupsRows entry corresponding to a seeded slot (aSeed, bSeed), roundNumber is 1-based
  function findMatchForSlot(aSeed, bSeed, roundNumber, isWinners) {
    if (!Array.isArray(matchupsRows) || matchupsRows.length === 0) return null;
    // filter by round
    const cand = matchupsRows.filter(r => Number(r.round ?? 0) === Number(roundNumber));
    if (!cand.length) return null;

    // normalized seeded names
    const aName = aSeed?.name ?? null;
    const bName = bSeed?.name ?? null;
    const aPlace = aSeed?.placement ?? null;
    const bPlace = bSeed?.placement ?? null;

    // 1) exact both-team match using placement (if available on rows)
    for (const r of cand) {
      const ra = r.teamA?.name ?? null, rb = r.teamB?.name ?? null;
      if (!ra && !rb) continue;
      // placements if present on row
      const rAplace = r.teamA?.placement ?? null;
      const rBplace = r.teamB?.placement ?? null;
      if (aPlace && bPlace && rAplace && rBplace) {
        if ((Number(rAplace) === Number(aPlace) && Number(rBplace) === Number(bPlace)) ||
            (Number(rAplace) === Number(bPlace) && Number(rBplace) === Number(aPlace))) {
          return r;
        }
      }
    }

    // 2) exact name match both sides
    for (const r of cand) {
      const ra = r.teamA?.name ?? null, rb = r.teamB?.name ?? null;
      if (ra && rb && aName && bName && (fuzzyMatchName(ra, aName) && fuzzyMatchName(rb, bName) || fuzzyMatchName(ra, bName) && fuzzyMatchName(rb, aName))) {
        return r;
      }
    }

    // 3) partial single-side match (if the seeded slot was BYE on one side or order mismatch)
    // prefer matches where at least one participant matches a seeded name or placement
    for (const r of cand) {
      const ra = r.teamA?.name ?? null, rb = r.teamB?.name ?? null;
      const rAplace = r.teamA?.placement ?? null;
      const rBplace = r.teamB?.placement ?? null;

      const aMatches = aName && (fuzzyMatchName(ra, aName) || (aPlace && Number(rAplace) === Number(aPlace)));
      const bMatches = bName && (fuzzyMatchName(rb, bName) || (bPlace && Number(rBplace) === Number(bPlace)));
      const altAMatches = aName && (fuzzyMatchName(rb, aName) || (aPlace && Number(rBplace) === Number(aPlace)));
      const altBMatches = bName && (fuzzyMatchName(ra, bName) || (bPlace && Number(rAplace) === Number(bPlace)));

      if ((aMatches && !bName) || (bMatches && !aName)) return r;
      if ((aMatches && bMatches) || (altAMatches && altBMatches)) return r;
      // also accept cases where at least one side matches
      if (aMatches || bMatches || altAMatches || altBMatches) return r;
    }

    // 4) as a last resort, return first candidate that appears to belong to the bracket (by placement)
    for (const r of cand) {
      const ra = r.teamA?.name ?? null, rb = r.teamB?.name ?? null;
      const rAplace = r.teamA?.placement ?? null, rBplace = r.teamB?.placement ?? null;
      // is this match in winners or losers by placement?
      if (rAplace || rBplace) {
        if (isWinners) {
          if ((rAplace && rAplace <= winnersSize) || (rBplace && rBplace <= winnersSize)) return r;
        } else {
          if ((rAplace && rAplace > winnersSize) || (rBplace && rBplace > winnersSize)) return r;
        }
      }
    }

    return null;
  }

  // format score
  function fmtScore(v) {
    if (v == null) return '—';
    const n = Number(v);
    if (Number.isNaN(n)) return '—';
    // show one decimal to match other tabs; remove trailing 0
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

  .bye { background: linear-gradient(90deg, rgba(17,204,102,0.12), rgba(17,204,102,0.08)); color:#0b2b18; padding:6px 10px; border-radius:8px; font-weight:800; }

  .seedBadge { background:#071628; color:var(--accent); border-radius:999px; padding:4px 8px; font-weight:800; margin-right:6px; font-size:12px; border:1px solid rgba(255,255,255,0.03); }

  @media (max-width:900px) {
    .teamName { max-width:140px; }
    .scoreBox { min-width:72px; font-size:.95rem; }
    .avatar { width:40px; height:40px; }
  }
</style>

<div class="col">
  <!-- Winners bracket section -->
  <div class="section">
    <div class="titleRow">
      <div>
        <div class="title">{titlePrefix ? `${titlePrefix} ` : ''}Winners Bracket</div>
        <div class="subtitle">Seeded top → bottom</div>
      </div>
      <div class="subtitle">Quarterfinals • Semifinals • Final</div>
    </div>

    <!-- rounds vertically stacked inside the same section -->
    {#each winnersBracket as round, rIdx}
      <div class="roundBlock">
        <div class="roundHeader">
          {#if rIdx === 0}Quarterfinals{:else if rIdx === 1}Semifinals{:else if rIdx === 2}Final{/if}
        </div>

        <div class="matches">
          {#each round as match, mIdx}
            { /* seeded slot: match.a (seeded team) vs match.b (seeded team) */ }
            {@const seededA = match.a}
            {@const seededB = match.b}
            {@const roundNumber = rIdx + 1}
            {@const found = findMatchForSlot(seededA, seededB, roundNumber, true)}

            {#if found}
              <!-- render the actual matchup row using found.teamA/ teamB and scores -->
              <div class="matchRow">
                <div class="teamCol">
                  {#if found.teamA?.placement}
                    <div class="seedBadge">#{found.teamA.placement}</div>
                  {/if}
                  <img class="avatar" src={found.teamA?.avatar ? found.teamA.avatar : avatarOrPlaceholder(found.teamA?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{found.teamA?.name ?? 'TBD'}</div>
                    {#if found.teamA?.owner_display}<div class="teamMeta">{found.teamA.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="vs">vs</div>

                <div class="teamCol" style="margin-left:8px;">
                  <img class="avatar" src={found.teamB?.avatar ? found.teamB.avatar : avatarOrPlaceholder(found.teamB?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{found.teamB?.name ?? 'TBD'}</div>
                    {#if found.teamB?.owner_display}<div class="teamMeta">{found.teamB.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="scoreBox">
                  <div>{fmtScore(found.teamA?.points)} — {fmtScore(found.teamB?.points)}</div>
                </div>
              </div>
            {:else}
              <!-- fallback to seeded placeholder row -->
              <div class="matchRow">
                <div class="teamCol">
                  {#if seededA?.placement}
                    <div class="seedBadge">#{seededA.placement}</div>
                  {/if}
                  <img class="avatar" src={seededA?.avatar ? seededA.avatar : avatarOrPlaceholder(seededA?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{seededA?.name ?? 'TBD'}</div>
                    {#if seededA?.owner_display}<div class="teamMeta">{seededA.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="vs">vs</div>

                <div class="teamCol" style="margin-left:8px;">
                  <img class="avatar" src={seededB?.avatar ? seededB.avatar : avatarOrPlaceholder(seededB?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{seededB?.name ?? 'TBD'}</div>
                    {#if seededB?.owner_display}<div class="teamMeta">{seededB.owner_display}</div>{/if}
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

  <!-- Losers bracket section -->
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
          {#if rIdx === 0}Quarterfinals{:else if rIdx === 1}Semifinals{:else if rIdx === 2}Final{/if}
        </div>

        <div class="matches">
          {#each round as match, mIdx}
            {@const seededA = match.a}
            {@const seededB = match.b}
            {@const roundNumber = rIdx + 1}
            {@const found = findMatchForSlot(seededA, seededB, roundNumber, false)}

            {#if found}
              <div class="matchRow">
                <div class="teamCol">
                  {#if found.teamA?.placement}
                    <div class="seedBadge">#{found.teamA.placement}</div>
                  {/if}
                  <img class="avatar" src={found.teamA?.avatar ? found.teamA.avatar : avatarOrPlaceholder(found.teamA?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{found.teamA?.name ?? 'TBD'}</div>
                    {#if found.teamA?.owner_display}<div class="teamMeta">{found.teamA.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="vs">vs</div>

                <div class="teamCol" style="margin-left:8px;">
                  <img class="avatar" src={found.teamB?.avatar ? found.teamB.avatar : avatarOrPlaceholder(found.teamB?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{found.teamB?.name ?? 'TBD'}</div>
                    {#if found.teamB?.owner_display}<div class="teamMeta">{found.teamB.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="scoreBox">
                  <div>{fmtScore(found.teamA?.points)} — {fmtScore(found.teamB?.points)}</div>
                </div>
              </div>
            {:else}
              <div class="matchRow">
                <div class="teamCol">
                  {#if seededA?.placement}
                    <div class="seedBadge">#{seededA.placement}</div>
                  {/if}
                  <img class="avatar" src={seededA?.avatar ? seededA.avatar : avatarOrPlaceholder(seededA?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{seededA?.name ?? 'TBD'}</div>
                    {#if seededA?.owner_display}<div class="teamMeta">{seededA.owner_display}</div>{/if}
                  </div>
                </div>

                <div class="vs">vs</div>

                <div class="teamCol" style="margin-left:8px;">
                  <img class="avatar" src={seededB?.avatar ? seededB.avatar : avatarOrPlaceholder(seededB?.name)} alt="">
                  <div style="min-width:0;">
                    <div class="teamName">{seededB?.name ?? 'TBD'}</div>
                    {#if seededB?.owner_display}<div class="teamMeta">{seededB.owner_display}</div>{/if}
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
