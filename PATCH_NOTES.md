# V1.17.0-R2 — Emergency Stable Rollback

這不是再加新功能，而是撤回 R1 的錯誤 production 改動。

- 撤回 R1 Hard Date Gate。
- 撤回 R1 全市場逐股要求 2026-09-11 正式 K 的邏輯。
- 撤回 R1 Official-first chips production 改造。
- 回到 V1.16.0-R2 可正常掃描的 production code。
- 保留 R2 的 null/0 價格修正與 Detail Action。
- V4.4 不修改。

原因：R1 將「資料源診斷結論」直接套進全市場 Scanner，但 TWSE exact monthly 無法承受掃描時逐股大量 fresh requests，造成大量 `最新K缺失`，實際掃描只剩極少數成功。先恢復可用性，再把新資料架構放在獨立驗證路徑壓測通過後才進 production。
