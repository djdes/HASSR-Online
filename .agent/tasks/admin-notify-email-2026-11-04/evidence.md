# Evidence — admin-notify-email-2026-11-04

## Исходное состояние (прод, 2026-11-04, только чтение)
- Администраторы платформы: 1 активный ROOT (`adm…@wesetup.ru`), Telegram не привязан; делегированных
  с пресетом «Администратор» нет.
- `PLATFORM_ADMIN_TELEGRAM_CHAT_ID` — 1 чат; `PLATFORM_ADMIN_EMAIL` не задан → письма об обращениях
  никуда не уходили; регистрации/оплаты/сбои писем не имели вовсе.

## Изменения
- `src/lib/platform-access.ts` — `isPlatformAdministrator` (isRoot или все разделы панели).
- `src/lib/platform-admin-mail.ts` (новый, чистый) — адресаты без дублей (`*.local` и мусор отброшены),
  письмо из текста Telegram-уведомления (тема = первая строка, безопасный HTML).
- `src/lib/platform-admin.ts` — `getPlatformAdministrators` (кеш 60 с), `getPlatformAdminEmails`,
  `getPlatformAdminRecipientChatIds`, `isPlatformAdminChat`, `sendToPlatformAdminEmails`;
  `notifyPlatformAdmin` шлёт Telegram (env + администраторы) и общее письмо (кроме `email: false`).
- Свои подробные письма всем администраторам, без второго общего: обращения сайта и гостей, виджет,
  бот, онлайн-чат (ветка партнёра — без письма), демо-показ, заявка на услугу, проверка связи.
- Вложения обращений — во все Telegram-чаты админов; ответ свайпом — из чата любого администратора.
- Недельное «Здоровье клиентов» — всем администраторам.
- Панель `/root/feedback` показывает всех адресатов (маски).

## Проверки
См. `evidence.json` и `raw/`.
