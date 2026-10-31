/**
 * Service worker рабочего кабинета (/mini).
 *
 * Написан руками, а не через Workbox: Workbox хочет владеть сборкой, а
 * здесь `next build --webpack` со своим distDir. Две с половиной сотни строк
 * читаются целиком и не приносят в проект генератор.
 *
 * ГЛАВНОЕ ПРАВИЛО, и оно про безопасность, а не про скорость:
 * авторизованный HTML не кешируется НИКОГДА. На кухне одна трубка на
 * три смены. Если отдать повару второй смены страницу, отрисованную для
 * повара первой, журнал подпишется чужим именем — а журнал это
 * доказательство на проверке.
 *
 * Поэтому кешируется ровно одно: статика с хешем в имени, которая по
 * определению не зависит от того, кто вошёл. Навигации, RSC-запросы,
 * `/api/*` и всё, что не GET, идут мимо воркера.
 *
 * Обновление НЕ применяется само: новый воркер ждёт, страница показывает
 * «Доступно обновление». Внезапная перезагрузка посреди заполнения
 * журнала стоила бы человеку набранных данных.
 */

const CACHE = "wesetup-mini-static-v1";

/** Наши ли это кеши — чтобы чистить только своё. */
function isOurCache(name) {
  return name.startsWith("wesetup-mini-");
}

self.addEventListener("install", (event) => {
  // Без skipWaiting: новый воркер ждёт, пока страница сама попросит.
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => isOurCache(k) && k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // Единственная команда: «применяй обновление». Её шлёт тост со
  // страницы после явного нажатия человеком.
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* ------------------------------------------------------------------
 * Push-уведомления
 * ---------------------------------------------------------------- */

self.addEventListener("push", (event) => {
  // Тело всегда шлём мы сами (`src/lib/web-push.ts`), но пуш-сервис
  // может доставить и пустое событие — тогда показываем нейтральный
  // текст: по спецификации на полученный push ОБЯЗАНО появиться
  // уведомление, иначе браузер отзовёт разрешение.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "WeSetup";
  const options = {
    body: data.body || "Есть что заполнить",
    // Те же файлы, что NOTIFICATION_ICON / NOTIFICATION_BADGE в
    // src/lib/pwa-assets.ts (сверяет тест). Значок в строке состояния
    // Android — белый силуэт: система берёт у него только прозрачность.
    icon: "/icons/app-192.png",
    badge: "/icons/push-badge.png",
    // Один тег — одно уведомление в шторке: десять напоминаний об одном
    // журнале не должны выглядеть как десять разных дел.
    tag: data.tag || "wesetup",
    data: { url: typeof data.url === "string" ? data.url : "/mini" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || "/mini";
  // Только внутрь кабинета: адрес приходит с сервера, но проверить
  // дешевле, чем однажды открыть по нему чужой сайт.
  const url = target.startsWith("/mini") ? target : "/mini";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Уже открытую вкладку переиспользуем, а не плодим новые: на
      // телефоне десяток вкладок кабинета — это каша.
      for (const client of clients) {
        if (client.url.includes("/mini")) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

/**
 * Кешируем только то, чьё имя содержит хеш содержимого, — такой файл
 * не может «протухнуть», а значит cache-first безопасен.
 *
 * `/icons/` и `/brand/` хеша не имеют, но это логотипы: меняются раз в
 * годы, и показать вчерашний не страшно. Им дан свой заголовок
 * кеширования в next.config.ts, воркер их только подстраховывает.
 */
function isCacheableStatic(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/brand/")
  );
}

// Экран «Нет связи» — в том же виде, что у приложений из магазинов
// (mobile/www/offline.html): тёмно-синий фон, свечение, значок, одна кнопка.
// Сам повторяет, когда сеть вернулась: событие online приходит только после
// полного отсутствия сети, поэтому ещё и раз в 10 секунд, пока экран на
// виду, тихо проверяем сайт лёгким запросом.
const OFFLINE_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0b1024">
<title>Нет связи — WeSetup</title>
<style>
  html, body { margin:0; height:100% }
  body { background:#0b1024; color:#fff; display:flex; align-items:center;
         justify-content:center; box-sizing:border-box;
         padding:env(safe-area-inset-top) 24px env(safe-area-inset-bottom);
         font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
         -webkit-tap-highlight-color:transparent }
  .glow { position:fixed; left:50%; top:38%; width:420px; height:420px;
          margin:-210px 0 0 -210px; border-radius:50%; pointer-events:none;
          background:radial-gradient(circle, rgba(85,102,246,.35), rgba(85,102,246,0) 70%) }
  main { position:relative; max-width:360px; width:100%; text-align:center }
  .icon { width:72px; height:72px; margin:0 auto 24px; border-radius:24px;
          background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
          display:flex; align-items:center; justify-content:center }
  h1 { margin:0 0 10px; font-size:22px; line-height:1.25; font-weight:700 }
  p { margin:0 0 28px; color:rgba(255,255,255,.72) }
  button { appearance:none; border:0; cursor:pointer; width:100%; min-height:52px;
           border-radius:16px; background:#5566f6; color:#fff; font:inherit;
           font-size:17px; font-weight:600; box-shadow:0 10px 30px -10px rgba(85,102,246,.7) }
  button:active { transform:scale(.98) }
  button[disabled] { opacity:.7 }
</style></head>
<body>
<div class="glow" aria-hidden="true"></div>
<main>
  <div class="icon" aria-hidden="true">
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/>
      <path d="M19 12.86a10 10 0 0 0-2-1.43"/><path d="M2 8.82a15 15 0 0 1 4.18-2.65"/>
      <path d="M22 8.82a15 15 0 0 0-11.29-3.76"/><path d="m2 2 20 20"/>
    </svg>
  </div>
  <h1>Нет связи с интернетом</h1>
  <p>Кабинет откроется сам, когда появится сеть. Набранное в открытых вкладках не потеряется.</p>
  <button id="retry" type="button">Повторить</button>
</main>
<script>
  var button = document.getElementById("retry");
  function retry() {
    button.disabled = true;
    button.textContent = "Открываем…";
    location.reload();
  }
  button.addEventListener("click", retry);
  window.addEventListener("online", retry);
  setInterval(function () {
    if (document.visibilityState !== "visible" || button.disabled) return;
    fetch("/manifest.json", { cache: "no-store" }).then(function (r) { if (r.ok) retry(); }, function () {});
  }, 10000);
</script>
</body></html>`;

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Не-GET не трогаем вообще: отправка записи в журнал должна дойти до
  // сервера или честно упасть. Молча проглоченный POST — это потерянная
  // запись, которую человек считает сохранённой.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (isCacheableStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        // Кладём только удачные ответы: закешированная 404 держалась бы
        // до следующей версии воркера.
        if (response.ok && response.status === 200) {
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      })(),
    );
    return;
  }

  // Навигации — всегда из сети. Кеш здесь означал бы чужую смену на
  // экране. Оффлайн отдаём заглушку, чтобы вместо неё не появился
  // системный «динозавр» — из установленного приложения он выглядит как
  // «приложение сломалось».
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 503,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          }),
      ),
    );
    return;
  }

  // Всё остальное — RSC-запросы, `/api/*`, картинки вложений — воркер
  // не перехватывает: пусть работает как без него.
});
