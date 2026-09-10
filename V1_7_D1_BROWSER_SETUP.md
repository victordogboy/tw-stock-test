# V1.7 Cloudflare D1 + Cron：純瀏覽器設定

這版不需要在公用電腦安裝任何工具，但需要在 Cloudflare Dashboard 建立 D1 並做一次 SQL 初始化。

## 1. 建立 D1
Cloudflare Dashboard → Storage & databases → D1 SQL Database → Create database

名稱：
`tw-stock-db`

建立後進入該資料庫，複製 Database ID。

## 2. GitHub 修改 wrangler.jsonc
打開 repo 的 `wrangler.jsonc`，把：

`PASTE_YOUR_D1_DATABASE_ID_HERE`

換成 Cloudflare 顯示的 Database ID，Commit。

Cloudflare 會自動重新部署，並建立 Worker binding：
`DB`

## 3. 初始化資料表
Cloudflare → D1 → `tw-stock-db` → Console

貼上 `migrations/0001_init.sql` 的全部內容並執行。

會建立：
- watchlist
- daily_snapshots

## 4. Cron
本 repo 已設定：

`30 10 * * 1-5`

Cloudflare Cron 使用 UTC，所以這是台灣時間平日 18:30。

Cron Trigger 會呼叫 Worker 的 `scheduled()`，逐檔更新 D1 追蹤清單。

## 5. 驗證
先開：

`/api/watchlist`

若回：
`{"ok":true,"count":0,"data":[]}`

代表 D1 正常。

然後進 `/detail.html?code=3443`
完成分析後按：
`☁ 加入雲端追蹤`

再開 `/api/watchlist`，應該會看到 3443 與 current snapshot。

## 6. 目前重要限制
Cron 的 server-side snapshot score 目前是 V1.7 cloudScore 第一版，只用 OHLCV，還不是完整 browser V4.4 engine。

原因是正式 V4.4 是目前抽出的瀏覽器 engine；下一版會把正式 V4.4 scoring functions 重構成 Worker/browser 共用模組，讓 Cron 保存的分數與畫面 1:1 完全一致。

所以 V1.7 先建立「永久 D1 + 每日 Cron + today/previous 快照」資料基礎。
