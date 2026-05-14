/* ============================================================
   Examia — service-worker.js  v3
   Strategy:
     • Static assets  → Cache-First  (instant repeat loads)
     • Navigation     → Network-First with cache fallback
     • External (CDN) → Stale-While-Revalidate
   Additions in v3:
     • Web Push notification handlers
     • Windows 11 PWA Widget handlers
   ============================================================ */

const APP_VERSION   = 'v3';
const STATIC_CACHE  = `examia-static-${APP_VERSION}`;
const DYNAMIC_CACHE = `examia-dynamic-${APP_VERSION}`;

/* Core app shell — cached on install */
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './notifications.js',
  './manifest.json',
  './favicon.ico',
  './favicon.png',
  './splash.png',
  './splash-wide.png',
  './icon-192.png',
  './icon-512.png',
  './icon-96.png',
];

/* CDN origins served stale-while-revalidate */
const CDN_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];


/* ── INSTALL: pre-cache static shell ─────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())   /* activate immediately */
  );
});


/* ── ACTIVATE: purge old caches + re-render widgets ─────── */
self.addEventListener('activate', event => {
  const keep = [STATIC_CACHE, DYNAMIC_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => !keep.includes(k))
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())   /* take control at once */
      .then(() => updateAllWidgets())     /* re-render any installed widgets */
  );
});


/* ── FETCH: route-based caching strategies ───────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* 1. Non-GET requests — always go to network */
  if (request.method !== 'GET') return;

  /* 2. CDN resources — stale-while-revalidate */
  if (CDN_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
    return;
  }

  /* 3. Same-origin HTML navigation — network-first */
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  /* 4. Static app-shell assets — cache-first */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  /* 5. Everything else — network only */
  event.respondWith(fetch(request));
});


/* ── Strategies ──────────────────────────────────────────── */

/** Cache-First: serve from cache; fall back to network + re-cache */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline — resource not cached.', { status: 503 });
  }
}

/** Network-First: try network; on failure serve cache */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match('./index.html');  /* offline fallback */
  }
}

/** Stale-While-Revalidate: return cache instantly; update in background */
async function staleWhileRevalidate(request, cacheName) {
  const cache        = await caches.open(cacheName);
  const cached       = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);  /* silently fall back if offline */
  return cached || fetchPromise;
}


/* ============================================================
   § NOTIFICATIONS
   ============================================================ */

/**
 * message — receives LOCAL_NOTIFY from notifications.js and
 * shows a native OS notification. Works when the tab is in
 * the background.
 */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'LOCAL_NOTIFY') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, options || {})
    );
  }
});

/**
 * notificationclick — handles taps on OS notifications.
 * Focuses an existing app window or opens a new one.
 */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/**
 * push — handles server-sent Web Push messages.
 * Only fires when your server delivers a push payload via the
 * Web Push Protocol (requires VAPID keys in notifications.js).
 */
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'Examia', body: event.data.text() }; }

  const { title = 'Examia', body = '', data = {}, ...rest } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:    './icon-192.png',
      badge:   './icon-512.png',
      vibrate: [200, 100, 200],
      data,
      ...rest,
    })
  );
});


/* ============================================================
   § WIDGETS  (Windows 11 PWA Widgets Board)
   ============================================================ */

/**
 * renderWidget — fetches the Adaptive Card template and matching
 * data file for a given widget and pushes it to the Widgets Board.
 */
async function renderWidget(widget) {
  try {
    const templateUrl = widget.definition.msAcTemplate;
    const template    = await fetch(templateUrl).then(r => r.text());

    let data;
    if (widget.definition.tag === 'pomodoro-widget') {
      data = await fetch('./widgets/pomodoro-data.json').then(r => r.text());
    } else if (widget.definition.tag === 'exams-widget') {
      data = await fetch('./widgets/exams-data.json').then(r => r.text());
    } else {
      data = await fetch(widget.definition.data).then(r => r.text());
    }

    await self.widgets.updateByTag(widget.definition.tag, { template, data });
  } catch (err) {
    console.warn('[Widget] renderWidget failed:', err);
  }
}

/**
 * updateAllWidgets — re-renders every installed widget instance.
 * Called on activate so widgets never show stale or empty UI
 * after a service worker update.
 */
async function updateAllWidgets() {
  if (!self.widgets) return;   /* guard: Widgets API only on Edge + Windows 11 */
  try {
    const all = await self.widgets.matchAll();
    await Promise.all(all.map(w => renderWidget(w)));
  } catch (err) {
    console.warn('[Widget] updateAllWidgets failed:', err);
  }
}

/**
 * widgetinstall — fired when the user pins a widget from the
 * Windows 11 Widgets Board. Renders it immediately and registers
 * a periodic sync so it refreshes automatically.
 */
self.addEventListener('widgetinstall', event => {
  event.waitUntil((async () => {
    await renderWidget(event.widget);

    const tag = event.widget.definition.tag;
    if ('periodicSync' in self.registration) {
      const tags = await self.registration.periodicSync.getTags().catch(() => []);
      if (!tags.includes(tag)) {
        await self.registration.periodicSync.register(tag, {
          minInterval: event.widget.definition.update || 900,
        }).catch(() => {});
      }
    }
  })());
});

/**
 * widgetuninstall — fired when the user removes a widget.
 * Cleans up the periodic sync so it doesn't keep running.
 */
self.addEventListener('widgetuninstall', event => {
  event.waitUntil((async () => {
    const tag = event.widget.definition.tag;
    if (event.widget.instances.length === 1 && 'periodicSync' in self.registration) {
      await self.registration.periodicSync.unregister(tag).catch(() => {});
    }
  })());
});

/**
 * widgetresume — fired when the Widgets Board resumes rendering
 * after suspension (e.g. device wake from sleep). Re-renders
 * so the widget shows fresh data immediately.
 */
self.addEventListener('widgetresume', event => {
  event.waitUntil(renderWidget(event.widget));
});

/**
 * periodicsync — fires on the schedule set during widgetinstall.
 * Updates widget data in the background without user interaction.
 * Pomodoro widget: every 15 min  (update: 900 in manifest)
 * Exams widget:    every 60 min  (update: 3600 in manifest)
 */
self.addEventListener('periodicsync', event => {
  event.waitUntil((async () => {
    if (!self.widgets) return;
    const widget = await self.widgets.getByTag(event.tag).catch(() => null);
    if (widget && 'update' in widget.definition) {
      await renderWidget(widget);
    }
  })());
});

/**
 * widgetclick — fired when the user taps an action button inside
 * a rendered widget (e.g. "Open Timer", "View Planner", "Add Exam").
 * Opens or focuses the matching section of the Examia app.
 */
self.addEventListener('widgetclick', event => {
  const urlMap = {
    'open-pomodoro': '/index.html#pomodoro',
    'open-planner':  '/index.html#planner',
    'add-exam':      '/index.html#planner',
  };

  const url = urlMap[event.action];
  if (!url) return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});