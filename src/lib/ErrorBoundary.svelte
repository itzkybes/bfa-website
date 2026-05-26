<script>
  export let error = null;
  export let onRetry = null;
  export let context = 'data';
  
  function handleRetry() {
    if (onRetry && typeof onRetry === 'function') {
      onRetry();
    }
  }
</script>

<style>
  .error-container {
    background: rgba(255, 80, 80, 0.04);
    border: 1px solid rgba(255, 80, 80, 0.2);
    border-radius: 12px;
    padding: 1.5rem;
    margin: 1rem 0;
    text-align: center;
  }

  .error-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
    opacity: 0.8;
  }

  .error-title {
    font-size: 1.2rem;
    font-weight: 700;
    color: #ffb6b6;
    margin-bottom: 0.5rem;
  }

  .error-message {
    color: #ffd4d4;
    margin-bottom: 1rem;
    font-size: 0.95rem;
    line-height: 1.5;
  }

  .error-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .btn {
    padding: 0.6rem 1.2rem;
    border-radius: 8px;
    font-weight: 700;
    cursor: pointer;
    transition: all 140ms ease;
    border: none;
    font-size: 0.95rem;
  }

  .btn-primary {
    background: linear-gradient(90deg, #ff6b6b, #ff5252);
    color: white;
  }

  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(255, 82, 82, 0.3);
  }

  .btn-secondary {
    background: rgba(255,255,255,0.03);
    color: #e6eef8;
    border: 1px solid rgba(255,255,255,0.1);
  }

  .btn-secondary:hover {
    background: rgba(255,255,255,0.06);
  }

  .error-details {
    margin-top: 1rem;
    padding: 1rem;
    background: rgba(0,0,0,0.2);
    border-radius: 8px;
    font-family: 'Courier New', monospace;
    font-size: 0.85rem;
    color: #ffb6b6;
    text-align: left;
    overflow-x: auto;
  }
</style>

<div class="error-container" role="alert" aria-live="assertive">
  <div class="error-icon" aria-hidden="true">⚠️</div>
  
  <div class="error-title">
    {#if error?.message?.includes('fetch') || error?.message?.includes('network')}
      Network Error
    {:else if error?.message?.includes('404')}
      Not Found
    {:else if error?.message?.includes('500')}
      Server Error
    {:else}
      Something Went Wrong
    {/if}
  </div>

  <div class="error-message">
    {#if error?.message}
      {#if error.message.includes('fetch') || error.message.includes('Failed to fetch')}
        Unable to load {context}. Please check your internet connection and try again.
      {:else if error.message.includes('404')}
        The requested {context} could not be found.
      {:else if error.message.includes('500')}
        The server encountered an error. Please try again later.
      {:else}
        {error.message}
      {/if}
    {:else}
      We encountered an unexpected error while loading {context}. Please try again.
    {/if}
  </div>

  <div class="error-actions">
    {#if onRetry}
      <button class="btn btn-primary" on:click={handleRetry}>
        🔄 Retry
      </button>
    {/if}
    
    <button class="btn btn-secondary" on:click={() => window.location.reload()}>
      ↻ Refresh Page
    </button>
    
    <a class="btn btn-secondary" href="/">
      🏠 Go Home
    </a>
  </div>

  {#if error?.stack && import.meta.env.DEV}
    <details>
      <summary style="cursor: pointer; margin-top: 1rem; color: #ffd4d4;">Show Error Details (Dev Mode)</summary>
      <div class="error-details">
        <pre>{error.stack}</pre>
      </div>
    </details>
  {/if}
</div>
