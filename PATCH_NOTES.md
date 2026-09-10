# V1.8.2 — 最新交易日一致性 + 價格浮點修正

1. Yahoo 浮點殘值（例如 10.850000381469727）改依台股跳動單位正規化。
2. V1.8.1 問題：Scanner 對每檔股票 individually fresh=1，大量掃描時 TWSE 月資料補值可能失敗，失敗即退回 Yahoo 9/9；Detail 單檔呼叫又可能成功到 9/10。
3. V1.8.2 改成「一次官方全市場快照」：
   - 掃描開始抓一次 TWSE STOCK_DAY_ALL。
   - 再只抓一次 2330 的 TWSE STOCK_DAY，取得具明確日期的最新交易日。
   - 將該日期套在同一份全市場官方 OHLCV snapshot。
   - 每檔上市股 Yahoo 歷史最後一根統一由此官方 snapshot 覆蓋/新增。
4. Scanner 上方顯示 `TWSE官方快照日`，可以直接肉眼驗證。
5. Detail 保留單檔 fresh=1 exact-date merge，應與 Scanner 同日。
