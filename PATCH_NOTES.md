# V1.14.0 — 現價四分數一致化 + 盤中價格防呆

- Scanner 四欄 Setup / Opportunity / Entry / Hold 最終顯示現價重算。
- 現價重算使用今日 O/H/L + 現價 + 預估收盤量 + 已公布籌碼。
- 今日籌碼未公布時不捏造。
- 修正 Yahoo null 價格被轉成 0，Low 不再出現假 0。
- 盤中報價異常時停止 Live Entry/Hold 重算，不污染正式盤後分數。
- Structural-Safe 若原候選不安全，新增安全底線到現價的價格網格，尋找真正安全替代價。
