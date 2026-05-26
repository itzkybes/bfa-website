import { z as ensure_array_like, A as escape_html, j as attr, m as bind_props } from "../../../chunks/renderer.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let selectedRow, om, fm;
    let data = $$props["data"];
    const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
    let selectedSeason = data?.selectedSeason ?? (seasons.length ? seasons[seasons.length - 1].season ?? seasons[seasons.length - 1].league_id : null);
    const seasonsResults = Array.isArray(data?.seasonsResults) ? data.seasonsResults : [];
    const allTimePlayoff = Array.isArray(data?.allTimePlayoffBestPerRoster) ? data.allTimePlayoffBestPerRoster : [];
    const allTimeFull = Array.isArray(data?.allTimeFullSeasonBestPerRoster) ? data.allTimeFullSeasonBestPerRoster : [];
    function headshot(pid) {
      return pid ? `https://sleepercdn.com/content/nba/players/${pid}.jpg` : "";
    }
    function avatarOrPh(url, name) {
      if (url) return url;
      const ch = name ? name[0].toUpperCase() : "P";
      return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
    }
    function fmt(v) {
      const n = Number(v);
      if (!isFinite(n)) return "—";
      return (Math.round(n * 100) / 100).toFixed(2);
    }
    const rosterNameMap = {};
    (function() {
      for (const sr of seasonsResults) {
        if (!Array.isArray(sr?.teamLeaders)) continue;
        for (const t of sr.teamLeaders) {
          const rid = String(t.rosterId);
          const meta = t._roster_meta || {};
          if (!rosterNameMap[rid]) {
            rosterNameMap[rid] = {
              teamName: meta.team_name || meta.owner_name || t.owner_name || null,
              ownerName: t.owner_name || meta.owner_name || null,
              teamAvatar: t.teamAvatar || meta.team_avatar || null
            };
          }
        }
      }
    })();
    function rosterInfo(row) {
      if (!row) return { teamName: null, ownerName: null, teamAvatar: null };
      const rid = String(row.rosterId ?? row.topRosterId ?? "");
      const rm = row.roster_meta || row._roster_meta || {};
      const map = rid ? rosterNameMap[rid] || {} : {};
      return {
        teamName: row.teamName || row.team_name || rm.team_name || map.teamName || row.owner_name || `Roster ${rid}`,
        ownerName: row.owner_name || rm.owner_name || map.ownerName || (rid ? `Roster ${rid}` : null),
        teamAvatar: row.teamAvatar || row.team_avatar || rm.team_avatar || rm.owner_avatar || map.teamAvatar || null
      };
    }
    selectedRow = seasonsResults.find((r) => String(r.season) === String(selectedSeason)) ?? null;
    om = selectedRow?.overallMvp ?? null;
    fm = selectedRow?.finalsMvp ?? null;
    $$renderer2.push(`<div class="page wrap svelte-135c079"><header class="page-head rise svelte-135c079"><div class="head-row svelte-135c079"><div><div class="eyebrow">All-Time · Player Records</div> <h1 class="page-title svelte-135c079">Player Records</h1></div> <form id="filters" method="get" data-sveltekit-reload=""><label for="season-select" class="visually-hidden">Season</label> <select id="season-select" name="season" data-testid="player-season-select"><!--[-->`);
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
    $$renderer2.push(`<!--]--></select></form></div></header> <section class="block svelte-135c079"><div class="block-head svelte-135c079"><h2 class="block-title svelte-135c079">Season MVPs · ${escape_html(selectedSeason)}</h2> <span class="block-sub svelte-135c079">Overall &amp; Finals</span></div> <div class="mvp-grid svelte-135c079"><div class="mvp-card svelte-135c079" data-testid="mvp-overall"><div class="mvp-label svelte-135c079">Overall MVP</div> `);
    if (om) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="mvp-body svelte-135c079"><img class="mvp-headshot svelte-135c079"${attr("src", headshot(om.playerId) || avatarOrPh(rosterInfo(om).teamAvatar, om.playerName))}${attr("alt", om.playerName)}/> <div><div class="mvp-player-name svelte-135c079">${escape_html(om.playerName)}</div> <div class="mvp-pts num svelte-135c079">${escape_html(fmt(om.points))}<span class="pts-label svelte-135c079">PTS</span></div> <div class="mvp-team svelte-135c079"><img class="team-mini svelte-135c079"${attr("src", avatarOrPh(rosterInfo(om).teamAvatar, rosterInfo(om).teamName))}${attr("alt", rosterInfo(om).teamName)}/> <div><div class="t-name svelte-135c079">${escape_html(rosterInfo(om).teamName)}</div> <div class="t-owner svelte-135c079">${escape_html(rosterInfo(om).ownerName)}</div></div></div></div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="mvp-empty svelte-135c079">No Overall MVP data.</div>`);
    }
    $$renderer2.push(`<!--]--></div> <div class="mvp-card finals svelte-135c079" data-testid="mvp-finals"><div class="mvp-label finals svelte-135c079">Finals MVP</div> `);
    if (fm) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="mvp-body svelte-135c079"><img class="mvp-headshot svelte-135c079"${attr("src", headshot(fm.playerId) || avatarOrPh(rosterInfo(fm).teamAvatar, fm.playerName))}${attr("alt", fm.playerName)}/> <div><div class="mvp-player-name svelte-135c079">${escape_html(fm.playerName)}</div> <div class="mvp-pts num svelte-135c079">${escape_html(fmt(fm.points))}<span class="pts-label svelte-135c079">PTS</span></div> <div class="mvp-team svelte-135c079"><img class="team-mini svelte-135c079"${attr("src", avatarOrPh(rosterInfo(fm).teamAvatar, rosterInfo(fm).teamName))}${attr("alt", rosterInfo(fm).teamName)}/> <div><div class="t-name svelte-135c079">${escape_html(rosterInfo(fm).teamName)}</div> <div class="t-owner svelte-135c079">${escape_html(rosterInfo(fm).ownerName)}</div></div></div></div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="mvp-empty svelte-135c079">No Finals MVP data.</div>`);
    }
    $$renderer2.push(`<!--]--></div></div></section> <section class="block svelte-135c079"><div class="block-head svelte-135c079"><h2 class="block-title svelte-135c079">All-Time Single-Season Playoff Best</h2> <span class="block-sub svelte-135c079">Per team · 2022 → present</span></div> `);
    if (allTimePlayoff.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="table-wrap svelte-135c079"><table class="bfa-table svelte-135c079"><thead><tr><th>Team</th><th>Player</th><th>Season</th><th class="col-num">PTS</th></tr></thead><tbody><!--[-->`);
      const each_array_1 = ensure_array_like(allTimePlayoff);
      for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
        let row = each_array_1[$$index_1];
        const info = rosterInfo(row);
        $$renderer2.push(`<tr><td><div class="team-cell svelte-135c079"><img class="team-avatar small svelte-135c079"${attr("src", avatarOrPh(info.teamAvatar, info.teamName))}${attr("alt", info.teamName)}/> <div><div class="team-name-cell svelte-135c079">${escape_html(row.teamName ?? info.teamName)}</div> <div class="team-owner-cell svelte-135c079">${escape_html(row.owner_name ?? info.ownerName)}</div></div></div></td><td><div class="player-cell svelte-135c079"><img class="headshot"${attr("src", headshot(row.playerId))}${attr("alt", row.playerName)}/> <div class="player-name-cell svelte-135c079">${escape_html(row.playerName ?? `Player ${row.playerId}`)}</div></div></td><td><span class="num accent-text svelte-135c079">${escape_html(row.season)}</span></td><td class="col-num"><span class="num bigpts svelte-135c079">${escape_html(fmt(row.points))}</span></td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-135c079">No playoff data.</div>`);
    }
    $$renderer2.push(`<!--]--></section> <section class="block svelte-135c079"><div class="block-head svelte-135c079"><h2 class="block-title svelte-135c079">All-Time Single-Season Full-Season Best</h2> <span class="block-sub svelte-135c079">Per team · regular + playoffs · 2022 → present</span></div> `);
    if (allTimeFull.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="table-wrap svelte-135c079"><table class="bfa-table svelte-135c079"><thead><tr><th>Team</th><th>Player</th><th>Season</th><th class="col-num">PTS</th></tr></thead><tbody><!--[-->`);
      const each_array_2 = ensure_array_like(allTimeFull);
      for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
        let row = each_array_2[$$index_2];
        const info = rosterInfo(row);
        $$renderer2.push(`<tr><td><div class="team-cell svelte-135c079"><img class="team-avatar small svelte-135c079"${attr("src", avatarOrPh(info.teamAvatar, info.teamName))}${attr("alt", info.teamName)}/> <div><div class="team-name-cell svelte-135c079">${escape_html(row.teamName ?? info.teamName)}</div> <div class="team-owner-cell svelte-135c079">${escape_html(row.owner_name ?? info.ownerName)}</div></div></div></td><td><div class="player-cell svelte-135c079"><img class="headshot"${attr("src", headshot(row.playerId))}${attr("alt", row.playerName)}/> <div class="player-name-cell svelte-135c079">${escape_html(row.playerName ?? `Player ${row.playerId}`)}</div></div></td><td><span class="num accent-text svelte-135c079">${escape_html(row.season)}</span></td><td class="col-num"><span class="num bigpts svelte-135c079">${escape_html(fmt(row.points))}</span></td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-135c079">No full-season data.</div>`);
    }
    $$renderer2.push(`<!--]--></section></div>`);
    bind_props($$props, { data });
  });
}
export {
  _page as default
};
