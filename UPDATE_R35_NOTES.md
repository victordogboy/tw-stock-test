# V1.17.0-R35 — K 線 SAR

基底：main R34，commit 9f96938。個股頁標題更新為 R35；掃描頁沿用 R34。

- K 線保留 MA5、MA10、MA20、MA60，新增可開關的 SAR 圓點：多頭紅色、空頭綠色。
- K 線上方可輸入初始加速因子、每次增加量、上限，預設 0.02 / 0.02 / 0.20，失焦或確認後重畫，可一鍵恢復預設。
- 僅使用已載入 K 線在瀏覽器計算，調整參數不增加行情或 FinMind 請求。
- 設定用獨立 localStorage key `twq_chart_sar_v1` 保存；不修改追蹤清單、Token、Action 或回測設定。
- 審計日顯示 SAR 數值、方向與當時 AF；完整歷史前綴計算後才擷取最近 100 根顯示，避免每次截圖視窗重置 SAR。
- 驗證輸入範圍 0 < 因子 <= 1，上限須不小於初始值及增加量。錯誤輸入保留上一組有效參數。

## 計算與限制

採 Wilder 遞迴 `SAR + AF × (EP − SAR)`。前兩根收盤決定初始方向（同價視為多頭），初始 SAR 使用這兩根相反側極值；第一根不輸出 SAR。後續限制於前兩根高低價之外，創新極值才增加 AF，反轉時重設 AF。無效高低收盤資料會中斷序列並重新暖機。

參數意義參考 https://www.tradingview.com/support/solutions/43000502597-parabolic-sar-sar/ 。不同平台的歷史起點、初始化和還原權息資料可能造成數值差異。盤中未完成 K 線的 SAR 可能變動。本次只加入顯示，不將 SAR 納入 Action、掃描或交易回測。

## 驗證

`node --test tests/r35-sar.test.cjs tests/r21-page-integration.test.cjs`

`node scripts/build-detail-score.cjs --check`

`node --test tests/r35-sar-browser.test.cjs`（需 Playwright Chromium）

測試涵蓋手算結果、雙向轉折、AF 上限、歷史前綴不變性、參數重畫、錯誤輸入、開關、審計日、重載保存、手機欄位與額外請求數。

本次環境驗證：SAR 與既有頁面整合共 4 項通過，回測評分產物一致性檢查通過。瀏覽器測試已新增，但環境無 Chromium 且下載失敗，尚未完成實際瀏覽器及手機視覺驗證。
