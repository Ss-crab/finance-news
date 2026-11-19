# 隔夜财经速览（PWA）

手机上运行的财经新闻应用：汇总过去 24 小时隔夜重点新闻与全球行情，辅助判断次日交易方向。

- **形态**：PWA 移动网页，可添加到手机主屏幕，支持离线查看
- **市场**：A股 / 美股宏观 / 港股 / 加密·商品·外汇 / 债券
- **核心功能**：
  - 行情速览：标普/纳指/道指、COMEX黄金/白银、中美10年期国债收益率，点卡片看 1周/2周/1月 走势图
  - 猫猫心情 + 多空程度：综合新闻情绪与股指涨跌算出 -100~+100 的情绪指数，配一只会变表情的猫猫
  - 晨昏线背景：界面背景随一天中的时间（黎明/白天/黄昏/夜晚）自动变化
  - 精简信息：智能去重，8 条要点 + 按市场分组完整列表，二级主题标签
  - 互动筛选：重要性星级滑块 + 主题标签筛选 + 市场分区
- **数据源**：全部为公开免费源（新浪财经/东财等），无需新闻 API key
- **更新**：GitHub Actions 每天北京时间 7:30 自动抓取并生成，手机打开固定地址即是最新
- **合规**：仅做信息整理与客观影响分析，不构成投资建议

## 架构

```
.github/workflows/daily.yml   云端定时任务（cron + 手动触发）
scripts/fetch.py              抓取近24h多源新闻 -> docs/raw_news.json
scripts/fetch_quotes.py       抓取指数/贵金属/债券行情与历史 -> docs/quotes.json
scripts/process.py            去重/分类/评分/摘要/解读/多空程度 -> docs/news.json
scripts/make_offline.py       打包成单文件离线 HTML
docs/                         PWA 站点（GitHub Pages 部署此目录）
  index.html / styles.css / app.js
  manifest.json / sw.js / icon.svg
  news.json / quotes.json     每天自动生成的数据
```

页面与数据同源，规避跨域问题；Actions 用内置 `GITHUB_TOKEN` 自动提交，无需额外凭证。

## 部署步骤

1. 新建一个 GitHub 仓库（建议公开），把本项目所有文件推上去。
2. 仓库 **Settings → Pages**，Source 选 `main` 分支 + `/docs` 目录，保存。
3. 等待 Pages 部署完成，得到固定地址，如 `https://<用户名>.github.io/<仓库名>/`。
4. 确认 **Actions** 已启用；可到 Actions 页手动点 **Run workflow** 立即生成一次数据。
5. 手机浏览器打开该地址 → 菜单 →「添加到主屏幕」，即像 App 一样使用。

> 每天 7:30（北京时间）云端自动更新；也可在 Actions 页手动触发。应用内右上角按钮 / 下拉可刷新。

## 本地运行（调试）

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r scripts/requirements.txt
python scripts/fetch.py          # 抓取 -> docs/raw_news.json（国内可加 --no-google）
python scripts/fetch_quotes.py   # 抓取行情 -> docs/quotes.json
python scripts/process.py        # 加工 -> docs/news.json（含多空程度）
python scripts/make_offline.py   # 打包单文件离线版（可选）
cd docs && python -m http.server 8000   # 浏览器打开 http://localhost:8000
```

## 可选：AI 深度摘要（Phase 3）

默认规则化摘要，无需 key。如需 AI 深度解读，在 GitHub 仓库
Settings → Secrets 添加 `LLM_API_KEY`（兼容 OpenAI 的 `LLM_API_BASE` 可选），
process.py 会自动升级（当前版本已预留环境变量读取位，AI 逻辑可按需扩展）。

## 免责声明

本应用仅汇总公开新闻并提供客观影响分析，不构成任何投资建议或要约。数据来自第三方，可能存在延迟或误差；市场有风险，决策请自主判断并核对原文。
