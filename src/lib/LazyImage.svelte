<script>
  export let src = '';
  export let alt = '';
  export let className = '';
  export let width = undefined;
  export let height = undefined;
  export let placeholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';
  
  let loaded = false;
  let failed = false;
  let imgElement;

  function handleLoad() {
    loaded = true;
  }

  function handleError() {
    failed = true;
  }
</script>

<style>
  .lazy-image {
    transition: opacity 0.3s ease;
  }

  .lazy-image.loading {
    opacity: 0.5;
    background: rgba(255,255,255,0.03);
  }

  .lazy-image.loaded {
    opacity: 1;
  }

  .lazy-image.failed {
    opacity: 0.3;
    visibility: hidden;
  }
</style>

<img
  bind:this={imgElement}
  src={failed ? placeholder : src}
  {alt}
  class="{className} lazy-image {loaded ? 'loaded' : 'loading'} {failed ? 'failed' : ''}"
  {width}
  {height}
  loading="lazy"
  decoding="async"
  on:load={handleLoad}
  on:error={handleError}
/>
