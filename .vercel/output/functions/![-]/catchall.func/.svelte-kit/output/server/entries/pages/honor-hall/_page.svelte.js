import { z as escape_html, y as ensure_array_like } from "../../../chunks/renderer.js";
import "@sveltejs/kit/internal";
import "../../../chunks/exports.js";
import "../../../chunks/utils.js";
import "@sveltejs/kit/internal/server";
import "../../../chunks/root.js";
import "../../../chunks/state.svelte.js";
import { S as SkeletonLoader } from "../../../chunks/ErrorBoundary.svelte_svelte_type_style_lang.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let seasons = [];
    let selectedSeason = null;
    $$renderer2.push(`<div class="page wrap svelte-6p8nw1"><header class="page-head rise svelte-6p8nw1"><div class="head-row svelte-6p8nw1"><div><div class="eyebrow">Honors · Season ${escape_html(selectedSeason)}</div> <h1 class="page-title svelte-6p8nw1">Honor Hall</h1> <p class="page-sub svelte-6p8nw1">Final placements derived from the playoff window.</p></div> <div><label for="season-select" class="visually-hidden">Season</label> `);
    $$renderer2.select(
      {
        id: "season-select",
        value: selectedSeason,
        "data-testid": "honor-season-select"
      },
      ($$renderer3) => {
        $$renderer3.push(`<!--[-->`);
        const each_array = ensure_array_like(seasons);
        for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
          let s = each_array[$$index];
          $$renderer3.option({ value: s.season ?? s.league_id }, ($$renderer4) => {
            $$renderer4.push(`${escape_html(s.season ?? s.name)}`);
          });
        }
        $$renderer3.push(`<!--]-->`);
      }
    );
    $$renderer2.push(`</div></div></header> `);
    {
      $$renderer2.push("<!--[0-->");
      SkeletonLoader($$renderer2, { variant: "row", count: 8 });
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
