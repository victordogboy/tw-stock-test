# V1.16.0-R2 — 0 元假資料修正

基底：V1.14.2-R3。

真正原因：
Yahoo/TWSE 若回傳 null / `--` 價格，舊程式會經過 `Number(null)` 或 `Number('')`
轉成 0。接著 Scanner 把最後一根 K 的 close=0 當成真實股價，因此大量股票被標記：

`低於最低股價`

這不是被封鎖，也不是 Action 造成。

## 修正
- Yahoo history：close 必須 > 0 才保留。
- TWSE monthly：close 必須 > 0 才保留。
- `roundTwPrice(null)` 不再變成 0。
- `numTW('--')` 不再變成 0。
- Scanner 再加一層防守：close<=0 的 K 棒先移除，再做最低股價篩選。
- 真正低於最低股價時，錯誤訊息會顯示實際 close。

## 功能
- Scanner 維持 R3，不加入 Action / Confidence。
- 個股頁只新增 Action。
- Action 權重可自行輸入，Entry / Setup / Opportunity 三者總和必須 = 100%。
- 預設 40 / 30 / 30。
- 所有標題顯示 `V1.16.0-R2｜基底 V1.14.2-R3`。
