# V1.7 簡化版：前100 FinMind 完整重評

依需求取消 D1 / Cron 路線，回到最直覺的兩階段掃描：

第一階段
- TWSE 全市場
- 股價 >= 10、成交量 >= 3000張
- Yahoo 300日 OHLCV
- Price-only V4.4 初篩
- 目前約 195 檔

第二階段
- 取第一階段「今日新進場」初篩前 100 名
- 每檔用 FinMind 重新抓：
  1. TaiwanStockMarginPurchaseShortSale
  2. TaiwanStockInstitutionalInvestorsBuySellWide
  3. TaiwanStockDayTrading
- 將三組資料真正餵回正式 V4.4 combineScores(rows, margin, inst, daytrade)
- 再重新計算 Entry / Opportunity / Hold / Persistence 等
- 最終排行榜只顯示這 100 檔重新評估結果
- 顯示初篩分與 FinMind 資料完整度

Cloudflare cache
- 每檔 FinMind bundle 快取 60 分鐘，重複操作不反覆消耗額度。

注意
- 無 FinMind Token 時，100 檔 × 3 dataset 最多約 300 次 upstream request，接近匿名額度上限。
- 若 FinMind 有任何一組 dataset 失敗，畫面會顯示部分完整度，而不是假裝完整 V4.4。
