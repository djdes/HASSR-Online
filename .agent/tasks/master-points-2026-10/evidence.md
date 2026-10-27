# Evidence — master-points-2026-10

Ветка `fix/master-points` (worktree `D:/wt/master-points`) от `origin/master` 8038a1ad.

| AC | Статус | Где |
|----|--------|-----|
| AC1 | PASS | `Building.serviceCode` (schema), `ensureBuildingServiceCode` + `getDishPoolInfo` (src/lib/dish-pool.ts), подписи `dishPool.pointCode/pointDescription` |
| AC2 | PASS | `POST /api/master/objects`: код точки → `Building.linkedServiceCode`; код организации с ≥2 точками → ошибка с подсказкой |
| AC3 | PASS | `listPoolOrganizations`: организация целиком → объекты-точки (`wholeOrgPoints`), выгрузка уже пишет по `buildingId` (master-brakerage.ts) |
| AC4 | PASS | `wholeOrgPoints` исключает точки с чужим `linkedServiceCode`; POST отказывает точке, чья организация целиком в другом кабинете |
| AC5 | PASS | `DELETE /api/master/objects` + кнопка «Отключить» с `ConfirmDialog` |
| AC6 | PASS | `isPoolObjectInPool` учитывает точки организации-целиком |
| AC7 | PASS* | ru/en/uz, `npm run i18n:types`, «Что нового» + иконка категории |

Проверки:
- `node --import tsx --test src/lib/master*.test.ts src/lib/dish-pool*.test.ts src/components/master/*.test.ts` — 79/79.
- `src/lib/master-pool-points.test.ts` — новые тесты разворота точек.
- `tsc --noEmit`: в изменённых файлах ошибок нет. Остальные 120 ошибок — TS7016/следствия
  в нетронутых файлах: неполный `node_modules` worktree (первый `npm ci` оборвался по таймауту).
- ESLint по изменённым файлам: 0 ошибок.
- `message-contract.test.ts`: падает только на `confirm/ru is stale` — CRLF в Windows-чекауте
  нетронутого файла (скрипт сравнивает побайтно), не связано с правкой.
- `verify-worktree.cjs`: corrupted 0; `scan-corrupt.cjs`: corruptModifiedByAgent 0.

Не проверено: живой прогон на браузере и на боевых данных (чтение прод-БД заблокировано).
