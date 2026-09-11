# V1.15.1 — API JSON / Scanner hotfix

修正全市場掃描按下後只顯示 `non-json` 的問題。

## Worker
- 所有 `/api/*` 路由加入最外層 try/catch。
- 即使 Worker/上游發生例外，也一定回 JSON：
  - error
  - path
  - version
- 不再讓 Cloudflare 預設 HTML 500 頁面傳回 Scanner。

## Scanner
- `getJSON()` 改為先讀文字、再明確 JSON.parse。
- API 失敗自動重試最多 3 次。
- 每次加入 cache-buster，避免拿到錯誤快取。
- 非 JSON 時會顯示 HTTP status、API 路徑、content-type、回應片段。
- 開始新掃描時先清掉舊榜單/舊 Universe 統計，避免舊畫面讓人誤以為本次 Universe 已成功。
- 若仍失敗，會顯示真正是哪個 API 出錯，不再只顯示 `non-json`。
