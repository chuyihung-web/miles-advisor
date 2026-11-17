"""Cloud RSS metadata collection. Never changes award charts or UI source."""
import datetime as dt
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import socket
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/data"
MAX_BYTES = 2_000_000


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def load(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)


def safe_url(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme != "https" or not p.hostname or p.username or p.password or p.port not in (None, 443):
        raise ValueError("只接受無帳密的公開 HTTPS 網址")
    for a in socket.getaddrinfo(p.hostname, 443, type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(a[4][0]).is_global:
            raise ValueError("不接受私人網路網址")
    return url


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url):
    safe_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": "MilesAdvisor/1.0 (+https://chuyihung-web.github.io/miles-advisor/) RSS metadata reader"})
    for attempt in range(3):
        try:
            with urllib.request.build_opener(Redirects).open(request, timeout=25) as response:
                body = response.read(MAX_BYTES + 1)
                if len(body) > MAX_BYTES:
                    raise ValueError("來源超過大小上限")
                return body
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def canonical(url):
    p = urllib.parse.urlsplit(url.strip())
    if p.scheme != "https" or not p.hostname or p.username or p.password:
        raise ValueError("文章連結不是有效 HTTPS 網址")
    query = [(k, v) for k, v in urllib.parse.parse_qsl(p.query) if not k.lower().startswith("utm_")]
    return urllib.parse.urlunsplit((p.scheme, p.netloc.lower(), p.path, urllib.parse.urlencode(query), ""))


def date_value(raw):
    if not raw:
        return None
    try:
        value = parsedate_to_datetime(raw)
    except (ValueError, TypeError):
        try:
            value = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not value.tzinfo:
        return None
    return value.astimezone(dt.timezone.utc).isoformat()


def category(title):
    text = title.lower()
    if "transfer" in text:
        return "轉點資訊"
    if any(word in text for word in ("bonus", "offer", "deal", "% off")):
        return "限時優惠"
    if any(word in text for word in ("guide", "how ", "award", "redeem")):
        return "兌換教學"
    return "其他"


def parse_feed(body, source, timestamp):
    if b"<!DOCTYPE" in body.upper() or b"<!ENTITY" in body.upper():
        raise ValueError("不支援含外部實體的 XML")
    root = ET.fromstring(body)
    ns = {"a": "http://www.w3.org/2005/Atom"}
    if root.tag == "rss" and root.find("channel") is not None:
        entries = root.findall("./channel/item")
        atom = False
    elif root.tag == "{http://www.w3.org/2005/Atom}feed":
        entries = root.findall("a:entry", ns)
        atom = True
    else:
        raise ValueError("回應不是有效的 RSS/Atom（可能為登入頁或阻擋頁）")
    result = []
    for item in entries[:100]:
        title = item.findtext("a:title" if atom else "title", default="", namespaces=ns).strip()
        if atom:
            links = item.findall("a:link", ns)
            link = next((x.get("href", "") for x in links if x.get("rel", "alternate") == "alternate"), "")
            raw_date = item.findtext("a:published", namespaces=ns) or item.findtext("a:updated", namespaces=ns)
        else:
            link = item.findtext("link", "")
            raw_date = item.findtext("pubDate")
        if not title or not link:
            raise ValueError("RSS 文章缺少標題或連結，需檢查來源格式")
        url = canonical(link)
        title = " ".join(title.split())[:300]
        fingerprint = hashlib.sha256((title + "\n" + url).encode()).hexdigest()
        result.append({"id": hashlib.sha256(url.encode()).hexdigest()[:24], "source_id": source["id"],
                       "source": source["name"], "url": url, "title": title,
                       "published_at": date_value(raw_date), "collected_at": timestamp,
                       "verification": "待核實", "official_evidence": None,
                       "fingerprint": fingerprint, "category": category(title)})
    return result


def merge(existing, incoming):
    records = {a["id"]: a for a in existing}
    new = changed = 0
    for article in incoming:
        previous = records.get(article["id"])
        if previous is None:
            records[article["id"]] = article
            new += 1
        elif previous["fingerprint"] != article["fingerprint"]:
            article["collected_at"] = previous["collected_at"]
            article["changed_at"] = now()
            records[article["id"]] = article  # Changed claims must be rechecked.
            changed += 1
        else:
            records[article["id"]]["category"] = article["category"]
    return sorted(records.values(), key=lambda a: a["collected_at"], reverse=True)[:1000], new, changed


def main():
    timestamp = now()
    run_id = os.environ.get("GITHUB_RUN_ID", "manual-" + timestamp)
    registry_url = os.environ.get("SOURCE_REGISTRY_URL", "").strip()
    registry_state = "repository_config"
    registry_error = None
    config = load(ROOT / "config/sources.json", {"sources": []})
    if registry_url:
        try:
            remote = json.loads(fetch(registry_url))
            if remote.get("version") != 1 or not isinstance(remote.get("sources"), list):
                raise ValueError("來源管理表介面格式錯誤")
            config = remote
            registry_state = "google_sheets"
        except Exception as exc:
            # Fail closed: a Sheet pause must never be silently ignored by a fallback.
            registry_state = "failed"
            registry_error = type(exc).__name__ + ": " + str(exc)[:180]
            config = {"sources": []}
    records = load(OUT / "intelligence.json", {"articles": []})["articles"]
    checks = []
    for source in config["sources"][:100]:
        check = {"source_id": source["id"], "source": source["name"], "checked_at": timestamp, "new": 0, "changed": 0}
        if not source.get("enabled") or source.get("method") != "官方 RSS/Atom" or not source.get("feed_url"):
            check.update(status="skipped", detail="人工核實來源／暫停／尚未確認 RSS")
        else:
            try:
                incoming = parse_feed(fetch(source["feed_url"]), source, timestamp)
                records, added, changed = merge(records, incoming)
                check.update(status="success_new" if added or changed else "success_no_new", new=added, changed=changed, fetched=len(incoming))
            except Exception as exc:
                check.update(status="failed", detail=(type(exc).__name__ + ": " + str(exc))[:220])
        checks.append(check)
    failures = sum(c["status"] == "failed" for c in checks) + bool(registry_error)
    status = "failed" if registry_error else "partial_failure" if failures else "success"
    report = {"run_id": run_id, "started_at": timestamp, "finished_at": now(), "status": status,
              "registry": registry_state, "registry_error": registry_error, "checks": checks,
              "facebook": "未啟用：未提供已驗證粉專與可用授權", "schedule_timezone": "Asia/Taipei", "schedule_target": "09:00"}
    previous_data = load(OUT / "intelligence.json", {})
    last_success = timestamp if status == "success" and any(c["status"].startswith("success") for c in checks) else previous_data.get("last_success_at")
    save(OUT / "intelligence.json", {"schema_version": 1, "updated_at": timestamp, "last_success_at": last_success, "articles": records, "latest_run": report})
    history = load(OUT / "run-history.json", {"runs": []})["runs"]
    save(OUT / "run-history.json", {"runs": ([report] + [r for r in history if r["run_id"] != run_id])[:60]})
    save(OUT / "source-status.json", {"updated_at": timestamp, "registry": registry_state, "sources": config["sources"], "checks": checks})
    print(json.dumps({"run_id": run_id, "status": status, "articles": len(records), "checks": checks}, ensure_ascii=False))
    # Failed jobs notify via GitHub while successfully written failure records remain visible.
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
