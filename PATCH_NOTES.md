# V1.7.1 掃描結果保留重大修正

問題：
點入個股 detail.html 後返回 scanner，整個排行榜被清空。

根因：
- V1.7 的 results 主要只存在 JavaScript 記憶體。
- 頁面 navigation 後若瀏覽器沒有保留 BFCache，scanner 重新載入即失去 results。
- 第二階段 FinMind 重評後也沒有可靠地把「最終 Top100」持久化。

修正：
1. 最終掃描結果存入 sessionStorage + localStorage 雙保險。
2. 只保存必要欄位，移除大型 `_hist`，避免 storage 超限。
3. pagehide / beforeunload / visibility hidden 時自動保存。
4. 點排行榜個股前強制 `persistScan()`。
5. detail URL 加 `?from=scanner`。
6. 「← 回到大盤掃描」優先 history.back；失敗時回 scanner.html，scanner 自動 restore。
7. scanner 載入時自動恢復：
   - 排行結果
   - 目前選中的排行 tab
   - status / stats / progress
8. 新的掃描只有在使用者真的按「開始兩階段掃描」時才清除舊結果。

不修改：
- V4.4 engine
- Top100 FinMind 重評
- 決策排序公式
- Yahoo/TWSE API
