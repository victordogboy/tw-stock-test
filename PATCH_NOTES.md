# V1.11.3 — Scanner 全按鈕無反應修正

這次找到真正原因，不是盤中 API。

使用 Node 對實際部署包的 inline JavaScript 做語法檢查後，Scanner 主程式報：
`SyntaxError: Identifier 'row' has already been declared`

因為同一個 scope 內重複宣告 `const row`，瀏覽器在載入 Scanner 時整段 JavaScript 直接拒絕執行，所以畫面可以顯示，但所有按鈕都沒有事件。

V1.11.3：
- 修正 Scanner 重複 `const row` 宣告。
- 保留 V1.11.2 隔離式盤中資訊。
- 對 scanner.html / detail.html / index.html 的所有 inline script 全部執行 Node `--check`。
- 全部語法檢查通過才打包。
