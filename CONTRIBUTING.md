# Contributing & Yearly Migration Runbook

This document covers everything you need to do when the BFA league rolls
over to a new season, plus general guidelines for adding features.

If you're just hacking on a feature, start at [Development setup](#development-setup).
If you're closing out a season, go straight to [Yearly migration](#yearly-migration).

---

## Yearly migration

When a season ends in Sleeper, the league enters `status: complete` and the
final brackets are locked. At that point the site automatically keeps reading
from the live Sleeper API for that season — which is fine but a) costs 22+
API calls every time someone loads `/standings` or `/honor-hall`, and b)
loses commissioner manual overrides if Sleeper ever resyncs the data.

The yearly migration freezes the season into a static JSON snapshot so:
- All pages load instantly (single ~165KB fetch instead of 22 API roundtrips).
- Commish manual overrides (`custom_points`) are preserved forever.
- The merged 2-week championship pairing is stitched together correctly
  (Sleeper drops `matchup_id` for the second half of the final — the
  regen script synthesizes the pairing from the first half).

### Step-by-step

```bash
# 1. Pull the latest main branch
git checkout main && git pull

# 2. Make sure deps are installed
yarn install

# 3. Regenerate the snapshot(s) for the completed season(s)
node scripts/regenerate-season-matchups.mjs
#  -- this defaults to "every completed season in the chain"
#  -- pass year(s) to target one explicitly:
#     node scripts/regenerate-season-matchups.mjs 2026

# 4. Verify the output looks sane
ls -lh static/season_matchups/*.json
node -e "const f=require('./static/season_matchups/2026.json');console.log('weeks:',Object.keys(f).filter(k=>k!=='playoff_week_start'&&k!=='playoff_week_end').length,'overrides:',Object.values(f).flat().filter(m=>m&&m.teamA&&(m.teamA.custom_points!=null||m.teamB.custom_points!=null)).length)"

# 5. Sanity-check the live preview
yarn dev
# Open http://localhost:5173/standings, switch to the new season, eyeball PF.
# Open http://localhost:5173/matchups, navigate week-by-week.

# 6. Commit and push
git checkout -b chore/freeze-2026
git add static/season_matchups/2026.json
git commit -m "chore: freeze 2026 season into static snapshot"
git push -u origin chore/freeze-2026
# Open a PR, merge, and Vercel will deploy automatically.
```

### Validating the freeze

The regen script prints a summary per season:

```
→ 2026  (league 1521340000000000000)
  ✓ wrote /app/static/season_matchups/2026.json
    weeks=24  matchups=165  commish_overrides=N  finals_synthesized=12  size=177KB
```

Check that:
- `weeks` covers the entire regular season plus all 4 playoff weeks
  (typically 24 for years where playoffs start at W21, 23 for W20).
- `commish_overrides` matches the number of manual scores you've set as
  commissioner during the season (use Sleeper's "Edit Matchup" history).
- `finals_synthesized = 12` (12 = 6 matchups × 2 rosters) when Sleeper's
  `playoff_round_type === 0` (2-week finals not flagged in Sleeper) — that
  means the regen script paired up the second-half-of-finals entries the
  league played but Sleeper didn't pair itself. `0` means Sleeper already
  paired them (`playoff_round_type === 1` or 2).

### When NOT to regenerate

- **During an active season.** The regen script intentionally **skips**
  seasons with `status !== 'complete'` by default. If you manually force
  it (passing the year as an argument), the snapshot will freeze partial
  data and the site will show stale scores until you re-run.
- **If Sleeper hasn't recorded the final yet.** Wait until the bracket's
  championship matchup has a `w` (winner) field — otherwise the Honor Hall
  fallback to `HARDCODED_CHAMPIONS` kicks in instead of bracket data.

### The playoff window

The league plays **4 playoff weeks** every season, with the LAST 2 weeks
merged into one championship matchup:

| Season | Regular Season | Quarter / Round 1 | Semi / Round 2 | Final (2-week merged) |
| ------ | -------------- | ----------------- | -------------- | --------------------- |
| 2022   | W1 – W19       | W20               | W21            | **W22 + W23**         |
| 2023   | W1 – W20       | W21               | W22            | **W23 + W24**         |
| 2024   | W1 – W20       | W21               | W22            | **W23 + W24**         |
| 2025   | W1 – W19       | W20               | W21            | **W22 + W23**         |
| 2026+  | W1 – W19       | W20               | W21            | **W22 + W23**         |

The regen script encodes this rule as `playoff_week_end = playoff_week_start + 3`.
`computeStandingsForLeague()` reads `playoff_week_end` from the JSON when
present and falls back to the same `+3` formula for in-progress seasons.

### How the merged final is accounted

The merged 2-week final has implications across the site:

| Metric              | Behaviour for the 2-week final                                     |
| ------------------- | ------------------------------------------------------------------ |
| Win / Loss          | **1 per finalist** (combined-score result). `computeStandingsForLeague` rolls back the per-week W/L it pushed for both halves and replaces them with the merged outcome. |
| Playoff PF / PA     | Sum of both weeks (correct — both weeks' scores count toward final game). |
| Best Playoff Game   | Per-starter highest across both weeks. Each starter performance is per-week. |
| Honor Hall champion | Whoever has the higher COMBINED score in the championship matchup. |

---

## Adding a new season-matchup data field

If you need to add another field to the static JSON (say, a draft pick
breakdown or per-week notes):

1. Update `scripts/regenerate-season-matchups.mjs` to write the field.
2. Update `src/lib/leagueCompute.client.js` — specifically the synthesizer
   in `computeStandingsForLeague` and the static-path branch in
   `computeMatchupsForLeagueWeek` — to read the field.
3. Update `src/routes/admin/generate-season-matchups/+page.svelte` to
   include the same field so UI-driven regens stay consistent.
4. Re-run the script for all years so existing JSONs include the new field.

---

## Development setup

```bash
yarn install
yarn dev          # http://localhost:5173
```

No env vars needed. The league ID is baked into `BASE_LEAGUE_ID` in
`src/lib/sleeperClient.client.js`. Hot reload works on save.

### Don't add `+page.server.js`

This site is 100% client-rendered. Adding `+page.server.js` will 500 on
Vercel deploy because Sleeper's `/players/nba` payload (~5MB) exceeds
serverless function limits.

### Don't read `player_points`

By project policy, per-player scoring **only** comes from `starters_points`.
Our league uses Sleeper's manual game-selection mechanic — the selected
game's score is natively baked into `starters_points`, while `player_points`
includes raw unselected games and would corrupt stats for anyone using
manual selection. See `computeParticipantPoints()` in `leagueCompute.client.js`
for the canonical precedence: `custom_points → starters_points → points`.

### Data-testid convention

Every interactive element and every element showing critical user-facing
info **must** have a unique `data-testid`. Naming: kebab-case, describes
function not style. Example:

```svelte
<button data-testid="rosters-team-select" on:click={...}>Pick team</button>
```

---

## Pull request checklist

- [ ] `yarn build` runs clean locally (`✔ done · Using @sveltejs/adapter-vercel`).
- [ ] No `+page.server.js` was added.
- [ ] No `player_points` reads anywhere (`grep -r "player_points\|players_points" src/`).
- [ ] If touching scoring logic, the precedence is `custom_points → starters_points → points`.
- [ ] New interactive elements have `data-testid` attributes.
- [ ] If adding a new route, it's also linked from the footer in `src/routes/+layout.svelte`.
- [ ] README updated if any user-visible behaviour changed.
