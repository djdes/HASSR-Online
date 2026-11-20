# Evidence — серия A: доделать выпущенное (пункты 1–5 и исправление к пункту 7)

Стенд: локальный PostgreSQL 16 + `next dev`, Playwright/Chromium; ветка `claude/eloquent-cray-4wdz2i` от master
02d0bcc6e. Продакшн не трогали. Письма в dev-режиме не уходят, а пишутся в журнал сервера (`[email/dev] …`).
Сценарии и журналы — в `raw/`.

## AC1. Закрытая организация не получает задач — PASS
`lockedOrganizationIds(now)` в `src/lib/org-trial.server.ts`: один запрос организаций с `trialEndsAt <= now`, тариф —
по разу на аккаунт; сбой — пустое множество (задачи идут как раньше). Чистые части `oneOrgPerAccount`,
`lockedOrgIdsOf` — с тестами в `src/lib/org-trial.test.ts`.

Пропускают закрытые организации (22 из 55 ежедневных задач):

| Что делают | Задачи |
|---|---|
| создают документы и записи журналов | auto-create-journals, journal-automation, auto-fill-journals, auto-close-shifts, tuya-pull |
| задачи людям (TasksFlow) | general-cleaning-tasks, cleaning-control-digest |
| напоминания и тревоги | checklist-reminders, compliance, expiry, health-qr-missing, ppk-reminders, uv-lamp-running, shift-watcher, tasksflow-escalations, anomaly-detect, predict-alerts, deviation-escalations (через `escalateOpenIncidents({ skipOrganizationIds })`, с тестом) |
| сводки | mini-digest, weekly-digest, weekly-ai-digest |
| только напоминание | mercury-poll: очередь «Меркурия» идёт, напоминание о сроках ВСД — нет |

Не тронуты: биллинг и оплаты (billing-transition, auto-pause-inactive, expire-point-orders, sber-payments,
partner-month-close), резервные копии и очистки (yandex-backup, tasksflow-snapshot, purge-*, print-cleanup,
auto-archive-documents, tasksflow-cleanup-old, journal-claim-expire, point-assignments, migrate-task-scopes),
внешние системы (edo-sync, hr1c-sync, losses-export-1c, mercury-outbox, tasksflow-outbox/-poll/-autolink-retry,
webhooks-deliver), платформенные (crm, mailing, max-channel, gogetlinks, seo-alerts, support-unanswered, uptime-sample,
journal-previews, telegram-deferred).

Вживую (`raw/locked-check.log`, 6/6): у оплаченного аккаунта на 1 точку — организация в тарифе и организация, чьи
14 дней кончились 2 дня назад; у обеих одинаковые журналы и включена автоматика. `lockedOrganizationIds` вернул только
вторую (совпадает с `isOrganizationLocked`); задача автосоздания документов создала открытой 1 документ, закрытой — 0.

## AC2. Напоминания до конца своих 14 дней — PASS
`orgTrialReminderStage` (3 при 2 < дней ≤ 3, 1 при 0 < дней ≤ 1), `orgTrialReminderDue` (та же организация, срок и
ступень), `orgTrialClosesAtEnd` (не пугать закрытием, если оплаченная точка ей достанется), `orgTrialReminderSubject` —
с тестами (`org-trial.test.ts`). Шаг `remindOrgTrials` в ежедневной задаче биллинга — отдельным проходом до шагов
тарифа аккаунта; отметка `billing.org_trial_reminder` `{ organizationId, trialEndsAt, stage }`; подпись в журнале
действий. `dryRun` ничего не шлёт.

Вживую (`raw/reminder-check.log`, 7/7): за 2,5 дня — одно письмо «Через 3 дня закончатся бесплатные дни организации
«…»» владельцу аккаунта и одна отметка; повторный запуск — ничего; за полдня — «Завтра закончатся…», отметок две
(ступени 3 и 1); аккаунт в своём пробном периоде — ничего; пробный прогон — ничего.

## AC3. Образцы писем для ROOT — PASS
`POST /api/root/directory-exchange/test-letters` (`requireRoot`; правило `platform-access.ts` — superadmin) шлёт на
почту ROOT оба письма обмена с другой компанией с выдуманными данными и темой «[Проверка] …» и отвечает
`{ ok, configured, to, letters: [{ kind, delivered }] }`; нет рабочей почты — 400. Карточка «Письма обмена
справочниками» внизу ROOT → «Рассылка» (`raw/06-root-sample-letters.jpg`). Вживую (`raw/series-a-live.log`): «Отправлено
на root@local.test», оба письма «записано в журнал сервера», в журнале обе темы с «[Проверка]»
(`raw/next-dev-letters.log`); не ROOT — 404.

## AC4. Колокольчик и Telegram владельцу кабинета — PASS
`ownerRequestNotify` после письма создаёт колокольчик в домашней организации владельца аккаунта кабинета (ссылка
`/exchange-request/<номер запроса>`, «Открыть запрос», кто и что просит, срок) и шлёт Telegram с кнопкой «Открыть
запрос» (`skipOnRerun` по ключу запроса); токен — только в письме; каждый канал отдельно, сбой не ломает запрос.
Текст — чистая функция `ownerRequestNotice` с тестом (экранирование чужих названий).

