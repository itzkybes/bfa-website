# BFA Website — Old vs New File-by-File Summary

> Both versions are the same SvelteKit project at `/app/` powered by the Sleeper API.
> The "New" site is the **fresh modern redesign** ("Performance Pro" theme — Obsidian + Court Orange + Bebas Neue / Outfit) that **replaced** the old site in place.
> All route paths, server-load logic, and static data (`/static/season_matchups/*.json`, `/static/week-ranges.json`, `/static/early2023.json`) were **preserved** — only the UI layer was reimagined.

---

## 1. Project Root

| File | Old Site | New Site |
| --- | --- | --- |
| `package.json` | SvelteKit 2.8 + Svelte 5.2 + Vite 6 + Vercel adapter-auto. Scripts: dev, build, preview, check, lint, format. | **Unchanged.** Same deps, same scripts. |
| `svelte.config.js` | `@sveltejs/adapter-auto`. | **Unchanged.** |
| `vite.config.js` | Vite plugin sveltekit. | **Unchanged.** |
| `jsconfig.json` | Extends `./.svelte-kit/tsconfig.json`. | **Unchanged.** |
| `README.md` | Standard SvelteKit boilerplate. | **Unchanged.** |
| `UPGRADE_SUMMARY.md` | Existing notes file. | **Unchanged.** |
| `frontend/package.json` | _(did not exist)_ | **NEW** — wrapper so the supervisor process which expects `/app/frontend` `yarn start` on port 3000 launches `vite dev` at the project root. |

## 2. `src/app.html`

| Old | New |
| --- | --- |
| Generic title, no SEO meta, no font preconnects. | **Rewritten.** Full meta tags (Title, Description, OG, Twitter Card, JSON-LD `SportsOrganization`), favicons, `theme-color: #0A0A0A`, Google Fonts preconnect & `Bebas Neue + Outfit` (no Inter). |

## 3. `src/app.css`

| Old | New |
| --- | --- |
| Minimal base — used cyan/teal `#00c6d8` + Inter. Generic. | **Rewritten** — full "Performance Pro" design-system: CSS variables for surfaces (`--surface-1..3`), Court Orange `--accent`, semantic colors (`--win`, `--loss`, `--gold`), 10-color basketball-position palette (PG red, SG gold, G orange, SF green, PF blue, F violet, C lavender, UTIL slate, BN dark, TX pink), sharp `--r-sm: 2px` radii, motion tokens, `.btn`, `.pos-pill`, `.bfa-table`, `.headshot`, `.team-avatar`, `.shimmer`, `.rise`, `.eyebrow`, `.skip-link`, custom scrollbars, reduced-motion + print rules. |

## 4. `src/app.d.ts` / `src/hooks.js`

Both **unchanged.** Type declarations and SSR hooks were left as-is.

## 5. `src/lib/` (shared components & utilities)

| File | Old | New |
| --- | --- | --- |
| `header/Header.svelte` | Plain top bar with text links. | **Rewritten.** Sticky translucent header with backdrop-blur, BFA stacked-logo brand, hover-color transitions, **Records dropdown** menu (Team Records / Player Records), active-link underline animation in Court Orange, accessible (aria-current/aria-expanded), responsive hamburger menu with animated bars, click-outside + Esc handling. |
| `cache.js` | **Corrupted** — had literal documentation prefix (`📄 FULL FILE`, `PRIORITY 1`) at top of file that broke the module. | **Rewritten** clean. Same API (`getCached`/`setCache`/`clearCache`/`fetchWithCache`) but minus the corrupted prefix. |
| `SkeletonLoader.svelte` | Generic skeleton shimmer cards (purple/violet tones). | **Rewritten.** Variants: `card`, `team`, `matchup`, `player`, `row`, `text` — all using the new dark surface tokens and the new shimmer animation. |
| `ErrorBoundary.svelte` | Generic red error block. | **Rewritten.** Performance-Pro themed error card with red left-accent border, circular icon badge, smart message detection (network/404/500), Retry + Go Home action buttons with proper `data-testid`s. |
| `LazyImage.svelte` | Existing lazy-image wrapper. | **Unchanged** (utility logic was already good). |
| `actions/clickOutside.js` | Svelte action helper. | **Unchanged.** |
| `form.js` | Form helpers. | **Unchanged.** |
| `vitals.js` | Web Vitals reporter for Vercel Analytics. | **Unchanged.** |
| `server/sleeperClient.js` | Server-only Sleeper API wrapper (rate-limit safe). | **Unchanged** — all the data-fetching logic was already solid. |
| `server/cache.js` | Server-side memo cache (TTL). | **Unchanged.** |

