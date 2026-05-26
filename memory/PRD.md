# Badger Fantasy Association — Product Requirements

## Problem Statement
> "hi I would like you to review this website and then create a new website with the same features. Also be sure to review all code and then to output a summary of each file for the new and old website"

User followed up confirming:
- Review the existing `/app/` SvelteKit codebase
- Keep tech stack as **SvelteKit** (SSR via Vercel)
- Replace the existing code in `/app/`
- Fresh modern redesign
- Deploys to **Vercel**
- Fantasy basketball using **Sleeper API**
- Use the **BFA logo color scheme** (Deep Blue `#3831DB` + Basketball Orange `#E3772F`)

## Architecture
- **Frontend**: SvelteKit 2.8 / Svelte 5.2 (Server-side rendered, hybrid static + serverless functions)
- **Data**: Sleeper public REST API (read-only, no auth)
- **Cache**: Server-side memo cache (`lib/server/cache.js`) + localStorage on client (`lib/cache.js`)
- **Static historical data**: `/static/season_matchups/{year}.json` for 2022-2024, `/static/early2023.json` overrides, `/static/week-ranges.json` calendar
- **Deploy**: Vercel via `@sveltejs/adapter-vercel@^6.3.3` with `runtime: 'nodejs22.x'`
- **Routing**: `/`, `/rosters`, `/standings`, `/matchups`, `/records-team`, `/records-player`, `/honor-hall`, `/admin/generate-season-matchups`

## User Personas
- **League members** — view current rosters, standings, matchups, MVP races
- **League commissioner** — track all-time records and use the admin tool to materialize `season_matchups/<year>.json` files into the repo
- **Casual visitors** — see who's leading, who's the champion, recent matchups

## Core Requirements (static)
1. **Home** — hero, "Rando Player" spotlight with Shuffle, current-week matchups (auto-detected via week-ranges.json)
2. **Rosters** — Per-team starters / bench / taxi with NBA headshots & position pills
3. **Standings** — Regular season + playoffs with season selector
4. **Matchups** — H2H scores per season+week with winner highlight
5. **Team Records** — Aggregated W/L/PF/PA + Head-to-Head matrix + largest/smallest margins
6. **Player Records** — Per-season Overall MVP + Finals MVP, all-time best per team (playoff + full season)
7. **Honor Hall** — Final standings from bracket sim, Champion, Biggest Loser, MVP cards
8. **Admin tool** — Generate season_matchups JSON from Sleeper data (read-only, copy to clipboard)

## What's Been Implemented (2026-01-26)
- ✅ Full redesign of all 8 routes with the BFA-themed "Performance Pro" aesthetic — consistent across every page (verified: every page reads `--bg-base: #07070d`, `--brand: #3831DB` for eyebrows/identity, `--accent: #E3772F` for action elements)
- ✅ All Sleeper API server-load functions preserved (zero behavior change)
- ✅ Fixed corrupted `lib/cache.js` + `routes/+page.svelte` (had garbage doc prefix breaking the build)
- ✅ Sticky responsive header with Records dropdown + mobile hamburger
- ✅ Dual-accent color system using BFA logo colors: Blue (`#3831DB`) for identity, Orange (`#E3772F`) for action
- ✅ Custom Bebas Neue + Outfit typography (no Inter/Roboto)
- ✅ Fixed two season-selector navigation bugs (Honor Hall + Records-Player) via `data-sveltekit-reload`
- ✅ Vercel Node 22 build error resolved (pinned `@sveltejs/adapter-vercel@^6.3.3` with explicit `runtime: 'nodejs22.x'`)
- ✅ Fixed Vercel `/rosters` 500 error — Sleeper `/players/nba` was 5MB, exceeding the 4.5MB serverless response limit. Slimmed playersMap to only roster-relevant players (~250 entries, 256KB total response).
- ✅ Fixed Vercel `FUNCTION_INVOCATION_FAILED` on ALL `+page.server.js` routes — was caused by a stale `pnpm-lock.yaml` on GitHub conflicting with the local `yarn.lock`. Fixes applied: (1) `vercel.json` with `installCommand: "rm -f pnpm-lock.yaml package-lock.json && yarn install"` forces yarn install regardless of stray lock files; (2) refactored ALL 7 `+page.server.js` files from module-level instantiation to lazy `getSleeperClient()` singletons so dependency mismatch / cold-start exceptions can't kill the function on import. Also normalized CRLF→LF line endings in server files.
- ✅ Frontend supervisor wrapper at `/app/frontend/package.json` so local preview works
- ✅ SITE_FILE_COMPARISON.md document with file-by-file summary
- ✅ Testing: 100% pass rate after fixes (iteration_2.json)

## Prioritized Backlog (P0/P1/P2 features remaining)
- **P1** — Per-team season trends chart (PF/week over time) for Standings page
- **P1** — Per-roster matchup history page (deep link from /rosters)
- **P2** — "Power Rankings" computed from Sleeper performance over rolling 4-week window
- **P2** — Trade ledger page (Sleeper transactions API)
- **P2** — Mobile FAB to jump to "This Week" matchups from any page
- **P3** — User-controlled theme switch (light + light-on-blue variants)

## Next Tasks
- Awaiting user testing of the redesigned site (preview URL or Vercel deploy).
- If satisfied → push to GitHub via the "Save to GitHub" feature in chat input.
