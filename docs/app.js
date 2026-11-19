/* 隔夜财经速览 — 前端逻辑
 * 只读同源 news.json / quotes.json；行情走势图画布渲染；晨昏线背景；
 * 猫猫心情；重要性/主题筛选；手动/下拉刷新；localStorage 缓存与离线提示。
 */
(function () {
  'use strict';

  var NEWS_URL = 'news.json';
  var QUOTES_URL = 'quotes.json';
  var CACHE_KEY = 'overnight_news_cache_v2';
  var QCache_KEY = 'overnight_quotes_cache_v2';
  var state = { data: null, quotes: null, market: 'all', minImportance: 1, subtopic: 'all', chart: null, chartRange: 14 };

  var MARKET_LABELS = { '中国快讯': 'A股' };
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function normMarket(m) { return MARKET_LABELS[m] || m || '其他'; }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    var diff = Math.floor((Date.now() - d) / 60000);
    if (diff >= 0 && diff < 60) return diff + '分钟前';
    if (diff >= 60 && diff < 1440) return Math.floor(diff / 60) + '小时前';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function fullTime(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') +
      ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // ---------- 晨昏线背景 ----------
  function updateSky() {
    var h = new Date().getHours() + new Date().getMinutes() / 60;
    var sky = $('sky-bg'), sun = $('sky-sun'), stars = $('sky-stars'), horizon = document.querySelector('.sky-horizon');
    var top, bottom, horizonColor, sunColor, sunTop, starOpacity;
    if (h >= 6 && h < 9) {          // 黎明
      var t = (h - 6) / 3;
      top = mix([58, 74, 122], [126, 168, 214], t);
      bottom = mix([247, 196, 150], [244, 224, 196], t);
      horizonColor = 'rgba(255,190,120,.55)'; sunColor = '#ffd28a'; sunTop = 150 - t * 40; starOpacity = 0.25 * (1 - t);
    } else if (h >= 9 && h < 16) {   // 白天
      top = '#7fb0e0'; bottom = '#eaf3fb'; horizonColor = 'rgba(255,255,255,.4)'; sunColor = '#fff3c4'; sunTop = 42; starOpacity = 0;
    } else if (h >= 16 && h < 19) {  // 黄昏
      var t2 = (h - 16) / 3;
      top = mix([104, 138, 186], [52, 60, 110], t2);
      bottom = mix([250, 200, 150], [214, 138, 120], t2);
      horizonColor = 'rgba(255,140,90,.55)'; sunColor = '#ff9d6b'; sunTop = 90 + t2 * 70; starOpacity = t2 * 0.3;
    } else {                          // 夜晚
      top = '#1a2b4a'; bottom = '#3b4a6b'; horizonColor = 'rgba(90,110,160,.35)'; sunColor = '#e8eef8'; sunTop = 200; starOpacity = 0.75;
      // 夜晚不显示太阳（当作月亮也行，这里隐藏）
      sun.style.opacity = '0.25';
    }
    if (h >= 6 && h < 19) sun.style.opacity = '1';
    var grad = 'linear-gradient(to bottom, ' + (typeof top === 'string' ? top : rgb(top)) + ', ' + (typeof bottom === 'string' ? bottom : rgb(bottom)) + ')';
    sky.style.background = grad;
    horizon.style.background = horizonColor;
    sun.style.background = sunColor;
    sun.style.top = sunTop + 'px';
    sun.style.boxShadow = '0 0 40px 12px ' + sunColor;
    stars.style.opacity = starOpacity;
  }
  function mix(a, b, t) { return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }); }
  function rgb(a) { return 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')'; }

  // ---------- 猫猫 SVG ----------
  function renderCat(cat) {
    var eyes, mouth, extra = '';
    var face = '#FFD95E', line = '#8a6d1f', blush = 'rgba(230,120,120,.4)';
    if (cat === 'bull') {           // 起飞：星星眼 + 大笑
      eyes = '<path d="M38 52 l4 -7 4 7 -4 7z" fill="#fff" stroke="' + line + '"/><path d="M74 52 l4 -7 4 7 -4 7z" fill="#fff" stroke="' + line + '"/>';
      mouth = '<path d="M50 70 q10 12 20 0" fill="none" stroke="' + line + '" stroke-width="2.5" stroke-linecap="round"/>';
      extra = '<text x="98" y="30" font-size="16">✦</text><text x="18" y="40" font-size="12">✦</text>';
    } else if (cat === 'happy') {   // 开心：眯眼笑
      eyes = '<path d="M36 52 q6 -8 12 0" fill="none" stroke="' + line + '" stroke-width="2.5" stroke-linecap="round"/><path d="M72 52 q6 -8 12 0" fill="none" stroke="' + line + '" stroke-width="2.5" stroke-linecap="round"/>';
      mouth = '<path d="M52 68 q8 9 16 0" fill="none" stroke="' + line + '" stroke-width="2.5" stroke-linecap="round"/>';
    } else if (cat === 'worried') { // 担忧：耷拉眼 + 波浪嘴
      eyes = '<path d="M36 52 q6 6 12 0" fill="none" stroke="' + line + '" stroke-width="2.5" stroke-linecap="round"/><path d="M72 52 q6 6 12 0" fill="none" stroke="' + line + '" stroke-width="2.5" stroke-linecap="round"/>';
      mouth = '<path d="M53 72 q7 -6 14 0" fill="none" stroke="' + line + '" stroke-width="2.5" stroke-linecap="round"/>';
    } else if (cat === 'bear') {    // 抱头：X眼 + 大开口 + 汗
      eyes = '<path d="M36 48 l12 10 M48 48 l-12 10 M72 48 l12 10 M84 48 l-12 10" stroke="' + line + '" stroke-width="2.5" stroke-linecap="round"/>';
      mouth = '<ellipse cx="60" cy="74" rx="8" ry="7" fill="#7a4a3a"/>';
      extra = '<path d="M92 44 q4 6 0 10 q-4 -4 0 -10z" fill="#9ec8f0"/>';
    } else {                        // calm 淡定
      eyes = '<circle cx="42" cy="52" r="3" fill="' + line + '"/><circle cx="78" cy="52" r="3" fill="' + line + '"/>';
      mouth = '<path d="M54 68 h12" stroke="' + line + '" stroke-width="2.5" stroke-linecap="round"/>';
    }
    $('cat-svg').innerHTML =
      '<path d="M28 44 L24 18 L46 32 Z" fill="' + face + '" stroke="' + line + '" stroke-width="2"/>' +
      '<path d="M92 44 L96 18 L74 32 Z" fill="' + face + '" stroke="' + line + '" stroke-width="2"/>' +
      '<circle cx="60" cy="60" r="38" fill="' + face + '" stroke="' + line + '" stroke-width="2"/>' +
      '<ellipse cx="36" cy="64" rx="7" ry="4" fill="' + blush + '"/><ellipse cx="84" cy="64" rx="7" ry="4" fill="' + blush + '"/>' +
      '<path d="M56 62 l4 4 4 -4 z" fill="#e08a7a"/>' +
      eyes + mouth +
      '<path d="M34 62 l-12 -4 M34 68 l-12 2 M86 62 l12 -4 M86 68 l12 2" stroke="' + line + '" stroke-width="1.5" stroke-linecap="round"/>' +
      extra;
  }

  function renderMood(mood) {
    if (!mood) return;
    $('mood-label').textContent = '市场多空程度';
    $('mood-cat-mood').textContent = mood.catMood + ' · ' + mood.label;
    var s = mood.score || 0;
    var pct = (s + 100) / 200 * 100;
    $('mood-fill').style.left = 'calc(' + pct + '% - 2px)';
    var scoreEl = $('mood-score');
    scoreEl.textContent = (s > 0 ? '+' : '') + s;
    scoreEl.className = 'mood-score ' + (s > 20 ? 'pos' : s < -20 ? 'neg' : 'zero');
    renderCat(mood.cat);
  }

  // ---------- 行情 ----------
  function sparkPath(history, w, h) {
    if (!history || history.length < 2) return '';
    var vals = history.map(function (p) { return p.close; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), span = (mx - mn) || 1;
    return vals.map(function (v, i) {
      var x = (i / (vals.length - 1)) * w;
      var y = h - ((v - mn) / span) * (h - 4) - 2;
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
  }

  function renderQuotes(quotes) {
    var box = $('quotes-grid');
    var list = (quotes && quotes.quotes) || [];
    if (!list.length) { box.innerHTML = '<div class="empty-state">行情数据暂不可用</div>'; return; }
    box.innerHTML = list.map(function (q) {
      var dc = q.decimals == null ? 2 : q.decimals;
      var price = (q.price != null) ? (q.unit || '') + Number(q.price).toFixed(dc) : '--';
      var chg = q.changePct;
      var cls = chg == null ? 'qc-flat' : (chg > 0 ? 'qc-up' : chg < 0 ? 'qc-down' : 'qc-flat');
      var chgText = chg == null ? (q.reference ? '参考值' : '—') :
        (chg > 0 ? '+' : '') + Number(chg).toFixed(2) + '% ' + (chg > 0 ? '▲' : chg < 0 ? '▼' : '—');
      var spark = q.history && q.history.length > 1
        ? '<svg class="qc-spark" viewBox="0 0 46 20"><path d="' + sparkPath(q.history, 46, 20) +
          '" fill="none" stroke="' + (chg != null && chg < 0 ? '#16976b' : '#d92b2b') + '" stroke-width="1.5"/></svg>' : '';
      var ref = q.reference ? '<span class="qc-ref">参考</span>' : '';
      return '<div class="quote-card" data-key="' + esc(q.key) + '">' + ref +
        '<div class="qc-name">' + esc(q.name) + '</div>' +
        '<div class="qc-price">' + esc(price) + '</div>' +
        '<div class="qc-chg ' + cls + '">' + esc(chgText) + '</div>' + spark + '</div>';
    }).join('');
    // 绑定点击
    Array.prototype.forEach.call(box.querySelectorAll('.quote-card'), function (el) {
      el.addEventListener('click', function () { openChart(el.dataset.key); });
    });
  }

  // ---------- 走势图弹窗 ----------
  function openChart(key) {
    var q = (state.quotes && state.quotes.quotes || []).find(function (x) { return x.key === key; });
    if (!q) return;
    if (!q.history || q.history.length < 2) {
      $('chart-note').textContent = q.note || '该品种暂无历史走势数据' + (q.reference ? '（当前显示参考值）' : '');
    } else {
      $('chart-note').textContent = '数据来源：新浪财经 · 日线收盘价';
    }
    var dc = q.decimals == null ? 2 : q.decimals;
    var chg = q.changePct;
    $('chart-title').textContent = q.name;
    $('chart-price').innerHTML = (q.unit || '') + Number(q.price).toFixed(dc) +
      ' <span class="' + (chg > 0 ? 'qc-up' : chg < 0 ? 'qc-down' : 'qc-flat') + '">' +
      (chg == null ? '' : (chg > 0 ? '+' : '') + chg.toFixed(2) + '%') + '</span>';
    state.chart = q;
    $('chart-modal').classList.remove('hidden');
    drawChart();
  }
  function closeChart() { $('chart-modal').classList.add('hidden'); }

  function drawChart() {
    var q = state.chart; if (!q) return;
    var canvas = $('chart-canvas');
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    var ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    var W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);
    var hist = (q.history || []).slice(-state.chartRange);
    if (hist.length < 2) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('暂无历史走势数据', W / 2, H / 2);
      return;
    }
    var vals = hist.map(function (p) { return p.close; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var pad = (mx - mn) * 0.1 || 1; mn -= pad; mx += pad;
    var pl = 6, pr = 6, pt = 12, pb = 26;
    var cw = W - pl - pr, ch = H - pt - pb;
    var up = vals[vals.length - 1] >= vals[0];
    var color = up ? '#d92b2b' : '#16976b';
    // 网格
    ctx.strokeStyle = 'rgba(148,163,184,.2)'; ctx.lineWidth = 1;
    for (var g = 0; g <= 3; g++) { var gy = pt + ch * g / 3; ctx.beginPath(); ctx.moveTo(pl, gy); ctx.lineTo(W - pr, gy); ctx.stroke(); }
    // 面积
    var pts = vals.map(function (v, i) {
      return [pl + (i / (vals.length - 1)) * cw, pt + (1 - (v - mn) / (mx - mn)) * ch];
    });
    ctx.beginPath(); ctx.moveTo(pts[0][0], pt + ch);
    pts.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
    ctx.lineTo(pts[pts.length - 1][0], pt + ch); ctx.closePath();
    var grad = ctx.createLinearGradient(0, pt, 0, pt + ch);
    grad.addColorStop(0, up ? 'rgba(217,43,43,.18)' : 'rgba(22,151,107,.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.fill();
    // 线
    ctx.beginPath(); pts.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    // 末点
    var last = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(last[0], last[1], 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    // 轴标签
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(hist[0].date.slice(5), pl, H - 8);
    ctx.textAlign = 'right'; ctx.fillText(hist[hist.length - 1].date.slice(5), W - pr, H - 8);
    ctx.textAlign = 'left'; ctx.fillText(mx.toFixed(q.decimals == null ? 0 : q.decimals), pl + 2, pt + 9);
  }

  // ---------- Top picks ----------
  function renderTop(data) {
    var box = $('top-picks');
    var ids = data.topPicks || [];
    var items = ids.map(function (id) {
      return (data.items || []).find(function (it) { return it.id === id; });
    }).filter(Boolean);
    if (!items.length) items = (data.items || []).slice(0, 8);
    $('top-count').textContent = items.length + ' 条 · 已智能去重';
    if (!items.length) { box.innerHTML = '<div class="empty-state">暂无要点数据</div>'; return; }
    box.innerHTML = items.map(function (it, i) {
      return '<a class="top-card ' + (it.sentiment || 'neutral') + '" href="' + esc(it.sourceUrl || '#') +
        '" target="_blank" rel="noopener"><span class="rank">' + (i + 1) + '</span>' +
        '<h3 class="tc-title">' + esc(it.title) + '</h3>' +
        '<div class="tc-meta"><span class="topic-chip">' + esc(it.subtopic || '综合') + '</span>' +
        '<span>' + esc(normMarket(it.market)) + '</span><span>' + esc(it.source || '') + '</span>' +
        '<span>' + esc(fmtTime(it.publishedAt)) + '</span></div>' +
        '<p class="tc-view">' + esc(it.tradingView || it.summary || '') + '</p></a>';
    }).join('');
  }

  // ---------- 筛选 chips ----------
  function renderSubtopicChips(data) {
    var counts = {};
    (data.items || []).forEach(function (it) { var t = it.subtopic || '综合'; counts[t] = (counts[t] || 0) + 1; });
    var topics = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 8);
    var box = $('subtopic-chips');
    var html = '<span class="subchip' + (state.subtopic === 'all' ? ' active' : '') + '" data-topic="all">全部</span>';
    html += topics.map(function (t) {
      return '<span class="subchip' + (state.subtopic === t ? ' active' : '') + '" data-topic="' + esc(t) + '">' + esc(t) + '</span>';
    }).join('');
    box.innerHTML = html;
  }

  // ---------- Feed ----------
  function importanceStars(n) {
    var h = '<span class="importance">';
    for (var i = 1; i <= 5; i++) h += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
    return h + '</span>';
  }
  function renderFeed(data) {
    var box = $('feed');
    var items = (data.items || []).filter(function (it) {
      if (state.market !== 'all' && normMarket(it.market) !== state.market) return false;
      if ((it.importance || 1) < state.minImportance) return false;
      if (state.subtopic !== 'all' && (it.subtopic || '综合') !== state.subtopic) return false;
      return true;
    });
    items.sort(function (a, b) { return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0); });
    $('feed-count').textContent = '共 ' + items.length + ' 条';
    $('feed-title').textContent = (state.market === 'all' ? '全部要闻' : state.market) + ' · 时间线';
    if (!items.length) { box.innerHTML = '<div class="empty-state">当前筛选下暂无新闻</div>'; return; }
    box.innerHTML = items.map(function (it) {
      var tags = (it.impactTags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
      var url = it.sourceUrl || '#';
      return '<article class="card"><div class="card-head">' +
        '<span class="market-chip">' + esc(normMarket(it.market)) + '</span>' +
        '<span class="topic-chip-2">' + esc(it.subtopic || '综合') + '</span>' +
        importanceStars(it.importance || 1) +
        '<span class="card-time"><span class="sentiment-dot ' + (it.sentiment || 'neutral') + '"></span> ' + esc(fmtTime(it.publishedAt)) + '</span></div>' +
        '<h3 class="card-title"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a></h3>' +
        '<p class="card-summary">' + esc(it.summary || '') + '</p>' +
        '<p class="card-view">' + esc(it.tradingView || '') + '</p>' +
        '<div class="tags"><span class="tag" style="background:#f5f7fa;color:var(--text-2);border-color:var(--border)">' +
        esc({ positive: '偏积极', negative: '偏谨慎', neutral: '中性' }[it.sentiment] || '中性') + '</span>' + tags +
        (url && url !== '#' ? '<a class="tag" style="text-decoration:none" href="' + esc(url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') +
        '</div></article>';
    }).join('');
  }

  function renderAll(news, quotes) {
    if (news) {
      state.data = news;
      $('update-time').textContent = '更新于 ' + fullTime((news.meta || {}).generatedAt) + ' · 近 ' + ((news.meta || {}).windowHours || 24) + '小时';
      renderMood(news.mood);
      renderTop(news);
      renderSubtopicChips(news);
      renderFeed(news);
    }
    if (quotes) { state.quotes = quotes; renderQuotes(quotes); }
  }

  // ---------- 数据加载 ----------
  function fetchJSON(url, force) {
    return fetch(url + (force ? '?t=' + Date.now() : ''), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    });
  }
  function showBanner(msg, isError) {
    var b = $('status-banner'); b.textContent = msg; b.className = 'status-banner' + (isError ? ' error' : '');
  }
  function loadData(force) {
    var btn = $('refresh-btn'); btn.classList.add('spinning');
    Promise.all([
      fetchJSON(NEWS_URL, force).catch(function () { return null; }),
      fetchJSON(QUOTES_URL, force).catch(function () { return null; })
    ]).then(function (res) {
      var news = res[0], quotes = res[1];
      var gotNews = news && Array.isArray(news.items);
      var gotQuotes = quotes && Array.isArray(quotes.quotes);
      if (gotNews) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(news)); } catch (e) {}
      }
      if (gotQuotes) {
        try { localStorage.setItem(QCache_KEY, JSON.stringify(quotes)); } catch (e) {}
      }
      var cNews = gotNews ? news : safeParse(CACHE_KEY);
      var cQuotes = gotQuotes ? quotes : safeParse(QCache_KEY);
      if (cNews || cQuotes) renderAll(cNews, cQuotes);
      if (!gotNews && !cNews) {
        if (!state.data) $('top-picks').innerHTML = '<div class="empty-state">数据加载失败，请点击右上角刷新</div>';
        showBanner('数据加载失败，请检查网络', true);
      } else if (!navigator.onLine) {
        showBanner('当前离线，展示缓存数据（可能非最新）', true);
      } else {
        showBanner('');
      }
    }).finally(function () { btn.classList.remove('spinning'); });
  }
  function safeParse(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }

  // ---------- 交互 ----------
  $('refresh-btn').addEventListener('click', function () { loadData(true); });
  $('chart-close').addEventListener('click', closeChart);
  $('chart-modal').addEventListener('click', function (e) { if (e.target === $('chart-modal')) closeChart(); });
  $('chart-tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.chart-tab'); if (!t) return;
    document.querySelectorAll('.chart-tab').forEach(function (x) { x.classList.remove('active'); });
    t.classList.add('active'); state.chartRange = parseInt(t.dataset.range, 10); drawChart();
  });
  window.addEventListener('resize', function () { if (!$('chart-modal').classList.contains('hidden')) drawChart(); });

  $('market-tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.tab'); if (!tab) return;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active'); state.market = tab.dataset.market;
    if (state.data) renderFeed(state.data);
  });
  $('importance-range').addEventListener('input', function (e) {
    state.minImportance = parseInt(e.target.value, 10);
    $('importance-value').textContent = state.minImportance <= 1 ? '全部' : '≥' + state.minImportance + '星';
    if (state.data) renderFeed(state.data);
  });
  $('subtopic-chips').addEventListener('click', function (e) {
    var chip = e.target.closest('.subchip'); if (!chip) return;
    state.subtopic = chip.dataset.topic;
    Array.prototype.forEach.call($('subtopic-chips').children, function (c) { c.classList.remove('active'); });
    chip.classList.add('active');
    if (state.data) renderFeed(state.data);
  });

  // 下拉刷新
  var startY = 0, pulling = false, indicator = $('pull-indicator');
  window.addEventListener('touchstart', function (e) { if (window.scrollY <= 0) startY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    var dy = e.touches[0].clientY - startY;
    if (window.scrollY <= 0 && dy > 60) { pulling = true; indicator.classList.add('show'); indicator.textContent = dy > 110 ? '释放立即刷新' : '下拉刷新'; }
  }, { passive: true });
  window.addEventListener('touchend', function () { if (pulling) { indicator.classList.remove('show'); loadData(true); } pulling = false; });

  // 定时更新晨昏线（每 10 分钟）
  updateSky(); setInterval(updateSky, 600000);

  // Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  // 启动：先渲染缓存
  var cNews = safeParse(CACHE_KEY), cQuotes = safeParse(QCache_KEY);
  if (cNews || cQuotes) renderAll(cNews, cQuotes);
  loadData(false);
})();
