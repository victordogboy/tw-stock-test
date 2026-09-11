# V1.17.0-R11 FinMind TOKEN 設定

R10 原本其實已經能讀取 `env.FINMIND_TOKEN`，R11 把它正式做成可確認狀態的功能，並把 Token/匿名 Cache 分流。

## Cloudflare 網頁設定
1. 進入 Cloudflare Dashboard。
2. Workers & Pages → `tw-stock-api`。
3. Settings → Variables and Secrets。
4. 新增 **Secret**：
   - Variable name: `FINMIND_TOKEN`
   - Value: 你的 FinMind token
5. 儲存後重新 Deploy Worker。

不要把 token 寫進 GitHub、HTML 或 ZIP。

重新整理 Scanner / 個股頁後，標題下方應看到：
`✓ FinMind TOKEN 已啟用`

如果仍顯示未設定，代表 Cloudflare Secret 尚未套用到目前部署。
