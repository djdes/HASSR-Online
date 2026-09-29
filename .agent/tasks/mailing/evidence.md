# Evidence — mailing (ROOT «Рассылка»), ветка feat/mailing-2026-09-29

Стенд: рабочая копия `d:/wt/mailing`, база `wesetup_wt_mailing`, `next dev --webpack -p 3193`
(cwd строго `d:/wt/mailing`, `NEXT_DIST_DIR=.next-e2e`). В `.env` рабочей копии: `SMTP_HOST=""`,
`TELEGRAM_BOT_TOKEN` фиктивный, Firebase не задан, `MAILING_DRY_RUN_DIR=d:/wt/tmp-mailing/outbox`,
локальные VAPID-ключи (веб-push «настроен», но при сухой отправке запросы наружу не идут).
Наружу не ушло ни одного письма и сообщения: письма — файлы `.eml`/`.html`, push и Telegram — `.json`.

## Проверки

| Что | Результат |
|---|---|
| `npm run typecheck` | 0 ошибок |
| `npm test` (через `test:gate`, как в хуках) | 2902 pass / 0 fail |
| Юнит-тесты рассылки `src/lib/mailing/*.test.ts` | 66 / 66 |
| E2E `e2e/e2e.cjs` (1280 и 390) | 63 / 63 |
| E2E `e2e/retry.cjs` («Повторить неудачные») | 4 / 4 |

Сырые результаты: `evidence/results.json`, `evidence/results-retry.json`; письмо из папки сухой отправки —
`evidence/sample-email.eml` (заголовки) и `evidence/sample-email.html`.

## Критерии приёмки

### AC1 — PASS: пользователи (фильтры) и контакты → почта / колокольчик / push / Telegram, тест себе, план
- Контакты вставкой: предпросмотр «Новых 3 · Уже в базе 0 · В стоп-листе 1 · Дублей в файле 1 · Плохих адресов 1»,
  загрузка с «Источник» и «Основание», сфера «кафе» → `cafe` (`evidence/01-contacts-preview-1280.png`, `evidence/15-contacts-390.png`).
- Пользователи по фильтру: «Кафе / Кофейня» → 2 руководителя, «Выбрать всех найденных», плюс поиск «Колос»
  (`evidence/02-users-1280.png`, `evidence/14-users-390.png`).
- Все четыре канала с охватом: «Почта — дойдёт до 5 из 5», «Колокольчик — 3, контакты не получат»,
  «Push — 1 из 3 · веб-push у 1, приложение у 1 · Firebase не настроен — в приложение push не уходит»,
  «Telegram — 1 из 3» (`evidence/03-compose-1280.png`, `evidence/13-compose-390.png`).
- Предпросмотр письма для получателя с подставленными переменными и ссылкой отписки.
- Тест себе: «Почта: Отправлено (сухая отправка) · Колокольчик: Отправлено · Push: Пропущено — нет подписки ·
  Telegram: Пропущено — не привязан», отдельная строка `isTest`, файл письма в папке.
- Отправить сейчас → карточка; запланировать (время по Москве) → «Запланирована».
- Черновик: сохраняется кнопкой и перед тестом/запуском, открывается из «Истории» (`evidence/04-history-draft-1280.png`).

### AC2 — PASS: очередь с лимитом, стоп-лист, отписка, клики, история, повторы — в логах и аудите
- Лимит 2 письма в минуту: толчок после запуска отправил ровно 2, cron в ту же минуту — 0 (`limitedBy: minute`),
  через минуту — ещё 2, затем последнее и «Завершена» (время сдвигалось SQL-ом на 61 с).
- Письмо в папке: `List-Unsubscribe: <http://localhost:3193/api/mailing/unsubscribe/<token>>, <mailto:support@wesetup.ru?subject=unsubscribe%20<id>>`,
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, ссылка «отпишитесь» на `/unsubscribe/<token>`, все ссылки
  через `/r/<token>/<n>`.
- Клик: `/r/<token>/0?to=https://evil.example` → 307 на `https://wesetup.ru/pricing` (адрес только из сохранённого
  списка), `clickedAt` записан; неизвестный номер и поддельный токен → на главную.
- Отписка страницей (`06-`, `evidence/07-unsubscribe-*-390.png`) → стоп-лист `unsubscribed` + контакт «отписался»;
  one-click POST без страницы → `marketingOptOut`; GET по ссылке из заголовка ничего не меняет.
