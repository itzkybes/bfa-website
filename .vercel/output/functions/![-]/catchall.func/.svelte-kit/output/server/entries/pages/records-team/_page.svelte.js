import "clsx";
import { S as SkeletonLoader } from "../../../chunks/ErrorBoundary.svelte_svelte_type_style_lang.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    $$renderer2.push(`<div class="page wrap svelte-16nribx"><header class="page-head rise svelte-16nribx"><div class="eyebrow">All-Time · Team Records</div> <h1 class="page-title svelte-16nribx">Team Records</h1> <p class="page-sub svelte-16nribx">Aggregated stats across every available season — head-to-head matchups, biggest blowouts and nailbiters.</p></header> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="loading-card svelte-16nribx">`);
      SkeletonLoader($$renderer2, { variant: "row", count: 4 });
      $$renderer2.push(`<!----> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div>`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
