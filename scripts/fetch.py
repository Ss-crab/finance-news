#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取过去 24 小时的公开财经新闻，归一化后输出 docs/raw_news.json。

覆盖市场：A股/中国、美股/全球宏观、港股、加密/大宗商品/外汇、中美债券。
所有源均为免费公开源，无需 API key。逐源记录健康状态，单源失败不影响整体。
"""

import json
import os
import sys
import uuid
import urllib.parse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

try:
    import requests
    import feedparser
except ImportError as exc:  # pragma: no cover
    print(f"[FATAL] 缺少依赖，请 pip install -r scripts/requirements.txt: {exc}", file=sys.stderr)
    sys.exit(1)

# Windows 控制台默认 GBK，重配置为 UTF-8，避免中文输出触发 UnicodeEncodeError
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

REQUEST_TIMEOUT = 12  # 单源超时（秒）：国内访问 Google 会超时，短超时保证整体不拖垮


# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "docs", "raw_news.json")
WINDOW_HOURS = 24
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

# Google News RSS：按市场分组的查询词（when:1d 限定近一天）
GNEWS_QUERIES = [
    # (市场提示, 查询词, 语言/地区)
    ("A股", "A股 OR 沪深 OR 中国股市 央行 政策", "zh-CN", "CN", "CN:zh-Hans"),
    ("A股", "中国 经济 证监会 监管 上市公司", "zh-CN", "CN", "CN:zh-Hans"),
    ("美股宏观", "美联储 OR 美股 OR 通胀 OR 非农 OR GDP", "zh-CN", "CN", "CN:zh-Hans"),
    ("港股", "港股 OR 恒生指数 OR 南向资金", "zh-CN", "CN", "CN:zh-Hans"),
    ("加密商品外汇", "比特币 OR 黄金 OR 原油 OR 美元指数", "zh-CN", "CN", "CN:zh-Hans"),
    ("债券", "国债收益率 OR 中国央行 OR 美债 OR 债券市场", "zh-CN", "CN", "CN:zh-Hans"),
    ("美股宏观", "Federal Reserve stocks inflation when:1d", "en-US", "US", "US:en"),
    ("加密商品外汇", "Bitcoin gold oil dollar when:1d", "en-US", "US", "US:en"),
]

RSS_FEEDS = [
    # (市场提示, 名称, URL)
    ("美股宏观", "CNBC", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664"),
    ("美股宏观", "MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("加密商品外汇", "Yahoo Finance", "https://finance.yahoo.com/rss/2.0/headline?s=BTC-USD,GC=F,CL=F&region=US&lang=en-US"),
    ("债券", "Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"),
]


def now_utc():
    return datetime.now(timezone.utc)


def to_iso(dt):
    """datetime -> UTC ISO8601 字符串（带 Z）"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_time(raw):
    """把各种发布时间解析为带时区的 datetime（UTC）。"""
    if raw is None:
        return None
    # feedparser 结构化时间
    if hasattr(raw, "tm_year"):
        try:
            return datetime(*raw[:6], tzinfo=timezone.utc)
        except Exception:
            return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    text = str(raw).strip()
    if not text:
        return None
    # RFC822 (RSS pubDate)
    try:
        dt = parsedate_to_datetime(text)
        if dt:
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        pass
    # 常见格式
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            dt = datetime.strptime(text, fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
    # 东财 showTime 例如 "2026-11-19 18:30:00" / "今天 18:30" / "11-19 18:30"
    try:
        if "今天" in text:
            hhmm = text.split()[-1]
            h, m = hhmm.split(":")
            n = now_utc().astimezone(timezone(timedelta(hours=8)))
            return n.replace(hour=int(h), minute=int(m), second=0, microsecond=0).astimezone(timezone.utc)
        if "昨天" in text:
            hhmm = text.split()[-1]
            h, m = hhmm.split(":")
            n = (now_utc() + timedelta(days=-1)).astimezone(timezone(timedelta(hours=8)))
            return n.replace(hour=int(h), minute=int(m), second=0, microsecond=0).astimezone(timezone.utc)
    except Exception:
        pass
    return None


def clean_text(text, limit=400):
    """去除 HTML 标签与多余空白。"""
    if not text:
        return ""
    import re
    text = re.sub(r"<[^>]+>", " ", str(text))
    text = (text.replace("&nbsp;", " ").replace("&amp;", "&")
                .replace("&lt;", "<").replace("&gt;", ">").replace("&#39;", "'")
                .replace("&quot;", '"'))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def make_item(title, link, summary, published, source, market_hint):
    return {
        "title": clean_text(title, 200),
        "link": (link or "").strip(),
        "summary": clean_text(summary, 400),
        "publishedAt": to_iso(published),
        "source": source,
        "marketHint": market_hint,
    }


def within_window(published, cutoff):
    if published is None:
        return True  # 无时间信息则保留，交由加工阶段处理
    return published >= cutoff


# ---------------------------------------------------------------------------
# 各源抓取器
# ---------------------------------------------------------------------------
def fetch_eastmoney(cutoff):
    """东方财富 7x24 全球财经快讯（免费，需 Referer + req_trace）。"""
    url = "https://np-weblist.eastmoney.com/comm/web/getFastNewsList"
    params = {
        "client": "web", "biz": "web_724", "fastColumn": "102",
        "sortEnd": "", "pageSize": "100", "req_trace": str(uuid.uuid4()),
    }
    headers = {"User-Agent": UA, "Referer": "https://kuaixun.eastmoney.com/"}
    resp = requests.get(url, params=params, headers=headers, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    rows = (data.get("data") or {}).get("fastNewsList") or []
    items = []
    for row in rows:
        published = parse_time(row.get("showTime"))
        if not within_window(published, cutoff):
            continue
        title = row.get("title") or ""
        summary = row.get("summary") or ""
        items.append(make_item(
            title=title or summary,
            link=row.get("url") or "https://kuaixun.eastmoney.com/",
            summary=summary,
            published=published,
            source="东方财富7x24",
            market_hint="中国快讯",
        ))
    return items


def fetch_google_news(query, market_hint, hl, gl, ceid, cutoff):
    base = "https://news.google.com/rss/search"
    params = {"q": query, "hl": hl, "gl": gl, "ceid": ceid}
    resp = requests.get(base, params=params, headers={"User-Agent": UA}, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    feed = feedparser.parse(resp.content)
    items = []
    for entry in feed.entries:
        published = parse_time(
            getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
        )
        if not within_window(published, cutoff):
            continue
        source = ""
        if getattr(entry, "source", None):
            source = clean_text(entry.source.get("title", ""), 60)
        items.append(make_item(
            title=entry.get("title", ""),
            link=entry.get("link", ""),
            summary=entry.get("summary", "") or entry.get("title", ""),
            published=published,
            source=source or "Google News",
            market_hint=market_hint,
        ))
    return items


def fetch_rss(name, url, market_hint, cutoff):
    resp = requests.get(url, headers={"User-Agent": UA}, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    feed = feedparser.parse(resp.content)
    items = []
    for entry in feed.entries:
        published = parse_time(
            getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
        )
        if not within_window(published, cutoff):
            continue
        items.append(make_item(
            title=entry.get("title", ""),
            link=entry.get("link", ""),
            summary=entry.get("summary", "") or entry.get("title", ""),
            published=published,
            source=name,
            market_hint=market_hint,
        ))
    return items


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def main():
    import argparse
    from concurrent.futures import ThreadPoolExecutor, as_completed

    ap = argparse.ArgumentParser(description="抓取近24小时财经新闻")
    ap.add_argument("--no-google", action="store_true",
                    help="跳过 Google News（国内网络不可达时用于本地调试）")
    args = ap.parse_args()

    now = now_utc()
    cutoff = now - timedelta(hours=WINDOW_HOURS)
    all_items = []
    sources_ok, sources_failed = [], []

    # 构造任务列表：(名称, 函数)
    tasks = [("东方财富7x24", lambda: fetch_eastmoney(cutoff))]
    if not args.no_google:
        for market_hint, query, hl, gl, ceid in GNEWS_QUERIES:
            tasks.append((f"GoogleNews-{market_hint}",
                          lambda q=query, m=market_hint, h=hl, g=gl, c=ceid:
                          fetch_google_news(q, m, h, g, c, cutoff)))
    for market_hint, name, url in RSS_FEEDS:
        tasks.append((name, lambda u=url, n=name, m=market_hint: fetch_rss(n, u, m, cutoff)))

    # 并发抓取，单源失败不影响其他源
    with ThreadPoolExecutor(max_workers=max(4, len(tasks))) as pool:
        futures = {pool.submit(fn): name for name, fn in tasks}
        for future in as_completed(futures):
            name = futures[future]
            try:
                got = future.result()
                sources_ok.append({"source": name, "count": len(got)})
                all_items.extend(got)
                print(f"[OK] {name}: {len(got)} 条")
            except Exception as exc:
                sources_failed.append({"source": name, "error": str(exc)[:200]})
                print(f"[FAIL] {name}: {exc}", file=sys.stderr)

    payload = {
        "meta": {
            "fetchedAt": to_iso(now),
            "windowStart": to_iso(cutoff),
            "windowEnd": to_iso(now),
            "windowHours": WINDOW_HOURS,
            "sourcesOk": sources_ok,
            "sourcesFailed": sources_failed,
            "totalRaw": len(all_items),
        },
        "items": all_items,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(f"\n[done] 原始 {len(all_items)} 条 -> {OUT_PATH}")
    if not all_items:
        print("[WARN] 未抓到任何条目，请检查网络或数据源可用性。", file=sys.stderr)


if __name__ == "__main__":
    main()
