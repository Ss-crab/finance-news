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
    // 统一走明亮温暖的「黄昏感」色调，整体提亮，弱化黑夜的沉闷
    if (h >= 6 && h < 9) {          // 黎明：暖粉金
      var t = (h - 6) / 3;
      top = mix([176, 168, 214], [150, 196, 232], t);
      bottom = mix([255, 210, 180], [255, 226, 200], t);
      horizonColor = 'rgba(255,190,150,.6)'; sunColor = '#ffe0a8'; sunTop = 140 - t * 50; starOpacity = 0.12 * (1 - t);
    } else if (h >= 9 && h < 16) {   // 白天：明亮暖蓝
      top = '#a8cdee'; bottom = '#f3f7fb'; horizonColor = 'rgba(255,235,210,.45)'; sunColor = '#fff6d8'; sunTop = 40; starOpacity = 0;
    } else if (h >= 16 && h < 19) {  // 黄昏：明亮橙粉紫（主基调）
      var t2 = (h - 16) / 3;
      top = mix([168, 150, 210], [196, 138, 186], t2);
      bottom = mix([255, 214, 170], [255, 186, 168], t2);
      horizonColor = 'rgba(255,150,110,.6)'; sunColor = '#ffb27a'; sunTop = 80 + t2 * 55; starOpacity = t2 * 0.18;
    } else {                          // 夜晚：柔和蓝紫，仍保留微光但不压抑
      top = '#5b6a97'; bottom = '#98a4c4'; horizonColor = 'rgba(150,165,205,.4)'; sunColor = '#f4f0e0'; sunTop = 170; starOpacity = 0.5;
      sun.style.opacity = '0.45';
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

  // ---------- 像素猫猫 SVG ----------
  // 用像素方块网格绘制猫头，心情不同则表情与装饰不同
  function renderCat(cat) {
    var face = '#F7B733', faceDark = '#E89A20', outline = '#5A3A12', pink = '#FF8C94', ink = '#3A2A12';
    var px = function (x, y, w, h, fill) {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"/>';
    };

    // 基础猫头（像素块，单位 px，画布 120x120）
    var base =
      // 耳朵
      px(20, 18, 10, 10, outline) + px(30, 28, 50, 6, outline) +
      px(22, 20, 6, 6, face) + px(88, 18, 10, 10, outline) + px(88, 20, 6, 6, face) +
      // 头部主体（轮廓 + 脸）
      px(28, 30, 62, 8, outline) +
      px(24, 38, 70, 44, outline) +
      px(28, 42, 62, 36, face) +
      // 脸颊阴影
      px(28, 70, 62, 8, faceDark) +
      // 内耳
      px(34, 40, 10, 10, pink) + px(74, 40, 10, 10, pink);

    var eyes = '', mouth = '', decor = '';
    if (cat === 'bull') {           // 极多：星星眼 + 大笑 + 爱心
      eyes = px(40, 52, 8, 8, '#FFF') + px(42, 54, 4, 4, '#FFD400') +
             px(70, 52, 8, 8, '#FFF') + px(72, 54, 4, 4, '#FFD400');
      mouth = px(52, 66, 14, 6, ink) + px(56, 72, 6, 4, '#E8536B');
      // 爱心装饰（右上）
      decor = heart(100, 20, '#FF4D6D') + heart(16, 44, '#FF7A99');
    } else if (cat === 'happy') {   // 偏多：弯眼笑 + 小爱心
      eyes = px(38, 54, 12, 4, ink) + px(36, 52, 4, 4, ink) + px(48, 52, 4, 4, ink) +
             px(68, 54, 12, 4, ink) + px(66, 52, 4, 4, ink) + px(78, 52, 4, 4, ink);
      mouth = px(54, 66, 10, 4, ink) + px(52, 64, 4, 4, ink) + px(62, 64, 4, 4, ink);
      decor = heart(100, 26, '#FF6B8A');
    } else if (cat === 'worried') { // 偏空：耷拉眼 + 波浪嘴 + 汗滴
      eyes = px(38, 56, 12, 4, ink) + px(38, 52, 4, 4, ink) + px(46, 52, 4, 4, ink) +
             px(68, 56, 12, 4, ink) + px(68, 52, 4, 4, ink) + px(76, 52, 4, 4, ink);
      mouth = px(52, 68, 6, 3, ink) + px(58, 66, 6, 3, ink) + px(64, 68, 6, 3, ink);
      decor = px(96, 40, 5, 9, '#7EC8E3') + px(95, 49, 7, 3, '#7EC8E3'); // 汗滴
    } else if (cat === 'bear') {    // 极空：X眼 + 大开口 + 毒药
      eyes = px(38, 50, 4, 4, ink) + px(42, 54, 4, 4, ink) + px(46, 58, 4, 4, ink) + px(42, 62, 4, 4, ink) + px(38, 58, 4, 4, ink) +
             px(68, 50, 4, 4, ink) + px(72, 54, 4, 4, ink) + px(76, 58, 4, 4, ink) + px(72, 62, 4, 4, ink) + px(68, 58, 4, 4, ink);
      mouth = px(52, 66, 14, 10, '#5A3A12') + px(54, 68, 10, 6, '#2A1A0A');
      decor = poison(98, 26);       // 毒药瓶
    } else {                        // calm 淡定：圆眼 + 一字嘴
      eyes = px(40, 54, 6, 6, ink) + px(72, 54, 6, 6, ink);
      mouth = px(54, 68, 10, 3, ink);
    }
    // 鼻子
    var nose = px(56, 62, 6, 4, pink);
    $('cat-svg').innerHTML = base + eyes + nose + mouth + decor;
  }

  // 像素爱心
  function heart(x, y, color) {
    var p = function (dx, dy) { return '<rect x="' + (x + dx) + '" y="' + (y + dy) + '" width="4" height="4" fill="' + color + '"/>'; };
    return p(4,0)+p(12,0)+p(0,4)+p(4,4)+p(8,4)+p(12,4)+p(16,4)+
           p(0,8)+p(4,8)+p(8,8)+p(12,8)+p(16,8)+p(4,12)+p(8,12)+p(12,12)+p(8,16);
  }
  // 像素毒药瓶
  function poison(x, y) {
    var p = function (dx, dy, c) { return '<rect x="' + (x + dx) + '" y="' + (y + dy) + '" width="4" height="4" fill="' + c + '"/>'; };
    return p(6,0,'#888')+p(10,0,'#888')+p(8,4,'#ccc')+
           p(4,8,'#7ED957')+p(8,8,'#7ED957')+p(12,8,'#7ED957')+
           p(4,12,'#4CAF50')+p(8,12,'#4CAF50')+p(12,12,'#4CAF50')+p(16,12,'#4CAF50')+
           p(4,16,'#4CAF50')+p(8,16,'#4CAF50')+p(12,16,'#4CAF50')+p(16,16,'#4CAF50')+
           p(8,20,'#2E7D32')+p(12,20,'#2E7D32')+
           p(12,10,'#FFF')+p(14,12,'#FFF'); // 骷髅高光点
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
  // 轻提示 toast：刷新后明确反馈，避免用户以为没反应
  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'toast'; el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }
  function flashTimestamp() {
    var el = $('update-time');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  function loadData(force) {
    var btn = $('refresh-btn'); btn.classList.add('spinning');
    var beforeGen = state.data && (state.data.meta || {}).generatedAt;
    var startedAt = Date.now();
    Promise.all([
      fetchJSON(NEWS_URL, force).catch(function () { return null; }),
      fetchJSON(QUOTES_URL, force).catch(function () { return null; })
    ]).then(function (res) {
      var news = res[0], quotes = res[1];
      var gotNews = news && Array.isArray(news.items);
      var gotQuotes = quotes && Array.isArray(quotes.quotes);
      if (gotNews) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(news)); } catch (e) {} }
      if (gotQuotes) { try { localStorage.setItem(QCache_KEY, JSON.stringify(quotes)); } catch (e) {} }
      var cNews = gotNews ? news : safeParse(CACHE_KEY);
      var cQuotes = gotQuotes ? quotes : safeParse(QCache_KEY);
      if (cNews || cQuotes) renderAll(cNews, cQuotes);

      if (!gotNews && !cNews) {
        showBanner('数据加载失败，请检查网络', true);
        if (force) toast('刷新失败 · 请检查网络');
      } else if (!navigator.onLine) {
        showBanner('当前离线，展示缓存数据（可能非最新）', true);
        if (force) toast('离线中 · 展示缓存数据');
      } else {
        showBanner('');
        if (force) {
          // 至少转一圈再提示，视觉上更像"真的刷新了"
          var wait = Math.max(0, 450 - (Date.now() - startedAt));
          setTimeout(function () {
            var newGen = cNews && (cNews.meta || {}).generatedAt;
            if (newGen && beforeGen && newGen !== beforeGen) {
              toast('已更新至 ' + fullTime(newGen));
              flashTimestamp();
            } else {
              toast('已是最新 · 每日 7:30 自动更新');
              flashTimestamp();
            }
          }, wait);
        }
      }
    }).finally(function () { btn.classList.remove('spinning'); });
  }
  function safeParse(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }

  // ---------- 交互 ----------
  $('refresh-btn').addEventListener('click', function () { loadData(true); });
  $('update-time').addEventListener('click', function () { loadData(true); }); // 顶部"更新于"也可点
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
