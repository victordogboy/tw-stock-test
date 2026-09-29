# R23.1：手機儲存額度滿時仍可背景掃描

使用者回報：`Setting the value of twq_background_scan_pending_r23 exceeded the quota`。R23 在發送工作前先寫入非必要的 pending 記錄，瀏覽器 localStorage 已滿時直接跳出，工作尚未送到伺服器。

此更新移除 pending 寫入。背景工作的必要識別碼沿用 R23 原值；新識別碼若無法寫入 localStorage，改用 IndexedDB 的原子讀取／建立交易保存，重開分頁仍可恢復。若兩種儲存都無法持久保存，會明確告知且不送出無法找回的工作。

榜單快取寫入改為 localStorage 與 sessionStorage 分別嘗試；包含空榜單在內的快取失敗不會中斷結果顯示或誤報掃描未提交。Token、追蹤清單、權重、原工作識別碼與舊榜單均不會被清除。

同時修正 R23 的 Token 傳遞：網頁使用標準 Authorization Bearer，背景工作建立端現在會接收該格式，仍兼容 X-FinMind-Token，確保使用目前選用的 Token。完成、停止或失敗後刪除暫存 Token 的行為不變。

版本標題及健康檢查更新為 1.17.0-R23.1。本次不新增 Durable Object migration，沿用已部署的 R23 設定。合併更新後由既有 Cloudflare 正式部署流程上線。

測試包含實際填滿 localStorage 與 sessionStorage 後，既有識別碼啟動、IndexedDB 新建識別碼、關閉分頁繼續完成、重新取得結果、空榜單，以及兩組 Token／追蹤清單保留。另保留 R23 計分、期貨、停止、到期等回歸測試。

驗證結果：18 項回歸測試、5 項 Chromium＋本地 Cloudflare 整合測試全部通過，部署打包檢查成功。儲存額度測試實際填滿兩種 Web Storage，並重現 R23 pending 寫入失敗後再測修正版；兩種識別碼儲存皆不可用時確認不會送出工作。本次正式站仍需合併並部署後驗證。
