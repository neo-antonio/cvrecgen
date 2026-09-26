const V = 'cv-recgen-v12';
const SHELL = ['./', 'index.html', 'receipt.html', 'portfolio.html', 'shipping.html', 'finance.html', 'marketing.html', 'settings.html', 'receipts.html',
  'styles.css', 'config.js', 'app.js', 'boot.js', 'portfolio.js', 'finance.js', 'shipping.js', 'receipts.js', 'manifest.webmanifest',
  'icons/logo.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== V).map(n => caches.delete(n)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  if (new URL(req.url).origin !== self.location.origin) return; // Apps Script calls, JSONP scripts, etc. go straight to the network
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => {
      if (r && (r.ok || r.type === 'opaque')) { const copy = r.clone(); caches.open(V).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => hit || Response.error());
    return hit || net;
  }));
});