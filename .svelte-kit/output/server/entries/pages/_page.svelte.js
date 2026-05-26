import { D as fallback, z as ensure_array_like, m as bind_props, A as escape_html } from "../../chunks/renderer.js";
import "clsx";
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
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    urlParams && urlParams.get("week") ? parseInt(urlParams.get("week"), 10) : null;
    urlParams && urlParams.get("league") || void 0 || "1219816671624048640";
    $$renderer2.push(`<section class="hero svelte-1uha8ag" data-testid="hero-section"><div class="hero-bg svelte-1uha8ag" aria-hidden="true"></div> <div class="hero-grid-overlay svelte-1uha8ag" aria-hidden="true"></div> <div class="wrap hero-inner svelte-1uha8ag"><div class="hero-copy rise svelte-1uha8ag"><div class="eyebrow svelte-1uha8ag">Season 2025 / 26 · Live</div> <h1 class="hero-title svelte-1uha8ag">Welcome to the<br class="svelte-1uha8ag"/> <span class="title-accent svelte-1uha8ag">Badger Bowl</span></h1> <p class="hero-sub svelte-1uha8ag">Track rosters, standings, matchups, and league records. Real-time data straight from Sleeper —
        no fluff, just the cold hard buckets.</p> <div class="hero-actions svelte-1uha8ag"><a class="btn primary svelte-1uha8ag" href="/rosters" data-testid="hero-cta-rosters">View Rosters →</a> <a class="btn svelte-1uha8ag" href="/standings" data-testid="hero-cta-standings">See Standings</a></div></div> <aside class="rando rise svelte-1uha8ag" aria-label="Rando Player spotlight" data-testid="rando-card"><div class="rando-label svelte-1uha8ag"><span class="rando-dot svelte-1uha8ag"></span> Rando Player</div> `);
    {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<div class="rando-body svelte-1uha8ag"><div class="shimmer rando-headshot svelte-1uha8ag" style="opacity:0.5"></div> <div style="flex:1;" class="svelte-1uha8ag"><div class="shimmer svelte-1uha8ag" style="height:18px; width:60%; margin-bottom:8px;"></div> <div class="shimmer svelte-1uha8ag" style="height:12px; width:40%;"></div></div></div>`);
    }
    $$renderer2.push(`<!--]--></aside></div></section> <section class="wrap matchups-section svelte-1uha8ag" aria-labelledby="matchups-h"><div class="section-head svelte-1uha8ag"><div class="svelte-1uha8ag"><div class="eyebrow svelte-1uha8ag">This Week</div> <h2 id="matchups-h" class="section-title svelte-1uha8ag">Matchups</h2></div> <div class="week-pill svelte-1uha8ag" data-testid="current-week-pill"><span class="week-num svelte-1uha8ag">W${escape_html("?")}</span> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div></div> `);
    {
      $$renderer2.push("<!--[0-->");
      SkeletonLoader($$renderer2, { variant: "matchup", count: 5 });
    }
    $$renderer2.push(`<!--]--></section>`);
  });
}
export {
  _page as default
};
