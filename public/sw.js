const CACHE_NAME = 'domus-standalone-cache-v2.9.3';

const PRECACHE_URLS = [
  '/standalone/index.html',
  '/standalone/app.js',
  '/standalone/app.css',
  '/manifest.json',
  '/version.json',
  '/domus-logo.png',
  '/domus-logo.png?v=2',
  '/domus-logo.png?v=3',
  '/favicon.ico',
  '/favicon.ico?v=3',
  '/apple-touch-icon.png',
  '/apple-touch-icon.png?v=3',
  '/pwa-192x192.png',
  '/pwa-192x192.png?v=3',
  '/pwa-512x512.png',
  '/pwa-512x512.png?v=3',
  '/pwa-maskable-512x512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of PRECACHE_URLS) {
        try {
          const response = await fetch(url, { cache: 'reload' });
          if (response && response.status === 200 && !response.redirected) {
            await cache.put(url, response.clone());
          }
        } catch {
          // Ignore individual asset failure during initial install
        }
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
      await self.clients.claim();
    })()
  );
});

async function refreshStandaloneBundleInBackground(cache) {
  try {
    const shellRes = await fetch('/standalone/index.html?t=' + Date.now(), {
      cache: 'no-store',
    });
    if (!shellRes || shellRes.status !== 200 || shellRes.redirected) {
      return;
    }
    const text = await shellRes.clone().text();
    // Verify that the server is actually serving the Domus bundle and not an AI Studio sleeping proxy page
    if (!text.includes('DOMUS_STANDALONE_BUNDLE_OK')) {
      return;
    }
    await cache.put('/standalone/index.html', shellRes);

    const assetsToRefresh = ['/standalone/app.js', '/standalone/app.css', '/version.json'];
    for (const assetUrl of assetsToRefresh) {
      try {
        const res = await fetch(assetUrl, { cache: 'no-store' });
        if (res && res.status === 200 && !res.redirected) {
          await cache.put(assetUrl, res);
        }
      } catch {
        // Keep existing cached version
      }
    }
  } catch {
    // AI Studio server is closed/asleep; keep using cached standalone bundle
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept API endpoints
  if (url.pathname.startsWith('/api/')) return;

  // Never intercept Firebase, Firestore, Google Auth, or external API calls
  if (url.origin !== self.location.origin) {
    if (
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com'
    ) {
      event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
          const cached = await cache.match(request);
          if (cached) return cached;
          try {
            const netRes = await fetch(request);
            if (netRes && netRes.status === 200) {
              cache.put(request, netRes.clone());
            }
            return netRes;
          } catch {
            return cached || Response.error();
          }
        })
      );
    }
    return;
  }

  // 1. Navigation requests (opening the app link, bookmark, PWA icon, or refreshing the page)
  if (
    request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname === '/standalone/index.html'
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        // Try network first with a fast 2.2s timeout so new versions from Vercel / GitHub
        // appear immediately without needing to reinstall, and fall back to Cache Storage when offline
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2200);
          const netRes = await fetch(request, {
            cache: 'no-store',
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (netRes && netRes.status === 200 && !netRes.redirected) {
            const htmlText = await netRes.clone().text();
            if (htmlText.includes('DOMUS_STANDALONE_BUNDLE_OK')) {
              await cache.put('/index.html', netRes.clone());
              event.waitUntil(refreshStandaloneBundleInBackground(cache));
              return netRes;
            }
          }
        } catch {
          // Offline or server asleep -> serve cached standalone bundle immediately
        }

        const cachedIndex = await cache.match('/index.html');
        if (cachedIndex) {
          return cachedIndex;
        }
        const cachedStandaloneShell = await cache.match('/standalone/index.html');
        if (cachedStandaloneShell) {
          return cachedStandaloneShell;
        }
        return fetch(request);
      })()
    );
    return;
  }

  // 2. Static icon assets: Cache-First for instant startup
  if (
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.svg') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached =
          (await cache.match(request)) || (await cache.match(url.pathname));
        if (cached) {
          return cached;
        }
        try {
          const netRes = await fetch(request);
          if (netRes && netRes.status === 200 && !netRes.redirected) {
            await cache.put(request, netRes.clone());
          }
          return netRes;
        } catch {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // 3. version.json & other assets: Network-First with cache fallback
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const netRes = await fetch(request);
        if (netRes && netRes.status === 200 && !netRes.redirected) {
          await cache.put(request, netRes.clone());
          return netRes;
        }
      } catch {
        // Fallback to cache when AI Studio is closed
      }
      const cached =
        (await cache.match(request)) || (await cache.match(url.pathname));
      if (cached) return cached;
      return Response.error();
    })()
  );
});
