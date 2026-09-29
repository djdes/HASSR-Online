# План (mailing, ветка feat/mailing-2026-09-29)

Спека — `spec.md` рядом (копия `C:/wt/_orch/specs/mailing.md`). Рабочая копия `d:/wt/mailing`, база
`wesetup_wt_mailing`, стенд `next dev --webpack -p 3193`.

## 1. Схема (аддитивно, `prisma/schema.prisma`)
- `MarketingContact`: email @unique (нижний регистр), name?, company?, sphere? (код `ORG_SPHERES`), city?, phone?,
  tags String[], source, basis (обязательные), status active|unsubscribed|bounced|complained, lastSentAt?, note?,
  createdById?, даты.
- `EmailSuppression`: email @unique, reason unsubscribed|bounced|complained|manual, campaignId? (источник), note?,
  createdById?, createdAt.
- `User.marketingOptOut Boolean @default(false)` + обратная связь `mailingRecipients`.
- `MailingCampaign`: title, kind, channels Json, payload Json, audience Json (снимок фильтров и выбора), status
  draft|scheduled|sending|done|cancelled, scheduledAt?, startedAt?, finishedAt?, cancelledAt?, preparedAt?,
  lastError?, createdById?, createdByName?, счётчики total/queued/sent/failed/skipped/cancelled/click, даты.
- `MailingRecipient`: campaignId, userId?, contactId?, email?, name?, companyName?, sphere?, organizationId?,
  isTest, status queued|sent|failed|skipped|cancelled, по каналам `<канал>Status` (null = канал не для него,
  queued|sending|sent|failed|skipped) + `<канал>Error`, token @unique (подписанный), links Json (адреса ссылок
  письма — по ним `/r/<token>/<n>`), attempts, nextAttemptAt?, sentAt?, emailSentAt?, clickedAt?, clickCount,
  unsubscribedAt?, dryRun, payload Json? (персональные данные шаблона).

## 2. Чистые модули `src/lib/mailing/*` (тесты рядом)
- `templates.ts` — интерфейс по спеке (`MailingRecipientContext`, `RenderedMailing`, `MailingTemplate<P>` + необяз.
  `defaultPayload`, `validate`), `registerMailingTemplate`, `mailingTemplates`, `getMailingTemplate`.
- `templates/message.ts` — тип «Сообщение»; `templates/index.ts` — строка регистрации встроенных типов.
- `text-format.ts` — переменные `{имя}` `{компания}` `{сфера}` (+ `{имя|запасное}`), абзацы, `**жирный**`,
  `[текст](url)` и голые ссылки → HTML письма / текст / HTML Telegram; только http(s) и `/путь`.
- `csv.ts` — разбор CSV/вставки: кодировка UTF-8/Windows-1251, разделитель `;`/`,`/таб, кавычки, заголовки
  (синонимы), сопоставление колонок, проверка почты (`checkEmail`), дубли в файле, сфера по названию или коду,
  теги.
- `audience.ts` — фильтры пользователей (руководители/все, сфера, тариф, поиск, почта/Telegram/push, даты
  регистрации) как чистая функция над строками; адрес для рассылки пользователя (`contactEmail` или не служебный
  `email`).
- `tokens.ts` — токен получателя `<id>.<HMAC>` (секрет `MAILING_TOKEN_SECRET` → `NEXTAUTH_SECRET`).
- `rate-limit.ts` — настройка `PlatformSetting` `mailing.settings` (20/мин, 300/сутки по Москве), бюджет писем.
- `links.ts` — ссылка клика `/r/<token>/<n>`, разрешение адреса только по сохранённому списку.
- `queue.ts` — ядро очереди с подменяемыми хранилищем и отправителями: стоп-лист/отписка → skipped, лимиты,
  идемпотентность (queued → sending → sent|failed; зависший `sending` не повторяем), до 3 попыток с паузой,
  отмена, итоговые статусы и завершение кампании.
- `labels.ts` — русские подписи статусов/каналов/тарифов для клиента.

## 3. Сервер
- `transport.server.ts` — отправитель рекламы `MARKETING_SMTP_*`/`MARKETING_FROM`, иначе основной SMTP;
  `MAILING_DRY_RUN_DIR` или пустой SMTP → сухая отправка (.eml + .html в папку / только лог), заголовки
  `List-Unsubscribe` (https + mailto) и `List-Unsubscribe-Post`.
- `channels.server.ts` — отправители: письмо, колокольчик (`upsertNotification`, без двойного push), push (веб-push
  + приложение, честно «Firebase не настроен»), Telegram (`sendTelegramMessage`, тихие часы). При
  `MAILING_DRY_RUN_DIR` Telegram и push тоже не уходят наружу — пишутся `.json` в ту же папку.
- `store.server.ts` — Prisma-хранилище очереди; `service.server.ts` — черновики, аудитория, охват по каналам,
  предпросмотр, тест себе, запуск/план, отмена, повтор неудачных, контакты (предпросмотр/загрузка/правка/удаление),
  стоп-лист, отписка, клики, настройки скорости. Логи `[mailing] …`, аудит (организация platform).
- `upsertNotification` — необязательный `push: false` (колокольчик без второго push); `renderEmailLayout` —
  необязательные прехедер и подвал.

## 4. Маршруты
- ROOT API `/api/root/mailing/*`: audience/users, contacts (+preview, [id], delete), campaigns (+[id], launch,
  cancel, retry), preview, test, reach, settings, suppression.
- `/api/cron/mailing` (CRON_SECRET, раз в минуту) + толчок `after()` после запуска.
- Публичные: `/unsubscribe/[token]` (страница с одной кнопкой), `POST /api/mailing/unsubscribe/[token]`
  (one-click), `/r/[code]/[n]` (клик → `clickedAt` → адрес из сохранённого списка).
- `/api/notifications/marketing` — переключатель «Новости и предложения на почту».

## 5. Интерфейс
- `/root/mailing`: вкладки «Составление», «Пользователи», «Контакты», «История», «Стоп-лист»; предупреждения
  38-ФЗ и отдельного отправителя; настройки скорости и «сегодня отправлено»; `/root/mailing/[id]` — карточка.
- Поля типа — `src/components/mailing/fields/<kind>.tsx` (default export), грузятся по `kind`:
  новый тип = файл шаблона + компонент полей + строка `registerMailingTemplate(...)` в `templates/index.ts`
  (тест сверяет, что у каждого типа есть компонент).
- Пункт «Рассылка» в меню ROOT; подписи действий в `/root/audit`.
- Переключатель «Новости и предложения на почту» — `/settings/notifications` и профиль мини-приложения.

## 6. Проверка
- Юнит: CSV, фильтры, переменные, токены, лимиты, стоп-лист/отписка → skipped, идемпотентность и повторы,
  редирект только по сохранённым ссылкам, соответствие типов и компонентов.
- E2E (390 и 1280, Playwright headless, выхлоп в `d:/wt/tmp-mailing`): вставка контактов, фильтр пользователей,
  сообщение во все каналы, тест себе, запуск → cron с лимитом → статусы, письмо в папке с отпиской и заголовками,
  отписка → повторная рассылка пропускает адрес, клик → `clickedAt`, отмена кампании.
- `npm run typecheck`, `npm test` (gate), `evidence.md` + скриншоты.
