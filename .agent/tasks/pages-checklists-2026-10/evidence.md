# Evidence: «Чек-листы» — Шаблоны, Назначение, Результаты (pages-checklists-2026-10)

Ветка `feat/pages-checklists` от `integ/sketch-wave` `76c01cc4`, база `wesetup_pages_checklists`, dev-сервер :3075
(запущен с пустым `TELEGRAM_BOT_TOKEN` и `TELEGRAM_API_ROOT=http://127.0.0.1:9` — настоящих сообщений нет).
Вход демо-ролей: `admin@haccp.local` / `chef@haccp.local` / `hotcook1@haccp.local`, пароль `admin1234` (подошёл, не менялся).

## Итог по критериям

| AC | Вердикт | Доказательства |
|----|---------|----------------|
| AC1.1 Guard «Шаблонов» = `hasJournalAccess(`, пункт `CHECKLISTS_FACT` | PASS | `src/app/(dashboard)/checklists/templates/page.tsx`; тест «правило каждой вкладки… повторяет guard» (`raw/tests-nav.txt`) |
| AC1.2 Типовые: 6 шаблонов, разделы/вопросы/критичные, «Уже добавлен», «Добавить в организацию» → после — «Начать проверку» / «Открыть в конструкторе» | PASS | `raw/results-flow.json` (`sanpinAdded`, `sanpinButtons`), `raw/flow-01…02-*.png` |
| AC1.3 Шаблоны организации: «Начать проверку», «Изменить в конструкторе» (`/checklists?edit=<id>`), «Назначить» (руководителю → «Назначение» с выбранным шаблоном) | PASS | `raw/results-flow.json` (`dialogTemplate`), `raw/flow-02*.png`, `raw/flow-03*.png` |
| AC1.4 «Назначено вам»: шаблон, срок, статус, «Начать проверку» → проверка с `assignmentId` | PASS | `raw/results-flow.json` (`cookAssignedBefore`, `inspectionAssignmentId === assignmentId`), `raw/flow-06-cook-assigned.png` |
| AC2.1 Модель `ChecklistAssignment` + 4 поля `ChecklistInspection`, только добавления | PASS | `prisma/schema.prisma`; `raw/schema-review.sql` (8 инструкций: CREATE TABLE/INDEX, ADD COLUMN, FK), `raw/schema-apply.txt` (`apply-safe-schema.cjs` применил, `prisma db push` — «in sync») |
| AC2.2 Чистые функции периода/срока/статуса/получателей с тестами | PASS | `src/lib/checklist-assignments.ts` + `.test.ts` (13 тестов), `src/lib/checklist-results.ts` + `.test.ts` |
| AC2.3 API `GET/POST /api/checklists/assignments`, `PATCH/DELETE …/[id]`: zod, организация из сессии, чужие id — 404, журнал действий | PASS | `raw/results-api.json` (повар 403/403, заведующая GET 200 / POST 403, 400 на мусор и weekly без дня, 404 на чужой шаблон/неизвестный id); `recordAuditLog` `checklist.assignment_*` |
| AC2.4 Без TasksFlow | PASS | в новых модулях нет импортов/вызовов TF (grep — только тексты «без TasksFlow») |
| AC3.1 «Назначение»: guard `"admin.full"`, пункт `ADMIN` | PASS | `src/app/(dashboard)/checklists/assignments/page.tsx`; `app-nav.test.ts`; заведующая и повар уходят на «Шаблоны» (`raw/results-pages.json`) |
| AC3.2 Список: шаблон, кому, периодичность и срок, проверяющий, статус периода, «Изменить», «Пауза/Включить», «Удалить» (`ConfirmDialog`) | PASS | `raw/results-flow.json` (`rowText`, `rowAfter`), `raw/results-manage.json`, `raw/manage-01…03-*.png` |
| AC3.3 Окно по шагам 1–5, групповой выбор «кому» и «кто проверяет» (поповер как `UserPicker`), живая подсказка | PASS | `raw/flow-03-dialog-warnings.png`, `raw/flow-04-dialog-cook.png`, `liveHint` в `raw/results-flow.json` |
| AC3.4 Предупреждения: нет доступа к чек-листам / нет Telegram — кто и ссылки | PASS | `warningTargetHint`, `warnLinks` (`/settings/journal-access`, `/settings/users`) в `raw/results-flow.json` |
| AC4.1 `/api/cron/checklist-reminders`: `checkCronSecret`, `?dryRun=1`, расписание в комментарии | PASS | маршрут; 401 без секрета и с чужим (`raw/results-api.json`, `route.test.ts`) |
| AC4.2 В день срока — одно напоминание на период, кнопка в Mini App, выполненным — нет | PASS | dryRun до проверки → получатель «Волкова Анна Дмитриевна» (`cronDryRunBefore`), после проверки — пусто (`cronDryRunAfter`); отметка периода → повтора нет, пауза → нет (`raw/results-manage.json`); чистая функция `reminderPlan` + тесты |
| AC4.3 Завершение проверки по назначению — сообщение проверяющему со ссылкой на результат | PASS | `notifyChecklistVerifier` в `after()` PATCH-завершения; тест с подменой отправки (`checklist-assignments.server.test.ts`: chat id, текст, кнопка `web_app` на `/checklists/results?inspection=…`); в e2e у заведующей нет Telegram → `raw/dev-verifier-notify.txt`: `verifier notify …: no-telegram` |
| AC4.4 Тесты: отбор получателей, дедупликация по периоду, 401 без секрета | PASS | `checklist-assignments.test.ts`, `route.test.ts` |
| AC5.1 «Результаты»: guard `hasJournalAccess(`, история (дата, шаблон, кто, баллы/нарушения/критическая остановка, статус, назначение), «Открыть», PDF; в конструкторе — «Все результаты» | PASS | `src/app/(dashboard)/checklists/results/page.tsx`; `chefRowBefore`; история убрана из `checklists-client.tsx` (карточка «Все результаты») |
| AC5.2 Фильтры: шаблон, период, только с нарушениями; пустое состояние | PASS | `raw/results-manage.json` (`violationsUrl`, `periodUrl`), `raw/manage-04-results-violations.png` |
| AC5.3 «Принять результат» (проверяющий по назначению или руководитель) → `reviewedAt/By`, отметка в списке | PASS | `chefRowAfter` («Принято: Морозов Илья Андреевич …»), `chefInspectionBar`; `raw/flow-09…11-*.png` |
| AC6.1 `menuShape("checklists")`, подписи RU/EN/UZ, иконки, корень раздела | PASS | `app-nav.test.ts`, `navigation-localization.test.ts` (126 маршрутов), `npm run i18n:check` (`raw/i18n-check.txt`) |
| AC6.2 Повар с доступом — Шаблоны/Конструктор/Результаты, без «Назначения»; без доступа — раздела нет | PASS | тест «Чек-листы: «Назначение» — только руководителю…»; у повара один раздел — сайдбара нет по правилу кабинета (см. «Решения»), переходы ссылками |
| AC6.3 Тесты `app-nav.test.ts` и соседние | PASS | `raw/tests-nav.txt` |
| AC7.1 Общие проверки + Playwright-сценарий, 1440/390, Mini App, скриншоты | PASS | `raw/playwright-*.txt`, `raw/results-*.json`, `raw/*.png`; копия — `C:\Users\Two\wesetup-backup-2026-10-17\pages-shots\checklists\` |
| AC7.2 Текст «Что нового» | PASS | ниже |

## Проверки

- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --skipLibCheck -p tsconfig.typecheck.json` — exit 0 (`raw/tsc.txt`).
- `npx eslint <изменённые .ts/.tsx>` — 0 проблем (`raw/eslint.txt`).
- `node --import tsx --test` навигация + свои тесты — 81/81 (`raw/tests-nav.txt`); `npm run i18n:check` — 82/82 (`raw/i18n-check.txt`).

