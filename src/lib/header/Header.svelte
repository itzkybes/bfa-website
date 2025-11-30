<!-- src/lib/header/Header.svelte -->
<script>
  import { page } from '$app/stores';
  import { onMount } from 'svelte';

  let open = false;
  let mounted = false;

  let logoVisible = true;
  let logoSrcs = ['/bfa-logo.png'];
  let currentLogo = logoSrcs[0];

  // element refs for outside-click detection
  let mobileMenu;
  let hamburgerBtn;
  let recordsDropdownEl;

  // close mobile menu & desktop dropdown on route change
  $: if (mounted) {
    $page;
    open = false;
    recordsOpen = false;
  }

  onMount(() => {
    mounted = true;

    // click outside handler
    const handleDocClick = (e) => {
      const target = e.target;

      // MOBILE: close mobile menu when clicking outside it/hamburger
      if (open) {
        if (mobileMenu && !mobileMenu.contains(target) && !(hamburgerBtn && hamburgerBtn.contains(target))) {
          open = false;
        }
      }

      // DESKTOP: close records dropdown if click outside
      if (recordsOpen) {
        if (recordsDropdownEl && !recordsDropdownEl.contains(target)) {
          recordsOpen = false;
        }
      }
    };

    // escape key to close
    const handleKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        open = false;
        recordsOpen = false;
      }
      
      // Close dropdown on Tab out
      if (e.key === 'Tab' && recordsOpen) {
        setTimeout(() => {
          if (recordsDropdownEl && !recordsDropdownEl.contains(document.activeElement)) {
            recordsOpen = false;
          }
        }, 0);
      }
    };

    document.addEventListener('click', handleDocClick, true);
    document.addEventListener('keydown', handleKey, true);

    return () => {
      document.removeEventListener('click', handleDocClick, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  });

  const links = [
    { href: '/', label: 'Home' },
    { href: '/rosters', label: 'Rosters' },
    { href: '/matchups', label: 'Matchups' },
    { href: '/standings', label: 'Standings' },
    { href: '/records', label: 'Records', children: [
      { href: '/records-team', label: 'Team records' },
      { href: '/records-player', label: 'Player records' }
    ]},
    { href: '/honor-hall', label: 'Honor Hall' }
  ];

  function isActive(path, href) {
    if (!path) return false;
    if (href === '/' && (path === '/' || path === '')) return true;
    if (href !== '/' && path.startsWith(href)) return true;
    return path === href;
  }

  function onLogoError() {
    const next = logoSrcs.indexOf(currentLogo) + 1;
    if (next < logoSrcs.length) {
      currentLogo = logoSrcs[next];
    } else {
      logoVisible = false;
    }
  }

  let recordsOpen = false;
  function toggleRecords(e) {
    e.stopPropagation();
    recordsOpen = !recordsOpen;
  }

  $: if (open) {
    recordsOpen = false;
  }

  function onDropdownLinkClick() {
    recordsOpen = false;
  }

  function onMobileLinkClick() {
    open = false;
  }

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
          width="96"
          height="96"
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
          <div 
            class="nav-item has-children {isActive($page.url.pathname, l.href) ? 'active' : ''}"
            bind:this={recordsDropdownEl}
          >
            <button 
              class="nav-link record-button" 
              aria-haspopup="true" 
              aria-expanded={recordsOpen} 
              on:click={toggleRecords} 
              type="button"
            >
              {l.label} <span class="caret" aria-hidden="true">▾</span>
            </button>

            {#if recordsOpen}
              <div class="dropdown" role="menu" aria-label="Records submenu">
                {#each l.children as c}
                  <a 
                    href={c.href} 
                    class="dropdown-link {isActive($page.url.pathname, c.href) ? 'active' : ''}" 
                    role="menuitem" 
                    on:click={onDropdownLinkClick}
                  >
                    {c.label}
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          
            href={l.href}
            class="nav-link {isActive($page.url.pathname, l.href) ? 'active' : ''}"
            aria-current={isActive($page.url.pathname, l.href) ? 'page' : undefined}
            on:click={() => (recordsOpen = false)}
          >
            {l.label}
          </a>
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

  {#if open}
    <div 
      id="mobile-menu" 
      bind:this={mobileMenu} 
      class="mobile-menu" 
      aria-hidden={!open}
    >
      <div class="mobile-links">
        {#each links as l}
          {#if l.children}
            <div class="mobile-section">
              <div class="mobile-section-title">{l.label}</div>
              {#each l.children as c}
                
                  href={c.href}
                  class="mobile-link {isActive($page.url.pathname, c.href) ? 'active' : ''}"
                  on:click={onMobileLinkClick}
                  aria-current={isActive($page.url.pathname, c.href) ? 'page' : undefined}
                >
                  {c.label}
                </a>
              {/each}
            </div>
          {:else}
            
              href={l.href}
              class="mobile-link {isActive($page.url.pathname, l.href) ? 'active' : ''}"
              on:click={onMobileLinkClick}
              aria-current={isActive($page.url.pathname, l.href) ? 'page' : undefined}
            >
              {l.label}
            </a>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</header>

<style>
  :root {
    --nav-text: #e6eef6;
    --muted: #9fb0c4;
    --accent: #00c6d8;
    --accent-dark: #008fa6;
    --transition-fast: 140ms ease;
    --transition-base: 180ms ease;
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

  .brand {
    display: inline-flex;
    gap: 0.9rem;
    align-items: center;
    text-decoration: none;
    color: var(--nav-text);
    flex: 0 1 auto;
    min-width: 0;
    transition: opacity var(--transition-fast);
  }

  .brand:hover {
    opacity: 0.9;
  }

  .brand:focus-visible {
    outline: 3px solid rgba(0, 198, 216, 0.5);
    outline-offset: 2px;
    border-radius: 8px;
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
    transition: background var(--transition-fast), color var(--transition-fast), transform var(--transition-fast);
    border: none;
    cursor: pointer;
    font-size: 0.95rem;
    line-height: 1.0;
  }

  .nav-link:hover, .record-button:hover {
    background: rgba(255,255,255,0.05);
    transform: translateY(-1px);
  }

  .nav-link:focus-visible, .record-button:focus-visible {
    outline: 3px solid rgba(0, 198, 216, 0.5);
    outline-offset: 2px;
    background: rgba(255,255,255,0.03);
  }

  .nav-link.active, .nav-item.has-children.active > .record-button {
    background: linear-gradient(90deg, var(--accent), var(--accent-dark));
    color: #071122;
  }

  .nav-item { 
    position: relative; 
  }
  
  .dropdown {
    position: absolute;
    right: 0;
    top: 100%;
    margin-top: 4px;
    background: linear-gradient(180deg, rgba(15, 23, 36, 0.98), rgba(7, 14, 26, 0.98));
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 8px;
    min-width: 180px;
    box-shadow: 0 12px 32px rgba(2,6,23,0.7);
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 70;
    animation: dropdownFade 200ms ease-out;
  }

  @keyframes dropdownFade {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .dropdown-link {
    padding: 10px 14px;
    border-radius: 8px;
    text-decoration: none;
    color: var(--nav-text);
    font-weight: 700;
    font-size: 0.95rem;
    transition: background var(--transition-fast), color var(--transition-fast);
  }
  
  .dropdown-link:hover {
    background: rgba(255,255,255,0.06);
  }
  
  .dropdown-link:focus-visible {
    outline: 3px solid rgba(0, 198, 216, 0.5);
    outline-offset: -2px;
  }
  
  .dropdown-link.active { 
    background: linear-gradient(90deg, var(--accent), var(--accent-dark)); 
    color: #071122; 
  }

  .caret {
    margin-left: 4px;
    font-size: 0.75em;
    transition: transform var(--transition-fast);
  }

  .record-button[aria-expanded="true"] .caret {
    transform: rotate(180deg);
  }

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
    color: var(--nav-text);
    transition: background var(--transition-fast);
  }

  .hamburger:hover {
    background: rgba(255,255,255,0.05);
  }

  .hamburger:focus-visible {
    outline: 3px solid rgba(0, 198, 216, 0.5);
    outline-offset: 2px;
  }
  
  .hamburger-box { 
    width: 22px; 
    height: 16px; 
    display: inline-block; 
    position: relative; 
  }
  
  .hamburger-inner, .hamburger-inner::before, .hamburger-inner::after { 
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

  .mobile-menu { 
    background: linear-gradient(180deg, rgba(6,10,15,0.98), rgba(6,10,15,0.99)); 
    border-top: 1px solid rgba(255,255,255,0.04); 
    box-shadow: 0 12px 40px rgba(0,0,0,0.7);
    animation: slideDown 250ms ease-out;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .mobile-links { 
    max-width: 1100px; 
    margin: 0 auto; 
    padding: 16px 20px; 
    display: flex; 
    flex-direction: column; 
    gap: 8px; 
  }
  
  .mobile-link, .mobile-section-title { 
    display: block; 
    padding: 14px 16px; 
    border-radius: 10px; 
    font-weight: 800; 
    color: var(--nav-text); 
    text-decoration: none; 
    background: rgba(255,255,255,0.03); 
    font-size: 0.95rem;
    transition: background var(--transition-fast), transform var(--transition-fast);
  }

  .mobile-link:hover {
    background: rgba(255,255,255,0.08);
    transform: translateX(4px);
  }

  .mobile-link:focus-visible {
    outline: 3px solid rgba(0, 198, 216, 0.5);
    outline-offset: -2px;
  }

  .mobile-section-title { 
    font-weight: 900; 
    opacity: 0.95;
    background: rgba(255,255,255,0.05);
    pointer-events: none;
  }
  
  .mobile-link.active { 
    background: linear-gradient(90deg, var(--accent), var(--accent-dark)); 
    color: #071122; 
  }

  .mobile-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  @media (max-width: 980px) {
    .nav-desktop { 
      display: none; 
    }
    
    .mobile-controls { 
      display: inline-flex; 
    }
    
    .brand-logo, .logo-emoji { 
      width: 72px; 
      height: 72px; 
    }
    
    .brand-text { 
      font-size: clamp(0.9rem, 3.0vw, 1.0rem); 
    }
    
    .header-inner { 
      padding: 0.45rem 0.75rem; 
      gap: 0.6rem; 
    }

    .mobile-menu {
      max-height: calc(100vh - 80px);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }
  }

  @media (min-width: 981px) {
    .mobile-menu { 
      display: none !important; 
    }
  }

  @media (max-width: 520px) {
    .brand-logo, .logo-emoji {
      width: 56px;
      height: 56px;
    }

    .brand-text {
      font-size: 0.85rem;
    }
  }
</style>
