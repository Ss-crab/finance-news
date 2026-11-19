#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 docs/ 下的 PWA 打包成一个自包含的单文件 HTML：
内嵌 CSS、JS、news.json 数据，手机浏览器直接打开即可查看（无需服务器/网络）。

输出：隔夜财经速览-离线版.html（项目根目录）
"""

import base64
import json
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
    icon = read("icon.svg")

    # 图标转 data URI
    icon_uri = "data:image/svg+xml;base64," + base64.b64encode(icon.encode("utf-8")).decode()

    # 1) 替换外部样式表为内嵌
    html = html.replace(
        '<link rel="stylesheet" href="styles.css">',
        "<style>\n" + css + "\n</style>"
    )
    # 2) 图标内联
    html = html.replace("icon.svg", icon_uri)
    # 3) 移除 manifest / service worker 相关（离线单文件不需要）
    html = html.replace('<link rel="manifest" href="manifest.json">\n', "")
    # 4) 内嵌数据：把 news.json 作为全局变量，并改写数据地址
    embedded = (
        "<script>window.__OFFLINE_NEWS__=" + news + ";</script>\n"
    )
    # 改写 app.js 里的 DATA_URL 与 fetch 逻辑：优先用内嵌数据
    js = js.replace("var DATA_URL = 'news.json';", "var DATA_URL = 'news.json';")
    # 在 app.js 前面注入覆盖：loadData 用内嵌数据
    offline_bridge = """
<script>
// 离线桥：拦截 news.json 请求，直接返回内嵌数据
(function(){
  var realFetch = window.fetch;
  window.fetch = function(url, opts){
    var u = String(url);
    if (u.indexOf('news.json') !== -1 && window.__OFFLINE_NEWS__) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function(){ return Promise.resolve(window.__OFFLINE_NEWS__); }
      });
    }
    return realFetch.apply(this, arguments);
  };
  // 离线单文件无需 SW
  if ('serviceWorker' in navigator) {
    Object.defineProperty(navigator, 'serviceWorker', {value: undefined, configurable: true});
  }
})();
</script>
"""
    # 5) 注入脚本：离线桥 + app.js
    html = html.replace(
        '<script src="app.js"></script>',
        embedded + offline_bridge + "<script>\n" + js + "\n</script>"
    )

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(html)

    size_kb = os.path.getsize(OUT) / 1024
    print(f"[done] 离线版已生成: {OUT} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
