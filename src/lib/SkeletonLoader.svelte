<script>
  export let variant = 'card'; // card, team, matchup, player, text
  export let count = 1;
</script>

<style>
  .skeleton {
    background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    border-radius: 8px;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Card skeleton */
  .skeleton-card {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.03);
    border-radius: 12px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .skeleton-card-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .skeleton-avatar {
    width: 56px;
    height: 56px;
    border-radius: 10px;
  }

  .skeleton-text {
    height: 16px;
    margin-bottom: 8px;
  }

  .skeleton-text.title {
    height: 20px;
    width: 60%;
  }

  .skeleton-text.subtitle {
    height: 14px;
    width: 40%;
  }

  /* Team skeleton */
  .skeleton-team {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(255,255,255,0.02);
    border-radius: 10px;
    margin-bottom: 1rem;
  }

  /* Matchup skeleton */
  .skeleton-matchup {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.03);
    border-radius: 12px;
    margin-bottom: 1rem;
  }

  .skeleton-matchup-side {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
  }

  .skeleton-matchup-score {
    width: 60px;
    height: 40px;
    border-radius: 8px;
  }

  /* Player skeleton */
  .skeleton-player {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    background: rgba(255,255,255,0.01);
    border-radius: 999px;
    margin-bottom: 0.75rem;
  }

  .skeleton-player-thumb {
    width: 44px;
    height: 44px;
    border-radius: 8px;
  }

  .skeleton-player-meta {
    flex: 1;
  }

  /* Grid container */
  .skeleton-grid {
    display: grid;
    gap: 1rem;
  }

  @media (min-width: 900px) {
    .skeleton-grid.teams {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>

{#if variant === 'card'}
  {#each Array(count) as _, i}
    <div class="skeleton-card">
      <div class="skeleton-card-header">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex: 1;">
          <div class="skeleton skeleton-text title"></div>
          <div class="skeleton skeleton-text subtitle"></div>
        </div>
      </div>
      <div class="skeleton skeleton-text" style="width: 80%;"></div>
      <div class="skeleton skeleton-text" style="width: 60%;"></div>
    </div>
  {/each}

{:else if variant === 'team'}
  <div class="skeleton-grid teams">
    {#each Array(count) as _, i}
      <div class="skeleton-team">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex: 1;">
          <div class="skeleton skeleton-text title"></div>
          <div class="skeleton skeleton-text subtitle"></div>
        </div>
      </div>
    {/each}
  </div>

{:else if variant === 'matchup'}
  {#each Array(count) as _, i}
    <div class="skeleton-matchup">
      <div class="skeleton-matchup-side">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex: 1;">
          <div class="skeleton skeleton-text title"></div>
          <div class="skeleton skeleton-text subtitle"></div>
        </div>
      </div>
      <div class="skeleton skeleton-matchup-score"></div>
      <div class="skeleton skeleton-matchup-score"></div>
      <div class="skeleton-matchup-side">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex: 1;">
          <div class="skeleton skeleton-text title"></div>
          <div class="skeleton skeleton-text subtitle"></div>
        </div>
      </div>
    </div>
  {/each}

{:else if variant === 'player'}
  {#each Array(count) as _, i}
    <div class="skeleton-player">
      <div class="skeleton skeleton-player-thumb"></div>
      <div class="skeleton-player-meta">
        <div class="skeleton skeleton-text" style="width: 70%; margin-bottom: 4px;"></div>
        <div class="skeleton skeleton-text subtitle" style="width: 40%;"></div>
      </div>
      <div class="skeleton" style="width: 40px; height: 24px; border-radius: 999px;"></div>
    </div>
  {/each}

{:else if variant === 'text'}
  {#each Array(count) as _, i}
    <div class="skeleton skeleton-text" style="margin-bottom: 0.5rem;"></div>
  {/each}
{/if}
