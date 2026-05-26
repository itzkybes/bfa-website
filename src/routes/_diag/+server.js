// Minimal diagnostic endpoint to verify Vercel serverless function is working.
// If THIS works on Vercel but other routes fail, the bug is route-specific.
// If THIS fails too, the bug is in the function bundle itself.

export const prerender = false;

export async function GET({ url, request }) {
  const diag = {
    ok: true,
    timestamp: new Date().toISOString(),
    node: {
      version: typeof process !== 'undefined' ? process.version : 'unknown',
      platform: typeof process !== 'undefined' ? process.platform : 'unknown'
    },
    url: url.toString(),
    runtime: {
      hasGlobalFetch: typeof fetch !== 'undefined',
      hasGlobalRequest: typeof Request !== 'undefined',
      hasGlobalResponse: typeof Response !== 'undefined'
    },
    env_keys: Object.keys(process.env || {}).filter((k) => !k.startsWith('_')).slice(0, 30),
    headers: Object.fromEntries(request.headers.entries())
  };

  // Try fetching Sleeper from inside the function to confirm outbound HTTPS works
  try {
    const res = await fetch('https://api.sleeper.app/v1/state/nba', {
      method: 'GET',
      headers: { Accept: 'application/json' }
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

  // Try event.fetch to a local static asset (to test SvelteKit-internal fetch on Vercel)
  try {
    const res = await fetch(url.origin + '/season_matchups/2022.json');
    diag.static_fetch_test = { status: res.status, ok: res.ok, contentType: res.headers.get('content-type') };
  } catch (e) {
    diag.static_fetch_test = { error: String(e && e.message ? e.message : e) };
  }

  return new Response(JSON.stringify(diag, null, 2), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}
