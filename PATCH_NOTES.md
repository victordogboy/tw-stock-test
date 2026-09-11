# V1.17.0-R13 — FinMind Token Scope Fix

R12 的問題已定位為程式 bug，不是先判定 Token 次數用完。

## Root cause
R12 在 `export default.fetch()` 裡宣告：
`const EFFECTIVE_FINMIND_TOKEN = ...`

但真正處理 `/api/...` 的 `routeApi()` 是另一個函式 scope，
卻直接使用 `EFFECTIVE_FINMIND_TOKEN`。

結果：
- `/api/finmind/status` 會 ReferenceError
- `/api/chips/hybrid` 內的 FinMind token/cache 邏輯也會 ReferenceError
- 前端因此顯示「TOKEN 狀態確認失敗」
- Scanner 籌碼完整度大量變成 0%

## R13
- 把 `EFFECTIVE_FINMIND_TOKEN` 移到 `routeApi()` 內建立。
- 所有 status / hybrid / recheck / FinMind query 共用同一個有效 Token。
- Browser Token 仍透過 Authorization Bearer 傳入。
- 若瀏覽器未輸入 Token，才退回 Cloudflare Secret。
- Token/匿名 cache 分流保留。

這一版只修 Token scope，不改 V4.4、Scanner 排名、融資歷史演算法。