- Повторная рассылка тем же получателям: отписавшийся контакт — «пропущено», у Анны письмо пропущено
  («Адрес в стоп-листе»), колокольчик ушёл, остальным письма ушли.
- Отмена запланированной: рассылка «Отменена», получатель «отменено», письмо не ушло, cron после отмены ничего
  не отправил (`evidence/12-card-cancelled-1280.png`).
- Повторить неудачные: канал с ошибкой вернулся в очередь и ушёл, рассылка снова «Завершена»
  (`evidence/19-card-failed-1280.png`, `evidence/20-card-retried-1280.png`).
- История и карточка: счётчики, статусы по каналам с причинами (`evidence/05-card-1280.png`, `evidence/18-card-390.png`);
  стоп-лист с поиском и ручным добавлением (`evidence/08-stoplist-1280.png`, `evidence/17-stoplist-390.png`).
- Возврат подписки: переключатель «Новости и предложения на почту» в настройках уведомлений
  (`09-`, `evidence/10-notifications-*-1280.png`, `evidence/11-notifications-390.png`) и в профиле мини-приложения
  (`evidence/11b-mini-profile-390.png`).
- Аудит (организация platform): `mailing.contacts.import`, `mailing.campaign.test`, `mailing.campaign.launch`,
  `mailing.campaign.schedule`, `mailing.campaign.cancel`, `mailing.campaign.retry`, `mailing.suppression.add`,
  `mailing.settings.update`, `mailing.unsubscribe`, `mailing.optin`.
- Логи: `[mailing] campaign=<id> status draft → sending recipients=5`, `… scheduled → sending`, `… sending → done`,
  по получателю `recipient=<id> email=sent (dry-run)` / ошибки, `pass done {…}`, `dry-run email → <файл>`.
- Юнит: `queue.test.ts` — стоп-лист и `marketingOptOut` → skipped, идемпотентность (второй проход, зависший
  `sending`), до 3 попыток с паузой 1 и 5 минут, постоянный отказ и bounce → стоп-лист, лимит в минуту и в сутки
  по Москве, отмена посреди прохода, `prepare` один раз; `tokens-links-limits.test.ts` — подпись токенов,
  редирект только по сохранённым ссылкам.

### AC3 — PASS: точка расширения шаблонов
- `src/lib/mailing/templates.ts` — `MailingRecipientContext`, `RenderedMailing`, `MailingTemplate<P>` по спеке
  (+ необязательные `defaultPayload`, `validate`), `registerMailingTemplate`, `mailingTemplates`.
- «Сообщение» — `src/lib/mailing/kinds/message.ts`, зарегистрировано строкой в `src/lib/mailing/kinds/index.ts`.
- Поля формы — `src/components/mailing/fields/<kind>.tsx`, форма находит компонент по `kind`
  (`src/components/mailing/kind-fields.tsx`). Тест `kinds-consistency.test.ts`: у каждого типа есть компонент.

### AC4 — PASS: честные предупреждения и никаких реальных отправок
- Над загрузкой контактов: «Реклама по email — только с согласия получателя (38-ФЗ «О рекламе», ст. 18)…».
- Жёлтое предупреждение: «Рекламные письма уходят с noreply@wesetup.ru — если их пометят спамом, служебные письма
  (коды входа, счета) тоже начнут попадать в спам. Лучше отдельный адрес/домен.»
- Плашка «Сухая отправка…», в карточке — «Отправлено · сухая».
- SMTP пустой, Telegram-токен фиктивный (в Telegram запросов не было — сообщения в `.json`), Firebase не задан.

## Что заметил по стенду
- Диск D: портил файлы рабочей копии: каталог `.agent/tasks/mobile-cabinet-2026-09/e2e` («The file or directory
  is corrupted and unreadable») и ещё 49 файлов (5 исходников `src/app/api/**`, `.agent/tasks/*`, `pgdata/*`) —
  восстановлены из git, сверка по хэшам перед каждым коммитом. Испорченный каталог отложен в
  `d:/wt/tmp-mailing/corrupt/`.
- `next dev`, запущенный из `D:\wt\mailing` (заглавная), отдаёт 404 на новые API; из `d:/wt/mailing` — работает.
- `next dev` выгружает неактивные маршруты и при повторной компиляции может перезагрузить открытую страницу —
  e2e держит маршруты «живыми» фоновыми запросами. В проде этого нет.
