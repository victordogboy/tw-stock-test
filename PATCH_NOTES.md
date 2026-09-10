# V1.3 免費歷史 K 線測試

新增：
- `/api/history/yahoo`：Yahoo Finance chart API，支援 `.TW` / `.TWO`，一次抓約 460 日。
- `/api/history/twse`：TWSE 官方 `STOCK_DAY` 月資料 fallback，適合上市股票。
- `/api/history/auto`：Yahoo 優先；上市股失敗才改 TWSE 官方月資料。
- 首頁新增「免費歷史 K 線測試」。

目的：
先確認 3443 能否穩定取得 300 個以上交易日 OHLCV，再把 V4.4 接入。
