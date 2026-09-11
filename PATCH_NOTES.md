# V1.17.0-R12 — FinMind Token 輸入框
- Scanner 與個股分析頁直接提供 Token 輸入框。
- 按「套用 TOKEN」後存於此瀏覽器 localStorage。
- 呼叫 Worker 時以 Authorization Bearer 傳送；Worker 優先用瀏覽器 Token，沒有才用 Cloudflare Secret。
- Token 不寫進 GitHub/ZIP/HTML。
- 可按「清除 TOKEN」移除此瀏覽器保存值。
- 公用電腦使用後請清除 Token。
