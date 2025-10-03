<script>
  // src/lib/PlayoffBrackets.svelte
  // Bracket column renderer — visual bracket layout with simple connectors
  export let standings = [];
  export let season = null;
  export let titlePrefix = '';

  // Determine bracket sizes
  const is2022 = String(season) === '2022';
  const winnersSize = is2022 ? 6 : 8;
  const losersSize = is2022 ? 8 : 6;

  // normalize an entry
  function teamObj(entry, idx) {
    if (!entry) return null;
    if (typeof entry === 'string') {
      return { id: null, name: entry, placement: idx + 1, avatar: null };
    }
    return {
      id: entry.id ?? entry.roster_id ?? null,
      name: entry.name ?? entry.display_name ?? entry.team ?? `Team ${idx + 1}`,
      avatar: entry.avatar ?? null,
      placement: entry.placement ?? idx + 1
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

  // Build bracket structures (same as before)
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
    // fallback: pad to 8
    const arr = participants.slice(0, 8);
    while (arr.length < 8) arr.push(null);
    return build8(arr);
  }

  const winnersBracket = buildBracket(winnersParticipants);
  const losersBracket = buildBracket(losersParticipants);

  // helpers for display
  function displayName(slot) {
    if (!slot) return 'TBD';
    if (slot.from) return 'Winner →';
    return slot.name ?? 'TBD';
  }
  function displaySeed(slot) {
    if (!slot) return '';
    if (slot.from) return '';
    if (slot.placement) return `#${slot.placement}`;
    return '';
  }

  // layout helpers: compute a "gap" for a column so rounds stack correctly
  // baseGap controls vertical spacing in round 0 (quarterfinals)
  const baseGap = 12; // px
  function gapForRound(roundIdx) {
    // doubling gap gives proper stacking alignment (quarter < semi < final)
    return baseGap * Math.pow(2, roundIdx);
  }

  // small utility to generate avatar placeholder URL
  function avatarOrPlaceholder(url, name, size=48) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?size=${size}&name=${encodeURIComponent(letter)}&background=0D1B2A&color=fff`;
  }
</script>

<style>
  .wrapper { display:flex; gap:1.2rem; align-items:flex-start; flex-wrap:wrap; }
  .bracketCard { flex:1 1 420px; min-width:300px; background: rgba(255,255,255,0.01); padding:14px; border-radius:12px; }
  .bracketTitle { margin:0 0 10px 0; font-weight:700; color:#e6eef8; }
  .rounds { display:flex; gap:1.2rem; align-items:flex-start; position:relative; }

  .round { display:flex; flex-direction:column; align-items:stretch; min-width:180px; }
  .roundHeader { text-align:center; font-weight:800; color:#9ec6ff; font-size:.95rem; margin-bottom:8px; }
  .roundSub { text-align:center; font-size:.82rem; color:#9ca3af; margin-bottom:6px; }

  .matchBox {
    display:flex;
    align-items:center;
    gap:0.8rem;
    padding:10px;
    border-radius:10px;
    background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
    color:inherit;
    min-height:56px;
    box-sizing: border-box;
    position:relative;
    flex-shrink:0;
  }

  .matchBox .left { display:flex; gap:.6rem; align-items:center; min-width:0; }
  .avatar { width:48px; height:48px; border-radius:8px; object-fit:cover; background:#081018; flex-shrink:0; }
  .teamInfo { display:flex; flex-direction:column; min-width:0; }
  .teamName { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:160px; }
  .seed { color:#9ca3af; font-size:.82rem; }

  /* connector – small horizontal line from match to the right (points to next column).
     We'll hide for last round. */
  .matchBox::after {
    content: "";
    position:absolute;
    right:-22px;
    top:50%;
    transform:translateY(-50%);
    width:18px;
    height:2px;
    background: rgba(156,163,175,0.25);
    border-radius:2px;
    display:block;
  }
  .noConnector::after { display:none; }

  /* vertical connector stub to visually link to next round chunk
     This is a subtle rounded bar that helps feel like a bracket */
  .connectorStub {
    position:absolute;
    right:-22px;
    top:50%;
    transform:translateY(-50%);
    width:18px;
    height:8px;
    border-radius:4px;
    background: rgba(156,163,175,0.12);
    display:block;
  }

  /* smaller seed badge on the avatar */
  .seedBadge {
    position:absolute;
    left: -6px;
    top: -6px;
    background: #0b1220;
    color: #9ec6ff;
    font-weight:700;
    font-size:11px;
    padding:3px 6px;
    border-radius:999px;
    border:1px solid rgba(255,255,255,0.04);
  }

  .roundCol { display:flex; flex-direction:column; gap:var(--gap, 12px); align-items:stretch; }

  .labelSuffix { font-size:12px; color:#9ca3af; margin-top:6px; text-align:center; }
  @media (max-width:900px) {
    .avatar { width:40px; height:40px; }
    .teamName { max-width:120px; }
    .bracketCard { padding:10px; }
    .round { min-width:150px; }
  }
</style>

<div class="wrapper">
  <!-- Winners bracket -->
  <div class="bracketCard">
    <div class="bracketTitle">{titlePrefix ? `${titlePrefix} ` : ''}Winners Bracket</div>
    <div class="rounds" role="group" aria-label="Winners bracket rounds">
      {#each winnersBracket as round, rIdx}
        <!-- compute gap for this round -->
        <div class="round" style="--gap: {gapForRound(rIdx)}px;">
          <div class="roundHeader">
            {#if rIdx === 0}Quarterfinals{:else if rIdx === 1}Semifinals{:else if rIdx === 2}Final{/if}
          </div>
          <div class="roundSub">Round {rIdx + 1}</div>

          <div class="roundCol" style="--gap: {gapForRound(rIdx)}px;">
            {#each round as match, mIdx}
              <div class="matchBox {rIdx === winnersBracket.length - 1 ? 'noConnector' : ''}" aria-label={"W-match-" + rIdx + "-" + mIdx}>
                <div class="left" style="position:relative;">
                  <!-- seed badge -->
                  {#if match.a && match.a.placement}
                    <div class="seedBadge">{match.a.placement}</div>
                  {/if}
                  {#if match.a && match.a.avatar}
                    <img class="avatar" src={match.a.avatar} alt="" />
                  {:else}
                    <img class="avatar" src={avatarOrPlaceholder(match.a?.avatar, displayName(match.a))} alt="" />
                  {/if}
                </div>

                <div class="teamInfo">
                  <div class="teamName">{displayName(match.a)}</div>
                  <div class="seed">{displaySeed(match.a)}</div>
                </div>

                <div style="margin-left:auto; text-align:center; min-width:64px;">
                  <div style="font-weight:800; color:#e6eef8;">{ /* scoreboard placeholder */ }—</div>
                  <div style="font-size:11px; color:#9ca3af;">{/* small helper */}</div>
                </div>

                <!-- connector stub only if not last round -->
                {#if rIdx !== winnersBracket.length - 1}
                  <div class="connectorStub" aria-hidden="true"></div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    <div class="labelSuffix">Winners bracket seeded top → bottom</div>
  </div>

  <!-- Losers bracket -->
  <div class="bracketCard">
    <div class="bracketTitle">{titlePrefix ? `${titlePrefix} ` : ''}Losers Bracket</div>
    <div class="rounds" role="group" aria-label="Losers bracket rounds">
      {#each losersBracket as round, rIdx}
        <div class="round" style="--gap: {gapForRound(rIdx)}px;">
          <div class="roundHeader">
            {#if rIdx === 0}Quarterfinals{:else if rIdx === 1}Semifinals{:else if rIdx === 2}Final{/if}
          </div>
          <div class="roundSub">Round {rIdx + 1}</div>

          <div class="roundCol" style="--gap: {gapForRound(rIdx)}px;">
            {#each round as match, mIdx}
              <div class="matchBox {rIdx === losersBracket.length - 1 ? 'noConnector' : ''}" aria-label={"L-match-" + rIdx + "-" + mIdx}>
                <div class="left" style="position:relative;">
                  {#if match.a && match.a.placement}
                    <div class="seedBadge">{match.a.placement}</div>
                  {/if}
                  {#if match.a && match.a.avatar}
                    <img class="avatar" src={match.a.avatar} alt="" />
                  {:else}
                    <img class="avatar" src={avatarOrPlaceholder(match.a?.avatar, displayName(match.a))} alt="" />
                  {/if}
                </div>

                <div class="teamInfo">
                  <div class="teamName">{displayName(match.a)}</div>
                  <div class="seed">{displaySeed(match.a)}</div>
                </div>

                <div style="margin-left:auto; text-align:center; min-width:64px;">
                  <div style="font-weight:800; color:#e6eef8;">—</div>
                </div>

                {#if rIdx !== losersBracket.length - 1}
                  <div class="connectorStub" aria-hidden="true"></div>
                {/if>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    <div class="labelSuffix">Losers bracket seeded top → bottom</div>
  </div>
</div>
