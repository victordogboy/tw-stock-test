# C30 / A56 — 每秒一次、FinMind Sponsor（S）保留、全部已封存資料 ZIP

更新日期：2026-11-25

## 操作網址

- C30 原版： https://tw-stock-api.victordogboy.workers.dev/r1494a/?strategy=C30
- A56 原版： https://tw-stock-api.victordogboy.workers.dev/r1494a/?strategy=A56
- Fugle / Yahoo 免 Sponsor 分 K： https://tw-stock-api.victordogboy.workers.dev/c30/minute/
- 原始十年 ZIP 獨立封存（使用不同 Secret）： https://tw-stock-api.victordogboy.workers.dev/c30/archive/

## 下載節流改版

- **Free**：預設每 **1 秒**一筆，允許 1～30 秒（以 0.5 秒調整）。
- **Sponsor（S）**：預設每 **0.1 秒**一筆，可選 0.05～30 秒（以 0.05 秒調整）。不同模式各自記住設定；0.1 秒是理想請求間隔，不代表伺服器保證能達每秒 10 筆。
- 請求採逐筆循序發送，回應延遲會降低實際吞吐率；Sponsor 官方為 6,000 次／小時，短時間 0.1 秒補檔不等於能持續以此速度運作。
- **Free**：1 秒只是請求間隔，絕不是每小時無限量。網站每 Token 以一小時滾動視窗保守封頂 **540 次／小時**（FinMind 公告註冊會員上限 600 次／小時）。觸頂就停止本輪，保留已封存資料及錯誤，下次按同一按鈕續傳；不會每秒持續撞額度。
- **Sponsor（S）**：以每 Token **5,600 次／小時**作保守滾動額度；0.1 秒在數學上相當於每小時 36,000 次，但只可短時間運行，接近 5,600 次會停止並等待時窗恢復。會員等級由 FinMind 驗證；沒有 Sponsor 權限時仍走 Free。
- 滾動上限只統計這個 C30/A56 共用雲端更新器已呼叫的 FinMind；同 Token 在其他 App 或網站的使用不包含。實際 API 出現 402、429 額度／次數問題，會暫停或等待，不會刪資料。
- 多個分頁使用同一 Token 的 server-side Durable Object 以交易式保留請求時段及時段用量，避免局部併發衝破上限。

## 市場廣度需要完整收盤價（2026-11-25 修正）

「交易股池 233 檔」與「計算廣度的上市＋上櫃市場母體」是兩組不同資料：

- Sponsor（S）對 `TaiwanStockPrice` 送 `dataset=TaiwanStockPrice&start_date=YYYY-MM-DD`，不帶 `data_id`，單次取得該交易日整個市場股票日 K。這項權限 Backer 就有，不必 Sponsor Pro。
- **同一 API 回應產生兩種封存**：一份完整保留當日所有市場原始 OHLCV（含 ETF、興櫃等，須在廣度計算時按當日有效上市/上櫃普通股名單過濾）；另一份按固定 233 檔篩選供 C30/A56 交易引擎。
- 市場完整資料在私人雲端依日期以 180 筆分段保存，最後寫入該日 manifest 以防部分寫入誤認為成功；按 Token 分隔並可透過 `GET /api/c30/free/market-day?date=YYYY-MM-DD` 讀取。
- Sponsor 過去只存 233 檔的日期會**另外補一次全市場日 K**，後續直接跳過已保存的全市場日期。
- 完整 ZIP 現在將有存的全市場原始資料新增為 `kind=full_market_daily_OHLCV` 的逐日 NDJSON 記錄，並在 `manifest.json` 顯示 `all_market_daily_rows`。
- 原 C30 封存 `B` 廣度屬於原引擎已用指標，**不擅自換成新計算的全市場 MA20/ADV 廣度**。應先從原始 `features_cache.npz` 與歷史全市場行情對照公式、母體、日期與可能排除條件，再做不看未來的逐日延伸。
- 2026/11/23 以前的歷史市場資料在既有十年封存中，不會被網頁目前這個自 11/23 起的增量 API 自動搬入。長均線廣度需要過去 20/60/120 個以上交易日作暖機；不能只拿更新的 2～3 天算長均線。

