# V1.17.0-R5 — FinMind Assist + Institutional Schema Fix

## 原則
- TWSE 官方仍是上市籌碼 Primary。
- FinMind 只補「官方缺少的 category」，不覆蓋已成功的官方資料。
- 上櫃因 TPEx Worker OpenAPI 仍受 redirect/WAF 影響，FinMind 可作籌碼輔助。
- FinMind 回傳加入 Worker cache：成功 6 小時；錯誤/402 15 分鐘，降低匿名 quota 消耗。

## 修正一個真正會影響 V4.4 的欄位 bug
TWSE T86 parser 先前輸出 `Foreign_Investor_Buy/Sell` 等欄位，
但 V4.4 實際讀 FinMind-Wide 格式的 `Foreign_Investor_buy/sell`、
`Investment_Trust_buy/sell`、`Dealer_self_buy/sell`、`Dealer_Hedging_buy/sell`。
R5 已統一為 V4.4 真正會讀到的 schema。

## FinMind 法人兩層備援
1. `TaiwanStockInstitutionalInvestorsBuySellWide`
2. Wide 不可用時，抓 `TaiwanStockInstitutionalInvestorsBuySell`
   並在 Worker 端轉成 Wide schema。

## Scanner
完整度欄位改成同時顯示：
- 融：✓ / ✗ + 來源
- 法：✓ / ✗ + 來源
- 沖：✓ / ✗ + 來源

這樣 33% / 67% 不再是黑盒，可以直接看到缺的是哪一類，以及是 TWSE 還是 FinMind 補到。

## 保留
- R4 Stage1 Target invariant
- R4 Yahoo 1m volume 不做最低成交量門檻
- V4.4 / Action / Detail R3 promotion 未修改
