import { I as getContext, z as ensure_array_like, k as attr_class, a9 as store_get, j as attr, A as escape_html, ad as unsubscribe_stores, a7 as slot } from "../../chunks/renderer.js";
import "clsx";
import "@sveltejs/kit/internal";
import "../../chunks/exports.js";
import "../../chunks/utils.js";
import "@sveltejs/kit/internal/server";
import "../../chunks/root.js";
import "../../chunks/state.svelte.js";
import "web-vitals";
const getStores = () => {
  const stores$1 = getContext("__svelte__");
  return {
    /** @type {typeof page} */
    page: {
      subscribe: stores$1.page.subscribe
    },
    /** @type {typeof navigating} */
    navigating: {
      subscribe: stores$1.navigating.subscribe
    },
    /** @type {typeof updated} */
    updated: stores$1.updated
  };
};
const page = {
  subscribe(fn) {
    const store = getStores().page;
    return store.subscribe(fn);
  }
};
function Header($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    var $$store_subs;
    let open = false;
    let recordsOpen = false;
    const links = [
      { href: "/", label: "Home" },
      { href: "/rosters", label: "Rosters" },
      { href: "/matchups", label: "Matchups" },
      { href: "/standings", label: "Standings" },
      {
        href: "/records",
        label: "Records",
        children: [
          { href: "/records-team", label: "Team Records" },
          { href: "/records-player", label: "Player Records" }
        ]
      },
      { href: "/honor-hall", label: "Honor Hall" }
    ];
    function isActive(path, href) {
      if (!path) return false;
      if (href === "/") return path === "/" || path === "";
      return path === href || path.startsWith(href + "/");
    }
    function isRecordsActive(path) {
      return path && (path.startsWith("/records-team") || path.startsWith("/records-player"));
    }
    $$renderer2.push(`<header class="site-header svelte-se4uza" role="banner"><div class="wrap header-inner svelte-se4uza"><a class="brand svelte-se4uza" href="/" data-testid="brand-home-link" aria-label="Badger Fantasy Association home"><img src="/bfa-logo.png" alt="BFA" class="brand-logo svelte-se4uza" width="56" height="56" loading="eager"/> <span class="brand-text svelte-se4uza"><span class="brand-line-1 svelte-se4uza">Badger</span> <span class="brand-line-2 svelte-se4uza">Fantasy Association</span></span></a> <nav class="nav-desktop svelte-se4uza" aria-label="Primary"><!--[-->`);
    const each_array = ensure_array_like(links);
    for (let $$index_1 = 0, $$length = each_array.length; $$index_1 < $$length; $$index_1++) {
      let l = each_array[$$index_1];
      if (l.children) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div${attr_class("nav-item has-children svelte-se4uza", void 0, {
          "active": isRecordsActive(store_get($$store_subs ??= {}, "$page", page).url.pathname)
        })}><button type="button" class="nav-link records-btn svelte-se4uza" aria-haspopup="true"${attr("aria-expanded", recordsOpen)} data-testid="nav-records-toggle">${escape_html(l.label)} <span class="caret svelte-se4uza" aria-hidden="true">▾</span></button> `);
        {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
        $$renderer2.push(`<a${attr("href", l.href)}${attr_class("nav-link svelte-se4uza", void 0, {
          "active": isActive(store_get($$store_subs ??= {}, "$page", page).url.pathname, l.href)
        })}${attr("aria-current", isActive(store_get($$store_subs ??= {}, "$page", page).url.pathname, l.href) ? "page" : void 0)}${attr("data-testid", `nav-link-${l.label.toLowerCase().replace(/\s+/g, "-")}`)}>${escape_html(l.label)}</a>`);
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--></nav> <button type="button" class="hamburger svelte-se4uza"${attr("aria-expanded", open)} aria-controls="mobile-menu"${attr("aria-label", "Open menu")} data-testid="mobile-menu-toggle"><span${attr_class("bar svelte-se4uza", void 0, { "open": open })}></span> <span${attr_class("bar svelte-se4uza", void 0, { "open": open })}></span> <span${attr_class("bar svelte-se4uza", void 0, { "open": open })}></span></button></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></header>`);
    if ($$store_subs) unsubscribe_stores($$store_subs);
  });
}
function _layout($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    $$renderer2.push(`<a class="skip-link" href="#content">Skip to content</a> `);
    Header($$renderer2);
    $$renderer2.push(`<!----> <main id="content" class="svelte-12qhfyh"><!--[-->`);
    slot($$renderer2, $$props, "default", {});
    $$renderer2.push(`<!--]--></main> <footer class="site-footer svelte-12qhfyh" role="contentinfo"><div class="wrap footer-inner svelte-12qhfyh"><div class="footer-brand svelte-12qhfyh"><div class="footer-mark svelte-12qhfyh">BFA</div> <div class="footer-meta"><div class="footer-title svelte-12qhfyh">Badger Fantasy Association</div> <div class="footer-sub svelte-12qhfyh">Fantasy Basketball · Powered by Sleeper · © ${escape_html((/* @__PURE__ */ new Date()).getFullYear())}</div></div></div> <nav class="footer-nav svelte-12qhfyh" aria-label="Footer"><div class="footer-col svelte-12qhfyh"><div class="col-title svelte-12qhfyh">League</div> <a href="/" data-testid="footer-link-home" class="svelte-12qhfyh">Home</a> <a href="/rosters" data-testid="footer-link-rosters" class="svelte-12qhfyh">Rosters</a> <a href="/standings" data-testid="footer-link-standings" class="svelte-12qhfyh">Standings</a> <a href="/matchups" data-testid="footer-link-matchups" class="svelte-12qhfyh">Matchups</a></div> <div class="footer-col svelte-12qhfyh"><div class="col-title svelte-12qhfyh">Records</div> <a href="/records-team" data-testid="footer-link-records-team" class="svelte-12qhfyh">Team Records</a> <a href="/records-player" data-testid="footer-link-records-player" class="svelte-12qhfyh">Player Records</a> <a href="/honor-hall" data-testid="footer-link-honor-hall" class="svelte-12qhfyh">Honor Hall</a></div> <div class="footer-col svelte-12qhfyh"><div class="col-title svelte-12qhfyh">External</div> <a href="https://sleeper.com/" target="_blank" rel="noreferrer" data-testid="footer-link-sleeper" class="svelte-12qhfyh">Sleeper ↗</a> <a href="https://docs.sleeper.app/" target="_blank" rel="noreferrer" data-testid="footer-link-sleeper-api" class="svelte-12qhfyh">Sleeper API ↗</a></div></nav></div></footer>`);
  });
}
export {
  _layout as default
};
