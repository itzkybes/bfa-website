# Badger Fantasy Association

A modern web companion for the BFA fantasy basketball league. Pulls every stat,
matchup, roster, and bracket from the [Sleeper](https://sleeper.com) public API,
slices it across every season the league has ever played, and renders it in a
single dark, brand-themed SvelteKit app.

Live on Vercel. No login. No backend. No database.

---

## What's in here

| Route             | What you'll find                                                |
| ----------------- | --------------------------------------------------------------- |
| `/`               | Current-week matchups, "Rando Player" spotlight, recent Trade Ledger |
| `/rosters`        | Every team's starters, bench, and taxi squad — collapsed accordion + per-owner career Hub |
| `/standings`      | Regular-season + playoff records with weekly PF trend sparklines, plus "Regular Season MVP Race" top-5 leaderboard |
| `/matchups`       | **Weekly Recap** — Top 3 Performances, Biggest Blowout, Closest Game, Highest-Scoring Matchup, Bench Burn, Bust of the Week, plus every head-to-head card |
| `/power-rankings` | Rolling 4-week window: Last 4 W-L, avg score, avg margin, score trend, Δ vs prior |
| `/team/[username]`| Per-roster matchup history — every week's opponent and result |
| `/records-team`   | All-time aggregated W/L, biggest blowouts/nailbiters, head-to-head matrix |
| `/records-player` | Regular Season / Playoffs / Finals MVP per season + 4 all-time tables (Best By Team, Playoff Best, Full-Season Best, Playoffs Leaderboard) |
| `/honor-hall`     | Champion + Biggest Loser + three MVPs + final standings 1–14   |
| `/admin/generate-season-matchups` | Regenerate the static `/season_matchups/*.json` snapshots |

### Three different MVPs, three different definitions

The league has three MVP awards per season and they're easy to confuse, so:

- **Regular Season MVP** — top cumulative scorer across the regular season ONLY
  (no playoff points). Surfaces on the Honor Hall page and Records-Player.
- **Playoffs MVP** — top cumulative scorer across just the playoff window,
  filtered to only count rosters that actually made the playoffs (seeds 1–8
  via `leagueMeta.settings.playoff_teams`). So a toilet-bowl scorer can't
  steal this trophy.
- **Finals MVP** — top scorer in the single championship game, counting players
  from **both** finalists. So if you lose the final but drop 60, you still take
  home the trophy.

### The Weekly Recap (`/matchups`)

Every weekly stat that comes out of `recap` reads from one of TWO authoritative
data shapes — and never mixes them:

| Stat                          | Source                                            |
| ----------------------------- | ------------------------------------------------- |
| 🏀 Top 3 Performances         | `starters_points` only (via `starterPointsByPid`) |
| 🥶 Bust of the Week           | `starters_points` only (via `starterPointsByPid`) |
| 🪑 Biggest Bench Burn         | `player_points` minus starters set                |
| 💥 Biggest Blowout            | Per-team `points` total                           |
| 🔥 Closest Game               | Per-team `points` total                           |
| 🎯 Highest-Scoring Matchup    | Per-team `points` total                           |
| 📈 Highest / 📉 Lowest Team   | Per-team `points` total                           |

**Critical:** Top 3 and Bust are STRICTLY starter scoring. `starterPointsByPid`
in `leagueCompute.client.js` returns `null` if a Sleeper matchup entry lacks a
`starters_points` array — the caller skips that team entirely rather than
falling back to `player_points`, which would conflate bench contributions with
starter performance. Sleeper has shipped four different field names over the
years (`starters_points`, `starter_points`, `startersPoints`, `starterPoints`),
all of them handled.

### Owner Hub (rosters page)

Each team card on `/rosters` is a global accordion — only one card can be
expanded at a time, and the multi-column flow re-balances so an open card never
leaves a blank gap next to a still-collapsed neighbor. Expanding a card reveals
the **Owner Hub**: a 10-stat career snapshot built by aggregating
`computeStandingsForLeague()` across every season in the chain, keyed by
`owner_username` so re-themes and avatar swaps don't break continuity:

- Titles 🏆
- Playoff Appearances
- Finals Appearances
- Best Finish (with year)
- Career Wins / Losses / Win %
- Career PF / PA
- Best Season PF (with year)

Plus a "View matchup history →" deep-link to `/team/[username]`.

---

## Architecture (the short version)

```
src/
├── lib/
│   ├── sleeperClient.client.js    Thin wrapper around Sleeper REST endpoints
│   ├── leagueCompute.client.js    Standings, brackets, MVPs, matchup rows + `starterPointsByPid`
│   ├── positions.js               Expand `fantasy_positions` to full slot eligibility (PG→PG,G,UTIL …)
│   ├── dominantColor.js           Optional canvas-based dominant-color extractor (unused at the moment)
│   ├── cache.js                   localStorage cache with TTL
│   ├── vitals.js                  Web Vitals → Vercel Analytics
│   ├── header/Header.svelte       Sticky top nav
│   ├── Sparkline.svelte           SVG sparkline (used on standings + power-rankings)
│   ├── ErrorBoundary.svelte       Friendly error UI with retry
│   └── SkeletonLoader.svelte      Loading skeletons for tables/cards/rows
├── routes/                        One folder per page (+ /admin)
├── app.css                        BFA color tokens + global type/layout
└── app.html                       SvelteKit shell
static/
├── bfa-logo.png                   Brand mark used in header + footer
├── season_matchups/{year}.json    Historical matchup snapshots (2022–2024)
└── week-ranges.json               "Which week are we in right now" calendar
```

### Everything runs in the browser

The first version of this site rendered standings server-side. That blew up on
Vercel because Sleeper's `/players/nba` response is ~5 MB — every page view
became a serverless cold start that timed out reading static files. The fix was
to render every route as a static HTML shell and let the browser fetch from
Sleeper directly. `localStorage` caches the heavy responses so repeat visits
are instant.

In practice that means:

- Every `+page.svelte` does its data fetch in `onMount`.
- Every `+page.js` ships with `ssr = false`, `prerender = false`.
- No `+page.server.js` files anywhere. (Do not add one. It will 500 on Vercel.)

### Logos stay current across seasons

Owners keep the same Sleeper username across seasons, but roster IDs and team
art change every year. So when you look at the 2022 standings, you see each
owner's **current** logo, not the one they had three years ago. That overlay
lives in `getLatestOwnerAvatars()` (in `leagueCompute.client.js`) and runs
once per page load.

### New seasons show up automatically

`getSeasonsChain()` walks the `previous_league_id` chain **backwards** to find
every historical season, then walks **forwards** via Sleeper's
`/user/{user_id}/leagues/nba/{season}` endpoint to pick up new seasons whose
`previous_league_id` chains back to a known league. So when the commissioner
spins up next year's league in Sleeper, every page (standings dropdown,
records, the home page's "current week" matchups, the latest team logos)
flips over with zero code changes. The anchor `BASE_LEAGUE_ID` only needs to
move if the chain itself is ever broken.

You can sanity-check the discovery against the live API with:

```bash
node scripts/test-auto-discovery.mjs
```

---

## Running it locally

```bash
yarn install
yarn dev          # http://localhost:5173
```

You don't need any environment variables. The league ID is baked into
`src/lib/sleeperClient.client.js` — `BASE_LEAGUE_ID` is just the anchor
`getSeasonsChain` starts from; new seasons after it are picked up
automatically via forward-discovery (see above), and historical seasons via
the backwards `previous_league_id` walk. You only need to touch the constant
if the league chain is ever broken (e.g. someone re-creates a season without
linking it back to the previous one).

## Production build

```bash
yarn build        # outputs to .svelte-kit/output
yarn preview      # serve the build locally to sanity-check
```

The Vercel adapter is pinned to `nodejs22.x` (Vercel's current default). Older
versions of `@sveltejs/adapter-vercel` rejected Node 22 — if you ever see
"Unsupported Node.js version" on a deploy, make sure
`@sveltejs/adapter-auto` is **not** in `package.json` (it can pull in a stale
adapter).

## Deploying

Push to GitHub and connect the repo to Vercel. Defaults are fine.

**Important**: `.vercel/output/` and `.svelte-kit/` are git-ignored on
purpose. If they ever land in the repo, Vercel treats `.vercel/output/` as a
precomputed build and skips `yarn build` entirely — so every source change
silently fails to deploy. The `.gitignore` already excludes them; just don't
commit them.

---

## Regenerating historical seasons

Sleeper's per-week matchups endpoint stops returning useful data for old
leagues. To get around that we snapshot the early seasons into static JSON
under `/static/season_matchups/{year}.json`. To regenerate:

1. Run the app locally: `yarn dev`.
2. Open `http://localhost:5173/admin/generate-season-matchups?years=2022,2023,2024`.
3. Click "Copy JSON" for each year, paste into the corresponding file under
   `static/season_matchups/`, commit.

The pages will pick up the new data on the next refresh.

---

## Credits

Built with [SvelteKit 2](https://kit.svelte.dev) + [Svelte 5](https://svelte.dev),
deployed on [Vercel](https://vercel.com), powered by the
[Sleeper API](https://docs.sleeper.app/). NBA headshots via Sleeper's CDN.
Type set in Bebas Neue + Outfit.
