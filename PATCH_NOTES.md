# V1.16.0-R6 — Full API Audit
基底：V1.16.0-R5 / V1.14.2-R3

本版只擴充診斷，不修改 Scanner / V4.4 / Action。

新增：
- `/full-api-audit.html`
- `/api/audit/swagger?source=twse|tpex`
- `/api/audit/endpoint?source=...&path=...&code=...`
- `/api/audit/finmind-catalog`
- `/api/audit/tdcc`

TWSE / TPEx：
- 從官方 Swagger 動態列出所有 GET API。
- 可跑核心投資 API，亦可跑全部 GET。
- 每個 API 記錄 HTTP、筆數、可識別最新日期、指定股票是否出現、耗時、欄位。
- Proxy 僅允許固定 TWSE/TPEx 官方 base，不接受任意 URL。

FinMind：
- 從官方 llms-full.txt 建立台灣 dataset catalog。
- 匿名 quota 出現 402 後停止浪費額度，其餘標記 SKIP-QUOTA。

TDCC：
- 驗證官方股權分散頁可達性。
- 因該頁不是 Swagger/OpenAPI，不偽造不存在的 API。

注意：跑「全部官方 GET」可能耗時數分鐘並觸發官方限流，這正是 Audit 要記錄的結果。
