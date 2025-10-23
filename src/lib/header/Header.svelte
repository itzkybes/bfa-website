<!-- src/lib/header/Header.svelte -->
<script>
  import { page } from '$app/stores';
  import { onMount } from 'svelte';

  let open = false;
  let mounted = false;

  // logo fallback state — points to file in static/
  let logoVisible = true;
  let logoSrcs = ['/bfa-logo.png'];
  let currentLogo = logoSrcs[0];

  // close mobile menu on route change
  $: if (mounted) {
    $page; // reactive dependency so this runs when the page changes
    open = false;
  }

  onMount(() => {
    mounted = true;
  });

  // Nav links in the order requested
  const links = [
    { href: '/', label: 'Home' },
    { href: '/rosters', label: 'Rosters' },
    { href: '/matchups', label: 'Matchups' },
    { href: '/standings', label: 'Standings' },
    { href: '/records', label: 'Records' },
    { href: '/honor-hall', label: 'Honor Hall' }
  ];

  // helper to test active link
  function isActive(path, href) {
    if (!path) return false;
    if (href === '/' && (path === '/' || path === '')) return true;
    return path === href || (href !== '/' && path.startsWith(href));
  }

  // try next fallback if image errors
  function onLogoError() {
    const next = logoSrcs.indexOf(currentLogo) + 1;
    if (next < logoSrcs.length) {
      currentLogo = logoSrcs[next];
    } else {
      logoVisible = false;
    }
  }
</script>

<header class="site-header" role="banner">
  <div class="wrap header-inner" role="navigation" aria-label="Main navigation">
    <a class="brand" href="/" aria-label="Badger Fantasy Association home">
      {#if logoVisible}
        <img
          src={currentLogo}
          alt="Badger Fantasy Association"
          class="brand-logo"
          on:error={onLogoError}
          loading="eager"
        />
      {:else}
        <span class="logo-emoji" aria-hidden="true">🦡</span>
      {/if}

      <span class="brand-text" title="Badger Fantasy Association">Badger Fantasy Association</span>
    </a>

    <nav class="nav-desktop" aria-label="Primary navigation">
      {#each links as l}
        <a
          href={l.href}
          class="nav-link {isActive($page.url.pathname, l.href) ? 'active' : ''}"
          aria-current={isActive($page.url.pathname, l.href) ? 'page' : undefined}
          >{l.label}</a
        >
      {/each}
    </nav>

    <div class="mobile-controls">
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
    gap: 0.9rem;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    max-width: 1100px;
    margin: 0 auto;
  }

  /* Brand */
  .brand {
    display: inline-flex;
    gap: 0.9rem;
    align-items: center;
    text-decoration: none;
    color: var(--nav-text);
    flex: 0 1 auto;
    min-width: 0; /* allow shrinking */
  }

  /* Larger logo with NO background, no border-radius, no shadow */
  .brand-logo {
    width: 96px;   /* desktop */
    height: 96px;
    object-fit: contain;
    background: transparent; /* explicitly no background */
    border-radius: 0;        /* remove rounding */
    box-shadow: none;        /* remove shadow */
    flex-shrink: 0;
  }

  .logo-emoji {
    display: inline-flex;
    width: 96px;
    height: 96px;
    font-size: 2.2rem;
    line-height: 1;
    background: transparent;
    border-radius: 0;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  /* Single-line brand text (no wrapping) */
  .brand-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 800;
    font-size: clamp(0.95rem, 2.2vw, 1.2rem); /* responsive sizing */
    color: var(--nav-text);
    min-width: 0;
  }

  /* Desktop nav */
  .nav-desktop {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    margin-left: 0.5rem;
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

  /* Mobile controls */
  .mobile-controls {
    display: none;
    align-items: center;
    gap: 8px;
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
    background: linear-gradient(180deg, rgba(6,10,15,0.95), rgba(6,10,15,0.98));
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

  .mobile-link.active {
    background: linear-gradient(90deg, var(--accent), var(--accent-dark));
    color: #071122;
  }

  /* Responsive adjustments */
  @media (max-width: 980px) {
    .nav-desktop { display: none; }
    .mobile-controls { display: inline-flex; }

    /* scale logo down on smaller screens */
    .brand-logo, .logo-emoji {
      width: 72px;
      height: 72px;
    }
    .brand-text { font-size: clamp(0.9rem, 3.0vw, 1.0rem); }
    .header-inner { padding: 0.45rem 0.75rem; gap: 0.6rem; }
  }

  @media (max-width: 520px) {
    .brand-logo, .logo-emoji {
      width: 56px;
      height: 56px;
    }
    .brand-text {
      font-size: 0.95rem;
    }
    /* ensure the brand doesn't push the hamburger off-screen */
    .header-inner { padding: 0.35rem 0.6rem; gap: 0.5rem; }
  }

  @media (min-width: 981px) {
    .mobile-menu { display: none !important; }
  }
</style>