## 6. `src/routes/+layout.svelte`

| Old | New |
| --- | --- |
| Plain header + slot + skeleton footer with default colors. | **Rewritten.** New Header, `<main id="content">` slot with skip-link, fully redesigned 4-column footer: brand block with orange BFA mark + tagline, 3 col groups (League / Records / External) with `data-testid` links pointing to Sleeper docs. Web Vitals call preserved. |

## 7. `src/routes/+page.svelte` (Home)

| Old | New |
| --- | --- |
| **Corrupted** — prefixed with literal text "📄 FULL FILE: src/routes/+page.svelte ✏️ MODIFIED…" that broke the build. Otherwise: Hero, Random Player card, Current-week matchups. | **Rewritten** clean. Distinctive hero with radial-gradient + faint grid overlay, eyebrow "Season 2025 / 26 · Live", giant Bebas Neue title with `Badger Bowl` in Court Orange and orange underline, two CTA buttons. Right-side **"Rando Player" spotlight card** with pulsing orange dot, large player headshot, position pill, owner, Shuffle + View Roster actions. Below: section head "MATCHUPS" + week pill (`W22 · Mar 15 — Mar 21`), grid of matchup cards with winner highlight in `--win` green, staggered rise animation. All powered by live Sleeper API via `/v1/league/{id}/matchups/{week}` with localStorage cache. |

## 8. `src/routes/+page.js`

Both **unchanged.** Page-level config (ssr/prerender flags).

## 9. `src/routes/rosters/`

| File | Old | New |
| --- | --- | --- |
| `+page.server.js` | Server-load: pulls rosters + users + NBA player dict from Sleeper through the previous-league chain. | **Unchanged.** |
| `+page.svelte` | Card grid with default cyan/teal accents, basic position badges, default fonts. | **Rewritten.** Redesigned team-cards grid with the new aesthetic: avatar + Bebas Neue team name + owner, stat pills (Starters / Bench / Taxi counts), collapse/expand button, color-coded position pills (PG/SG/G/SF/PF/F/C/UTIL/BN/TX) with NBA player headshots from Sleeper CDN, three sections per team (Starters / Bench / Taxi Squad). All elements have `data-testid` for testing. |

## 10. `src/routes/standings/`

| File | Old | New |
| --- | --- | --- |
| `+page.server.js` | Builds regular + playoff standings across seasons (PF/PA/W/L/streaks), supports `?season=` query. | **Unchanged.** |
| `+page.svelte` | Default tables with cyan accents. | **Rewritten.** Two blocks (Regular Season + Playoffs) in surface cards, sticky table headers with uppercase 10-pt labels, **rank in giant Bebas Neue Court Orange**, team avatar + team name + owner, tabular-nums for stats. Champion rows highlighted gold with 🏆 + gold left-border. Season select in top-right. |

## 11. `src/routes/matchups/`

| File | Old | New |
| --- | --- | --- |
| `+page.server.js` | Per-season + per-week head-to-head fetcher, supports regular vs playoff weeks, multi-team and BYE rows. | **Unchanged.** |
| `+page.svelte` | Table-style listing with default accents. | **Rewritten.** Vertical list of "match rows" with: team avatar + name + owner on left, score pill (green when winner, accent border on tie), bold orange "VS" divider, mirrored right side. Special states: BYE pill with dashed border; multi-team rollups for >2 participants. Season + Week selects with `<optgroup>` for Regular vs Playoffs. |

## 12. `src/routes/records-team/`

| File | Old | New |
| --- | --- | --- |
| `+page.server.js` | Aggregates W/L/PF/PA across all seasons, computes head-to-head matrix and top-10 largest/smallest victory margins. | **Unchanged.** |
| `+page.svelte` | Big card layout with default styling. | **Rewritten.** Four "blocks": (1) Regular Season Aggregated, (2) Playoff Aggregated with champions pinned + 🏆, (3) Head-to-Head selector card (dropdown filters by team), (4) two side-by-side margin lists — largest (orange `+margin`) and smallest (green tight `margin`) — each row shows rank, both teams with avatars/scores, season + week. |

