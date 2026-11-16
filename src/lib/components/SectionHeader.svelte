<script>
  export let eyebrow = '';
  export let title = '';
  export let titleId = undefined;
  export let description = '';
  export let meta = '';
  export let compact = false;
</script>
<div class="section-header" class:compact>
  <div class="section-copy">
    {#if eyebrow}<div class="eyebrow">{eyebrow}</div>{/if}
    <h2 id={titleId} class="section-title">{title}</h2>
    {#if description}<p class="section-description">{description}</p>{/if}
  </div>
  {#if meta}<div class="section-meta">{meta}</div>{/if}
</div>
<style>
  .section-header { display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; flex-wrap:wrap; margin-bottom:1.25rem; }
  .section-copy { display:flex; flex-direction:column; gap:.35rem; min-width:0; }
  .section-title { font-family:var(--font-display); font-size:clamp(2rem,4vw,3rem); letter-spacing:.02em; text-transform:uppercase; color:var(--text-primary); margin:0; }
  .section-description { color:var(--text-secondary); font-size:.92rem; }
  .section-meta { color:var(--text-tertiary); font-size:.75rem; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
  .section-header.compact { align-items:center; padding:1rem 1.25rem; margin:0; border-bottom:1px solid var(--border-subtle); }
  .section-header.compact .section-title { font-size:1.3rem; letter-spacing:.05em; }
  .section-header.compact .section-description { color:var(--text-tertiary); font-size:.72rem; font-weight:700; letter-spacing:.15em; text-transform:uppercase; }
  @media(max-width:720px) {
    .section-header:not(.compact) { align-items:flex-start; flex-direction:column; gap:.75rem; }
    .section-header.compact { padding:.85rem 1rem; }
    .section-header.compact .section-title { font-size:1.05rem; }
  }
</style>