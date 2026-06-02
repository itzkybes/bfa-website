# Scripts

Manual sanity-check helpers. Not run in CI — invoke them by hand when touching
the core data layer.

## `test-auto-discovery.mjs`

Runs the full bidirectional season-discovery logic against the **live Sleeper
API** and prints the discovered seasons.

```bash
node scripts/test-auto-discovery.mjs
```

Expected output (as of Feb 2026):

```
Discovered 5 season(s):

  2022  → 851213309523931136   (The Badger Bowl)
  2023  → 984892318991929344   (The Badger Bowl)
  2024  → 1081206702122377216  (The Badger Bowl)
  2025  → 1219816671624048640  (The Badger Bowl)
  2026  → 1344133146307739648  (The Badger Bowl)

Sanity:
  2025 present?  true
  2026 present?  true  ← forward-discovery result
```

The script exits non-zero if 2026 isn't discovered — useful as a smoke test
after editing `src/lib/sleeperClient.client.js`.
