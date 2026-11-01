# Доказательства — площадки Меркурия → точки; пауза Max по точке (2026-11-01)

| AC | Изменение | Проверка |
|---|---|---|
| AC1 | `mercury-settings-client.tsx`: список площадок с выбором точки, «Опрашивать», удалением (ConfirmDialog, danger), форма «Добавить площадку», пустое состояние с подсказкой; тексты ru/en/uz (`settingsUi.mercurySettingsClient.*`), `message-contract.d.ts` перегенерирован | typecheck; i18n-тесты (`src/i18n/*.test.ts`) — контракт совпадает с каталогами |
| AC2 | `enterprises/load/route.ts` ставит `getActivityLocationList` (повтор не плодит заявку); `sync.ts` в `runMercuryOutbox` → `applyEnterpriseList` | `enterprise-mapping.test.ts` — `planEnterpriseList` (новые / обновление / регистр GUID / дубли) |
| AC3 | `autoEnableOnMapping` в PATCH; POST с точкой — сразу `enabled` | тест «выбрали точку — опрос включается сам» |
| AC4 | `repointEnterpriseDocuments` при смене точки; `upsertVetDocument` не меняет точку у `processing`/`processed` | тест `vsdPointFollowsEnterprise` |
| AC5 | `src/lib/mercury/settings-guard.ts` (руководство, не `isPointScoped`, тариф `mercury`); префикс `/api/integrations/mercury` уже company-only | чтение кода; typecheck |
| AC6 | `src/lib/max/remind-throttle.ts`; `bot.ts`: ключ области из `loadManagerPointScope`, решение в транзакции с `SELECT … FOR UPDATE`, `lastReminderAt` обновляется | `remind-throttle.test.ts` — точка А не блокирует точку Б, старая отметка до появления карты, чистка старых |
| AC7 | — | `node --import tsx --test src/lib/mercury/*.test.ts src/lib/max/*.test.ts src/lib/point-scope.test.ts src/i18n/*.test.ts` — 195/196: падает только `message-contract` (`i18n-types --check`) из-за CRLF в Windows-копии, после регенерации контракт без изменений по содержимому; `npm run typecheck` — 0 ошибок (после слияния master #98) |

Не проверено вживую: настоящий Меркурий не вызывался; в демо-режиме «Загрузить из Меркурия» вернёт пустой список (mock не отвечает на список площадок) — ручное добавление работает.
