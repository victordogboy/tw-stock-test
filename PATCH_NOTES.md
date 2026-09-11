# V1.17.0-R1 — Production Source Architecture

這版開始修改正式 Scanner，而不是只做診斷。

## 核心修正
1. Hard Date Gate
   - 新增 `/api/market/target-date`
   - 使用 TWSE `STOCK_DAY` exact-date monthly (2330 benchmark) 判定最新已完成交易日
   - Stage1 每支股票最後一根 K 必須等於 Target Date
   - 舊日期股票不得進排行
   - 缺最新 K 顯示「最新K缺失」，不自行補日期

2. 價格來源
   - 上市：Yahoo 歷史 + fresh=1 時以 TWSE STOCK_DAY exact-date 補最新正式日 K
   - 上櫃：若 Yahoo Daily 尚未更新至 Target，暫不納入正式 Stage1 排名
   - Yahoo 1m 保留做 live/detail，不冒充正式 Daily Volume

3. 籌碼來源改成 Official-first
   - 上市：TWSE 官方 margin / T86 / day-trading 先取
   - FinMind 只補缺少的 series
   - 上櫃：TPEx 官方目前被 Worker redirect/WAF 擋住，因此 FinMind 僅作可用時備援
   - 不再把 FinMind 當正式 Scanner 的必要依賴

4. Scanner
   - Stage1 先做 Target Date Gate 再排名
   - Stage2 改呼叫 `/api/chips/hybrid`
   - 顯示 Target、最新K缺失數、舊日期進排行固定為 0
   - V4.4 / 四分數公式 / Action 公式未修改

## 保留
- Detail 的 V1.14.2-R3 after-close promotion 邏輯保留
- Yahoo 1m volume 不當正式日量
- 無日期不 stamp
