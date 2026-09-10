# V1.5 決策排行榜
保留 V1.4.4 已驗證的資料鏈與正式 V4.4 engine，不修改核心 V4.4 分數。

新增三種「scanner 外層」決策排序：
1. 今日新進場：Entry + Opportunity + Persistence + Setup，並考慮 risk distance / MA20 bias。
2. 剛發動：Opportunity + Ignition + Persistence + Setup，避免成熟趨勢壓過早期訊號。
3. 續抱：Hold + Trend + Persistence。

新增左側資料衍生的價格欄位：
- 買區
- 最高可買
- 停損
- T1 / T2
- R:R1

注意：
這些價格決策是 V1.5 scanner 外層第一版，不改寫正式 V4.4 engine。
後續應用歷史盲測校正價格演算法，尤其 gap/neckline/HL/ATR/台股 tick rounding。
