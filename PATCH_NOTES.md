# V1.17.0-R7 — Non-JSON / Worker Load Regression Fix

R6 screenshot showed scan aborting with only `non-json`.

## R6 architecture problem found
`/api/chips/hybrid` for one listed stock did 12 weekdays × 3 TWSE reports = up to 36 upstream report fetches inside one Worker request, before FinMind assistance. The first uncached request was unnecessarily heavy and could surface platform/upstream HTML errors instead of JSON.

## R7
- TWSE official hybrid validates only Target date inside a stock request: max 3 market-wide reports.
- These report URLs are edge-cached and reused across stocks.
- FinMind supplies historical depth; same-date TWSE official row overrides FinMind.
- Adds `coverage_days` so completeness shows both category presence and historical depth.
- Chip failure no longer aborts the whole scan.
- non-JSON error now includes HTTP status, endpoint, content-type and response preview.
- Invalidates R6 chips/FinMind cache namespace.

## Preserved
- Stage1 Target invariant
- Yahoo 1m volume protection
- Current/live score pipeline
- Detail post-analysis live refresh
- V4.4 / Action formulas unchanged
