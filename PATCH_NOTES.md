# V1.7.4 worker hotfix

從使用者實際畫面確認：
- V1.7.3 已正確部署（畫面標題已是 V1.7.3）
- 掃描按下後立即顯示 `worker is not defined`

根因：
V1.7 Top100 改版時 `runPool()` 保留了 `await worker(items[i])`，
但第一階段單檔 OHLCV 掃描函式 `worker()` 在重構時遺失。

V1.7.4：
- 補回 `async function worker(item)`
- 每檔：
  1. 取 Yahoo/TWSE history auto
  2. 至少 180 根 K
  3. 跑 Price-only formalScore
  4. 計算 priceDecision
  5. 保存 `_hist` 給第二階段 FinMind 重評
  6. 計算 prelimScore
  7. push 到 results
- 第一階段完成後原本 Top100 FinMind 重評流程不變。

其餘 V1.7.3 功能保留：
- 個股新分頁，scanner 不卸載
- 當日交易量隨回測日更新
- MA5黃 / MA10藍 / MA20紫 / MA60綠
- 台股 K 線：漲紅、跌綠
