import { z as escape_html } from "../../chunks/renderer.js";
import "clsx";
import { S as SkeletonLoader } from "../../chunks/ErrorBoundary.svelte_svelte_type_style_lang.js";
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
