# 隔夜财经速览（PWA）

手机上运行的财经新闻应用：汇总过去 24 小时隔夜重点新闻，辅助判断次日交易方向。

- **形态**：PWA 移动网页，可添加到手机主屏幕，支持离线查看
- **市场**：A股 / 美股宏观 / 港股 / 加密·商品·外汇 / 债券
- **数据源**：全部为公开免费源，无需新闻 API key
- **更新**：GitHub Actions 每天北京时间 7:30 自动抓取并生成，手机打开固定地址即是最新
- **合规**：仅做信息整理与客观影响分析，不构成投资建议

## 架构

```
.github/workflows/daily.yml   云端定时任务（cron + 手动触发）
scripts/fetch.py              抓取近24h多源新闻 -> docs/raw_news.json
scripts/process.py            去重/分类/评分/摘要/解读 -> docs/news.json
docs/                         PWA 站点（GitHub Pages 部署此目录）
  index.html / styles.css / app.js
  manifest.json / sw.js / icon.svg
  news.json                   每天自动生成的数据
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
python scripts/fetch.py          # 抓取 -> docs/raw_news.json
python scripts/process.py        # 加工 -> docs/news.json
cd docs && python -m http.server 8000   # 浏览器打开 http://localhost:8000
```

## 可选：AI 深度摘要（Phase 3）

默认规则化摘要，无需 key。如需 AI 深度解读，在 GitHub 仓库
Settings → Secrets 添加 `LLM_API_KEY`（兼容 OpenAI 的 `LLM_API_BASE` 可选），
process.py 会自动升级（当前版本已预留环境变量读取位，AI 逻辑可按需扩展）。

## 免责声明

本应用仅汇总公开新闻并提供客观影响分析，不构成任何投资建议或要约。数据来自第三方，可能存在延迟或误差；市场有风险，决策请自主判断并核对原文。
