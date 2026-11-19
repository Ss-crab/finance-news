/* 隔夜财经速览 — 前端逻辑
 * 只读同源 news.json；支持手动刷新、下拉刷新、localStorage 缓存与离线提示。
 */
(function () {
  'use strict';

  var DATA_URL = 'news.json';
  var CACHE_KEY = 'overnight_news_cache';
  var TIME_CACHE_KEY = 'overnight_news_fetch_time';
  var state = { data: null, market: 'all' };

  var MARKET_LABELS = {
    'A股': 'A股',
    '美股宏观': '美股宏观',
    '港股': '港股',
    '加密商品外汇': '加密·商品·外汇',
    '债券': '债券',
    '中国快讯': 'A股'
  };

  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var diffMin = Math.floor((now - d) / 60000);
    if (diffMin >= 0 && diffMin < 60) return diffMin + '分钟前';
    if (diffMin >= 60 && diffMin < 1440) return Math.floor(diffMin / 60) + '小时前';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function fullTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function sentimentLabel(s) {
    return { positive: '偏积极', negative: '偏谨慎', neutral: '中性' }[s] || '中性';
  }

  function normMarket(m) { return MARKET_LABELS[m] || m || '其他'; }

  // ---------- 渲染 ----------
  function renderTop(data) {
    var box = $('top-picks');
    var ids = data.topPicks || [];
    var items = ids.map(function (id) {
      return (data.items || []).find(function (it) { return it.id === id; });
    }).filter(Boolean);
    if (!items.length) items = (data.items || []).slice(0, 5);

    if (!items.length) {
      box.innerHTML = '<div class="empty-state">暂无要点数据</div>';
      return;
    }

    box.innerHTML = items.map(function (it, i) {
      var url = it.sourceUrl || '#';
      return '<a class="top-card ' + (it.sentiment || 'neutral') + '" href="' +
        escapeHtml(url) + '" target="_blank" rel="noopener">' +
        '<span class="rank">' + (i + 1) + '</span>' +
        '<h3 class="tc-title">' + escapeHtml(it.title) + '</h3>' +
        '<div class="tc-meta"><span>' + escapeHtml(normMarket(it.market)) + '</span>' +
        '<span>' + escapeHtml(it.source || '') + '</span>' +
        '<span>' + escapeHtml(formatTime(it.publishedAt)) + '</span></div>' +
        '<p class="tc-view">' + escapeHtml(it.tradingView || it.summary || '') + '</p>' +
        '</a>';
    }).join('');
  }

  function renderMood(data) {
    var box = $('mood-bar');
    var counts = { positive: 0, negative: 0, neutral: 0 };
    (data.items || []).forEach(function (it) {
      counts[it.sentiment] = (counts[it.sentiment] || 0) + 1;
    });
    var total = (data.items || []).length || 1;
    var groups = [
      { key: 'positive', label: '积极信号', color: 'var(--up)', n: counts.positive },
      { key: 'negative', label: '谨慎信号', color: 'var(--down)', n: counts.negative },
      { key: 'neutral', label: '中性信息', color: 'var(--neutral)', n: counts.neutral }
    ];
    box.innerHTML = groups.map(function (g) {
      var pct = Math.round(g.n / total * 100);
      return '<div class="mood-item">' +
        '<div class="mi-label">' + g.label + '</div>' +
        '<div class="mi-value">' + g.n + ' <span style="font-size:11px;color:var(--text-3)">条 · ' + pct + '%</span></div>' +
        '<div class="mi-bar"><span style="width:' + pct + '%;background:' + g.color + '"></span></div>' +
        '</div>';
    }).join('');
  }

  function importanceStars(n) {
    var html = '<span class="importance" title="重要性 ' + n + '/5">';
    for (var i = 1; i <= 5; i++) html += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
    return html + '</span>';
  }

  function renderFeed(data) {
    var box = $('feed');
    var items = data.items || [];
    if (state.market !== 'all') {
      items = items.filter(function (it) { return normMarket(it.market) === state.market; });
    }
    // 时间线按时间倒序
    items = items.slice().sort(function (a, b) {
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    });

    $('feed-count').textContent = '共 ' + items.length + ' 条';
    $('feed-title').textContent = (state.market === 'all' ? '全部要闻' : state.market) + ' · 时间线';

    if (!items.length) {
      box.innerHTML = '<div class="empty-state">该分区暂无新闻</div>';
      return;
    }

    box.innerHTML = items.map(function (it) {
      var tags = (it.impactTags || []).map(function (t) {
        return '<span class="tag">' + escapeHtml(t) + '</span>';
      }).join('');
      var url = it.sourceUrl || '#';
      return '<article class="card">' +
        '<div class="card-head">' +
          '<span class="market-chip">' + escapeHtml(normMarket(it.market)) + '</span>' +
          importanceStars(it.importance || 1) +
          '<span class="card-time"><span class="sentiment-dot ' + (it.sentiment || 'neutral') + '"></span> ' +
          escapeHtml(formatTime(it.publishedAt)) + '</span>' +
        '</div>' +
        '<h3 class="card-title"><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' +
          escapeHtml(it.title) + '</a></h3>' +
        '<p class="card-summary">' + escapeHtml(it.summary || '') + '</p>' +
        '<p class="card-view">' + escapeHtml(it.tradingView || '') + '</p>' +
        '<div class="tags">' +
          '<span class="tag" style="background:#f5f7fa;color:var(--text-2);border-color:var(--border)">' +
            escapeHtml(sentimentLabel(it.sentiment)) + '</span>' + tags +
          (url && url !== '#' ? '<a class="tag" style="text-decoration:none" href="' + escapeHtml(url) +
            '" target="_blank" rel="noopener">原文 ↗</a>' : '') +
        '</div>' +
        '</article>';
    }).join('');
  }

  function renderAll(data) {
    state.data = data;
    $('update-time').textContent = '更新于 ' + fullTime((data.meta || {}).generatedAt) +
      ' · 近 ' + ((data.meta || {}).windowHours || 24) + '小时';
    renderTop(data);
    renderMood(data);
    renderFeed(data);
  }

  // ---------- 数据加载 ----------
  function showBanner(msg, isError) {
    var b = $('status-banner');
    b.textContent = msg;
    b.className = 'status-banner' + (isError ? ' error' : '');
  }

  function loadData(force) {
    var btn = $('refresh-btn');
    btn.classList.add('spinning');
    var url = DATA_URL + (force ? '?t=' + Date.now() : '');

    fetch(url, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.items)) throw new Error('数据格式异常');
        renderAll(data);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(data));
          localStorage.setItem(TIME_CACHE_KEY, new Date().toISOString());
        } catch (e) {}
        var failed = (data.meta.sourcesFailed || []).length;
        if (failed) showBanner('部分数据源暂时不可用，已展示其余 ' + data.meta.itemsCount + ' 条', false);
        else showBanner('');
        if (!navigator.onLine) showBanner('当前离线，展示的是上次缓存的数据', true);
      })
      .catch(function (err) {
        var cached = null;
        try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) {}
        if (cached) {
          renderAll(cached);
          showBanner('无法连接网络，展示上次缓存的数据（可能非最新）', true);
        } else {
          if (!state.data) {
            $('top-picks').innerHTML = '<div class="empty-state">数据加载失败，请检查网络后点击右上角刷新</div>';
            $('feed').innerHTML = '';
            $('mood-bar').innerHTML = '';
          }
          showBanner('数据加载失败：' + err.message, true);
        }
      })
      .finally(function () { btn.classList.remove('spinning'); });
  }

  // ---------- 交互 ----------
  $('refresh-btn').addEventListener('click', function () { loadData(true); });

  $('market-tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    state.market = tab.dataset.market;
    if (state.data) renderFeed(state.data);
  });

  // 下拉刷新
  var startY = 0, pulling = false;
  var indicator = $('pull-indicator');
  window.addEventListener('touchstart', function (e) {
    if (window.scrollY <= 0) startY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    var dy = e.touches[0].clientY - startY;
    if (window.scrollY <= 0 && dy > 60) {
      pulling = true;
      indicator.classList.add('show');
      indicator.textContent = dy > 110 ? '释放立即刷新' : '下拉刷新';
    }
  }, { passive: true });
  window.addEventListener('touchend', function () {
    if (pulling) {
      indicator.classList.remove('show');
      loadData(true);
    }
    pulling = false;
  });

  // Service Worker 注册
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  // 启动：先渲染缓存，再拉取最新
  var cachedInit = null;
  try { cachedInit = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) {}
  if (cachedInit) renderAll(cachedInit);
  loadData(false);
})();
