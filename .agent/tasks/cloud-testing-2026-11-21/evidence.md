# Evidence: тесты и мониторинг в облаке, без своего сервера

- **Task ID:** `cloud-testing-2026-11-21`
- **Ветка:** `claude/hopeful-euler-lb6cie` от `origin/master` `230e9e70` (#297).
- **Verdict:** AC1–AC6 — PASS (AC5: сервер проверен событием в проекте; браузер на проде — после выкладки,
  см. «Проверка на проде»).

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `npm run smoke:local` (`scripts/smoke/run-local.sh`): `raw/smoke-local.log` и `raw/smoke-local-repeat.log` — два прогона подряд: 20/20 сценариев на базе (1000 проверок) и 48/48 в браузере, ~150 с каждый. Сам поднимает Postgres, базу, схему, сиды и `next dev`. |
| AC2 | PASS | `.mcp.json` → `scripts/dev/playwright-mcp.mjs` (`@playwright/mcp@0.0.84`): `raw/playwright-mcp-handshake.log` — рукопожатие, 25 инструментов, открыта локальная страница, снимок с кнопкой, клик, внешний сайт через прокси сессии. Почему `.mcp.json`, а не плагин: облачная сессия не ставит плагины из настроек репозитория, а `.mcp.json` подхватывает (docs cloud-environments). |
| AC3 | PASS | `scripts/monitor/prod-check.mjs` + `.github/workflows/prod-monitor.yml` (каждые 15 мин). `src/lib/prod-monitor.test.ts` — 22/22. Живой прогон по wesetup.ru: `raw/prod-check-live.log` — `/login` не ответил за 6 попыток (ECONNRESET), остальные ответили → «помеха», запуск в порядке, тревоги нет. |
| AC4 | PASS | Скрипт подготовки прогнан из `/home/user`: `raw/setup-script.log` — `npm ci` (1372 пакета), `prisma generate`, `@playwright/mcp` 0.0.84, 43 с. Окружение «HASSR-Online» создано (личное, репозиторий djdes/HASSR-Online, сеть: пакеты + GitHub + `binaries.prisma.sh` по умолчанию, плюс `wesetup.ru`). |
| AC5 | PASS | Аккаунт подтверждён ссылкой владельца: организация `wesetup`, проект `javascript-nextjs` (EU); в проекте не хранить IP, чистка данных, приём только с wesetup.ru. Сервер: `@sentry/nextjs` 11.11.0 без `withSentryConfig` (сборка не трогается) — `src/lib/sentry-server.ts` + `onRequestError` в `src/instrumentation.ts`. Браузер: минимальный клиент `@sentry/browser`, загружается после открытия страницы (`src/lib/sentry-lazy.ts`, `src/instrumentation-client.ts`), туннель `src/app/api/monitoring/route.ts` (только наш DSN), `useReportError` в error.tsx. В v11 `sendDefaultPii` заменён на `dataCollection`, по умолчанию собирающий всё, — выключено явно (`SENTRY_DATA_COLLECTION`). Тесты: `sentry-config.test.ts` 9/9, `sentry-lazy.test.ts` 2/2. Вес первого экрана: +1,4 КБ gzip (`raw/sentry-bundle-weight.txt`; `Sentry.init` из @sentry/nextjs дал бы +88 КБ). Сквозные проверки: событие сервера и событие браузера через туннель пришли в проект без пользователя, IP, кук и параметров адреса (`raw/sentry-e2e.txt`). Продакшен-сборка `next build --webpack` — ок. Запись сессий не включена (вес и персональные данные) — описано в docs. Подключено в том же PR #299 (спека планировала отдельный): перезапуск CI через API недоступен (403). |
| AC6 | PASS* | `npm run typecheck` — 0 ошибок; `npm run test:changed` — 22/22; eslint по `src/lib/prod-monitor.test.ts` — 0. *CI — на PR. |

## Что нашли по дороге и исправили

- **`next dev` на кэше прошлого запуска** (Turbopack, постоянный кэш по умолчанию в Next 16.1) отдавал 404 на
  `/login` (`raw/smoke-local-run1-stale-cache.log`), а на тёплом кэше бесконечно компилировал
  `/api/name-suggestions` (`raw/smoke-browser-warm-cache.log`). На CI не проявлялось (там всегда чистая папка).
  Исправлено: `next.config.ts` — `turbopackFileSystemCacheForDev: process.env.NEXT_DEV_FS_CACHE !== "0"`,
  смоук ставит `NEXT_DEV_FS_CACHE=0`; разработка и сборка прода не меняются.
- **`scripts/e2e/cleanup-check.ts` падал при запуске с 22 до 24 МСК**: «тот же день» (+2 ч) перескакивал через
  полночь по Москве. Тот же сбой параллельно поймала и исправила сессия PR #298 (влит в master раньше) — при
  слиянии с master взят её вариант (`moscowNoon`), своя правка снята. Проверка моего варианта —
  `raw/cleanup-check-fixed.log` (15/15 в 23:18 МСК).
- **Смоук в браузере**: запросы к API (PDF, подпись, подсказки) ждали 30 с, а `next dev` компилирует маршрут при
  первом запросе — теперь 180 с, как у страниц.

## Замечено, не исправлено (вне объёма)

- `pay-from-account-check`: «три параллельных оплаты с одним ключом» один раз из пяти дали
  `["error:transfer_failed","already","paid"]` (при нагрузке от компиляции `next dev`). Двойного списания нет, но
  второй запрос при двойном клике может показать «Перевод не прошёл», хотя первый оплатил
  (`account-pay.server.ts`: после ошибки перевода проверка «оплачено параллельно» не ждёт завершения другого
  запроса). Смоук теперь гоняет сценарии до запуска `next dev`, как CI.
