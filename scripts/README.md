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

Refresh one completed week without touching the other weeks:

```bash
node scripts/regenerate-season-matchups.mjs --week 2026 5
```

Add `--refresh-scores` to replace that week's saved team totals with the
latest Sleeper `custom_points`/`points` values. The **Sync season matchup files**
workflow also supports selecting a year and week manually from GitHub Actions.
