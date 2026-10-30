# Evidence — point-skeleton-access-2026-10-29

Ветка `feat/point-skeleton-access-2026-10-29`. Проверки — на локальной базе
`wesetup_access` (127.0.0.1:5432), dev-сервер `next dev -p 3034`
(`NEXT_DIST_DIR=.next-access`). Прод (5433) не трогали.

## Что сделано (по критериям)

| AC | Статус | Где |
|----|--------|-----|
| AC1 смена точки → скелет | PASS | `src/components/layout/content-transition.tsx` (провайдер перехода), `location-switcher.tsx`, `organization-switcher.tsx`, `current-point-switcher.tsx`, `point-mode-unavailable.tsx`, `src/app/mini/_components/mini-location-switcher.tsx`, `section-frame.tsx` |
| AC2 чипы мест | PASS | `src/components/layout/place-filter-scope.tsx`, `place-filter-chips.tsx`; страницы `settings/areas`, `settings/equipment`, `journals/points`, `settings/users` (+ `staff-page-client.tsx`) |
| AC3 скелет у каждого раздела | PASS | `src/app/(dashboard)/loading.tsx`, `src/components/layout/route-skeleton.tsx`, `routeSkeletonFor` в `skeleton-routes.ts` |
| AC4 «Нет доступа» в макете | PASS* | `next.config.ts` (`experimental.authInterrupts`), `src/app/(dashboard)/forbidden.tsx`, `src/components/layout/access-denied.tsx` |
| AC5 guard'ы → `forbidden()` | PASS | 123 страницы (кодмод + 7 вручную), тесты текста guard'ов обновлены |
| AC6 «Такой страницы нет» в макете | PASS | `src/app/(dashboard)/not-found.tsx`, 24 ловушки `<раздел>/[...missing]/page.tsx` |
| AC7 пункт меню закрыт → панель | PASS | `deniedNavHrefs` / `routedAwayNavHrefs` / `isNavHrefDenied` (`src/lib/app-nav.ts`), `NavModel.deniedHrefs` / `routedAwayHrefs` |
| AC8 редирект proxy с объяснением | PASS | `src/lib/denied-notice.ts`, `src/proxy.ts`, `denied-notice.tsx`, `mini-denied-notice.tsx`, `mini/page.tsx`, `journals/page.tsx`, `dashboard/page.tsx` |
| AC9 тексты ru/en/uz | PASS | `navigation.shell.access.*`, `contentLoading`, `listLoading` |
| AC10 проверки | PASS | см. ниже |

\* статус ответа: см. «Ограничения».

## Guard'ы (AC5)

Заменено на `forbidden()` — 123 вызова в 123 страницах `(dashboard)`:
- 113 «нет прав → `redirect("/journals" | "/settings" | "/dashboard")`»
  (однострочные и блочные; кодмод по условию `!hasFullWorkspaceAccess(` /
  `!hasCapability(` / `!fullAccess` / `!isManagementRole(` / `!hasAccess`);
- 3 «нет прав → соседняя страница» (`inspection/experts` → `/inspection`,
  `checklists/assignments` → `/checklists/templates`,
  `settings/journals/[code]/scope` → `/settings/journals`);
- 7 `notFound()` как отказ: `checklists` ×4 (ACL журнала чек-листов),
  `journals/[code]` (журнал не выдан), `settings/users/[id]/access`
  (не руководство), `translations` (нет права на переводы).

Оставлены редиректами (маршрут, а не отказ) — 36:
- вход без сессии `redirect("/login")` — 9;
- домашняя по роли / поток сотрудника: `dashboard` ×3, `journals` ×2, `home`,
  `control-board`, `team`, `journals-progress` (→ `/mini/today`), хаб
  `settings` ×3 — 12 (метка `?denied=` несётся дальше в `dashboard`/`journals`);
- перенесённые адреса/алиасы: `staff`, `settings/sections/points|staff`,
  `settings/equipment/qr-sheet`, проверка документа → документ, офис-точка →
  офис, нет шаблона → список (×2) — 8;
- продуктовые развилки: автосоздание выкл. → спецрежим, мастер-кабинет →
  `/master`, MAX → `/max/connect`, партнёр → `/partner`, партнёр в
  «Консультанте» → `/partner/denied` (уже с объяснением), партнёр-просмотр в
  «Новой точке» → список — 6;
- вход в оболочке Mini App (layout) — 1.

`notFound()` для реально отсутствующих сущностей (документ, партия, CAPA,
шаблон, встреча, точка не своя/нет) — оставлены, теперь рисуются внутри макета.

## Команды и результаты

- `npm run typecheck` — exit 0 (см. ниже, повторный прогон после последних правок).
- `npx eslint <185 изменённых файлов>` — 0 новых; 2 ошибки
  `no-html-link-for-pages` и 1 предупреждение `react-hooks/purity` в
  `more/page.tsx`, `settings/schedule/page.tsx`, `settings/equipment/page.tsx`
  есть и в `origin/master` (проверено линтом версий из master), строки не трогали.
- Тесты рядом с изменениями (`node --import tsx --test`: app-nav,
  denied-notice, proxy, skeleton-routes, inspection-pages, organization-pages,
  print-agent-settings, journal-title-controls, mini-home-localization,
  route-slug-collisions, loading-surface, nav-section-path, platform-access) —
  все зелёные; pre-commit «тесты рядом с изменениями» — 106/106.
- `npm run i18n:types` + `npm run i18n:check` — 97/97 pass (до и после слияния).
- `npm run test:gate` (после слияния origin/master #54–#59) — pass=5144,
  fail=3: 1 из baseline и 2 «новых», оба проходят поодиночке и не связаны с
  правкой: `prewarm-routes.sh` (`deploy-scripts.test.ts`, ~70 вызовов curl
  против заглушки при лимите 30 с; поодиночке 27 с, 16/16) и
  `checklist-assignments.server.test.ts` (поодиночке 2/2). PDF, которые гейт
  переписал в `.agent/tasks/english-version-*/raw`, откачены.
- Playwright `raw/e2e.mjs` на дереве после слияния — 32/32 PASS
  (`raw/e2e-results.json`). Перед прогоном: `prisma generate` + `prisma db push`
  в локальную `wesetup_access` (в master появился `User.platformSections`).
- `raw/status-probe.mjs`, `raw/first-nav.mjs` — статусы панелей и гонка сразу
  после входа (см. «Ограничения»).

## Ограничения

- HTTP-статус `forbidden()`/`notFound()` в HTML — 200, не 403/404: у всех
  страниц кабинета теперь есть граница загрузки `(dashboard)/loading.tsx`,
  оболочка (меню + скелет) уходит раньше, чем страница бросит отказ, и статус
  уже отправлен. Так было и раньше у разделов со своим `loading.tsx`
  (журналы, настройки). Панель и `noindex` на месте.
- Во время разработки dev-сервер после десятков горячих перекомпиляций отдал
  два 500 («No intl context found» в `DomainMessagesProvider`) на первой
  навигации после входа — в том числе на разрешённой `/settings/users`. После
  перезапуска того же кода — 200 на всех повторах (`raw/first-nav.mjs`,
  дважды); с выключенным и включённым `loading.tsx` — одинаково 200.
  Вывод: артефакт деградировавшего dev-сервера, не изменения.
- Сборку `next build` не запускали (deploy делает её сам).
