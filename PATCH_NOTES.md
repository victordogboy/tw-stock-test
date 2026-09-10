# V1.4.3 V4.4 mapping 修正

依 V1.4.2 實際診斷結果修正，不再猜 key：
combineScores() top-level:
- market
- optimal
- bottom
- ignition
- quality
- noTrade
- setup

entryEngine():
- score
- state
- position
- opportunity / hold / persistence 等

mapping:
- Setup = R.setup.score
- Trend/Market = R.market.score
- Bottom = R.bottom.score
- Ignition = R.ignition.score
- Entry = E.score
- Opportunity = E.opportunity
- Hold = E.hold
- Persistence = E.persistence

3443 2026-08-11 已確認 Entry 72 / Opportunity 93 / Hold 78 / Persistence 74。
本版目的：修正全市場排行榜中 Setup/Trend/Bottom/Ignition 被錯誤顯示為 0 的問題。
