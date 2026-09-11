# V1.12.0 — Structural-Safe Optimal Entry

- 最佳進場候選除了 Risk / R:R，新增 Event K Low、HL、Swing Low、平台防守過濾。
- 若有結構安全候選，Optimal Entry 優先選 Structural-Safe 價位。
- Scanner 與 Detail 共用的 V4.4 engine 同步套用。
- 價格階梯下方新增下一交易日三情境壓力測試：
  A 健康量縮 0.65x、B 正常 1.00x、C 爆量長黑 2.00x。
- 每個情境顯示 Entry、Entry Quality、Persistence、Risk、結構存活/破壞。
- 同時顯示明日 MA5/10/20、Event Low、HL、Swing、平台、Hard Break 參考。
- 全部只使用審計日與左側資料，符合 Strict No-Lookahead。
