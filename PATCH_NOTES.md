# V1.17.0-R11 — FinMind TOKEN

- 正式支援 Cloudflare Worker Secret `FINMIND_TOKEN`。
- R10 已有 token 注入能力；R11 新增狀態確認與 Cache 分流。
- Token 模式與匿名模式使用不同 cache key，設定 Token 後不會繼續讀到之前匿名 402/缺資料 cache。
- Scanner / Detail 會顯示 TOKEN 已啟用或未設定。
- `/api/finmind/status` 只回 configured/mode，不會回傳 Token。
- 保留 R10 503 fallback、R9 融資歷史補強、R8 強制重新分析。
