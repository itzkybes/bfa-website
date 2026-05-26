import "clsx";
import { S as SkeletonLoader } from "../../../chunks/ErrorBoundary.svelte_svelte_type_style_lang.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    $$renderer2.push(`<div class="page wrap svelte-y04zar"><header class="page-head rise svelte-y04zar"><div class="eyebrow">League Rosters`);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> <h1 class="page-title svelte-y04zar">Team Rosters</h1> <p class="page-sub svelte-y04zar">Current season starting lineups, bench, and taxi squads.</p></header> `);
    {
      $$renderer2.push("<!--[0-->");
      SkeletonLoader($$renderer2, { variant: "team", count: 6 });
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
