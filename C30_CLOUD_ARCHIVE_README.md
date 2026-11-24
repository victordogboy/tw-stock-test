# C30 雲端永久封存：設定與限制

已在 tw-stock-api Worker 新增 C30Archive SQLite Durable Object，不改動 C30 原版及其他策略引擎。

## 只需要設定一次
1. GitHub main 已提交 C30_ARCHIVE binding 與 r60-c30-private-archive-v1 migration，先確認 Cloudflare Workers Builds 部署成功。
2. Cloudflare Dashboard → Workers & Pages → tw-stock-api → Settings → Variables and Secrets，新增 **Secret**，名稱為 C30_ARCHIVE_SECRET。自行設定至少 16 字元的隨機值；不要貼進 GitHub 或聊天室。
3. 開啟 https://tw-stock-api.victordogboy.workers.dev/c30/archive/ ，輸入相同金鑰並按「連線」。
4. 舊 ZIP、CSV 等歷史資料只需在這頁上傳一次。同一裝置此前保存在 IndexedDB 的 1 分 K，可以按「同步已下載分 K」直接轉雲端，不用向行情供應商重新下載。
5. 往後開啟 /c30/minute/ 先讀雲端股票日期覆蓋率；點選增量更新，只向行情來源取得缺少的股票日。已封存的 1 分 K 可直接從雲端匯出 CSV.gz。

## 保存方式
- 現股 1 分 K 按交易日、股票代碼、分鐘合併去重，富果資料優先於 Yahoo。
- 尚未到台灣時間 16:00 的當日資料不視為完整封存。
- 原始檔以 256 KiB 區塊存到獨立 Durable Object，支援 SHA-256 校驗、重複檔案略過和中斷續傳。
- 原始 ZIP 已封存並不等於原版 C30 引擎已解析它，亦不代表最新交易計畫已產生。
- 本版單一檔案限 350 MiB，安全封存額度約 850 MiB。更大型十年資料庫需 R2（目前未接入）。
- 金鑰未設定，雲端存取會拒絕，不會公開資料。所有訪問均需要私密金鑰。
- 現有網頁只有開啟時檢查或手動增量更新；關閉瀏覽器後不會自行抓取新分 K。

## 完成與尚待驗證
程式已提交 GitHub。模擬儲存測試通過金鑰驗證、同一股票日分批合併、富果優先、檔案分段上傳、完結與雲端查詢。前後端 JavaScript 語法檢查通過。

Cloudflare Secret 與部署需要 Cloudflare 帳戶權限，尚無法在此確認正式環境部署成功；歷史 ZIP 也尚未真的上傳至 Cloudflare。首次導入並驗證後，才能將資料視為實際完成雲端封存。
