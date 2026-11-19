#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取全球主要资产行情，输出 docs/quotes.json 供 PWA 走势图使用。

覆盖：
  - 美股指数：标普500 / 纳斯达克 / 道琼斯（新浪实时 + 新浪美股日K历史）
  - 贵金属：COMEX黄金 / COMEX白银（新浪实时 + 新浪外盘日K历史）
  - 债券：美债10Y / 中债10Y（东财 push2，多候选降级，可能不可用）
全部为免费公开接口，无 key。逐品种降级，失败不影响整体。
"""
import json
import os
import re
import sys
import time

try:
    import requests
except ImportError as exc:  # pragma: no cover
    print(f"[FATAL] 缺少 requests: {exc}", file=sys.stderr)
    sys.exit(1)

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "docs", "quotes.json")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36"
SINA_REF = "https://finance.sina.com.cn"

# 目标品种：key=前端标识
TARGETS = [
    {"key": "sp500", "name": "标普500", "unit": "", "kind": "index",
     "sina_code": "int_sp500", "hist_symbol": ".INX", "decimals": 2},
    {"key": "nasdaq", "name": "纳斯达克", "unit": "", "kind": "index",
     "sina_code": "int_nasdaq", "hist_symbol": ".NDX", "decimals": 2},
    {"key": "dji", "name": "道琼斯", "unit": "", "kind": "index",
     "sina_code": "int_dji", "hist_symbol": ".DJI", "decimals": 2},
    {"key": "gold", "name": "COMEX黄金", "unit": "$", "kind": "metal",
     "sina_code": "hf_GC", "hist_symbol": "GC", "decimals": 2},
    {"key": "silver", "name": "COMEX白银", "unit": "$", "kind": "metal",
     "sina_code": "hf_SI", "hist_symbol": "SI", "decimals": 3},
    {"key": "us10y", "name": "美债10Y", "unit": "%", "kind": "bond",
     "em_secids": ["100.UST10Y", "100.US10Y", "100.BD10Y"], "decimals": 2},
    {"key": "cn10y", "name": "中债10Y", "unit": "%", "kind": "bond",
     "em_secids": ["100.CN10Y", "100.CHN10Y"], "decimals": 2},
    {"key": "crb", "name": "CRB商品", "unit": "", "kind": "em_index",
     "em_secids": ["100.CRB"], "em_scale": 100, "hist_sid": "100.CRB", "decimals": 2},
    {"key": "dxy", "name": "美元指数", "unit": "", "kind": "em_index",
     "em_secids": ["100.UDI"], "em_scale": 100, "hist_sid": "100.UDI", "decimals": 2},
    {"key": "shcomposite", "name": "上证指数", "unit": "", "kind": "cn_index",
     "sina_code": "s_sh000001", "hist_symbol": "sh000001", "decimals": 2},
    {"key": "chinext", "name": "创业板指", "unit": "", "kind": "cn_index",
     "sina_code": "s_sz399006", "hist_symbol": "sz399006", "decimals": 2},
]


def session():
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    return s


def fetch_sina_spot(codes, s):
    """批量取新浪实时行情，返回 {code: raw_string}"""
    url = "https://hq.sinajs.cn/list=" + ",".join(codes)
    r = s.get(url, headers={"Referer": SINA_REF}, timeout=12)
    r.encoding = "gbk"
    out = {}
    for line in r.text.strip().split("\n"):
        if '="' in line:
            code = line.split("=")[0].replace("var hq_str_", "").strip()
            out[code] = line.split('"')[1]
    return out


def parse_cn_index_spot(raw):
    # 新浪 A股指数简版: 名称,现价,涨跌额,涨跌幅,成交量,成交额
    # e.g. 上证指数,3577.6174,-10.2143,-0.28,4129127,63690906
    p = raw.split(",")
    if len(p) < 4:
        return None
    try:
        return {"price": float(p[1]), "change": float(p[2]), "changePct": float(p[3])}
    except Exception:
        return None


def parse_index_spot(raw):
    # 格式: 名称,现价,涨跌额,涨跌幅  e.g. 标普指数,6643.70,38.98,0.59
    p = raw.split(",")
    if len(p) < 4:
        return None
    try:
        return {"price": float(p[1]), "change": float(p[2]), "changePct": float(p[3])}
    except Exception:
        return None


def parse_metal_spot(raw):
    # hf_GC: 现价,,买价,卖价,最高,最低,时间,昨收,开盘,...,日期,名称,...
    p = raw.split(",")
    if len(p) < 9:
        return None
    try:
        price = float(p[0]); prev = float(p[7])
        chg = price - prev
        pct = chg / prev * 100 if prev else 0
        return {"price": price, "change": round(chg, 4), "changePct": round(pct, 2)}
    except Exception:
        return None


def fetch_index_history(symbol, s, days=30):
    """新浪美股指数日K：US_MinKService.getDailyK?symbol=.INX"""
    url = "https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20t=/US_MinKService.getDailyK"
    r = s.get(url, params={"symbol": symbol}, headers={"Referer": SINA_REF}, timeout=15)
    m = re.search(r"\(\[(.*?)\]\)", r.text, re.S)
    if not m:
        return []
    try:
        arr = json.loads("[" + m.group(1) + "]")
    except Exception:
        return []
    out = []
    for it in arr[-days:]:
        try:
            out.append({"date": it["d"], "close": float(it["c"])})
        except Exception:
            continue
    return out


def fetch_tencent_history(symbol, s, days=30):
    """腾讯 A股指数日K：fqkline，返回 [[date, open, close, high, low, vol], ...]"""
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,{days},qfq"
    r = s.get(url, timeout=12)
    d = r.json().get("data", {}).get(symbol, {})
    k = d.get("qfqday") or d.get("day") or []
    out = []
    for row in k:
        try:
            out.append({"date": row[0], "close": float(row[2])})
        except Exception:
            continue
    return out[-days:]


def fetch_em_history(secid, scale, s, days=30):
    """东财日K：push2his，klines 每条 '日期,开,收,高,低,量'"""
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
    params = {"secid": secid, "klt": "101", "fqt": "0", "lmt": str(days),
              "fields1": "f1,f2,f3", "fields2": "f51,f52,f53,f54,f55,f56"}
    r = s.get(url, params=params, timeout=12)
    klines = (r.json().get("data") or {}).get("klines") or []
    out = []
    for line in klines:
        p = line.split(",")
        try:
            out.append({"date": p[0], "close": float(p[2]) / scale})
        except Exception:
            continue
    return out[-days:]


def fetch_metal_history(symbol, s, days=30):
    """新浪外盘日K：GlobalFuturesService.getGlobalFuturesDailyKLine"""
    url = ("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20t=/"
           "GlobalFuturesService.getGlobalFuturesDailyKLine")
    r = s.get(url, params={"symbol": symbol}, headers={"Referer": SINA_REF}, timeout=15)
    m = re.search(r"\(\[(.*?)\]\)", r.text, re.S)
    if not m:
        return []
    try:
        arr = json.loads("[" + m.group(1) + "]")
    except Exception:
        return []
    out = []
    for it in arr[-days:]:
        try:
            out.append({"date": it["date"], "close": float(it["close"])})
        except Exception:
            continue
    return out


def fetch_bond_spot(secids, s):
    """东财 push2 债券收益率，多候选降级。字段 f43=最新值, f170=涨跌幅"""
    url = "https://push2.eastmoney.com/api/qt/stock/get"
    for sid in secids:
        try:
            r = s.get(url, params={"secid": sid, "fields": "f43,f57,f58,f169,f170"},
                      timeout=10)
            d = r.json().get("data")
            if d and d.get("f43") is not None:
                price = float(d["f43"]) / 100.0  # 东财收益率放大100倍
                pct = float(d.get("f170") or 0) / 100.0
                return {"price": round(price, 3), "change": None,
                        "changePct": round(pct, 3), "secid": sid}
        except Exception:
            continue
        time.sleep(0.5)
    return None


def fetch_em_index(secids, scale, s):
    """东财 push2 指数（CRB/美元指数等），价格按 scale 缩放，f170 已是百分比"""
    url = "https://push2.eastmoney.com/api/qt/stock/get"
    for sid in secids:
        try:
            r = s.get(url, params={"secid": sid, "fields": "f43,f57,f58,f169,f170"},
                      timeout=10)
            d = r.json().get("data")
            if d and d.get("f43") is not None:
                return {
                    "price": round(float(d["f43"]) / scale, 3),
                    "change": None,
                    "changePct": round(float(d.get("f170") or 0) / 100.0, 3),
                    "secid": sid,
                }
        except Exception:
            continue
        time.sleep(0.5)
    return None


def main():
    s = session()
    results = []
    errors = []

    # 批量取新浪实时（指数+金属）
    sina_codes = [t["sina_code"] for t in TARGETS if "sina_code" in t]
    try:
        spot = fetch_sina_spot(sina_codes, s)
    except Exception as e:
        spot = {}
        errors.append(f"新浪实时: {e}")

    for t in TARGETS:
        item = {
            "key": t["key"], "name": t["name"], "unit": t["unit"],
            "kind": t["kind"], "decimals": t["decimals"],
            "price": None, "change": None, "changePct": None,
            "history": [], "ok": False,
        }
        try:
            if t["kind"] in ("index", "metal") and "sina_code" in t:
                raw = spot.get(t["sina_code"], "")
                parsed = parse_index_spot(raw) if t["kind"] == "index" else parse_metal_spot(raw)
                if parsed:
                    item.update(parsed)
                # 历史
                if t["kind"] == "index":
                    item["history"] = fetch_index_history(t["hist_symbol"], s)
                else:
                    item["history"] = fetch_metal_history(t["hist_symbol"], s)
                item["ok"] = item["price"] is not None
            elif t["kind"] == "cn_index" and "sina_code" in t:
                raw = spot.get(t["sina_code"], "")
                parsed = parse_cn_index_spot(raw)
                if parsed:
                    item.update(parsed)
                    item["ok"] = True
                if "hist_symbol" in t:
                    try:
                        item["history"] = fetch_tencent_history(t["hist_symbol"], s)
                    except Exception:
                        pass
            elif t["kind"] == "em_index":
                e = fetch_em_index(t.get("em_secids", []), t.get("em_scale", 100), s)
                if e:
                    item.update(e)
                    item["ok"] = True
                if "hist_sid" in t:
                    try:
                        item["history"] = fetch_em_history(t["hist_sid"], t.get("em_scale", 100), s)
                    except Exception:
                        pass
            elif t["kind"] == "bond":
                b = fetch_bond_spot(t.get("em_secids", []), s)
                if b:
                    item.update(b)
                    # 债券历史走势暂缺（前端会标注"参考值"）
                    item["history"] = []
                    item["ok"] = True
                else:
                    # 降级：明确标注为"参考值"，不编造实时行情
                    ref = {"us10y": (4.20, "美债10年期收益率参考值"),
                           "cn10y": (2.30, "中债10年期收益率参考值")}.get(t["key"])
                    if ref:
                        item["price"] = ref[0]
                        item["changePct"] = None
                        item["reference"] = True
                        item["note"] = ref[1] + "，实时数据暂不可用"
                        item["ok"] = True
                        print(f"[REF] {t['name']}: 使用参考值 {ref[0]}%", flush=True)
            if item["ok"]:
                print(f"[OK] {t['name']}: {item['price']} ({item['changePct']}%) "
                      f"hist={len(item['history'])}", flush=True)
            else:
                print(f"[--] {t['name']}: 无数据", flush=True)
        except Exception as e:
            errors.append(f"{t['name']}: {e}")
            print(f"[FAIL] {t['name']}: {e}", file=sys.stderr, flush=True)
        results.append(item)
        time.sleep(0.4)

    from datetime import datetime, timezone
    payload = {
        "meta": {
            "fetchedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "sources": ["新浪财经（指数/贵金属实时与日K）", "东方财富（债券收益率）"],
            "errors": errors,
        },
        "quotes": results,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    ok_count = sum(1 for q in results if q["ok"])
    print(f"\n[done] {ok_count}/{len(results)} 个品种有数据 -> {OUT_PATH}", flush=True)


if __name__ == "__main__":
    main()
