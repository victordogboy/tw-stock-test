# 策略自動回歸實驗室 R1

這是獨立研究頁，**不修改 R16 正式 Scanner / Detail / V4.4**。

## 研究假設
H1：ΔEntry / ΔAction 是否在控制當日價格、5日動能、量比、ATR、MA20乖離、突破後，仍能預測 T+5/T+10 報酬。
H2：ExitRisk = 100-Hold 是否只是價格鏡像；ΔExitRisk 是否能在控制價格後預測未來 5 日最大不利波動。

## 方法
- 多股票 deterministic random sample。
- 每個歷史交易日只用當天與左側資料重算 V4.4。
- 未來 T+1/T+3/T+5/T+10 僅作 outcome。
- 固定 Δ 分桶 + OLS 控制變數 + 時間切分 Train/Test。
- 自動產生「初步支持 / 證據不足」結論。
- 可匯出 observation CSV。

## 限制
- 使用目前 Universe，仍有 survivorship bias。
- OLS t-stat 是探索性，未做 stock-cluster robust SE。
- FinMind/籌碼缺資料會影響部分股票；工具會記錄完整度。
- 不會自動修改正式策略。
