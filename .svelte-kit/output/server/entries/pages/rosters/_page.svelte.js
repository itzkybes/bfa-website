import { z as ensure_array_like, A as escape_html, k as attr_class, l as attr_style, j as attr, aa as stringify, m as bind_props } from "../../../chunks/renderer.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let enhanced;
    let data = $$props["data"];
    let collapsed = {};
    function getPlayerInfo(id) {
      if (!id) return { name: "Empty", team: "", positions: [], player_id: null };
      const players = data?.players;
      const p = players ? players[id] || players[id.toUpperCase?.()] || players[String(id)] : null;
      if (!p) return { name: id, team: "", positions: [], player_id: id };
      const fullName = p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.display_name || id;
      const positions = Array.isArray(p.fantasy_positions) ? p.fantasy_positions : p.position ? [p.position] : [];
      return {
        name: fullName,
        team: p.team || p.team_abbreviation || "FA",
        positions,
        player_id: p.player_id || id
      };
    }
    function headshot(pid) {
      return pid ? `https://sleepercdn.com/content/nba/players/${pid}.jpg` : "";
    }
    function _ro(r) {
      return r && r.raw ? r.raw : r || {};
    }
    function getTaxi(r) {
      const x = _ro(r);
      return x?.taxi || x?.taxi_squad || x?.taxi_players || x?.taxiSquad || x?.taxi_roster || x?.taxi_list || [];
    }
    function getStarters(r) {
      const x = _ro(r);
      if (Array.isArray(x?.starters) && x.starters.length) return x.starters;
      if (Array.isArray(r?.starters) && r.starters.length) return r.starters;
      if (Array.isArray(x?.starting_lineup) && x.starting_lineup.length) return x.starting_lineup;
      const players = r.player_ids || x?.players || [];
      return Array.isArray(players) ? players.slice(0, 9) : [];
    }
    function getBench(r) {
      const all = (r.player_ids || _ro(r)?.players || []).slice();
      const exclude = /* @__PURE__ */ new Set([
        ...(getStarters(r) || []).map(String),
        ...(getTaxi(r) || []).map(String)
      ]);
      return all.filter((p) => p && !exclude.has(String(p)));
    }
    const STARTER_SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
    enhanced = data?.data && Array.isArray(data.data) ? data.data.map((league) => {
      const rosters = (league.rosters || []).map((r) => {
        const startersRaw = getStarters(r);
        const _starters = STARTER_SLOTS.map((slot, idx) => {
          const pid = startersRaw[idx] || null;
          return pid ? { slot, pid, player: getPlayerInfo(pid) } : { slot, pid: null, player: null };
        });
        const benchIds = getBench(r);
        const _bench = benchIds.map((pid) => ({ pid, player: getPlayerInfo(pid) }));
        const taxiIds = getTaxi(r);
        const _taxi = taxiIds.map((pid) => ({ pid, player: getPlayerInfo(pid) }));
        return { ...r, _starters, _bench, _taxi };
      });
      return { ...league, rosters };
    }) : [];
    $$renderer2.push(`<div class="page wrap svelte-y04zar"><header class="page-head rise svelte-y04zar"><div class="eyebrow">League Rosters</div> <h1 class="page-title svelte-y04zar">Team Rosters</h1> <p class="page-sub svelte-y04zar">Current season starting lineups, bench, and taxi squads.</p></header> `);
    if (enhanced && enhanced.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<!--[-->`);
      const each_array = ensure_array_like(enhanced);
      for (let $$index_7 = 0, $$length = each_array.length; $$index_7 < $$length; $$index_7++) {
        let league = each_array[$$index_7];
        $$renderer2.push(`<div class="league-block svelte-y04zar">`);
        if (league.leagueName) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="league-name svelte-y04zar">${escape_html(league.leagueName)} · <span class="season-tag svelte-y04zar">${escape_html(league.season ?? "")}</span></div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> `);
        if (league.rosters && league.rosters.length) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="teams-grid svelte-y04zar" data-testid="rosters-grid"><!--[-->`);
          const each_array_1 = ensure_array_like(league.rosters);
          for (let idx = 0, $$length2 = each_array_1.length; idx < $$length2; idx++) {
            let roster = each_array_1[idx];
            $$renderer2.push(`<article${attr_class("team-card rise svelte-y04zar", void 0, { "collapsed": collapsed[roster.rosterId] })}${attr_style(`animation-delay: ${stringify(idx * 30)}ms;`)}${attr("data-testid", `team-card-${roster.rosterId}`)}><div class="team-head svelte-y04zar"><img class="team-avatar svelte-y04zar"${attr("src", roster.team_avatar || roster.owner_avatar || "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 56 56%22%3E%3C/svg%3E")}${attr("alt", roster.team_name)}/> <div class="team-info svelte-y04zar"><div class="team-name svelte-y04zar"${attr("title", roster.team_name)}>${escape_html(roster.team_name)}</div> `);
            if (roster.owner_name) {
              $$renderer2.push("<!--[0-->");
              $$renderer2.push(`<div class="team-owner svelte-y04zar">${escape_html(roster.owner_name)}</div>`);
            } else {
              $$renderer2.push("<!--[-1-->");
            }
            $$renderer2.push(`<!--]--> <div class="team-stats svelte-y04zar"><span class="stat-pill svelte-y04zar"><b class="svelte-y04zar">${escape_html(roster._starters.filter((s) => s.pid).length)}</b> Starters</span> <span class="stat-pill svelte-y04zar"><b class="svelte-y04zar">${escape_html(roster._bench.length)}</b> Bench</span> <span class="stat-pill svelte-y04zar"><b class="svelte-y04zar">${escape_html(roster._taxi.length)}</b> Taxi</span></div></div> <button type="button" class="collapse-btn svelte-y04zar"${attr("aria-pressed", !collapsed[roster.rosterId])}${attr("data-testid", `team-collapse-${roster.rosterId}`)}>${escape_html(collapsed[roster.rosterId] ? "+" : "−")}</button></div> `);
            if (!collapsed[roster.rosterId]) {
              $$renderer2.push("<!--[0-->");
              $$renderer2.push(`<section class="team-body svelte-y04zar"><div class="section-label svelte-y04zar">Starters</div> <div class="starters svelte-y04zar"><!--[-->`);
              const each_array_2 = ensure_array_like(roster._starters);
              for (let i = 0, $$length3 = each_array_2.length; i < $$length3; i++) {
                let st = each_array_2[i];
                $$renderer2.push(`<div class="player-pill svelte-y04zar"${attr("title", st.player?.name)}><span${attr_class(`slot-badge pos-pill ${stringify(st.slot)}`, "svelte-y04zar")}>${escape_html(st.slot)}</span> `);
                if (st.pid) {
                  $$renderer2.push("<!--[0-->");
                  $$renderer2.push(`<img class="player-headshot svelte-y04zar"${attr("src", headshot(st.player?.player_id))}${attr("alt", st.player?.name)}/> <div class="player-info svelte-y04zar"><div class="player-name svelte-y04zar">${escape_html(st.player?.name)}</div> <div class="player-team svelte-y04zar">${escape_html(st.player?.team)}</div></div> <div class="pos-tags svelte-y04zar">`);
                  if (st.player?.positions?.length) {
                    $$renderer2.push("<!--[0-->");
                    $$renderer2.push(`<!--[-->`);
                    const each_array_3 = ensure_array_like(st.player.positions);
                    for (let $$index = 0, $$length4 = each_array_3.length; $$index < $$length4; $$index++) {
                      let pos = each_array_3[$$index];
                      $$renderer2.push(`<span${attr_class(`pos-pill ${stringify(pos)}`, "svelte-y04zar")}>${escape_html(pos)}</span>`);
                    }
                    $$renderer2.push(`<!--]-->`);
                  } else {
                    $$renderer2.push("<!--[-1-->");
                    $$renderer2.push(`<span class="pos-pill UTIL">UTIL</span>`);
                  }
                  $$renderer2.push(`<!--]--></div>`);
                } else {
                  $$renderer2.push("<!--[-1-->");
                  $$renderer2.push(`<div class="player-info svelte-y04zar"><div class="player-name empty svelte-y04zar">— Empty —</div></div>`);
                }
                $$renderer2.push(`<!--]--></div>`);
              }
              $$renderer2.push(`<!--]--></div> <div class="section-label svelte-y04zar">Bench</div> `);
              if (roster._bench.length) {
                $$renderer2.push("<!--[0-->");
                $$renderer2.push(`<div class="bench-grid svelte-y04zar"><!--[-->`);
                const each_array_4 = ensure_array_like(roster._bench);
                for (let $$index_3 = 0, $$length3 = each_array_4.length; $$index_3 < $$length3; $$index_3++) {
                  let b = each_array_4[$$index_3];
                  $$renderer2.push(`<div class="player-pill compact svelte-y04zar"${attr("title", b.player?.name)}><span class="slot-badge pos-pill BN svelte-y04zar">BN</span> <img class="player-headshot small svelte-y04zar"${attr("src", headshot(b.player?.player_id))}${attr("alt", b.player?.name)}/> <div class="player-info svelte-y04zar"><div class="player-name svelte-y04zar">${escape_html(b.player?.name)}</div> <div class="player-team svelte-y04zar">${escape_html(b.player?.team)}</div></div> <div class="pos-tags svelte-y04zar">`);
                  if (b.player?.positions?.length) {
                    $$renderer2.push("<!--[0-->");
                    $$renderer2.push(`<!--[-->`);
                    const each_array_5 = ensure_array_like(b.player.positions);
                    for (let $$index_2 = 0, $$length4 = each_array_5.length; $$index_2 < $$length4; $$index_2++) {
                      let pos = each_array_5[$$index_2];
                      $$renderer2.push(`<span${attr_class(`pos-pill ${stringify(pos)}`, "svelte-y04zar")}>${escape_html(pos)}</span>`);
                    }
                    $$renderer2.push(`<!--]-->`);
                  } else {
                    $$renderer2.push("<!--[-1-->");
                  }
                  $$renderer2.push(`<!--]--></div></div>`);
                }
                $$renderer2.push(`<!--]--></div>`);
              } else {
                $$renderer2.push("<!--[-1-->");
                $$renderer2.push(`<div class="empty-row svelte-y04zar">Bench is empty.</div>`);
              }
              $$renderer2.push(`<!--]--> <div class="section-label svelte-y04zar">Taxi Squad</div> `);
              if (roster._taxi.length) {
                $$renderer2.push("<!--[0-->");
                $$renderer2.push(`<div class="bench-grid svelte-y04zar"><!--[-->`);
                const each_array_6 = ensure_array_like(roster._taxi);
                for (let $$index_5 = 0, $$length3 = each_array_6.length; $$index_5 < $$length3; $$index_5++) {
                  let t = each_array_6[$$index_5];
                  $$renderer2.push(`<div class="player-pill compact svelte-y04zar"${attr("title", t.player?.name)}><span class="slot-badge pos-pill TX svelte-y04zar">TX</span> <img class="player-headshot small svelte-y04zar"${attr("src", headshot(t.player?.player_id))}${attr("alt", t.player?.name)}/> <div class="player-info svelte-y04zar"><div class="player-name svelte-y04zar">${escape_html(t.player?.name)}</div> <div class="player-team svelte-y04zar">${escape_html(t.player?.team)}</div></div> <div class="pos-tags svelte-y04zar">`);
                  if (t.player?.positions?.length) {
                    $$renderer2.push("<!--[0-->");
                    $$renderer2.push(`<!--[-->`);
                    const each_array_7 = ensure_array_like(t.player.positions);
                    for (let $$index_4 = 0, $$length4 = each_array_7.length; $$index_4 < $$length4; $$index_4++) {
                      let pos = each_array_7[$$index_4];
                      $$renderer2.push(`<span${attr_class(`pos-pill ${stringify(pos)}`, "svelte-y04zar")}>${escape_html(pos)}</span>`);
                    }
                    $$renderer2.push(`<!--]-->`);
                  } else {
                    $$renderer2.push("<!--[-1-->");
                  }
                  $$renderer2.push(`<!--]--></div></div>`);
                }
                $$renderer2.push(`<!--]--></div>`);
              } else {
                $$renderer2.push("<!--[-1-->");
                $$renderer2.push(`<div class="empty-row svelte-y04zar">Taxi squad empty.</div>`);
              }
              $$renderer2.push(`<!--]--></section>`);
            } else {
              $$renderer2.push("<!--[-1-->");
            }
            $$renderer2.push(`<!--]--></article>`);
          }
          $$renderer2.push(`<!--]--></div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
          $$renderer2.push(`<div class="empty-card svelte-y04zar">No rosters available for this league.</div>`);
        }
        $$renderer2.push(`<!--]--></div>`);
      }
      $$renderer2.push(`<!--]-->`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-y04zar" data-testid="rosters-empty">No rosters available.</div>`);
    }
    $$renderer2.push(`<!--]--></div>`);
    bind_props($$props, { data });
  });
}
export {
  _page as default
};