## Playwright (`check.mjs`, сервер :3075)

- `api` — 12/12 ожидаемых кодов (`raw/playwright-api-flow.txt` — его flow-часть устарела, сценарий flow — в `raw/playwright-flow.txt`).
- `flow` — без проблем, кроме одного нестабильного dev-`pageerror` (см. ниже): типовой СанПиН добавлен →
  «Назначить» → повару горячего цеха ежедневно, проверяет заведующая → dryRun видит повара → у повара «Назначено вам» →
  проверка с `assignmentId` → «Завершить проверку» → у повара «Выполнено» → заведующая «Принять результат» → у
  руководителя «Выполнено», dryRun молчит (`raw/results-flow.json`, `raw/flow-*.png`).
- `manage` — dryRun → отметка периода → повтора нет; «Пауза» (dryRun молчит) → «Включить»; «Изменить» → еженедельно;
  «Удалить» через `ConfirmDialog`, тост со счётчиком (`raw/results-manage.json`, `raw/manage-*.png`). Фильтр периода в этом
  прогоне кликнулся во время перехода — повторено отдельно (`raw/probe-notes.txt`, `raw/manage-05-results-period-all.png`).
- `pages` — 3 роли × (1440, 390, Mini App) × 4 страницы: все 200, горизонтальной прокрутки нет; меню и подсветка у
  руководителя (4 пункта) и заведующей (3); «Назначение» у заведующей и повара уводит на «Шаблоны»; в Mini App меню
  раздела — кнопкой (`raw/results-pages.json`, `raw/page-*.png`).
