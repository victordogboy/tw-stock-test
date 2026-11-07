# 啟用研究下載器「一鍵完整 ZIP」所需的 Cloudflare R2

目前 GitHub 專案尚未有 R2 bucket / binding。**請先建立 R2，才可在雲端真正合併成固定檔案；沒有 R2 時舊下載器不受影響。**

## 建立私有 R2 儲存桶

1. 在部署 tw-stock-api 的同一個 Cloudflare 帳號中，進入 R2 Object Storage → Create bucket。
2. 建立一個不公開的 bucket，名稱為 **tw-research-archives**。請勿開啟 Public Development URL 或公開自訂網域。
3. 原本若由 GitHub/Wrangler source deployment 部署，在 wrangler.jsonc 的頂層增加下列設定，然後重新部署：

    "r2_buckets": [
      { "binding": "RESEARCH_ARCHIVES", "bucket_name": "tw-research-archives" }
    ]

   頂層 JSONC 請注意與其他欄位用逗號分隔。**bucket 建立之前不要添加這個綁定，否則部署可能失敗，影響現有網站。**

4. 如果是 Cloudflare Dashboard 手動部署，可以在 Workers & Pages → tw-stock-api → Settings → Bindings → Add → R2 Bucket，選擇 tw-research-archives，binding 名稱輸入 **RESEARCH_ARCHIVES**。但未來若改回 Wrangler source deployment，一樣必須把對應設定放進 wrangler.jsonc。
5. 開啟 /research-pack-download.html，重新整理後確認「R2 儲存服務：已綁定」。

## 完成資料後的一鍵備份

資料抓取背景任務完成後，若 R2 已綁定，程式會自動開始建立**固定的 ZIP64**。每輪以一個年度／批次／股票分包為進度檢查點，使用 R2 multipart 每 8MiB 上傳一段；上傳失敗可以重試原區塊，原始 FinMind 資料不會重新抓取。

Cloudflare R2 未完成的 multipart 上傳會在 7 天後自動中止；極大型全市場資料若合併超過七天，可能需要重建 ZIP，原始 CSV.gz 仍保留。

固定 ZIP 完成後，會檢查 R2 物件大小和 ZIP64 EOCD 結尾索引；通過後才開放私人一鍵下載。HTTP Range 206 支援可續傳下載工具。

**單一 ZIP 內容為兩層結構**：
- 最外層包含 manifest.json、README.txt 與 yearly/YYYY/batch_N/part_NNN.zip。
- 各年度子 ZIP 包含按資料集分類的 01_stock_price、02_institutional 等原始 CSV.gz 和子包 manifest。

**完整性界線**：已檢查長度和結尾索引，但尚未從 R2 全檔重新讀回檢查每個成員的 CRC。仍必須在本地驗證外層 ZIP、各內層 ZIP 及 CSV.gz，並對比實際資料筆數及缺漏。不能只因 ZIP 完成就宣稱 2000–2026 的原始資料完整。

## 安全

- bucket 必須保持私有，僅透過原本 HttpOnly 任務 cookie 讀取。
- 不要公開 FinMind S Token，也不要把 Token 存入 ZIP。
- 資料集失敗、缺漏和公告日期不明，必須保留在 manifest。
- 不得將沒有真實歷史公布時間的財報或法人數據當作早已知道。
