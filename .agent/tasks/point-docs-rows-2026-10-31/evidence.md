# Доказательства — журналы точки без чужих строк внутри документов (2026-10-31)

| AC | Статус | Где |
|---|---|---|
| AC1 | PASS | `src/lib/point-document-rows-sync.ts`: `general_cleaning` в `POINT_ROWS_CONFIG_CODES`, строки `rows[].roomId` других точек убираются, кроме строк с отмеченной уборкой (`hasRecordedCleaning`); тест «график генуборок…»; e2e: `raw/sync-check.txt`, `raw/browser-check.txt` |
| AC2 | PASS | `trimCleaningStaff` + `isOtherPointStaff` в sync; тест «уборка: люди другой точки…»; окно создания — `journals/[code]/page.tsx` (`createPointUsers`); POST — `pointConfigForDocument` / `pointFallbackResponsibleUserId` в `api/journal-documents/route.ts`; e2e: `raw/sync-check.txt` (уборщики, ответственные, контролёр) и `raw/browser-check.txt` (Бориса нет в данных страницы уборки) |
| AC3 | PASS | `GET /api/equipment?documentId=` фильтрует `equipmentBuildingWhere(точка документа)`; окно `EquipmentDialog` передаёт `documentId`; e2e: `raw/browser-check.txt` — справочник документа точки А = только «ШХ точки А», без параметра — всё, как раньше |
| AC4 | PASS | `scopeDirectoryBuildings` + `configRoomIds` (`src/lib/room-directory.ts`), климат и генуборки на странице документа; тест «справочник помещений документа точки…»; e2e: `raw/browser-check.txt` — «Кухня точки Б» нет ни в строках, ни в справочнике генуборок |
| AC5 | PASS | `ensureDefaultArea(org, pointId)` / `syncEquipmentDirectoryItem(..., pointId)` (`src/lib/equipment-directory.ts`); вызовы — `[id]/cold-equipment` (новая строка, `ensure_equipment`) и `[id]/equipment-directory` (дубль по названию — в `equipmentBuildingWhere`) |
| AC6 | PASS | страница документа: `enrichedEmployees` = сотрудники точки + `documentReferencedUserIds` + открывший; `displayEmployees` — весь ростер; табличные журналы — `fillableEmployeeIds`; тест «документ ссылается на людей…»; e2e: `raw/browser-check.txt` — Бориса (точка Б) нет в данных страниц уборки и холодильников точки А |
| AC7 | PASS | POST: `defaultUsers` (сотрудники точки) для значений по умолчанию, `allUsers` — для проверки явного выбора; `/journals/[code]/new`: `pointRowsWhere(getViewedPointId)` для цехов, оборудования и сотрудников |
| AC8 | PASS | см. «Проверки» |

## Проверки

- `node --import tsx --test src/lib/point-document-rows-sync.test.ts src/lib/document-point-rows.test.ts src/lib/document-point-scope.test.ts` — 21/21.
- `npm run typecheck` — 0 ошибок.
- eslint по изменённым файлам — новых ошибок нет; две давние
  `no-html-link-for-pages` (экран выключенного журнала в `[docId]/page.tsx`
  и `[code]/page.tsx`) и давние предупреждения о неиспользуемых импортах.
- e2e-база `wesetup_e2e` (не прод), своя организация «Проверка 31.10 ·
  журналы точек» (`raw/fixture.ts`): `raw/sync-check.txt`,
  `raw/browser-check.txt` (dev на 3021, webpack: Turbopack не принимает
  `node_modules`-ссылку рабочей копии) — 11/11. Старые документы
  пересоздавались перед прогоном, очистку запускала сама страница.
- Наблюдение: в HTML dev-сервера название чужого шкафа встречается в
  отладочной записи React о запросе автоочистки
  (`{"name":"Promise.all","env":"Server","value":…}`) — это dev-only
  отладка ввода-вывода, в рабочей сборке её нет; на экран и в данные
  компонентов оно не попадает.
- `verify-worktree.cjs D:/wt/point-docs` — 12069 файлов, повреждённых 0.

## Ограничения

- Строка генуборок с отмеченной уборкой на помещении другой точки остаётся —
  это запись журнала, удалять её нельзя.
- Окно «Добавить помещение» по-прежнему предлагает «цеха без помещения» всей
  организации (`loadOrphanAreas`) — отдельная мелочь.
- В списке выбора людей у документа точки остаются руководители офиса, только
  если они уже есть в документе или открыли его сами: офис — не торговая
  точка (то же правило, что у гигиены с 2026-10-29).
