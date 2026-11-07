# Evidence: CRM в панели платформы + роль РОП

Ветка `claude/peaceful-brown-tgkspp` от master `ce5615c`. Проверка — локальная PostgreSQL 16
(схема master → безопасное обновление `scripts/apply-safe-schema.cjs`), `next dev`, Playwright,
локальный SMTP-приёмник (`e2e/smtp-sink.py`). Живого IMAP-сервера в контейнере нет: адаптер
imapflow проверен типами и подменённой сессией, вся логика синхронизации — тестами и прогоном
по БД (`e2e/mail-ingest-check.ts`).

**Итог: все AC — PASS.**

| AC | Статус | Доказательство |
|---|---|---|
| AC1 Схема | PASS | `raw/schema-additive.sql`: 24 операции, только CREATE TABLE / CREATE INDEX / ADD COLUMN / ADD CONSTRAINT (`additiveSchemaSql` не бросил); после применения `prisma migrate diff` пуст; `prisma validate` OK |
| AC2 Доступ | PASS | `platform-access.ts`: `/root/crm`, `/api/root/crm` → `sales`; `/api/root/crm/mailboxes` POST/PUT/DELETE → `superadmin` (+ `requireSuperRoot` в маршрутах); крон — `checkCronSecret`. `platform-access.test.ts` (обход всех страниц и API) и `crm/rop.test.ts` зелёные; пункт «CRM» в меню (`raw/ui-check.txt`: `nav has CRM: 1`) |
| AC3 Отсев | PASS | `crm/mail-filter.test.ts` (7): каждое правило, порядок, allow > эвристика, block > принятие. Живой прогон нашёл и исправил ошибку: mailparser сворачивает `List-*` в объект `list` — заголовки теперь из сырых строк, регрессионный тест в `imap.test.ts`, `raw/mail-ingest-check.txt`: рассылка → `newsletter` |
| AC4 Склейка, состояние | PASS | `crm/identity.test.ts` (6), `crm/state.test.ts` (5); на БД: Иван (заявка + обращение + ответ + регистрация) — одна карточка, 4 записи, ждёт с заявки (`raw/cycle-check.txt`) |
| AC5 Источники | PASS | `crm/sources.test.ts` (5) — все 8 источников; `raw/cycle-check.txt`: прогон 1 — 11 записей, прогон 2 — 0, дублей `externalKey` — 0 |
| AC6 IMAP | PASS | `crm/imap.test.ts` (8): окно 30 дней, только новые UID, «N:*» без дубля, смена UIDVALIDITY + запоминание UIDNEXT, «Отправленные» только к известным, битое письмо не стопорит папку, рассылка по сырому `List-Unsubscribe`; `raw/mail-ingest-check.txt`: письмо клиента → контакт + уведомление РОП, автоответ/рассылка → «Отсеяно», повтор — 0, «Вернуть и всегда пропускать» → контакт + allow; пароль — `encryptSecret`, `MailboxView` без пароля |
| AC7 Напоминания | PASS | `crm/reminders.test.ts` (9); `raw/cycle-check.txt` + `raw/smtp-sink-cycle.txt`: утром 4 эскалации и сводка ушли РОП, повтор — 0, ночью — 0; не дошло ни до кого — ключ снимается (повтор в следующий прогон) |
| AC8 РОП | PASS | `crm/rop.test.ts` (5): аудитория `sales`, РОП требует «Продажи», снятие доступа снимает РОП, сид в деплое после выдачи админа, 7 заявочных уведомлений на `sales`. `raw/seed-crm-rop.txt`: dry-run → выдача (аудит, письмо) → «already done»; `raw/ui-check.txt`: метка РОП в команде, переключатель в окне сам отмечает «Продажи», снятие «Продаж» снимает РОП (`screens/09-team-rop-dialog.png`) |
| AC9 Экраны | PASS | `raw/ui-check.txt` + `screens/01…13`: сводка, «Обновить сейчас», очередь «Ждут ответа» (4), поиск, карточка — ответственный, следующий шаг, заметка, письмо клиенту (ушло, `email-out:` в ленте, «ждёт ответа» снят), «Ответ не нужен», стадия, «Добавить лид» (WhatsApp), правило стоп-листа, форма ящика; телефон — без горизонтальной прокрутки; ошибок консоли — 0 |
| AC10 Проверки | PASS | `raw/typecheck.txt` EXIT 0; `raw/test-gate.txt` 5822 pass / 0 fail; `raw/i18n-check.txt` 97 pass; `raw/eslint.txt` EXIT 0 по изменённым файлам; `docs/crm.md` — строка crontab и настройка Яндекс 360 |

## Что включится только после действий владельца

1. Строка crontab (`docs/crm.md`): `2-59/5 * * * * curl -s -m 280 -H "Authorization: Bearer $CRON_SECRET" https://wesetup.ru/api/cron/crm`.
   До неё CRM обновляется кнопкой «Обновить сейчас», напоминания и сводка не идут сами.
2. Ящик admin@wesetup.ru: «CRM → Почта и фильтры → Подключить ящик» с паролем приложения Яндекса.

## Что меняет деплой

Новые таблицы `CrmContact`, `CrmInteraction`, `CrmMailbox`, `CrmSenderRule`, `CrmReminderLog` и
колонка `User.platformSalesHead` (по умолчанию false) — `apply-safe-schema`. Однократный сид
делает alexey@wesetup.ru РОП и шлёт ему письмо/Telegram. Зависимости: `imapflow`, `mailparser`.
