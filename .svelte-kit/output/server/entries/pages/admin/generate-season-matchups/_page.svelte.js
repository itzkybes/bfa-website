import { z as ensure_array_like, A as escape_html, j as attr, m as bind_props } from "../../../../chunks/renderer.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let data = $$props["data"];
    const messages = data?.messages ?? [];
    const outputs = data?.outputs ?? [];
    $$renderer2.push(`<div class="page wrap svelte-12f7qkc"><header class="page-head rise svelte-12f7qkc"><div class="eyebrow">Admin · Tooling</div> <h1 class="page-title svelte-12f7qkc">Generate Season Matchups JSON</h1> <p class="page-sub svelte-12f7qkc">Fetches matchups &amp; roster metadata from Sleeper and produces JSON payloads mirroring <code class="svelte-12f7qkc">/season_matchups/&lt;year>.json</code>. Files are NOT written — copy the JSON into GitHub.</p></header> <section class="block svelte-12f7qkc"><div class="block-head svelte-12f7qkc"><h2 class="block-title svelte-12f7qkc">Messages</h2></div> `);
    if (messages.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<ol class="msg-list svelte-12f7qkc"><!--[-->`);
      const each_array = ensure_array_like(messages);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let m = each_array[$$index];
        $$renderer2.push(`<li>${escape_html(m)}</li>`);
      }
      $$renderer2.push(`<!--]--></ol>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="empty-card svelte-12f7qkc">No messages.</div>`);
    }
    $$renderer2.push(`<!--]--></section> `);
    if (outputs.length) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<!--[-->`);
      const each_array_1 = ensure_array_like(outputs);
      for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
        let out = each_array_1[$$index_1];
        $$renderer2.push(`<section class="block svelte-12f7qkc"><div class="block-head svelte-12f7qkc"><div><h2 class="block-title svelte-12f7qkc">Season ${escape_html(out.year)}</h2> <div class="meta-line svelte-12f7qkc">Playoff start: <strong class="svelte-12f7qkc">${escape_html(out.meta.playoff_week_start ?? "15")}</strong> · Weeks: <strong class="svelte-12f7qkc">${escape_html(Object.keys(out.weeks).length)}</strong></div></div> <button class="btn primary sm"${attr("data-testid", `admin-copy-${out.year}`)}>Copy JSON</button></div> <div class="block-body svelte-12f7qkc"><pre class="jsonblob svelte-12f7qkc">${escape_html(JSON.stringify(out.weeks, null, 2))}</pre></div></section>`);
      }
      $$renderer2.push(`<!--]-->`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<section class="block svelte-12f7qkc"><div class="empty-card svelte-12f7qkc">No outputs produced.</div></section>`);
    }
    $$renderer2.push(`<!--]--></div>`);
    bind_props($$props, { data });
  });
}
export {
  _page as default
};
