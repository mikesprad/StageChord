// StageChord Service Worker
const CACHE_VERSION = 'sv-v12';
const APP_BUILD_ID = '20260502T1';
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

// Cache app shell on install
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_ASSETS))
    );
    self.skipWaiting();
});

// Remove old caches on activate
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Network-first for navigation and app files, cache-first for CDN assets
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // For CDN resources (VexFlow), cache-first
    if (url.origin !== self.location.origin) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return fetch(event.request).then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // For app assets, network-first so updates take effect immediately
    event.respondWith(
        fetch(event.request).then((response) => {
            if (response.ok) {
                const clone = response.clone();
                caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
            }
            return response;
        }).catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
});
