<!--
  TeamBadge.svelte — one component to rule every "team logo + team name +
  manager handle" pill on the site. Previously this exact markup was
  duplicated 30+ times across the codebase (team-cell on standings,
  records-team, power-rankings, team-history; recap-card-body in matchups;
  trade-card sides on home; etc.) — each subtly different in spacing,
  fallback handling, or owner-visibility. Centralizing means a single
  CSS file to touch when Sleeper rev's its avatar URLs or when we want to
  tweak the avatar shape / size.

  Props:
    meta       — Sleeper roster meta `{ team_name, owner_name, team_avatar,
                 owner_avatar, owner_username, rosterId }`. The component
                 reads ALL fallbacks via `franchiseAvatar` / `franchiseName`
                 / `ownerName` so callers can pass any shape they have.
    size       — 'sm' (32px avatar, default), 'md' (42px), 'lg' (56px),
                 'xl' (80px). Picked to cover every existing usage.
    showOwner  — when true and a distinct owner_name exists, render it
                 below the team name. Default true.
    href       — when set, the whole badge becomes an <a> linking to
                 `/team/<owner_username>` for owner-hub deep-linking.
    inline     — when true the layout is `display: inline-flex` instead of
                 block; useful for placing the badge inside a sentence.
    align      — 'left' (default) or 'right' for RTL contexts like the
                 right side of a matchup card.
-->
<script>
  import { franchiseAvatar, franchiseName, ownerName } from '$lib/format';

  export let meta = null;
  export let size = 'sm';        // 'sm' | 'md' | 'lg' | 'xl'
  export let showOwner = true;
  export let href = null;
  export let inline = false;
  export let align = 'left';     // 'left' | 'right'

  $: name = franchiseName(meta);
  $: avatar = franchiseAvatar(meta, name);
  $: owner = meta?.owner_name ? ownerName(meta) : null;
  $: tag = href ? 'a' : 'div';
  $: linkHref = href === true && meta?.owner_username
    ? `/team/${encodeURIComponent(meta.owner_username)}`
    : (typeof href === 'string' ? href : null);
</script>

<svelte:element
  this={tag}
  class="team-badge size-{size} align-{align}"
  class:inline
  class:linked={!!linkHref}
  href={linkHref || undefined}
  data-testid={`team-badge-${meta?.rosterId ?? meta?.owner_username ?? 'unknown'}`}
>
  <img class="tb-avatar" src={avatar} alt={name} loading="lazy" />
  <div class="tb-meta">
    <div class="tb-name">{name}</div>
    {#if showOwner && owner && owner !== name}<div class="tb-owner">{owner}</div>{/if}
  </div>
</svelte:element>

<style>
  .team-badge {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }
  .team-badge.inline { display: inline-flex; }
  .team-badge.align-right { flex-direction: row-reverse; text-align: right; }
  .team-badge.linked { transition: opacity var(--t-fast); }
  .team-badge.linked:hover { opacity: 0.85; }

  .tb-avatar {
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .size-sm .tb-avatar { width: 32px; height: 32px; }
  .size-md .tb-avatar { width: 42px; height: 42px; }
  .size-lg .tb-avatar { width: 56px; height: 56px; }
  .size-xl .tb-avatar { width: 80px; height: 80px; }

  .tb-meta { min-width: 0; }
  .tb-name {
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .size-sm .tb-name { font-size: 0.88rem; }
  .size-md .tb-name { font-size: 1rem; }
  .size-lg .tb-name { font-size: 1.15rem; }
  .size-xl .tb-name { font-size: 1.4rem; }

  .tb-owner {
    color: var(--text-tertiary);
    font-size: 0.7rem;
    margin-top: 0.15rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .size-md .tb-owner, .size-lg .tb-owner { font-size: 0.78rem; }
  .size-xl .tb-owner { font-size: 0.85rem; margin-top: 0.25rem; }

  @media (max-width: 720px) {
    .size-md .tb-avatar, .size-lg .tb-avatar { width: 36px; height: 36px; }
    .size-xl .tb-avatar { width: 64px; height: 64px; }
  }
</style>
