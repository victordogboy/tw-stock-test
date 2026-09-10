# 台股免費 API Cloudflare V1

這個專案設計成「只用瀏覽器完成部署」：
- GitHub：存放程式碼
- Cloudflare Workers Builds：從 GitHub 自動部署
- 不需要在公用電腦安裝 Node/npm/Wrangler
- 不需要在本機執行任何程式

## API
- `/api/health`
- `/api/twse/all`
- `/api/tpex/all`
- `/api/market/filter?min_close=10&min_lots=3000`
- `/api/finmind?dataset=TaiwanStockPrice&data_id=3443&start_date=2026-01-01&end_date=2026-09-10`

## FinMind Token
不要把 Token 寫進 GitHub。
在 Cloudflare Dashboard：
Worker → Settings → Variables and Secrets → Add → Secret
名稱固定為 `FINMIND_TOKEN`。

## 注意
`wrangler.jsonc` 的 name 是 `tw-stock-api`。
如果你要連到昨天既有的 Worker，Cloudflare 端 Worker 名稱也必須是 `tw-stock-api`。
Cloudflare deployment test
