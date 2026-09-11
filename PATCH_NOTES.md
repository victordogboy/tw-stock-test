# V1.17.0-R6 — Restore Current Price + Fix Official Completeness Parser

這版直接修正使用者 R5 截圖暴露的兩個問題。

## 1. 為什麼完整度大量 0%
找到確定 bug：
TWSE RWD API 並不全部回 `{tables:[...]}`；很多正式 report 是 top-level `{fields:[...], data:[...]}`。
R5 `rowByFields()` 只讀 `tables[]`，所以官方 API 明明有資料，parser 卻判定找不到股票，導致 0%。

R6 `rowByFields()` 同時支援：
- top-level `fields + data`
- `tables[].fields + tables[].data`

並換掉 chips cache namespace，避免舊的 0% cache 繼續污染結果。

## 2. 為什麼個股頁「現價」消失
R5 的 live refresh 有 race：
- 頁面 1.5 秒自動 refresh
- 如果那時 analyze() 還在跑，refreshToday() 因 busy 直接 return
- 之後可能要等 60 秒才再刷新，所以看起來像現價功能被刪掉

R6：
- analyze() 完成後明確呼叫一次 refreshToday()
- 保留原本每 60 秒更新
- 保留現價 / 漲跌 / 今開 / 最高 / 最低 / 盤中量 / Live Entry-Hold-Opportunity
- 收盤後仍依 R3 規則把完成的 Yahoo 1m bar promote 成正式 K

## 3. Detail 與 Scanner 籌碼來源一致
R5 Detail 還是先打舊 `/api/finmind/recheck`，失敗才 hybrid，與 Scanner 不一致。
R6 改成：
1. `/api/chips/hybrid` primary
2. Scanner snapshot network fallback
3. 不再直接以 FinMind recheck 當 Detail primary

## 保留
- TWSE official primary + FinMind assist
- R4 Stage1 Target invariant
- Yahoo 1m volume 不作最低成交量門檻
- V4.4 / Action / R3 after-close promotion 不改
