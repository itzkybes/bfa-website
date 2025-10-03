<script>
  import { page } from '$app/stores';
  export let title = "Badger Fantasy Association";

  $: currentPath = $page.url.pathname;
</script>

<header class="site-header">
  <div class="header-inner">
    <div class="branding">
      <img src="/bfa-logo.png" alt="BFA Logo" class="logo" />
      <h1>{title}</h1>
    </div>

    <nav class="header-nav">
      <a href="/" class:active={currentPath === "/"}>Home</a>
      <a href="/honor-hall" class:active={currentPath === "/honor-hall"}>Honor Hall</a>
      <a href="/matchups" class:active={currentPath === "/matchups"}>Matchups</a>
      <a href="/standings" class:active={currentPath === "/standings"}>Standings</a>
      <a href="/rosters" class:active={currentPath === "/rosters"}>Rosters</a>
      <a href="/records" class:active={currentPath === "/records"}>Records</a>
    </nav>
  </div>
</header>

<style>
  .site-header {
    position: sticky;
    top: 0;
    z-index: 1000;

    background: #ffffff;
    border-bottom: 1px solid #e5e7eb;
    padding: 0.75rem 2rem;
    box-shadow: 0 2px 6px rgba(0,0,0,0.05);
  }

  .header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 1100px;
    margin: 0 auto;
    width: 100%;
  }

  .branding {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .logo {
    width: 45px;
    height: auto;
  }

  h1 {
    font-size: 1.4rem;
    font-weight: 600;
    color: #111827;
    margin: 0;
  }

  .header-nav {
    display: flex;
    flex: 1;
    justify-content: center;  /* centers links */
    gap: 2rem;                /* evenly spaced */
  }

  .header-nav a {
    text-decoration: none;
    color: #2563eb;
    font-weight: 500;
    font-size: 1.05rem;
    transition: color 0.2s;
    padding-bottom: 0.2rem;
    border-bottom: 2px solid transparent;
  }

  .header-nav a:hover {
    color: #1e40af;
  }

  .header-nav a.active {
    color: #1e40af;
    border-bottom-color: #1e40af;
    font-weight: 600;
  }
</style>
