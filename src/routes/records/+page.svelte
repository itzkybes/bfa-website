<script>
  export let data;

  const messages = data?.messages ?? [];
  const jsonLinks = data?.jsonLinks ?? [];
  const outputs = data?.outputs ?? [];
</script>

<style>
  :global(body) { background:#07101a; color:#e6eef8; font-family: Inter, system-ui, sans-serif; }
  .page { max-width: 1000px; margin: 2rem auto; padding: 0 1rem; }
  .card { background: #071025; border:1px solid rgba(255,255,255,0.03); border-radius:10px; padding:1rem; }
  .muted { color: #9ca3af; font-size:0.95rem; }
  a.link { color: #9cc2ff; text-decoration: underline; }
  pre { background:#031220; padding:12px; border-radius:6px; overflow:auto; }
</style>

<div class="page">
  <h1>Generate season_matchups JSON</h1>

  <div class="card" style="margin-bottom:1rem;">
    <div class="muted">This page fetches matchups from Sleeper and attempts to write season JSON files to <code>static/season_matchups/&lt;year&gt;.json</code>. Each matchup includes starter ids &amp; starter points when available.</div>
    <div class="muted" style="margin-top:.5rem;">Max weeks used for fetching: <strong>23</strong></div>
  </div>

  <div class="card" style="margin-bottom:1rem;">
    <h3>Results</h3>
    <div>
      {#if messages && messages.length}
        <ul>
          {#each messages as m}
            <li class="muted">{m}</li>
          {/each}
        </ul>
      {/if}

      {#if jsonLinks && jsonLinks.length}
        <div style="margin-top:.6rem;">
          <strong>Written files:</strong>
          <ul>
            {#each jsonLinks as jl}
              <li><a class="link" href={jl} target="_blank" rel="noopener noreferrer">{jl}</a></li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if outputs && outputs.length}
        <div style="margin-top:.6rem;">
          <strong>Output summary</strong>
          <ul>
            {#each outputs as o}
              <li class="muted">
                {o.year} — weeks: {o.weeks} {o.path ? `written to ${o.path}` : '(payload returned instead of write)'}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </div>

  <div class="card">
    <div class="muted">If your platform does not allow writing to the <code>static</code> folder at runtime, the page will return payloads in the response (see outputs). You can copy/paste those JSON objects and save them as files locally.</div>
  </div>
</div>
