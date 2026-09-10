# V1.7.8 — 手機一鍵更新機制升級

這版主要修 GitHub 手機更新流程。

以前：
- GitHub Action 只監聽 `update.zip`
- 上傳 `update-v1.7.7.zip` 不會觸發

現在：
- 任何 `update*.zip` 都會觸發，例如：
  - update.zip
  - update-v1.7.8.zip
  - update-v1.8.zip
  - update-v2.0.zip
- Action 會優先抓「這次 commit 剛上傳的 update*.zip」
- 自動解壓並保留 public/、src/ 等資料夾結構
- 自動 Commit
- Cloudflare 繼續自動部署

重要：
第一次升級到 V1.7.8 時，因為你目前舊 Action 仍只認 `update.zip`，
請把我提供的 `update.zip` 上傳一次。
這次成功後，未來就可以直接上傳帶版本號的 `update-vX.X.X.zip`，不用再改名。
