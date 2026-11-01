# Доказательства — point-bots-2026-11-01

Проверено на коде ветки `fix/point-bots` (от master 1a92d768). База не
трогалась: проверка — unit-тесты и проверка типов.

| AC | Статус | Чем подтверждено |
|----|--------|------------------|
| AC1 | PASS | `worker-point-scope.test.ts`: «область руководителя: офис и без точек — вся компания; руководитель точки — свои точки» (офис → null, точка → [A], организация без офиса, точки выключены); Max `pendingByEmployee` переведён на `loadManagerPointScope` + фильтр людей |
| AC2 | PASS | `ai-assistant/localization.test.ts`: «assistant point scope…» — документ точки Б для руководителя точки А отклонён и в превью, и при исполнении, своя точка и общий документ — можно; `add_staff` передаёт `buildingIds: ["A"]`. job-text, assistant/context, public-api tools — фильтры `documentWorkerScopeWhere` / `personWorkerScopeWhere` |
| AC3 | PASS | period-report / haccp-plan / generate-sop — `getViewedPointId` + `buildingWhere`, `journalEntryPointWhere`, `lossPointWhere`, `staffAtBuildingWhere`, `equipmentBuildingWhere` (typecheck) |
| AC4 | PASS | `owner-stats-localization.test.ts`: «руководитель точки: /missing, /staff и /who_late — только его точки и люди» (where по точкам документов и людям, /today — сводка области); `start-home.test.ts`: «руководитель точки получает сводку только по своим точкам»; edit/inline — фильтры области |
| AC5 | PASS | Max invite: `issueMaxInvite` с областью → 403 для человека другой точки; список приглашений и сводка фильтруются `personInWorkerScope`; набор журналов — `loadScopeDisabledCodes` |
| AC6 | PASS | `task-claim-point.test.ts` (ключ своей точки найден, чужой — нет; журнал без подборки; объект из ключа); claims POST/GET/assign используют `findScopePoint`; тревога — `placeOfEvent({equipmentId|documentId, userId})` |
| AC7 | PASS | journal-task-pool — `getPoolBuildings` + `generatePoolForPoints`; mini/home — `viewedPointId` для набора журналов, сводки и цехов |
| AC8 | PASS | `equipment-fill-api-localization.test.ts`: пропуск PIN для сотрудника другой точки → 403 `equipmentFill.errors.otherPoint`; pin-request и фото показаний — `worksAtQrPoint`; превью QR — `documentInWorkerScope` по точке объекта |
| AC9 | PASS | task-fill status/page — `journalEntryPointWhere(точка документа)` (typecheck) |
| AC10 | PASS | `npm run typecheck` (через очередь tsc-locked): exit=0 errors=0; 27 тестовых файлов: tests 164, pass 164, fail 0; eslint по изменённым файлам — 0 ошибок (1 старое предупреждение `fullAccess` в mini/home) |

Не сделано (нужна схема/решение): троттлинг напоминаний Max на организацию
(одно поле `MaxOrganizationIntegration.lastReminderAt`), CAPA и партии без
точки — в `/capa`, `/batches` и отчёте за период остаются по организации
(в отчёте это подписано).
