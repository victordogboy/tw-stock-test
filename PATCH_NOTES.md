# V1.17.0-R3 — Stage1 Current + Chip Completeness Fix

針對使用者截圖的兩個問題直接修正：

## 1. 第一階段仍大量 9/10
R2 第一階段雖然呼叫 fresh=1，但這會對上市股逐檔打 TWSE exact monthly；全市場時不適合。
R3 改成：
- 掃描開始只用 2330 Yahoo 1m 的實際 bar.date 決定本輪 Target。
- 每檔先讀可快取 Yahoo Daily。
- Daily 落後 Target 時，用該股 Yahoo 1m 聚合 bar 補成 Target 日暫定 K。
- 若 1m 也沒有 Target，該股標「最新K缺失」，不讓 9/10 混入 Stage1 排名。
- 只有 Stage1 保留名單才使用 TWSE exact-date formal history 重評，避免 R1 的 2271 檔 TWSE overload。
- 上櫃沒有可用官方 Worker 日K時，Stage1 使用 Yahoo 1m 暫定 K 並保留來源標記。

## 2. 資料完整度只有 33% / 67%
R2 Scanner 用 `/api/finmind/recheck`，所以匿名 FinMind quota 直接造成低完整度。
R3 改用 `/api/chips/hybrid?market=...`：
- 上市：TWSE 官方融資融券 / 三大法人 / 當沖優先。
- TWSE 日報以 URL 做 Worker Edge Cache；TopN 股票共用同一份市場日報，不重複打官方 API。
- 只有官方缺的 category 才用 FinMind。
- 上櫃：目前 TPEx Worker OpenAPI 仍被 redirect/WAF 阻擋，FinMind 為可用備援。
- 修正 cleanNum 將 `--` 錯誤視為 0 的問題。
- 移除將 `/exchangeReport/TWTB4U` 誤當當沖量的邏輯；只用 dated dayTrading report。

## 未修改
- V4.4 四分數公式。
- Action 公式。
- Detail V1.14.2-R3 after-close promotion 核心邏輯。
