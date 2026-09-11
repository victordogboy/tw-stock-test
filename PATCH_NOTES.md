# V1.17.0-R9 — Financing History Fix

使用者指出的真正問題不是按鈕動畫，而是：
KPI 有「融資餘額 170 張」，但黃色融資歷史線沒有出現。

Root cause：
R7/R8 把「至少一筆融資」視為 category 有資料。
因此 TWSE 最新一筆可以顯示 KPI，但只有 1 點時無法形成歷史曲線。

R9：
- 手動「分析」仍先 force 重抓 FinMind 融資歷史。
- 上市股若重抓後融資仍少於 5 日，再用 TWSE 官方 MI_MARGN 補最近 20 個平日。
- 只補 margin endpoint，不重抓法人/當沖，避免 R6 的 request explosion。
- 同日期以 TWSE 官方值覆蓋 FinMind。
- 回傳 coverage_days + history_ready。
- 個股頁會顯示融/法/沖各有幾日歷史。
- 融資少於 5 日時明確警告黃色線資料不足。

上櫃目前仍主要依 FinMind，因 TPEx Worker transport 尚未解決。
