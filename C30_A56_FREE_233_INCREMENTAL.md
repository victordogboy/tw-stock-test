# C30／A56 Free 233-Stock Incremental Archive — 2026-11-25

### Goal

Keep the frozen 233-stock research pool, 2026-11-20 C30 anchor, and original A56/C30 strategy behavior unchanged. Collect free incremental data only; never report a new trading order until the original Python engine and account memory have replayed, reconciled, and signed it.

### Official/public/free sources

- TWSE/TPEx EOD official OHLCV: bulk-fetch then retain **only** pool.json (189 listed, 44 OTC); persist in the shared Cloudflare Durable Object on the existing 22:00 Asia/Taipei cron (14:00 UTC). The existing cron has additional runs; before 20:00, today's dataset is not marked final.
- FinMind Free `TaiwanStockTradingDate`: calendar. One request, private browser bearer token, cached by actual trading date.
- `TaiwanStockPrice`: per-stock `data_id` fallback when official dates/symbols are missing, including the missed first days after 2026-11-20.
- `TaiwanStockInstitutionalInvestorsBuySell`, `TaiwanStockMarginPurchaseShortSale`, `TaiwanStockSecuritiesLending`: **one `data_id` per fixed symbol per dataset**. Date-range requests cover up to 32 calendar days and write a stock/date/dataset index. API pacing: an atomic 8-second minimum gap per token-controlled namespace (~450 requests/hour), below FinMind Free's 600/hour for registered users; other independent usage of the same token may still exhaust the quota.
- Stock minute OHLCV: Fugle basic or Yahoo, via `/c30/minute/`, persist to the same Free namespace if a FinMind Free token is present. Fugle/Yahoo API credentials stay in the browser/HTTPS request, not in GitHub.

### Reopening the page

1. Open `/r1494a/?strategy=C30` (or select A56) and use the existing FinMind Free token field.
2. The dashboard reads `GET /api/c30/free/status` first. No historical zip or minute history is fetched from FinMind on page open.
3. Press **Free 更新 233 檔 C30/A56 資料**. Date/symbol/dataset tasks are created only for missing combinations. As each data_id completes, the DO persists it. A user can press the Stop button, reopen, and resume with no redundant requests. Some symbols have no lending/institutional data; those are recorded as `empty_checked`, *not* proof of a verified zero.
4. Go to the **規則與資料** tab to see daily counts by dataset, or use **下載已封存 Free 增量資料** to export authenticated `.ndjson.gz` data for the original Python engine (not an order/replay output).
5. Full minute data from the Free vault can be read through `GET /api/c30/free/day?date=YYYY-MM-DD&dataset=minute&code=2330`. Raw EOD/chip inputs: `GET /api/c30/free/day?date=YYYY-MM-DD`.

### Data boundaries and security

- All FinMind source requests for stocks **include `data_id`**. The older paid/bulk `/api/c30/daily/` path is retained for compatibility but not called by C30/A56's new Free update button.
- Private cloud namespace is based on the SHA-256 of the browser-supplied token; the token itself is not stored in GitHub or Cloudflare. Changing token means a different private namespace until migrated; earlier data is not erased.
- Daily cached source data is encrypted in transit and requires bearer auth to read; raw quote distribution or broker order submission is not implemented. The EOD market data collected under official market open-data terms is a separate global DO namespace.
- The original research history remains mounted/archived separately and is **not** downloaded or rewritten by this source collector.
- When the browser is closed, the Cloudflare cron can continue **official daily prices only**; private FinMind chips cannot run unattended without separately and explicitly configuring server-side credentials. This version does not store or require a server-side personal FinMind token.
- The original A56 C26 full-market Actions workflow remains independently available. The Free button will not enqueue the old full-market Sponsor workflow. Free 233-stock data alone is **not equivalent** to the complete original dynamic-market reference features, account-state checkpoint, side trades, or tick-replay fills.
- The C30 original Python engine was not deployed to Worker or invoked for dates after 2026-11-20. `replay_gate.model_replayed=false` and `plan_ready=false`, regardless of data coverage; new orders are not fabricated.

### Test checks

- Local Node unit tests for DO storage: 230 listed EOD rows, price date index, distinct per-stock institutional/lending rows and zero-result handling, two 1-minute batches merged without overlap.
- Mocked HTTP tests: FinMind `TaiwanStockTradingDate` is the *only* non-data_id dataset; one chip data_id query and one price data_id query; subsequent repeated chip query returns `cached:true` with no additional FinMind call.
- All changed JavaScript modules statically parsed. No Cloudflare production API connection or actual token-bound FinMind download was possible in the authoring environment; operator must verify the live deployment and coverage.