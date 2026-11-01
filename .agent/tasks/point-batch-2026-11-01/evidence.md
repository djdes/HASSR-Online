# Доказательства — партии и CAPA по точкам (2026-11-01)

| AC | Изменение | Проверка |
|---|---|---|
| AC1 | `src/lib/point-records.ts` (`pointRecordsWhere`, `recordsAtPointWhere`); списки `api/batches`, `api/capa`, страницы `/batches`, `/capa` (+ плитки), подпись точки в «Вся организация» | `point-records.test.ts` (правила where) |
| AC2 | `pointRecordVisible` в `api/batches/[id]` (GET/PATCH), `api/capa/[id]` (PATCH), `capa/[id]/suggest`, страницах `batches/[id]`, `capa/[id]`; `bulk-close` — только записи точки | тест обходит маршруты и страницы |
| AC3 | `POST /api/batches` — точка документа приёмки (`sourceEntryId`) или `newRecordPoint`; `POST /api/capa` — `newRecordPoint`, исполнитель `staffAtBuildingWhere`; `capa/new` — исполнители точки из шапки; `PATCH capa` — исполнитель точки CAPA | `newRecordPoint` в тесте |
| AC4 | `iot-violation-capa` (точка оборудования), `capa-auto-detect` (точка цеха оборудования, руководитель точки: дежурный → руководитель точки → как раньше), `api/journals` (точка события тревоги), `journal-task-claims/[id]` (`placeOfEvent`), `mercury/process-incoming` (точка приёмки) | тест: каждое создание записи передаёт `buildingId` |
| AC5 | `traceability-document-client` → `/api/batches?documentId=`; `api/journal-documents` POST — партии и поставщики точки документа | typecheck |
| AC6 | `more/page`, `reports/page`, `ai/period-report`, `reports/compliance-bundle`, Telegram `/capa` `/batches` (`documentWorkerScopeWhere`) | typecheck |
| AC7 | — | `point-records.test.ts` + batch/capa/mercury/temperature/owner-stats/document-point тесты — 103/103; тесты, ссылающиеся на изменённые файлы, — 137/137; `npm run typecheck` (очередь) — 0 ошибок |

Не сделано: выбор точки в форме создания (в «Вся организация» запись создаётся общей,
точку задаёт шапка); поставщики-справочники (`org-directory-db`, каскад ответственных) и
календарь организации остаются общими; `compliance-audit` и `weekly-ai-digest` — по
организации.
