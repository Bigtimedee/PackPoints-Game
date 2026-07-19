import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Evict any service worker left by the pre-Railway deployment of this domain
// (this app registers none, so ANY registration is foreign). Without this, a
// legacy worker keeps serving the old app shell indefinitely. One guarded
// reload so the tab re-fetches from the network once the worker is gone.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then(async (regs) => {
      if (regs.length === 0) return;
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
      if (window.caches) {
        const keys = await caches.keys().catch(() => [] as string[]);
        await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
      }
      if (!sessionStorage.getItem("legacy-sw-purged")) {
        sessionStorage.setItem("legacy-sw-purged", "1");
        window.location.reload();
      }
    })
    .catch(() => {});
}

// build: 2026-04-15
createRoot(document.getElementById("root")!).render(<App />);
