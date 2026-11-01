# Доказательства — принтер своей точки (2026-11-01)

| AC | Изменение | Проверка |
|---|---|---|
| AC1 | `src/lib/print-point-routing.ts`: `agentMayTakeJob`, `printJobQueueWhere`, `pointsWithOwnAgent`, `canManageAgentPoint` | `src/lib/print-point-routing.test.ts` 5/5 |
| AC2 | `api/print/agent/poll`: `...printJobQueueWhere(agent, pointsWithAgent)`; `authenticateAgent` отдаёт `buildingId` | typecheck; правило покрыто AC1 |
| AC3 | `api/print/jobs`: `buildingId: doc.buildingId`; онлайн — `agentMayTakeJob` | typecheck; `document-point-access.test.ts` (маршрут в списке) зелёный |
| AC4 | `api/print/agents/auth`: `defaultAgentBuildingId` (`computePointScope`), необязательный `buildingId` через `canManageAgentPoint` | typecheck |
| AC5 | новый `api/print/agents/[id]` PATCH; `revoke` проверяет точку принтера | правила — тест AC1 (`canManageAgentPoint`) |
| AC6 | страница: `loadBuildingContext` → точки в пределах человека, фильтр принтеров руководителя точки; клиент: выбор точки (`<select>`, PATCH, тост, refresh), подсказка, подпись точки; карточка дашборда — подпись точки; `/api/print/status` — точка из шапки | `print-agent-settings.test.ts` 6/6 (2 новых: PATCH и «Вся организация» только руководству; страница руководителя точки — только свои принтеры и точки) |
| AC7 | каталоги ru/en/uz + `message-contract.d.ts` (`i18n-types`) | `npm run typecheck` 0 ошибок; eslint по изменённым файлам 0; `print-agent-card-localization`, `label-printers` тесты зелёные; `i18n-types --check` ok |

Живой прогон с настоящим агентом не делался (по правилам группы без dev-сервера).
