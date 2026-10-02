const CACHE = 'ayni-v1.3.5';
const ASSETS = [
  './', './index.html', './styles.css', './src/app.js', './src/parser.js',
  './src/navigation.js', './src/audio.js', './src/storage.js', './src/score.js', './src/schema.js', './src/format.js', './src/validator.js', './src/editor.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './samples/andean-dialogue.json', './samples/navigation-demo.json', './samples/range-demo.json', './JSON_FORMAT.md', './song.schema.json'
];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('ayni-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch (error) {
      if (event.request.mode === 'navigate') return (await caches.match(new URL('./index.html', self.registration.scope))) || Response.error();
      return Response.error();
    }
  })());
});
