# V1.14.2-R3 — 收盤後立即把 1 分K 轉成正式日K

這次修的是截圖中最後一個核心問題：

- 今日資訊已經是 2026-09-11 13:30 收盤值
- 但 Yahoo/TWSE 的 daily history 對某些股票（尤其上櫃）仍只到 2026-09-10
- 因此前一版即使知道「現在已收盤」，正式 K 線資料本身仍沒有 9/11 那根 K

V1.14.2-R3 行為：

1. 09:00–13:29
   - 維持原本 Live EST.
   - 正式盤後仍固定上一完成交易日
   - 不把未完成 K 寫進正式 K 線

2. 13:30 之後
   - Yahoo 1m 今日 O/H/L/C/V 視為「已完成交易日」
   - 如果正式 daily history 尚未有今天，直接把完整 1m 日聚合加入 STATE.prices
   - auditIndex / 歷史滑桿 / K 線 / MA / Setup / Opportunity / Entry / Hold 全部重算到今天
   - `LIVE EST.` 盤中預估卡隱藏，不再把收盤後資料當盤中估算
   - 今日資訊改顯示「今日收盤資訊」

3. 從 Scanner 點進 Detail
   - 若 Scanner snapshot 已有較新的完成日，收盤後可先補入
   - 接著仍會用 intraday 13:30 完整 O/H/L/C/V 做正式確認

Strict No-Lookahead：
- 13:30 前絕不把今日未完成 K 寫成正式日K
- 13:30 後才 promote 今日完整 K
- 今日籌碼若尚未公布，仍只使用最後已取得的籌碼日期，不捏造 9/11 籌碼

V1.14.2 評分公式本身未修改。
