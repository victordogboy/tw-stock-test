# V1.17.0-R14 — Detail 籌碼與現價區恢復

這版只處理使用者截圖暴露的兩個 Detail 問題。

## 1. Scanner 100%，Detail 卻空白
Root cause：
R8 之後手動按「分析」時，Detail 被刻意禁止使用 Scanner snapshot。
因此 Scanner 已經拿到 100% 籌碼，進個股頁後強制重抓若 FinMind/TWSE 只回部分資料，
Detail 反而會把完整資料洗成 0~2 日。

R14：
- Scanner snapshot 變成 Detail 的 baseline。
- 每次「分析」仍真的重抓 Hybrid/FinMind/TWSE。
- fresh 結果與 baseline 依日期合併。
- 同日期 fresh 覆蓋 snapshot。
- Detail 永遠不應比 Scanner 點進來時的資料更差。

## 2. 現貨狀況 / 更新按鈕消失
Root cause：
TODAY 卡原本 `display:none`，只有 `/api/intraday` 成功後才顯示。
Yahoo intraday 一旦 503/失敗，整張卡連同「更新盤中資料」按鈕一起消失。

R14：
- 分析完成就先顯示 TODAY 卡。
- intraday 成功：顯示真正現價與 Live score。
- intraday 失敗：顯示最近正式日K作 fallback，並保留「更新盤中資料」按鈕讓使用者重試。
- 不再因 Yahoo 暫時失敗把整區藏掉。

## 保留
- R13 Token 修正
- R10 Scanner intraday 503 fallback
- R9 上市融資歷史 MI_MARGN fallback
- V4.4 / Action 不變
