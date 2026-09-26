// Minimal service worker: makes the portal installable and shows an offline page
// instead of the browser error when the network drops. HR data is never cached.
const OFFLINE_HTML = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f6f9">
<div style="text-align:center;padding:24px"><h1 style="font-size:20px">You are offline</h1>
<p style="color:#5b6472">Check your internet connection and try again.</p>
<button onclick="location.reload()" style="padding:10px 18px;border-radius:8px;border:0;background:#1f3a5f;color:#fff;font-weight:600">Retry</button></div>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html" } })),
  );
});
