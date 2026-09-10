# V1.6.1 TWSE 免費籌碼 + 返回掃描

新增：
- `/api/chips/twse?code=3443&days=12`
- 來源全部使用 TWSE 官方公開資料：
  - 融資融券：MI_MARGN
  - 三大法人：T86 官方日報後端
  - 當沖：OpenAPI TWTB4U，必要時用官方日報後端 fallback
- Cloud 個股頁將上述資料轉成 V4.4 原本使用的 FinMind-compatible 欄位。
- 由於免費版目前只抓近期樣本，Factor 7 改成至少 5 筆才啟用，文字改為「近期樣本百分位」，避免假裝是 90T。

返回功能：
- 個股完整頁新增「← 回到大盤掃描」
- 從 scanner 點入時使用 history.back()
- scanner 結果同步存在 sessionStorage，返回後即使頁面重載也恢復上次排行榜，不需重掃 195 檔。

限制：
- 目前籌碼查詢最多 12 個平日，以控制單次 Worker upstream subrequests。
- 真正 90T 籌碼序列下一階段應使用 Cloudflare D1/KV 每日累積，而不是每次頁面即時回抓 90 天。