## 13. `src/routes/records-player/`

| File | Old | New |
| --- | --- | --- |
| `+page.server.js` | Per-season top players, Overall MVP and Finals MVP, all-time best-per-team playoff & full-season leaders. Pulls Sleeper player metadata for headshots. | **Unchanged.** |
| `+page.svelte` | Default-styled tables and small badges. | **Rewritten.** Top "MVP" block split into two large cards side-by-side: **Overall MVP** + **Finals MVP** with big Bebas Neue player name, giant orange points (`xxx.xx PTS`), and team strip (team avatar + name + owner). Two follow-on tables: All-time playoff best (per team), All-time full-season best (per team), with Sleeper headshots, season highlight in Court Orange, points in accent color + display font. |

## 14. `src/routes/honor-hall/`

| File | Old | New |
| --- | --- | --- |
| `+page.server.js` | Runs bracket-sim to derive Final Standings per season; resolves Finals MVP + Overall MVP. | **Unchanged.** |
| `+page.svelte` | Listy layout. | **Rewritten.** "Bento" hero with 4 cards: **Champion** (large, gold-bordered, trophy, team avatar + name + seed) spans 2 rows; **Biggest Loser** (red border, dizzy emoji); **Finals MVP** (orange eyebrow, player headshot, big points); **Overall MVP** (orange eyebrow, points). Below, a **Final Standings** ordered list with rank numerals in Court Orange, gold medal/emojis for top-3, gold-highlighted #1 row, seed pill on right. Season dropdown in head. |

## 15. `src/routes/admin/generate-season-matchups/`

| File | Old | New |
| --- | --- | --- |
| `+page.server.js` | Dev tool: fetches every week from Sleeper for a given season + builds the `season_matchups/<year>.json` shape; **does NOT write** to disk (Vercel is read-only). | **Unchanged.** |
| `+page.svelte` | Plain JSON viewer. | **Rewritten.** Performance-Pro themed: page head explaining purpose, "Messages" block with ordered log list, per-season output blocks with metadata line (`Playoff start: X · Weeks: Y`) + "Copy JSON" primary button (uses Clipboard API with fallback), monospace JSON blob in scrollable container. |

## 16. `static/`

| File | Status | Description |
| --- | --- | --- |
| `bfa-logo.png` | **Unchanged** | League logo used in header + favicon. |
| `early2023.json` | **Unchanged** | Override for first 3 weeks of 2023 season. |
| `week-ranges.json` | **Unchanged** | Calendar mapping week numbers → start/end dates, drives "current week" detection on Home. |
| `season_matchups/2022.json`, `2023.json`, `2024.json` | **Unchanged** | Pre-computed historical Sleeper matchup snapshots for closed seasons. |
| `robots.txt`, `svelte-welcome.webp` | **Unchanged** | Misc static assets. |

---

## Summary of Changes

- **9 files rewritten** for the redesign: `app.html`, `app.css`, `lib/cache.js` *(also bug-fix)*, `lib/header/Header.svelte`, `lib/SkeletonLoader.svelte`, `lib/ErrorBoundary.svelte`, `routes/+layout.svelte`, `routes/+page.svelte` *(also bug-fix)*, plus six `routes/*/+page.svelte` files (rosters, standings, matchups, records-team, records-player, honor-hall, admin/generate-season-matchups).
- **All 8 `+page.server.js`** files left **untouched** → identical Sleeper API behavior.
- **All static data** preserved → existing deep links + historical seasons still resolve.
- **2 bugs fixed**: removed garbage doc prefix from `lib/cache.js` (broke imports) and from `routes/+page.svelte` (broke Svelte parse).
- **1 new wrapper** `/app/frontend/package.json` so the local supervisor (which expects this directory) can launch `vite dev` at the project root on port 3000.
- All routes return **HTTP 200** and the production build succeeds — Vercel-deployable as-is.

Total LOC delta is large (~3,500 new lines of UI code) but the data layer is identical, so behavior + URLs are 1:1 compatible.
