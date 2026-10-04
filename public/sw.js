// Minimal service worker: network passthrough only. Exists for PWA
// installability — deliberately NO caching, so deploys are never stale
// (index.html is no-store and assets are content-hashed; adding a cache here
// would only reintroduce the staleness bugs that scheme already solved).
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* fall through to network */ });
