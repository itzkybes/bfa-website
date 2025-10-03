<script>
  // src/lib/PlayoffBrackets.svelte
  // Simpler approach: use final standings to assign display names to every bracket slot.
  // Only use matchupsRows to fill scores when there's an exact placement->placement match for the round.

  export let standings = [];       // ordered by placement (index 0 == 1st). prefer display_name
  export let season = null;
  export let titlePrefix = '';
  export let matchupsRows = [];    // used only for exact placement score matching (round + placements)

  const is2022 = String(season) === '2022';
  const winnersSize = is2022 ? 6 : 8;
  const losersSize = is2022 ? 8 : 6;

  function pickAvatar(entry) {
    if (!entry) return null;
    return entry.avatar ?? entry.photo_url ?? entry.logo ?? entry.team_avatar ?? entry.owner_avatar ?? entry.image_url ?? null;
  }
  function pickName(entry, idx) {
    if (!entry) return null;
    return entry.display_name ?? entry.name ?? entry.owner_display ?? entry.owner ?? entry.team ?? `Team ${idx + 1}`;
  }

  // normalize standings into simple objects we will seed into brackets
  const normalized = (standings || []).map((s, i) => {
    if (!s) return null;
    return {
      id: s.id ?? s.roster_id ?? null,
      name: pickName(s, i),
      avatar: pickAvatar(s),
      placement: s.placement ?? (i + 1),
      owner_display: s.owner_display ?? s.owner ?? null
    };
  });

  function fill(arr, n) {
    const out = arr.slice(0, n);
    while (out.length < n) out.push(null);
    return out;
  }

  const winnersParticipants = fill(normalized.slice(0, winnersSize), winnersSize);
  const losersParticipants = fill(normalized.slice(winnersSize, winnersSize + losersSize), losersSize);

  // build bracket slot shapes (same shapes as before)
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

  // find a match in matchupsRows based on exact placement matching (no fuzzy).
  // We'll mark usedIndices so we don't reuse the same matchup row multiple times.
  function findMatchByPlacement(aPlacement, bPlacement, roundNumber, usedIndices) {
    if (!Array.isArray(matchupsRows) || matchupsRows.length === 0) return null;
    for (let i = 0; i < matchupsRows.length; i++) {
      if (usedIndices.has(i)) continue;
      const r = matchupsRows[i];
      if (Number(r.round ?? 0) !== Number(roundNumber)) continue;

      // only consider rows with explicit placements on both sides
      const rAplace = r.teamA?.placement ?? r.teamA?.seed ?? null;
      const rBplace = r.teamB?.placement ?? r.teamB?.seed ?? null;
      if (!rAplace || !rBplace) continue;

      if ((Number(rAplace) === Number(aPlacement) && Number(rBplace) === Number(bPlacement)) ||
          (Number(rAplace) === Number(bPlacement) && Number(rBplace) === Number(aPlacement))) {
        usedIndices.add(i);
        // normalize returned object: teamA/teamB with name/avatar/points/placement
        return {
          teamA: {
            name: r.teamA?.display_name ?? r.teamA?.name ?? r.teamA?.owner_display ?? r.teamA?.owner ?? null,
            avatar: r.teamA?.avatar ?? r.teamA?.photo_url ?? r.teamA?.logo ?? null,
            placement: rAplace,
            points: r.teamA?.points ?? r.teamA?.score ?? r.teamA?.total_points ?? null
          },
          teamB: {
            name: r.teamB?.display_name ?? r.teamB?.name ?? r.teamB?.owner_display ?? r.teamB?.owner ?? null,
            avatar: r.teamB?.avatar ?? r.teamB?.photo_url ?? r.teamB?.logo ?? null,
            placement: rBplace,
            points: r.teamB?.points ?? r.teamB?.score ?? r.teamB?.total_points ?? null
          }
        };
      }
    }
    return null;
  }

  // compute score lookups once using a fresh usedIndices set
  $: winnersScoreMap = {};
  $: losersScoreMap = {};
  $: {
    winnersScoreMap = {};
    losersScoreMap = {};
    const used = new Set();

    // winners: round indexes are 0-based in bracket; treat roundNumber = rIdx + 1
    winnersBracket.forEach((round, rIdx) => {
      round.forEach((match, mIdx) => {
        const aPlace = match.a?.placement ?? null;
        const bPlace = match.b?.placement ?? null;
        const key = rIdx + '_' + mIdx;
        if (aPlace && bPlace) {
          const found = findMatchByPlacement(aPlace, bPlace, rIdx + 1, used);
          winnersScoreMap[key] = found;
        } else {
          winnersScoreMap[key] = null;
        }
      });
    });

    // losers
    losersBracket.forEach((round, rIdx) => {
      round.forEach((match, mIdx) => {
        const aPlace = match.a?.placement ?? null;
        const bPlace = match.b?.placement ?? null;
        const key = rIdx + '_' + mIdx;
        if (aPlace && bPlace) {
          const found = findMatchByPlacement(aPlace, bPlace, rIdx + 1, used);
          losersScoreMap[key] = found;
        } else {
          losersScoreMap[key] = null;
        }
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

              <div class="scoreBox">
                {#if winnersScoreMap[rIdx + '_' + mIdx]}
                  {fmtScore(winnersScoreMap[rIdx + '_' + mIdx].teamA?.points)} — {fmtScore(winnersScoreMap[rIdx + '_' + mIdx].teamB?.points)}
                {:else}
                  —
                {/if}
              </div>
            </div>
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

              <div class="scoreBox">
                {#if losersScoreMap[rIdx + '_' + mIdx]}
                  {fmtScore(losersScoreMap[rIdx + '_' + mIdx].teamA?.points)} — {fmtScore(losersScoreMap[rIdx + '_' + mIdx].teamB?.points)}
                {:else}
                  —
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>
