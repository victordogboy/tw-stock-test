# V1.16.0-R3 — API Diagnostic only
基底：V1.16.0-R2 / V1.14.2-R3。

新增 `/api-diagnostic.html`。
用途：在改 Scanner 前，直接比較 Worker normal/fresh/intraday 與上市 TWSE STOCK_DAY 的最後資料日、OHLCV、筆數、HTTP 與耗時。

診斷頁不修改資料日期、不補假 K、不參與評分。
Scanner/V4.4/FinMind/Action 邏輯不因診斷頁而改變。
