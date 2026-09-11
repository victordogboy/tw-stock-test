# V1.16.0-R10 — All-Source / All-Dataset Audit
一次完整普查，不再要求逐版補測。

涵蓋：
- TWSE：Swagger 可發現的全部 GET；Swagger 不可達則 fallback catalog。
- TPEx：同上，且保留 transport redirect/WAF 診斷。
- Yahoo：上市/上櫃 Daily + 1m。
- FinMind：從官方 catalog 動態取得全部台灣 datasets，逐 dataset 測試；402 後保護 quota。
- TDCC、MOPS、TAIFEX：官方來源可達性。
- 每個 request 獨立 timeout/失敗紀錄，不讓單一來源中止全局。

資料紀律：
- 無可靠日期 => ?，不自行 stamp。
- Yahoo 1m volume 不視為正式日量。
- Scanner / V4.4 / Action 未修改。
