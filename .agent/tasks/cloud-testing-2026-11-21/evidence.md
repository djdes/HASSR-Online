# Evidence: тесты и мониторинг в облаке, без своего сервера

- **Task ID:** `cloud-testing-2026-11-21`
- **Ветка:** `claude/hopeful-euler-lb6cie` от `origin/master` `230e9e70` (#297).
- **Verdict:** AC1–AC4 — PASS; AC6 — PASS после зелёного CI на PR; **AC5 (Sentry) — открыт**: аккаунт
  зарегистрирован, ждём ссылку подтверждения из письма владельца, подключение SDK — отдельным PR.

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `npm run smoke:local` (`scripts/smoke/run-local.sh`): `raw/smoke-local.log` и `raw/smoke-local-repeat.log` — два прогона подряд: 20/20 сценариев на базе (1000 проверок) и 48/48 в браузере, ~150 с каждый. Сам поднимает Postgres, базу, схему, сиды и `next dev`. |
| AC2 | PASS | `.mcp.json` → `scripts/dev/playwright-mcp.mjs` (`@playwright/mcp@0.0.84`): `raw/playwright-mcp-handshake.log` — рукопожатие, 25 инструментов, открыта локальная страница, снимок с кнопкой, клик, внешний сайт через прокси сессии. Почему `.mcp.json`, а не плагин: облачная сессия не ставит плагины из настроек репозитория, а `.mcp.json` подхватывает (docs cloud-environments). |
| AC3 | PASS | `scripts/monitor/prod-check.mjs` + `.github/workflows/prod-monitor.yml` (каждые 15 мин). `src/lib/prod-monitor.test.ts` — 22/22. Живой прогон по wesetup.ru: `raw/prod-check-live.log` — `/login` не ответил за 6 попыток (ECONNRESET), остальные ответили → «помеха», запуск в порядке, тревоги нет. |
| AC4 | PASS | Скрипт подготовки прогнан из `/home/user`: `raw/setup-script.log` — `npm ci` (1372 пакета), `prisma generate`, `@playwright/mcp` 0.0.84, 43 с. Окружение «HASSR-Online» создано (личное, репозиторий djdes/HASSR-Online, сеть: пакеты + GitHub + `binaries.prisma.sh` по умолчанию, плюс `wesetup.ru`). |
| AC5 | OPEN | Sentry: регистрация отправлена 21.11 20:00 UTC (регион EU, организация WeSetup), Sentry прислал ссылку подтверждения на почту владельца (2 часа). Дальше — проект, DSN и `@sentry/nextjs` отдельным PR. |
| AC6 | PASS* | `npm run typecheck` — 0 ошибок; `npm run test:changed` — 22/22; eslint по `src/lib/prod-monitor.test.ts` — 0. *CI — на PR. |

## Что нашли по дороге и исправили

- **`next dev` на кэше прошлого запуска** (Turbopack, постоянный кэш по умолчанию в Next 16.1) отдавал 404 на
  `/login` (`raw/smoke-local-run1-stale-cache.log`), а на тёплом кэше бесконечно компилировал
  `/api/name-suggestions` (`raw/smoke-browser-warm-cache.log`). На CI не проявлялось (там всегда чистая папка).
  Исправлено: `next.config.ts` — `turbopackFileSystemCacheForDev: process.env.NEXT_DEV_FS_CACHE !== "0"`,
  смоук ставит `NEXT_DEV_FS_CACHE=0`; разработка и сборка прода не меняются.
- **`scripts/e2e/cleanup-check.ts` падал при запуске с 22 до 24 МСК**: «тот же день» (+2 ч) перескакивал через
  полночь по Москве. Время тревоги закреплено на полдень МСК — `raw/cleanup-check-fixed.log` (15/15 в 23:18 МСК).
  На PR в вечерние часы этот сценарий падал бы и в CI.
- **Смоук в браузере**: запросы к API (PDF, подпись, подсказки) ждали 30 с, а `next dev` компилирует маршрут при
  первом запросе — теперь 180 с, как у страниц.

## Замечено, не исправлено (вне объёма)

- `pay-from-account-check`: «три параллельных оплаты с одним ключом» один раз из пяти дали
  `["error:transfer_failed","already","paid"]` (при нагрузке от компиляции `next dev`). Двойного списания нет, но
  второй запрос при двойном клике может показать «Перевод не прошёл», хотя первый оплатил
  (`account-pay.server.ts`: после ошибки перевода проверка «оплачено параллельно» не ждёт завершения другого
  запроса). Смоук теперь гоняет сценарии до запуска `next dev`, как CI.
