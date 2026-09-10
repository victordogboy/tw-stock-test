# V1.7 D1 + Cron

新增 Cloudflare D1：
- watchlist
- daily_snapshots
- 最新 / 前一交易日快照

新增 API：
- GET /api/watchlist
- POST /api/watchlist/add
- POST /api/watchlist/remove
- POST /api/watchlist/update

新增 Cron：
- `30 10 * * 1-5`
- Cloudflare Cron 是 UTC，因此等於台灣平日 18:30。

新增個股頁：
- ☁ 加入雲端追蹤

重要：
V1.7 先完成永久資料與 Cron 基礎。
目前 Cron server-side `cloudScore()` 是 OHLCV-only 第一版，不應當成正式完整 V4.4。
下一版需要把正式 V4.4 engine 抽成 browser/Worker 共用 module，才能確保每天 D1 儲存分數與個股頁完全一致。
