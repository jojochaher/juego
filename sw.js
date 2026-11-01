// Network-first: siempre intenta traer lo último (el juego cambia seguido),
// y usa la caché solo si no hay conexión.
// SOLO toca los archivos del propio juego. Nada de Firebase ni otras páginas: si el service worker
// intercepta las conexiones en vivo (EventSource), las deja abiertas aunque la página las cierre
// y encima intenta guardar en caché un flujo que no termina nunca (v7.1).
const CACHE = 'juego-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);   // tira la caché vieja
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;          // Firebase, TURN, etc: directo
  if ((req.headers.get('accept') || '').includes('text/event-stream')) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
