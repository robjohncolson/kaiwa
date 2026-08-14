const CACHE_NAME = "kaiwa-shell-v21";
const API_PATH = new URL("./api/", self.registration.scope).pathname;
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./icon.svg",
  "./qr-kaiwa.svg",
  "./data/scenarios.json",
  "./data/missions.json",
  "./data/tree.json",
  "./data/readings.json",
  "./src/mastery.js",
  "./src/breakdown.js",
  "./src/field.js",
  "./src/map.js",
  "./src/mission.js",
  "./src/providers/llm.js",
  "./src/production.js",
  "./src/repair.js",
  "./src/readings.js",
  "./src/scheduler.js",
  "./src/session.js",
  "./src/store.js",
  "./src/ui.js",
  "./src/wizard.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith(API_PATH)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
