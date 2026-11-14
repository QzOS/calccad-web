/* calccad's service worker: makes the page cross-origin isolated where
   the server cannot (a static host such as GitHub Pages), by adding the
   two headers to every same-origin response, so the threaded build can
   share its memory with its workers (SharedArrayBuffer). Nothing is
   cached: each request goes to the network as it would. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin')
    return;
  if (new URL(r.url).origin !== self.location.origin)
    return;
  e.respondWith(fetch(r).then(function (res) {
    var h;
    if (res.status === 0)
      return res;
    h = new Headers(res.headers);
    h.set('Cross-Origin-Embedder-Policy', 'require-corp');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    return new Response(res.body, {status: res.status, statusText: res.statusText, headers: h});
  }));
});
