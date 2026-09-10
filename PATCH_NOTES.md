# V1.9.3 — Detail 空白圖表 Hotfix

從使用者 V1.9.2 截圖確認：
- 上方四分數與 OHLC 已經算出來。
- 但 K 線圖完全空白。
- 籌碼代理趨勢完全空白。
- 動態均線表格只有「—」。

這表示不是股價 API 沒資料，而是 `render()` 在畫圖前中途拋錯。

## 真正根因
V1.9.1 為修正 `entryEngine()` 的 undefined `penalties`，把 `penalties` 從 return 移除了。
但 Detail 的 render 仍有兩處：
- `E.penalties.length`
- `E.penalties.join(...)`

因此流程會：
1. 先成功顯示四分數與 OHLC。
2. 執行到 `E.penalties.length` 時 TypeError。
3. `renderChipKpis()`、`renderMATable()`、`drawPriceChart()`、`drawChipChart()` 全部還沒執行。
4. 所以使用者看到三塊空白。

## V1.9.3
- entryEngine 正式建立 `penalties=[]` 並回傳，保持 UI contract。
- Detail 同步相同修正。
- 所有可選陣列 `penalties/chaseReasons/followReasons/triggers` 改為 defensive rendering。
- render 若未來再失敗，頁面會直接顯示「畫面繪製失敗：原因」，不再只留下空白畫布。

V1.9.2 的 FinMind 單一 Chip Bundle、140日一致視窗、Scanner audit snapshot 全部保留。
