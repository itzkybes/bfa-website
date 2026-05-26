const prerender = false;
async function load({ url, setHeaders }) {
  setHeaders({ "cache-control": "no-store" });
  return {
    hello: "world",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    url: url.pathname,
    nodeVersion: typeof process !== "undefined" ? process.version : null
  };
}
export {
  load,
  prerender
};
