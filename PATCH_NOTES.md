# V1.1 TPEx fallback
- TPEx 改為多個官方 OpenAPI endpoint 嘗試，redirect 採 manual，避免 Too many redirects。
- 回傳 attempts 診斷每個 endpoint 的 HTTP status / Location。
- 全市場初篩改為容錯：TWSE 或 TPEx 任一成功就仍回傳結果，並標記 partial。
- 不修改任何 V4.4 評分邏輯。
