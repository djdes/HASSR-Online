# Evidence — point-objects-2026-11-01

Ветка `fix/point-objects` от `origin/master` 1a92d768.

## Проверки

| Проверка | Результат |
|---|---|
| `node --import tsx --test src/lib/point-objects.test.ts` | 6/6 pass (правила: правка объекта, область окна, выбор, люди) |
| `node --import tsx --test src/lib/point-objects-routes.test.ts` | 3/3 pass (проверки точки стоят во всех 13 маршрутах; списки и «Добавить помещение» — по точке) |
| Тесты затронутых модулей: area-building, place-filter, point-scope, kiosk-device, room-kinds, qr-fill.smoke, equipment-fill-api-localization, route-param, settings-cards, print-agent label-printers, room-directory, document-point-scope, orphan-areas | 89/89 pass (вместе с двумя новыми) |
| app-nav, page-navigation-proxy, organization-pages | 71/71 pass |
| `npm run typecheck` (через очередь tsc-locked) | exit 0, 0 ошибок |
| `verify-worktree.cjs D:/wt/pt-objects` | corrupted 0 |

Живой прогон на e2e-базе не делался (без dev-серверов по правилам группы):
правила покрыты чистыми функциями, а их применение в маршрутах держит
текстовый тест.

## AC

- AC1 оборудование — `api/equipment/route.ts` (POST через `resolveEquipmentArea(…, objectPointError)`), `api/equipment/[id]/route.ts` (PUT/DELETE `objectPointResponse` по точке цеха + перенос). PASS (код + тест маршрутов).
- AC2 цеха — `api/areas/route.ts`, `api/areas/[id]/route.ts`. PASS.
- AC3 помещения — `api/settings/rooms/route.ts`, `rooms/[id]/route.ts`. PASS.
- AC4 люди точки и copy-rooms — `buildings/[id]/staff` (`buildingInScope`, `staffInScope`, `mergeScopedBuildingIds`), `copy-rooms` (цель и источник). PASS.
- AC5 списки — `visibleObjectBuildingIds` в GET `/api/areas` и `/api/equipment`. PASS.
- AC6 окна страниц — `settings/equipment/page.tsx`, `settings/areas/page.tsx` (+ `allowNoPoint` в `AreaDialog`), `settings/buildings/[id]/page.tsx`. PASS (typecheck; визуально не проверено).
- AC7 график — `objectVisibleToSession` в `api/charts/temperature`. PASS.
- AC8 «Добавить помещение» — `loadOrphanAreas(org, pointId)`, `?buildingId=` в окне. PASS.
- AC9 планшет — enroll, pins-bulk, `settings/kiosk` page + PATCH, `kiosk/unlock`, passkey. PASS.
- AC10 «Сетап помощник» — revoke + список на `settings/print-agent`. PASS.
- AC11 — см. таблицу. PASS.
