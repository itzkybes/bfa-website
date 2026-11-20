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
the corresponding `starters_points` values. Ordinary team totals are calculated
from those starter points by the site. Existing `teamAScore`/`teamBScore`
values are retained as explicit historical overrides when regenerating files.
