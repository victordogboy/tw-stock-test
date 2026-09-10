# V1.7.3 強制修正版

這版針對使用者實際測試仍出現的問題，改成更強硬的處理方式。

## 1. 返回後掃描結果消失
不再依賴 history/back 是否保留頁面。
- 點排行榜股票時，個股頁改成「新分頁」開啟。
- 原本 scanner 頁完全不 unload，Top100 結果自然不會被洗掉。
- 同時仍保留 localStorage + sessionStorage 備援。
- 若瀏覽器封鎖 popup，才退回同頁 navigation + restore 機制。
- 個股頁的「← 回到大盤掃描」在新分頁模式會直接關閉個股分頁。

## 2. 頁面永遠顯示 V1.5
原始 V1.7.2 檔案內其實已無 V1.5 字串，因此判斷是舊 HTML cache / 舊 deployment asset。
V1.7.3 Worker 對 `/`, `/scanner.html`, `/detail.html`, `*.html` 強制回：
- Cache-Control: no-store, no-cache, must-revalidate
- Pragma: no-cache
- Expires: 0
- X-App-Version: 1.7.3
並且 title / h1 明確寫成 V1.7.3。

## 3. 個股當日交易量
沿用 V1.7.2：
- summary 方格顯示 audit-day 成交量
- 數值直接取 `cur.volume`
- 拖動歷史盲測 slider 後，成交量跟著 audit date 變
- 同時顯示 5 日均量

## 4. 均線顏色直接顯示在上方對應方格
依 K 線圖實際顏色：
- MA5：黃
- MA10：藍
- MA20：紫
- MA60：綠
上方 toolbar 的 MA5/10/20/60 pill 直接套用同色文字、邊框、底色。

## 5. 台股 K 線顏色
已改成台股慣例：
- 上漲 K：紅色
- 下跌 K：綠色
- 平盤 / 十字：黃色
成交量柱同步沿用該日 K 色。

V4.4 評分、Top100 FinMind 重評、Strict No-Lookahead 皆未修改。
