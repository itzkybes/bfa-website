<script>
  // src/lib/PlayoffBrackets.svelte
  export let standings = [];
  export let season = null;
  export let titlePrefix = '';

  const is2022 = String(season) === '2022';
  const winnersSize = is2022 ? 6 : 8;
  const losersSize = is2022 ? 8 : 6;

  function teamObj(entry, idx) {
    if (!entry) return null;
    if (typeof entry === 'string') return { id: null, name: entry, placement: idx + 1, avatar: null };
    return { id: entry.id ?? entry.roster_id ?? null, name: entry.name ?? entry.display_name ?? `Team ${idx+1}`, avatar: entry.avatar ?? null, placement: entry.placement ?? idx+1 };
  }

  function fill(arr, n) {
    const out = arr.slice(0, n);
    while (out.length < n) out.push(null);
    return out;
  }

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
    const arr = participants.slice(0,8);
    while (arr.length < 8) arr.push(null);
    return build8(arr);
  }

  const winnersBracket = buildBracket(winnersParticipants);
  const losersBracket = buildBracket(losersParticipants);

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
</script>

<style>
  .brackets { display:flex; gap:1rem; align-items:flex-start; flex-wrap:wrap; }
  .bracket { flex:1 1 420px; background: rgba(255,255,255,0.01); padding:12px; border-radius:10px; }
  .bracket h3 { margin:0 0 8px 0; font-size:1.05rem; }
  .round { margin-bottom:12px; }
  .round-title { font-weight:700; margin-bottom:8px; color:#cfe7f6; }
  .match { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:8px; border-radius:8px; background: rgba(255,255,255,0.01); margin-bottom:8px; }
  .team { display:flex; align-items:center; gap:.6rem; min-width:0; }
  .team .name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; }
  .seed { color:#9ca3af; font-size:.85rem; }
  .label { color:#9ca3af; font-size:.95rem; }
  img.avatar { width:36px; height:36px; border-radius:6px; object-fit:cover; background:#081018; flex-shrink:0; }
</style>

<div class="brackets">
  <div class="bracket">
    <h3>{titlePrefix ? `${titlePrefix} ` : ''}Winners Bracket ({winnersParticipants.length})</h3>
    {#if winnersBracket.length === 0}
      <div class="label">No winners bracket data</div>
    {:else}
      {#each winnersBracket as round, rIdx}
        <div class="round">
          <div class="round-title">
            {#if rIdx === 0}Quarterfinals{:else if rIdx === 1}Semifinals{:else if rIdx === 2}Final{/if}
          </div>
          {#each round as match, mIdx}
            <div class="match" aria-label={"W-match-" + rIdx + "-" + mIdx}>
              <div class="team">
                {#if match.a && match.a.avatar}
                  <img class="avatar" src={match.a.avatar} alt="" />
                {/if}
                <div>
                  <div class="name">{displayName(match.a)}</div>
                  <div class="seed">{displaySeed(match.a)}</div>
                </div>
              </div>

              <div class="label">vs</div>

              <div class="team" style="justify-content:flex-end;">
                <div style="text-align:right;">
                  <div class="name">{displayName(match.b)}</div>
                  <div class="seed">{displaySeed(match.b)}</div>
                </div>
                {#if match.b && match.b.avatar}
                  <img class="avatar" src={match.b.avatar} alt="" />
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>

  <div class="bracket">
    <h3>{titlePrefix ? `${titlePrefix} ` : ''}Losers Bracket ({losersParticipants.length})</h3>
    {#if losersBracket.length === 0}
      <div class="label">No losers bracket data</div>
    {:else}
      {#each losersBracket as round, rIdx}
        <div class="round">
          <div class="round-title">
            {#if rIdx === 0}Quarterfinals{:else if rIdx === 1}Semifinals{:else if rIdx === 2}Final{/if}
          </div>
          {#each round as match, mIdx}
            <div class="match" aria-label={"L-match-" + rIdx + "-" + mIdx}>
              <div class="team">
                {#if match.a && match.a.avatar}
                  <img class="avatar" src={match.a.avatar} alt="" />
                {/if}
                <div>
                  <div class="name">{displayName(match.a)}</div>
                  <div class="seed">{displaySeed(match.a)}</div>
                </div>
              </div>

              <div class="label">vs</div>

              <div class="team" style="justify-content:flex-end;">
                <div style="text-align:right;">
                  <div class="name">{displayName(match.b)}</div>
                  <div class="seed">{displaySeed(match.b)}</div>
                </div>
                {#if match.b && match.b.avatar}
                  <img class="avatar" src={match.b.avatar} alt="" />
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
</div>
