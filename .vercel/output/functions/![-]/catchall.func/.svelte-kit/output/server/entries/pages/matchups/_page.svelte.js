import { z as ensure_array_like, A as escape_html, l as attr_style, k as attr_class, j as attr, m as bind_props, aa as stringify } from "../../../chunks/renderer.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let data = $$props["data"];
    const seasons = data.seasons || [];
    const weeks = data.weeks || [];
    const weekOptions = data.weekOptions || { regular: [], playoffs: [] };
    let selectedSeason = data.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id : null);
    let selectedWeek = Number(data.selectedWeek ?? (weeks.length ? weeks[0] : 1));
    const matchupsRows = data.matchupsRows || [];
    function avatarOrPh(url, name) {
      if (url) return url;
      const ch = name ? name[0].toUpperCase() : "T";
      return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
    }
    function fmt2(n) {
      return Number(n ?? 0).toFixed(2);
    }
    $$renderer2.push(`<div class="page wrap svelte-1wazkji"><header class="page-head rise svelte-1wazkji"><div class="head-row svelte-1wazkji"><div><div class="eyebrow">League · Week-by-Week</div> <h1 class="page-title svelte-1wazkji">Matchups</h1></div> <form id="filters" method="get" class="filters svelte-1wazkji"><label for="season" class="visually-hidden">Season</label> <select id="season" name="season" data-testid="matchups-season-select" class="svelte-1wazkji"><!--[-->`);
    const each_array = ensure_array_like(seasons);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let s = each_array[$$index];
      $$renderer2.option(
        {
          value: s.season ?? s.league_id,
          selected: String(s.season ?? s.league_id) === String(selectedSeason)
        },
        ($$renderer3) => {
          $$renderer3.push(`${escape_html(s.season ?? s.name)}`);
        }
      );
    }
    $$renderer2.push(`<!--]--></select> <label for="week" class="visually-hidden">Week</label> `);
    if (weekOptions.regular?.length || weekOptions.playoffs?.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<select id="week" name="week" data-testid="matchups-week-select" class="svelte-1wazkji">`);
      if (weekOptions.regular?.length) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<optgroup label="Regular Season"><!--[-->`);
        const each_array_1 = ensure_array_like(weekOptions.regular);
        for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
          let w = each_array_1[$$index_1];
          $$renderer2.option({ value: w, selected: w === Number(selectedWeek) }, ($$renderer3) => {
            $$renderer3.push(`Week ${escape_html(w)}`);
          });
        }
        $$renderer2.push(`<!--]--></optgroup>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->`);
      if (weekOptions.playoffs?.length) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<optgroup label="Playoffs"><!--[-->`);
        const each_array_2 = ensure_array_like(weekOptions.playoffs);
        for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
          let w = each_array_2[$$index_2];
          $$renderer2.option({ value: w, selected: w === Number(selectedWeek) }, ($$renderer3) => {
            $$renderer3.push(`Week ${escape_html(w)}`);
          });
        }
        $$renderer2.push(`<!--]--></optgroup>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></select>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<select id="week" name="week" data-testid="matchups-week-select" class="svelte-1wazkji"><!--[-->`);
      const each_array_3 = ensure_array_like(weeks);
      for (let $$index_3 = 0, $$length = each_array_3.length; $$index_3 < $$length; $$index_3++) {
        let w = each_array_3[$$index_3];
        $$renderer2.option({ value: w, selected: w === Number(selectedWeek) }, ($$renderer3) => {
          $$renderer3.push(`Week ${escape_html(w)}`);
        });
      }
      $$renderer2.push(`<!--]--></select>`);
    }
    $$renderer2.push(`<!--]--> <noscript><button type="submit" class="btn sm">Go</button></noscript></form></div></header> `);
    if (matchupsRows.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="matchups-list svelte-1wazkji" data-testid="matchups-list"><!--[-->`);
      const each_array_4 = ensure_array_like(matchupsRows);
      for (let idx = 0, $$length = each_array_4.length; idx < $$length; idx++) {
        let row = each_array_4[idx];
        if (row.participantsCount === 2) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="match-row rise svelte-1wazkji"${attr_style(`animation-delay: ${stringify(idx * 40)}ms;`)}><div${attr_class("m-team svelte-1wazkji", void 0, { "winner": row.teamA?.points > row.teamB?.points })}><img class="m-avatar svelte-1wazkji"${attr("src", avatarOrPh(row.teamA.avatar, row.teamA.name))}${attr("alt", row.teamA.name)}/> <div class="m-meta svelte-1wazkji"><div class="m-name svelte-1wazkji">${escape_html(row.teamA.name)}</div> `);
          if (row.teamA.ownerName) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<div class="m-owner svelte-1wazkji">${escape_html(row.teamA.ownerName)}</div>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--></div> <div${attr_class("m-score svelte-1wazkji", void 0, {
            "win": row.teamA.points > row.teamB.points,
            "tie": row.teamA.points === row.teamB.points
          })}><span class="num svelte-1wazkji">${escape_html(fmt2(row.teamA.points))}</span></div></div> <div class="m-divider svelte-1wazkji"><span class="vs svelte-1wazkji">VS</span></div> <div${attr_class("m-team right svelte-1wazkji", void 0, { "winner": row.teamB?.points > row.teamA?.points })}><div${attr_class("m-score svelte-1wazkji", void 0, {
            "win": row.teamB.points > row.teamA.points,
            "tie": row.teamA.points === row.teamB.points
          })}><span class="num svelte-1wazkji">${escape_html(fmt2(row.teamB.points))}</span></div> <div class="m-meta right svelte-1wazkji"><div class="m-name svelte-1wazkji">${escape_html(row.teamB.name)}</div> `);
          if (row.teamB.ownerName) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<div class="m-owner svelte-1wazkji">${escape_html(row.teamB.ownerName)}</div>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--></div> <img class="m-avatar svelte-1wazkji"${attr("src", avatarOrPh(row.teamB.avatar, row.teamB.name))}${attr("alt", row.teamB.name)}/></div></div>`);
        } else if (row.participantsCount === 1) {
          $$renderer2.push("<!--[1-->");
          $$renderer2.push(`<div class="match-row bye rise svelte-1wazkji"${attr_style(`animation-delay: ${stringify(idx * 40)}ms;`)}><div class="m-team svelte-1wazkji"><img class="m-avatar svelte-1wazkji"${attr("src", avatarOrPh(row.teamA.avatar, row.teamA.name))}${attr("alt", row.teamA.name)}/> <div class="m-meta svelte-1wazkji"><div class="m-name svelte-1wazkji">${escape_html(row.teamA.name)}</div> `);
          if (row.teamA.ownerName) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<div class="m-owner svelte-1wazkji">${escape_html(row.teamA.ownerName)}</div>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--></div> `);
          if (row.teamA.points != null) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<div class="m-score svelte-1wazkji"><span class="num svelte-1wazkji">${escape_html(fmt2(row.teamA.points))}</span></div>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--></div> <div class="bye-flag svelte-1wazkji">BYE WEEK</div></div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
          $$renderer2.push(`<div class="match-row multi rise svelte-1wazkji"><div class="multi-head svelte-1wazkji"><span class="multi-label svelte-1wazkji">Multi-team (${escape_html(row.participantsCount)})</span> <span class="multi-sub svelte-1wazkji">Week ${escape_html(row.week ?? "-")}</span></div> <div class="multi-list svelte-1wazkji"><!--[-->`);
          const each_array_5 = ensure_array_like(row.combinedParticipants);
          for (let $$index_4 = 0, $$length2 = each_array_5.length; $$index_4 < $$length2; $$index_4++) {
            let p = each_array_5[$$index_4];
            $$renderer2.push(`<div class="multi-row svelte-1wazkji"><img class="m-avatar small svelte-1wazkji"${attr("src", avatarOrPh(p.avatar, p.name))}${attr("alt", p.name)}/> <div class="m-name svelte-1wazkji">${escape_html(p.name)}</div> <div class="m-score svelte-1wazkji"><span class="num svelte-1wazkji">${escape_html(fmt2(p.points))}</span></div></div>`);
          }
          $$renderer2.push(`<!--]--></div></div>`);
        }
        $$renderer2.push(`<!--]-->`);
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-1wazkji" data-testid="matchups-empty">No matchups for the selected season/week.</div>`);
    }
    $$renderer2.push(`<!--]--></div>`);
    bind_props($$props, { data });
  });
}
export {
  _page as default
};
