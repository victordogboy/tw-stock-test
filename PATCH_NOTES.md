# V1.14.2-R3 + Action / Confidence

基底：確認正常的 V1.14.2-R3。

只新增兩個輔助指標，其他邏輯不動。

## Action
固定公式：
`Action = 40% Entry + 30% Setup + 30% Opportunity`

- 不加入 Hold
- 不加額外門檻
- 不做 cap
- 不改 Setup / Opportunity / Entry / Hold 原始分數

## Confidence
只表示資料可信度，不參與交易評分。

計算方式：
- K 線歷史完整度：最多 40 分
- 融資資料：最多 20 分
- 法人資料：最多 20 分
- 當沖資料：最多 20 分

若籌碼至少更新到「目前正式 K 的前一交易日」，視為正常資料延遲並給完整分數；
有資料但較舊則給一半分數；缺資料為 0。

## 保證不動的部分
- Worker `src/index.js` 完全未修改
- `public/v44-engine.js` 完全未修改
- V1.14.2-R3 的 13:30 收盤後正式 K 升格邏輯完全未修改
- Scanner / Detail 的原本四大分數公式完全未修改
- 盤中量預估完全未修改
- API / cache / FinMind 流程完全未修改
