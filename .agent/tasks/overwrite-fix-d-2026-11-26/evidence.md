# Evidence — группа D (писатели `JournalDocument.config`)

Спека: `spec.md` (AC1–AC6). Все проверки — по текущему коду ветки
`fix/overwrite-d-config-writers`.

## Перепроверка находок аудита

| Находка | Подтверждена? | Где |
|---|---|---|
| D1 TasksFlow-формы строчных журналов перезаписывают строку сотрудника | да: оба маршрута (`task-fill/[taskId]`, `integrations/tasksflow/complete`) отдавали адаптеру `link.rowKey = employee-<id>`, адаптеры бракеража/скоропорта/охлаждения делают upsert по `sourceRowKey` | `finished-product.ts` `appendFinishedProductRows`, `perishable-rejection.ts` `appendPerishableRows`, `intensive-cooling.ts` |
| D1 pull/вебхук без значений | да: `applyRemoteCompletion` без `values` переписывал строку с ключом задачи пустыми полями; то же у плана аудита (checked=false, комментарий ""), протокола аудита (result ""), плана обучения (дата "") | `tasksflow-sync.ts` `pullCompletionsForOrganization`, `applyRemoteCompletion` (вебхук) |
| D2 адаптеры без блокировки | да: 19 адаптеров — findUnique → … → `db.journalDocument.update({config})` | см. AC3 |
| D3 внешний API | да: документ читался до транзакции; `data.rows` через `mergeConfigPatch` заменял все строки. Публичные `/developers`, `/settings/api`, OpenAPI замену строк не описывают (OpenAPI вообще не описывает `/api/external/entries`); внутренний `.agent/tasks/journals-external-api/API.md` говорит «merge into config» | `src/lib/external/dispatch.ts` |
| D4 каскады | да: `applyResponsiblesToDocuments` и `syncPointDocumentRows` писали конфиг от списка, прочитанного до цикла | `journal-responsibles-cascade.ts`, `point-document-rows-sync.ts` |

## AC1 — новая строка на каждую отправку — PASS
- `rowKeyForTaskSubmission(code, rowKey)` (`row-key.ts`): для `journalFillHints(code).append` — `<rowKey>#tf-<ms>`, иначе ключ как есть; `extractEmployeeId` снимает `#qr-`/`#tf-`.
- Оба маршрута используют его.
- Тесты: `row-key-qr.test.ts` (3), `tasksflow-task-submission-rowkey.test.ts` (3: две отправки бракеража/охлаждения → разные ключи того же сотрудника; гигиена — ключ как есть),
  `config-lock.test.ts` «блюдо B той же задачей…» ×3 (бракераж, скоропорт, охлаждение: 2 строки, строка A с прежним названием и подписью, у B подписей нет).

## AC2 — выполнение без значений — PASS
- Guard `if (!completed || !values) return false` в finished-product, perishable-rejection, intensive-cooling, audit-plan, audit-protocol, training-plan.
- Тесты: `config-lock.test.ts` «выполнение задачи без значений…» ×6 (конфиг не меняется, `false`).

## AC3 — блокировка в адаптерах — PASS
- `withDocumentConfigLock` + чтение конфига внутри: acceptance, accident-journal, audit-plan, audit-protocol, audit-report, breakdown-history, cleaning (матрица пар), complaint-register, disinfectant-usage, equipment-calibration, equipment-maintenance, glass-list, intensive-cooling, metal-impurity, ppe-issuance, product-writeoff, staff-training, traceability, training-plan. Бракераж/скоропорт уже были под блокировкой.
- `grep "journalDocument.update" src/lib/tasksflow-adapters/*.ts` → только `JournalDocumentEntry`-записи, прямых записей конфига не осталось.
- Тесты: `config-lock.test.ts` — 19 фикстур «две одновременные отправки сохраняют обе», `directWrites === 0`.
- До исправления: `raw/d2-prefix-lost-update.txt` — на коде `HEAD` из двух одновременных записей аварий осталась одна.

## AC4 — внешний API — PASS
- `src/lib/external/config-patch.ts` `mergeConfigPatch`: `rows`/`receipts`/`consumptions`/`findings` — слияние по `id` (поля строки, которых нет в запросе, остаются), новые дописываются; остальные ключи и `appendX` как раньше.
- `dispatchExternalEntries`: в начале транзакции `SELECT … FOR UPDATE` и `tx.journalDocument.findUnique`, дальше всё от свежего конфига.
- Тесты: `config-patch.test.ts` (5), `dispatch-config-lock.test.ts` (1: строка B с подписью, дописанная между чтением и транзакцией, остаётся; A обновлена и сохранила поля; C дописана; FOR UPDATE до чтения в транзакции). До исправления тест падал: `actual: ['A','C']`.

## AC5 — каскады — PASS
- `applyResponsiblesToDocuments`: конфиг (дефолт/патчер) считается внутри `withDocumentConfigLock` от `locked.config`; колонки (`responsibleUserId` и т. п.) пишутся той же записью.
- `syncPointDocumentRows`: предварительный отбор по списку, запись — `trimPointDocumentConfig` от `locked.config` под блокировкой (и только для активного документа той же точки).
- Тесты: `config-cascades-lock.test.ts` (3). До исправления все 3 падали (прямая запись, строка B / отметка уборки терялись).

## AC6 — без регрессий — PASS
- `raw/related-tests.txt`: 56 тестовых файлов, связанных с адаптерами TasksFlow, task-fill, внешним API, каскадами, journal-fill: **466 pass, 0 fail**.
- `npm run test:changed` (TEST_CHANGED_MAX_FILES=60): 13 файлов, 94 pass, 0 fail.
- `raw/tsc.txt`: временный tsconfig по 35 изменённым файлам, `tsc --noEmit --skipLibCheck` — 0 ошибок (exit 0).
- `raw/eslint.txt`: ESLint по изменённым файлам — 0 ошибок (11 старых предупреждений о неиспользуемых переменных, все в нетронутом коде).

## Независимая проверка и доработки
- Свежий верификатор (отдельный агент, получил только spec.md и diff): `verdict.json` — **PASS** по AC1–AC6; 5 замечаний вне критериев — `problems.md`.
- Все 5 исправлены отдельным коммитом с регресс-тестами (раздел «Resolution» в `problems.md`): форма охлаждения без подстановки, ключ повтора `/complete` от `eventId`, серверные поля строк (`signatures`, `sourceRowKey`) во внешнем API, `values: {}` = нет значений, поиск сотрудника до блокировки.
- После доработок: связанные тесты — 56 файлов, **468 pass, 0 fail** (`raw/related-tests.txt`); tsc по изменённым файлам — `raw/tsc.txt`; ESLint — 0 ошибок (`raw/eslint.txt`).

## Вне объёма (в PR)
- «Чистые» append-адаптеры (аварии, СИЗ, приёмка…) при выполнении без значений дописывают пустую строку — данных не теряет, оставлено как было.
