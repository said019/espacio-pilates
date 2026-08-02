const CACHE_NAME = "tep-v3";
const PRECACHE_URLS = ["/", "/icon-192.png", "/icon-512.png", "/valiance-logo.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Solo tocamos peticiones de este mismo origen.
  if (url.origin !== self.location.origin) return;
  // El API nunca pasa por caché.
  if (url.pathname.startsWith("/api/")) return;

  // NUNCA interceptar el JS/CSS de la app. Si respondíamos con un 503 sintético,
  // el navegador tomaba esa respuesta como "el módulo cargó y está roto", el
  // import() dinámico de la página fallaba y la clienta quedaba con la pantalla
  // en blanco. Dejándolo pasar sin interceptar, el error es un error de red real
  // y lazyWithRetry() puede reintentar y recargar.
  if (
    req.destination === "script" ||
    req.destination === "style" ||
    url.pathname.startsWith("/assets/")
  ) return;

  // Navegaciones: red primero, y si de plano no hay conexión servimos el shell
  // precacheado en vez de un 503 sin contenido.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/").then((r) =>
          r || new Response("Sin conexión. Revisa tu internet e inténtalo de nuevo.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        )
      )
    );
    return;
  }

  // Resto de estáticos (iconos, imágenes): red primero, caché de respaldo.
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((r) => r || Response.error()))
  );
});

// ─── Web Push ────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "Tu Espacio Pilates";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl).catch(() => { });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
