<script>
  import { playerHeadshot } from '$lib/api';

  export let playerId = null;
  export let playerName = '';
  export let subtitle = '';
  export let size = 'default';

  let imageFailed = false;
  $: imageSrc = playerId && !imageFailed ? playerHeadshot(playerId) : '';
</script>

<div class="player-identity" class:large={size === 'large'} class:small={size === 'small'}>
  {#if imageSrc}
    <img src={imageSrc} alt="" loading="lazy" on:error={() => (imageFailed = true)} />
  {:else}
    <span class="player-placeholder" aria-hidden="true">🏀</span>
  {/if}
  <div class="player-copy">
    <div class="player-name">{playerName || (playerId ? `Player ${playerId}` : 'Unknown player')}</div>
    {#if subtitle}<div class="player-subtitle">{subtitle}</div>{/if}
  </div>
</div>

<style>
  .player-identity { display: flex; align-items: center; gap: 0.7rem; min-width: 0; }
  .player-identity img, .player-placeholder {
    width: 58px; height: 58px; flex: 0 0 auto; object-fit: cover;
    border-radius: var(--r-sm); border: 1px solid var(--border-subtle);
    background: var(--surface-2);
  }
  .player-identity.large img, .player-identity.large .player-placeholder { width: 68px; height: 68px; }
  .player-identity.small img, .player-identity.small .player-placeholder { width: 44px; height: 44px; }
  .player-placeholder { display: grid; place-items: center; font-size: 1.35rem; }
  .player-copy { min-width: 0; }
  .player-name { color: var(--text-primary); font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
  .player-subtitle {
    color: var(--text-tertiary); font-size: 0.72rem; font-weight: 700;
    margin-top: 0.18rem; text-transform: uppercase; letter-spacing: 0.06em;
  }
  @media (max-width: 720px) {
    .player-identity { gap: 0.4rem; }
    .player-identity img, .player-placeholder { width: 44px; height: 44px; }
    .player-identity.large img, .player-identity.large .player-placeholder { width: 48px; height: 48px; }
    .player-identity.small img, .player-identity.small .player-placeholder { width: 38px; height: 38px; }
    .player-subtitle { font-size: 0.62rem; }
  }
</style>
