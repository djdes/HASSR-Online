# Поиск «где ещё может быть localhost» (09.11.2026)

## Причина

Next 16 собирает `request.url` обработчика маршрута (`route.ts`) из адреса, который слушает сам сервер, и
`x-forwarded-proto`; заголовок Host не используется
(`node_modules/next/dist/server/lib/router-utils/resolve-routes.js`:
`` `${protocol}://${formatHostname(opts.hostname || 'localhost')}:${opts.port}${req.url}` ``).
За nginx на проде это `https://localhost:3002/...`. Любой абсолютный адрес, собранный из `request.url`
(или `nextUrl`) в обработчике, уводит человека на localhost.

Middleware (`src/proxy.ts`) этой проблемы не имеет: Next сам делает его редиректы относительными, если хост
совпадает с хостом запроса (`next/dist/server/web/adapter.js` → `getRelativeURL`).

## Проверено на проде (curl, только GET без сессии)

| Запрос | Ответ | Вывод |
|---|---|---|
| `GET https://wesetup.ru/api/me/platform-panel` | `307 location: https://localhost:3002/login` | **ошибка** (с сессией — `https://localhost:3002/root/crm`, скриншот владельца) |
| `GET https://wesetup.ru/api/me/active-building/go` | `307 location: /` | `relativeRedirect` — верно |
| `GET https://wesetup.ru/journals/` | `308 location: /journals` | редирект `proxy.ts` из `new URL(req.url)` — Next сделал относительным |
| `GET https://wesetup.ru/status` | «Все системы работают», сборка `9bd55f45` | самозапрос страницы статуса по `x-forwarded-host ?? host` работает: nginx передаёт Host |

## Что искали и что нашли

| Шаблон | Где | Вывод |
|---|---|---|
| `NextResponse.redirect(new URL(…, request.url))` в обработчиках | `src/app/api/me/platform-panel/route.ts:18,25,27` | **ошибка — исправлено** (`relativeRedirect`) |
| любой `NextResponse.redirect` / `Response.redirect` в `src/app`, `src/lib` | `src/app/api/kiosk/claim/[token]/route.ts:38,47` | адрес от `NEXTAUTH_URL` (`resolveQrPosterOrigin`) — верно; в исключениях теста-сторожа |
| редиректы `proxy.ts` (`new URL(x, req.url)`) | `src/proxy.ts` 146, 195, 221, 227, 238, 265, 282, 292, 335 | Next делает относительными (см. выше, проверено на проде) |
| проверка Origin против `new URL(request.url).origin` | `src/app/api/profile/locale/route.ts:13`, `src/app/api/root/articles/[id]/translations/[locale]/route.ts:32`, `src/lib/max/http.ts:18` | вторым допустимым источником стоит `NEXTAUTH_URL` / `MAX_SITE_URL` — на проде верно |
| ссылки для TasksFlow из `new URL(request.url).origin` | `src/app/api/integrations/tasksflow/route.ts:339`, `task-fill-token/route.ts:71`, `bulk-assign-today/route.ts:590`, `bind-row/route.ts:258` | берут `NEXTAUTH_URL`, origin запроса — только если в нём localhost (разработка) — верно |
| внутренний запрос по адресу из запроса | `src/app/api/join/[token]/route.ts:408` | явно `NEXTAUTH_URL` — верно |
| `headers().get("host")` | `src/app/status/page.tsx:73`, `src/proxy.ts:170` | `x-forwarded-host ?? host` — на проде Host верный (страница статуса работает) |
| `redirect()` / `permanentRedirect()` с абсолютным адресом, `fetch` с базой из запроса, `nextUrl.origin` в обработчиках | — | не найдено |
| запасной `NEXTAUTH_URL \|\| "http://localhost:3000"` | `src/lib/seo/gogetlinks-article-ai.server.ts:377`, `src/lib/ai-vision/run.ts:100` | только без `NEXTAUTH_URL` (разработка); на проде переменная задана (письма о доступе ведут на wesetup.ru) |
| относительные редиректы | `journal-fill`, `r/[code]`, `r/[code]/[n]`, `p/[slug]/start`, `promo/[code]`, `qj/…`, `payment`, `api/auth/magic`, `api/mailing/unsubscribe`, `api/me/active-building/go`, `lib/blank-download-token.ts`, `lib/brakerage-qr-flow.ts` | `relativeRedirect` / `safeInternalPath` — верно |

## Чтобы не повторилось

`src/lib/relative-redirect.test.ts` — тест-сторож: в `src/app` и `src/lib` нет `NextResponse.redirect` /
`Response.redirect` (они всегда дают абсолютный `Location`), кроме явно разрешённых с адресом от
`NEXTAUTH_URL`. На коде до исправления падает ровно на `src/app/api/me/platform-panel/route.ts`.
