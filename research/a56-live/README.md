# A56 live combined paper account and original dashboard integration

The A56 strategy is available in the original `/r1494a/` strategy selector.
All four existing tabs render the same verified A56 account: holdings and next
session plan; historical performance and yearly/monthly drawdowns; both core
and reversal filled/unfilled orders; complete execution rules and data status.
The account is independent of the C26-only and FC23 portfolio balances.

The frozen baseline is 1,419 trading days through 2026-11-12, 1,759 combined
order records (1,721 core and 38 reversal), including 185 genuinely unfilled
core orders. The 19 paired reversal trades and original A56 NAV match the
previous archive. A separate fill replay independently reconstructs daily
cash, stock quantities and NAV; maximum normalized NAV/cash error is
1.0658141036401503e-14. The dashboard independently repeats this audit in the
browser before displaying data. Conditional B/C candidates are not reported
as submitted-but-unfilled orders.

## Current continuation

The protected original `c26-forward-eod.yml` workflow restores the existing
private, data-only C26 numpy inputs, fetches full-market daily/institutional
data, rebuilds original causal technical/peer features and passes its original
boundary and factor audits. `run_forward.py` reuses these *inputs only*. It
discards all C26-only positions and restores the full A56 combined checkpoint.
Every relevant 69-row input prefix at the A56 anchor is checked against the
recovered original runtime with deterministic fingerprints (three-decimal
numeric normalization; boolean differences remain distinct).

The frozen A56 integrated source hash is
`61a55f45f81e2e94e3833cbca65314d4407d1793d6f749ef55ccf4d9a7630a3f`.
The independent callback bridge was actually checked from an active 2026-11-05
snapshot to 2026-11-12: all 1,419 NAV marks, final internal state, full core
orders and global side histories match exactly. `bridge-parity.json` records
the result and a next-day plan captured before execution inputs are read.

The production workflow then completed continuation through 2026-11-13. It
published one new account day and one core adjustment order, with 1,760 total
combined records. The 2026-11-16 premarket plan is HOLD 2801; no new core or
reversal buy, no active protective stop. Market-warning false does not mean
the existing core position should be liquidated. This remains a stock-based
fractional-share paper model, not an executed stock-futures account.

Premarket plans also explicitly capture the original core opening allocation
phase. `REBALANCE` is a conditional opening operation with target exposure,
single-stock cap, top-up permission and minimum top-up threshold. It is shown
alongside HOLD/BUY/SELL rather than silently omitting potential top-ups or
trims. It never invents fixed shares or prices before the opening print.

`forward.json` includes only derived positions, plans, orders, NAV and audit
results; full licensed daily data, ticks and credentials stay private.
`latest-manifest.json` binds its SHA-256 to the frozen integrated source and
A56 anchor checkpoint. The Worker checks all hashes, calendar coverage,
cash/holdings, factor/account attestation and plan expiry before returning any
current instructions. A stale plan does not erase verified inventory.

## Open-page and manual refresh

Opening A56 in a page session or pressing the existing refresh button POSTs
`/api/c26/a56/refresh`. An isolated object in the existing `SCAN_JOBS` namespace
deduplicates requests and stores progress. No new namespace is created.
The existing protected workflow checks the queue every five minutes and also
retains its 07:30/21:50 Taipei scheduled updates. GitHub scheduling can be
delayed; the UI displays queued/running/completed/failed and the actual data
date instead of promising an immediate calculation.

Only the exact existing GitHub-signed workflow identity can mark begin or
finish. FinMind's existing GitHub secret is used inside that workflow; the
browser Token remains in its original device-only storage. Browser Token
source updates can also enqueue the A56 calculation. Normal status polling
does not repeatedly enqueue jobs. While a job is running, the main dashboard
polls and reloads all four tabs together after the verified files deploy.

Reversal minute execution is loaded only when the frozen account actually
enters its B/C evaluation gate. The private tick source is reconciled to full
daily OHLC and volume, then aggregated into minutes. Unknown or mismatched
data fail the new publication; they are not treated as zero/no-trade bars.
This EOD continuation pipeline is distinct from a continuous intraday broker
order service. Premarket B/C ranges remain conditional until completed live
minutes, available cash and actual execution reports are independently known.

## Reproduce

```sh
python research/a56-live/export_dashboard.py /absolute/path/to/recovered/writable/replay
python research/a56-live/test_forward_bridge.py /absolute/path/to/recovered/writable/replay
# Inside the protected original workflow, after its source rebuild:
python research/a56-live/run_forward.py
node --test tests/a56-*.test.mjs
```

Snapshot assets are immutable history; new `plan_history` entries preserve
previously published post-anchor premarket plans without importing tomorrow's
execution prices. R1494-A and FC23 calculations are unchanged. Baseline
survivorship/universe selection and historical fill-proxy limitations remain.
