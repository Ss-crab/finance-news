/* Service Worker：缓存 App Shell，网络优先更新 news.json，离线回退缓存。 */
var CACHE = 'overnight-finance-v2';
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];
var DATA_FILES = ['news.json', 'quotes.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // 数据文件：网络优先，成功后写入缓存
  var isData = DATA_FILES.some(function (f) { return url.pathname.indexOf(f) !== -1; });
  if (isData) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          if (cached) return cached;
          // 带 ?t= 时间戳的请求匹配不到时，退回无参数版本
          var clean = req.url.split('?')[0];
          return caches.match(clean);
        });
      })
    );
    return;
  }

  // App Shell：缓存优先
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
