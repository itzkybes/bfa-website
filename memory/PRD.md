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
- ✅ Full BFA-themed redesign across all 8 routes (Blue `#3831DB` brand + Orange `#E3772F` accent, Bebas Neue + Outfit)
- ✅ **MAJOR REFACTOR: Moved ALL data fetching client-side** (same pattern as the home page) — eliminated every `+page.server.js` file. New flow: page is rendered as static HTML shell on Vercel CDN, then `onMount` fetches Sleeper API directly from the browser. **Zero serverless function invocation.**
- ✅ Created `lib/sleeperClient.client.js` (browser-safe Sleeper API client w/ localStorage cache)
- ✅ Created `lib/leagueCompute.client.js` (browser-safe standings/matchups/MVP compute, ported from server logic)
- ✅ Each route now has `+page.js` with `ssr=false; prerender=false` to force pure client-side render
- ✅ Verified locally: rosters → 14 teams + 214 players · honor-hall → champion "THE CODFATHER" + Luka Dončić as MVP · standings → 14 ranked teams · all with real Sleeper data
- ✅ Vercel adapter explicitly pinned to `@sveltejs/adapter-vercel@^6.3.3` with `runtime: 'nodejs20.x'`
- ✅ `vite.config.js` sets `server.allowedHosts: true` + `preview.allowedHosts: true` for Emergent preview environment
- ✅ `vercel.json` strips any stale `pnpm-lock.yaml` and forces yarn install
- ✅ `engines.node: "20.x"` + `.nvmrc: 20` pin build runtime

## What's Been Implemented (2026-03-02)
- ✅ **Finals MVP now correctly = top scorer in the championship GAME only** (across BOTH finalists), not the champion's top scorer across the full playoff window. Added `getChampionshipGame(winnersBracket, playoffStart)` helper in `leagueCompute.client.js` that finds the bracket match where `p === 1`, derives the week from the round (`playoffStart + (r-1)`), and returns the two finalists' roster ids. Both `/records-player` and `/honor-hall` now filter `collectedMatchups[champWeek]` to those two rosters before aggregating per-player points.
- ✅ Verified per-season Finals MVPs are now accurate:
  - 2022 → **Domantas Sabonis 48.5** (riguy506)
  - 2023 → **De'Aaron Fox 39.5** (jewishhorsemen — top scorer in the championship even though armyjunior won)
  - 2024 → **Rudy Gobert 41.5** (riguy506)
  - 2025 → **Luka Dončić 75.8** (zamt)
- ✅ Removed the old "restrict Finals MVP to champion's roster" guard since the championship-game restriction supersedes it.
- ✅ **Fixed historical-season MVPs (2022/2023/2024) on `/records-player` and `/honor-hall`**. The static `/season_matchups/{year}.json` snapshots DID contain per-player `starters` + `starters_points` arrays, but `leagueCompute.client.js` was synthesizing the matchup entries WITHOUT propagating them — so the `aggregatePlayerPoints` helper had nothing to chew on for past seasons.

## What's Been Implemented (2026-02-28)
- ✅ **Fixed Vercel build failure** ("Unsupported Node.js version: v22.x — please use Node 18 or Node 20"). Root cause: previous `package.json` still had `@sveltejs/adapter-auto` as a fallback, which on Vercel auto-installed an older `@sveltejs/adapter-vercel` that only accepted Node 18/20. Vercel's default build runtime is now Node 22.x, so the older adapter rejected the build. Fix:
  - Removed `@sveltejs/adapter-auto` from `devDependencies` entirely (we explicitly import `@sveltejs/adapter-vercel` in `svelte.config.js` so adapter-auto served no purpose and only invited regressions).
  - Bumped `runtime` to `nodejs22.x` in `svelte.config.js` to match Vercel's current default.
  - `.nvmrc` → `22`, `engines.node` → `">=20"` so local sandbox (Node 20) and Vercel (Node 22) both build successfully.
  - Verified locally with `yarn build` → `✓ built in 5.71s` and `Using @sveltejs/adapter-vercel`.
- ✅ **Fixed `/records-player` crash** — `computeStandingsForLeague` was used on line 84 but missing from the imports; added it. All season MVP cards and the all-time playoff table now render with real Sleeper data.
- ✅ **Fixed Toilet Bowl final standings 9–14** (`src/lib/leagueCompute.client.js`). In Sleeper's `losers_bracket`, the team that keeps WINNING advances toward the "Toilet Bowl Champion" slot = ABSOLUTE LAST place. The previous code mirrored the winners-bracket convention (game-winner = better placement). Now: for each loser-bracket match, the game-WINNER receives the WORSE placement and the game-LOSER receives the BETTER placement. Placement labels for relative `p` are inverted via `totalRosters - pRaw + 1` (winner) and `totalRosters - pRaw` (loser).
- ✅ Verified on 2024 season: Biggest Loser is now correctly **PACT NICELY (WillMichael)** — the team that "won" the toilet bowl bracket. Records-Team aggregated playoff table still shows correct championship trophies (Fraggle Rock 9: 2, armyjunior: 1, JFK4312: 1).

## How It Works Now (vs broken approach)
- **Before**: Each route had `+page.server.js`. Vercel serverless function was invoked for every page view. Function was crashing with `FUNCTION_INVOCATION_FAILED` for inscrutable Vercel-side reasons.
- **After**: Each route is a static HTML shell + browser-side fetch. The Vercel serverless function is **never invoked**. The home page already worked this way (using the Rando Player client-side fetch) — now every page follows the same pattern.

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
