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
| `/`               | Current-week matchups, "Rando Player" spotlight, league header  |
| `/rosters`        | Every team's starters, bench, and taxi squad with headshots     |
| `/standings`      | Regular-season and playoff records, switchable by season        |
| `/matchups`       | Week-by-week head-to-head results with full starter scoring     |
| `/records-team`   | All-time aggregated W/L, biggest blowouts, head-to-head matrix  |
| `/records-player` | Per-season Overall / Playoffs / Finals MVP + single-season best |
| `/honor-hall`     | Champion + Biggest Loser + three MVPs + final standings 1-14    |
| `/admin/generate-season-matchups` | Regenerate the static `/season_matchups/*.json` snapshots |

### Three different MVPs, three different definitions

The league has three MVP awards per season and they're easy to confuse, so:

- **Overall MVP** — top cumulative scorer across the whole season (regular + playoffs).
- **Playoffs MVP** — top cumulative scorer across just the playoff window (3 weeks).
- **Finals MVP** — top scorer in the single championship game, counting players
  from **both** finalists. So if you lose the final but drop 60, you still take
  home the trophy.

---

## Architecture (the short version)

```
src/
├── lib/
│   ├── sleeperClient.client.js    Thin wrapper around Sleeper REST endpoints
│   ├── leagueCompute.client.js    Standings, brackets, MVPs, matchup rows
│   ├── cache.js                   localStorage cache with TTL
│   ├── vitals.js                  Web Vitals → Vercel Analytics
│   ├── header/Header.svelte       Sticky top nav
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

---

## Running it locally

```bash
yarn install
yarn dev          # http://localhost:5173
```

You don't need any environment variables. The league ID is baked into
`src/lib/sleeperClient.client.js` — change `BASE_LEAGUE_ID` to point at a
different Sleeper league and everything else follows.

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
