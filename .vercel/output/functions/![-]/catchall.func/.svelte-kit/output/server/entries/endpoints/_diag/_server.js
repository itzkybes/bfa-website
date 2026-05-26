const prerender = false;
async function GET({ url, request }) {
  const diag = {
    ok: true,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    node: {
      version: typeof process !== "undefined" ? process.version : "unknown",
      platform: typeof process !== "undefined" ? process.platform : "unknown"
    },
    url: url.toString(),
    runtime: {
      hasGlobalFetch: typeof fetch !== "undefined",
      hasGlobalRequest: typeof Request !== "undefined",
      hasGlobalResponse: typeof Response !== "undefined"
    },
    env_keys: Object.keys(process.env || {}).filter((k) => !k.startsWith("_")).slice(0, 30),
    headers: Object.fromEntries(request.headers.entries())
  };
  try {
    const res = await fetch("https://api.sleeper.app/v1/state/nba", {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    diag.sleeper_api_test = { status: res.status, ok: res.ok };
    if (res.ok) {
      const j = await res.json();
      diag.sleeper_api_test.season = j.season;
      diag.sleeper_api_test.week = j.week;
    }
  } catch (e) {
    diag.sleeper_api_test = { error: String(e && e.message ? e.message : e) };
  }
  try {
    const res = await fetch(url.origin + "/season_matchups/2022.json");
    diag.static_fetch_test = { status: res.status, ok: res.ok, contentType: res.headers.get("content-type") };
  } catch (e) {
    diag.static_fetch_test = { error: String(e && e.message ? e.message : e) };
  }
  return new Response(JSON.stringify(diag, null, 2), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });
}
export {
  GET,
  prerender
};
