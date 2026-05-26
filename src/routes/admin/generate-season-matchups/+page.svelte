<!-- src/routes/admin/generate-season-matchups/+page.svelte -->
<script>
  export let data;
  const messages = data?.messages ?? [];
  const outputs = data?.outputs ?? [];

  function copyJSON(jsonStr) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(jsonStr).then(
        () => alert('JSON copied to clipboard — paste into GitHub file.'),
        (err) => alert('Copy failed: ' + String(err))
      );
    } else {
      window.prompt('Copy the JSON below (Ctrl+C / Cmd+C):', jsonStr);
    }
  }
</script>

<div class="page wrap">
  <header class="page-head rise">
    <div class="eyebrow">Admin · Tooling</div>
    <h1 class="page-title">Generate Season Matchups JSON</h1>
    <p class="page-sub">
      Fetches matchups & roster metadata from Sleeper and produces JSON payloads mirroring
      <code>/season_matchups/&lt;year&gt;.json</code>. Files are NOT written — copy the JSON into GitHub.
    </p>
  </header>

  <section class="block">
    <div class="block-head">
      <h2 class="block-title">Messages</h2>
    </div>
    {#if messages.length}
      <ol class="msg-list">
        {#each messages as m}
          <li>{m}</li>
        {/each}
      </ol>
    {:else}
      <div class="empty-card">No messages.</div>
    {/if}
  </section>

  {#if outputs.length}
    {#each outputs as out}
      <section class="block">
        <div class="block-head">
          <div>
            <h2 class="block-title">Season {out.year}</h2>
            <div class="meta-line">
              Playoff start: <strong>{out.meta.playoff_week_start ?? '15'}</strong>
              · Weeks: <strong>{Object.keys(out.weeks).length}</strong>
            </div>
          </div>
          <button class="btn primary sm" on:click={() => copyJSON(JSON.stringify(out.weeks, null, 2))} data-testid={`admin-copy-${out.year}`}>
            Copy JSON
          </button>
        </div>
        <div class="block-body">
          <pre class="jsonblob">{JSON.stringify(out.weeks, null, 2)}</pre>
        </div>
      </section>
    {/each}
  {:else}
    <section class="block">
      <div class="empty-card">No outputs produced.</div>
    </section>
  {/if}
</div>

<style>
  .page { padding: 2.5rem 0 4rem; }
  .page-head { margin-bottom: 2rem; }

  .page-title {
    font-family: var(--font-display);
    font-size: clamp(2rem, 5vw, 3.5rem);
    line-height: 1;
    text-transform: uppercase;
    margin: 0.4rem 0 0.5rem;
  }

  .page-sub {
    color: var(--text-secondary);
    max-width: 70ch;
  }

  .page-sub code {
    background: var(--surface-2);
    color: var(--accent);
    padding: 0.1rem 0.4rem;
    border-radius: var(--r-sm);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }

  .block {
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    overflow: hidden;
    margin-bottom: 1rem;
  }

  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-subtle);
    gap: 1rem;
    flex-wrap: wrap;
  }

  .block-title {
    font-family: var(--font-display);
    font-size: 1.3rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .meta-line {
    color: var(--text-tertiary);
    font-size: 0.85rem;
    margin-top: 0.25rem;
  }

  .meta-line strong { color: var(--accent); }

  .block-body { padding: 1rem 1.25rem; }

  .msg-list {
    padding: 1rem 2.25rem;
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .jsonblob {
    background: var(--bg-base);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 1rem;
    overflow: auto;
    max-height: 480px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
    line-height: 1.5;
  }

  .empty-card {
    padding: 1.5rem;
    text-align: center;
    color: var(--text-secondary);
  }
</style>
