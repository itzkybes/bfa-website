<!-- src/routes/honor-hall/+page.svelte -->
<script>
  export let data;

  // helper: return a readable owner label (prefer owner_name, then roster_meta.owner_name, then fallback to 'Roster <id>')
  function ownerLabelFor(item) {
    if (!item) return '';
    // prefer explicit owner_name
    if (item.owner_name) return item.owner_name;
    // prefer roster_meta if present
    if (item.roster_meta && item.roster_meta.owner_name) return item.roster_meta.owner_name;
    // sometimes the data includes owner object or owner display name
    if (item.owner && (item.owner.display_name || item.owner.username)) return item.owner.display_name || item.owner.username;
    // fallback to rosterId
    if (item.rosterId != null) return `Roster ${item.rosterId}`;
    if (item.roster_id != null) return `Roster ${item.roster_id}`;
    return '';
  }

  // seasons list and selection
  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id : null);

  // finalStandingsBySeason mapping returned by server
  const finalStandingsBySeason = data?.finalStandingsBySeason ?? {};
  // top-level fallbacks
  const finalStandingsFallback = Array.isArray(data?.finalStandings) ? data.finalStandings : [];
  let finalStandings = finalStandingsFallback;

  // more data helpers (kept from original file)
  const visibleSeason = selectedSeason;
  if (visibleSeason && finalStandingsBySeason && finalStandingsBySeason[visibleSeason]) {
    finalStandings = finalStandingsBySeason[visibleSeason];
  }

  // other helpers / state from original file (kept intact)
  const debug = data?.debug ?? null;
  const messages = data?.messages ?? [];
  const champion = data?.champion ?? null;
  const biggestLoser = data?.biggestLoser ?? null;
  const finalsMvp = data?.finalsMvp ?? null;
  const overallMvp = data?.overallMvp ?? null;

  // Helper: generate avatar or placeholder (kept from original)
  function avatarOrPlaceholder(candidate) {
    if (!candidate) return '/static/avatar-placeholder.png';
    if (typeof candidate === 'string' && (candidate.indexOf('http://') === 0 || candidate.indexOf('https://') === 0)) {
      return candidate;
    }
    return 'https://sleepercdn.com/avatars/' + encodeURIComponent(String(candidate));
  }
</script>

<style>
  /* Styles preserved from original file (trimmed here for brevity in message) */
  .standings-list { list-style: none; padding:0; margin:0; }
  .stand-row { display:flex; align-items:center; padding:8px 0; border-bottom:1px solid #f0f0f0; }
  .rank { width:40px; text-align:center; font-weight:600; }
  .teamName { font-weight:600; }
  .teamMeta { color:#6b7280; font-size:0.9rem; margin-top:3px; }
  .seedCol { margin-left:auto; color:#9aa3ad; }
  aside.outcomes { margin-top:20px; padding:12px; border-left:4px solid #eee;}
  .outcome-row { display:flex; gap:10px; align-items:center; margin-bottom:8px; }
  .avatar { border-radius:9999px; display:block; }
</style>

<div class="honor-hall wrap">
  <div style="display:flex; gap:24px; align-items:flex-start;">
    <section style="flex:1 1 60%;">
      <h2>Honor Hall</h2>

      <div style="margin-bottom:12px;">
        <label for="season">Season</label>
        <select id="season" bind:value={selectedSeason} on:change={() => {
          finalStandings = (finalStandingsBySeason && finalStandingsBySeason[selectedSeason]) ? finalStandingsBySeason[selectedSeason] : finalStandingsFallback;
        }}>
          {#each seasons as s}
            <option value={s.season ?? s.league_id}>{s.season ?? s.league_id}</option>
          {/each}
        </select>
      </div>

      <div>
        <h3 style="margin:0 0 12px 0">Final Standings</h3>
        <ul class="standings-list" role="list" aria-label="Final standings">
          {#if finalStandings && finalStandings.length}
            {#each finalStandings as row (row.rosterId)}
              <li class="stand-row" role="listitem">
                <div class="rank" aria-hidden="true">
                  <span>{row.rank}</span>
                </div>

                <div style="display:flex; gap:12px; align-items:center; min-width:0;">
                  <img class="avatar" src={avatarOrPlaceholder(row.roster_meta?.avatar ?? row.avatar ?? row.owner?.avatar)} alt="team avatar" style="width:44px;height:44px;border-radius:8px;">
                  <div style="min-width:0;">
                    <div class="teamName">{row.team_name}</div>
                    <div class="teamMeta">
                      {ownerLabelFor(row)}
                      {#if row.seed} • Seed #{row.seed}{/if}
                    </div>
                  </div>
                </div>

                <div class="seedCol">#{row.seed ?? '—'}</div>
              </li>
            {/each}
          {:else}
            <li>No final standings available for this season.</li>
          {/if}
        </ul>
      </div>
    </section>

    <aside class="outcomes" style="width:320px;">
      <h3 style="margin-top:0">Outcomes & Awards</h3>

      {#if champion}
        <div class="outcome-row">
          <img class="avatar" src={avatarOrPlaceholder(champion.roster_meta?.avatar ?? champion.avatar ?? champion.owner?.avatar)} alt="champion avatar" style="width:56px;height:56px">
          <div>
            <div class="outcome-name">Champion</div>
            <div class="small">{champion.team_name} • {ownerLabelFor(champion)} • Seed #{champion.seed}</div>
          </div>
        </div>
      {/if}

      {#if biggestLoser}
        <div class="outcome-row">
          <img class="avatar" src={avatarOrPlaceholder(biggestLoser.roster_meta?.avatar ?? biggestLoser.avatar ?? biggestLoser.owner?.avatar)} alt="biggest loser avatar" style="width:56px;height:56px">
          <div>
            <div class="outcome-name">Biggest Loser</div>
            <div class="small">{biggestLoser.team_name} • {ownerLabelFor(biggestLoser)} • Seed #{biggestLoser.seed}</div>
          </div>
        </div>
      {/if}

      {#if finalsMvp}
        <div style="margin-top:12px" class="outcome-row">
          <img class="avatar" src={avatarOrPlaceholder(finalsMvp.roster_meta?.avatar ?? finalsMvp.avatar ?? finalsMvp.owner?.avatar)} alt="finals mvp avatar" style="width:56px;height:56px">
          <div>
            <div class="outcome-name">Finals MVP</div>
            <div class="small">Player {finalsMvp.playerId} • {ownerLabelFor(finalsMvp)}</div>
          </div>
        </div>
      {/if}

      {#if overallMvp}
        <div style="margin-top:12px" class="outcome-row">
          <img class="avatar" src={avatarOrPlaceholder(overallMvp.roster_meta?.avatar ?? overallMvp.avatar ?? overallMvp.owner?.avatar)} alt="overall mvp avatar" style="width:56px;height:56px">
          <div>
            <div class="outcome-name">Overall MVP</div>
            <div class="small">Player {overallMvp.playerId} • {ownerLabelFor(overallMvp)}</div>
          </div>
        </div>
      {/if}

      <div style="margin-top:12px; color:#9aa3ad; font-size:.9rem">
        Final standings are derived from server-scrubbed matchups and tiebreak rules used to construct the bracket (matchups & tiebreaks).
      </div>
    </aside>
  </div>
</div>
