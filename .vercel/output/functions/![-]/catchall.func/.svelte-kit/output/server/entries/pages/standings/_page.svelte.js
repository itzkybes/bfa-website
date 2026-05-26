import { z as ensure_array_like, A as escape_html, j as attr, k as attr_class, m as bind_props } from "../../../chunks/renderer.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let selectedResult, playoffDisplay;
    let data = $$props["data"];
    function avatarOrPh(url, name) {
      if (url) return url;
      const ch = name ? name[0].toUpperCase() : "T";
      return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
    }
    const seasons = (data?.seasons || []).filter((s) => s.season != null);
    const seasonsResults = data?.seasonsResults || [];
    const numericSeasons = seasons;
    const latestDefault = numericSeasons.length ? String(numericSeasons[numericSeasons.length - 1].season) : data?.seasons?.length ? String(data.seasons[data.seasons.length - 1].league_id) : "";
    let selectedSeasonId = (() => {
      const ds = data?.selectedSeason ? String(data.selectedSeason) : null;
      if (ds && (data?.seasons || []).some((s) => String(s.season) === ds || String(s.league_id) === ds)) return ds;
      return latestDefault;
    })();
    selectedResult = (() => {
      if (!seasonsResults.length) return null;
      let found = seasonsResults.find((r) => r.season != null && String(r.season) === String(selectedSeasonId));
      if (found) return found;
      found = seasonsResults.find((r) => String(r.leagueId) === String(selectedSeasonId));
      return found || seasonsResults[seasonsResults.length - 1];
    })();
    playoffDisplay = (() => {
      if (!selectedResult) return [];
      const raw = selectedResult.playoffStandings && selectedResult.playoffStandings.length ? selectedResult.playoffStandings.slice() : (selectedResult.standings || []).slice();
      if (!raw.length) return [];
      const champs = raw.filter((r) => r.champion === true).sort((a, b) => (b.pf || 0) - (a.pf || 0));
      const others = raw.filter((r) => r.champion !== true).sort((a, b) => {
        if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
        return (b.pf || 0) - (a.pf || 0);
      });
      return [...champs, ...others];
    })();
    $$renderer2.push(`<div class="page wrap svelte-1v2vony"><header class="page-head rise svelte-1v2vony"><div class="head-row svelte-1v2vony"><div><div class="eyebrow">League · Standings</div> <h1 class="page-title svelte-1v2vony">Standings</h1></div> <form method="get" class="season-form svelte-1v2vony"><label for="season-select" class="visually-hidden">Season</label> `);
    $$renderer2.select(
      {
        id: "season-select",
        name: "season",
        value: selectedSeasonId,
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
    $$renderer2.push(`</form></div> `);
    if (selectedResult) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p class="page-sub svelte-1v2vony">${escape_html(selectedResult.leagueName ?? `Season ${selectedResult.season ?? selectedResult.leagueId}`)}</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></header> <section class="standings-block svelte-1v2vony" aria-labelledby="reg-h"><div class="block-head svelte-1v2vony"><h2 id="reg-h" class="block-title svelte-1v2vony">Regular Season</h2> <span class="block-sub svelte-1v2vony">Sorted by W → PF</span></div> `);
    if (selectedResult?.regularStandings?.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="table-wrap svelte-1v2vony" data-testid="regular-standings-table"><table class="bfa-table svelte-1v2vony"><thead><tr><th style="width:60px;">#</th><th>Team</th><th class="col-num">W</th><th class="col-num">L</th><th class="col-num">Win Str</th><th class="col-num">Lose Str</th><th class="col-num">PF</th><th class="col-num">PA</th></tr></thead><tbody><!--[-->`);
      const each_array_1 = ensure_array_like(selectedResult.regularStandings);
      for (let idx = 0, $$length = each_array_1.length; idx < $$length; idx++) {
        let row = each_array_1[idx];
        $$renderer2.push(`<tr><td class="rank-cell svelte-1v2vony"><span class="num rank-num svelte-1v2vony">${escape_html(idx + 1)}</span></td><td><div class="team-cell svelte-1v2vony"><img class="team-avatar small svelte-1v2vony"${attr("src", avatarOrPh(row.avatar, row.team_name))}${attr("alt", row.team_name)}/> <div><div class="team-name-cell svelte-1v2vony">${escape_html(row.team_name)}</div> `);
        if (row.owner_name) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="team-owner-cell svelte-1v2vony">${escape_html(row.owner_name)}</div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div></div></td><td class="col-num"><span class="num">${escape_html(row.wins)}</span></td><td class="col-num"><span class="num">${escape_html(row.losses)}</span></td><td class="col-num"><span class="num">${escape_html(row.maxWinStreak ?? 0)}</span></td><td class="col-num"><span class="num">${escape_html(row.maxLoseStreak ?? 0)}</span></td><td class="col-num pf svelte-1v2vony"><span class="num svelte-1v2vony">${escape_html(row.pf)}</span></td><td class="col-num"><span class="num muted svelte-1v2vony">${escape_html(row.pa)}</span></td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-1v2vony">No regular season results.</div>`);
    }
    $$renderer2.push(`<!--]--></section> <section class="standings-block svelte-1v2vony" aria-labelledby="po-h"><div class="block-head svelte-1v2vony"><h2 id="po-h" class="block-title svelte-1v2vony">Playoffs</h2> <span class="block-sub svelte-1v2vony">Champion pinned 🏆</span></div> `);
    if (playoffDisplay && playoffDisplay.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="table-wrap svelte-1v2vony" data-testid="playoff-standings-table"><table class="bfa-table svelte-1v2vony"><thead><tr><th>Team</th><th class="col-num">W</th><th class="col-num">L</th><th class="col-num">PF</th><th class="col-num">PA</th></tr></thead><tbody><!--[-->`);
      const each_array_2 = ensure_array_like(playoffDisplay);
      for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
        let row = each_array_2[$$index_2];
        $$renderer2.push(`<tr${attr_class("", void 0, { "champion-row": row.champion === true })}><td><div class="team-cell svelte-1v2vony"><img class="team-avatar small svelte-1v2vony"${attr("src", avatarOrPh(row.avatar, row.team_name))}${attr("alt", row.team_name)}/> <div><div class="team-name-cell svelte-1v2vony">${escape_html(row.team_name)} `);
        if (row.champion === true) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<span class="trophy svelte-1v2vony" title="Champion">🏆</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div> `);
        if (row.owner_name) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="team-owner-cell svelte-1v2vony">${escape_html(row.owner_name)}</div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div></div></td><td class="col-num"><span class="num">${escape_html(row.wins)}</span></td><td class="col-num"><span class="num">${escape_html(row.losses)}</span></td><td class="col-num pf svelte-1v2vony"><span class="num svelte-1v2vony">${escape_html(row.pf)}</span></td><td class="col-num"><span class="num muted svelte-1v2vony">${escape_html(row.pa)}</span></td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-1v2vony">No playoff results.</div>`);
    }
    $$renderer2.push(`<!--]--></section></div>`);
    bind_props($$props, { data });
  });
}
export {
  _page as default
};
