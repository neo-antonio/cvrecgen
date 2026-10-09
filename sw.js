const V = 'cv-recgen-v16';
const SHELL = ['./', 'index.html', 'receipt.html', 'portfolio.html', 'shipping.html', 'finance.html', 'marketing.html', 'settings.html', 'receipts.html',
  'styles.css', 'config.js', 'app.js', 'boot.js', 'portfolio.js', 'finance.js', 'shipping.js', 'receipts.js', 'marketing.js', 'manifest.webmanifest',
  'icons/logo.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== V).map(n => caches.delete(n)))));
  self.clients.claim();
});
// Network-first: pages, scripts and styles always come from the same fresh deploy, so an updated
// app.js can never be paired with an old receipt.html (that mismatch is what breaks a PWA after an
// update). The cache is only the fallback when offline or the network is slow (4s).
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  if (new URL(req.url).origin !== self.location.origin) return; // Apps Script calls, JSONP scripts, etc. go straight to the network
  e.respondWith((async () => {
    const cache = await caches.open(V);
    const net = fetch(req, { cache: 'no-cache' }).then(r => {
      if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
      return r;
    });
    net.catch(() => {});
    try {
      return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))]);
    } catch (_) {
      const hit = await cache.match(req);
      return hit || net.catch(() => Response.error());
    }
  })());
});
