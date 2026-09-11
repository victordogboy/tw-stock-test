# V1.17.0-R15 — FinMind Token 7 日伺服器暫存

本版只修改 Token 儲存，不修改其他功能。

## 行為
- 「套用 TOKEN」：
  1. 照舊存目前瀏覽器 localStorage。
  2. 同時存到 Cloudflare Worker Cache 7 天。
- 換裝置後若仍使用同一網站，沒有瀏覽器 Token 時，Worker 會自動使用伺服器暫存 Token。
- 「清除 TOKEN」會同時清除此瀏覽器與伺服器暫存。
- Status 只回報來源/到期日，不回傳 Token 本身。

## 優先順序
瀏覽器 Token > Cloudflare FINMIND_TOKEN Secret > 7日伺服器暫存 > 匿名。

## 明確未動
- V4.4 engine：byte-identical
- Scanner 排名/Stage1/Stage2
- TPEx Universe
- K 線來源
- 籌碼計算/完整度公式
- 個股 Detail 籌碼合併
- 現價/盤中更新
- Action / Setup / Opportunity / Entry / Hold

注意：Cloudflare Cache 是快取型儲存，通常可跨重新開啟使用，但平台仍可能提早清除；若要保證永久跨裝置，需要 KV/Durable Object。Token 本身 7 天失效，因此此版 TTL 固定 7 天。
