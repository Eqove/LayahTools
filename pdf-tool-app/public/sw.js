/* LayahTools offline support. Only app files are cached; PDFs are processed in memory and never pass through here. */
const CACHE = "layah-v1";
const SHELL = ["/", "/pdfium.wasm", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];
// Third-party code the app loads at runtime (PDF.js worker, Tesseract worker/core/language data). Cached on first use.
const CDN = ["unpkg.com", "cdn.jsdelivr.net", "tessdata.projectnaptha.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = (req, res) => {
  if (res && (res.ok || res.type === "opaque")) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pages: network first so updates show up, cached copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => put("/", r)).catch(() => caches.match("/")));
    return;
  }
  // Versioned build files and CDN libraries never change at the same URL: cache first.
  const immutable = (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) || CDN.includes(url.hostname);
  if (immutable) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => put(req, r))));
    return;
  }
  // Other same-origin files: serve the cached copy at once and refresh it in the background.
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => put(req, r)).catch(() => hit);
      return hit || net;
    }));
  }
});
