"""Evidence-based weekly backlog; proposals only, never publish UI edits."""
import datetime as dt
from collect import OUT, load, save, now

data = load(OUT / "intelligence.json", {"articles": []})
history = load(OUT / "run-history.json", {"runs": []})
cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)).isoformat()
articles = [a for a in data["articles"] if a["collected_at"] >= cutoff]
failures = [r for r in history["runs"] if r["started_at"] >= cutoff and r["status"] != "success"]
proposals = []
if articles:
    proposals.append({"id":"weekly-verification-" + now()[:10], "evidence_type":"情報影響", "problem":f"本週蒐集 {len(articles)} 筆情報，尚需核實及判斷對查詢流程的影響。", "proposal":"核對官方依據，補齊生效/截止日期；確認後才更新規則資料。", "evidence_urls":[a["url"] for a in articles[:5]], "acceptance":"每項正式規則具有官方連結、查核日期與適用條件。", "status":"待評估"})
if failures:
    proposals.append({"id":"weekly-health-" + now()[:10], "evidence_type":"操作檢查", "problem":f"最近七日有 {len(failures)} 次蒐集異常。", "proposal":"檢查失敗來源與重試結果，確認網站保留舊資料並顯示失敗狀態。", "evidence_urls":["https://github.com/chuyihung-web/miles-advisor/actions/workflows/collect-intelligence.yml"], "acceptance":"失敗與成功但無新資料分開顯示，並能看到最近成功時間。", "status":"待評估"})
save(OUT / "weekly-review.json", {"generated_at":now(), "period_start":cutoff, "method":"依蒐集紀錄產生的規則式週檢查；尚未接入使用者行為分析或 AI 語意核實。", "proposals":proposals, "release_policy":"介面先預覽，使用者確認指定版本後才發布；本流程只更新建議資料。"})
