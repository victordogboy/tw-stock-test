# V1.16.0-R7 — Audit Swagger Fallback
修正 R6 畫面顯示 `tpex swagger failed: error code: 520` 後整輪中止。

- Swagger 現在只負責 discovery，不再是 Audit 的單點故障。
- TWSE/TPEx Swagger 失敗時，自動使用內建官方 endpoint catalog。
- 每個 endpoint 仍會真正發 HTTP request，個別記錄 PASS/FAIL/HTTP/耗時/筆數/日期。
- TPEx endpoint 失敗不會阻止 TWSE、FinMind、TDCC 或其他 TPEx endpoint 繼續測。
- Scanner / V4.4 / Action 未修改。
