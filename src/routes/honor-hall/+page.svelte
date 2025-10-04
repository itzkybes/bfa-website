<!-- src/routes/honor-hall/+page.svelte -->
<script>
  export let data;

  // seasons list and selection
  const seasons = data?.seasons ?? [];
  let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length-1].season ?? seasons[seasons.length-1].league_id : null);

  // finalStandingsBySeason mapping returned by server
  const finalStandingsBySeason = data?.finalStandingsBySeason ?? {};
  // top-level fallbacks
  const finalStandingsFallback = Array.isArray(data?.finalStandings) ? data.finalStandings : [];
  let finalStandings = finalStandingsFallback;

  // top-level pieces
  const messages = data?.messages ?? [];
  const trace = data?.debug ?? null;
  const champion = data?.champion ?? null;
  const biggestLoser = data?.biggestLoser ?? null;
  const finalsMvp = data?.finalsMvp ?? null;
  const overallMvp = data?.overallMvp ?? null;

  // compute visible finalStandings based on selectedSeason
  if (selectedSeason && finalStandingsBySeason && finalStandingsBySeason[selectedSeason]) {
    finalStandings = finalStandingsBySeason[selectedSeason];
  }

  // Helper: generate avatar URL or fallback
  function avatarOrPlaceholder(candidate) {
    if (!candidate) return '/static/avatar-placeholder.png';
    if (typeof candidate === 'string' && (candidate.indexOf('http://') === 0 || candidate.indexOf('https://') === 0)) {
      return candidate;
    }
    return 'https://sleepercdn.com/avatars/' + encodeURIComponent(String(candidate));
  }
</script>

<style>
  .wrap { max-width:1100px; margin:0 auto; padding:18px; }
  .standings-list { list-style:none; padding:0; margin:0; }
  .stand-row { display:flex; align-items:center; padding:10px 0; border-bottom:1px solid #eee; }
  .rank { width:48px; text-align:center; font-weight:700; }
  .teamName { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .teamMeta { color:#6b7280; font-size:.92rem; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .seedCol { margin-left:auto; color:#9aa3ad; min-width:56px; text-align:right; }
  aside.outcomes { padding:12px; border-left:4px solid #f3f4f6; background:#fff; border-radius:6px; box-shadow:0 0 0 1px rgba(10,10,10,0.02); }
  .outcome-row { display:flex; gap:10px; align-items:center; margin-bottom:8px; }
  .avatar { border-radius:9999px; display:block; }
  select { padding:6px 8px; border-radius:6px; border:1px solid #ddd; }
</style>

<div class="wrap">
  <div style="display:flex; gap:24px; align-items:flex-start;">
    <main style="flex:1 1 70%;">
      <h2 style="margin-top:0">Honor Hall</h2>

      <div style="margin-bottom:14px;">
        <label for="season-select">Season</label>
        <select id="season-select" bind:value={selectedSeason} on:change={() => {
          finalStandings = (finalStandingsBySeason && finalStandingsBySeason[selectedSeason]) ? finalStandingsBySeason[selectedSeason] : finalStandingsFallback;
        }}>
          {#each seasons as s}
            <option value={s.season ?? s.league_id}>{s.season ?? s.league_id}</option>
          {/each}
        </select>
      </div>

      <section>
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
                      {#if row.owner_name}
                        {row.owner_name}
                      {:else}
                        {`Roster ${row.rosterId}`}
                      {/if}
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
      </section>
    </main>

    <aside class="outcomes" style="width:320px;">
      <h3 style="margin-top:0">Outcomes & Awards</h3>

      {#if champion}
        <div class="outcome-row">
          <img class="avatar" src={avatarOrPlaceholder(champion.roster_meta?.avatar ?? champion.avatar ?? champion.owner?.avatar)} alt="champion avatar" style="width:56px;height:56px">
          <div>
            <div class="outcome-name">Champion</div>
            <div class="small">{champion.team_name} • {champion.roster_meta?.owner_name ?? `Roster ${champion.rosterId}`} • Seed #{champion.seed}</div>
          </div>
        </div>
      {/if}

      {#if biggestLoser}
        <div class="outcome-row">
          <img class="avatar" src={avatarOrPlaceholder(biggestLoser.roster_meta?.avatar ?? biggestLoser.avatar ?? biggestLoser.owner?.avatar)} alt="biggest loser avatar" style="width:56px;height:56px">
          <div>
            <div class="outcome-name">Biggest Loser</div>
            <div class="small">{biggestLoser.team_name} • {biggestLoser.roster_meta?.owner_name ?? `Roster ${biggestLoser.rosterId}`} • Seed #{biggestLoser.seed}</div>
          </div>
        </div>
      {/if}

      {#if finalsMvp}
        <div style="margin-top:12px" class="outcome-row">
          <img class="avatar" src={avatarOrPlaceholder(finalsMvp.roster_meta?.avatar ?? finalsMvp.avatar ?? finalsMvp.owner?.avatar)} alt="finals mvp avatar" style="width:56px;height:56px">
          <div>
            <div class="outcome-name">Finals MVP</div>
            <div class="small">Player {finalsMvp.playerId} • {finalsMvp.roster_meta?.owner_name ?? `Roster ${finalsMvp.rosterId}`}</div>
          </div>
        </div>
      {/if}

      {#if overallMvp}
        <div style="margin-top:12px" class="outcome-row">
          <img class="avatar" src={avatarOrPlaceholder(overallMvp.roster_meta?.avatar ?? overallMvp.avatar ?? overallMvp.owner?.avatar)} alt="overall mvp avatar" style="width:56px;height:56px">
          <div>
            <div class="outcome-name">Overall MVP</div>
            <div class="small">Player {overallMvp.playerId} • {overallMvp.roster_meta?.owner_name ?? `Roster ${overallMvp.rosterId}`}</div>
          </div>
        </div>
      {/if}

      <div style="margin-top:12px; color:#9aa3ad; font-size:.9rem">
        Final standings are derived from server-scrubbed matchups and tiebreak rules used to construct the bracket (matchups & tiebreaks).
      </div>
    </aside>
  </div>
</div>
