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
    let selectedResult;
    let seasons = [];
    let seasonsResults = [];
    let selectedSeasonId = null;
    selectedResult = (() => {
      if (!seasonsResults.length) return null;
      let found = seasonsResults.find((r) => r.season != null && String(r.season) === String(selectedSeasonId));
      if (found) return found;
      found = seasonsResults.find((r) => String(r.leagueId) === String(selectedSeasonId));
      return found || seasonsResults[seasonsResults.length - 1];
    })();
    (() => {
      if (!selectedResult) return [];
      const raw = (selectedResult.playoffStandings || []).slice();
      if (!raw.length) return [];
      const champs = raw.filter((r) => r.champion === true).sort((a, b) => (b.pf || 0) - (a.pf || 0));
      const others = raw.filter((r) => r.champion !== true).sort((a, b) => {
        if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
        return (b.pf || 0) - (a.pf || 0);
      });
      return [...champs, ...others];
    })();
    $$renderer2.push(`<div class="page wrap svelte-1v2vony"><header class="page-head rise svelte-1v2vony"><div class="head-row svelte-1v2vony"><div><div class="eyebrow">League · Standings</div> <h1 class="page-title svelte-1v2vony">Standings</h1></div> <div class="season-form svelte-1v2vony"><label for="season-select" class="visually-hidden">Season</label> `);
    $$renderer2.select(
      {
        id: "season-select",
        value: (
          // Resolve selected season from URL
          // Compute standings for ALL seasons (so dropdown can switch without refetching)
          // Update URL but don't reload (data is already client-side)
          selectedSeasonId
        ),
        "data-testid": "standings-season-select",
        class: ""
      },
      ($$renderer3) => {
        $$renderer3.push(`<!--[-->`);
        const each_array = ensure_array_like(seasons);
        for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
          let s = each_array[$$index];
          $$renderer3.option({ value: s.season }, ($$renderer4) => {
            $$renderer4.push(`${escape_html(s.season)}`);
          });
        }
        $$renderer3.push(`<!--]-->`);
      },
      "svelte-1v2vony"
    );
    $$renderer2.push(`</div></div> `);
    if (selectedResult) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p class="page-sub svelte-1v2vony">${escape_html(selectedResult.leagueName ?? `Season ${selectedResult.season ?? selectedResult.leagueId}`)}</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></header> `);
    {
      $$renderer2.push("<!--[0-->");
      SkeletonLoader($$renderer2, { variant: "row", count: 12 });
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
