<script>
  export let error = null;
  export let onRetry = null;
  export let context = 'data';

  function handleRetry() {
    if (typeof onRetry === 'function') onRetry();
  }
</script>

<div class="err" role="alert" aria-live="assertive" data-testid="error-boundary">
  <div class="err-icon" aria-hidden="true">!</div>
  <div class="err-title">
    {#if error?.message?.includes('fetch') || error?.message?.includes('network')}
      Network error
    {:else if error?.message?.includes('404')}
      Not found
    {:else if error?.message?.includes('500')}
      Server error
    {:else}
      Something went wrong
    {/if}
  </div>
  <div class="err-msg">
    {#if error?.message}
      {#if error.message.includes('fetch') || error.message.includes('Failed to fetch')}
        Unable to load {context}. Check your connection and try again.
      {:else if error.message.includes('404')}
        The requested {context} could not be found.
      {:else if error.message.includes('500')}
        The server encountered an error. Try again shortly.
      {:else}
        {error.message}
      {/if}
    {:else}
      We hit an unexpected error loading {context}. Please retry.
    {/if}
  </div>

  <div class="err-actions">
    {#if onRetry}
      <button class="btn primary" on:click={handleRetry} data-testid="error-retry">↻ Retry</button>
    {/if}
    <a class="btn" href="/" data-testid="error-go-home">Go Home</a>
  </div>
</div>

<style>
  .err {
    margin: 1.5rem 0;
    padding: 2rem 1.5rem;
    background: var(--surface-1);
    border: 1px solid var(--loss);
    border-left: 4px solid var(--loss);
    border-radius: var(--r-sm);
    text-align: center;
  }

  .err-icon {
    display: inline-grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--loss);
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.6rem;
    margin-bottom: 1rem;
  }

  .err-title {
    font-family: var(--font-display);
    font-size: 1.5rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }

  .err-msg {
    color: var(--text-secondary);
    margin-bottom: 1.25rem;
    max-width: 60ch;
    margin-left: auto;
    margin-right: auto;
  }

  .err-actions {
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    flex-wrap: wrap;
  }
</style>
