<script>
  // src/routes/honor-hall/+page.svelte
  export let data;

  // seasons still available in data (unused in UI since dropdown removed)
  const seasons = data?.seasons ?? [];
  const selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].league_id : null);

  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const finalStandings = Array.isArray(data?.finalStandings) ? data.finalStandings : [];

  // helpers
  function avatarOrPlaceholder(url, name, size = 48) {
    if (url) return url;
    const letter = name ? name[0] : 'T';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=0d1320&color=ffffff&size=${size}`;
  }

  function medalEmoji(rank) {
    if (rank === 1) return ' 🥇';
    if (rank === 2) return ' 🥈';
    if (rank === 3) return ' 🥉';
    return '';
  }
</script>

<style>
  :global(body) { background: var(--bg, #0b0c0f); color: #e6eef8; }

  .container { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }

  h1 { font-size: 2rem; margin-bottom: .6rem; }
  .subtitle { color: #9aa3ad; margin-bottom: 1rem; }

  .messages {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    padding: 14px;
    border-radius: 8px;
    margin-bottom: 1rem;
    color: #cbd5e1;
    font-size: .95rem;
  }

  /* final standings table */
  .finalTable { margin-top:1rem; width:100%; border-collapse:collapse; }
  .finalTable th, .finalTable td { padding:12px; border-bottom:1px solid rgba(255,255,255,0.04); text-align:left; }
  .finalRank { font-weight:800; width:84px; font-size:1.05rem; }

  .teamCell { display:flex; align-items:center; gap:.75rem; }
  .teamAvatar { width:40px; height:40px; border-radius:8px; object-fit:cover; }

  .seed { color:#9aa3ad; font-weight:700; }
  .empty { color:#9aa3ad; padding:1rem 0; }
</style>

<div class="container">
  <h1>Honor Hall — Final Standings</h1>
  <div class="subtitle">Season: {selectedSeason} — final placements computed from playoff results</div>

  {#if messages && messages.length}
    <div class="messages" role="status" aria-live="polite">
      {#each messages as msg, idx}
        <div key={idx}>• {msg}</div>
      {/each}
    </div>
  {/if}

  {#if finalStandings && finalStandings.length}
    <table class="finalTable" role="table" aria-label="Final Standings">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Team</th>
          <th>Seed</th>
        </tr>
      </thead>
      <tbody>
        {#each finalStandings as t (t.rosterId)}
          <tr>
            <td class="finalRank">{t.finalRank}{medalEmoji(t.finalRank)}</td>
            <td>
              <div class="teamCell">
                <img class="teamAvatar" src={avatarOrPlaceholder(t.avatar, t.team_name, 40)} alt="">
                <div>
                  <div style="font-weight:700;">{t.team_name}</div>
                </div>
              </div>
            </td>
            <td class="seed">#{t.seed ?? '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <div class="empty">Final standings not available for the selected season.</div>
  {/if}
</div>
