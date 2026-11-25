// Service worker SpeedConnect — incrémenter VERSION à chaque déploiement pour renouveler le cache
const VERSION = "speedconnect-v5";
const SHELL = ["./", "./index.html", "./offline.html", "./manifest.webmanifest", "./app.js", "./assistants.js", "./scada.js", "./config.js", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;
  // Les données (Supabase, MQTT) passent toujours par le réseau
  if (/supabase\.(co|in)$/.test(url.hostname)) return;

  // Pages : réseau d'abord, puis cache, puis page hors ligne
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("./index.html", copy)); return res; })
        .catch(() => caches.match("./index.html").then((m) => m || caches.match("./offline.html")))
    );
    return;
  }

  // Ressources statiques et polices : cache d'abord, mise à jour en arrière-plan
  const sameOrigin = url.origin === location.origin;
  const fonts = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"].includes(url.hostname);
  if (sameOrigin || fonts) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req)
          .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })
          .catch(() => cached);
        return cached || net;
      })
    );
  }
});
