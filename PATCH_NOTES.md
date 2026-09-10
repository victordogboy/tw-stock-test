# V1.4 V4.4 TWSE Scanner
- 保留 V1.3 API 測試與歷史 K。
- 新增 `/scanner.html`。
- TWSE 全市場先用股價/成交量篩選。
- 候選股才抓 Yahoo 約 300 日歷史 OHLCV。
- 預設 concurrency=4、每檔後節流，避免一次爆量請求。
- 單檔失敗不中止整體。
- 載入從正式 `tw_stock_quant_audit_v4_4_followthrough.html` 抽出的 V4.4 engine。
- 排名：綜合、Opportunity、Entry、Bottom、Ignition、Trend。
- TPEx 失敗不阻塞 TWSE 主線。
