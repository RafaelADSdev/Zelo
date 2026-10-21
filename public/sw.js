const CACHE = 'zelo-public-v1';
const PUBLIC_FILES = ['/offline', '/offline.css', '/brand/icon.svg', '/manifest.webmanifest', '/brand/pwa/icon-192.png', '/brand/pwa/icon-512.png', '/brand/pwa/maskable-512.png', '/brand/pwa/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC_FILES.map(path => new Request(path, { cache: 'reload', credentials: 'omit' })))));
  // Do not replace a running version underneath unsaved forms.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('zelo-public-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || request.headers.has('authorization')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try { const response = await fetch(request); if (response.status < 500) return response; } catch {}
      return await (await caches.open(CACHE)).match('/offline') || new Response('Zelo indisponível. Verifique sua conexão e tente novamente.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }
  if (!PUBLIC_FILES.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try { const response = await fetch(request); if (response.ok && response.type !== 'opaque') await cache.put(url.pathname, response.clone()); return response; }
    catch (error) { const saved = await cache.match(url.pathname); if (saved) return saved; throw error; }
  })());
});
