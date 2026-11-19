#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 docs/ 下的 PWA 打包成一个自包含的单文件 HTML：
内嵌 CSS、JS、news.json、quotes.json 数据和图标，手机浏览器直接打开即可查看。

输出：隔夜财经速览-离线版.html（项目根目录）
"""

import base64
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
OUT = os.path.join(ROOT, "隔夜财经速览-离线版.html")


def read(rel):
    with open(os.path.join(DOCS, rel), "r", encoding="utf-8") as fh:
        return fh.read()


def main():
    html = read("index.html")
    css = read("styles.css")
    js = read("app.js")
    news = read("news.json")
    quotes_path = os.path.join(DOCS, "quotes.json")
    quotes = read("quotes.json") if os.path.exists(quotes_path) else '{"quotes":[]}'
    icon = read("icon.svg")

    icon_uri = "data:image/svg+xml;base64," + base64.b64encode(icon.encode("utf-8")).decode()

    # 1) 内嵌样式
    html = html.replace('<link rel="stylesheet" href="styles.css">',
                        "<style>\n" + css + "\n</style>")
    # 2) 图标内联（注意：只替换属性值中的 icon.svg，避免误伤）
    html = html.replace('href="icon.svg"', 'href="' + icon_uri + '"')
    # 3) 移除 manifest（离线单文件不需要）
    html = html.replace('<link rel="manifest" href="manifest.json">\n', "")

    # 4) 数据内嵌 + fetch 拦截桥
    embedded = (
        "<script>window.__OFFLINE_NEWS__=" + news + ";" +
        "window.__OFFLINE_QUOTES__=" + quotes + ";</script>\n"
    )
    bridge = """
<script>
// 离线桥：拦截数据请求，返回内嵌数据
(function(){
  var realFetch = window.fetch;
  window.fetch = function(url, opts){
    var u = String(url);
    if (u.indexOf('news.json') !== -1 && window.__OFFLINE_NEWS__) {
      return Promise.resolve({ok:true, status:200, json:function(){return Promise.resolve(window.__OFFLINE_NEWS__);}});
    }
    if (u.indexOf('quotes.json') !== -1 && window.__OFFLINE_QUOTES__) {
      return Promise.resolve({ok:true, status:200, json:function(){return Promise.resolve(window.__OFFLINE_QUOTES__);}});
    }
    return realFetch.apply(this, arguments);
  };
  if ('serviceWorker' in navigator) {
    try { Object.defineProperty(navigator, 'serviceWorker', {value: undefined, configurable: true}); } catch(e){}
  }
})();
</script>
"""
    html = html.replace('<script src="app.js"></script>',
                        embedded + bridge + "<script>\n" + js + "\n</script>")

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(html)

    size_kb = os.path.getsize(OUT) / 1024
    print(f"[done] 离线版已生成: {OUT} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
