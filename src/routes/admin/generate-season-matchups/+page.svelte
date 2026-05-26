<script>
  export let data;

  const messages = data?.messages ?? [];
  const outputs = data?.outputs ?? [];

  // copy helper for a pre block
  function copyJSON(jsonStr) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(jsonStr).then(() => {
        // small visual feedback could be added; keep simple
        alert('JSON copied to clipboard — paste into GitHub file.');
      }).catch(err => {
        alert('Copy failed: ' + String(err));
      });
    } else {
      // fallback: open a prompt with the text so user can copy manually
      window.prompt('Copy the JSON below (Ctrl+C / Cmd+C):', jsonStr);
    }
  }
</script>

<style>
  :global(body) { background:#07101a; color:#e6eef8; font-family: Inter, system-ui, sans-serif; }
  .page { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
  .card { background: #071025; border:1px solid rgba(255,255,255,0.03); border-radius:10px; padding:1rem; margin-bottom:1rem; }
  .muted { color: #9ca3af; font-size:0.95rem; }
  pre.jsonblob { background:#031220; padding:12px; border-radius:6px; overflow:auto; max-height:520px; }
  .row { display:flex; justify-content:space-between; align-items:center; gap:1rem; }
  .btn {
    background: linear-gradient(180deg, rgba(99,102,241,0.14), rgba(99,102,241,0.06));
    border: 1px solid rgba(99,102,241,0.16);
    padding: .45rem .65rem;
    border-radius: 8px;
    color: #e6eef8;
    font-weight:600;
    cursor:pointer;
  }
  .year-block { margin-top: .8rem; }
</style>

<div class="page">
  <h1>Generate season_matchups JSON (display-only)</h1>

  <div class="card">
    <div class="muted">This page fetches matchups & roster metadata from Sleeper and produces JSON payloads mirroring <code>/season_matchups/&lt;year&gt;.json</code>. Files are NOT written — the JSON is shown below for you to copy into GitHub.</div>
    <div class="muted" style="margin-top:.5rem;">Max weeks used for fetching: <strong>23</strong></div>
  </div>

  <div class="card">
    <h3>Messages</h3>
    {#if messages && messages.length}
      <ul>
        {#each messages as m}
          <li class="muted">{m}</li>
        {/each}
      </ul>
    {:else}
      <div class="muted">No messages.</div>
    {/if}
  </div>

  {#if outputs && outputs.length}
    {#each outputs as out}
      <div class="card year-block">
        <div class="row">
          <div>
            <h2 style="margin:.2rem 0;">Season JSON — {out.year}</h2>
            <div class="muted">Playoff week start (discovered): {out.meta.playoff_week_start ?? '15'}</div>
            <div class="muted" style="margin-top:.3rem;">Weeks produced: {Object.keys(out.weeks).length}</div>
          </div>
          <div>
            <button class="btn" on:click={() => copyJSON(JSON.stringify(out.weeks, null, 2))}>Copy JSON</button>
          </div>
        </div>

        <div style="margin-top:.6rem;">
          <div class="muted" style="margin-bottom:.4rem;">Preview (expandable):</div>
          <pre class="jsonblob">{JSON.stringify(out.weeks, null, 2)}</pre>
        </div>
      </div>
    {/each}
  {:else}
    <div class="card">
      <div class="muted">No outputs produced.</div>
    </div>
  {/if}
</div>
