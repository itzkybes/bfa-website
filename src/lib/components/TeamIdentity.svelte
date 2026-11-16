<script>
  export let meta = {};
  export let href = null;
  export let subtitle = '';
  export let size = 'small';

  let imageFailed = false;
  $: teamName = meta?.team_name || (meta?.roster_id ? `Roster ${meta.roster_id}` : 'Franchise');
  $: avatarUrl = (meta?.team_avatar || meta?.owner_avatar) && !imageFailed
    ? (meta.team_avatar || meta.owner_avatar)
    : '';
  $: initials = String(teamName || 'T').trim().slice(0, 2).toUpperCase();
</script>

<div class="team-identity" class:large={size === 'large'} class:compact={size === 'compact'}>
  {#if avatarUrl}
    <img src={avatarUrl} alt="" loading="lazy" on:error={() => (imageFailed = true)} />
  {:else}
    <span class="team-placeholder" aria-hidden="true">{initials}</span>
  {/if}
  <div class="team-copy">
    {#if href}
      <a class="team-name" href={href}>{teamName}</a>
    {:else}
      <div class="team-name">{teamName}</div>
    {/if}
    {#if subtitle}<div class="team-subtitle">{subtitle}</div>{/if}
  </div>
</div>

<style>
  .team-identity { display: flex; align-items: center; gap: 0.7rem; min-width: 0; }
  .team-identity img, .team-placeholder {
    width: 42px; height: 42px; flex: 0 0 auto; object-fit: cover;
    border-radius: var(--r-sm); border: 1px solid var(--border-subtle);
    background: var(--surface-2);
  }
  .team-identity.large img, .team-identity.large .team-placeholder { width: 54px; height: 54px; }
  .team-identity.compact img, .team-identity.compact .team-placeholder { width: 38px; height: 38px; }
  .team-identity.compact .team-name { font-family: var(--font-display); font-size: 0.98rem; text-transform: uppercase; letter-spacing: 0.035em; }
  .team-identity.compact .team-subtitle { font-size: 0.7rem; }
  .team-placeholder {
    display: grid; place-items: center; color: var(--text-secondary);
    font-family: var(--font-display); font-size: 1rem;
  }
  .team-copy { min-width: 0; }
  .team-name {
    display: block; color: var(--text-primary); font-weight: 700;
    line-height: 1.15; text-decoration: none; overflow-wrap: anywhere;
  }
  a.team-name:hover { color: var(--accent); }
  .team-subtitle { color: var(--text-tertiary); font-size: 0.76rem; margin-top: 0.15rem; }
  @media (max-width: 720px) {
    .team-identity { gap: 0.4rem; }
    .team-identity img, .team-placeholder { width: 34px; height: 34px; }
    .team-identity.large img, .team-identity.large .team-placeholder { width: 40px; height: 40px; }
    .team-subtitle { font-size: 0.64rem; }
  }
</style>
