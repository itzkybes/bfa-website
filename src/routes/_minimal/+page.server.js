// Minimal server load — no imports, no API calls, no helpers.
// If THIS still returns 500 on Vercel, then the issue is NOT my code at all,
// it's something about how Vercel runs SvelteKit serverless functions for this project.
export const prerender = false;

export async function load({ url, setHeaders }) {
  setHeaders({ 'cache-control': 'no-store' });
  return {
    hello: 'world',
    timestamp: new Date().toISOString(),
    url: url.pathname,
    nodeVersion: typeof process !== 'undefined' ? process.version : null
  };
}
