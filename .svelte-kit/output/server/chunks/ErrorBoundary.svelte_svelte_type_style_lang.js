import { A as fallback, y as ensure_array_like, l as bind_props } from "./renderer.js";
function SkeletonLoader($$renderer, $$props) {
  let variant = fallback(
    $$props["variant"],
    "card"
    // 'card' | 'team' | 'matchup' | 'player' | 'text' | 'row'
  );
  let count = fallback($$props["count"], 1);
  if (variant === "card") {
    $$renderer.push("<!--[0-->");
    $$renderer.push(`<!--[-->`);
    const each_array = ensure_array_like(Array(count));
    for (let i = 0, $$length = each_array.length; i < $$length; i++) {
      each_array[i];
      $$renderer.push(`<div class="sk-card svelte-1d1a0sj"><div class="sk-row svelte-1d1a0sj"><div class="shimmer sk-avatar svelte-1d1a0sj"></div> <div style="flex:1;"><div class="shimmer sk-line title svelte-1d1a0sj"></div> <div class="shimmer sk-line subtitle svelte-1d1a0sj"></div></div></div></div>`);
    }
    $$renderer.push(`<!--]-->`);
  } else if (variant === "matchup") {
    $$renderer.push("<!--[1-->");
    $$renderer.push(`<div class="sk-matchups svelte-1d1a0sj"><!--[-->`);
    const each_array_1 = ensure_array_like(Array(count));
    for (let i = 0, $$length = each_array_1.length; i < $$length; i++) {
      each_array_1[i];
      $$renderer.push(`<div class="sk-matchup svelte-1d1a0sj"><div class="sk-side svelte-1d1a0sj"><div class="shimmer sk-avatar svelte-1d1a0sj"></div> <div style="flex:1;"><div class="shimmer sk-line title svelte-1d1a0sj"></div> <div class="shimmer sk-line subtitle svelte-1d1a0sj"></div></div></div> <div class="shimmer sk-score svelte-1d1a0sj"></div> <div class="sk-side right svelte-1d1a0sj"><div style="flex:1; text-align:right;"><div class="shimmer sk-line title right svelte-1d1a0sj"></div> <div class="shimmer sk-line subtitle right svelte-1d1a0sj"></div></div> <div class="shimmer sk-avatar svelte-1d1a0sj"></div></div></div>`);
    }
    $$renderer.push(`<!--]--></div>`);
  } else if (variant === "team") {
    $$renderer.push("<!--[2-->");
    $$renderer.push(`<div class="sk-teams svelte-1d1a0sj"><!--[-->`);
    const each_array_2 = ensure_array_like(Array(count));
    for (let i = 0, $$length = each_array_2.length; i < $$length; i++) {
      each_array_2[i];
      $$renderer.push(`<div class="sk-team svelte-1d1a0sj"><div class="shimmer sk-avatar big svelte-1d1a0sj"></div> <div style="flex:1;"><div class="shimmer sk-line title svelte-1d1a0sj"></div> <div class="shimmer sk-line subtitle svelte-1d1a0sj"></div></div></div>`);
    }
    $$renderer.push(`<!--]--></div>`);
  } else if (variant === "player") {
    $$renderer.push("<!--[3-->");
    $$renderer.push(`<!--[-->`);
    const each_array_3 = ensure_array_like(Array(count));
    for (let i = 0, $$length = each_array_3.length; i < $$length; i++) {
      each_array_3[i];
      $$renderer.push(`<div class="sk-player svelte-1d1a0sj"><div class="shimmer sk-avatar svelte-1d1a0sj"></div> <div style="flex:1;"><div class="shimmer sk-line title svelte-1d1a0sj"></div> <div class="shimmer sk-line subtitle svelte-1d1a0sj"></div></div></div>`);
    }
    $$renderer.push(`<!--]-->`);
  } else if (variant === "row") {
    $$renderer.push("<!--[4-->");
    $$renderer.push(`<!--[-->`);
    const each_array_4 = ensure_array_like(Array(count));
    for (let i = 0, $$length = each_array_4.length; i < $$length; i++) {
      each_array_4[i];
      $$renderer.push(`<div class="shimmer sk-line svelte-1d1a0sj" style="height:36px; margin-bottom:6px;"></div>`);
    }
    $$renderer.push(`<!--]-->`);
  } else {
    $$renderer.push("<!--[-1-->");
    $$renderer.push(`<!--[-->`);
    const each_array_5 = ensure_array_like(Array(count));
    for (let i = 0, $$length = each_array_5.length; i < $$length; i++) {
      each_array_5[i];
      $$renderer.push(`<div class="shimmer sk-line svelte-1d1a0sj" style="margin-bottom:8px;"></div>`);
    }
    $$renderer.push(`<!--]-->`);
  }
  $$renderer.push(`<!--]-->`);
  bind_props($$props, { variant, count });
}
export {
  SkeletonLoader as S
};
