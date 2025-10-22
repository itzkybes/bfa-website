<!-- src/routes/+layout.svelte -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';

  let mobileOpen = false;

  // simple nav items — update as needed
  const navItems = [
    { href: '/', label: 'Home' },
    { href: '/matchups', label: 'Matchups' },
    { href: '/rosters', label: 'Rosters' },
    { href: '/standings', label: 'Standings' },
    { href: '/players', label: 'Players' }
  ];

  // utility to test active route (simple)
  function isActive(href) {
    try {
      const p = $page?.url?.pathname || '/';
      return p === href || (href !== '/' && p.startsWith(href));
    } catch {
      return false;
    }
  }

  // close mobile menu on route change (reactive to $page store)
  $: if ($page) {
    // when the page store changes, close the mobile menu
    // setting mobileOpen=false on every navigation ensures menu closes after clicking nav links
    mobileOpen = false;
  }

  // keyboard handling for hamburger (close on Escape)
  function onKeyMenu(e) {
    if (e.key === 'Escape') mobileOpen = false;
  }

  onMount(() => {
    window.addEventListener('keydown', onKeyMenu);
    return () => window.removeEventListener('keydown', onKeyMenu);
  });
</script>

<style>
  :root{
    --nav-text: #e6eef6;
    --muted: #9fb0c4;
    --accent: #00c6d8;
    --accent-dark: #008fa6;
    --bg: #05111a;
    --card-bg: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    --card-border: rgba(255,255,255,0.03);
  }

  /* Layout shell */
  .site {
    min-height: 100vh;
    display:flex;
    flex-direction:column;
    background: var(--bg);
    color: var(--nav-text);
  }

  /* Skip link */
  .skip {
    position: absolute;
    left: -999px;
    top: auto;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  .skip:focus {
    left: 1rem;
    top: 1rem;
    width: auto;
    height: auto;
    padding: .5rem .75rem;
    border-radius: 6px;
    background: rgba(0,0,0,0.6);
    outline: 2px solid rgba(99,102,241,0.6);
    color: var(--nav-text);
    z-index: 999;
  }

  header.site-header {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:1rem;
    padding: 0.9rem 1rem;
    border-bottom: 1px solid var(--card-border);
    background: linear-gradient(180deg, rgba(255,255,255,0.006), rgba(255,255,255,0.002));
    position: sticky;
    top: 0;
    z-index: 40;
  }

  .brand {
    display:flex;
    align-items:center;
    gap:.8rem;
    min-width:0;
  }
  .logo {
    width:40px;
    height:40px;
    border-radius:8px;
    background: linear-gradient(180deg,var(--accent),var(--accent-dark));
    display:inline-flex;
    align-items:center;
    justify-content:center;
    font-weight:900;
    color:#fff;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
    box-shadow: 0 6px 18px rgba(0,0,0,0.3);
    flex-shrink:0;
  }
  .sitename {
    font-weight:800;
    font-size:1rem;
    color:var(--nav-text);
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }
  .sitedesc {
    color:var(--muted);
    font-size:.86rem;
    font-weight:700;
  }

  /* Desktop nav */
  nav.main-nav {
    display:flex;
    gap:.5rem;
    align-items:center;
  }
  nav a {
    text-decoration:none;
    color:var(--nav-text);
    padding:.48rem .7rem;
    border-radius:8px;
    font-weight:700;
    font-size:.95rem;
  }
  nav a:hover, nav a:focus {
    background: rgba(255,255,255,0.02);
  }
  nav a.active {
    background: linear-gradient(90deg,var(--accent),var(--accent-dark));
    color: #fff;
  }

  .nav-actions {
    display:flex;
    gap:.5rem;
    align-items:center;
  }

  /* mobile menu button */
  .menu-btn {
    display:none;
    background:transparent;
    border:1px solid rgba(255,255,255,0.03);
    padding:.4rem .5rem;
    border-radius:8px;
    color:var(--nav-text);
    font-weight:800;
  }

  main.content {
    flex:1 1 auto;
    padding: 1.25rem;
    max-width: 1100px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }

  footer.site-footer {
    border-top:1px solid var(--card-border);
    background: linear-gradient(180deg, rgba(255,255,255,0.004), rgba(255,255,255,0.002));
    padding: 1rem;
  }
  .footer-inner {
    max-width:1100px;
    margin:0 auto;
    padding:0 1rem;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:1rem;
    flex-wrap:wrap;
  }
  .footer-left { color:var(--muted); font-weight:600; font-size:.95rem; }
  .footer-right { display:flex; gap: .8rem; align-items:center; flex-wrap:wrap; }
  .footer-right a { color:var(--muted); text-decoration:none; font-weight:700; font-size:.92rem; padding:.25rem .5rem; border-radius:6px; }
  .footer-right a:hover { color:var(--nav-text); background: rgba(255,255,255,0.01); }

  /* Responsive */
  @media (max-width: 880px) {
    nav.main-nav { display:none; }
    .menu-btn { display:inline-flex; align-items:center; gap:.4rem; }
    .logo { width:36px; height:36px; }
    .sitename { font-size:.98rem; }
  }

  /* mobile menu panel */
  .mobile-panel {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: none;
    background: rgba(0,0,0,0.45);
    backdrop-filter: blur(4px);
  }
  .mobile-panel.open { display:block; }

  .mobile-panel .panel-inner {
    position: absolute;
    right: 0;
    top: 0;
    height: 100%;
    width: min(92%, 320px);
    background: linear-gradient(180deg, rgba(8,16,24,0.98), rgba(4,8,12,0.98));
    padding: 1rem;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    overflow-y: auto;
  }
  .mobile-panel nav a {
    display:block;
    padding:.8rem .6rem;
    border-radius:8px;
    margin-bottom:.4rem;
    color:var(--nav-text);
    font-weight:800;
  }
  .mobile-panel nav a.active { background: linear-gradient(90deg,var(--accent),var(--accent-dark)); color:#fff; }

  /* small-foot links stack */
  @media (max-width:520px) {
    .footer-inner { flex-direction:column; align-items:flex-start; gap:.6rem; }
  }

  /* focus visible */
  :focus { outline: none; }
  a:focus-visible, button:focus-visible { outline: 3px solid rgba(99,102,241,0.12); border-radius:6px; }
</style>

<div class="site">
  <a class="skip" href="#content">Skip to content</a>

  <header class="site-header" role="banner">
    <div class="brand" style="min-width:0;">
      <a href="/" class="logo" aria-label="Home">B</a>
      <div style="min-width:0;">
        <div class="sitename">Basketball Fantasy Archive</div>
        <div class="sitedesc">League at a glance</div>
      </div>
    </div>

    <!-- desktop nav -->
    <nav class="main-nav" role="navigation" aria-label="Main navigation">
      {#each navItems as item}
        <a href={item.href} class:active={isActive(item.href)}>{item.label}</a>
      {/each}
    </nav>

    <div class="nav-actions">
      <!-- Add other action buttons here if needed -->
      <button
        class="menu-btn"
        aria-expanded={mobileOpen}
        aria-controls="mobile-menu"
        on:click={() => (mobileOpen = !mobileOpen)}
        aria-label="Toggle menu"
      >
        {#if mobileOpen} Close {:else} Menu {/if}
      </button>
    </div>
  </header>

  <!-- Mobile panel -->
  <div id="mobile-menu" class="mobile-panel {mobileOpen ? 'open' : ''}" class:open={mobileOpen} role="dialog" aria-modal="true" aria-hidden={!mobileOpen}>
    <div class="panel-inner" role="document">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: .6rem;">
        <div style="display:flex; gap:.6rem; align-items:center;">
          <div class="logo" style="width:36px;height:36px;">B</div>
          <div>
            <div class="sitename" style="font-size:1rem;">Basketball Fantasy Archive</div>
            <div class="muted" style="font-size:.86rem;">Quick league view</div>
          </div>
        </div>
        <button class="menu-btn" on:click={() => (mobileOpen = false)} aria-label="Close menu">✕</button>
      </div>

      <nav role="navigation" aria-label="Mobile navigation">
        {#each navItems as item}
          <a href={item.href} class:active={isActive(item.href)} on:click={() => (mobileOpen = false)}>{item.label}</a>
        {/each}
      </nav>

      <div style="margin-top:1rem; border-top:1px solid var(--card-border); padding-top:1rem;">
        <div style="font-weight:700; color:var(--muted); margin-bottom:.5rem;">Quick links</div>
        <div style="display:flex; gap:.6rem; flex-wrap:wrap;">
          <a href="/about" on:click={() => (mobileOpen = false)}>About</a>
          <a href="/contact" on:click={() => (mobileOpen = false)}>Contact</a>
          <a href="/privacy" on:click={() => (mobileOpen = false)}>Privacy</a>
        </div>
      </div>
    </div>
  </div>

  <main id="content" class="content" role="main">
    <slot />
  </main>

  <footer class="site-footer" role="contentinfo">
    <div class="footer-inner">
      <div class="footer-left">
        © {new Date().getFullYear()} Basketball Fantasy Archive • Built with Sleeper data
      </div>

      <div class="footer-right">
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
        <a href="/privacy">Privacy</a>
      </div>
    </div>
  </footer>
</div>
