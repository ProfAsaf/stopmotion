/* Stop Motion — offline service worker.
   The page is fetched network-first, so a new version shows up on the next launch
   whenever the iPad is online, and the cached copy is used offline. Icons and the
   MP4 muxer library are cache-first. Bump CACHE (v1 -> v2 -> ...) to drop old files. */
const CACHE = 'stopmotion-v2';
const MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.min.js';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);                                             // essential shell
    try { await cache.add(new Request(MUXER, { mode: 'cors' })); } catch (e) {/* fetched on first export */}
    await self.skipWaiting();                                             // activate immediately
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));  // drop old versions
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const ours = new URL(req.url).origin === self.location.origin;
  if (!ours && req.url !== MUXER) return;                                 // leave other sites alone

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        // no-cache: check with the server every launch (GitHub Pages lets browsers keep pages 10 min)
        let res = await fetchWithTimeout(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }), 4000);
        if (res.redirected) res = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
        if (res.ok) cache.put('./index.html', res.clone());                  // remember the newest page
        return res;
      } catch (e) {
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: ours });
    if (cached) return cached;
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  })());
});

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((r) => { clearTimeout(timer); resolve(r); }, (e) => { clearTimeout(timer); reject(e); });
  });
}
