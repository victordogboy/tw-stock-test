# V1.11.1 — 按鈕失效 Hotfix
V1.11.0 的盤中功能新增了直接 DOM onclick 綁定。若瀏覽器/Cloudflare 暫時混到不同版本 HTML，該可選元件不存在時會拋例外，造成同一 script 後面的事件初始化中斷，表面上就像很多按鈕一起失效。

修正：
- 盤中按鈕改為存在才 addEventListener。
- 盤中 API 載入改成非阻塞 optional task。
- 盤中功能失敗不得影響分析、回最新、追蹤、歷史 slider、返回掃描等既有功能。
