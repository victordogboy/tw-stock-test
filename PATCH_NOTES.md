# V1.9.0 — 四分數獨立 + 日期一致性架構修正

## 四分數完全獨立
- Setup：只回答「型態/結構品質好不好」。
- Opportunity：只回答「行情是否正在/可能開始發動」。
- Entry：只回答「今天這個價格是否值得買」。
- Hold：只回答「已持有部位是否值得續抱」。
- 移除 Opportunity<55 → Entry cap 68 等跨分數硬限制。
- Entry 改以 Entry Quality 為主、Persistence 為輔，不再把 Opportunity 混進 Entry 分數。
- 四分數只在最後策略標籤組合，不互相改分數。

策略標籤例：
- 高 Setup + 高 Entry + 尚未發動 → 低風險布局
- 高 Setup + 高 Opportunity + 高 Entry → 主升候選
- 高 Opportunity + 低 Entry → 強勢但勿追
- 低 Setup + 高 Opportunity → 事件型短打
- 高 Hold + 低 Entry → 續抱・新單不追

## 日期修正
- 移除 V1.8.2「用 2330 日期替 STOCK_DAY_ALL 整批貼日期」的做法。
- STOCK_DAY_ALL 只用於 universe / prefilter，不再被當成具明確交易日的 K 棒。
- Scanner 上市股重新以 `/api/history/auto?fresh=1` 的 TWSE STOCK_DAY 明確日期資料計算。
- Detail 與 Scanner 使用同一條 fresh history 邏輯。
- 保留台股 tick-size 正規化，避免 10.850000381469727 之類浮點殘值。

## 背景掃描
本 ZIP 尚未把掃描改成 Cloudflare Workflows，因為真正的 server-side durable job 需要部署 Workflow binding/class，
不能只在現有前端假裝「背景執行」。下一個背景工作版本應把 scan orchestration 搬到 Cloudflare server-side。
