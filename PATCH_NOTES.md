# V1.16.0 — V1.14.2-R3 + Action / Confidence only

基底：已確認正常的 V1.14.2-R3。

只加入兩個顯示功能：

## Action
固定公式：
`Action = 40% Entry + 30% Setup + 30% Opportunity`

不加門檻、不加 cap、不含 Hold。

## Confidence
直接沿用現有 FinMind 重評完整度：
- Scanner：`finmindCompleteness`
- Detail：優先使用 Scanner snapshot / FinMind recheck 的 completeness
- 若沒有 completeness，才依融資 / 法人 / 當沖三類資料是否存在換算 0/33/67/100

Confidence 不參與 Setup / Opportunity / Entry / Hold，也不影響掃描排序。

## 完全未修改
- `src/index.js`
- `public/v44-engine.js`
- Scanner `formalScore()`
- Scanner `worker()`
- FinMind recheck
- Live 現價重評
- 盤中量預估
- 13:30 收盤後正式 K 升格邏輯
