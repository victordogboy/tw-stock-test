# V1.4.4 Setup Quality mapping 修正

V1.4.3 診斷確認：
- `R.setup` 不是分數，而是交易型態 / gating 狀態物件，例如：
  - state
  - cls
  - reason
- 正式 V4.4 UI 的「Setup｜型態品質」實際顯示的是 `R.quality`。

正式 V4.4 原始碼：
`quality = round(market.score*0.50 + optimal.score*0.30 + ignition.score*0.20)`

因此 mapping 改為：
- Setup = R.quality
- Trend = R.market.score
- Bottom = R.bottom.score
- Ignition = R.ignition.score
- Entry = E.score
- Opportunity = E.opportunity
- Hold = E.hold
- Persistence = E.persistence

3443 / 2026-08-11 預期 Setup 應恢復約 74，而不是 0。
