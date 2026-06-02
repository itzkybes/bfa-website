<!-- src/lib/header/Header.svelte — BFA "Performance Pro" header -->
<script>
  import { page } from '$app/stores';
  import { onMount } from 'svelte';

  let open = false;        // mobile menu
  let recordsOpen = false; // desktop records dropdown
  let mounted = false;

  let mobileMenuEl;
  let hamburgerEl;
  let recordsDropdownEl;

  // close menus on route change
  $: if (mounted) {
    $page;
    open = false;
    recordsOpen = false;
  }

  onMount(() => {
    mounted = true;

    const onDocClick = (e) => {
      const t = e.target;
      if (open && mobileMenuEl && !mobileMenuEl.contains(t) && !(hamburgerEl && hamburgerEl.contains(t))) {
        open = false;
      }
      if (recordsOpen && recordsDropdownEl && !recordsDropdownEl.contains(t)) {
        recordsOpen = false;
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { open = false; recordsOpen = false; }
    };
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
  });

  const links = [
    { href: '/', label: 'Home' },
    { href: '/rosters', label: 'Rosters' },
    { href: '/matchups', label: 'Matchups' },
    { href: '/standings', label: 'Standings' },
    { href: '/power-rankings', label: 'Power' },
    {
      href: '/records',
      label: 'Records',
      children: [
        { href: '/records-team', label: 'Team Records' },
        { href: '/records-player', label: 'Player Records' }
      ]
    },
    { href: '/honor-hall', label: 'Honor Hall' }
  ];

  function isActive(path, href) {
    if (!path) return false;
    if (href === '/') return path === '/' || path === '';
    return path === href || path.startsWith(href + '/');
  }

  function isRecordsActive(path) {
    return path && (path.startsWith('/records-team') || path.startsWith('/records-player'));
  }
</script>

<header class="site-header" role="banner">
  <div class="wrap header-inner">
    <a class="brand" href="/" data-testid="brand-home-link" aria-label="Badger Fantasy Association home">
      <img
        src="/bfa-logo.png"
        alt="BFA"
        class="brand-logo"
        width="80"
        height="80"
        on:error={(e) => (e.currentTarget.style.display = 'none')}
        loading="eager"
      />
      <span class="brand-text">
        <span class="brand-line-1">Badger</span>
        <span class="brand-line-2">Fantasy Association</span>
      </span>
    </a>

    <nav class="nav-desktop" aria-label="Primary">
      {#each links as l}
        {#if l.children}
          <div
            class="nav-item has-children"
            class:active={isRecordsActive($page.url.pathname)}
            bind:this={recordsDropdownEl}
          >
            <button
              type="button"
              class="nav-link records-btn"
              aria-haspopup="true"
              aria-expanded={recordsOpen}
              on:click={(e) => { e.stopPropagation(); recordsOpen = !recordsOpen; }}
              data-testid="nav-records-toggle"
            >
              {l.label}
              <span class="caret" aria-hidden="true">▾</span>
            </button>

            {#if recordsOpen}
              <div class="dropdown" role="menu" aria-label="Records submenu">
                {#each l.children as c}
                  <a
                    href={c.href}
                    role="menuitem"
                    class="dropdown-link"
                    class:active={isActive($page.url.pathname, c.href)}
                    on:click={() => (recordsOpen = false)}
                    data-testid={`nav-dropdown-${c.href.replace(/\//g, '-').replace(/^-/, '')}`}
                  >
                    {c.label}
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <a
            href={l.href}
            class="nav-link"
            class:active={isActive($page.url.pathname, l.href)}
            aria-current={isActive($page.url.pathname, l.href) ? 'page' : undefined}
            data-testid={`nav-link-${l.label.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {l.label}
          </a>
        {/if}
      {/each}
    </nav>

    <button
      type="button"
      class="hamburger"
      bind:this={hamburgerEl}
      on:click={() => (open = !open)}
      aria-expanded={open}
      aria-controls="mobile-menu"
      aria-label={open ? 'Close menu' : 'Open menu'}
      data-testid="mobile-menu-toggle"
    >
      <span class="bar" class:open></span>
      <span class="bar" class:open></span>
      <span class="bar" class:open></span>
    </button>
  </div>

  {#if open}
    <div id="mobile-menu" bind:this={mobileMenuEl} class="mobile-menu" data-testid="mobile-menu">
      <div class="mobile-inner">
        {#each links as l}
          {#if l.children}
            <div class="mobile-section">
              <div class="mobile-section-title">{l.label}</div>
              {#each l.children as c}
                <a
                  href={c.href}
                  class="mobile-link"
                  class:active={isActive($page.url.pathname, c.href)}
                  on:click={() => (open = false)}
                  data-testid={`mobile-link-${c.href.replace(/\//g, '-').replace(/^-/, '')}`}
                >
                  {c.label}
                </a>
              {/each}
            </div>
          {:else}
            <a
              href={l.href}
              class="mobile-link"
              class:active={isActive($page.url.pathname, l.href)}
              on:click={() => (open = false)}
              data-testid={`mobile-link-${l.label.toLowerCase().replace(/\s+/g, '-')}`}
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
  .site-header {
    position: sticky;
    top: 0;
    z-index: 60;
    background: rgba(10, 10, 10, 0.85);
    backdrop-filter: saturate(140%) blur(12px);
    -webkit-backdrop-filter: saturate(140%) blur(12px);
    border-bottom: 1px solid var(--border-subtle);
  }

  .header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 0.85rem var(--s-5);
    max-width: 1200px;
    margin: 0 auto;
  }

  /* Brand */
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-primary);
    text-decoration: none;
  }

  .brand:hover { color: var(--accent); }

  .brand-logo {
    width: 72px;
    height: 72px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    line-height: 0.9;
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .brand-line-1 {
    font-size: 1.7rem;
    color: var(--brand);
  }

  .brand-line-2 {
    font-size: 1rem;
    color: var(--text-secondary);
    letter-spacing: 0.14em;
  }

  /* Desktop nav */
  .nav-desktop {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .nav-link,
  .records-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.6rem 0.95rem;
    border-radius: var(--r-sm);
    font-family: var(--font-body);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.78rem;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color var(--t-fast), background var(--t-fast);
  }

  .nav-link:hover,
  .records-btn:hover {
    color: var(--text-primary);
    background: var(--surface-1);
  }

  .nav-link.active,
  .nav-item.has-children.active > .records-btn {
    color: var(--accent);
    position: relative;
  }

  .nav-link.active::after,
  .nav-item.has-children.active > .records-btn::after {
    content: '';
    position: absolute;
    left: 0.95rem;
    right: 0.95rem;
    bottom: 0.25rem;
    height: 2px;
    background: var(--accent);
  }

  .nav-item { position: relative; }

  .caret {
    font-size: 0.7em;
    transition: transform var(--t-fast);
  }

  .records-btn[aria-expanded='true'] .caret {
    transform: rotate(180deg);
  }

  .dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    min-width: 200px;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 0.25rem;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
    z-index: 70;
    animation: dd-fade 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  @keyframes dd-fade {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .dropdown-link {
    display: block;
    padding: 0.7rem 0.85rem;
    font-family: var(--font-body);
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text-secondary);
    text-decoration: none;
    border-radius: var(--r-sm);
    transition: color var(--t-fast), background var(--t-fast);
  }

  .dropdown-link:hover {
    background: var(--surface-2);
    color: var(--text-primary);
  }

  .dropdown-link.active {
    color: var(--accent);
    background: var(--accent-soft);
  }

  /* Hamburger */
  .hamburger {
    display: none;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    width: 40px;
    height: 40px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: border-color var(--t-fast);
  }

  .hamburger:hover { border-color: var(--accent); }

  .bar {
    display: block;
    height: 2px;
    width: 22px;
    background: var(--text-primary);
    margin: 0 auto;
    transition: transform var(--t-base), opacity var(--t-base);
  }

  .bar.open:nth-child(1) { transform: translateY(7px) rotate(45deg); }
  .bar.open:nth-child(2) { opacity: 0; }
  .bar.open:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

  /* Mobile menu */
  .mobile-menu {
    background: var(--surface-1);
    border-top: 1px solid var(--border-subtle);
    border-bottom: 1px solid var(--border-subtle);
    animation: slide 220ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  @keyframes slide {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .mobile-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0.85rem var(--s-5);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .mobile-link,
  .mobile-section-title {
    padding: 0.85rem 0.85rem;
    font-family: var(--font-body);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.8rem;
    color: var(--text-secondary);
    border-left: 2px solid transparent;
    text-decoration: none;
    transition: color var(--t-fast), background var(--t-fast), border-color var(--t-fast);
  }

  .mobile-link:hover {
    color: var(--text-primary);
    background: var(--surface-2);
    border-color: var(--border-strong);
  }

  .mobile-link.active {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .mobile-section-title {
    color: var(--accent);
    font-size: 0.72rem;
    pointer-events: none;
    padding-top: 1.1rem;
  }

  .mobile-section {
    display: flex;
    flex-direction: column;
  }

  /* Breakpoints */
  @media (max-width: 980px) {
    .nav-desktop { display: none; }
    .hamburger { display: inline-flex; }
    .brand-logo { width: 56px; height: 56px; }
    .brand-line-1 { font-size: 1.3rem; }
    .brand-line-2 { font-size: 0.78rem; }
    .header-inner { padding: 0.7rem var(--s-4); }
  }

  @media (max-width: 480px) {
    .brand-line-2 { display: none; }
    .brand-line-1 { font-size: 1.5rem; }
  }
</style>
