# V1.4.2 診斷按鈕修正

原因：
V1.4.1 將 `diagBtn` click handler 錯誤地放進
`<script src="/v44-engine.js"> ... </script>` 之間。

依 HTML 規則，帶 `src` 的 script 元素內嵌內容不會被執行，
因此「單股回歸」按鈕看得到，但點擊沒有反應。

修正：
- `v44-engine.js` 改成純外部載入 `<script src="/v44-engine.js"></script>`
- 診斷 click handler 移到主 inline script
- 不改 V4.4 scoring engine、API、Yahoo 歷史 K 或掃描邏輯
- Worker version = 1.4.2
