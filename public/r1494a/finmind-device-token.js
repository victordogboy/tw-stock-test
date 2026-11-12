/* FinMind Token: stored only in this browser origin's localStorage.
 * No token is embedded in HTML/GitHub, sent to the website backend, or logged.
 * Explicit connection test transmits the token directly to FinMind.
 */
(function () {
  "use strict";
  function ready() {
    const manager = window.TWFinMindTokens;
    const input = document.getElementById("deviceFinmindToken");
    const save = document.getElementById("deviceFinmindSave");
    const check = document.getElementById("deviceFinmindTest");
    const clear = document.getElementById("deviceFinmindClear");
    const status = document.getElementById("deviceFinmindStatus");
    if (!manager || !input || !save || !check || !clear || !status) return;
    const say = (message) => { status.textContent = message; };
    const current = () => manager.activeToken();
    const update = () => {
      say(current()
        ? "已在這台裝置的此瀏覽器儲存 Token。其他裝置或瀏覽器不會由本網站同步。"
        : "此瀏覽器尚未儲存 FinMind Token。");
    };
    update();
    save.addEventListener("click", () => {
      const token = input.value.trim();
      if (!token || /\s/.test(token) || token.length < 20) {
        say("請輸入完整的 FinMind Token（至少 20 字元、不可包含空白）。");
        return;
      }
      try {
        const state = manager.read();
        state.tokens[state.active] = token;
        manager.write(state);
        input.value = ""; // Avoid keeping the token in visible form fields.
        update();
        document.dispatchEvent(new CustomEvent("finmind-device-token-change"));
      } catch (_) {
        say("本瀏覽器禁止本機儲存；無法記住 Token。請允許網站儲存空間。");
      }
    });
    clear.addEventListener("click", () => {
      try {
        manager.write({ tokens: ["", ""], active: 0 });
        input.value = "";
        update();
        document.dispatchEvent(new CustomEvent("finmind-device-token-change"));
      } catch (_) {
        say("清除失敗：請檢查瀏覽器本機儲存權限。");
      }
    });
    check.addEventListener("click", async () => {
      const token = current();
      if (!token) { say("請先輸入並儲存 Token，再進行測試。"); return; }
      check.disabled = true;
      say("直接向 FinMind 驗證資料存取中（不會將 Token 傳給本站伺服器）…");
      const controller = new AbortController();
      const abort = setTimeout(() => controller.abort(), 12000);
      try {
        const from = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);
        const query = new URLSearchParams({ dataset:"TaiwanStockPrice", data_id:"2330", start_date:from });
        const res = await fetch("https://api.finmindtrade.com/api/v4/data?" + query, {
          method: "GET",
          headers: { Authorization: "Bearer " + token, Accept: "application/json" },
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal
        });
        if (res.status === 429) { say("FinMind 已達 API 請求限制；Token 仍保存在本裝置。"); return; }
        if (res.status === 401 || res.status === 403) { say("FinMind 拒絕授權；請檢查 Token 或資料方案。"); return; }
        const data = await res.json();
        if (res.ok && Number(data.status) === 200 && Array.isArray(data.data) && data.data.length > 0) {
          say("FinMind API 連線成功，取得台積電近期日線 " + data.data.length + " 筆。Token 僅保存在本裝置瀏覽器。");
        } else {
          say("FinMind 未回傳有效測試資料；請檢查 Token、API 額度及資料權限。");
        }
      } catch (err) {
        say(err && err.name === "AbortError"
          ? "FinMind 測試逾時，已儲存的 Token 不受影響。"
          : "無法在瀏覽器直接測試 FinMind（可能為網路或 CORS 跨站限制），不代表 Token 無效。");
      } finally { clearTimeout(abort); check.disabled = false; }
    });
    window.C26DeviceFinMind = Object.freeze({
      activeToken: () => manager.activeToken(),
      headers: (extra) => manager.headers(extra || {})
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once:true });
  else ready();
})();
