// StageChord Service Worker
const CACHE_VERSION = 'sv-v15';
const APP_BUILD_ID = '20261016T2';
const APP_ASSETS = [
    './',
    './index.html',
    './help.html',
    `./app.js?v=${APP_BUILD_ID}`,
    `./parser.js?v=${APP_BUILD_ID}`,
    `./stave.js?v=${APP_BUILD_ID}`,
    `./db.js?v=${APP_BUILD_ID}`,
    `./styles.css?v=${APP_BUILD_ID}`,
    './app.js',
    './parser.js',
    './stave.js',
    './db.js',
    './styles.css',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './vexflow.bundle.js'
];

// Cache the whole app shell on install. cache.addAll is atomic: if any file fails
// (e.g. a deploy is still in flight) the install rejects, the half-built cache is
// discarded, and the currently-installed version keeps running — never a
// half-updated app. We deliberately do NOT skipWaiting here: a new version waits
// until the user chooses to apply it (see the update prompt in index.html).
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_ASSETS))
    );
});

// On activate, drop old version caches, then take control of open pages.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// The page posts this only when the user taps "Update" — never automatically.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Cache-first: the app loads instantly from the installed version every launch,
// even offline or on a slow connection, and never waits on the network. A session
// never mixes file versions — every asset comes from the same cache bucket, and a
// new version only arrives via the install/activate lifecycle above, never by
// overwriting the running cache. ignoreSearch lets a request for app.js?v=NNN match
// the cached copy regardless of the build stamp.
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    event.respondWith(
        caches.match(req, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            return fetch(req).catch(() => {
                // Offline and not in cache: fall back to the app shell for navigations
                // (e.g. opening a shared ?setUrl=... link while offline).
                if (req.mode === 'navigate') {
                    return caches.match('./index.html', { ignoreSearch: true });
                }
                return Response.error();
            });
        })
    );
});
