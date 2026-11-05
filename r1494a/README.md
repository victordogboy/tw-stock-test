# R1494-A 策略監控台

網站入口位於 `public/r1494a/index.html`，沿用現有 tw-stock-api Cloudflare Workers 靜態網站部署。策略以 R1494-A 紙上模型運行。

`cd r1494a && npm test` 驗證解析與產生頁面資料。GitHub Actions 每日以官方資料補日 K、法人與融資券，選用 Actions Secret `FINMIND_TOKEN` 備援。舊資料保留供查閱，缺資料時交易計畫會顯示封鎖。新快照由既有 Worker 發布流程提供。
