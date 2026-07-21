/* クレカ乗車運賃ナビ - Service Worker
   オフラインでもアプリ本体・運賃データを表示できるようにするためのキャッシュ層。
   fare.json はキャッシュを即返しつつバックグラウンドで最新版に更新（stale-while-revalidate）。
*/
const CACHE_NAME = "creka-fare-navi-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./fare.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(() => { /* 初回オフライン等でaddAllが失敗しても致命的にしない */ })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  /* お知らせ(notices.json)は常にオンライン時の最新内容を取得したいため、
     このキャッシュ層（stale-while-revalidate）の対象から除外する。
     ここでrespondWithしなければブラウザの通常のfetchにフォールバックする。 */
  if (url.pathname.endsWith("/notices.json")) return;

  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(networkRes => {
        if (networkRes && networkRes.ok) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return networkRes;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
