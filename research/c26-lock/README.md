# C26 LOCK — verified historical Python engine (2026-11-12)

The user-supplied `C26_LOCK_完整資料程式重播_20261112.zip` is the authoritative **frozen** C26 research artifact. This repository preserves its original Python simulator and exact parameters without modification. Do not confuse this with the existing JavaScript FC23 engine, or the R1494-A engine.

## Reproducible local full replay

1. Obtain the original full C26 ZIP (133,643,285 bytes) provided by the strategy author; its SHA manifest is in `MANIFEST_SHA256.json`. The original 133MB FC23 source ZIP remains embedded in this package and is **not** committed to GitHub because repository-file limits and Cloudflare static-asset weight make that inappropriate.
2. Extract C26 full ZIP retaining its original directory layout under a temporary directory.
3. Run `python replay/bootstrap_assets.py` from that extracted directory, then `python replay/replay_c26.py` there. Original installer requires compatible Linux `/mnt/data`, numpy and pandas.
4. Confirm **+1,720.495844396837% cumulative net return**, **−17.989769234703846% MDD**, 1407 days, 1758 orders, 539 filled buys, 1028 filled sells, 191 unfilled buys, 309 new buys. It independently reconstructs daily cash and position ledgers.
5. Both frozen source files in this repository are byte-locked via `C26_SIMULATOR_FROZEN.py` SHA-256 `741862f102438f8f10fcf40cf2f9b47edb8fece004e0175ae3f1be7e94bd4ad5`.

## Website status

- Existing original site `/r1494a/`, original FC23 `/r1494a/fc23/`, new third strategy `/r1494a/c26/` are separate.
- C26's 1407 historical NAV points and 1758 original order rows are now published under `/r1494a/c26/data/`, compressed and SHA-256 checked by the browser before display. The site does not need another manual ZIP upload to show the past.
- The website's historical archive is **2021-01-06 through 2026-10-27 only**, regardless of current date.
- **NOT LIVE C26**: original Python code does not run in Cloudflare Workers JS. Latest fully validated C26 feature matrices, current asset prices and chip data, daily EOD continuation, next-day precommit/fill logic, and day-by-day replay parity beyond 2026-10-27 are not yet integrated. Therefore no C26 live positions or next-day orders are published.
- Cost is **0.5855% total round-trip including slippage** (buy 0.14275%, sell 0.44275%); loss cooldown 26 trading days; correlation Pearson 40-day threshold 0.60, existing peer position cap 30%; 16% stock target; max eight stocks; first new order >= NT$10,000. Periodic rebalancing is disabled.
- All C26 research is still in-sample with a backfilled 2026 stock-futures universe, fractional-share stock OHLC fills and no validated post-October 27 future data.

## Safe next-stage production integration requirements

A hosted Python service (or bit-exact JS port) must execute the **same** source and support incremental updates of *all* required features, prior position inventory, transactions, and verified end-of-day stock data. Before enabling plan display: rerun exact historical 1407-day parity plus independent forward-day snapshots, match every eligible order against the frozen engine, and prevent signal release on any missing input. Never backfill current model positions using old October positions, never substitute FC23/R1494 orders, and never silently release partial data as if verified.

CI `tests/c26-frozen-lock-parity.test.mjs` checks raw source hash and public immutable historical assets. It does **not** claim forward live signal parity or authorize broker orders.
