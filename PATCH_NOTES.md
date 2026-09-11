# V1.17.0-R4 — Self-Checked Regression Fix

針對 R3 實際截圖先找 bug、做回歸檢查，再封包。

## R3 找到的確定漏洞
1. **錯用 Yahoo 1m volume 做最低成交量門檻**
   - Audit 已證明 Yahoo 1m 的日累積量可能顯著低於正式 Daily volume。
   - R3 把 9/11 暫定 K 的 Yahoo 1m volume 直接套 3000 張門檻，造成大量股票被錯殺成「低於最低成交量」。
   - R4：Target 日若是暫定 K，價格/結構仍用 Target 日；但流動性門檻使用前一個 completed Daily 的 volume。
   - 正式化後再由正式日 K 更新 volume。

2. **確定的 ReferenceError**
   - R3 worker 仍有 `yahooLast:j.last`，但該 scope 已沒有 `j`。
   - R4 已移除。

3. **Stage1 日期防線不足**
   - 每支股票進 results 前強制 `dataDate === Target`。
   - 全池排名前再檢查一次；任何 9/10 混入 9/11 Target，直接報內部檢查失敗，不允許偷偷排名。

## 本地回歸檢查
- Worker Node syntax：PASS
- Scanner inline JS：PASS
- Detail inline JS：PASS
- Index inline JS：PASS
- undefined `j.last`：PASS
- 1m volume 錯殺案例：PASS
  - 前一正式日 5000 張 / Yahoo 1m 900 張 / 門檻 3000 → 應通過
- 真低量案例：PASS
  - 前一正式日 1200 張 / 門檻 3000 → 應略過
- Target 9/11 接受 9/11：PASS
- Target 9/11 拒絕 9/10：PASS
- Official-first hybrid wiring：PASS
- 誤用 TWTB4U OpenAPI 當沖 fallback：已移除

## 未修改
- V4.4 四分數公式
- Action
- Detail V1.14.2-R3 after-close promotion 核心
