/*
 * Service worker do ASTRYON. Só guarda a página "sem conexão" e os ícones.
 * Dados do painel NUNCA vêm do cache: número velho apresentado como atual seria dado inventado.
 */
const CACHE = "astryon-v1";
const SHELL = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Só navegações: se o servidor não responder, mostra a página offline em vez do erro do navegador.
  if (req.mode !== "navigate") return;
  event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
});
