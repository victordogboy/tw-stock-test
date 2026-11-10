# R11 Cloudflare / GitHub 紙上盤前研究台（2026-11-08）

URL（當 Cloudflare Workers Builds 已成功部署本儲存庫 main 分支時）：
`https://tw-stock-api.victordogboy.workers.dev/r11/`

**研究用途**，不是實際可下單訊號；原始 R18-A 可跨盤持倉分支保持完全獨立。

## 架構
- **GitHub**：使用現有 `victordogboy/tw-stock-test`，不改既有 `src/worker.mjs`、`wrangler.jsonc` 或股票 API。
- **Cloudflare**：既有 Workers Builds 連結 main 分支後，`wrangler.jsonc` 將 `public/` 原樣作為靜態資源；這次新增 `public/r11/`，不更動已上線其他策略路徑。
- **引擎**：`r11-plan.mjs` 是原 R05→R06→R07→R08→R09→R10-GROWTH→R11-RR/MAX 的純 JS 盤前**條件價研究核對**，`r11-plan.test.mjs` 可用 `node --test public/r11/r11-plan.test.mjs` 執行最小長短兩側價格核對。
- **即時資料 API**：頁面預留 `GET /api/r11/preopen`，尚未實作。未驗證完整資料／換月／P40／R26／券商持倉時**必須顯示 BLOCKED，不顯示任何當盤可下單價位**。切勿因 `/api/health` 成功就解除封鎖。
- 使用者可粘貼歷史盤前特徵 JSON 做本地研究試算；此資料無法證明是最新行情，即使 `features_verified:true`，畫面一律寫明「僅研究，不得下單」，後端 `tradeable` 也永遠 false。

## R11 研究凍結基準
- RR / 2021-10-22 至 2026-10-22：淨利 +63,236 點；保守 OHLC 資金最大回撤 4.684%；710 筆。
- MAX：+63,914 點；4.764%；682 筆。
- 同期 TX 買進持有 +29,603 點；2x 門檻 +59,206 點。
- 初始 200 萬、-1/0/+1 TX、每側 3 點；日夜盤獨立當盤強制平倉。
- 成本提高至每側 5 點，RR 的回撤變成 5.724%，**未符合 5% 風控**。績效全部是多輪樣本內選參，2026 約佔 68% 獲利，缺真正未碰過的 OOS。

完整 136 萬筆歷史 TX 分 K、原始 P193 Python、R11 逐分鐘驗收與價格對帳**不公開寫入 GitHub**（避免大容量與來源授權外洩），保留在本對話研究 ZIP。勿將 FinMind Token、Cloudflare API Token、券商憑證 commit 到儲存庫。

## 實際自動出盤前價需要補的項目
1. 取得具授權的最新 TX 日夜盤近月 1 分 K，處理週五夜盤跨週六、換月、缺口、期交所休市／到期。
2. 以至少 120 個完整盤回推 `P`、`ATR20`、完整 80 筆 `close-open`、`P[-20]`、`P[-120]`、`ATR[-2/-3]`；不得拿當盤未完成K。
3. 以當盤之前的 P40 交易結果算 w/h，重建且驗證當時 R26 `core_signal`。沒有該資料就 BLOCKED。
4. 驗證合約與券商實際 -1/0/+1 TX 部位；R11 歷史模型假設開盤前空手，若已留倉須人工核對、不能產生新倉單。
5. 統一後端資料品質、時間戳記與快照來源：禁止由公開前端自行宣稱資料已驗證。
6. 真實重跑 JS 對照**全部** 2,308 個歷史盤前狀態，且對齊進場、停損、停利與阻擋理由；本 repo 內提供少量 smoke test，不應取代完整 Python 歷史對帳。
7. 經 Cloudflare Dashboard 確認部署記錄、Workers URL 回傳 200、最新特徵源及責任風控全部驗收之後，才可改狀態；本版始終 PAPER ONLY，不自動委託。

## 部署驗收
1. GitHub 確認 main 包含 `public/r11/index.html`、`public/r11/r11-plan.mjs`。
2. Cloudflare → Workers & Pages → `tw-stock-api` → Deployments → 確認 **該 GitHub commit** 建置成功。
3. 開啟 `/r11/`，確定顯示 R11 而非別的站或 404。
4. 確認 `/api/health` 維持正常、舊 `/r1494a/` 等既有網站沒有遭到破壞。
5. 確認 `/api/r11/preopen` 未接通時仍為 BLOCKED；任何歷史價格都不能當成當天可下單價。

如 Cloudflare Builds 未連接、部署受權限限制或 Worker 配置已被外部更動，這一版只能稱為「**GitHub 原始碼已發布**」，不能稱為「Cloudflare 真正上線成功」。

## 2026-11-10 完整盤接續重播

`replay-worker.mjs` 在背景下載並驗證既有凍結分K，分別重播 A 影子策略與 P40，再以先前已完成盤的 P40 損益計算 P193 w/h。新增盤的 OHLC 僅存於手機 IndexedDB，不寫入 GitHub 或 Durable Objects。頁面開啟時可自動補抓期交所已公布的交易日，也可只重播本機資料。

獨立 Python 核對：歷史 2,428 盤、1,361,206 筆分鐘權益及持倉 SHA256 全數一致；另使用官方資料接續 22 盤至 2026/11/10 日盤，共 2,450 盤的 P40 損益、盤末部位、R26 原始方向與阻擋狀態全數一致。核對摘要：`COMPLETE_REPLAY_VERIFIED_20261110.json`。

10/23 颱風休市、10/26 補假，10/22 下午夜盤對應的下一交易日是 10/27。舊第一盤 10/23 標籤已更正。11/6 官方 CSV 解壓大小 104,572,854 bytes，R11 以 150 MB 串流上限解析並核對 CRC，既有 R26 呼叫預設仍維持 100 MB。

此功能顯示已完成盤的研究帳本與下一盤 P193 權重，尚未把當盤完整 R11 特徵與券商部位核對接通。模型持倉不是券商持倉，`tradeable` 一律 false。缺整盤、分鐘缺口、同來源重複OHLC衝突或未驗證換月均會停止；官方完整逐筆轉分鐘可保留無成交分鐘空缺，不補假K。
