# Update R20.3

- Scanner、個股分析與策略研究頁共用兩個 FinMind Token 槽位。
- 舊版單一 Token 會自動移入 Token 1；可隨時切換 Token 1／2，不必重貼。
- Token 僅保存在目前瀏覽器的 localStorage，不寫入原始碼、Worker 或 GitHub。
- 個股 K 線上方新增 Setup、Opportunity、Entry、Hold、Action 精簡分數列；歷史游標與 Action 權重變更時同步更新。
- 回測真正支援最長五年訊號期，並額外允許 180 日暖機；價量與籌碼端點使用相同範圍限制。

驗證：新增雙 Token／共用狀態／K 線分數列／五年後端範圍測試；相關測試全部通過。
