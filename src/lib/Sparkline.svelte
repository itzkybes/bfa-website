<!--
  src/lib/Sparkline.svelte

  Tiny dependency-free SVG sparkline. Renders `points` as a fitted line + the
  most recent value as a dot. Used in the Standings page to show each team's
  PF/week trend without pulling in chart.js.

  Props:
    - points: Array<number>      required, the y-values in order
    - width:  number             pixel width  (default 120)
    - height: number             pixel height (default 32)
    - stroke: CSS color string   line color   (default `var(--accent)`)
    - fill:   CSS color string   area fill    (default `transparent`)
    - dotted: boolean            draw a dot at the latest point (default true)
-->
<script>
  /** @type {number[]} */
  export let points = [];
  export let width = 120;
  export let height = 32;
  export let stroke = 'var(--accent)';
  export let fill = 'transparent';
  export let dotted = true;
  export let ariaLabel = 'trend';

  const PAD = 2;

  $: clean = (Array.isArray(points) ? points : []).map((v) => Number(v) || 0);
  $: hasData = clean.length >= 2;
  $: min = hasData ? Math.min(...clean) : 0;
  $: max = hasData ? Math.max(...clean) : 1;
  $: range = max - min || 1;
  $: stepX = hasData ? (width - PAD * 2) / (clean.length - 1) : 0;
  $: coords = clean.map((v, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (height - PAD * 2) * (1 - (v - min) / range);
    return [x, y];
  });
  $: path = coords.map(([x, y], i) => (i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`)).join(' ');
  $: areaPath = hasData
    ? `${path} L${coords[coords.length - 1][0].toFixed(2)},${height - PAD} L${coords[0][0].toFixed(2)},${height - PAD} Z`
    : '';
  $: last = hasData ? coords[coords.length - 1] : null;
</script>

{#if hasData}
  <svg class="spark" {width} {height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
    {#if fill && fill !== 'transparent'}
      <path d={areaPath} fill={fill} stroke="none" />
    {/if}
    <path d={path} fill="none" stroke={stroke} stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    {#if dotted && last}
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={stroke} />
    {/if}
  </svg>
{:else}
  <span class="spark-empty" aria-hidden="true">—</span>
{/if}

<style>
  .spark { display: inline-block; vertical-align: middle; }
  .spark-empty { display: inline-block; width: 120px; text-align: center; color: var(--text-tertiary); font-size: 0.75rem; }
</style>
