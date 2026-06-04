<script>
  import Header from '$lib/components/Header.svelte';
  import { webVitals } from '$lib/utils/vitals';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import '../app.css';

  const analyticsId = import.meta.env.VERCEL_ANALYTICS_ID;

  $: if (browser && analyticsId) {
    webVitals({ path: $page.url.pathname, params: $page.params, analyticsId });
  }
</script>

<a class="skip-link" href="#content">Skip to content</a>

<Header />

<main id="content">
  <slot />
</main>

<footer class="site-footer" role="contentinfo">
  <div class="wrap footer-inner">
    <div class="footer-brand">
      <a href="/" class="footer-mark-link" aria-label="Badger Fantasy Association home">
        <img src="/bfa-logo.png" alt="BFA" class="footer-mark-img" width="96" height="96" />
      </a>
      <div class="footer-meta">
        <div class="footer-title">Badger Fantasy Association</div>
        <div class="footer-sub">Fantasy Basketball · Powered by Sleeper · © {new Date().getFullYear()}</div>
      </div>
    </div>

    <nav class="footer-nav" aria-label="Footer">
      <div class="footer-col">
        <div class="col-title">League</div>
        <a href="/" data-testid="footer-link-home">Home</a>
        <a href="/rosters" data-testid="footer-link-rosters">Owner Hub</a>
        <a href="/matchups" data-testid="footer-link-matchups">Matchups</a>
        <a href="/standings" data-testid="footer-link-standings">Standings</a>
        <a href="/power-rankings" data-testid="footer-link-power-rankings">Power Rankings</a>
      </div>
      <div class="footer-col">
        <div class="col-title">Records</div>
        <a href="/records-team" data-testid="footer-link-records-team">Team Records</a>
        <a href="/records-player" data-testid="footer-link-records-player">Player Records</a>
        <a href="/honor-hall" data-testid="footer-link-honor-hall">Honor Hall</a>
        <a href="/rules" data-testid="footer-link-rules">Rules &amp; Scoring</a>
      </div>
      <div class="footer-col">
        <div class="col-title">Tooling</div>
        <a href="/admin/generate-season-matchups" data-testid="footer-link-generate-season">Generate Season Matchups</a>
        <a href="/admin/player-id-lookup" data-testid="footer-link-player-id-lookup">Player ID Lookup</a>
      </div>
      <div class="footer-col">
        <div class="col-title">External</div>
        <a href="https://sleeper.com/" target="_blank" rel="noreferrer" data-testid="footer-link-sleeper">Sleeper ↗</a>
        <a href="https://docs.sleeper.app/" target="_blank" rel="noreferrer" data-testid="footer-link-sleeper-api">Sleeper API ↗</a>
      </div>
    </nav>
  </div>
</footer>

<style>
  main#content {
    min-height: calc(100vh - 360px);
    padding-bottom: 3rem;
  }

  .site-footer {
    background: var(--surface-1);
    border-top: 1px solid var(--border-subtle);
    margin-top: 4rem;
  }

  .footer-inner {
    display: grid;
    grid-template-columns: 1fr 2.4fr;
    gap: 3rem;
    padding: 3rem var(--s-5);
    max-width: 1200px;
    margin: 0 auto;
  }

  .footer-brand {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .footer-mark-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: var(--r-sm);
    transition: transform var(--t-fast), opacity var(--t-fast);
  }

  .footer-mark-link:hover {
    transform: translateY(-2px);
    opacity: 0.92;
  }

  .footer-mark-img {
    width: 88px;
    height: 88px;
    object-fit: contain;
    display: block;
  }

  .footer-title {
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 1.2rem;
    color: var(--text-primary);
  }

  .footer-sub {
    color: var(--text-secondary);
    font-size: 0.85rem;
    margin-top: 0.25rem;
  }

  .footer-nav {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2rem;
  }

  .footer-col {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .col-title {
    font-family: var(--font-body);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.7rem;
    color: var(--brand);
    margin-bottom: 0.5rem;
  }

  .footer-col a {
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 500;
    transition: color var(--t-fast), padding-left var(--t-fast);
  }

  .footer-col a:hover {
    color: var(--accent);
    padding-left: 0.25rem;
  }

  @media (max-width: 820px) {
    .footer-inner {
      grid-template-columns: 1fr;
      padding: 2.5rem var(--s-4);
      gap: 2.5rem;
    }
    .footer-nav { gap: 1.5rem; grid-template-columns: repeat(2, 1fr); }
  }

  @media (max-width: 520px) {
    .footer-nav { grid-template-columns: 1fr 1fr; }
  }
</style>
