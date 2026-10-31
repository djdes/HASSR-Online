# Доказательства — задачи дня по точке (2026-10-31)

| AC | Статус | Где |
|---|---|---|
| AC1 | PASS | `poolBuildingsFromContext` (`src/lib/building-scope.ts`), тест «задачи дня: точка — только она, …» в `building-scope.test.ts` |
| AC2 | PASS | `journal-task-pool.ts`: холодильники, фритюрницы, УФ-лампы, оборудование — `equipmentBuildingWhere(args.buildingId)`; e2e: `raw/http-check.txt` (холодильник и УФ-лампа точки Б не видны повару А) |
| AC3 | PASS | `mergePointPools` / `generatePoolForPoints`, `src/lib/journal-task-pool-points.test.ts` (3 теста); e2e: «Вся организация» — холодильник точки Б с подписью «Точка Б · …» |
| AC4 | PASS | `/api/mini/today` → `getPoolBuildings` + `generatePoolForPoints`; `raw/http-check.txt` пункты 1–2 |
| AC5 | PASS | `/api/verifications`: работы — `user: staffAtBuildingWhere(точка)`, «не взято» — подборка точки, отключённые журналы точки; `raw/http-check.txt` пункт 3, «Вся организация» — пункт 4 |
| AC6 | PASS | `/api/control-board` (сотрудники `staffAtBuildingWhere`, подборка точки), `/api/control-board/remind` (адресаты — сотрудники точки); `raw/http-check.txt` пункт 3 |
| AC7 | PASS | `cron/health-qr-missing`: цикл по документам гигиены, люди — `listFillEmployees(…, { pointScope })`, получатели — `listCoreJournalRecipients(org, doc.id)`, ключ `health-qr-missing:<день>:<документ>`; e2e: `raw/health-qr-check.txt` ALL PASS (7) |
| AC8 | PASS | `cron/mini-digest`: `managerDigestFor` — руководитель одной живой точки получает `getManagerObligationSummary(…, точка)`; тест «руководитель одной точки получает сводку своей точки…» в `route.test.ts` |
| AC9 | PASS | `npm run typecheck` — exit 0, 0 ошибок; eslint изменённых файлов — 0 ошибок (2 давних предупреждения о неиспользуемых переменных не из этой правки); тесты рядом с изменениями — 25/25 (pre-commit); e2e: `raw/http-check.txt` ALL PASS (15) |

## Проверка на e2e-базе (не прод)

- Данные: `raw/fixture.ts` → `raw/fixture.json` (две точки, у каждой холодильник,
  УФ-лампа, склад, повар; заведующая точки А; выполненные задачи обоих поваров).
- Тот же сценарий на коде `origin/master` без правки — `raw/http-check-before-fix.txt`:
  FAILED 9/15 (повар А видит холодильник, лампу и склад точки Б; заведующая точки А —
  работу и повара точки Б). С правкой — `raw/http-check.txt`: ALL PASS (15).
- Крон «Не отметились по QR» — `raw/health-qr-check.ts` → `raw/health-qr-check.txt`.

## Замечания

- Сегодняшние взятые задачи событийных журналов (приёмка, дезсредства, генуборка
  и т. п.) были сохранены с ключом без точки: в день выкладки такие задачи один раз
  снова покажутся «не взятыми». Задачи живут один день.
- `JournalTaskClaim` без точки: на точке работы фильтруются по исполнителю; работы
  сотрудника «все точки» видны на каждой точке.
- Сервер разработки запускался из второй рабочей копии на том же коммите
  (Turbopack не принимает ссылку на `node_modules` вне корня).
