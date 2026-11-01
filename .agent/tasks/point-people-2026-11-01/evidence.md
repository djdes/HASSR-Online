# Evidence — point-people (2026-11-01)

Ветка `fix/point-people` от `origin/master` 1a92d768. Проверено на текущем коде.

| AC | Изменение | Проверка |
|---|---|---|
| AC1 | `src/lib/point-scope.ts`: новые адреса в `COMPANY_ONLY_API_PREFIXES`, точные `COMPANY_ONLY_API_EXACT` (`/api/integrations/tasksflow`) и вложенные `COMPANY_ONLY_API_CHILDREN` (`/api/positions/*`); страница `/settings/inspector-portal` — в `COMPANY_ONLY_PAGE_PREFIXES`. На «Сотрудниках» карандаш должности скрыт руководителю точки (`canEditPositions`). | `point-scope.test.ts` — 24 новых проверки (deny/allow), PASS |
| AC2 | `api/settings/export-journals`, `api/audit`, `api/settings/audit/export`: `isPointScoped` → 403 | чтение кода; typecheck |
| AC3 | `staff/schedules/dismissals` (+`[id]`), `periods` (+`[id]`): `staffOutOfScopeResponse`; `work-off/bulk`: `staffInScope` по всем; `organizations/schedule`: `staffScopeWhere` в GET/PUT/DELETE | чтение кода; typecheck |
| AC4 | `staff/import` (пропуск людей других точек), `bonuses/page`, `bonus-entries/export`, `bonus-entries/[id]/reject`, `competencies` (API GET — руководству + точка, POST — `staffOutOfScopeResponse`; страница), `staff/export`, `users/[id]/access` GET + страница | `competency-localization.test.ts`, `users/[id]/access/notify.test.ts` PASS; typecheck |
| AC5 | `qr-pin-requests.ts`: список с `staffScopeWhere(viewer)`, решение с `actor` (403 вне точек), получатели через `placeOfEvent` + `filterRecipientsByPlace`; `staff/pin-requests/[id]` передаёт `actor` | новый `qr-pin-requests-scope.test.ts` (3 теста) PASS; `notification-descriptor-producers.test.ts` (мок place-recipients) PASS |
| AC6 | `api/join/[token]`: точки создателя ссылки (`computePointScope`, только своя организация, не ROOT) | чтение кода; typecheck |
| AC7 | `api/search`: `loadBuildingContext` → выбранная точка / точки человека; люди `staffScopeWhere` + `staffAtBuildingWhere`, документы и оборудование — точки + общие; выключенные журналы — по точке | чтение кода; typecheck |
| AC8 | `dashboard/med-books-expiry`, `staff-training-overdue`, `live-claims`: новый `visibleStaffWhere` (`src/lib/people-scope.server.ts`) | typecheck |
| AC9 | `ppk/acknowledge.server.ts`: `staffWhere` в `rosterUsers`/`ackStats*`/`ackSummaryFor` (рядом с `ORG_ROSTER_WHERE.AND`, не поверх); вызовы на страницах политики и группы, в `acknowledgements` и `remind` | `ppk/acknowledge.test.ts`, `ppk/registry.test.ts` PASS |
| AC10 | `inspection/page.tsx`: QR не показывается и не выдаётся при `isPointScoped` | `inspection-pages.test.ts` PASS |
| AC11 | — | `npm run typecheck` (tsc-locked): exit=0, errors=0. Тесты: point-scope, qr-pin-requests-scope, notification-descriptor-producers, bell-push-once, qr-pin-requests-core, access/notify, checklist-access-api, equipment-fill-api-localization, journals-archive-api, app-nav, competency-localization, inspection-pages, no-settings-hub-links, credentials-phone, native-bridge, notifications-push, ppk/compliance, ppk/acknowledge, ppk/registry, staff-api-error — все PASS |

Живой прогон на e2e-БД не делался (параллельные ветки, без dev-сервера) — проверки по коду и unit-тестам.
