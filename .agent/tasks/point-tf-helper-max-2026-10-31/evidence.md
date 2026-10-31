# Доказательства — TasksFlow, «Сетап помощник», Max: только своя точка (2026-10-31)

| AC | Статус | Где |
|---|---|---|
| AC1 | PASS | `src/lib/tasksflow-adapters/point-rows.ts` (`rowsForDocumentPoint`, `scopeAdapterDocumentsToPoints`, `withPointRows`), реестр `src/lib/tasksflow-adapters/index.ts` (`listAdapters`, `getAdapter`); тест `point-rows.test.ts`; e2e `raw/verify.out.txt` — строки адаптера гигиены точки А без сотрудника точки Б и наоборот |
| AC2 | PASS | `src/app/api/integrations/tasksflow/bulk-assign-today/route.ts`: `docCandidateUserIds` (fan-out, `onDutyUserIds`, «по очереди»), цеха точки в «по зонам», `atDocPoint` в «по сменам» и «каждому из ответственных»; правило `makeDocumentPointFilter` (`src/lib/worker-point-scope.ts`, тест); e2e — превью «Отправить всем»: гигиена точки А → Анна, Вера (без Бориса), точки Б → Борис, Вера; к заглушке TasksFlow 0 запросов |
| AC3 | PASS | `src/lib/setup-helper-catalog.server.ts` (`userId` ключа телефона → `loadWorkerPointScope`), `src/app/api/setup-helper/catalog/route.ts`; e2e — у Анны (точка А) сотрудники без Бориса, блюда точки А и общие, без блюда точки Б; у Веры (все точки) — всё |
| AC4 | PASS | `src/lib/max/bot.ts` (`startFill`: `documentInWorkerScope`), `src/lib/journal-fill-submit.ts` (проверка точки и для мессенджера); e2e — Max у Анны предлагает только гигиену точки А; Бориса в документ точки А не пускает правило записи |
| AC5 | PASS | `src/lib/max/bot.ts` (`pendingByEmployee`: `documentWorkerScopeWhere` по `JournalObligation.buildingId`) — сводка и напоминание руководителя точки; правило покрыто тестом `worker-point-scope.test.ts` |
| AC6 | PASS | см. «Проверки» ниже |

## Проверки

- `node --import tsx --test` новых и связанных тестов: 33/33
  (`worker-point-scope`, `point-rows`, `hygiene`, `cold-equipment`,
  `setup-helper-catalog`); соседние наборы: 144/144 (`adapter-contract`,
  `max/bot-fill`, `max/bot-views`, `max/security`, `bell-push-once`,
  `journal-responsibles-org.smoke`, `task-fill-*-localization`,
  `journal-fill`, `qr-fill.smoke`).
- eslint изменённых файлов: 0 ошибок (3 давних предупреждения в
  `bulk-assign-today/route.ts` — неиспользуемые импорты, не из этой правки).
- `npm run typecheck`: 0 ошибок (`raw/typecheck.txt`).
- e2e-БД (`wesetup_e2e`, не прод): `raw/verify.ts` → `raw/verify.out.txt`.
  Маршрут «Отправить всем» вызван внутренним ключом в режиме превью
  (`dryRun`), `baseUrl` интеграции — локальная заглушка: реальный API
  TasksFlow не вызывался.

## Принципы TasksFlow

Меняется только выбор исполнителей среди сотрудников Wesetup для документа
точки. Создание задач, outbox, Idempotency-Key, sync, статусы — без
изменений (П-10, П-12, П-15, П-19).

## Не сделано / замечено рядом

- «Отправить всем» создаёт задачи напрямую через клиент TF, без outbox
  (так было до правки) — расходится с П-15, отдельная задача.
- Ответственные журналов одни на организацию (`journalResponsibleUsersJson`):
  режим «каждому из ответственных» теперь отбрасывает ответственных другой
  точки, но per-point ответственные — решение владельца.
