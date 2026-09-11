# V1.14.2-R3 + AC Display-Only

基底：確認正常的 V1.14.2-R3。

這版只新增顯示層的 Action / Confidence。

## Action
`Action = 40% Entry + 30% Setup + 30% Opportunity`

## Confidence
資料品質顯示，不參與模型。

## 關鍵保證
- Scanner `formalScore()` 完全保持原始 R3
- Scanner `worker()` 完全保持原始 R3
- Scanner FinMind 重評流程完全保持原始 R3
- Scanner Live 現價重評流程完全保持原始 R3
- Worker `src/index.js` 完全保持原始 R3
- `public/v44-engine.js` 完全保持原始 R3
- Action / Confidence 只在畫面 render 時由既有四分數/資料計算
- Detail 的原始 `combineScores()` / `entryEngine()` 路徑完全不改

因此 Action/Confidence 不可能影響「成功/略過/保留/Top100 FinMind」掃描數量。
