# R36 — 台指期分析

基底：main `778f629`（已合併 R35.1 SAR）。

## 使用

- 掃描頁、個股頁與首頁新增「台指期分析」入口 `/futures.html`。
- 個股查詢輸入 `TX`、`TXF`、`台指期`、`臺指期` 或「台指期貨」會開啟台指期專頁。
- 可選近 1／3／5 年（另加 90 天暖機）、日盤／夜盤／夜盤＋日盤，以及近月連續或單一月份合約。
- 顯示日 K、MA5／10／20／60、可調 SAR、歷史審計、成交口數、前 20 日均量倍數、未平倉口數與變化。
- SAR 使用現有模組；期貨設定獨立保存，首次可帶入個股 SAR 設定。
- 盤中報價採手動更新 TXFR1，顯示來源時間，不合併到盤後日 K；需 FinMind sponsor 權限。沒有權限會顯示錯誤，不偽造即時資料。

## 資料與合約規則

歷史來源為 FinMind `TaiwanFuturesDaily`，商品 `TX`；報價來源為 `taiwan_futures_snapshot`，查詢 `TXF` 並只接受 `TXFR1` 近月識別，不以加權現貨或其他月份替代。

只接收一般月份合約，排除週契約、價差組合與無效 OHLC。近月連續每天取有有效行情的最早月份，未還原換月價差；畫面標記換月，換月當日不顯示跨合約漲跌及未平倉變化。均線與 SAR 仍可能受到換月價差影響，可切單月合約核對。

夜盤日期沿用來源的期交所交易日，不能再任意加減一天。「夜盤＋日盤」取同日同合約夜盤開盤、日盤收盤、兩盤最高最低、兩盤成交量相加，未平倉量只取日盤。僅有夜盤尚無日盤者不形成合併日 K；有日盤但夜盤缺失則標示「僅日盤」。夜盤 OI 缺失不當成零。

全部圖表與指標使用審計日及以前資料。SAR 設定、時段與合約切換不額外查行情。未套用股票融資／法人持股／Action 分數或股票交易成本回測。

## API 與權限

- `/api/futures/taiex/history?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`：單次範圍最多 2,000 天。成功歷史快取 15 分鐘，`refresh=1` 強制重抓。
- `/api/futures/taiex/quote`：手動報價，成功快取 30 秒。
- 使用目前選取的瀏覽器 Token，否則使用 Worker `FINMIND_TOKEN`。Token 僅透過 Authorization 傳送；回應、錯誤及快取 URL 不包含 Token。快取按憑證雜湊隔離。
- 共用現有兩組 Token 管理器；資料請求會用 FinMind 額度，頁面沒有自動輪詢。

## 驗證與限制

`npm run test:taiex`：資料正規化、雙時段合併、換月與固定月份、無前視、量與 OI、股票輸入導向、API 權限／快取／錯誤／Worker 路由，以及頁面資料載入與參數操作。

`node --test tests/r21-page-integration.test.cjs`：既有個股／掃描整合。

`node scripts/build-detail-score.cjs --check`：股票回測評分產物未變。

本環境實際匿名呼叫 FinMind 歷史 API 回覆 HTTP 402；沒有讀取或使用使用者私有 Token，因此具權限的真實資料與盤中報價尚未端到端驗證。測試資料僅用於測試檔，頁面只使用 API 回傳資料。環境無可用 Chromium，手機實際視覺仍待部署後確認。

## 來源規格

- https://finmind.github.io/tutor/TaiwanMarket/Derivative/
- https://finmind.github.io/tutor/TaiwanMarket/RealTime/
- https://www.taifex.com.tw/cht/3/futDailyMarketReport
