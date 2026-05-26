import "clsx";
import "@sveltejs/kit/internal";
import "../../../../chunks/exports.js";
import "../../../../chunks/utils.js";
import "@sveltejs/kit/internal/server";
import "../../../../chunks/root.js";
import "../../../../chunks/state.svelte.js";
import { S as SkeletonLoader } from "../../../../chunks/ErrorBoundary.svelte_svelte_type_style_lang.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    $$renderer2.push(`<div class="page wrap svelte-12f7qkc"><header class="page-head rise svelte-12f7qkc"><div class="eyebrow">Admin · Tooling</div> <h1 class="page-title svelte-12f7qkc">Generate Season Matchups JSON</h1> <p class="page-sub svelte-12f7qkc">Fetches matchups + roster metadata from Sleeper and produces JSON payloads mirroring <code class="svelte-12f7qkc">/season_matchups/&lt;year>.json</code>. Files are NOT written — copy the JSON into GitHub. Pass <code class="svelte-12f7qkc">?years=2022,2023,2024</code> in the URL.</p></header> `);
    {
      $$renderer2.push("<!--[0-->");
      SkeletonLoader($$renderer2, { variant: "text", count: 6 });
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
