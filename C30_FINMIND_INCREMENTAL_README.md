# C30 原版 FinMind 增量更新與雲端封存（2026-11-25）

C30 和 A56/C26 在同一頁：`/r1494a/?strategy=C30`。

## 使用方式

1. 選 C30 原版。
2. 在原共用 FinMind Token 欄位貼上 Token，按「儲存到此瀏覽器」。原本已保存的 Token 直接沿用。
3. 在共用 Token 區按「使用 Token 更新 C30 資料」，或者按主畫面的「重新讀取最新資料」。
4. 網頁先查 Cloudflare Durable Object 已保存的交易日與資料類型，從 **2026-11-23** 起，只抓未完整保存的日期及資料集。
5. 更新完成顯示「雲端已儲存天數、最新日K日、四類資料完整日數」，並保留失敗項目，重新開頁仍可讀取。
6. 下次進頁只從私人雲端讀取狀態；已成功保存的資料不會重新向 FinMind 下載。

## 儲存資料

- `TaiwanStockPrice`：233 檔現股日 K。
- `TaiwanStockInstitutionalInvestorsBuySell`：三大法人。
- `TaiwanStockMarginPurchaseShortSale`：融資融券。
- `TaiwanStockSecuritiesLending`：借券。
- `TaiwanStockTradingDate`：交易日清單，另行快取。
- 每個交易日/每個資料類別獨立保存，不因其他資料集失敗而丟掉成功資料。
- 從雲端讀取：`GET /api/c30/daily/status`；取原始已存資料：`GET /api/c30/daily/day?date=YYYY-MM-DD&dataset=...`。
- API 使用 `Authorization: Bearer <你的本機 Token>`，Token **不寫入 GitHub、不保存於伺服器**。Cloudflare 儲存命名空間以 Token SHA-256 指紋隔離，因此若更換為不同 Token，舊快取不能直接從新 Token 讀取，需進行資料轉移；不要誤以為舊資料被刪除。

## 已知限制與正確標示

- FinMind **免費** Token 只讀其帳號方案允許的日線、籌碼；`TaiwanStockKBar` 1 分 K 需要 Sponsor，C30 分 K 仍使用 Fugle/Yahoo 下載器 `/c30/minute/`。
- 每日盤後資料需台北時間 20:00 後才可視為當日最終批次；無法保證全部資料集於該時刻即已發布。資料不足時不標記為完整。
- **C30 原版回測已封存至 2026-11-20**，已下載的日K/籌碼是原始資料，**尚未執行 11/23 起的原 Python 引擎逐日重播**，不得展示為今天的持股、正式買賣或已成交。
- 網頁重新開啟或按重新讀取可以自行補資料；關閉瀏覽器後不會使用本機 Token 背景抓 FinMind。若要無人值守排程需另外安全配置服務端授權與執行環境。
- C30 每日 Token 快取存在 `SCAN_JOBS` 的私人 Durable Object，**不需要另行設定** `C30_ARCHIVE_SECRET`。之前的 `/c30/archive/` 是另一個可上傳原始 ZIP 的封存庫，設定和使用方式不同。
- Cloudflare 免費儲存配額及 FinMind 免費 API 的流量、資料權限仍然適用。

## 測試

後端單元模擬：233 筆價格寫入、日期索引、讀回同樣 233 筆、交易日快取，均通過。

前端增量模擬：首輪僅缺借券，成功只請求借券；第二輪缺口為 0 時，**不再呼叫 FinMind refresh**，均通過。

GitHub 已提交代碼；正式 Cloudflare 部署與你的個人 Token 真正更新結果，仍需以線上頁面的連線和資料筆數驗證。