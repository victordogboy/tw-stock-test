# V1.16.0-R4 — Extended API Diagnostic
基底：V1.16.0-R3 / V1.14.2-R3

只擴充 `/api-diagnostic.html`：
- Worker history normal / fresh
- Yahoo Daily
- Yahoo 1m（修正 R3 診斷頁對 `/api/intraday` 回傳 `bar` 的解析）
- TWSE STOCK_DAY（上市）
- TPEx official bulk（上櫃；若官方列沒有日期，明確標示「未驗證」，不補日期）
- FinMind TaiwanStockPrice
- FinMind Margin
- FinMind Institutional
- FinMind DayTrading

Scanner、V4.4、FinMind 正式重評、Action 公式皆未修改。
