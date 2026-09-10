# V1.8.1 — 重複股票 + 9/9 / 9/10 資料日不一致修正

這版針對實際截圖確認的三個問題修正：

1. 排行榜每檔股票重複
- 根因：V1.8.0 的 TPEx Universe HTML parser 可能把部分 TWSE 上市代號也收進 TPEx。
- `/api/market/universe` 現在以「股票代號」全域去重，若同一代號同時出現在 TWSE/TPEx，TWSE 優先。
- 瀏覽器掃描端再做第二次去重，避免上游異常重新造成雙列。

2. 大盤掃描停在 9/9，但個股詳細頁是 9/10
- 根因：Scanner 第一階段沒有帶 `fresh=1`，所以使用 Yahoo chart 的最後一根；Detail 有帶 fresh=1，會再以 TWSE STOCK_DAY 官方明確日期覆蓋 Yahoo。
- 現在「上市股票」Scanner 與 Detail 都統一使用 `fresh=1`。
- 上市股因此會以 TWSE STOCK_DAY 明確日期資料合併後再計算 V4.4。
- 上櫃仍使用 Yahoo `.TWO`，因 TPEx 官方歷史端點從 Cloudflare 不穩定。

3. 個股有時又跳回 9/9
- V1.8.0 的重複列其中一列可能被錯標成 `market=tpex`。
- 點到該列後 Detail 會關閉 TWSE fresh merge，於是又退回 Yahoo 的 9/9。
- 全域去重 + TWSE 優先後，此路徑被消除。
- Detail 的 TaiwanStockPrice adapter 也改成真正使用 URL 傳入的 `MARKET`，不再硬編碼 twse。

透明度新增：
- 排行榜新增「市場」「資料日」欄。
- 最終統計顯示榜單實際資料日期。
- 每筆結果保留 dataDate / yahooLast / latestTwseDate / latestMerge 診斷欄位。