- Замечания прогона (не от раздела): hydration-расхождение атрибутов `<html>` в оболочке Mini App — то же на
  `/settings/buildings`; нестабильный `Invalid or unexpected token` в dev (и на старом `/checklists`), отдельной проверкой
  не воспроизводится (`raw/probe-notes.txt`).
- Настоящих сообщений в Telegram нет: крон вызывался только с `?dryRun=1`; строк `TelegramLog` с тестовыми chat id — 0
  (`raw/cleanup.txt`).
- Схема: `node scripts/apply-safe-schema.cjs --dry-run` → 8 аддитивных инструкций (`raw/schema-review.sql`), затем применено тем же скриптом, `prisma db push` — без изменений.
- `verify-worktree` → `corrupted: 0`; `scan-corrupt` → `corruptModifiedByAgent: 0`, `corruptUntracked: 0`.

## Решения по ходу

1. **Период — «день срока».** Ежедневно — каждый день; еженедельно — выбранный день недели; ежемесячно — выбранное
   число (в коротком месяце — последний день); разово — дата. В день периода до срока — «ожидает», после — «просрочено»,
   в другие дни — «не в этот день» (+ следующий срок). Разовое после даты остаётся просроченным, пока не проведут.
   Период закрывает одна завершённая проверка по назначению любого получателя.
2. **Назначили после срока в тот же день** — первый период завтра (иначе «просрочено» в момент создания).
   Разовое в прошлом API не принимает (400).
3. **Напоминание:** в день срока, начиная за 2 часа до срока (не раньше полуночи); крон раз в час. Одно на период:
   до отправки период «занимается» условным `updateMany` по `lastReminderPeriodKey`. Опоздавший крон в тот же день
   шлёт с пометкой «срок прошёл». Правка назначения сбрасывает отметку периода. Тексты Telegram — по-русски, как у
   соседнего `ppk-reminders`; интерфейс — RU/EN/UZ.
4. **Проверяющий видит проверки своих назначений** без `journals.manage` (страница проверки, GET API, PDF, вложения —
   общий `checklistInspectionReadWhere`); права записи не менялись. Иначе заведующая не увидела бы результат повара.
