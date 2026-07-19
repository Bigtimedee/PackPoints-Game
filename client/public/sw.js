// Self-destructing service worker.
// The pre-Railway deployment of packpts.com registered a service worker at
// this scope; browsers that visited it keep serving that stale app forever
// because a SW survives until a successful update replaces it. This worker
// IS that update: it installs, immediately activates, deletes every cache,
// unregisters itself, and reloads open tabs so they fetch the live app.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {}
      try {
        await self.registration.unregister();
      } catch (e) {}
      try {
        const clients = await self.clients.matchAll({ type: "window" });
        clients.forEach((client) => client.navigate(client.url));
      } catch (e) {}
    })(),
  );
});
