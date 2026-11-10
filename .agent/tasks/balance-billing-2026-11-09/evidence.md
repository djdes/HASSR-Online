# Evidence: оплата через внутренний баланс, как у мобильных операторов

Проверено 2026-11-09 на ветке `claude/confident-faraday-3pbaul` (локальная PostgreSQL 16, `prisma db push`,
`next dev`). Сценарии — `raw/billing-check.ts` (setup / job / card / topup), браузер — `raw/browser-check.js`.

## AC1. Оплата тарифа проходит через баланс — PASS

- `src/lib/balance/payment-ledger.ts` (ядро + обёртка), вызов в `completePaidOrder` (не на разборе) и в ROOT
  «Применено» (`/api/root/orders/[id]/resolve`).
- `raw/card-payment.txt`: заказ «Премиум, месяц, 3 точки» картой 14 970 ₽ → `+14970 [topup] Пополнение картой, заказ №2`
  и `−14970 [subscription_charge] Оплата тарифа: …, заказ №2`; баланс не изменился (10 000), срок +30 дней; повтор —
  `already`.
- Тест `payment-ledger.test.ts`: строки, порядок «кредит → дебет», идемпотентность, дописывание пары, отказы
  (пополнение, не оплачен, разбор, возврат, без организации, без денег).

## AC2. Автопродление с баланса — PASS

- `Account.autoRenew` (по умолчанию true; `prisma db push` добавил колонку, `raw` — вывод в чате сессии), чистая логика
  `auto-renew-core.ts`, база `auto-renew.server.ts`, шаг в `runBillingTransitionJob`, списание
  `createOrderPaidFromBalance` (ключ `autorenew:<аккаунт>:<срок>`).
- `raw/job-run-1.txt`: «Кафе» (Стандарт, месяц, 30 ч до конца, на балансе 3 500) — `auto-renewed from balance:
  order #1, 2990 ₽`, строка `−2990 [subscription_charge] Оплата тарифа с баланса…`, срок 11.11 → 11.12 (от старого конца),
  баланс 510 = сумма леджера. «ДК» (Премиум × 3 = 14 970, на балансе 10 000) — `auto-renew short … (notified)`.
- `raw/job-run-2.txt`: повторный запуск — `autoRenewed=0 autoRenewShort=0`, дублей нет.
- `raw/topup-renew.txt`: срок на исходе, пополнили +6 000 → сразу `renewed`, 16 000 − 14 970 = 1 030.
- Тест `auto-renew-core.test.ts`: окно 48 ч, грейс, 9 причин «не продлеваем», выбор плательщика, ключ.

## AC3. Управление — PASS

- `src/components/settings/auto-renew-card.tsx`, `PUT /api/settings/auto-renew` (руководитель, не «под видом», аудит,
  включили — пробуем продлить сразу), карточка в «Тариф и оплата».
- `raw/browser-check.txt`: «10 декабря нужно списать 2 990 ₽, а на балансе 510 ₽ — не хватает 2 480 ₽…», кнопки
  «Пополнить баланс», «Оплатить следующий период», «Детализация баланса»; переключатель → «Выключено: подписка
  закончится 11 декабря…» → обратно «on». `raw/02-auto-renew-on.png`, `raw/03-auto-renew-off.png`.

## AC4. Детализация — PASS

- `balanceDetail` (`constants.ts`), таблица «Дата · Операция · Кредит · Дебет · Остаток» и итоги «Поступило / Списано»;
  на телефоне — карточки (сумма рядом с операцией, «Кредит/Дебет», остаток), без прокрутки вбок.
- `raw/browser-check.txt`: заголовки, итоги «Поступило: 3 500 ₽ / Списано: 2 990 ₽», строки с остатком;
  `raw/01-balance-detail.png`, `raw/04-phone-balance-detail.png`. Тест итогов и остатков — `payment-ledger.test.ts`.

## AC5. Оповещения — PASS

- Продлено: чек-письмо `notifyAboutPayment` («Сумма: оплачено с баланса (2 990 ₽)»), колокольчик
  «Подписка продлена с баланса: −2 990 ₽», Telegram владельцу (`sendOwnerNotice`), админу — как при оплате.
- Не хватает: письмо и Telegram владельцу «не хватает 4 970 ₽ на продление» с кнопкой «Пополнить баланс»,
  колокольчик, аудит `billing.auto-renew.short` — раз на срок (`raw/job-run-1.txt`, `raw/job-run-2.txt`).
- Напоминания 7/3/1 день: строка `autoRenewReminderLine` («спишем … с баланса» / «не хватает … пополните»).
  Тексты — `auto-renew-core.test.ts`. Локально почта не настроена (SMTP пуст) — письма собраны, но не отправлены.

## AC6. Оферта — PASS (на проверку владельцу)

- `src/app/oferta/page.tsx` п. 6.10. `LEGAL_VERSION` не поднята: окно «Мы обновили условия» у всех руководителей —
  решение владельца.

## AC7. Ворота — PASS

- `npm run typecheck` — exit 0; `npm run test:gate` — pass=5922, fail=0; `npm run i18n:check` — exit 0;
  eslint изменённых — exit 0 (`raw/*.log`).
- Выкладка: `prisma db push` добавит `Account.autoRenew` (по умолчанию true) и `Account.autoRenewChangedAt` (null).
