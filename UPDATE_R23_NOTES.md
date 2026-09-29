# R23：手機離開瀏覽器後繼續掃描

手機瀏覽器切換 App、鎖定螢幕或關閉分頁時可能停止網頁程式。R23 將完整的兩階段掃描移到 Cloudflare Durable Object 的持久化工作與 alarms；網頁只負責提交、讀取進度與顯示結果。

## 使用

1. 開啟原網址 `/scanner?restore=1`，確認標題為 **V1.17.0-R23｜手機背景掃描**。
2. 選擇掃描依據與條件，按「開始背景掃描」。
3. 等待「伺服器已接收」，即可切換 App、鎖屏或關閉分頁。
4. 在同一瀏覽器重新開啟，會讀取同一工作。也可按「讀取背景進度」。
5. 「停止」會停止伺服器後續批次，不只是停止網頁讀取。

這是按下開始後完成一輪掃描，沒有新增定時重掃或推播通知。背景結果與工作識別碼不跨瀏覽器同步；清除網站資料或使用無痕模式會失去原工作識別碼。伺服器結果自啟動起保留 24 小時；開啟後也沿用原有本機榜單儲存。工作超過 4 小時會停止並顯示失敗，避免無限執行。

## 保留的功能

- Hold 原始變化與 Hold＋預估量變化、四項 Action 權重、最低價與量篩選。
- R22 期貨名單修正與股票期貨的最高價豁免（包含金像電）；不豁免最低量。
- 原本雙 Token、追蹤清單與本機儲存鍵；未清除使用者資料。
- 第二階段正式日K、籌碼、盤中現價重算。各股資料仍可能因來源或額度失敗，保留明細，勿將部分結果視為完整行情。

## 部署

合併此更新到 `main`，使用既有 Cloudflare Workers Builds 執行 `npx wrangler deploy`。本次必須一起部署 `wrangler.jsonc`：入口改為 `src/worker.mjs`，新增 `SCAN_JOBS` SQLite Durable Object 與 `r23-scan-jobs-v1` migration。僅上傳 HTML 不會啟用背景執行。這不需要另設每分鐘 Cron，也沒有新增 D1 資料庫。

部署後在 `/api/health` 確認 `1.17.0-R23`，再用少量候選設定實際啟動一輪，關閉分頁後重新開啟確認進度。Cloudflare 的帳戶配額與上游服務仍會影響完成時間；本機測試不代表正式站已部署。

## 實作與維護

- 每個瀏覽器使用隨機 256 位元識別碼，透過 header 存取獨立工作；不放在 URL。
- 同一瀏覽器同時最多一輪，重送啟動不重複建立；游標與結果在交易中提交，重啟可續跑；停止後舊批次不能回寫。
- 第一階段每批最多 4 檔並行，較重的後段每批 1 檔，避免把全市場塞入單次請求。介面並行值高於 4 時背景階段仍上限 4。
- 目前選用的 FinMind Token 暫存於工作，完成、停止或失敗後刪除，並有 24 小時到期清除。另一組 Token 不傳送。不寫入儲存庫、公開快取回應或工作結果。
- `src/scan-runtime.mjs` 由原有頁面和 V4.4 引擎静態產生；執行 `npm run build:scan` 更新，`npm run test:scan` 檢查同步與回歸。沒有執行期 eval。
- `npm run test:scan:browser` 使用本地 Cloudflare 模擬器及 Playwright 測試關閉手機尺寸頁面後完成、重新取得結果。首次需 `npx playwright install chromium`。
- 官方機制參考：[Durable Objects alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)、[SQLite migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)。

## 本次驗證

已通過 18 項模型、API、持久化工作與既有功能回歸，以及 1 項手機尺寸 Chromium／本地 Cloudflare 模擬器整合測試：提交後關閉分頁、沒有進度輪詢仍掃描完成、重開取回結果與所選排行、追蹤清單保留。`wrangler deploy --dry-run` 打包成功。上游行情在測試中使用固定資料，正式站的全市場掃描仍須部署後驗證。本次尚未部署正式站。