5. **«Назначено вам»** — первой карточкой на «Шаблонах» (без номера, выделена): это дело на сегодня; дальше
   нумерованные 1 «Типовые», 2 «Шаблоны организации». Старт по назначению продолжает свой черновик, а не плодит новые.
6. **«Принять результат»** — и в «Результатах», и полосой на странице проверки (туда ведёт ссылка из Telegram-сообщения
   через «Результаты» с подсветкой `?inspection=`).
7. **Повар и меню.** Модель меню даёт повару «Шаблоны / Конструктор / Результаты» (тест), но кабинет показывает сайдбар
   только при двух и более разделах (`showSidebar`, решение каркаса меню — не менял). Поэтому переходы по разделу есть
   на страницах: в шапке «Шаблонов» — «Конструктор», «Результаты» (руководителю ещё «Назначение»), на «Результатах» —
   «К шаблонам», в конструкторе — «Все результаты». Нужно ли меню раздела людям с одним разделом — вопрос к владельцу.
8. **Страница проверки** `/checklists/inspections/<id>` теперь подсвечивает «Результаты» (`match`), крошка «‹ Результаты».
9. **Кто «не может провести»** в предупреждении — нет права записи или закрытия журнала `custom_checklists`
   (`decideJournalAcl`), ссылка — «Доступ к журналам»; без Telegram — ссылка «Сотрудники».
10. **Проверяющий по умолчанию** — текущий руководитель; группа «Рекомендуем: руководство» — пресеты admin/head_chef.
11. **Чтение API назначений** — руководству (`hasFullWorkspaceAccess`), изменения и страница — `admin.full`.
12. Удаление назначения проверки не трогает (`onDelete: SetNull`), тост — «Проверок по нему в истории: N».
13. Конструктор открывает редактор по `?edit=<id>` / `?edit=new` (ссылки с «Шаблонов»).
14. Ответы 50 вопросов типового шаблона в e2e вписаны тем же PATCH API, что и форма (форма проверки — существующая,
    не менялась), а **завершение — кнопкой «Завершить проверку»** в браузере.

## Окружение (заметки)

- Диск D: 19.10 вечером: 41 «испорченный» файл в рабочей копии (не мои) — восстановлены `verify-worktree --restore`;
  затем диск заполнился (`ENOSPC`, ~375 МБ свободно), dev-сервер отдавал 500 — перезапущен, сборка `.next-pages-checklists`
  удалена и собрана заново. Попытка вынести сборку на C: через junction отменена (Node не находил модули).
- Сообщение об ошибке Playwright один раз записало в сырой лог заголовок `Authorization` с `CRON_SECRET` из локального
  `.env` и cookie сессии — файл удалён до коммита, скрипт теперь вырезает заголовки (`redact`). В репозиторий не попало.
- Тестовые правки своей базы на время e2e: `waiter2` — `journalAccessMigrated=true` (предупреждение «нет доступа»),
  `hotcook1` — фальшивый `telegramChatId` (получатель в dryRun). После прогона возвращены (`raw/cleanup.txt`).

## Предложение «Что нового» (для S3)

«Чек-листы: готовые шаблоны, назначение и результаты. В «Шаблонах» — шесть типовых проверок, которые добавляются
в организацию одной кнопкой. В «Назначении» руководитель выбирает, кому, как часто и до скольки проводить проверку и кто
принимает результат — сотрудник получит напоминание в Telegram. В «Результатах» — история проверок с баллами и
нарушениями и кнопка «Принять результат».»

## Ждёт людей

- Строка crontab для напоминаний (S3, с согласия владельца, при выкладке):
  `0 * * * * curl -s -m 120 -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1:3002/api/cron/checklist-reminders`
- Вопросы 6 типовых шаблонов не вычитаны технологом (из evidence journal-sets).
- Решение владельца: показывать ли меню раздела людям с одним разделом (п. 7).
