import { A as escape_html, m as bind_props } from "../../../chunks/renderer.js";
function _page($$renderer, $$props) {
  let data = $$props["data"];
  $$renderer.push(`<pre style="padding:2rem; color:#fff; background:#07070d; font-family: ui-monospace, monospace; font-size: 13px;">${escape_html(JSON.stringify(data, null, 2))}
</pre>`);
  bind_props($$props, { data });
}
export {
  _page as default
};