## 資料來源

固定原版 **233 檔**，不下載新成分、不變動選股及回測規則。

- **Free 模式**：TWSE/TPEx 官方收盤日 K（排程盡量保存）、FinMind Free 指定 data_id 的個股日 K 缺漏回補及三大法人、融資融券、借券；Fugle/Yahoo 補現股 1 分 K。
- **Sponsor（S）模式**：額外支援 FinMind 指定交易日、不帶 data_id 的整市場日 K／籌碼批次查詢，伺服器只篩選並存 233 檔。現股 1 分 K 走 FinMind TaiwanStockKBar，每檔、每天回補，優先於先前 Yahoo/Fugle 保存的 K 棒。
- 成功的來源按日期／股票／資料類別存在 Cloudflare SCAN_JOBS Durable Object，重新開網頁只查缺口，不重抓同一筆。Stock KBar 成交量單位以股儲存，不等於股期合約。
- FinMind Token 只由本機瀏覽器發送、不寫 GitHub/Cloudflare Secret，故關閉網頁時只有公開交易所日 K 排程可能繼續更新，FinMind 個人 API 不會自動在雲端背景消耗。

## 「下載全部已封存的 233 檔資料（ZIP）」

在 C30 或 A56 共用監控台的 FinMind Token 區：

1. 勾選 **ZIP 包含所有雲端現股 1 分 K**（預設勾選）。
2. 預設勾選 **「匯出前同步本機舊分 K」**：自動檢查同一瀏覽器 IndexedDB，將尚未封存的 2026/11/23 起分 K 直接同步到 Cloudflare，不再向 Fugle/Yahoo/FinMind 重新下載。若資料未通過校驗，匯出會中止而非默默遺漏。
3. 若要將**原先十年 ZIP／CSV 等資料**一併合併進本次 ZIP，使用「可選擇原本十年歷史 ZIP／CSV 一併打包」選擇本機舊檔。尚未上傳到同一資料庫的舊 ZIP 無法憑空自動取回。
4. 按 **下載全部已封存的 233 檔資料（ZIP）**。系統只讀取 Cloudflare 已有資料，不重新向 FinMind 下行情請求。
5. ZIP 內容：
   - `manifest.json`：已存交易日、233 股池、各類資料覆蓋率與來源說明。
   - `missing.csv`：每日 × 每檔 × 每種資料的尚未取得清單；不捏造數值。
   - `universe_233.json`：固定 233 股池。
   - `day_YYYY-MM-DD.ndjson.gz`：每個已存日 K／籌碼／現股分 K，含原始資料與來源。
   - `C30_original_frozen_model_history.b64`：截至 2026-11-20 的 C30 模型歷史摘要（非完整原始十年資料庫）。
   - `legacy_XX_*.zip` 等：使用者自己勾選加入的舊封存原始檔。
6. 支援桌面 Chrome 系列的原生串流另存 ZIP；其餘瀏覽器使用本機下載。ZIP32 單檔約 4 GiB 上限、無原生串流的瀏覽器限約 350 MiB 防止手機記憶體耗盡，過大時需改分批下載。

**完整資料的定義**：當前 FinMind Token 對應 C30/A56 雲端快取中真正已存的資料 + 使用者可選的本機歷史檔。先前在另一個 Cloudflare C30_ARCHIVE Secret 備份庫保存的 ZIP，需先另外下載後再選入；無法自動跨授權資料庫取用。

## 未完成

- **沒有**重新部署與驗證 C30/A56 Python 原始交易引擎；新增日 K／籌碼／分 K 只是原始回測輸入，不代表買賣計畫已重算。
- **沒有**拿使用者真實 Token 做全 233 檔更新或確認 Workers Builds 正式部署成功。務必以實際頁面的資料日期／缺漏清單及 Cloudflare 部署紀錄確認。
- 歷史上市櫃／股期資格仍是原版固定研究池的假設，不應將 static 233 pool 宣稱歷史每一天都當時有股期。
