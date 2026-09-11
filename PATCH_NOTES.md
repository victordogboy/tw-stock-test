# V1.16.0-R1 — Stable R3 + Detail Action only

基底：確認穩定的 V1.14.2-R3。

本版只做兩件事：

1. 個股頁新增 Action。
2. 全站標題明確顯示版本：`V1.16.0-R1｜基底 V1.14.2-R3`。

## Action
預設：
- Entry 40%
- Setup 30%
- Opportunity 30%

使用者可自由輸入三個比重。
只有三者總和 = 100% 時才計算 Action。
若不是 100%，Action 顯示 `—` 並提示修正。

公式：
`Action = Entry×Entry權重 + Setup×Setup權重 + Opportunity×Opportunity權重`

權重儲存在瀏覽器 localStorage，重新整理後仍保留。

## 刻意不做
- Scanner 不新增 Action
- Scanner 不新增 Confidence
- 不修改 Scanner worker
- 不修改 Scanner formalScore
- 不修改 FinMind recheck
- 不修改 Live 現價重評
- 不修改 Worker
- 不修改 V4.4 Engine
- 不修改 13:30 收盤後正式 K 升格
- 不新增 Confidence

也就是：Scanner 行為維持 V1.14.2-R3，只在個股頁增加 Action UI。
