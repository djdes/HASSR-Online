# Evidence — журналы точки по точке

Карта мест: отчёт исследования (QR здоровья, строки по умолчанию, ручное
создание, страница документа, TasksFlow) — сведён в spec.md.

| AC | Правка | Проверка |
|---|---|---|
| AC1 | `health-qr-flow.ts` `loadDay`: `admissionRoster(сотрудники точки, все, уже отметившиеся)`; `HealthCtx.pointScope`; маршрут `journal-fill/[orgId]/[code]`: `pointScope` = точка документа, у общего документа — точка из QR (`check.buildingId`); запрет входа сотрудника из кабинета — по точке самого документа, как раньше | `document-point-rows.test.ts` «Допуск сотрудников…»; браузер — см. ниже |
| AC2 | `resolvePair` → `pickCompanionDocument`: своей точки → общий → никогда чужой | тест «парный журнал здоровья…» |
| AC3 | `fetchOrgDataForDefaults(org, buildingId)` — помещения, цеха, оборудование, сотрудники через `pointRowsWhere`; `prefillResponsiblesForNewDocument` передаёт `input.buildingId` (все вызывающие уже передают точку, кроме предпросмотра автосоздания организации); каскад ответственных — данные по точке каждого документа | тесты `pointRowsWhere`, `rowsPointFromTargets` |
| AC4 | `POST /api/journal-documents`: точка определяется до выборок; холодильники, стекло (цеха и оборудование), цеха и сотрудники уборки, поверка, ППР — `AND: [pointRows.*]`; «как прошлый» документ уборки — `buildingWhere(точка)` | typecheck |
| AC5 | `ensureUvDocumentForLamp`: `buildingId` = точка цеха лампы (`documentRowsPointId`) | typecheck |
| AC6 | страница документа: `addableEmployees` (сотрудники точки документа, `worksAtBuilding`) → гигиена и здоровье: панель/кнопка/диалог «добавить» и запасной список гигиены без строк; существующие строки — из полного ростера. Уборка: точки документа + точки уже выбранных помещений | typecheck |
| AC7 | — | см. «Команды» |

## Не трогал (осознанно)

- Климат и санитарный день: справочник помещений (`loadDirectoryBuildings`) подписывает уже созданные строки (`applyRoomDirectoryToClimateConfig`) — сужение спрятало бы строки старых документов.
- Ответственные (`allUsers` в создании, `employees` у клиентов) — полный ростер: ответственным бывает человек офиса.
- TasksFlow (`journal-task-pool.ts`, `tasksflow-adapters/*`), крон «не отметились», `listEmployeeDailyStatus` — отдельно.

## Команды

- `node --import tsx --test src/lib/document-point-rows.test.ts` — 5/5.
- `npm run typecheck` — 0 ошибок; eslint по 11 изменённым файлам — 0 ошибок (5 старых предупреждений о неиспользуемых импортах в page.tsx и route.ts).
