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

## What's Been Implemented (2026-03-02 — power rankings + trade ledger + matchup fix)
- ✅ **Fixed home page matchups** showing empty grid. Root cause: forward-discovery picked the 2026 league as "latest", but 2026 is `status: "pre_draft"` (hasn't drafted yet) — Sleeper returns empty matchup arrays for it. Added a new `pickActiveLeague()` helper that walks the chain newest → oldest and picks the first league with `status: "in_season"`, falling back to most recent `complete`, then any. So now the home page shows the 2025 league's **championship week (W22)** with 8 real matchup cards (Gilbert Arenas 254.8 vs I could gopher a beer 301.0 — the actual final). The eyebrow auto-adjusts: "FINAL · CHAMPIONSHIP WEEK" for complete leagues, "THIS WEEK" for live ones.
- ✅ **Smart current-week detection** via new `getCurrentWeekForLeague()` helper. Prefers Sleeper's own `settings.last_scored_leg` field (the canonical "which week was last scored") and falls back to scanning weeks 25 → 1 with a min-average-points threshold so it skips consolation-bracket dust like W23–25 of completed leagues.
- ✅ **Trade Ledger** on home page. New section below matchups showing the 10 most-recent **completed trades** across the live league. Each card shows: week badge, relative time ("3mo ago"), both team avatars + names (linkable to `/team/{username}`), what each side **receives** — players with headshots/position/team, draft picks, FAAB. Built on top of two new helpers: `getTransactionsForWeek(leagueId, week)` and `getRecentTrades(leagueId, opts)`. Verified live — pulling 10 actual completed trades from the 2025 BFA season including the Jonathan Kuminga + 2x 2026 picks for Norman Powell + $4 FAAB deal.
- ✅ **Power Rankings page** at `/power-rankings`. Rolling 4-week window composite ranking using a 60/40 blend of (avg PF rank) and (W-L rank, with margin as tiebreaker). Pulls weekly PF + W-L from the existing `weeklyPfByRoster` + `collectedMatchups` outputs of `computeStandingsForLeague` — no extra Sleeper calls. Each row shows L4 W-L, L4 Avg PF, cumulative margin, a sparkline of the 4 weekly PF values, and a **movement pill** (▲▼ vs the prior 4-week window). Team names link through to the per-roster history page. Verified live — top 4: Codfather 302.0 avgPF (—), Emperors ▲2, Corey's Shower ▼1, DAMN!!! ▲2.
- ✅ Added "Power" link to the global header nav.
- ✅ `getSeasonsChain` now captures `status` per season so callers can branch on it without re-fetching league metadata.

## What's Been Implemented (2026-03-02 — feature batch: leaderboard + trends + team history)
- ✅ **Playoffs MVP All-Time Leaderboard** on `/records-player`. New section below the per-season MVP cards: top 25 players by **cumulative playoff points across every season**. Columns: rank, player headshot + name, total PTS, best single run (with year stamp), # of seasons appeared, most-recent team. Verified live — Nikola Jokić leads at 515.69 cumulative playoff points, best run 153.50 in 2025.
- ✅ **Per-team season trends chart** on `/standings`. New "PF / Week" column in the regular-season table with an inline SVG sparkline per team — the actual PF curve across every regular-season week of the selected season. Uses a new dependency-free `Sparkline.svelte` component (~50 lines, zero deps). Falls back to an em-dash placeholder for seasons that haven't started yet (2026). Verified live — 14 sparklines rendered with real path data on the 2024 standings.
- ✅ **Per-roster matchup history page** at `/team/[username]`. New route showing one season block per year the owner appears in, with a full week-by-week table (week #, opponent w/ avatar + link, my PTS, opp PTS, margin, W/L/T pill). Playoff weeks get a "PO" badge + tinted row background. Champion seasons get the 🏆 badge in the section header. Verified live — `/team/riguy506` renders 5 season blocks across 2022 → 2026, all rows populated with real Sleeper data.
- ✅ Team-name on every roster card on `/rosters` is now a deep link to that owner's matchup history page (with a subtle chevron + hover treatment).
- ✅ Fixed `getRosterMapWithOwners` to fall back `owner_username` to `display_name` when Sleeper's privacy settings null out the username field (which is the case for all BFA users). Without this fix, the team-history URLs would have been broken.
- ✅ Extended `computeStandingsForLeague` to also return `weeklyPfByRoster` — `{ rosterId: [{ week, pf }, ...] }` for the regular season — so the sparkline doesn't trigger any extra Sleeper fetches.

## What's Been Implemented (2026-03-02 — forward auto-discovery)
- ✅ **Future-season auto-discovery.** `getSeasonsChain()` now walks in BOTH directions: backwards via `previous_league_id` (existing) AND forwards via Sleeper's `/user/{user_id}/leagues/nba/{season}` endpoint. Probes a handful of seed users from the anchor league for each year `> latest known`, and adopts any league whose `previous_league_id` chains back to a discovered one. Confirmed working against the live API — `node scripts/test-auto-discovery.mjs` now discovers all 5 seasons (2022–2026) without `BASE_LEAGUE_ID` being bumped.
- ✅ **`getLatestOwnerAvatars()` now uses the truly-latest discovered season** (not the hardcoded BASE), so when 2026 arrives every historical season picks up 2026 team art automatically.
- ✅ **Home page resolves the "current" league_id from the discovered seasons chain** instead of the hardcoded fallback. Verified the home page is now fetching matchups from `1344133146307739648` (the 2026 league) without any code change. Eyebrow label is derived from the discovered season number too (`Season 2025 / 26 · Live`, etc.).
- ✅ **Rosters page** now imports `BASE_LEAGUE_ID` from `sleeperClient.client.js` so there's a single source of truth for the anchor.
- ✅ Added `scripts/test-auto-discovery.mjs` as a manual sanity check + `scripts/README.md`.
- ✅ Updated `README.md` "New seasons show up automatically" section + revised the `BASE_LEAGUE_ID` upkeep notes.

## What's Been Implemented (2026-03-02 — brand pass)
- ✅ **Recolored the whole site to match the BFA logo exactly.** Sampled the actual logo PNG pixel-by-pixel — the dominant colors are `#3432c8` (royal blue, the circle background) and `#c87232` (burnt basketball orange), which are noticeably deeper than the previous brighter tokens. Updated CSS variables (`--brand`, `--brand-hover`, `--brand-soft`, `--brand-glow`, `--accent`, `--accent-hover`, `--accent-soft`, `--accent-glow`, `--border-accent`) in `app.css`, plus replaced the remaining hardcoded `rgba(56,49,219)` / `rgba(227,119,47)` references in the body background and the MVP card gradients across Honor Hall and Player Records.
- ✅ **Bumped the BFA logo size everywhere it appears.**
  - Header: `48px → 72px` (and `40px → 56px` on mobile). Brand-line text scaled up to match (`1.4rem → 1.7rem` for "BADGER", `0.85rem → 1rem` for "FANTASY ASSOCIATION").
  - Footer: `60px → 88px`.
- ✅ Verified visually: home hero "BADGER BOWL" title now uses the deeper royal blue from the circle; the basketball-orange accent on buttons, eyebrows, and active nav reads warmer and more on-brand.

## What's Been Implemented (2026-03-02 — cleanup pass)
- ✅ **Repo cleanup**: deleted dead code — `src/lib/server/` (old SSR module, now unused), `src/lib/actions/clickOutside.js`, `src/lib/form.js`, `src/lib/LazyImage.svelte`, `src/hooks.js`, `static/svelte-welcome.webp`, plus stale top-level docs `SITE_FILE_COMPARISON.md` / `UPGRADE_SUMMARY.md` / `design_guidelines.json`. Removed unused `cookie`, `@types/cookie`, and `@fontsource/fira-mono` from `package.json`.
- ✅ **Tightened public surface** of `leagueCompute.client.js` — `HARDCODED_CHAMPIONS`, `fetchStaticJson`, `computeStreaks`, `MAX_WEEKS` are now module-internal; only the actually-used helpers are exported.
- ✅ **Killed dead imports** across honor-hall, records-player, admin pages.
- ✅ **Added human-feel JSDoc comments** to every function in `sleeperClient.client.js`, `leagueCompute.client.js`, `cache.js`, `vitals.js`.
- ✅ **Rewrote `README.md`** from scratch — concrete project intro, route table, the three-MVP definitions, architecture notes, "why everything is CSR", local + deploy instructions, and the deploy gotchas (Node 22, `.vercel/output/` must stay git-ignored).

## What's Been Implemented (2026-03-02)
- ✅ **Footer now uses the BFA logo image** (`/static/bfa-logo.png`) instead of the plain "BFA" text box. The logo links back home and animates on hover.
- ✅ **Most-recent team logos applied across every page**. Added `getLatestOwnerAvatars()` helper in `leagueCompute.client.js` that fetches the current (BASE_LEAGUE_ID = 2025) roster map once and builds a `{owner_username: {team_avatar, owner_avatar, team_name}}` lookup. `computeStandingsForLeague()` now overlays each historical season's rosterMap entry with these latest values (matched by `owner_username`, which is stable across seasons in Sleeper). So when viewing 2022 standings/matchups/honor-hall, every team displays its current 2025 logo and team name. Also fixed `records-team`'s aggregation to "always prefer latest" so all-time tables match.
- ✅ **Unified page-head styling** across Standings, Matchups, Records-Team, Records-Player, Honor Hall, and Rosters. Every page now uses the same three-element header: eyebrow + display title + descriptive sub paragraph, with the season/week dropdown floated right where applicable. Removed the duplicate "The Badger Bowl" sub on Standings.
- ✅ **Playoffs MVP card** added to both Honor Hall and Player Records (brand-blue accent).

## What's Been Implemented (2026-03-02 earlier)
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
- **P2** — "Championship Game Boxscore" mini-section on Honor Hall (top 3 scorers per finalist)
- **P2** — `CONTRIBUTING.md` runbook for adding a new season / yearly migration
- **P2** — Mobile FAB to jump to "This Week" matchups from any page
- **P3** — Subtle owner avatar fallback on hover for team logos
- **P3** — User-controlled theme switch (light + light-on-blue variants)

## Next Tasks
- User verification of: (a) home page matchups now show real W22 championship data instead of an empty grid, (b) Trade Ledger section on home page, (c) `/power-rankings` rolling 4-week page.
- If satisfied → push to GitHub via the "Save to GitHub" feature in chat input.
