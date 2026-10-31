# Доказательства — 1С:ЗУП по точкам; отчёты и экраны по точке (2026-10-31)

| AC | Статус | Где |
|---|---|---|
| AC1 | PASS | `src/lib/hr1c/odata.ts`: `ТекущееПодразделение_Key` + `Catalog_ПодразделенияОрганизаций`; публикация без поля/справочника — откат на прежний запрос (тест «OData: Basic auth…» с 404 справочника). `api-body.ts`: `departmentId` / `department`; тесты `points.test.ts` «OData: подразделение…», «API обработки 1С…» |
| AC2 | PASS | `settings/integrations/1c/page.tsx` + `hr1c-settings-client.tsx` (блок «Подразделения 1С → точки», только при включённых точках), `PUT /api/settings/hr1c/departments` (чужие/удалённые точки отбрасываются), `HrConnection.departmentPointsJson`, `departmentsJson` |
| AC3 | PASS | `src/lib/hr1c/points.ts` `planHrPoints` + `HrEmployeeLink.pointsFrom1c/pointsSetBy1c`; тесты `points.test.ts` (7) |
| AC4 | PASS | `sync.server.ts`: «Проверить» — действия `points` и точка у «принять», проблема `no_point_mapping`; «Применить» — `createStaffMember({ buildingIds })`, обновление точек; e2e `raw/check.txt` пункты 1С (11) |
| AC5 | PASS | `report-export.ts` (колонка «Точка»), `report-export-data.ts` (`pointId`, `buildingWhere`, легаси по цеху), маршруты Excel/PDF — `getViewedPointId`; `reports/page.tsx` — цеха, графики и счётчики по `viewedPointId`; тест «вся организация…» в `report-export.test.ts`; e2e `raw/check.txt`, `raw/http-check.txt` (Excel) |
| AC6 | PASS | `compliance-bundle/route.ts`: `buildingWhere(viewedPoint)`, «Точка: …» в описи; e2e `raw/http-check.txt` (архив заведующей А) |
| AC7 | PASS | `dashboard/page.tsx`: `journalEntryPointWhere` для «ждут подтверждения» и записей за 48 ч; тест `point-filters.test.ts` |
| AC8 | PASS | `checklists/results/page.tsx`, `checklists/assignments/page.tsx`: `checklistAssignmentAtPoint`; тест `point-filters.test.ts` |
| AC9 | PASS | `losses/page.tsx`: `lossPointWhere` по цехам точки; e2e `raw/http-check.txt` (потери) |
| AC10 | PASS | `monitoring.ts` `resolveMonitoringPoint` (+ тест), `monitoring.server.ts`, ссылка «Все точки» → `?point=all`; e2e `raw/http-check.txt` (мониторинг) |
| AC11 | PASS | см. ниже |

## Проверки

- Тесты затронутых файлов: 33/33 (`hr1c`, `points`, `point-filters`, `monitoring`, `report-export`, `report-localization`).
- `npm run typecheck`, `npm run i18n:check`, eslint изменённых файлов — см. итог в отчёте PR.
- e2e-база (не прод): `raw/check.ts` → `raw/check.txt` ALL PASS (15); dev на 3025 →
  `raw/http-check.mjs` → `raw/http-check.txt` ALL PASS (11).

## Замечания

- 1С не вызывалась: сотрудники передаются как от обработки 1С (тот же `runHrSync`).
- Связанный сотрудник, которому 1С точки ещё не ставила: 1С ставит точки, только если
  они пустые («все точки» — так приходили все принятые из 1С до этой правки). Точки,
  заданные руководителем, 1С не меняет; если руководитель позже поменял точки,
  поставленные 1С, она их больше не трогает.
- Общая e2e-база: параллельная правка (ЭДО / iiko) отправила свою схему и сняла мои
  пустые колонки; вернул их `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, чужие данные
  не трогал (`--accept-data-loss` не использовался).
- Потери фильтруются по цеху (`areaId`). Если параллельная правка добавит
  `LossRecord.buildingId`, фильтр стоит дополнить им.
