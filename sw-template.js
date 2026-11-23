// Offline shell for the GitHub Pages build. The placeholders are filled in at
// build time by the serviceWorker() plugin in vite.pages.config.ts, which knows
// the hashed asset names. Editing this file by hand is fine; it ships compiled.
const CACHE = 'folio-tree-__BUILD_ID__';
const SHELL = __SHELL__;
const INDEX = new URL('./index.html', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Cache writes are best effort: running out of storage must not stop the
// response that is already on its way to the page.
function store(key, response) {
  caches.open(CACHE).then((cache) => cache.put(key, response)).catch(() => undefined);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) store(request, response.clone());
  return response;
}

// The page is fetched from the network first so a new deployment is picked up as
// soon as the user is online again; the cached copy is the offline fallback.
async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) store(INDEX, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(INDEX);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Anything that is not a plain read of our own files — the GitHub API above
  // all — has to reach the network untouched.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(request.mode === 'navigate' ? networkFirstPage(request) : cacheFirst(request));
});