`raw/part3-foreign-check.log`, раздел «series A AC4»: колокольчик в домашней организации со ссылкой по номеру и без
токена; Telegram-сообщение записано (бота локально нет — статус failed); повторный вызов второго колокольчика не
создаёт; без привязанного Telegram — ничего не шлётся, ошибки нет. Вживую: колокольчик у владельца «Сеть Обед»
(`raw/04-owner-bell.jpg`).

## AC5. Долгий обмен — в фоне — PASS
`runDirectoryExchangeWithin` (`run.server.ts`) ждёт обмен до 8 с (`EXCHANGE_WAIT_MS`), иначе `running: true`, обмен
доходит в фоне (`after()` в маршрутах держит процесс). Так работают сохранение настроек, «Синхронизировать сейчас» и
подтверждение связи; письмо и колокольчик заявителю после подтверждения — после конца обмена, с итогом; `resultJson`
запроса — тоже после.

`raw/background-check.log` (14/14; «дольше ожидания» — нулевое ожидание `waitMs: 0`): ответ сразу с `running: true`,
итог потом во второй организации и в `lastSyncJson`; короткий обмен — с итогом, как раньше; подтверждение связи —
`running: true` без итога, письма до конца обмена нет, после — `resultJson`, продукты у заявителя, его карточка со
своим итогом и письмо «добавлено записей — 2». Вид (ответ сервера подменён в браузере): окно — «Обмен идёт — итог
появится в карточке «Обмен справочниками».» (`raw/02-dialog-running.jpg`), карточка — тост «Обмен идёт — итог
появится в карточке» и повторное чтение через 30 с (`raw/03-card-sync-running.jpg`), страница подтверждения
(`raw/05-confirmation-running.jpg`).

## AC6. Меню и сырьё кабинета — только явным подключением — PASS
`saveExchangeMembers` больше не вызывает подключение к меню и сырью кабинета (`connectToCabinetPool` удалён); уже
сделанные подключения не трогаются. В окне при «Товарах и блюдах» — строка «Меню и сырьё мастер-кабинета обмен не
подключает — это делается отдельно, в разделе «Мастер-кабинет».» (`raw/01-dialog-menu-note.jpg`).
`raw/part2-exchange-check.log`: «series A AC6: products in the exchange do not connect organizations to the cabinet menu
and raw materials». Вживую: после сохранения обмена у обеих организаций `linkedServiceCode` пуст, продукты дошли.

## AC7. Тексты и проверки — PASS
Ключи в ru/en/uz (`dashboardUi.directoryExchange.{dialog.menuSeparate, result.running, card.syncRunning,
foreign.page.approvedRunning}`, `rootMailingShellAudience.exchangeLetters.*`), `message-contract.d.ts` перегенерирован;
`npm run i18n:check` — 98/98; `npm run typecheck` — чисто; ESLint по изменённым файлам — 0 ошибок (2 старых
предупреждения про неиспользуемый `CRON_SECRET`). `npm run test:gate` — полный прогон (48 файлов кода): 6739 прошли,
1 упал — устаревшая `neutral-palette.css`; перегенерирована (`npm run palette:neutral`), тест палитры проходит.
Затронутые тесты отдельно — 81/81. Сквозные проверки: часть 2 — 88/88 (`raw/part2-exchange-check.log`), часть 3 —
179/179 (`raw/part3-foreign-check.log`).

## Что меняет выкат
Схема не меняется. Ежедневные задачи перестают создавать документы, задачи и напоминания закрытым организациям;
владельцы оплаченных аккаунтов начнут получать напоминания за 3 и 1 день до конца своих 14 дней дополнительной
организации; сохранение обмена больше не подключает организации к меню и сырью мастер-кабинета.

## После независимой проверки — PASS
- Две организации, созданные в один день, кончаются одновременно: проверка «закроется ли» не считала ни одну из них
  «раньше» и не напоминала младшей, хотя `orgTrialStatuses` закрывает её. Теперь очередь — как в `orgTrialStatuses`
  (по созданию, затем по id), у записей `orgTrials` есть `createdAt`; тест на этот случай и на продлённый срок.
- Тревога о молчащих офлайн-устройствах в shift-watcher тоже пропускает закрытые организации
  (`notifySilentOfflineDevices(now, locked)`).
- Кнопка Telegram в уведомлениях тарифа (`sendOwnerNotice`) получала относительный адрес, а web_app-кнопка принимает
  только полный https-адрес — теперь полный (касается и прежних уведомлений тарифа).
- Карточка при обмене в фоне перечитывается через 30 с и через 2 минуты.

## Известные ограничения
- Автоматические просьбы об отзыве (crm) живут в библиотеке и закрытые организации пока не пропускают.
- Пропущенный день с 3 оставшимися днями — ступень 3 не догоняется; ступень 1 уйдёт.
- Обмен в фоне при сбое пишет ошибку в лог; карточка показывает прежний итог, обмен повторится по расписанию.
