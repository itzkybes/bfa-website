import { y as ensure_array_like, z as escape_html } from "../../../chunks/renderer.js";
import "@sveltejs/kit/internal";
import "../../../chunks/exports.js";
import "../../../chunks/utils.js";
import "@sveltejs/kit/internal/server";
import "../../../chunks/root.js";
import "../../../chunks/state.svelte.js";
import { S as SkeletonLoader } from "../../../chunks/ErrorBoundary.svelte_svelte_type_style_lang.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let selectedRow;
    let seasons = [];
    let selectedSeason = null;
    let seasonsResults = [];
    selectedRow = seasonsResults.find((r) => String(r.season) === String(selectedSeason)) ?? null;
    selectedRow?.overallMvp ?? null;
    selectedRow?.finalsMvp ?? null;
    $$renderer2.push(`<div class="page wrap svelte-135c079"><header class="page-head rise svelte-135c079"><div class="head-row svelte-135c079"><div><div class="eyebrow">All-Time · Player Records</div> <h1 class="page-title svelte-135c079">Player Records</h1></div> <div><label for="season-select" class="visually-hidden">Season</label> `);
    $$renderer2.select(
      {
        id: "season-select",
        value: selectedSeason,
        "data-testid": "player-season-select"
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
      SkeletonLoader($$renderer2, { variant: "row", count: 6 });
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
