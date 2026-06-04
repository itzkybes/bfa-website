<script>
  export let variant = 'card'; // 'card' | 'team' | 'matchup' | 'player' | 'text' | 'row'
  export let count = 1;
</script>

{#if variant === 'card'}
  {#each Array(count) as _, i (i)}
    <div class="sk-card">
      <div class="sk-row">
        <div class="shimmer sk-avatar"></div>
        <div style="flex:1;">
          <div class="shimmer sk-line title"></div>
          <div class="shimmer sk-line subtitle"></div>
        </div>
      </div>
    </div>
  {/each}

{:else if variant === 'matchup'}
  <div class="sk-matchups">
    {#each Array(count) as _, i (i)}
      <div class="sk-matchup">
        <div class="sk-side">
          <div class="shimmer sk-avatar"></div>
          <div style="flex:1;">
            <div class="shimmer sk-line title"></div>
            <div class="shimmer sk-line subtitle"></div>
          </div>
        </div>
        <div class="shimmer sk-score"></div>
        <div class="sk-side right">
          <div style="flex:1; text-align:right;">
            <div class="shimmer sk-line title right"></div>
            <div class="shimmer sk-line subtitle right"></div>
          </div>
          <div class="shimmer sk-avatar"></div>
        </div>
      </div>
    {/each}
  </div>

{:else if variant === 'team'}
  <div class="sk-teams">
    {#each Array(count) as _, i (i)}
      <div class="sk-team">
        <div class="shimmer sk-avatar big"></div>
        <div style="flex:1;">
          <div class="shimmer sk-line title"></div>
          <div class="shimmer sk-line subtitle"></div>
        </div>
      </div>
    {/each}
  </div>

{:else if variant === 'player'}
  {#each Array(count) as _, i (i)}
    <div class="sk-player">
      <div class="shimmer sk-avatar"></div>
      <div style="flex:1;">
        <div class="shimmer sk-line title"></div>
        <div class="shimmer sk-line subtitle"></div>
      </div>
    </div>
  {/each}

{:else if variant === 'row'}
  {#each Array(count) as _, i (i)}
    <div class="shimmer sk-line" style="height:36px; margin-bottom:6px;"></div>
  {/each}

{:else}
  {#each Array(count) as _, i (i)}
    <div class="shimmer sk-line" style="margin-bottom:8px;"></div>
  {/each}
{/if}

<style>
  .sk-line {
    height: 14px;
    border-radius: var(--r-sm);
    margin-bottom: 8px;
  }
  .sk-line.title  { height: 18px; width: 60%; }
  .sk-line.subtitle { height: 12px; width: 40%; }
  .sk-line.right { margin-left: auto; }

  .sk-avatar {
    width: 48px;
    height: 48px;
    border-radius: var(--r-sm);
  }
  .sk-avatar.big { width: 64px; height: 64px; }

  .sk-score {
    width: 80px;
    height: 36px;
    border-radius: var(--r-sm);
  }

  .sk-card {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 1rem;
    margin-bottom: 0.75rem;
  }

  .sk-row {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .sk-matchups {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
  }

  .sk-matchup {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 1rem;
    align-items: center;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 1rem;
  }

  .sk-side { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
  .sk-side.right { justify-content: flex-end; }

  .sk-teams {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }

  .sk-team {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 1rem;
  }

  .sk-player {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 0.6rem 0.85rem;
    margin-bottom: 0.5rem;
  }

  @media (max-width: 720px) {
    .sk-matchups { grid-template-columns: 1fr; }
  }
</style>
