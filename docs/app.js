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
    var header = document.querySelector('.app-header');
    var top, bottom, horizonColor, sunColor, sunTop, starOpacity, headerGrad;
    // 标题栏沿用参考图：深蓝紫云层 -> 暖橙金光的晨昏线渐变
    if (h >= 6 && h < 9) {          // 黎明：暖粉金
      var t = (h - 6) / 3;
      top = mix([176, 168, 214], [150, 196, 232], t);
      bottom = mix([255, 210, 180], [255, 226, 200], t);
      horizonColor = 'rgba(255,190,150,.6)'; sunColor = '#ffe0a8'; sunTop = 140 - t * 50; starOpacity = 0.12 * (1 - t);
      headerGrad = 'linear-gradient(115deg, rgba(74,84,138,.9), rgba(176,132,150,.85) 55%, rgba(232,176,132,.9))';
    } else if (h >= 9 && h < 16) {   // 白天：明亮暖蓝
      top = '#a8cdee'; bottom = '#f3f7fb'; horizonColor = 'rgba(255,235,210,.45)'; sunColor = '#fff6d8'; sunTop = 40; starOpacity = 0;
      headerGrad = 'linear-gradient(115deg, rgba(56,96,150,.88), rgba(96,140,186,.85) 55%, rgba(176,196,214,.88))';
    } else if (h >= 16 && h < 19) {  // 黄昏：明亮橙粉紫（主基调，贴合参考图）
      var t2 = (h - 16) / 3;
      top = mix([168, 150, 210], [196, 138, 186], t2);
      bottom = mix([255, 214, 170], [255, 186, 168], t2);
      horizonColor = 'rgba(255,150,110,.6)'; sunColor = '#ffb27a'; sunTop = 80 + t2 * 55; starOpacity = t2 * 0.18;
      headerGrad = 'linear-gradient(115deg, rgba(52,58,112,.92), rgba(146,92,120,.88) 52%, rgba(224,142,96,.92))';
    } else {                          // 夜晚：深蓝紫配暖橙余晖
      top = '#5b6a97'; bottom = '#98a4c4'; horizonColor = 'rgba(150,165,205,.4)'; sunColor = '#f4f0e0'; sunTop = 170; starOpacity = 0.5;
      headerGrad = 'linear-gradient(115deg, rgba(38,44,86,.92), rgba(78,64,110,.9) 55%, rgba(138,90,96,.92))';
      sun.style.opacity = '0.45';
    }
    if (h >= 6 && h < 19) sun.style.opacity = '1';
    var grad = 'linear-gradient(to bottom, ' + (typeof top === 'string' ? top : rgb(top)) + ', ' + (typeof bottom === 'string' ? bottom : rgb(bottom)) + ')';
    sky.style.background = grad;
    if (header) header.style.background = headerGrad;
    horizon.style.background = horizonColor;
    sun.style.background = sunColor;
    sun.style.top = sunTop + 'px';
    sun.style.boxShadow = '0 0 40px 12px ' + sunColor;
    stars.style.opacity = starOpacity;
  }
  function mix(a, b, t) { return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }); }
  function rgb(a) { return 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')'; }

  // ---------- 像素猫猫 SVG（重点色英短）----------
  // 浅奶油身体 + 深棕灰重点色(耳/面罩/鼻) + 蓝眼睛 + 圆脸大腮
  function renderCat(cat) {
    // 重点色英短配色
    var body = '#EFE6D6', bodyShade = '#DCCDB6', point = '#6E5B50', pointDark = '#4A3A31';
    var innerEar = '#E8A6A6', nosePink = '#D98E93', eyeBlue = '#4FB3DC', eyeDeep = '#2C7FA8';
    var px = function (x, y, w, h, fill) {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"/>';
    };

    // 基础猫头：圆脸大腮，深色耳朵（重点色）
    var base =
      // 耳朵外轮廓（深色 = 重点色）
      px(16, 28, 12, 8, pointDark) + px(20, 18, 10, 12, pointDark) +
      px(78, 18, 10, 12, pointDark) + px(80, 28, 12, 8, pointDark) +
      // 内耳粉
      px(22, 24, 6, 8, innerEar) + px(80, 24, 6, 8, innerEar) +
      // 头部轮廓（深棕灰描边）
      px(26, 30, 46, 8, pointDark) +
      px(20, 38, 58, 6, pointDark) +
      px(16, 44, 66, 30, pointDark) +
      px(20, 74, 58, 8, pointDark) +
      // 脸：浅奶油身体色 + 圆脸大腮
      px(24, 40, 50, 6, body) +
      px(20, 46, 58, 26, body) +
      px(24, 72, 50, 6, body) +
      // 脸颊两侧大腮（浅色凸起）
      px(16, 54, 8, 14, body) + px(74, 54, 8, 14, body) +
      // 面罩（重点色：口鼻周围深灰）
      px(40, 54, 20, 4, point) +
      px(36, 58, 28, 12, point) +
      px(40, 70, 20, 6, point) +
      // 脸颊阴影
      px(24, 74, 50, 4, bodyShade);

    var eyes = '', mouth = '', decor = '';
    if (cat === 'bull') {           // 极多：闪亮蓝星眼 + 大笑 + 双大爱心
      eyes = px(34, 50, 10, 10, eyeBlue) + px(36, 52, 6, 6, '#EAF9FF') + px(38, 54, 3, 3, eyeDeep) +
             px(56, 50, 10, 10, eyeBlue) + px(58, 52, 6, 6, '#EAF9FF') + px(60, 54, 3, 3, eyeDeep);
      mouth = px(44, 64, 14, 5, pointDark) + px(48, 69, 6, 3, nosePink);
      decor = heartBig(88, 12, '#FF3D6E') + heartBig(6, 40, '#FF7A9C');
    } else if (cat === 'happy') {   // 偏多：眯眼笑 + 大爱心
      eyes = px(34, 54, 10, 3, eyeDeep) + px(32, 52, 3, 3, eyeDeep) + px(43, 52, 3, 3, eyeDeep) +
             px(56, 54, 10, 3, eyeDeep) + px(54, 52, 3, 3, eyeDeep) + px(65, 52, 3, 3, eyeDeep);
      mouth = px(44, 64, 12, 3, pointDark) + px(42, 62, 3, 3, pointDark) + px(55, 62, 3, 3, pointDark);
      decor = heartBig(90, 20, '#FF5C85');
    } else if (cat === 'worried') { // 偏空：耷拉蓝眼 + 波浪嘴 + 大汗滴
      eyes = px(34, 56, 10, 3, eyeDeep) + px(34, 53, 3, 3, eyeDeep) + px(41, 53, 3, 3, eyeDeep) +
             px(56, 56, 10, 3, eyeDeep) + px(56, 53, 3, 3, eyeDeep) + px(63, 53, 3, 3, eyeDeep);
      mouth = px(44, 66, 5, 3, pointDark) + px(49, 64, 5, 3, pointDark) + px(54, 66, 5, 3, pointDark);
      decor = sweatBig(90, 42);
    } else if (cat === 'bear') {    // 极空：X眼 + 大开口 + 大毒药瓶
      eyes = px(34, 52, 3, 3, pointDark) + px(38, 56, 3, 3, pointDark) + px(42, 60, 3, 3, pointDark) + px(38, 64, 3, 3, pointDark) + px(34, 60, 3, 3, pointDark) +
             px(62, 52, 3, 3, pointDark) + px(58, 56, 3, 3, pointDark) + px(54, 60, 3, 3, pointDark) + px(58, 64, 3, 3, pointDark) + px(62, 60, 3, 3, pointDark);
      mouth = px(42, 64, 16, 10, pointDark) + px(45, 66, 10, 6, '#2A1A0A');
      decor = poisonBig(88, 26);
    } else {                        // calm 淡定：圆蓝眼 + 一字嘴
      eyes = px(36, 54, 7, 7, eyeBlue) + px(38, 56, 3, 3, eyeDeep) +
             px(57, 54, 7, 7, eyeBlue) + px(59, 56, 3, 3, eyeDeep);
      mouth = px(46, 66, 10, 3, pointDark);
    }
    // 粉色鼻子（重点色）
    var nose = px(46, 62, 8, 4, nosePink);
    $('cat-svg').innerHTML = base + eyes + nose + mouth + decor;
  }

  // 大号像素爱心（6px 网格）
  function heartBig(x, y, color) {
    var u = 6;
    var p = function (col, row) { return '<rect x="' + (x + col * u) + '" y="' + (y + row * u) + '" width="' + u + '" height="' + u + '" fill="' + color + '"/>'; };
    return p(1,0)+p(3,0)+p(0,1)+p(1,1)+p(2,1)+p(3,1)+p(4,1)+
           p(0,2)+p(1,2)+p(2,2)+p(3,2)+p(4,2)+
           p(1,3)+p(2,3)+p(3,3)+p(2,4);
  }
  // 大号汗滴（蓝色，6px 网格）
  function sweatBig(x, y) {
    var u = 6;
    var p = function (col, row, c) { return '<rect x="' + (x + col * u) + '" y="' + (y + row * u) + '" width="' + u + '" height="' + u + '" fill="' + (c || '#6FC3E8') + '"/>'; };
    return p(1,0)+p(2,0)+p(0,1)+p(1,1)+p(2,1)+p(3,1)+p(1,2)+p(2,2)+p(1,3,'#3E9BC4')+p(2,3,'#3E9BC4');
  }
  // 大号像素毒药瓶（6px 网格）
  function poisonBig(x, y) {
    var u = 6;
    var p = function (col, row, c) { return '<rect x="' + (x + col * u) + '" y="' + (y + row * u) + '" width="' + u + '" height="' + u + '" fill="' + c + '"/>'; };
    return p(1,0,'#999')+p(2,0,'#999')+p(1,1,'#CCC')+p(2,1,'#CCC')+
           p(0,2,'#8FE07A')+p(1,2,'#8FE07A')+p(2,2,'#8FE07A')+p(3,2,'#8FE07A')+
           p(0,3,'#4CAF50')+p(1,3,'#4CAF50')+p(2,3,'#4CAF50')+p(3,3,'#4CAF50')+
           p(0,4,'#4CAF50')+p(1,4,'#4CAF50')+p(2,4,'#4CAF50')+p(3,4,'#4CAF50')+
           p(1,5,'#2E7D32')+p(2,5,'#2E7D32')+
           p(2,2,'#FFF')+p(1,3,'#FFF'); // 高光/骷髅
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
