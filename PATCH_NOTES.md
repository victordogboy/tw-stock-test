# V1.4.1 V4.4 Mapping Diagnostic
- 不改 API / Yahoo / TWSE 掃描架構。
- 新增單股 Strict No-Lookahead 診斷。
- 預設 3443 / 2026-08-11。
- 顯示 combineScores 與 entryEngine 的原始 keys + 完整 JSON。
- scanner mapping 改為 recursive key lookup，避免直接猜欄位名稱。
- 下一步用診斷輸出做 1:1 mapping，再與正式 V4.4 單股版回歸比對。
