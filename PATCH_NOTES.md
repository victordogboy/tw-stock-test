# V1.15.0 — Model Core / Action / Confidence / Intraday Volume Profile

## 1. 統一 Score Packet
Scanner、Detail 正式盤後、Live 盤中、Scenario 壓力測試都改用同一個
`buildScorePacket()` 輸出：
- Setup
- Opportunity
- Entry
- Hold
- Action
- Confidence
- Risk
- Gate 狀態

底層仍是同一套 `combineScores + entryEngine`。

## 2. Action Score
Action = 40% Entry + 30% Setup + 30% Opportunity。

但不允許高 Setup / Opportunity 把危險 Entry 補救掉：
- Entry < 62 → Action 上限 59
- Risk > 7% → Action 上限 59
- HardBroken → Action 上限 49

Hold 不放進新進場 Action。

## 3. Confidence
0–100，依：
- 歷史K深度
- 價格有效性
- 融資 / 法人 / 當沖資料新鮮度
- 盤中報價有效性
- 盤中量預估信心
- FinMind 完整度
綜合計算。

## 4. 個股歷史盤中量曲線
`/api/intraday` 從 Yahoo 5d / 1m 建立前幾個交易日的盤中量曲線：
- 取相同時間點「累積量 / 全日量」
- 使用中位數 profile fraction
- 今日預估量優先用個股歷史盤中量曲線
- 樣本不足才退回時間進度模型
- 越接近收盤，預估信心越高

## 5. UI
Scanner 保留原本四個排行按鈕，不新增排行類別；
表格增加 Action、Confidence 作為輔助判讀。
個股盤中與正式盤後區都新增 Action / Confidence。
