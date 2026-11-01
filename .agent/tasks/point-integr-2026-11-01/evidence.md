# Evidence — point-integr (2026-11-01)

Ветка `fix/point-integr` от origin/master 1a92d768.

| AC | Где | Проверка |
|---|---|---|
| AC1 | `src/app/api/cron/tuya-pull/route.ts`, `src/lib/sensor-point.ts` | `sensor-point.test.ts`: документ чужой точки не выбирается; без строки — свой, затем общий; оборудование без точки — документы, где оно в строках; подписант — человек точки |
| AC2 | `src/app/api/external/sensors/route.ts` | те же функции (`pickSensorDocuments`, `pickPointSigner`); влажность → документы не ищутся |
| AC3 | `src/app/api/tuya/collect/route.ts` | `pickPointSigner(managers, equip.area.buildingId)` |
| AC4 | `src/app/api/tuya/device/route.ts` | 404, если точка оборудования не в `loadBuildingContext(session).buildings` |
| AC5 | `src/lib/external/dispatch.ts`, `src/lib/external/entry-point.ts`, `src/app/api/external/entries/route.ts` | `entry-point.test.ts`: явная точка, одна точка сотрудника, сотрудники разных точек → ошибка, неоднозначно → кандидаты |
| AC6 | `src/lib/mercury/process-incoming.ts`, `mercury/documents/[id]/process`, `mercury/page.tsx`, `api/mercury/documents`, `cron/mercury-poll`, `lib/mercury/sync.ts` | код: `ensureActiveDocument({buildingId})`, 403 на ВСД чужой точки, `getViewedPointId`, `countPendingVetDocumentsByPoint` + `notifyManagement({buildingId})`; Меркурий-тесты зелёные |
| AC7 | `src/app/api/integrations/tasksflow/bulk-assign-today/route.ts` | код: `runTargets` = точка из шапки для сессии; фильтры людей — по всем точкам (`bulkTargets`); `force` — связи документов точки; тесты bulk-assign зелёные |
| AC8 | `src/lib/losses-1c-export.ts` | `losses-1c-export.test.ts`: без точек — прежние колонки, с точками — «Точка» последней |
| AC9 | `src/lib/webhooks/dispatch.ts`, `src/lib/webhooks/point.ts`, `temperature-deviations.ts`, `journal-change-events.ts` | payload-функция считается только при наличии подписок; тесты отклонений и журнала изменений зелёные |

## Команды

- `node --import tsx --test` — sensor-point, external/entry-point, losses-1c-export, journal-change-events, temperature-deviations, tasksflow-bulk-assign(+toast), mercury/* (5 файлов), notification-descriptor-producers, webhooks/* (2), navigation-localization: **108 + 3 pass, 0 fail**.
- `npm run typecheck` (через очередь tsc-locked): **exit 0, 0 ошибок**.
- `verify-worktree.cjs D:/wt/pt-integr`: corrupted 0.

Живые HTTP-проверки не запускались (общая e2e-БД и dev-серверы параллельных групп); логика выбора вынесена в чистые функции с тестами.
