<!-- src/lib/header/Header.svelte -->
<script>
  import { page } from '$app/stores';
  import { onMount, onDestroy } from 'svelte';

  let open = false;
  let mounted = false;

  let logoVisible = true;
  let logoSrcs = ['/bfa-logo.png'];
  let currentLogo = logoSrcs[0];

  // element refs for outside-click detection
  let mobileMenu;
  let hamburgerBtn;

  // close mobile menu & desktop dropdown on route change
  $: if (mounted) {
    $page; // reactive dependency so this runs when the page changes
    open = false;
    recordsOpen = false;
  }

  onMount(() => {
    mounted = true;

    // click outside handler (closes mobile menu immediately)
    const handleDocClick = (e) => {
      // close dropdown if open and click is outside the dropdown/records button
      // also close mobile menu when clicking outside it
      const target = e.target;

      // MOBILE: if mobile menu is open and click outside, close it
      if (open) {
        if (mobileMenu && !mobileMenu.contains(target) && !(hamburgerBtn && hamburgerBtn.contains(target))) {
          open = false;
        }
      }

      // DESKTOP: if records dropdown open and click outside nav item area, close it
      // find any open dropdown element in the DOM; if click isn't inside it or its button, close.
      // simpler approach: if recordsOpen and click target isn't inside a .nav-item.has-children, close
      if (recordsOpen) {
        // if click inside any element with class 'nav-item has-children', ignore
        let el = target;
        let insideRecords = false;
        while (el) {
          if (el.classList && (el.classList.contains('nav-item') || el.classList.contains('record-button') || el.classList.contains('dropdown'))) {
            insideRecords = true;
            break;
          }
          el = el.parentElement;
        }
        if (!insideRecords) {
          recordsOpen = false;
        }
      }
    };

    // escape key to close immediately
    const handleKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        open = false;
        recordsOpen = false;
      }
    };

    document.addEventListener('click', handleDocClick, true);
    document.addEventListener('keydown', handleKey, true);

    onDestroy(() => {
      document.removeEventListener('click', handleDocClick, true);
      document.removeEventListener('keydown', handleKey, true);
    });
  });

  // Nav: Records is a parent that points to children routes only
  const links = [
    { href: '/', label: 'Home' },
    { href: '/rosters', label: 'Rosters' },
    { href: '/matchups', label: 'Matchups' },
    { href: '/standings', label: 'Standings' },
    // Records parent — NOT a navigable <a> (avoids /records 404)
    { href: '/records', label: 'Records', children: [
      { href: '/records-team', label: 'Team records' },
      { href: '/records-player', label: 'Player records' }
    ]},
    { href: '/honor-hall', label: 'Honor Hall' }
  ];

  // helper to test active link — treat parent href as active when the path starts with it
  function isActive(path, href) {
    if (!path) return false;
    if (href === '/' && (path === '/' || path === '')) return true;
    if (href !== '/' && path.startsWith(href)) return true;
    return path === href;
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

  // dropdown state for desktop
  let recordsOpen = false;
  function toggleRecords(e) {
    recordsOpen = !recordsOpen;
  }

  // When opening mobile menu, ensure desktop dropdown is closed
  $: if (open) {
    recordsOpen = false;
  }

  // Close dropdown immediately when a dropdown link is clicked
  function onDropdownLinkClick() {
    recordsOpen = false;
  }

  // Toggle mobile menu when a mobile link is clicked (close it)
  function onMobileLinkClick() {
    open = false;
  }

  // clicking brand closes mobile menu (immediate)
  function onBrandClick() {
    open = false;
    recordsOpen = false;
  }
</script>

<header class="site-header" role="banner">
  <div class="wrap header-inner" role="navigation" aria-label="Main navigation">
    <a class="brand" href="/" aria-label="Badger Fantasy Association home" on:click={onBrandClick}>
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
        {#if l.children}
          <div class="nav-item has-children {isActive($page.url.pathname, l.href) ? 'active' : ''}" on:mouseenter={() => recordsOpen = true} on:mouseleave={() => recordsOpen = false}>
            <button class="nav-link record-button" aria-haspopup="true" aria-expanded={recordsOpen} on:click={toggleRecords} type="button">
              {l.label} <span class="caret" aria-hidden="true">▾</span>
            </button>

            {#if recordsOpen}
              <div class="dropdown" role="menu" aria-label="Records submenu">
                {#each l.children as c}
                  <!-- close dropdown immediately when clicked -->
                  <a href={c.href} class="dropdown-link {isActive($page.url.pathname, c.href) ? 'active' : ''}" role="menuitem" on:click={onDropdownLinkClick}>{c.label}</a>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <a
            href={l.href}
            class="nav-link {isActive($page.url.pathname, l.href) ? 'active' : ''}"
            aria-current={isActive($page.url.pathname, l.href) ? 'page' : undefined}
            on:click={() => (recordsOpen = false)}
            >{l.label}</a
          >
        {/if}
      {/each}
    </nav>

    <div class="mobile-controls">
      <button
        class="hamburger"
        bind:this={hamburgerBtn}
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
  <div id="mobile-menu" bind:this={mobileMenu} class="mobile-menu {open ? 'open' : ''}" aria-hidden={!open}>
    <div class="mobile-links">
      {#each links as l}
        {#if l.children}
          <div class="mobile-section">
            <div class="mobile-section-title">{l.label}</div>
            {#each l.children as c}
              <a
                href={c.href}
                class="mobile-link {isActive($page.url.pathname, c.href) ? 'active' : ''}"
                on:click={onMobileLinkClick}
                aria-current={isActive($page.url.pathname, c.href) ? 'page' : undefined}
                >{c.label}</a
              >
            {/each}
          </div>
        {:else}
          <a
            href={l.href}
            class="mobile-link {isActive($page.url.pathname, l.href) ? 'active' : ''}"
            on:click={onMobileLinkClick}
            aria-current={isActive($page.url.pathname, l.href) ? 'page' : undefined}
            >{l.label}</a
          >
        {/if}
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
    min-width: 0;
  }

  .brand-logo {
    width: 96px;
    height: 96px;
    object-fit: contain;
    background: transparent;
    border-radius: 0;
    box-shadow: none;
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

  .brand-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 800;
    font-size: clamp(0.95rem, 2.2vw, 1.2rem);
    color: var(--nav-text);
    min-width: 0;
  }

  .nav-desktop {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    margin-left: 0.5rem;
  }

  .nav-link, .record-button {
    padding: 8px 12px;
    border-radius: 10px;
    font-weight: 700;
    color: var(--nav-text);
    text-decoration: none;
    background: transparent;
    transition: background 140ms ease, color 140ms ease, transform 140ms ease;
    border: none;
    cursor: pointer;
    font-size: 0.95rem;
    line-height: 1.0;
  }

  .nav-link:hover, .record-button:hover, .nav-link:focus, .record-button:focus {
    background: rgba(255,255,255,0.03);
    transform: translateY(-1px);
    outline: none;
  }

  .nav-link.active, .nav-item.has-children.active > .record-button {
    background: linear-gradient(90deg, var(--accent), var(--accent-dark));
    color: #071122;
  }

  /* Dropdown */
  .nav-item { position: relative; }
  .dropdown {
    position: absolute;
    right: 0;
    top: 38px;
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.006));
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 8px;
    padding: 6px;
    min-width: 160px;
    box-shadow: 0 8px 30px rgba(2,6,23,0.6);
    display:flex;
    flex-direction: column;
    gap: 6px;
    z-index: 60;
  }

  .dropdown-link {
    padding: 8px 12px;
    border-radius: 8px;
    text-decoration: none;
    color: var(--nav-text);
    font-weight: 700;
    font-size: 0.95rem;
  }
  .dropdown-link:hover, .dropdown-link:focus { background: rgba(255,255,255,0.02); color:var(--nav-text); }
  .dropdown-link.active { background: linear-gradient(90deg, var(--accent), var(--accent-dark)); color: #071122; }

  .mobile-controls { display: none; align-items: center; gap: 8px; }
  .hamburger { background: transparent; border: none; padding: 8px; border-radius: 8px; cursor: pointer; color: var(--nav-text); }
  .hamburger-box { width: 22px; height: 16px; display:inline-block; position: relative; }
  .hamburger-inner, .hamburger-inner::before, .hamburger-inner::after { display: block; background-color: currentColor; height: 2px; border-radius: 2px; position: absolute; left: 0; right: 0; transition: transform 200ms ease, opacity 200ms ease; }
  .hamburger-inner { top: 50%; transform: translateY(-50%); }
  .hamburger-inner::before { content: ''; top: -7px; }
  .hamburger-inner::after { content: ''; top: 7px; }

  .hamburger[aria-expanded='true'] .hamburger-inner { transform: rotate(45deg); }
  .hamburger[aria-expanded='true'] .hamburger-inner::before { transform: rotate(90deg) translateX(-1px); top: 0; opacity: 0; }
  .hamburger[aria-expanded='true'] .hamburger-inner::after { transform: rotate(-90deg) translateX(-1px); top: 0; opacity: 0; }

  .mobile-menu { display: none; background: linear-gradient(180deg, rgba(6,10,15,0.95), rgba(6,10,15,0.98)); border-top: 1px solid rgba(255,255,255,0.03); box-shadow: 0 8px 40px rgba(0,0,0,0.6); }
  .mobile-menu.open { display: block; }
  .mobile-links { max-width: 1100px; margin: 0 auto; padding: 12px 16px; display:flex; flex-direction: column; gap: 6px; }
  .mobile-link, .mobile-section-title { display:block; padding: 12px 14px; border-radius: 10px; font-weight: 800; color: var(--nav-text); text-decoration: none; background: rgba(255,255,255,0.02); font-size: 0.95rem; }

  .mobile-section-title { font-weight: 900; opacity: 0.95; }
  .mobile-link.active { background: linear-gradient(90deg, var(--accent), var(--accent-dark)); color: #071122; }

  @media (max-width: 980px) {
    .nav-desktop { display: none; }
    .mobile-controls { display: inline-flex; }
    .brand-logo, .logo-emoji { width: 72px; height: 72px; }
    .brand-text { font-size: clamp(0.9rem, 3.0vw, 1.0rem); }
    .header-inner { padding: 0.45rem 0.75rem; gap: 0.6rem; }
  }

  @media (min-width: 981px) {
    .mobile-menu { display: none !important; }
  }
</style>
