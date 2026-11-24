# C30/A56 Sponsor S 資料失敗診斷與修正（2026-11-25）

## 問題來源
1. 共用儀表板的 `decorateStrategy()` 使用 `#annual thead`、`#monthly thead` 等不存在的 selector（實際 `annual`、`monthly` 是 `tbody`），造成 `Cannot read properties of null (reading 'innerHTML')`；已改用 `tbody.closest('table').querySelector('thead')`，對不存在的節點安全略過。
2. FinMind Sponsor 單日全市場批次與 `TaiwanStockKBar` 依官方文件需要 `start_date`（單日 KBar 同時需要 `data_id`），舊程式多傳了次一交易日的 `end_date`。已修改 Sponsor 專用單日查詢；Free 逐檔多日查詢仍保留日期範圍。
3. 之前所有失敗只顯示累計次數，無法知道上游 HTTP、schema、權限或分鐘資料驗證哪個環節失敗。新增來源錯誤編碼、HTTP 狀態、最近 30 筆錯誤本機保存，停掉同類錯誤連續 3 次的無效請求。
4. 上游 402/429 視為額度或限流，立即停止並保留已存雲端內容。Sponsor 401/403/400 不再自行改稱 Free 成功，應先以診斷區確認 API 直接回傳原因。

## 使用步驟

- 開啟 `/r1494a/?strategy=C30`，FinMind Token 區選 `Sponsor（S）`。
- 按 `測試 Sponsor 日K＋分K（最多2筆）`：使用本機記住的 Token，各測一次 `TaiwanStockPrice` 整日、`TaiwanStockKBar` 台積電 2330 分 K。
- 看畫面上的資料筆數、HTTP 狀態與錯誤。測試正常再按「更新 233 檔」，並沿用雲端已成功的日期。**不可用單純 UI 選 Sponsor 推論 API 已經授權；也不可用 HTTP 502 直接推論帳號沒有 Sponsor**。
- 如果進行中出現連續 3 筆相同錯誤，這輪自動停止並把詳情留在畫面及本機瀏覽器資料，避免重複浪費 64 次以上。
- C30 原版交易回放仍停在 2026-11-20，資料來源更新與下一個交易日買賣訊號是兩個不同驗證階段。

## 資安

使用者曾將 FinMind Token 貼入聊天室。該值不寫入 GitHub、README、診斷結果與 URL。建議於 FinMind 後台撤銷／更新 Token；**目前 C30/A56 雲端快取依 Token SHA-256 作私人隔離**，換 Token 前先將已封存的重要資料匯出備份，否則新 Token 將看到另一份快取（舊資料不會被自動刪除）。

## 驗證狀態

本地已做：三種上游請求 URL/參數驗證（Sponsor 整日、Sponsor 分 K、Free 多日）、後端 JavaScript 語法檢查、前端連續三次相同錯誤即停止的模擬測試，以及不存在表格選擇器的修正核對。

**尚未**取得 Cloudflare 正式部署紀錄或使用新的安全 Token 完成實際上游回應測試。用戶畫面的當次 64 筆失敗具體 HTTP code 尚未可得；單筆診斷按鈕會暴露其可核實原因。
