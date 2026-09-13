# R19.3 固定池歷史行情來源修正
累積更新 ZIP，可覆蓋 r18/r19/r19.1/r19.2 專案；不改正式 V4.4。

R19.2 固定股票池只走 history/auto，歷史來源下拉實際只管每日前100。上櫃 Yahoo 失敗沒有官方歷史備援，舊訊息不能指出股票／原因。截圖無法判斷實際上游狀態，未宣稱解除來源限制。

更新後固定池有獨立「固定池行情來源」選項：
- Yahoo／交易所：不使用 FinMind，沿用舊行情快取。
- FinMind 個股行情：先在原掃描器設定 Token，選此來源再補齊。使用 TaiwanStockPrice + data_id + start_date + end_date，不是付費全市場按日查詢；一般 Token 可嘗試，依帳戶實際權限與配額。無 Token 明確停止，不偷偷用匿名請求。純價量不抓籌碼。

每個缺少的股票／指定期間通常一個 FinMind 請求，另有 0050 日曆代理一份；失敗重試、換期間另計。快取命中不再呼叫供應商。兩來源各自存放避免混合冒充，切換來源會建立該來源自己的資料。GET 只讀伺服器快取；POST 才補齊；搜尋只讀瀏覽器，零上游。進度顯示当前股票與來源，失敗不靜默排除／不以0填補。429/402 停止續接，不自動消耗重試。

41 tests passed: node --test tests/research*.test.cjs。含指定個股／期間、Token僅在Authorization header、來源快取隔離、額度/錯誤/空資料不快取、上櫃來源失敗顯示代碼與狀態。尚未用使用者 Token 或其 Cloudflare 網址實測，不能宣稱真實回測已完成。
FinMind 文件：https://finmind.github.io/tutor/TaiwanMarket/Technical/
R19.2 說明中「固定池不呼叫 FinMind」僅適用 Yahoo／交易所選項。其餘研究限制（目前名單選樣偏差、0050交易日日曆代理、未計除權息、價量假說分數非V4.4）仍適用。
