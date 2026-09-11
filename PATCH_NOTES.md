# V1.16.0-R8 — Cross-check Audit
- Scanner / V4.4 / Action 未修改。
- 新增 `/crosscheck-audit.html`。
- 新增 `/api/audit/tpex-transport`：TPEx OpenAPI v1、OpenAPI alternate、官網查詢 backend，manual redirect 診斷。
- 同頁逐項比較 TWSE / TPEx 官方候選與 FinMind：
  價格、融資融券、三大法人、當沖、借券、估值。
- 日期不可驗證時顯示 `?`，不自行補日期。
- TPEx transport 保存 Location / Content-Type / preview，定位 redirect / WAF 問題。
