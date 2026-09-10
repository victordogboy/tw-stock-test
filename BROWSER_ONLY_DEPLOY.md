# 純瀏覽器部署步驟（公用電腦）

## A. GitHub
1. 登入 GitHub。
2. New repository。
3. Repository name 建議：`tw-stock-api`
4. 建立空白 repo，不需要 README 模板。
5. `Add file` → `Upload files`。
6. 把本 ZIP 解壓後的「內容」上傳：
   - src/
   - public/
   - wrangler.jsonc
   - package.json
   - README.md
7. Commit changes。

## B. Cloudflare
### 若要沿用昨天的 `tw-stock-api` Worker
1. Cloudflare → Workers & Pages。
2. 點 `tw-stock-api`。
3. Settings → Builds。
4. Connect。
5. 選 GitHub repo `tw-stock-api`。
6. Production branch：`main`
7. Build command：留空。
8. Deploy command：`npx wrangler deploy`
9. Root directory：留空。
10. Save / Deploy。

### 若改建新的 Worker
1. Workers & Pages → Create application。
2. Import a repository。
3. 選 GitHub repo。
4. Worker name 必須與 wrangler.jsonc 的 `name` 相同，也就是 `tw-stock-api`。
5. Build command 留空；Deploy command 保持 `npx wrangler deploy`。
6. Save and Deploy。

## C. FinMind Token（建議）
Cloudflare → tw-stock-api → Settings → Variables and Secrets
新增 Secret：
- Name: `FINMIND_TOKEN`
- Value: 你的 FinMind token

不要把 token 放在 GitHub。

## D. 驗證
開啟：
`https://tw-stock-api.<你的 workers.dev 子網域>/`

依序按：
1. 測試 Worker
2. 測試 TWSE
3. 測試 TPEx
4. 免費成交量先篩
5. 測試 FinMind

只要把畫面結果或錯誤訊息截圖給我，我就能往下一階段接 V4.4。
