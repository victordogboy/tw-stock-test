# V1.17.0-R10 — Intraday 503 Fallback

截圖已直接定位：
`HTTP 503 /api/intraday?code=2330&market=twse`

R9 把這一個 Yahoo 1m request 當成 Scanner 的唯一 Target 日期來源，因此一次暫時性 503 就會讓整個掃描停止。

R10 只修改 Target 日期解析：
1. Yahoo 1m 2330
2. 失敗 -> TWSE fresh/exact 2330
3. 再失敗 -> cached Daily 2330，畫面明確標 degraded
4. 三個來源全部失敗才停止

TWSE fresh fallback 只查 2330 一檔，不會重新造成 2271 檔 exact API overload。

保留 R9 融資歷史修正、R8 強制分析、Stage1 日期防線、V4.4/Action。
