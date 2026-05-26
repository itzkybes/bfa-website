import { A as escape_html, z as ensure_array_like, j as attr, k as attr_class, m as bind_props } from "../../../chunks/renderer.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let selectedKey, selectedResult, finalStandings, champion, biggestLoser;
    let data = $$props["data"];
    const seasons = data?.seasons ?? [];
    let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id : null);
    const finalStandingsBySeason = data?.finalStandingsBySeason ?? {};
    const finalStandingsFallback = Array.isArray(data?.finalStandings) ? data.finalStandings : [];
    const finalsMvp = data?.finalsMvp ?? null;
    const overallMvp = data?.overallMvp ?? null;
    function headshot(pid) {
      return pid ? `https://sleepercdn.com/content/nba/players/${pid}.jpg` : "";
    }
    function avatarOrPh(url, name) {
      if (url) return url;
      const ch = name ? name[0].toUpperCase() : "T";
      return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
    }
    function fmt(v) {
      const n = Number(v);
      if (!isFinite(n)) return "—";
      return (Math.round(n * 10) / 10).toFixed(1);
    }
    function placeEmoji(rank) {
      if (rank === 1) return "🏆";
      if (rank === 2) return "🥈";
      if (rank === 3) return "🥉";
      return "";
    }
    selectedKey = String(selectedSeason);
    selectedResult = finalStandingsBySeason[selectedKey] ?? { finalStandings: finalStandingsFallback };
    finalStandings = Array.isArray(selectedResult.finalStandings) ? selectedResult.finalStandings : [];
    champion = finalStandings.length ? finalStandings[0] : null;
    biggestLoser = finalStandings.length ? finalStandings[finalStandings.length - 1] : null;
    $$renderer2.push(`<div class="page wrap svelte-6p8nw1"><header class="page-head rise svelte-6p8nw1"><div class="head-row svelte-6p8nw1"><div><div class="eyebrow">Honors · Season ${escape_html(selectedSeason)}</div> <h1 class="page-title svelte-6p8nw1">Honor Hall</h1> <p class="page-sub svelte-6p8nw1">Final placements derived from bracket simulation across the playoff window.</p></div> <form id="filters" method="get"><label for="season-select" class="visually-hidden">Season</label> <select id="season-select" name="season" data-testid="honor-season-select"><!--[-->`);
    const each_array = ensure_array_like(seasons);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let s = each_array[$$index];
      $$renderer2.option(
        {
          value: s.season ?? s.league_id,
          selected: String(s.season ?? s.league_id) === String(selectedSeason)
        },
        ($$renderer3) => {
          $$renderer3.push(`${escape_html(s.season ?? s.name ?? s.league_id)}`);
        }
      );
    }
    $$renderer2.push(`<!--]--></select></form></div></header> <section class="bento svelte-6p8nw1">`);
    if (champion) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="bento-card champion-card svelte-6p8nw1" data-testid="champion-card"><div class="card-corner svelte-6p8nw1"><span class="rank-tag num svelte-6p8nw1">#1</span></div> <div class="champion-trophy svelte-6p8nw1">🏆</div> <div class="card-eyebrow svelte-6p8nw1">Champion</div> <img class="champion-avatar svelte-6p8nw1"${attr("src", avatarOrPh(champion.avatar, champion.team_name))}${attr("alt", champion.team_name)}/> <div class="champion-name svelte-6p8nw1">${escape_html(champion.team_name)}</div> <div class="champion-owner svelte-6p8nw1">`);
      if (champion.owner_name) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`${escape_html(champion.owner_name)} ·`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->Seed #${escape_html(champion.seed ?? "—")}</div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (biggestLoser && biggestLoser !== champion) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="bento-card loser-card svelte-6p8nw1" data-testid="biggest-loser-card"><div class="card-corner svelte-6p8nw1"><span class="rank-tag num svelte-6p8nw1">#${escape_html(biggestLoser.rank ?? finalStandings.length)}</span></div> <div class="loser-icon svelte-6p8nw1">😵‍💫</div> <div class="card-eyebrow svelte-6p8nw1">Biggest Loser</div> <img class="champion-avatar svelte-6p8nw1"${attr("src", avatarOrPh(biggestLoser.avatar, biggestLoser.team_name))}${attr("alt", biggestLoser.team_name)}/> <div class="champion-name dim svelte-6p8nw1">${escape_html(biggestLoser.team_name)}</div> <div class="champion-owner svelte-6p8nw1">`);
      if (biggestLoser.owner_name) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`${escape_html(biggestLoser.owner_name)} ·`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->Seed #${escape_html(biggestLoser.seed ?? "—")}</div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (finalsMvp) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="bento-card mvp-card svelte-6p8nw1" data-testid="finals-mvp-card"><div class="card-eyebrow accent svelte-6p8nw1">Finals MVP</div> <img class="mvp-headshot svelte-6p8nw1"${attr("src", headshot(finalsMvp.playerId) || avatarOrPh(finalsMvp.roster_meta?.team_avatar, finalsMvp.playerName))}${attr("alt", finalsMvp.playerName)}/> <div class="mvp-name svelte-6p8nw1">${escape_html(finalsMvp.playerName ?? "—")}</div> <div class="mvp-pts num svelte-6p8nw1">${escape_html(fmt(finalsMvp.points))}<span class="pts-suffix svelte-6p8nw1">PTS</span></div> <div class="mvp-sub svelte-6p8nw1">${escape_html(finalsMvp.roster_meta?.owner_name ?? `Roster ${finalsMvp.rosterId ?? "—"}`)}</div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (overallMvp) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="bento-card mvp-card svelte-6p8nw1" data-testid="overall-mvp-card"><div class="card-eyebrow accent svelte-6p8nw1">Overall MVP</div> <img class="mvp-headshot svelte-6p8nw1"${attr("src", headshot(overallMvp.playerId) || avatarOrPh(overallMvp.roster_meta?.team_avatar, overallMvp.playerName))}${attr("alt", overallMvp.playerName)}/> <div class="mvp-name svelte-6p8nw1">${escape_html(overallMvp.playerName ?? "—")}</div> <div class="mvp-pts num svelte-6p8nw1">${escape_html(fmt(overallMvp.points))}<span class="pts-suffix svelte-6p8nw1">PTS</span></div> <div class="mvp-sub svelte-6p8nw1">${escape_html(overallMvp.roster_meta?.owner_name ?? `Roster ${overallMvp.rosterId ?? overallMvp.topRosterId ?? "—"}`)}</div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></section> <section class="block svelte-6p8nw1"><div class="block-head svelte-6p8nw1"><h2 class="block-title svelte-6p8nw1">Final Standings</h2> <span class="block-sub svelte-6p8nw1">Computed from bracket simulation</span></div> `);
    if (finalStandings.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<ol class="standings-list svelte-6p8nw1" data-testid="honor-standings-list"><!--[-->`);
      const each_array_1 = ensure_array_like(finalStandings);
      for (let idx = 0, $$length = each_array_1.length; idx < $$length; idx++) {
        let row = each_array_1[idx];
        $$renderer2.push(`<li${attr_class("standings-row svelte-6p8nw1", void 0, { "gold": row.rank === 1 })}><div class="rank-col num svelte-6p8nw1">${escape_html(row.rank)} `);
        if (placeEmoji(row.rank)) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<span class="medal svelte-6p8nw1">${escape_html(placeEmoji(row.rank))}</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div> <img class="team-avatar small svelte-6p8nw1"${attr("src", avatarOrPh(row.avatar, row.team_name))}${attr("alt", row.team_name)}/> <div class="team-meta svelte-6p8nw1"><div class="team-name svelte-6p8nw1">${escape_html(row.team_name)}</div> <div class="team-owner svelte-6p8nw1">${escape_html(row.owner_name ?? `Roster ${row.rosterId}`)}</div></div> <div class="seed-col svelte-6p8nw1"><span class="num svelte-6p8nw1">#${escape_html(row.seed ?? "—")}</span> <span class="seed-label svelte-6p8nw1">Seed</span></div></li>`);
      }
      $$renderer2.push(`<!--]--></ol>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-6p8nw1">No standings available.</div>`);
    }
    $$renderer2.push(`<!--]--></section></div>`);
    bind_props($$props, { data });
  });
}
export {
  _page as default
};
