# Доказательства — point-docs-2026-11-01

Ветка `fix/point-docs` от master 1a92d768.

| AC | Статус | Доказательство |
|---|---|---|
| AC1 | PASS | `canSeeDocumentPoint` во всех 18 маршрутах `api/journal-documents/[id]/**`, странице документа, layout, проверке, `print/jobs`, `row-form`, `room-scopes`; тест `src/lib/document-point-access.test.ts` обходит все `route.ts` под `[id]` и требует проверку |
| AC2 | PASS | `journals/[code]/page.tsx` — `journalEntryPointWhere(listBuildingId)`; `[entryId]/page.tsx`, `journals/[id]/status`, `mini/attachments` — `journalEntryPointId` + `canSeeDocumentPoint`; `POST /api/journals` — цех/оборудование проверяются по точке |
| AC3 | PASS | `getActiveBuildingId` убран из списков: `journals/[code]/page.tsx`, `journals/page.tsx` (бейджи), `GET /api/journal-documents`, `documents-menu`, `journal-crumb-menu`, layout/verify (точка документа), `today-status`, `catch-up` (строка на точку в режиме всей организации), место отклонения в `POST /api/journals` |
| AC4 | PASS | `POST /api/journal-documents`: явная `buildingId` только из доступных, иначе 404; «Вся организация» без офиса — 400 «Выберите точку в шапке…»; `bulk-create`/`auto-create` — `visibleBuildingTargets` |
| AC5 | PASS | `pointUsers` в диалогах списка на точке; бракераж ГП — `enrichedEmployees`; аудит — `buildingWhere(rowsPointId)`; cleaning/climate/cold/uv автозаполнение — `pointRowsWhere`/`staffAtBuildingWhere`; GET документа — сотрудники точки + из записей |
| AC6 | PASS | `journal-previews`: `?b=` чужой точки → общий снимок |
| AC7 | PASS | см. ниже |

## Команды

- `node --import tsx --test src/lib/document-point-access.test.ts` — 8/8 pass.
- Связанные тесты исходников (journals page, крошки, PDF, печать, навигация,
  доступы, точки): 131 + 343 + 19 + 37 pass, 0 fail
  (`navigation-localization.test.ts` — мок `@/lib/active-building`
  переведён на `getViewedPointId`).
- `npm run typecheck` (через очередь tsc-locked) — exit 0, 0 ошибок.
- `verify-worktree.cjs` — corrupted 0.

Живой прогон на e2e-БД не делался (общая база и параллельные ветки);
проверка — тестами и типами.
