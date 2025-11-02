<!-- src/routes/records/+page.svelte -->
<script>
  // Simple landing page for the Records nav item.
  // Keeps your header link at /records but surfaces the two existing pages.
  // No automatic redirect—user chooses team vs player.
</script>

<style>
  :global(body) {
    color-scheme: dark;
  }

  .page {
    max-width: 1100px;
    margin: 2rem auto;
    padding: 0 1rem;
  }

  .card {
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 6px 18px rgba(2,6,23,0.6);
  }

  h1 { margin: 0 0 8px 0; font-size: 1.4rem; }
  p.lead { color: #9ca3af; margin: 0 0 16px 0; }

  .links {
    display:flex;
    gap:12px;
    flex-wrap:wrap;
    margin-top: 8px;
  }

  a.card-link {
    display:inline-flex;
    align-items:center;
    gap:12px;
    padding: 12px 16px;
    border-radius:10px;
    text-decoration:none;
    background: rgba(255,255,255,0.02);
    color: inherit;
    border: 1px solid rgba(255,255,255,0.03);
    font-weight:800;
    min-width:170px;
    justify-content:center;
  }

  a.card-link:hover {
    transform: translateY(-2px);
    background: linear-gradient(90deg, rgba(0,198,216,0.08), rgba(0,142,166,0.06));
    color: #071122;
  }

  .muted { color:#9ca3af; font-weight:600; font-size:.95rem; margin-top:12px; }

  @media (max-width:700px) {
    .links { flex-direction:column; }
    a.card-link { width:100%; min-width:0; justify-content:flex-start; padding-left:18px; }
  }
</style>

<div class="page">
  <div class="card" role="main" aria-labelledby="records-title">
    <h1 id="records-title">Records</h1>
    <p class="lead">Choose which records view you want to open.</p>

    <div class="links" role="navigation" aria-label="Records options">
      <a class="card-link" href="/records-team" aria-label="Team records">
        Team records
      </a>

      <a class="card-link" href="/records-player" aria-label="Player records">
        Player records
      </a>
    </div>

    <div class="muted">Tip: you can make either page the default by changing the link in the header.</div>
  </div>
</div>
