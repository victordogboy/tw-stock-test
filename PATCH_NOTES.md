# V1.9.1 — 核心審計修正版

真正根因已找到：
V1.9.0 的 `entryEngine()` return 物件引用了不存在的 `penalties`，造成 ReferenceError。
Scanner 又把錯誤吞掉後使用 fallbackScore；fallbackScore 把同一個 trend 分數複製給 Setup / Opportunity / Hold，
因此才會出現 100/100/100、70/70/70、66/66/66 這種假排名。

本版：
- 移除 undefined `penalties`。
- 引擎錯誤直接略過股票，不再產生 fallback 假分數。
- Setup = 65% market structure + 35% optimal structure，不混 ignition。
- Opportunity 使用自己的事件/動能/突破模型。
- Entry = 82% Entry Quality + 18% Persistence，不讀 Setup / Opportunity / Hold。
- Hold 只看既有部位存活性：MA5/10/20、均線方向、HL、hard break、bias、risk。
- TPEx 名稱自動判斷 UTF-8 / Big5，修正 `����`。
- 每檔進榜前檢查四分數必須是 0~100 的有限值。

四分數只在最終 Strategy Tag 組合，分數本身互不限制。
