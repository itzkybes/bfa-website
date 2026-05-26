import { z as ensure_array_like, A as escape_html, j as attr, k as attr_class, m as bind_props } from "../../../chunks/renderer.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let aggregatedRegular, aggregatedPlayoff, ownershipNotes, h2hOwners, h2hRecords, marginsLargest, marginsSmallest;
    let data = $$props["data"];
    function avatarOrPh(url, name) {
      if (url) return url;
      const ch = name ? name[0].toUpperCase() : "T";
      return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
    }
    let selectedH2H = null;
    function lastLabel(season, week) {
      if (!season) return "—";
      return `${season} · W${week || ""}`;
    }
    aggregatedRegular = data?.aggregatedRegular ?? [];
    aggregatedPlayoff = data?.aggregatedPlayoff ?? [];
    ownershipNotes = data?.ownershipNotes ?? [];
    h2hOwners = data?.h2hOwners ?? [];
    h2hRecords = data?.h2hRecords ?? {};
    marginsLargest = data?.marginsLargest ?? [];
    marginsSmallest = data?.marginsSmallest ?? [];
    if ((!selectedH2H || selectedH2H === "") && h2hOwners.length) selectedH2H = h2hOwners[0].key;
    $$renderer2.push(`<div class="page wrap svelte-16nribx"><header class="page-head rise svelte-16nribx"><div class="eyebrow">All-Time · Team Records</div> <h1 class="page-title svelte-16nribx">Team Records</h1> <p class="page-sub svelte-16nribx">Aggregated stats across every available season — head-to-head matchups, biggest blowouts and nailbiters.</p></header> `);
    if (ownershipNotes.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="note rise svelte-16nribx"><!--[-->`);
      const each_array = ensure_array_like(ownershipNotes);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let on = each_array[$$index];
        $$renderer2.push(`<div>${escape_html(on)}</div>`);
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <section class="block svelte-16nribx"><div class="block-head svelte-16nribx"><h2 class="block-title svelte-16nribx">Regular Season — Aggregated</h2> <span class="block-sub svelte-16nribx">Sorted by Wins → PF</span></div> `);
    if (aggregatedRegular.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="table-wrap svelte-16nribx"><table class="bfa-table svelte-16nribx"><thead><tr><th>Team</th><th class="col-num">W</th><th class="col-num">L</th><th class="col-num">Win Str</th><th class="col-num">Lose Str</th><th class="col-num">PF</th><th class="col-num">PA</th></tr></thead><tbody><!--[-->`);
      const each_array_1 = ensure_array_like(aggregatedRegular);
      for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
        let row = each_array_1[$$index_1];
        $$renderer2.push(`<tr><td><div class="team-cell svelte-16nribx"><img class="team-avatar small svelte-16nribx"${attr("src", avatarOrPh(row.avatar, row.team_name))}${attr("alt", row.team_name)}/> <div><div class="team-name-cell svelte-16nribx">${escape_html(row.team_name)}</div> `);
        if (row.owner_name) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="team-owner-cell svelte-16nribx">${escape_html(row.owner_name)}</div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div></div></td><td class="col-num"><span class="num">${escape_html(row.wins)}</span></td><td class="col-num"><span class="num">${escape_html(row.losses)}</span></td><td class="col-num"><span class="num">${escape_html(row.maxWinStreak ?? 0)}</span></td><td class="col-num"><span class="num">${escape_html(row.maxLoseStreak ?? 0)}</span></td><td class="col-num pf svelte-16nribx"><span class="num svelte-16nribx">${escape_html(row.pf)}</span></td><td class="col-num"><span class="num muted svelte-16nribx">${escape_html(row.pa)}</span></td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-16nribx">No regular season results to show.</div>`);
    }
    $$renderer2.push(`<!--]--></section> <section class="block svelte-16nribx"><div class="block-head svelte-16nribx"><h2 class="block-title svelte-16nribx">Playoffs — Aggregated</h2> <span class="block-sub svelte-16nribx">Champion seasons pinned 🏆</span></div> `);
    if (aggregatedPlayoff.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="table-wrap svelte-16nribx"><table class="bfa-table svelte-16nribx"><thead><tr><th>Team</th><th class="col-num">W</th><th class="col-num">L</th><th class="col-num">PF</th><th class="col-num">PA</th></tr></thead><tbody><!--[-->`);
      const each_array_2 = ensure_array_like(aggregatedPlayoff);
      for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
        let row = each_array_2[$$index_2];
        $$renderer2.push(`<tr${attr_class("", void 0, { "champion-row": row.champion === true })}><td><div class="team-cell svelte-16nribx"><img class="team-avatar small svelte-16nribx"${attr("src", avatarOrPh(row.avatar, row.team_name))}${attr("alt", row.team_name)}/> <div><div class="team-name-cell svelte-16nribx">${escape_html(row.team_name)} `);
        if (row.champion === true) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<span class="trophy svelte-16nribx">🏆</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div> `);
        if (row.owner_name) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="team-owner-cell svelte-16nribx">${escape_html(row.owner_name)}</div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div></div></td><td class="col-num"><span class="num">${escape_html(row.wins)}</span></td><td class="col-num"><span class="num">${escape_html(row.losses)}</span></td><td class="col-num pf svelte-16nribx"><span class="num svelte-16nribx">${escape_html(row.pf)}</span></td><td class="col-num"><span class="num muted svelte-16nribx">${escape_html(row.pa)}</span></td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-16nribx">No playoff results.</div>`);
    }
    $$renderer2.push(`<!--]--></section> <section class="block svelte-16nribx"><div class="block-head svelte-16nribx"><h2 class="block-title svelte-16nribx">Head-to-Head</h2> <div class="h2h-select svelte-16nribx"><label for="h2h-select" class="visually-hidden">Team</label> `);
    $$renderer2.select(
      {
        id: "h2h-select",
        value: selectedH2H,
        "data-testid": "h2h-team-select",
        class: ""
      },
      ($$renderer3) => {
        $$renderer3.push(`<!--[-->`);
        const each_array_3 = ensure_array_like(h2hOwners);
        for (let $$index_3 = 0, $$length = each_array_3.length; $$index_3 < $$length; $$index_3++) {
          let o = each_array_3[$$index_3];
          $$renderer3.option({ value: o.key }, ($$renderer4) => {
            $$renderer4.push(`${escape_html(o.team ? o.team : o.display)}`);
          });
        }
        $$renderer3.push(`<!--]-->`);
      },
      "svelte-16nribx"
    );
    $$renderer2.push(`</div></div> `);
    if (selectedH2H && h2hRecords[selectedH2H]?.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="table-wrap svelte-16nribx"><table class="bfa-table svelte-16nribx"><thead><tr><th>Opponent</th><th class="col-num">W</th><th class="col-num">L</th><th class="col-num">Games</th><th class="col-num">PF</th><th class="col-num">PA</th><th class="col-num">Last</th></tr></thead><tbody><!--[-->`);
      const each_array_4 = ensure_array_like(h2hRecords[selectedH2H]);
      for (let $$index_4 = 0, $$length = each_array_4.length; $$index_4 < $$length; $$index_4++) {
        let r = each_array_4[$$index_4];
        $$renderer2.push(`<tr><td><div class="team-cell svelte-16nribx"><img class="team-avatar small svelte-16nribx"${attr("src", avatarOrPh(r.opponentAvatar, r.opponentTeam || r.opponentDisplay))}${attr("alt", r.opponentTeam || r.opponentDisplay)}/> <div><div class="team-name-cell svelte-16nribx">${escape_html(r.opponentTeam || r.opponentDisplay)}</div> `);
        if (r.opponentDisplay && r.opponentTeam) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="team-owner-cell svelte-16nribx">${escape_html(r.opponentDisplay)}</div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div></div></td><td class="col-num"><span class="num win-color svelte-16nribx">${escape_html(r.wins)}</span></td><td class="col-num"><span class="num loss-color svelte-16nribx">${escape_html(r.losses)}</span></td><td class="col-num"><span class="num muted svelte-16nribx">${escape_html(r.games)}</span></td><td class="col-num"><span class="num">${escape_html(r.pf)}</span></td><td class="col-num"><span class="num muted svelte-16nribx">${escape_html(r.pa)}</span></td><td class="col-num"><span class="num muted svelte-16nribx">${escape_html(lastLabel(r.lastSeason, r.lastWeek))}</span></td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-16nribx">No head-to-head data for selected team.</div>`);
    }
    $$renderer2.push(`<!--]--></section> <div class="margins-grid svelte-16nribx"><section class="block svelte-16nribx"><div class="block-head svelte-16nribx"><h2 class="block-title svelte-16nribx">Largest Margins</h2> <span class="block-sub svelte-16nribx">Top 10 blowouts</span></div> `);
    if (marginsLargest.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="margin-list svelte-16nribx"><!--[-->`);
      const each_array_5 = ensure_array_like(marginsLargest);
      for (let $$index_5 = 0, $$length = each_array_5.length; $$index_5 < $$length; $$index_5++) {
        let row = each_array_5[$$index_5];
        $$renderer2.push(`<div class="margin-row svelte-16nribx"><div class="margin-rank num svelte-16nribx">#${escape_html(row.rank)}</div> <div class="margin-teams svelte-16nribx"><div class="m-side svelte-16nribx"><img class="team-avatar small svelte-16nribx"${attr("src", avatarOrPh(row.avatarA, row.teamAName))}${attr("alt", row.teamAName)}/> <div class="m-mini svelte-16nribx"><div class="m-mini-name svelte-16nribx">${escape_html(row.teamAName)}</div> <div class="m-mini-score num svelte-16nribx">${escape_html(row.scoreA)}</div></div></div> <div class="margin-value num svelte-16nribx">+${escape_html(row.margin)}</div> <div class="m-side right svelte-16nribx"><div class="m-mini svelte-16nribx"><div class="m-mini-name svelte-16nribx">${escape_html(row.teamBName)}</div> <div class="m-mini-score num svelte-16nribx">${escape_html(row.scoreB)}</div></div> <img class="team-avatar small svelte-16nribx"${attr("src", avatarOrPh(row.avatarB, row.teamBName))}${attr("alt", row.teamBName)}/></div></div> <div class="margin-meta svelte-16nribx">S${escape_html(row.season)} · W${escape_html(row.week)}</div></div>`);
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-16nribx">No margin data.</div>`);
    }
    $$renderer2.push(`<!--]--></section> <section class="block svelte-16nribx"><div class="block-head svelte-16nribx"><h2 class="block-title svelte-16nribx">Smallest Margins</h2> <span class="block-sub svelte-16nribx">Top 10 nailbiters</span></div> `);
    if (marginsSmallest.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="margin-list svelte-16nribx"><!--[-->`);
      const each_array_6 = ensure_array_like(marginsSmallest);
      for (let $$index_6 = 0, $$length = each_array_6.length; $$index_6 < $$length; $$index_6++) {
        let row = each_array_6[$$index_6];
        $$renderer2.push(`<div class="margin-row svelte-16nribx"><div class="margin-rank num svelte-16nribx">#${escape_html(row.rank)}</div> <div class="margin-teams svelte-16nribx"><div class="m-side svelte-16nribx"><img class="team-avatar small svelte-16nribx"${attr("src", avatarOrPh(row.avatarA, row.teamAName))}${attr("alt", row.teamAName)}/> <div class="m-mini svelte-16nribx"><div class="m-mini-name svelte-16nribx">${escape_html(row.teamAName)}</div> <div class="m-mini-score num svelte-16nribx">${escape_html(row.scoreA)}</div></div></div> <div class="margin-value tight num svelte-16nribx">${escape_html(row.margin)}</div> <div class="m-side right svelte-16nribx"><div class="m-mini svelte-16nribx"><div class="m-mini-name svelte-16nribx">${escape_html(row.teamBName)}</div> <div class="m-mini-score num svelte-16nribx">${escape_html(row.scoreB)}</div></div> <img class="team-avatar small svelte-16nribx"${attr("src", avatarOrPh(row.avatarB, row.teamBName))}${attr("alt", row.teamBName)}/></div></div> <div class="margin-meta svelte-16nribx">S${escape_html(row.season)} · W${escape_html(row.week)}</div></div>`);
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-16nribx">No margin data.</div>`);
    }
    $$renderer2.push(`<!--]--></section></div></div>`);
    bind_props($$props, { data });
  });
}
export {
  _page as default
};
