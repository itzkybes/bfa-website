# Scripts

## Regenerate season matchup files

The generator writes one compact JSON file per Sleeper season:
`static/season_matchups/{year}.json`. It discovers historical seasons through
`previous_league_id` and future seasons through the league members' Sleeper
user-leagues lists.

Run locally with Node 20+:

```bash
node scripts/regenerate-season-matchups.mjs
```

Pass season years to update only selected files:

```bash
node scripts/regenerate-season-matchups.mjs 2025 2026
```

The GitHub Actions workflow **Sync season matchup files** also runs weekly and
can be started manually from the Actions tab. It commits only changed files in
`static/season_matchups/`.

Each matchup stores the team/owner labels, roster ID, starter player IDs, and
the corresponding `starters_points` values. Player-level records use those
starter arrays. Team totals use Sleeper's `custom_points` when present, then
Sleeper's `points` total based on league settings; only missing team totals are
reconstructed from aligned starter points. Existing `teamAScore`/`teamBScore`
values remain explicit historical overrides unless a specific week is refreshed.
Newly generated team totals carry a `teamAScoreSource`/`teamBScoreSource`
marker (`sleeper_custom_points`, `sleeper_points`, or `starter_fallback`).
Scheduled weekly syncs refresh those generated totals when Sleeper posts a
correction; unmarked/legacy totals are preserved as manual overrides.

Refresh one completed week without touching the other weeks:

```bash
node scripts/regenerate-season-matchups.mjs --week 2026 5
```

Add `--refresh-scores` to replace that week's saved team totals with the
latest Sleeper `custom_points`/`points` values. The **Sync season matchup files**
workflow also supports selecting comma-separated years for a full team-score refresh or a single year/week.

Refresh complete seasons and replace all saved team totals with the API values (use this deliberately when recalibrating historical totals):

```bash
node scripts/regenerate-season-matchups.mjs --refresh-scores 2022 2023 2024 2025
```

The scheduled weekly run uses the same `custom_points` → `points` → aligned starter fallback logic for the latest completed week. The 2023 weeks 1–3 BFA historical score corrections are stored directly in `static/season_matchups/2023.json` with `bfa_historical_override` source markers; there is no separate early-2023 scoring file.
