#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
读取 docs/raw_news.json，做跨源去重、市场分类、重要性评分、抽取式摘要、
情绪与影响标签、客观影响解读，输出 docs/news.json 供 PWA 读取。

默认规则化实现，无 LLM key 依赖；若设置环境变量 LLM_API_KEY 与
LLM_API_BASE（兼容 OpenAI chat/completions），则对每条新闻升级为 AI 摘要
（Phase 3 可选增强），失败自动回退规则化结果。
"""

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_PATH = os.path.join(ROOT, "docs", "raw_news.json")
OUT_PATH = os.path.join(ROOT, "docs", "news.json")

MARKETS = ["A股", "美股宏观", "港股", "加密商品外汇", "债券"]

# 市场分类关键词（按优先级）
MARKET_KEYWORDS = {
    "债券": ["国债", "债券", "美债", "收益率", "央行", "利率决议", "降息", "加息",
             "货币政策", "fed", "federal reserve", "treasury", "yield", "bond",
             "lpr", "mlf", "逆回购"],
    "加密商品外汇": ["比特币", "以太坊", "加密货币", "黄金", "原油", "白银", "美元指数",
                 "汇率", "人民币", "外汇", "大宗商品", "bitcoin", "crypto", "gold",
                 "oil", "dollar", "forex", "commodity"],
    "港股": ["港股", "恒生", "南向资金", "香港股市", "hkex", "hang seng"],
    "美股宏观": ["美联储", "美股", "纳斯达克", "标普", "道琼斯", "通胀", "cpi", "非农",
             "gdp", "失业率", "美股财报", "fed", "inflation", "nasdaq", "s&p",
             "wall street", "stocks", "recession"],
    "A股": ["a股", "沪深", "上证", "深证", "创业板", "证监会", "科创板", "北向资金",
           "上市公司", "沪指", "新股", "ipo", "注册制"],
}

# 高重要性信号词
HIGH_IMPACT_WORDS = [
    "央行", "美联储", "降息", "加息", "利率决议", "通胀", "cpi", "非农", "gdp",
    "熔断", "暴跌", "暴涨", "制裁", "关税", "贸易战", "战争", "地缘", "危机",
    "财报", "业绩", "重组", "并购", "监管", "政策", "刺激", "宽松", "收紧",
    "fed", "inflation", "tariff", "sanction", "recession", "rate cut", "rate hike",
    "earnings", "gdp", "war", "crisis", "stimulus",
]

# 影响标签词 -> 标签
TAG_RULES = [
    (["利率", "降息", "加息", "货币政策", "fed", "rate"], "利率"),
    (["通胀", "cpi", "物价", "inflation"], "通胀"),
    (["汇率", "人民币", "美元", "外汇", "dollar", "forex"], "汇率"),
    (["黄金", "原油", "大宗", "商品", "gold", "oil", "commodity"], "大宗商品"),
    (["比特币", "加密", "bitcoin", "crypto"], "加密资产"),
    (["关税", "贸易", "制裁", "tariff", "trade", "sanction"], "国际贸易"),
    (["财报", "业绩", "盈利", "earnings"], "企业盈利"),
    (["监管", "证监会", "政策", "regulation", "policy"], "监管政策"),
    (["地缘", "战争", "冲突", "war", "geopolit"], "地缘风险"),
    (["流动性", "资金", "北向", "南向", "liquid"], "资金流向"),
]

POSITIVE_WORDS = ["上涨", "增长", "利好", "反弹", "创新高", "盈利", "超预期", "宽松",
                  "降息", "stimulus", "rally", "gain", "beat", "growth", "record high"]
NEGATIVE_WORDS = ["下跌", "下滑", "利空", "暴跌", "亏损", "不及预期", "收紧", "加息",
                  "衰退", "危机", "制裁", "关税", "crash", "fall", "miss", "recession",
                  "sanction", "tariff", "war", "crisis"]


def sha_id(title, published, link):
    raw = f"{title}|{published or ''}|{link or ''}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def normalize(text):
    """归一化文本用于去重：小写、去标点与空白。"""
    text = (text or "").lower()
    return re.sub(r"[\s\W_]+", "", text)


def classify(item):
    # marketHint 只作为弱提示；新闻源查询主题不等于新闻实际涉及市场。
    hint = item.get("marketHint", "")
    text = f"{item.get('title','')} {item.get('summary','')}".lower()
    scores = {m: 0.0 for m in MARKETS}
    for market, words in MARKET_KEYWORDS.items():
        for w in words:
            if w.lower() in text:
                scores[market] += 1.0
    # 宏观和债券关键词很宽泛，降低央行/收益率等词的独立判别权重。
    if scores["债券"] and not any(w in text for w in ["美债", "国债", "债券", "treasury", "bond"]):
        scores["债券"] *= 0.35
    hint_market = next((m for m in MARKETS if m in hint), None)
    if hint_market:
        scores[hint_market] += 0.35
    ordered = sorted(scores.items(), key=lambda pair: pair[1], reverse=True)
    # 不确定项放入全球宏观，避免错误地伪装成 A 股新闻。
    return ordered[0][0] if ordered[0][1] >= 1.0 else "美股宏观"


NEWS_TYPES = [
    (["央行", "美联储", "降息", "加息", "利率", "货币政策", "fed", "rate decision"], "货币政策"),
    (["cpi", "ppi", "通胀", "物价", "inflation"], "通胀数据"),
    (["非农", "就业", "失业率", "payroll", "employment"], "就业数据"),
    (["财报", "业绩", "营收", "净利润", "盈利", "earnings", "revenue"], "公司业绩"),
    (["监管", "证监会", "新规", "处罚", "批准", "regulation"], "监管与政策"),
    (["关税", "贸易战", "制裁", "出口管制", "tariff", "sanction"], "贸易与制裁"),
    (["战争", "冲突", "袭击", "地缘", "war", "conflict"], "地缘事件"),
    (["ipo", "上市", "退市", "增发", "回购", "并购", "重组"], "资本运作"),
    (["黄金", "白银", "原油", "天然气", "比特币", "以太坊", "gold", "oil", "bitcoin"], "商品与数字资产"),
    (["人民币", "美元指数", "汇率", "外汇", "yuan", "forex"], "汇率"),
    (["房地产", "楼市", "房价", "地产", "property", "housing"], "房地产"),
]


def classify_news_type(item):
    text = f"{item.get('title','')} {item.get('summary','')}".lower()
    for words, label in NEWS_TYPES:
        if any(w.lower() in text for w in words):
            return label
    return "市场与公司动态"


def score_importance(item, dup_count):
    """1-5 分：来源权重 + 关键词 + 重复度 + 时间新鲜度。"""
    text = f"{item.get('title','')} {item.get('summary','')}".lower()
    source = item.get("source", "")
    score = 1.0

    # 来源权威权重
    if any(s in source for s in ["美联储", "Federal Reserve", "央行", "证监会", "MarketWatch", "CNBC"]):
        score += 0.8
    elif "东方财富" in source or "Google" in source:
        score += 0.4

    # 高影响词命中
    hits = sum(1 for w in HIGH_IMPACT_WORDS if w.lower() in text)
    score += min(hits * 0.4, 1.6)

    # 多源重复度（同一事件被多家报道 -> 更重要）
    score += min(max(dup_count - 1, 0) * 0.3, 0.9)

    # 时间新鲜度
    pub = item.get("_published_dt")
    if pub:
        try:
            hours = (datetime.now(timezone.utc) - pub).total_seconds() / 3600
            if hours <= 3:
                score += 0.6
            elif hours <= 8:
                score += 0.3
            elif hours > 24:
                score -= 0.5
        except Exception:
            pass

    return max(1, min(5, int(round(score))))


def extract_summary(item, max_len=140):
    """抽取式摘要：优先用 summary，其次 title；截取关键句。"""
    text = (item.get("summary") or "").strip()
    title = (item.get("title") or "").strip()
    # 东财快讯常见格式：【标题】正文 —— 去掉重复的【标题】前缀与纯引用
    bracket = re.match(r"^【[^】]+】\s*", text)
    if bracket:
        text = text[bracket.end():].strip()
    if not text or text.lower() == title.lower() or text in title:
        text = title
    # 取前 1-2 句
    sentences = re.split(r"(?<=[。！？.!?])\s+", text)
    summary = ""
    for s in sentences:
        if len(summary) + len(s) > max_len and summary:
            break
        summary += s + " "
    summary = summary.strip()
    if len(summary) > max_len:
        summary = summary[:max_len].rstrip("，,、;； ") + "…"
    return summary or title[:max_len]


def get_tags(item):
    text = f"{item.get('title','')} {item.get('summary','')}".lower()
    tags = []
    for words, tag in TAG_RULES:
        if any(w.lower() in text for w in words):
            tags.append(tag)
        if len(tags) >= 4:
            break
    return tags[:4] or ["市场动态"]


def get_sentiment(item):
    text = f"{item.get('title','')} {item.get('summary','')}".lower()
    pos = sum(1 for w in POSITIVE_WORDS if w.lower() in text)
    neg = sum(1 for w in NEGATIVE_WORDS if w.lower() in text)
    if pos > neg:
        return "positive"
    if neg > pos:
        return "negative"
    return "neutral"


def trading_view(item, market, tags, sentiment):
    """客观影响解读：只描述可能影响与需关注的变量，不含买卖建议。"""
    tone = {"positive": "偏积极", "negative": "偏谨慎", "neutral": "方向待观察"}.get(sentiment, "方向待观察")
    tag_text = "、".join(tags[:3])
    lead = f"该消息对{tag_text}相关领域情绪{tone}"
    market_map = {
        "A股": "A股相关板块的开盘情绪与资金关注度",
        "美股宏观": "美股与全球风险资产的短期波动",
        "港股": "港股及南向资金的风险偏好",
        "加密商品外汇": "加密资产、大宗商品与外汇的短线定价",
        "债券": "债券收益率与利率预期",
    }
    focus = market_map.get(market, "相关市场的短期情绪")
    return (f"{lead}，需关注其对{focus}的后续影响。"
            "本解读为客观信息归纳，不构成投资建议。")


def dedup(items):
    """跨源去重：归一化标题相似 + 时间接近视为同一事件。"""
    groups = []
    for it in items:
        key = normalize(it.get("title", ""))[:60]
        placed = False
        for g in groups:
            if key and key == g["key"]:
                g["items"].append(it)
                placed = True
                break
        if not placed:
            groups.append({"key": key, "items": [it]})
    return groups


# 二级主题标签：市场 -> 主题（按标题/摘要关键词）
SUBTOPICS = [
    (["降息", "加息", "利率", "美联储", "央行", "货币政策", "fed", "rate"],
     "货币政策"),
    (["通胀", "cpi", "物价", "ppi", "inflation"], "通胀数据"),
    (["财报", "业绩", "盈利", "营收", "earnings", "revenue"], "企业财报"),
    (["关税", "贸易", "制裁", "tariff", "trade", "sanction"], "国际贸易"),
    (["监管", "证监会", "政策", "新规", "regulation", "policy"], "监管政策"),
    (["地缘", "战争", "冲突", "war", "military"], "地缘政治"),
    (["黄金", "白银", "原油", "比特币", "加密", "gold", "oil", "bitcoin"], "大宗与加密"),
    (["房地产", "楼市", "地产", "property"], "房地产"),
    (["科技", "芯片", "半导体", "ai", "人工智能", "chip"], "科技产业"),
    (["就业", "非农", "失业", "employment", "payroll"], "就业数据"),
]


def get_subtopic(item):
    text = f"{item.get('title','')} {item.get('summary','')}".lower()
    for words, topic in SUBTOPICS:
        if any(w.lower() in text for w in words):
            return topic
    return "综合"


def compute_mood(items, quotes_path):
    """严谨的多空评分。

    总分 = 行情面 60% + 新闻面 40%，按重要性与置信度加权。

    新闻面（50%）：按重要性加权，高影响(importance≥4)权重 2.0，中(3)1.0，低(≤2)0.5。
      sentiment: positive=+1 / negative=-1 / neutral=0。
      新闻分 = Σ(权重×情绪) / Σ(权重×所有条数权重)  → -1..+1
      样本不足(<3条有情绪)时按 0.5 置信度折算，避免小样本极端化。

    行情面（50%），分层权重：
      A股指数(上证/创业板) 40% of 行情面
      美股指数(标普/纳指/道指) 40%
      商品(黄金/白银/CRB) 12%
      汇率(美元指数) 8%（美元走强通常对风险资产偏空，故取反）
      每个品种涨跌映射：±3%封顶 → -1..+1；缺失层级按其它层均值补齐并降低该层权重。

    分级阈值（对称）：
      ≥ +50 极多 / +18~+50 偏多 / -18~+18 中性 / -50~-18 偏空 / ≤ -50 极空

    返回 (score, cat, mood, label, breakdown)
    """
    # ---------- 新闻面 ----------
    sent_val = {"positive": 1.0, "negative": -1.0, "neutral": 0.0}
    weighted_sum = 0.0
    weight_total = 0.0
    sentiment_count = 0
    for it in items:
        imp = it.get("importance", 3) or 3
        w = 2.0 if imp >= 4 else (1.0 if imp == 3 else 0.5)
        s = sent_val.get(it.get("sentiment"), 0.0)
        weighted_sum += w * s
        weight_total += w
        if s != 0:
            sentiment_count += 1
    news_score = (weighted_sum / weight_total) if weight_total else 0.0
    # 小样本置信度折算
    conf = min(1.0, sentiment_count / 5.0) if sentiment_count else 0.0
    news_score *= conf

    # ---------- 行情面（分层加权）----------
    quotes = []
    try:
        with open(quotes_path, "r", encoding="utf-8") as fh:
            quotes = json.load(fh).get("quotes", [])
    except Exception:
        pass

    def layer_score(keys):
        vals, ws = [], []
        for q in quotes:
            if q.get("key") in keys and q.get("changePct") is not None:
                v = max(-3.0, min(3.0, float(q["changePct"]))) / 3.0
                vals.append(v)
                ws.append(1.0)
        if not vals:
            return None, 0
        return sum(v * w for v, w in zip(vals, ws)) / sum(ws), len(vals)

    a_score, a_n = layer_score(["shcomposite", "chinext"])               # A股
    us_score, us_n = layer_score(["sp500", "nasdaq", "dji"])            # 美股
    cm_score, cm_n = layer_score(["gold", "silver", "crb"])             # 商品
    fx_score, fx_n = layer_score(["dxy"])                               # 美元指数

    # 美元指数取反：美元强 → 风险资产偏空
    if fx_score is not None:
        fx_score = -fx_score

    # 分层权重，缺失层按可用层均值补齐
    layer_w = {"a": 0.40, "us": 0.40, "cm": 0.12, "fx": 0.08}
    layers = {"a": (a_score, a_n), "us": (us_score, us_n),
              "cm": (cm_score, cm_n), "fx": (fx_score, fx_n)}
    available = {k: v for k, v in layers.items() if v[0] is not None}
    if available:
        # 权重归一：可用层按原权重占比放大；缺失层忽略
        wsum = sum(layer_w[k] for k in available)
        market_score = sum(layer_w[k] * available[k][0] for k in available) / wsum
    else:
        market_score = 0.0

    # ---------- 合成 ----------
    raw = 0.4 * news_score + 0.6 * market_score
    score = int(round(max(-1.0, min(1.0, raw)) * 100))

    # ---------- 分级 ----------
    if score >= 50:
        cat, mood, label = "bull", "猫猫起飞 🚀", "强烈偏多"
    elif score >= 18:
        cat, mood, label = "happy", "猫猫开心 😸", "偏多"
    elif score > -18:
        cat, mood, label = "calm", "猫猫淡定 😌", "中性震荡"
    elif score > -50:
        cat, mood, label = "worried", "猫猫担忧 😟", "偏空"
    else:
        cat, mood, label = "bear", "猫猫抱头 🙀", "强烈偏空"

    breakdown = {
        "news": round(news_score * 100),
        "market": round(market_score * 100),
        "newsConfidence": round(conf * 100),
        "sentimentCount": sentiment_count,
        "layers": {
            "aShare": round(a_score * 100) if a_score is not None else None,
            "usStock": round(us_score * 100) if us_score is not None else None,
            "commodity": round(cm_score * 100) if cm_score is not None else None,
            "fx": round(fx_score * 100) if fx_score is not None else None,
        },
        "weights": {"news": 40, "market": 60,
                    "aShare": 20, "usStock": 20, "commodity": 6, "fx": 4},
    }
    return score, cat, mood, label, breakdown


def main():
    if not os.path.exists(RAW_PATH):
        print(f"[FATAL] 找不到 {RAW_PATH}，请先运行 fetch.py", file=sys.stderr)
        sys.exit(1)
    with open(RAW_PATH, "r", encoding="utf-8") as fh:
        raw = json.load(fh)

    raw_items = raw.get("items", [])
    meta = raw.get("meta", {})

    groups = dedup(raw_items)
    processed = []
    for g in groups:
        # 取组内信息最全的一条作为主条目
        main_item = max(g["items"], key=lambda x: len(x.get("summary", "")) + len(x.get("title", "")))
        dup_count = len(g["items"])
        market = classify(main_item)
        summary = extract_summary(main_item)
        tags = get_tags(main_item)
        sentiment = get_sentiment(main_item)
        item = {
            "id": sha_id(main_item.get("title"), main_item.get("publishedAt"), main_item.get("link")),
            "market": market,
            "title": main_item.get("title", ""),
            "summary": summary,
            "source": main_item.get("source", ""),
            "sourceUrl": main_item.get("link", ""),
            "publishedAt": main_item.get("publishedAt"),
            "sentiment": sentiment,
            "impactTags": tags,
            "subtopic": get_subtopic(main_item),
            "newsType": classify_news_type(main_item),
            "tradingView": trading_view(main_item, market, tags, sentiment),
        }
        # 供评分使用的时间
        pub = main_item.get("publishedAt")
        try:
            item["_published_dt"] = datetime.fromisoformat(pub.replace("Z", "+00:00")) if pub else None
        except Exception:
            item["_published_dt"] = None
        item["importance"] = score_importance(item, dup_count)
        processed.append(item)

    # 排序：重要性降序，其次时间降序
    processed.sort(key=lambda x: (x["importance"], x.get("publishedAt") or ""), reverse=True)

    # Top picks：重要性 >=4 的前 8 条（适中精简），不足则取前 8
    top = [it["id"] for it in processed if it["importance"] >= 4][:8]
    if len(top) < 8:
        for it in processed:
            if it["id"] not in top and len(top) < 8:
                top.append(it["id"])
    for it in processed:
        del it["_published_dt"]

    # 多空程度 + 猫猫心情
    QUOTES_PATH = os.path.join(ROOT, "docs", "quotes.json")
    score, cat, cat_mood, mood_label, breakdown = compute_mood(processed, QUOTES_PATH)

    out = {
        "mood": {
            "score": score,
            "cat": cat,
            "catMood": cat_mood,
            "label": mood_label,
            "breakdown": breakdown,
            "scale": "-100 极空 / ≤-50 偏空 / -18~18 中性 / ≥18 偏多 / ≥50 极多",
            "rules": "行情面60%（A股/美股/商品/汇率分层，日涨跌幅封顶归一）+新闻面40%（重要性加权并按有效样本量折减置信度）",
        },
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "windowStart": meta.get("windowStart"),
            "windowEnd": meta.get("windowEnd"),
            "windowHours": meta.get("windowHours", 24),
            "itemsCount": len(processed),
            "rawCount": meta.get("totalRaw", len(raw_items)),
            "sourcesOk": meta.get("sourcesOk", []),
            "sourcesFailed": meta.get("sourcesFailed", []),
            "mode": "rule",
        },
        "topPicks": top,
        "items": processed,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print(f"[done] {len(processed)} 条 -> {OUT_PATH} (top {len(top)})")


if __name__ == "__main__":
    main()
