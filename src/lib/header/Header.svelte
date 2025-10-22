<!-- src/lib/header/Header.svelte -->
<script>
  import { page } from '$app/stores';
  import { onMount } from 'svelte';

  let open = false;
  let mounted = false;

  // close mobile menu on route change
  $: if (mounted) {
    $page; // reactive dependency so this runs when the page changes
    open = false;
  }

  onMount(() => {
    mounted = true;
  });

  const links = [
    { href: '/', label: 'Home' },
    { href: '/rosters', label: 'Rosters' },
    { href: '/standings', label: 'Standings' },
    { href: '/matchups', label: 'Matchups' }
  ];

  // helper to test active link
  function isActive(path, href) {
    if (!path) return false;
    // treat root specially
    if (href === '/' && (path === '/' || path === '')) return true;
    return path.startsWith(href) && href !== '/';
  }
</script>

<header class="site-header" role="banner">
  <div class="wrap header-inner" role="navigation" aria-label="Main navigation">
    <a class="brand" href="/" aria-label="Badger Fantasy Association home">
      <span class="logo">🦡</span>
      <span class="brand-text">
        <span class="brand-title">Badger Fantasy</span>
        <span class="brand-sub">Association</span>
      </span>
    </a>

    <nav class="nav-desktop" aria-label="Primary">
      {#each links as l}
        <a
          href={l.href}
          class="nav-link {isActive($page.url.pathname, l.href) ? 'active' : ''}"
          aria-current={isActive($page.url.pathname, l.href) ? 'page' : undefined}
          >{l.label}</a
        >
      {/each}

      <a class="nav-cta" href="https://docs.sleeper.app/" target="_blank" rel="noreferrer">Sleeper API ↗</a>
    </nav>

    <div class="mobile-controls">
      <a class="mobile-cta" href="https://docs.sleeper.app/" target="_blank" rel="noreferrer" aria-label="Open Sleeper API">
        API ↗
      </a>

      <button
        class="hamburger"
        on:click={() => (open = !open)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        <span class="hamburger-box" aria-hidden="true">
          <span class="hamburger-inner" />
        </span>
      </button>
    </div>
  </div>

  <!-- mobile menu -->
  <div id="mobile-menu" class="mobile-menu {open ? 'open' : ''}" aria-hidden={!open}>
    <div class="mobile-links">
      {#each links as l}
        <a
          href={l.href}
          class="mobile-link {isActive($page.url.pathname, l.href) ? 'active' : ''}"
          on:click={() => (open = false)}
          aria-current={isActive($page.url.pathname, l.href) ? 'page' : undefined}
          >{l.label}</a
        >
      {/each}

      <a class="mobile-link api" href="https://docs.sleeper.app/" target="_blank" rel="noreferrer">Sleeper API ↗</a>
    </div>
  </div>
</header>

<style>
  :root {
    --nav-text: #e6eef6;
    --muted: #9fb0c4;
    --accent: #00c6d8;
    --accent-dark: #008fa6;
    --bg-card: rgba(255,255,255,0.02);
  }

  .site-header {
    position: sticky;
    top: 0;
    z-index: 60;
    backdrop-filter: blur(6px);
    background: linear-gradient(180deg, rgba(6,10,15,0.6), rgba(6,10,15,0.45));
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }

  .header-inner {
    display: flex;
    align-items: center;
    gap: 1rem;
    justify-content: space-between;
    padding: 0.6rem 1rem;
    max-width: 1100px;
    margin: 0 auto;
  }

  .brand {
    display: inline-flex;
    gap: 0.8rem;
    align-items: center;
    text-decoration: none;
    color: var(--nav-text);
  }

  .logo {
    font-size: 1.35rem;
    line-height: 1;
    display: inline-block;
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    line-height: 1;
  }

  .brand-title {
    font-weight: 900;
    letter-spacing: -0.02em;
    font-size: 0.98rem;
  }

  .brand-sub {
    font-weight: 700;
    color: var(--muted);
    font-size: 0.72rem;
  }

  /* Desktop nav */
  .nav-desktop {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }

  .nav-link {
    padding: 8px 12px;
    border-radius: 10px;
    font-weight: 700;
    color: var(--nav-text);
    text-decoration: none;
    background: transparent;
    transition: background 140ms ease, color 140ms ease, transform 140ms ease;
  }

  .nav-link:hover,
  .nav-link:focus {
    background: rgba(255,255,255,0.03);
    transform: translateY(-1px);
    outline: none;
  }

  .nav-link.active {
    background: linear-gradient(90deg, var(--accent), var(--accent-dark));
    color: #071122;
  }

  .nav-cta {
    margin-left: 6px;
    padding: 8px 12px;
    border-radius: 10px;
    font-weight: 800;
    color: #071122;
    background: linear-gradient(90deg, var(--accent), var(--accent-dark));
    text-decoration: none;
  }

  .nav-cta:hover,
  .nav-cta:focus {
    transform: translateY(-1px);
  }

  /* Mobile controls */
  .mobile-controls {
    display: none;
    align-items: center;
    gap: 8px;
  }

  .mobile-cta {
    display: inline-block;
    font-weight: 800;
    color: var(--nav-text);
    padding: 6px 8px;
    border-radius: 8px;
    text-decoration: none;
    background: rgba(255,255,255,0.02);
  }

  .hamburger {
    background: transparent;
    border: none;
    padding: 8px;
    border-radius: 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--nav-text);
  }

  .hamburger:focus {
    outline: 3px solid rgba(0,198,216,0.18);
  }

  .hamburger-box {
    width: 22px;
    height: 16px;
    display: inline-block;
    position: relative;
  }

  .hamburger-inner,
  .hamburger-inner::before,
  .hamburger-inner::after {
    display: block;
    background-color: currentColor;
    height: 2px;
    border-radius: 2px;
    position: absolute;
    left: 0;
    right: 0;
    transition: transform 200ms ease, opacity 200ms ease;
  }

  .hamburger-inner {
    top: 50%;
    transform: translateY(-50%);
  }
  .hamburger-inner::before {
    content: '';
    top: -7px;
  }
  .hamburger-inner::after {
    content: '';
    top: 7px;
  }

  /* animated open state */
  .hamburger[aria-expanded='true'] .hamburger-inner {
    transform: rotate(45deg);
  }
  .hamburger[aria-expanded='true'] .hamburger-inner::before {
    transform: rotate(90deg) translateX(-1px);
    top: 0;
    opacity: 0;
  }
  .hamburger[aria-expanded='true'] .hamburger-inner::after {
    transform: rotate(-90deg) translateX(-1px);
    top: 0;
    opacity: 0;
  }

  /* Mobile menu */
  .mobile-menu {
    display: none;
    background: linear-gradient(180deg, rgba(6,10,15,0.9), rgba(6,10,15,0.95));
    border-top: 1px solid rgba(255,255,255,0.03);
    box-shadow: 0 8px 40px rgba(0,0,0,0.6);
  }

  .mobile-menu.open {
    display: block;
  }

  .mobile-links {
    max-width: 1100px;
    margin: 0 auto;
    padding: 12px 16px;
    display:flex;
    flex-direction: column;
    gap: 6px;
  }

  .mobile-link {
    display: block;
    padding: 12px 14px;
    border-radius: 10px;
    font-weight: 800;
    color: var(--nav-text);
    text-decoration: none;
    background: rgba(255,255,255,0.02);
  }

  .mobile-link.api {
    margin-top: 6px;
    background: linear-gradient(90deg, var(--accent), var(--accent-dark));
    color: #071122;
  }

  .mobile-link.active {
    background: linear-gradient(90deg, var(--accent), var(--accent-dark));
    color: #071122;
  }

  /* Responsiveness */
  @media (max-width: 980px) {
    .nav-desktop { display: none; }
    .mobile-controls { display: inline-flex; }
  }

  @media (min-width: 981px) {
    .mobile-menu { display: none !important; }
  }
</style>
