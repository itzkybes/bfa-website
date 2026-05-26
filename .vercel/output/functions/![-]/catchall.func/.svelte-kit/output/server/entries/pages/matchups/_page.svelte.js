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
    let seasons = [];
    let selectedSeason = null;
    let selectedWeek = 1;
    let weekOptions = { regular: [], playoffs: [] };
    $$renderer2.push(`<div class="page wrap svelte-1wazkji"><header class="page-head rise svelte-1wazkji"><div class="head-row svelte-1wazkji"><div><div class="eyebrow">League · Week-by-Week</div> <h1 class="page-title svelte-1wazkji">Matchups</h1></div> <div class="filters svelte-1wazkji"><label for="season" class="visually-hidden">Season</label> `);
    $$renderer2.select(
      {
        id: "season",
        value: selectedSeason,
        "data-testid": "matchups-season-select",
        class: ""
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
      },
      "svelte-1wazkji"
    );
    $$renderer2.push(` <label for="week" class="visually-hidden">Week</label> `);
    $$renderer2.select(
      {
        id: "week",
        value: selectedWeek,
        "data-testid": "matchups-week-select",
        class: ""
      },
      ($$renderer3) => {
        if (weekOptions.regular?.length) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<optgroup label="Regular Season"><!--[-->`);
          const each_array_1 = ensure_array_like(weekOptions.regular);
          for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
            let w = each_array_1[$$index_1];
            $$renderer3.option({ value: w }, ($$renderer4) => {
              $$renderer4.push(`Week ${escape_html(w)}`);
            });
          }
          $$renderer3.push(`<!--]--></optgroup>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]-->`);
        if (weekOptions.playoffs?.length) {
          $$renderer3.push("<!--[0-->");
          $$renderer3.push(`<optgroup label="Playoffs"><!--[-->`);
          const each_array_2 = ensure_array_like(weekOptions.playoffs);
          for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
            let w = each_array_2[$$index_2];
            $$renderer3.option({ value: w }, ($$renderer4) => {
              $$renderer4.push(`Week ${escape_html(w)}`);
            });
          }
          $$renderer3.push(`<!--]--></optgroup>`);
        } else {
          $$renderer3.push("<!--[-1-->");
        }
        $$renderer3.push(`<!--]-->`);
      },
      "svelte-1wazkji"
    );
    $$renderer2.push(`</div></div></header> `);
    {
      $$renderer2.push("<!--[0-->");
      SkeletonLoader($$renderer2, { variant: "matchup", count: 6 });
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
