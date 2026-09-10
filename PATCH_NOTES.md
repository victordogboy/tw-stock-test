# V1.7.6：當日 K 強制補齊 + 掃描只留四分類

## 為什麼 2354 還停在 9/9？
V1.7.5 只修 Yahoo period2 邊界，但 Yahoo Chart 的日 K 本身仍可能比 Yahoo 台股網頁晚更新。
所以即使 Yahoo 頁面已有 9/10，Chart API 還可能只回到 9/9。

## V1.7.6 修法
`/api/history/auto`：
1. 先抓 Yahoo 歷史 K。
2. 如果 end_date 是今天，而且是 TWSE 上市股票：
3. 再抓官方 TWSE `STOCK_DAY_ALL`。
4. 找到該股票今天的 O/H/L/C/成交股數。
5. 若 Yahoo 沒有今天 K，就 append；若已有，則用 TWSE 官方值 replace。
6. 再排序後回傳。

因此 2026-09-10 晚間分析 2354 時，只要 TWSE STOCK_DAY_ALL 已發布，
審計日應可到 2026-09-10，而不再依賴 Yahoo Chart 是否已更新。

Strict No-Lookahead 不變：
歷史 slider 拉回 9/9 時仍只截到 9/9。

## 掃描排行簡化
使用者要求只留四種：
- Setup｜型態品質
- Opportunity｜行情機會
- Entry｜現在能不能買
- Hold｜已持有是否續抱

Bottom / Ignition / Trend / Persistence 仍留在 V4.4 內部參與計算，
但不再獨立做排行榜，也不再塞在主掃描表格中。

初篩 Top100 改以 Entry 作為前 100 名排序基準，
再使用 FinMind 重新評估完整 V4.4。
