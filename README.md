# 哩程開票顧問：雲端情報流程

現有網站：https://chuyihung-web.github.io/miles-advisor/

情報功能預覽：https://chuyihung-web.github.io/miles-advisor/intelligence.html

## 排程與發布邊界

- GitHub Actions `collect-intelligence.yml`：每天 01:00 UTC，即台灣 09:00。GitHub 排程可能延遲，網站顯示實際執行時間。
- `weekly-review.yml`：週一台灣 09:30；依執行紀錄產生提案，沒有使用者行為分析或 AI 語意查核。
- `pages.yml` 與資料工作流程將 docs 部署到 GitHub Pages。資料更新不修改原有 index.html 或 award_charts.json。
- 介面修改先預覽，使用者確認指定版本才發布到主要操作流程。
- GitHub 公開專案久未有活動時排程可能停用；請檢查 Actions enabled 狀態。資料更新提交會保留活動，但無法承諾平台永久不停用。

## 來源與核實

`config/sources.json` 是已檢查來源的白名單。只啟用發布者提供的 RSS，僅保存標題、日期、原文網址。文章預設待核實，不把 RSS 可讀當成哩程規則已驗證。

航空官方頁面只作人工查核依據，尚未建立頁面擷取授權。Facebook 未提供已驗證粉專與存取權限，維持未啟用。

來源設定可透過 `SOURCE_REGISTRY_URL` repository variable 讀取專用 Apps Script JSON。設定此值後，來源表失敗時停止擷取，不會偷偷以舊設定覆蓋使用者的暫停指示。未設定前明確記錄 repository_config。

## Google Sheets 橋接

`google-apps-script/Code.gs` 對應來源管理表中的綁定專案；部署需 Google 授權。它的公開 GET 只回傳已知公開來源，不回傳備註、私人欄位、情報紀錄或任何憑證。新填來源需先驗證並加入白名單，才會啟用。

`installMileageSync()`：首次同步後建立每小時同步與週一 11 點左右的週檢查提案同步。Google 觸發時間可能有偏移。無人值守執行由 Google 服務完成，不依賴個人電腦。

不以「成功無新資料」掩蓋來源失敗。失敗保留舊情報、寫入執行紀錄、使 Actions 顯示失敗；GitHub 的個人通知設定決定是否發信。

### 2026-11-18 首次自然排程驗收

`installTomorrowMileageCheck()` 建立台灣時間 2026-11-18 11:00 的一次性 Google 雲端觸發器。檢查當天的 GitHub `schedule` 事件、網站發布資料、來源狀態、表格同步時間與執行ID、情報ID去重及完整性。正常只寫入「自動驗收紀錄」；讀取失敗或任一檢查不符會拋出具體錯誤，由 Google 的觸發器失敗通知寄信。通知頻率設為立即。這不使用本機排程，不改動UI或兌換資料，也不將手動測試冒充明日自然觸發。

## 驗證

`python3 -m unittest discover -s tests -v`

雲端第一次工作流程成功並讀回網站 JSON 才證明即時串接；定時觸發需看第一次 schedule 事件記錄，手動執行不冒充已驗證定時觸發。
