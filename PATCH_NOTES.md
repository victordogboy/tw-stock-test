# V1.9.2 — FinMind / 個股頁一致性修正

1. 個股頁原本同時要求融資、法人、當沖，會對相同 `/api/chips/hybrid` 發出 3 次請求。
   V1.9.2 改成單一 Chip Bundle Promise，一次取得三組資料。

2. Scanner 第二階段使用 `/api/finmind/recheck`，Detail 原本使用 `/api/chips/hybrid`，
   兩邊可能因 quota/fallback 取到不同資料。現在 Detail 優先使用和 Scanner 完全相同的
   `/api/finmind/recheck`；只有 FinMind 失敗才做一次 hybrid fallback。

3. Scanner 的 FinMind 視窗是 140 天，Detail 過去會因 analyze 傳入 300 天開始日而使用不同視窗。
   現在 Detail 籌碼視窗固定 140 天，與 Scanner 一致。

4. Detail HTML 原本有自己的 `combineScores()` / `entryEngine()` 複本，
   Scanner 則使用 `v44-engine.js`。兩份模型已經版本漂移。
   本版把 Detail 的這兩個核心函式同步成 `v44-engine.js` 的同版本實作。

5. Scanner FinMind recheck 後保存：
   - preFinmind 四分數
   - postFinmind 四分數
   - 真正使用的 `_chips`
   - finmindWindow

6. 從排行榜點進個股時，會保存該筆「當次排名真正使用的籌碼快照」。
   Detail 優先使用這份快照，因此排行榜與個股頁不會因第二次 API 呼叫而漂移。

7. 個股頁 Banner 顯示籌碼來源；若從 Scanner 開啟，也顯示排行榜 S/O/E/H 快照方便對帳。
