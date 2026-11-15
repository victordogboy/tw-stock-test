# A56 stage 5: browser signals and causal minute inspection

The frozen A56 strategy is unchanged. Python full-account replay passed for 1419 NAV marks, 38 side orders and 19 closed trades (maximum absolute NAV error 7.105427357601002e-15). Browser opening intents match all 1419 daily proposals; all intents for 116 candidate sessions / 24360 completed minutes match Python exactly.

`public/r1494a/c26/a56/signals.mjs` ports the frozen primitives and adds an atomic `VerifiedMinuteFeed` for timestamped paper observations. The caller must supply reconciled account candidates, rank-slot denominator, budget, NAV and blocks. Time is normalized to Taiwan; feed bars must explicitly use shares. Unknown data, incomplete bars, stale bars, duplicates, gaps, invalid prices and invalid units throw before any monitor advances. Confirmed no-trade minutes require null prices and zero shares. Blocked candidates cannot be unblocked within a session. Reconnect by rebuilding from verified completed minutes in chronological order. Observations do not reserve cash, submit orders or imply fills; the existing account engine remains responsible for cash, holdings, liquidity, actual execution reports, and cross-symbol allocation.

The original A56 history page now computes B/C states from raw historical minute prefixes at the selected clock. It never consumes later bars to derive the visible state. It shows conditional next-minute price ranges and capacity bounds separately from retrospective fills. Missing minute history blocks signal inspection for that symbol. The page still says current live publication is blocked: data end 2026-11-12; fresh A56 continuation account + current verified feeds have not been wired. C26, FC23 and R1494-A remain unchanged.

## Verify

From repository root:

```
node --test tests/a56-signals.test.mjs tests/a56-page.test.mjs
```

To regenerate against the full recovered A48 + A50–A52 + A56 archive, first install its pinned dependencies following the archive README. Run on a writable copy (the research loader writes intermediate CSV files):

```
python3 research/a56-stage5/export_parity.py /absolute/path/to/writable/replay
```

This invokes `verify_historical.py` before exporting the fixture, minute price input and verification record. The fixture contains Python expected intents for regression checks; the public price file excludes those future outcomes. Fixed historical universe and next-minute open fills retain the original backtest limitations. These checks establish equivalence, not independent out-of-sample profitability or real exchange execution.
