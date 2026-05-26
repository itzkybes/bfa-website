// src/routes/rosters/+page.js
// Run client-side only — bypass the broken Vercel serverless function.
// This page now fetches Sleeper data directly from the browser (same pattern as the home page).
export const ssr = false;
export const prerender = false;
