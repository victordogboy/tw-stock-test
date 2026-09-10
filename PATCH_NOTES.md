# V1.2 TPEx webpage fallback
- 保留 TPEx official OpenAPI 嘗試。
- 新增 TPEx 官方「上櫃股票行情」網頁 JSON backend fallback。
- 新增 `/api/tpex/debug`，回傳每一個嘗試的 status/location/content-type 與 sample。
- normalizeTpex 支援 object row 與 webpage table array row。
- 全市場 filter 仍保持 partial success，TPEx 掛掉不會拖垮 TWSE。
- Worker version 更新為 1.2.0。
