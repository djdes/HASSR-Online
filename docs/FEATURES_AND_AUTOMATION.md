# WeSetup — Features & Automation Roadmap

> **Файл-инструкция для будущих сессий Claude.** Если ты только зашёл в проект — прочитай этот файл целиком, выбери ОДНУ задачу из «Pending tasks», реализуй её, запушь в прод (см. workflow ниже) и удали её из этого файла тем же коммитом. Не делай несколько задач за раз — лучше одна выкаченная и протестированная, чем три полу-готовые.

## 0. Project context (read first)

**WeSetup** — Next.js 16 SaaS для электронных журналов СанПиН и ХАССП на пищевых производствах (рестораны, пекарни, мясокомбинаты, школьные столовые, тёмные кухни). Работает в связке с **TasksFlow** (отдельное Express+React приложение по адресу `c:\www\TasksFlow`, репо `djdes/TasksFlow`, домен `tasksflow.ru`) — TF используется как «mobile-first» очередь задач для рядовых сотрудников.

### Stack
- **Frontend/Backend:** Next.js 16 App Router, TypeScript strict, Tailwind, shadcn/ui, Prisma ORM, PostgreSQL.
- **Auth:** NextAuth.js 4 (JWT), Telegram-провайдер для Mini App.
- **Telegram:** grammy framework, bot `@wesetupbot`, webhook + Mini App.
- **AI:** `@anthropic-ai/sdk` v0.78, модели `claude-haiku-4-5-20251001` (чат) и `claude-opus-4-7` (тяжёлые задачи). Env: `ANTHROPIC_API_KEY`.
- **IoT:** `@tuya/tuya-connector-nodejs` для Tuya-датчиков. Env: `TUYA_BASE_URL`, `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`.
- **Email:** Resend. Env: `RESEND_API_KEY`.
- **PDF:** jspdf + jspdf-autotable.
- **Deploy:** GitHub Actions `.github/workflows/deploy.yml` → push в `master` → SSH в `wesetup.ru`, restart PM2-процесса `haccp-online` на порту 3002.
- **Cron:** ВНЕШНИЙ scheduler (cron-job.org или server crontab) дёргает `GET /api/cron/<name>?secret=$CRON_SECRET`. У Vercel-style cron'ов нет — runtime self-hosted.

### Структура папок (ключевое)

```
src/
  app/
    (auth)/      — login, register, invite (публичные)
    (dashboard)/ — /journals, /dashboard, /settings (NextAuth-protected)
    (root)/      — ROOT-only platform pages (/root/*)
    mini/        — Telegram Mini App
    inspector/   — public read-only портал инспектора (token-auth)
    task-fill/   — public fill-form для TasksFlow задач (HMAC-token)
    api/
      cron/      — все cron-routes; защита через ?secret=$CRON_SECRET
        compliance/    — ежедневное напоминание о пропущенных журналах
        expiry/        — алерт о приближении сроков годности
        mini-digest/   — ежедневная сводка для воркеров
        tuya-pull/     — почасовая синхронизация датчиков (HOURLY)
        weekly-digest/ — понедельничная сводка для управления
      ai/sanpin-chat/  — POST chat-помощника по СанПиН/ХАССП
      external/        — публичный API для IoT-датчиков (token-auth)
      inspector/       — public PDF endpoint
      integrations/tasksflow/  — sync, bulk-assign, webhooks
      task-fill/       — submit handler для public task-fill page
  lib/
    tasksflow-adapters/  — адаптеры журналов под TasksFlow задачи
    tuya.ts              — Tuya API клиент
    inspector-tokens.ts  — генерация/хеш read-only токенов
    onboarding-presets.ts — пресеты по типу заведения
    today-compliance.ts  — расчёт «выполнено сегодня»
    telegram.ts          — bot helpers (sendMessage, notifyOrganization)
    pdf.ts, document-pdf.ts — PDF-генерация
prisma/schema.prisma     — единый файл схемы (~1100 строк)
docs/                    — этот файл и архитектурные планы
```

### Соглашения проекта

- **Коммиты на русском.** После каждого коммита `git push origin master`. Формат: краткое описание, без эмоджи в первой строке. Расширенный body с «что/зачем/как» допустим.
- **Не свайпать локальные scratch-файлы** в коммиты. Стейджить конкретные пути: `git add path/to/file1 path/to/file2`.
- **Type-check перед коммитом:** `npx tsc --noEmit --skipLibCheck`. Должно быть пусто.
- **Lint:** `npm run lint`. Должно быть пусто.
- **Build не обязателен локально** — deploy.yml делает на сервере.
- **Prisma:** при изменении schema — `npx prisma generate` чтобы перегенерить клиент. На сервере `prisma db push` отрабатывает в deploy.yml.
- **Skills (см. `.claude/skills/`):** перед UI-правками — `wesetup-design`, перед бизнес-логикой — `superpowers:brainstorming`, перед debug — `superpowers:systematic-debugging`. Используй их прежде чем кодить.
- **Auto-memory** (`.claude/projects/c--www-Wesetup-ru/memory/`): читай при старте, пиши при получении standing-instructions от пользователя.

### Production endpoints
- **Site:** https://wesetup.ru
- **Path:** `/var/www/wesetupru/data/www/wesetup.ru/app`
- **PM2 process:** `haccp-online` на порту 3002
- **SSH (для проверки логов):** `wesetupru@wesetup.ru:22` пароль `<WESETUP_SSH_PASSWORD из .env>`. Команда:
  ```bash
  plink -batch -hostkey "ssh-ed25519 255 SHA256:NwU1dGS29JAjs2K5LfEtu3DLFgg04yo7ZEA4iOGkM6E" -P 22 -l wesetupru -pw "$WESETUP_SSH_PASSWORD" wesetup.ru "pm2 logs haccp-online --lines 50 --nostream --err"
  ```

### TasksFlow context

Для задач, затрагивающих TF — отдельный repo `c:\www\TasksFlow`. Стек: Vite + React + Express + Drizzle + MySQL/Postgres. Деплой через `npm run build` + custom SSH workflow. Branch — `main` (не `master`). Коммиты тоже на русском, после коммита `git push origin main`.

---

## 1. Workflow для Claude

Каждая задача из «Pending tasks» имеет:
- **Title** — короткое имя
- **Goal** — что считается «сделано»
- **Сложность** — S / M / L / XL (приблизительная оценка времени)
- **Hints** — куда смотреть, какие файлы трогать
- **Acceptance** — формальные критерии готовности

**Workflow:**

1. Прочитай этот файл целиком.
2. Выбери задачу из «Pending tasks» — приоритизируй по верхней категории + меньшей сложности при прочих равных.
3. Если задача неясная или требует архитектурных решений — invoke `superpowers:brainstorming` skill для уточнения scope, прежде чем кодить.
4. Реализуй её. Используй `TodoWrite` для tracking прогресса в процессе.
5. **Type-check** + **lint** перед коммитом.
6. Коммит на русском с body `что/зачем/как`. **Сразу `git push origin master`** (или `main` для TasksFlow).
7. Тем же коммитом — **удали выполненную задачу из этого файла**, перенеси её краткой строкой в «Recently shipped» с датой и SHA коммита.
8. Если по ходу работы нашёл побочные баги — НЕ чини их в этом коммите, занеси новой задачей в этот файл с пометкой `[discovered]`.
9. Если задача оказалась XL и ты её разбил — оставь parent-задачу в файле, добавь `[partial: <что-сделано>]` пометку, не удаляй до полного закрытия.

---

## 2. Recently shipped (не делать заново)

> **Ночь 2026-04-26 → 2026-04-27:** одной автономной сессией закрыто 12 фич — Yandex.Disk auto-backup, per-org metrics dashboard, «закрытый день», AI-подсказки в CAPA, авто-offboarding, shift-watcher, auto-escalation TasksFlow, compliance heatmap, IoT real-time CAPA, DIY-датчики ESP32, Mini App onboarding-тур, 1С-выгрузка списаний. SHA каждой — в таблице ниже. После batch'а оказалось, что часть деплоев упала из-за наложений SSH-сессий (несколько pushей подряд → старый `tar`/`npm ci` ронялся новым); финальная сборка `4548c9d` (=HEAD) успешно прошла, prod на ней. Дальнейшие батчи держать с паузой ≥3 мин между пушами или одним коммитом.

| Дата | SHA | Что |
|---|---|---|
| 2026-09-10 | — | **SaaS-пакет 2** — NPS (`NpsResponse`, `User.npsAskedAt`; баннер руководителю раз в 90 дней с 14-го дня организации на сайте и в Mini App, `POST /api/nps`, ROOT `/root/nps`, правила `src/lib/nps.ts` с тестами); тихие часы (`notificationPrefs.quietHours`, `src/lib/quiet-hours.ts` с тестами: не-срочные Telegram-сообщения для конкретного человека сохраняются как `TelegramLog.status="deferred"` с `deliverAfter`, крон `telegram-deferred` каждые 5 мин отправляет; срочные виды — температура/отклонения/инциденты — сразу); самоудаление организации (`Organization.deletionRequestedAt`, `POST/DELETE /api/settings/organization/deletion` с подтверждением названием, письмо руководству, баннер в кабинете и Mini App, крон `purge-deleted-orgs` раз в сутки удаляет после 30 дней); выгрузка всех журналов (`GET /api/settings/export-journals?from&to` → ZIP: PDF+XLSX по документам и XLSX по полевым журналам, `src/lib/journals-archive.ts`, карточка в «Настройки → Бэкап», лимит 200 документов и 5 выгрузок за 10 минут). |
| 2026-09-10 | — | **SaaS-пакет 1** — вход по ссылке из письма (`MagicLinkToken`, `POST /api/auth/magic-link` всегда 200, `GET /api/auth/magic/<token>` → сессия, 15 мин, одноразово; при включённом коде в Telegram — отказ с подсказкой; `LoginMethod` «magic»); исходящие вебхуки (`Webhook`, `WebhookDelivery`, `src/lib/webhooks/*`: подписки на события journal.entry / journal.deviation / capa.created / payment.paid / idea.status, HMAC `X-WeSetup-Signature`, повторы 1/5/30 мин кроном `webhooks-deliver` каждую минуту, страница `/settings/webhooks`, тест-доставка; legacy `Organization.webhookUrls` и `dispatchWebhooks` не тронуты); история аптайма (`UptimeSample`, крон `uptime-sample` каждые 5 мин, полоска 90 дней на `/status`, `uptime` в `/api/status`); публичная страница `/developers`; ROOT `/root/health` (`src/lib/root-health.ts`, тесты) и письмо ROOT по понедельникам из крона weekly-digest (`?rootHealth=1&to=` для проверки). |
| 2026-09-10 | — | **SEO-пакет 2** — городские лендинги `/v/<city>` (`src/content/cities.ts`, 15 городов, Service+FAQ JSON-LD), глоссарий `/glossary` и `/glossary/<slug>` (`src/content/glossary.ts`, 60+ терминов, DefinedTerm), сравнения `/compare/<slug>` (`src/content/comparisons.ts`: бумага, Excel, 1С; Article+FAQ), калькуляторы `/calc/journals` (`src/lib/seo/journal-picker.ts`) и `/calc/fines` (`src/lib/seo/fines.ts`, КоАП 6.3/6.6/14.43/14.8), всё в sitemap и в подвале сайта. Публичная страница бейджа ссылается на нишевый лендинг по сфере (`src/lib/badge/niche-link.ts`). ROOT `/root/seo` (`POST /api/root/seo-health`): обход адресов sitemap на самом сервере, проблемы title/description/canonical/h1/og:image/дубли/битые ссылки/медленные (`src/lib/seo/health.ts` — чистые правила с тестами, `crawl.ts` — обход, кэш час). |
| 2026-09-10 | — | **SEO-пакет 1** — `/og?t&s&k` (ImageResponse, публичный кэш сутки, `src/lib/og-image.ts`): свои OG-картинки у статей блога, каталога журналов, фич, SEO- и нишевых лендингов; `HowTo` JSON-LD на `/journals-info/<code>` из `FILLING_GUIDES`; `AggregateRating`+`Review` в SoftwareApplication главной из одобренных отзывов (≥3 с оценкой, `src/lib/seo/aggregate-rating.ts`); RSS `/blog/feed.xml` и `/whats-new/feed.xml` (`src/lib/rss.ts`), `alternates.types` в метаданных; автопост новой статьи в канал при `TELEGRAM_BLOG_CHANNEL_ID` (`src/lib/blog-announce.ts`). Публичная история изменений `/whats-new` из `src/content/changelog.ts`, ссылки из модалки «Что нового» и раздела «Идеи». |
| 2026-09-10 | — | **Публичный бейдж** — `Organization.badgeEnabled` + `badgeCode` (10 символов, `@unique`). Карточка в «Настройки → Организация» (`PublicBadgeCard`, `GET/PATCH/POST /api/settings/badge`: включить — код создаётся при первом включении, перевыпустить, выключить). Публично: `/b/<code>` (обезличенная страница: организация, сфера, процент заполнения журналов за 30 полных дней, без сотрудников и записей) и `/b/<code>/badge.svg` (плоский бейдж, `Cache-Control: public, max-age=900`; выключенный или чужой код — 404 с серым «нет данных»). Процент: `getTemplatesFilledToday` по дням, кэш 15 мин в памяти (`src/lib/badge/status.ts`); рисование и коды — `src/lib/badge/render.ts` (тесты). Ссылка в профиле Mini App. |
| 2026-09-10 | — | **Идеи и голосование** — модели `Idea` (organizationId, authorId, title, description, status new/planned/in_progress/done/declined, votes-кэш, adminNote, statusChangedAt) и `IdeaVote` (@@unique ideaId+userId). Раздел `/ideas` (руководство; пункт «Идеи» в шапке и в командной палитре): популярные/новые, открытые/сделано/все, «Предложить идею» (5 в сутки на организацию, автор голосует сразу), голос переключается (`POST /api/ideas/[id]/vote`, транзакция), по сделанным и отклонённым голосование закрыто; чужие организации не показываются. ROOT `/root/ideas` (`GET /api/root/ideas`, `PATCH /api/root/ideas/[id]`): статус и комментарий, при смене статуса автору — уведомление в кабинет (`upsertNotification`, kind `idea.status`). Правила в `src/lib/ideas/rules.ts` (тесты). Ссылка в профиле Mini App. |
| 2026-09-10 | — | **Еженедельный отчёт на почту** — крон `/api/cron/weekly-digest` теперь дёргается каждый час (crontab `0 * * * *`), а отправка — в понедельник 08:00 по `Organization.timezone`, не чаще раза в 6 дней (`weeklyDigestSentAt`; `src/lib/weekly-digest/schedule.ts`, тесты). Сборка данных в `src/lib/weekly-digest/build.ts`: заполнено/пропущено, TasksFlow, `TemperatureDeviationIncident` за неделю, «не отмечались» (активные сотрудники без записей в журналах здоровья, если журналы ведутся), «истекает за 14 дней» из календаря сроков. Письмо (`render.ts`, общий шаблон) — руководителям с настоящей почтой, у которых не выключен `notificationPrefs.weeklyDigest` (переключатель в «Настройки → Уведомления»); Telegram-сводка — как раньше. Проверка: `?orgId=<id>&force=1&to=<email>`. |
| 2026-09-10 | — | **iCal-календарь сроков** — `User.calendarToken` (личный, `POST/DELETE /api/settings/calendar-token`, только руководство), лента `GET /api/calendar/<token>.ics` без сессии (лимит 30/мин на токен, 404 при неизвестном или отключённом). События на весь день из `src/lib/calendar/sources.ts` (тесты): окончание подписки, медосмотры и прививки из журнала медкнижек (`JournalDocumentEntry.data`), поверки из документа `equipment_calibration` (последняя + интервал), `StaffCompetency.expiresAt`, открытые `CapaTicket.dueDate`, не списанные `Batch.expiryDate`; окно — месяц назад и год вперёд. Сборка RFC 5545 в `src/lib/calendar/ics.ts` (экранирование, перенос строк по 75 байт, стабильные UID). Страница `/settings/calendar`: ссылка, «Скопировать / Перевыпустить / Отключить», инструкции для Google, iPhone/Mac, Outlook, превью событий на 90 дней; карточка в хабе («Интеграции»), ссылка в профиле Mini App. |
| 2026-09-10 | — | **Черновики форм журналов** — `DynamicForm` с `draftScope` (id пользователя, передают страницы `/journals/[code]/new` и `/mini/journals/[code]/new`) хранит незавершённую запись в localStorage (`wesetup.journal-draft.<user>.<code>`, 48 ч): автосохранение через 600 мс только после правки человеком (подстановки формы черновиком не считаются), метки снимков без связи в черновик не попадают; при открытии — баннер «Есть незаконченная запись: Продолжить / Начать заново»; после принятой записи или постановки в офлайн-очередь черновик стирается. Правила в `src/lib/form-draft.ts` (тесты), хук `src/lib/use-form-draft.ts`. |
| 2026-09-09 | — | **Код в Telegram при входе** — `User.twoFactorTelegram` (только с привязанным `telegramChatId`; `PATCH /api/security/two-factor`), `LoginChallenge` (одноразовый, 5 минут, 5 попыток, хеш кода солится id — `src/lib/login-challenge.ts`, тесты). `/api/auth/login` и `/api/mini/login` после верного пароля отвечают `{ requiresCode, challengeId }` вместо сессии (`lib/two-factor.ts`: гасит прежние челленджи, шлёт код `sendTelegramMessage`); `POST /api/auth/login/code` проверяет и выдаёт сессию тем же `issueSession` (лимит 15/5 мин на IP). Формы входа на сайте и в Mini показывают шаг с кодом. Вход через Telegram кодом не подтверждается. |
| 2026-09-09 | — | **Безопасность аккаунта** — `LoginEvent` (кто/когда/откуда/с чего; `deviceKey` = sha256 семейства браузер+ОС из `src/lib/login-device.ts`, версии браузера не плодят «новые устройства»; тесты) пишется из единого `recordLogin` (`lib/login-trace.ts`: все точки входа — пароль, телефон, Telegram). Новое устройство после первого входа → письмо `sendNewDeviceLoginEmail` + Telegram `notifyEmployee`, best-effort. «Завершить все сессии»: `User.sessionVersion` + claim `sv` в JWT (`issueSession`, jwt-callback); проверка в `server-session.ts` и в session-callback (`lib/session-version.ts`, кеш 60 с на пользователя); `POST /api/security/logout-all` увеличивает версию и чистит куки текущего браузера. Страница `/settings/security` (+ карточка в хабе настроек, ссылка из профиля Mini). |
| 2026-09-09 | — | **Статус сервиса и объявления** — `PlatformSetting` `platform.status` (`src/lib/platform-status.ts`: баннер `Announcement` с окном показа и `Incident[]`; чистые `isAnnouncementActive`, `serviceState`, тесты). Публичные `GET /api/status` (база, сборка `.build-sha`/`.build-time`, аптайм, Telegram-бот через `/api/telegram/health` с таймаутом 3 с, объявление, инциденты; 503 без базы) и страница `/status`. `AnnouncementBanner` в `(dashboard)/layout.tsx` и `mini/layout.tsx` (серверное чтение → клиент, закрытие запоминается по id в localStorage; новый текст = новый id). ROOT `/root/status` (`GET/PUT /api/root/status`): баннер с превью, инциденты «открыть/решено». |
| 2026-09-09 | — | **Промокоды** — модель `PromoCode` (код в верхнем регистре, `percent`/`fixed`, окно действия, `maxUses` по **оплаченным** заказам, `newClientsOnly` — без оплаченных заказов у организации), поля `PaymentOrder.promoCode`/`discountRub`. Правила чистые: `src/lib/promo/rules.ts` (`validatePromo`, `computeDiscountRub` — от цены подписки, не оборудования; тесты), сервер `service.ts` (`resolvePromo`). `POST /api/promo/check` (лимит 20/10 мин на IP) — тот же расчёт, что при создании заказа; `robokassa/create` принимает `promoCode`, уменьшает `grossRub`/`subscriptionRub`, дописывает в `description`; неподходящий код — 400, а не тихая оплата без скидки. ROOT: `/root/promo-codes` (создать, включить/выключить; `GET/POST /api/root/promo-codes`, `PATCH …/[id]`). Страница `/order`: поле «Промокод», строка скидки в итоге. Скидка попадает в описание строки УПД. Счета по безналу — без промокодов (пока). |
| 2026-09-09 | — | **Счёт на оплату по безналу** — `PaymentOrder.paymentMethod` (`card` | `invoice`) + `invoiceDueAt` (7 дней). `src/lib/invoices/`: `build.ts` (чистая сборка: строки по каталогу, «период — с даты оплаты», `invoiceRequisitesReady` = реквизиты + банк + подписант, без картинок), `pdf.ts` (jsPDF портрет: таблица банка получателя, стороны, строки, итог, прописью, подписи с факсимиле/печатью), `service.ts` (`createInvoiceOrder` — один pending-счёт на организацию, нужен ИНН покупателя; `renderInvoice`; `deliverInvoice` — письмо с PDF + Telegram админу; `markInvoicePaid` — pending→paid одним `updateMany`, затем `completePaidOrder` как после кассы; `cancelInvoice`). API: `POST /api/payments/invoice`, `GET /api/payments/invoice/[id]/pdf`, `POST /api/root/orders/[id]/mark-paid`, `POST …/cancel`. UI: карточка «Оплата по безналу для юрлиц» на `/settings/subscription`, статусы через `orderStatusLabel`, «Счёт (PDF)» в колонке документов, в ROOT-карточке — «Оплата поступила» / «Отменить» (ConfirmDialog). Баллы к счёту не применяются. |
| 2026-09-09 | — | **Закрывающие документы (УПД) с факсимиле** — модель `ClosingDocument` (снимок продавца/покупателя/строк на момент выпуска, один на заказ, `status issued|voided`); чистая сборка `src/lib/closing-documents/build.ts` (номер = `PaymentOrder.id`, дата = `paidAt`, сумма = деньги, баллы — скидка в описании, оборудование из `bundleConfig` строками по `hardware-pricing`, при нехватке денег — пропорционально), PDF `pdf.ts` (jsPDF, A4 альбомный, УПД статус 2 «Без НДС» — ООО «БФС» на УСН, форма ММВ-20-3/96@, факсимиле и печать PNG с сохранением пропорций), сервис `service.ts` (`ensureClosingDocument` лениво — и для старых оплат, `renderPdf`, `voidClosingDocument` при `markOrderRefunded`, `refreshClosingDocumentBuyer`). Реквизиты и картинки — ROOT-страница `/root/requisites` (`PlatformSetting` key `legal.requisites`, файлы в приватном `LEGAL_DIR`, не в `public/` и не в `uploadsDir()` — тот отдаётся без авторизации); документ выпускается только при полном чек-листе. Кабинет: колонка «Документы» в `/settings/subscription` и ROOT-карточке организации, `GET /api/closing-documents/[orderId]/pdf` (своя организация с полным доступом или ROOT), `POST …/refresh-buyer`. Письмо «Оплата получена» несёт `UPD-<n>.pdf` вложением (`EmailAttachment.content`) и абзац об оригинале/ЭДО. Тесты: строки/суммы/период/сумма прописью/чек-лист. |
| 2026-09-09 | — | **Живой сервис везде: журналы → дашборд, чат «печатает», индикатор связи (сайт + Mini App)** — событие `journal/changed` рождается одним расширением Prisma в `src/lib/db.ts` (`$allOperations` на `JournalEntry`/`JournalDocumentEntry`/`JournalDocument`, чистая часть в `src/lib/journal-change-events.ts`: подсказки из args/result → org+code через кеш → коалесцирование ≤1 кадр/400 мс на организацию), поэтому все ~40 путей записи, кроны, TasksFlow-адаптеры и IoT покрыты без правок. Клиент: `useLiveRefetch` (`src/lib/use-live-refetch.ts`, тротлинг 2,5 с, скрытая вкладка → перечитать при возврате, фильтр по кодам) и `<LiveRefresh>` (`router.refresh()` на `/dashboard`, `/journals`, `/journals/[code]`); клиентские экраны (`control-board`, `journals-progress`, `verifications`, `/mini`, `/mini/journals/[code]`) перечитывают свой API. Чат: `postClientMessage`/`postOperatorMessage` публикуют `support/message` (ROOT-пользователям + участникам партнёра / организации), ROOT получает in-app уведомление `support.message` → `/root/feedback`; «печатает…» — `POST /api/support/chat/typing` и `/api/root/support/threads/[id]/typing`, эфемерно, `src/lib/support-typing.ts`. Индикатор «Нет связи с сервером» — `LiveConnectionIndicator` (шапка сайта и Mini), состояние из `useLiveConnection` (`down` ≠ `closed`: 401 без сессии — не обрыв), порог 60 с в `src/lib/live-connection.ts`. Редакторы документов намеренно не обновляются по событию — локальное состояние правок. |
| 2026-09-09 | `d0eeba68` | **Живые события: уведомления, баланс и чат без перезагрузки** — SSE-поток `GET /api/live` (`src/app/api/live/route.ts`, одно соединение на вкладку, `X-Accel-Buffering: no`, пульс 25 с, `retry: 3000`) поверх шины в памяти процесса `src/lib/live-events.ts` (`publishToUser` / `publishToOrganization`; PM2 fork с одним воркером — при cluster менять на Postgres NOTIFY/Redis). Событие — сигнал «перечитай», а не данные: при каждом переоткрытии клиент получает `reconnect` и перечитывает всё, поэтому деплой ничего не теряет. Клиент `src/lib/use-live-events.ts` (`useLiveEvents(handler)`, singleton `EventSource`). Слушают колокольчик, `/settings/balance` (тост «Начислено/Списано N ₽») и чат поддержки; прежние опросы оставлены страховкой. `upsertNotification` публикует сам; пополнение баланса ROOT'ом создаёт уведомление руководству `balance.credited/debited` + событие `balance` всей организации. Починен «Открыть чат» из панели: `?support=chat` читается через `useSearchParams`, из панели чат открывается на месте через `openSupportChat()`. Проверено на проде: события < 1 с, nginx поток не буферизует. |
| 2026-09-05 | — | **Пауза за неактивность: 100 дней + предупреждения** — cron `/api/cron/auto-pause-inactive` (INFRA: ежедневно 07:00 MSK, `?dryRun=1` для проверки) переписан: порог `INACTIVITY_PAUSE_DAYS = 100`, письма руководству (`src/lib/inactivity-emails.ts`) и Telegram за 30/14/7/3/2/1 день до паузы, дедуп по `Organization.inactivityWarnedStage` + `inactivityWarnedForActivityAt` (новая запись начинает серию заново), чистый планировщик `src/lib/inactivity.ts` (`decideInactivity`, тесты). При паузе — письмо, `pausedFromPlan`, баннер на дашборде (`PausedBanner`); возврат — карточка на `/settings/subscription` → `POST /api/settings/subscription/resume` (`inactivityResumedAt` — новая точка отсчёта). Кроны `journal-automation` и `auto-create-journals` пропускают `paused`/`cancelled`. **Мобильная вёрстка:** удалено глобальное правило `flex-wrap` для `.app-shell main .flex.gap-3..6` (globals.css) — перенос теперь объявляется на панелях кнопок явно (52 места). |
| 2026-09-05 | — | **Убран тестовый период и все лимиты бесплатного тарифа** — удалены `src/lib/trial.ts`, `src/lib/trial-limits.server.ts`, `TrialStatusCard`/`TrialExpiredModal`, `POST /api/settings/subscription/trial-decision`, cron `/api/cron/reset-ai-quota`; из всех write-эндпоинтов убраны `trialWriteGate`/`trialSensorGate`/`consumeTrialWrite`, из AI-чата и CAPA-подсказок — месячная квота (`Organization.aiMonthlyMessagesLeft/aiMonthlyQuota` и `trialWritesDayKey/trialWritesCount` удалены из схемы, deploy делает `prisma db push --accept-data-loss`). Единственное правило бесплатного тарифа — «до `FREE_MAX_USERS` (3) сотрудников» (`ensurePlanForHeadcount`). Дефолт `subscriptionPlan` — `free`; старое значение `trial` читается как legacy-alias бесплатного (`isFreePlan`, `PLAN_CATALOG.matches`), из ROOT-формы и whitelist API убрано. Миграция данных — `scripts/migrate-trial-to-free.ts` (dry-run по умолчанию, `--apply`: Account/Organization `trial → free`, `subscriptionEnd: null`). `formatDaysRu` переехал в `src/lib/format-days.ts`. Копирайт витрин — `FREE_PLAN_NOTE` («Бесплатно до 3 сотрудников, без ограничений по записям»). `BILLING_TEST_MODE` и его «тестовый режим» не тронуты. |
| 2026-09-03 | — | **Баланс баллов организации, рефералы и отзывы за баллы** — `Organization.balanceRub` (1 балл = 1 ₽) + леджер `BalanceTransaction` с идемпотентностью по `dedupeKey` (`src/lib/balance/ledger.ts`: списание условным `updateMany … balanceRub >= N`, поэтому в минус не уходит). Списание — только за подписку, потолок `tariff.priceRub`; холд при СОЗДАНИИ заказа (`src/lib/balance/checkout.ts`), возврат при оформлении нового заказа и страховочным кроном **`/api/cron/expire-point-orders` каждые 10 минут** (порог 24 ч, на час больше `ExpirationDate` ссылки кассы). При 100 % оплате баллами Робокасса не задействуется: заказ сразу `paid`, дальше общий `completePaidOrder` (вебхук ходит туда же). Баллы и автосписания несовместимы — тумблер гаснет при галочке рекуррента. Пополнение: реферал клиент → клиент (`/r/<code>` → cookie `wesetup.ref` → `Organization.referredByOrganizationId`, 30 % подписочной части первого оплаченного заказа, только для организаций моложе 30 дней и без партнёрской привязки) и отзывы (`CustomerReview`, тариф по вложению 300/750/1990 ₽, начисление после одобрения в `/root/reviews`, одобренные показываются на лендинге вместо прежних иллюстративных цитат). Кабинет — `/settings/balance` и `/mini/balance` одним компонентом (П-3), ROOT — колонка «Баланс ₽» в метриках, карточка организации с ручной корректировкой (`manual_adjust` + `AuditLog`) и модерация отзывов. |
| 2026-09-03 | — | **Sandbox / 14-day trial (3.1.4)** — `src/lib/trial.ts` (чистый статус теста: `getTrialStatus`, `TRIAL_DAYS`, `TRIAL_LIMITS` = 50 записей/день · 3 Tuya-датчика · 20 AI-сообщений, решение `decideTrialWrite` с тестами) + `src/lib/trial-limits.server.ts` (дневной счётчик ручных записей `Organization.trialWritesDayKey/trialWritesCount` по таймзоне организации, `trialWriteGate` → 402 `trial_daily_limit` во всех пользовательских write-эндпоинтах журналов, task-fill, QR-fill, catch-up, external API и действиях AI-помощника; `trialSensorGate` → 402 `trial_sensor_limit` при 4-й привязке датчика; в `BILLING_TEST_MODE` лимиты считаются и показываются, но не блокируют — как лимит на сотрудников). Конец теста — `subscriptionEnd` (ROOT продлевает в карточке организации), fallback `createdAt + 14 д`. Дашборд: `TrialStatusCard` (дни, три счётчика, CTA на подписку) и `TrialExpiredModal` на 15-й день — «Продлить» (подписка) / «Сократить функционал» (`POST /api/settings/subscription/trial-decision` → `free`, аудит `plan.trial_reduced`) / «Напомнить позже». Та же строка в сводке менеджера Mini App и под планом на `/settings/subscription`. Журналы не блокируются: чтение/печать/PDF всегда, записи — в пределах лимита. |
| 2026-09-02 | — | **Автоматизация журналов: модалка включения, политики ответственных и списка сотрудников, ежедневное автозаполнение 9 журналов** — capability-карта `src/lib/journal-autofill-capability.ts` (`staff` — hygiene, health_check; `per-day` — climate_control, cold_equipment_control, uv_lamp_runtime, cleaning_ventilation_checklist, glass_control, fryer_oil; `config-matrix` — cleaning; событийные журналы исключены сознательно) и единый движок `src/lib/journal-autofill.ts` (`applyJournalAutoFill`), на который переведены оба крона: 06:00 `journal-automation` (org-driven, «сегодня» по таймзоне организации) и 05:00 `auto-fill-journals` (per-doc тумблер, cleaning не входит — им владеет 06:00). Политики живут в `journalAutomationJson[code]`: `responsibles: {mode:'inherit'} | {mode:'custom', responsibleUserId, verifierUserId}` и `staff: {mode:'inherit'} | {mode:'custom', userIds[]}`; отсутствие ключа = прежнее поведение. Резолвер состава строк — `src/lib/journal-automation-staff.ts` (`resolveAutomationStaff`), одна реализация вместо двух (сидер `seedEntriesForDocument` получил параметр `employeeIds`). Модалка `journal-automation-enable-dialog.tsx` показывает реальные периоды и фамилии (`GET /api/organizations/auto-journals/preview`), включение mid-period догоняет период через `POST /api/organizations/auto-journals/apply`, `PUT /api/organizations/auto-journals` каскадит флаг `autoFill` на активные документы. Фиксы: `responsibleTitle` теперь заполняется при автосоздании (колонка «Должность ответственного» перестала пустовать), per-day записи матчатся ПО ДАТЕ (дубль строки при IoT-записи climate), тумблеры скрыты у field-based журналов и у сотрудников без прав. |
| 2026-08-27 | — | **Журнал ведётся сам** — новый cron `/api/cron/journal-automation` (INFRA NEXT: внешний cron **06:00 MSK ежедневно**, после `auto-create-journals` 04:00 и `auto-fill-journals` 05:00). Настройка — `Organization.journalAutomationJson` `{ [code]: { autoCreate, autoFill } }`, тумблер над списком документов (`PUT /api/organizations/auto-journals`) и таблица в `/settings/auto-journals`. Для каждой org и каждого журнала с `autoCreate`: `ensureActiveDocument({ autoFill: true })` + `ensureNextPeriodDocument` + автозаполнение ТОЛЬКО сегодняшнего дня через `applyStaffJournalAutoFill` (выходные — `isStaffDayOff`). Старые cron'ы 04:00/05:00 пропускают коды, которые ведёт автоматика. Побочный фикс: `isEntryDataEmpty` считает `{_autoSeeded:true}` ПУСТОЙ ячейкой — без него автосозданный документ никогда не заполнялся. **Правило «день в день»**: в документах автоматики (`JournalDocument.autoFill=true`) прошлые дни закрыты на PUT/PATCH/DELETE для ВСЕХ ролей (ROOT — override с `AuditLog closed_day.override`), на сайте и в Mini App; helper `isCellLocked` в `src/lib/closed-day.ts`. Backfill существующих org — `scripts/backfill-journal-automation.ts` (dry-run → `--apply`) |
| 2026-08-12 | — | Ежедневное автозаполнение журналов — `/api/cron/auto-fill-journals` дозаполняет СЕГОДНЯШНИЙ день во всех active-документах с `autoFill=true`: `hygiene`/`health_check` (общий helper `src/lib/staff-journal-autofill.ts`, он же за action `apply_auto_fill`), `climate_control`, `cold_equipment_control`, `uv_lamp_runtime`. Только пустые значения, идемпотентно. Графики `StaffWorkOffDay`/`StaffVacation`/`StaffSickLeave` проставляют «В»/«Отп»/«Б/л» ТОЛЬКО в гигиеническом журнале. INFRA NEXT: внешний cron 05:00 MSK ежедневно (после `auto-create-journals` в 04:00) |
| 2026-04-26 | `ec1ef75` | Tuya auto-pull cron — `/api/cron/tuya-pull` пишет t°/влажность с датчиков в `cold_equipment_control` и `climate_control` без юзера |
| 2026-04-26 | `6ba17c8` | Inspector portal — `InspectorToken` модель, `/inspector/<token>` read-only с TTL и one-click PDF, `/settings/inspector-portal` UI |
| 2026-04-26 | `3cb8af3` | Setup-wizard расширение — `/api/onboarding/apply` теперь применяет `disabledJournalCodes` + `autoJournalCodes` + опциональная смена `Organization.type`; UI получил селектор типа |
| 2026-04-26 | `9113154` | Weekly Telegram digest — `/api/cron/weekly-digest` шлёт менеджерам компактное HTML-сообщение каждый понедельник с compliance %, top employee, bottom-3 пропускаемых журналов, TF stats |
| 2026-04-26 | `8053d48` | AI SanPiN/ХАССП помощник — floating-FAB на дашборде → `/api/ai/sanpin-chat` с Claude Haiku 4.5 system-prompt'ом про ТР ТС/СанПиН; история в localStorage |
| 2026-04-26 | `8a2b54a` | Демо-данные для ROOT — `POST /api/root/seed-demo-org` создаёт за 30 сек полную trial-организацию: positions + journals + 10-20 demo-сотрудников + JournalDocument на месяц + 7 дней history. Кнопка «Создать демо-ресторан» на `/root` |
| 2026-04-26 | `da78661` | Fuzzy-match должностей при bulk-импорте — chained-strategy: exact → alias-table (~70 RU-вариаций) → levenshtein ≤2 → substring. `POST /api/settings/positions/match` для wizard'а, интегрировано в `/api/staff/bulk` (autoMatched в response, hint «возможно, имели в виду» при miss). 90% строк не требуют ручного выбора |
| 2026-04-26 | `a5a6bcd` | Drag-and-drop импорт Excel/CSV — `BulkStaffImport` принимает .xlsx / .xls / .csv / .tsv через drop-zone или file picker. Lazy-import `xlsx`, auto-detect разделителя CSV, auto-mapping колонок по заголовкам (фио/должность/телефон), превью первых 5 строк с бейджами «→ ФИО», dropdown'ы для ручной коррекции маппинга. Paste-textarea остался как fallback в `<details>`. Сочетается с fuzzy-match (#3.1.2) — 50 сотрудников из iiko-экспорта импортятся за один тап |
| 2026-04-26 | `ea295b1` | QR-quick-fill для оборудования — `/equipment-fill/[id]` (на которое ведёт QR-наклейка) теперь читает `Equipment.sensorMappings` и для оборудования с climate-mapping (humidity) показывает доп. поле «Влажность %». POST API при наличии humidity записывает в active climate_control document с автоопределением ближайшего controlTime. Холодильники без climate-mapping продолжают работать как раньше (только температура) |
| 2026-04-26 | `1b8ae20` | «Заполнить как вчера» в task-fill — `GET /api/task-fill/[id]/yesterday-prefill` возвращает `entry.data` за вчера (DocumentEntry-based журналы: hygiene/health_check/cold_equipment/climate). Кнопка появляется автоматически когда хотя бы одно поле формы совпадает с ключами вчерашних данных; на клик — pre-fill всех совпавших полей, юзер правит только что изменилось |
| 2026-04-26 | `8abe3b5` | Smart defaults в task-fill formах — helper `src/lib/smart-defaults.ts` (`getYesterdayEntryData`, `getRecentEquipmentReading`). Hygiene и health-check adapter'ы при `getTaskForm` автоматически подгружают вчерашние status/signed и подставляют как `defaultValue`. Повар привычно ставит «healthy» каждый день → форма уже pre-filled, один тап submit |
| 2026-04-26 | `6ee0559` | Compliance-сертификат A4 PDF — `GET /api/certificate?from=&to=` генерирует premium-look сертификат с org name, compliance% за период, статистикой дней с полной отчётностью + QR-код. QR ведёт на свежесозданный InspectorToken (TTL 90 дней) — третьи лица (гости, инспекторы) сканируют и видят live-журналы. Кнопка «🏆 Сертификат соответствия» в `/settings/inspector-portal` |
| 2026-04-26 | `cdbccb9` | StaffCompetency expiry alerts — `/api/cron/expiry` дополнительно сканирует медкнижки/обучение/сертификаты с `expiresAt` в окне ±30 дней. Anchor-логика на 30/14/3 дня + просрочка → emoji-intensity push (🟡/🟠/🔴) менеджерам. Без дубликатов: cron дёргается ежедневно, push уходит ровно в anchor-дни |
| 2026-04-26 | `ab76ef9` | Prompt caching для AI-чата — system-prompt (`~600 токенов`) теперь передаётся в Anthropic с `cache_control: { type: 'ephemeral' }`, повторные запросы в 5-мин окне стоят 10× дешевле на input-токенах. В response.usage добавлены cacheReadTokens / cacheCreationTokens для observability |
| 2026-04-26 | `9164500` | Worker leaderboard — топ-3 сотрудников за 30 дней на /dashboard. Aggregate JournalDocumentEntry + JournalEntry + BonusEntry. UI с medal-emoji 🥇/🥈/🥉 и зелёным `+N ₽` бонусом. Геймификация — повар хочет попасть в топ |
| 2026-04-26 | `078b239` | Time-to-fill метрика — модель `FormFillTiming` + ingest в `/api/task-fill/[taskId]` (client передаёт `openedAt`). ROOT-страница `/root/timings` с таблицей: sample, медиана, p90, среднее + цветовой бейдж (быстро/нормально/медленно). Платформенная UX-аналитика для продакта |
| 2026-04-26 | `c2d8c92` | AI-отчёт за период — `POST /api/ai/period-report` собирает summary (compliance %, CAPA, losses, проблемные журналы) и Claude Haiku пишет связный текст «резюме / хорошее / проблемы / рекомендации» 250-400 слов. UI карточка на `/reports` с date-pickers, editable textarea, кнопкой «Скопировать», collapsible раскрытие сырых фактов |
| 2026-04-26 | `36fc3dd` | Free-tier rate-limit для AI-чата — `Organization.aiMonthlyMessagesLeft/aiMonthlyQuota` (default 20), decrement в `/api/ai/sanpin-chat`, 402 quota-exceeded для trial-org. UI виджет показывает «Осталось N» под input'ом, блочит ввод при 0. Cron `/api/cron/reset-ai-quota` сбрасывает 1-го числа |
| 2026-04-26 | `2516f2b` | ИНН-lookup при регистрации — `GET /api/public/inn-lookup?inn=…` прокси к DaData Suggestions API. На форме регистрации появляется ссылка «Подтянуть название по ИНН» когда введено 10/12 цифр. Снижает frения onboarding'а. Требует `DADATA_API_KEY` env (free tier 10K req/day) |
| 2026-04-26 | `ce78013` | Soft-block модалка про просроченные CAPA — на `/dashboard` появляется nag когда есть CAPA с `createdAt < now-7d AND status != closed`. Dismissable per-session, при reload снова. CTA «Открыть CAPA» + «Напомнить позже» |
| 2026-04-26 | `5525972` | Виджет «Здоровье настройки» — `runOrgHealthCheck()` делает 8 проверок (positions, users, phones, active docs, auto-journals, TF integration, inspector tokens, telegram links). Score 0-100%. Свёрнут по умолчанию, разворот по клику показывает список с ссылками «настроить». Не рендерится при 100% |
| 2026-04-26 | `7688689` | Per-employee pricing — `calculatePerEmployeePrice(N)` с 3 brackets (free до 5, 100 ₽/чел до 29, 80 ₽/чел до 99, 60 ₽/чел 100+). UI на `/settings/subscription` показывает «активных / платно / в месяц», шкала тарифов в подсказке |
| 2026-04-27 | `1937110` | Audit log impersonations — `/api/root/impersonate` теперь пишет `ipAddress` в AuditLog. Новая страница `/root/audit-impersonations` показывает последние 200 событий вход/выход с таблицей Время/Действие/Организация/Кто/IP. Compliance-vendor'a перед клиентом |
| 2026-04-27 | `a7aca7a` | Персонализированные Telegram-пуши — `personalizeMessage()` заменяет `{name}/{timeOfDay}/{dayOfWeek}` placeholder'ы в template'ах. `notifyEmployee()` автоматически применяет helper. Снижает reminder fatigue («Иван, утром гигиена» вместо «у вас задача») |
| 2026-04-27 | `6f3f5eb` | Виджет поддержки в админке — floating FAB слева внизу для management. `POST /api/support` шлёт в `SUPPORT_TELEGRAM_CHAT_ID` (env) с контекстом org+user+URL. Fallback в AuditLog если канал не настроен. Команда отвечает в Telegram |
| 2026-04-27 | `ce0b58d` | 1С-выгрузка списаний — `Organization.accountantEmail` + `/settings/accounting` UI. Cron `/api/cron/losses-export-1c` каждый понедельник для каждой org с email'ом собирает LossRecord за прошедшую неделю → CSV (UTF-8 BOM, ;-разделитель, ДД.ММ.ГГГГ даты) → отсылает с attachment'ом через nodemailer. Колонки: Дата/Категория/Продукт/Кол-во/Ед.изм/Сумма ₽/Причина. Если записей нет — письмо не шлётся. AuditLog `1c_losses_export.sent`. INFRA NEXT: cron Mon 06:00 UTC |
| 2026-04-27 | `49a38fd` | Onboarding-тур в Mini App — `<MiniTour>` 3-экранная модалка-bottom-sheet, открывается при первом визите. localStorage flag `wesetup.mini.tour.seen` гасит. Шаги: «ваши задачи», «заполнить как вчера», «уведомления в Telegram». Закрывается крестиком или после третьей кнопки «Поехали». Не требует shepherd.js — pure React state machine |
| 2026-04-27 | `a216abd` | DIY-датчики ESP32/Arduino — новый endpoint `POST /api/external/sensors` с минимальной схемой `{equipmentId, type, value, timestamp?}`. Bearer auth через `Organization.externalApiToken`. Автоматически находит активный `cold_equipment_control` document и upsert'ит замер в `data.temperatures[equipmentId]`. Триггерит maybeCreateRealtimeCapa если 2 подряд out-of-range. Полная документация в `docs/esp32-sensor-example.md`: ESP32+DS18B20 sketch (Arduino), Raspberry Pi Python, curl-тест |
| 2026-04-27 | `e8b2b81` | IoT real-time CAPA trigger — `maybeCreateRealtimeCapa()` дёргается из `/api/cron/tuya-pull` после каждого замера температуры. Если current+previous оба out-of-range и зазор ≤90 мин → создаёт `CapaTicket` с `sourceType="iot_realtime"`, `sourceEntryId=equipmentId`, slaHours=4 + push management. Дедупликация: один открытый тикет per equipment per 6 часов. Не путать с `detectTemperatureCapas` (3-дневный pattern, медленный) — этот ловит острые эпизоды |
| 2026-04-27 | `fada114` | Compliance heatmap на /reports — `getComplianceHeatmap(orgId, 30)` собирает 2 запроса к БД (JournalEntry + JournalDocumentEntry с groupBy/bucket по date). Возвращает rows [{templateCode, templateName, cells: [{date, status: filled/missed/future, count}]}]. SVG-grid (table+div) без внешнего chart-lib. Сортировка строк по числу пропусков (worst offenders сверху). Колонка «%» справа за период, окрашена по threshold'ам. Hover-tooltip показывает дату+count. Helper в `src/lib/compliance-heatmap.ts` |
| 2026-04-27 | `23ff846` | Auto-escalation TasksFlow задач — `/api/cron/tasksflow-escalations` каждые ~6 ч. Сканирует TasksFlowTaskLink с remoteStatus=active и createdAt старше 24 ч. >24 ч → soft-ping непосредственному руководителю по ManagerScope (specific_users точнее all). >48 ч → срочный push всему management. Дедупликация через AuditLog `escalated_l1/l2`. Если в TF задача уже выполнена — link синхронизируется (remoteStatus=completed). INFRA NEXT: внешний cron 4× в день |
| 2026-04-27 | `c3a34bc` | Shift-watcher — `/api/cron/shift-watcher` каждые 30 мин проверяет WorkShift.status="scheduled" сегодня. Если сотрудник числится на смене, но за >30 мин с начала смены (06:00 UTC) не сделал ни одной записи → push руководству «X на смене?». После >2 ч — статус смены автоматически переводится на "absent" + повторный push. Дедупликация через AuditLog `shift_watcher.notify_30/mark_absent` — повторно не пингуем. INFRA NEXT: cron каждые 30 мин 06:00-22:00 MSK |
| 2026-04-27 | `c805800` | Автоматический offboarding — `performOffboarding()` дёргается fire-and-forget при PUT/DELETE на `/api/users/[id]` когда isActive→false. Архивирует, чистит telegramChatId, ищет преемника (jobPositionId → role match → pickPrimaryStaff fallback), через TF API перевешивает все active-задачи уходящего на TF-worker_id преемника. AuditLog `offboarding.complete` с count + names. Telegram-уведомление руководителям с резюме «X деактивирован, преемник Y, перевешено N задач» |
| 2026-04-27 | `158606c` | AI-подсказки в CAPA workflow — `POST /api/capa/[id]/suggest?step=root_cause\|corrective\|preventive` берёт context (title/description/category/priority + предыдущие шаги) и одним вызовом Claude Haiku 4.5 возвращает 3 варианта формулировки в JSON. На странице `/capa/[id]` рядом с заголовком текущего шага появляется кнопка «AI: предложить варианты», под textarea — карточки с title+text, по клику текст вставляется в форму. Расходует общую месячную AI-квоту org. ~$0.003 за запрос |
| 2026-04-27 | `4b1fdbc` | «Закрытый день» — `Organization.lockPastDayEdits` toggle. Когда true и `org.shiftEndHour` прошёл, рядовые сотрудники не могут править записи прошедших дней (PUT на `/api/journal-documents/[id]/entries` отдаёт 403 `code: past_day_locked`). Management может, но override пишется в AuditLog `closed_day.override` с datedoc/employee/template — это проверяется ХАССП-аудитом. Pure-функции в `src/lib/closed-day.ts` (`getStartOfToday`, `isPastDayLocked`, `canEditEntryAt`). UI-toggle в `/settings/compliance` |
| 2026-04-27 | `e9671bb` | Per-org metrics dashboard на `/root/metrics` — `getAllOrgMetrics()` собирает activeUsers, entries 7d/30d, weekly trend, last activity, potential/actual MRR (по `calculatePerEmployeePrice`). Сводные карточки сверху + таблица отсортированная по MRR. Кнопка «Метрики платформы» добавлена на `/root` |
| 2026-04-27 | `182ed9f` | Yandex.Disk auto-backup — `Organization.yandexDiskToken/Folder/LastBackupAt` поля + `src/lib/yandex-disk.ts` (REST helper) + `src/lib/org-backup.ts` (JSON-дамп журналов за период). Cron `/api/cron/yandex-backup` (weekly, рекомендуется Mon 03:00 MSK) проходит по всем org с токеном, генерит дамп за 7 дней, заливает в `/WeSetup/wesetup-backup-YYYY-MM-DD.json`. Settings-страница `/settings/backup` — connect/disconnect, ручная кнопка «Сделать бэкап сейчас», история последних 10 бэкапов из AuditLog. Если WeSetup исчезнет — у ресторатора есть читаемый JSON в его собственном Я.Диске. INFRA NEXT: настроить cron weekly + создать Yandex OAuth app с правами `cloud_api:disk.read/write` |
| 2026-04-26 | `7bf3088`–`378ace0` | **EPIC: Shared journal tasks (event-log) + кнопка «Не требуется сегодня».** Большая переделка интеграции TF: 35 шаблонов классифицированы по `taskScope: personal \| shared`. Shared (acceptance, finished_product, complaint_register, accident_journal и 16 других event-журналов) теперь работают как открытая очередь записей: сотрудник может N раз нажать «Добавить запись», или «Не требуется сегодня» с выбором причины из настроенного списка. Compliance признаёт closure ✅. В TF появились 3 таба «Все / Мои задачи / Общие задачи смены». Реализовано в 9 коммитов: WeSetup `7bf3088` schema → `90e3b88` backend API → `1792ee8` классификация шаблонов → `c4ab75f` settings UI per-template → `c001196` compliance recognition → `4bba603` task-fill page UI с 3 кнопками → `23f0658` auto-close cron + roadmap → `8a0bbe9` shiftEndHour UI + taskScope в journalLink; TasksFlow `378ace0` 2-табовый Dashboard. Cron'ы для прода: `/api/cron/migrate-task-scopes` (раз после деплоя), `/api/cron/auto-close-shifts` (ежечасно). |

---

## 3. Pending tasks

### 3.2. Заполнение журналов «дурак-проф»

#### 3.2.1. Voice input через Telegram-бот
- **Goal:** в Telegram-боте появляется voice-кнопка «Заполнить голосом». Сотрудник наговаривает «уборка холодильника номер три выполнена», bot транскрибирует через `whisper-1` API (через OpenAI или Anthropic-альтернативу), мэпит на ближайший pending journal-task и отмечает выполнение.
- **Сложность:** M
- **Hints:** OpenAI Whisper API ($0.006/min). Telegram bot voice messages — `audio.voice` через grammy. Структурирование транскрипта в action — Claude Haiku one-shot.
- **Acceptance:** на 8 из 10 типичных команд («моя смена закончена», «t° в кондитерской 4 градуса», «уборка зала готова») bot правильно отмечает целевой journal-cell.

#### 3.2.3. Geofence-напоминания
- **Goal:** при входе сотрудника в радиус кухни (по `Area.lat/lng`) — Telegram push «Иван, утренняя hygiene — 30 сек».
- **Сложность:** M
- **Hints:** Mini App уже имеет geo через Telegram WebApp API. Нужен background-watcher (нельзя в WebView надолго) ИЛИ периодический опрос location при открытии Mini App + сравнение с Area.lat/lng. Альтернатива — native PWA с Geolocation API + push.
- **Acceptance:** сотрудник в Mini App, который проходит мимо своей кухни — получает Telegram push с deep-link на нужный journal-task.

#### 3.2.6. Photo OCR для incoming-control
- **Goal:** в форме приёмки сырья кнопка «Сфотографировать чек». Фото → Claude Vision → распарсить дату, срок годности, массу, поставщика.
- **Сложность:** L
- **Hints:** уже есть `/api/ocr/label` для маркировок продукции — переиспользовать паттерн. system-prompt: «извлеки JSON {productName, weight, deliveryDate, expiryDate, supplier}».
- **Acceptance:** сотрудник снимает чек → через 3 сек 5 полей формы заполнены автоматически с возможностью править перед save.

### 3.3. Multi-location / франшизы

#### 3.3.1. Network organization (parent → children)
- **Goal:** в `Organization` добавить `parentOrganizationId`. ROOT может назначить сеть. Управляющий сетью видит aggregate-compliance всех точек на отдельной /network странице.
- **Сложность:** L
- **Hints:** prisma migration. Все query которые `where: { organizationId }` — расширить до `OR: [{ organizationId }, { organization: { parentOrganizationId } }]` через специальный helper. Не ломать tenant isolation.
- **Acceptance:** регистрация new-child-org с указанием parent → она появляется в /network page материнской org, compliance считается агрегатом.

#### 3.3.2. Шаблоны journals между компаниями
- **Goal:** менеджер сети редактирует «Журнал контроля интенсивного охлаждения» с custom-полями (список блюд) → жмёт «Распространить на все точки сети» → 50 точек получают обновлённый config через Notification + автозапись в их `JournalDocument.config`.
- **Сложность:** M
- **Hints:** требует наличия #3.3.1 (parent-org). На уровне UI — diff-preview: «вот что изменится в N точках».
- **Acceptance:** redeploy конфига в 50 точек за <30 сек, история изменений видна в audit log.

#### 3.3.3. Cross-location бенчмаркинг
- **Goal:** на /network page — таблица «Точка / compliance% / худший журнал / цвет». Сортировка по compliance ASC — региональный директор видит проблемные точки сверху.
- **Сложность:** M
- **Hints:** переиспользовать `getTemplatesFilledToday` для каждой child-org за период. Кеш на 1 час, чтобы не grind базу при открытии.
- **Acceptance:** /network/benchmark открывается за <2 сек для сети из 100 точек.

#### 3.3.4. Маркетплейс конфигураций
- **Goal:** успешные рестораны могут опубликовать свой набор `disabledJournalCodes + autoJournalCodes + jobPositions` под лицензией CC. Новая компания при онбординге видит «топ-10 публичных конфигов» и может импортировать.
- **Сложность:** L
- **Hints:** новая модель `OnboardingPresetPublished`. UI — `/marketplace`. Социальный proof.
- **Acceptance:** менеджер новой компании видит preset «Кофейня Surf Coffee — 12 точек», нажимает «Применить» → конфиг применяется как onboarding-preset.

### 3.4. Инспектор / аудитор / СЭС

#### 3.4.1. Бумажная распечатка всего за период (async)
- **Goal:** в `/settings/inspector-portal` или отдельной странице — кнопка «Сформировать полный архив за период». Формирует ZIP со всеми journal-PDF файлами + summary, асинхронно через background job. Ссылка на скачивание + email-уведомление когда готово.
- **Сложность:** M
- **Hints:** уже есть `/api/inspector/[token]/pdf` (summary). Тут — full-archive: для каждого active document вызвать `/api/journal-documents/[id]/pdf` → собрать в ZIP через `archiver`. Storage — `/var/www/.../tmp` с TTL 7 дней.
- **Acceptance:** на 100-документной orgе архив генерится за <5 мин в background, email с ссылкой приходит, ZIP скачивается, валидный.

#### 3.4.2. Электронная подпись инспектора
- **Goal:** в портале инспектора (`/inspector/<token>`) — кнопка «Подтверждаю просмотр». Записывает `InspectorVisit` row с timestamp + IP + user-agent + список просмотренных templates.
- **Сложность:** L
- **Hints:** новая модель `InspectorVisit { tokenId, signedAt, ip, userAgent, templatesViewed Json }`. UI — отдельная "signed" badge на токене у админа.
- **Acceptance:** admin видит «Инспектор Иванова И.И. подписала просмотр 2026-04-30 14:30, журналов: 12».

### 3.5. Staff lifecycle

#### 3.5.1. Onboarding-чек-лист нового сотрудника
- **Goal:** новый `User` получает серию задач (через `Notification` + `JournalObligation`): пройти инструктаж по гигиене, медкомиссия, расписаться в правилах. Менеджер не может «допустить» сотрудника к смене, пока чек-лист не закрыт.
- **Сложность:** M
- **Hints:** новая модель `OnboardingChecklist` или переиспользовать `JournalObligation`. Hard-gate в TasksFlow assigment.
- **Acceptance:** при создании user'а ему приходит TG с 5 задачами, после закрытия всех — статус `User.onboardingComplete = true`.

### 3.6. IoT / физический мир

#### 3.6.2. Bluetooth-термометры через PWA Web Bluetooth
- **Goal:** в Mini App кнопка «Подключить термометр». Web Bluetooth API ловит замер с Testo 104/Hanna HI 145 и кладёт в форму.
- **Сложность:** L
- **Hints:** Web Bluetooth работает только в Chrome (но Chrome ≥ 80% mobile share в RU). Нужен mapping характеристик GATT-сервиса на каждую модель.
- **Acceptance:** повар нажимает кнопку → разрешает Bluetooth → термометр пишет 4.2°C → поле формы pre-filled.


#### 3.6.4. Vision AI для сканирования полок
- **Goal:** сотрудник снимает 1 фото холодильника → AI выделяет видимые продукты + распознаёт даты на ценниках/упаковке → проверяет на просрочки → пишет в `losses`.
- **Сложность:** XL
- **Hints:** Claude Vision на одном фото — точность ~70% на дату/название. Рекомендую делать pilot на 5 ресторанах перед раскаткой. Risk: false-positives → менеджер не доверяет.
- **Acceptance:** для пилотного ресторана с 5 фото в неделю — 80% реальных просрочек найдены, < 2 false-positives.

### 3.7. Аналитика и operational insight

#### 3.7.2. Predictive alerts
- **Goal:** «если сегодня к 14:00 не заполнено N — статистика говорит 80% что не заполнят сегодня вообще, напомним сейчас».
- **Сложность:** L
- **Hints:** простой baseline без ML — посчитать historical % заполнения в 14:00 vs final за день для каждого journal-template. Если delta < threshold → push.
- **Acceptance:** push приходит ровно когда (а) статистически плохо, (б) ещё успеть исправить — не за 5 минут до конца дня.

### 3.8. LLM/AI features

#### 3.8.2. Smart copy-paste из ТТК/SOP
- **Goal:** менеджер вставляет процедуру производства (текст SOP/ТТК) → AI разбивает на критические контрольные точки (CCP) и предлагает места контроля.
- **Сложность:** L
- **Hints:** Claude Sonnet с system-prompt'ом про ХАССП. Может промахиваться — нужен review-flow с возможностью править перед сохранением.
- **Acceptance:** ТТК «Котлета по-киевски» → AI выдаёт 5 CCP (приёмка, разделка, t° готовности, охлаждение, хранение) с предложениями журналов.

#### 3.8.4. RAG для AI-помощника по СанПиН
- **Goal:** уже есть базовый AI чат. Добавить embeddings всех релевантных нормативов (ТР ТС 021/022, СанПиН 2.3/2.4.3590-20, СП 2.4.3648-20, ГОСТ Р 51705.1) → ответы со ссылками на конкретные пункты.
- **Сложность:** M
- **Hints:** OpenAI text-embedding-3-small ($0.02/1M токенов) для эмбеддингов. Storage — pgvector в Postgres (уже есть Postgres!). Нормативы — ~200 страниц, ~600K токенов = $0.012 одноразово. Retrieval top-5 chunks → подставить в system-prompt.
- **Acceptance:** на вопрос «какая t° холодильника?» AI отвечает «Согласно п. 4.5 СанПиН 2.3/2.4.3590-20: +2…+6 °C» с цитатой непосредственно из норматива.

### 3.9. Интеграции

#### 3.9.1. iiko / Poster / r_keeper
- **Goal:** заказы и блюда из POS (iiko-Office API) → синк в `finished_product` журнал автоматически каждые 30 мин.
- **Сложность:** L
- **Hints:** iiko API имеет /api/0/login + /api/0/olap. POS-плагин = большая работа, но 60-70% RU ресторанов на iiko — огромный TAM.
- **Acceptance:** ресторан подключил iiko-credentials → за смену 80 блюд автоматически в `finished_product` с временем выпуска.

#### 3.9.3. WhatsApp Business API
- **Goal:** для регионов где Telegram под блокировкой — wa.me-link и WhatsApp Business webhooks для notify/digest.
- **Сложность:** M
- **Hints:** Meta WhatsApp Business API — нужен зарегистрированный business profile + одобренный template. ~$0.01-0.05 за message в RU.
- **Acceptance:** менеджер может выбрать WhatsApp как канал, тот же weekly-digest приходит туда.

#### 3.9.6. CRM (Bitrix24/AmoCRM) для лидов
- **Goal:** заявки с landing'а → новый лид в Bitrix24, статус-update при подписке.
- **Сложность:** M
- **Hints:** Bitrix REST API + webhooks.
- **Acceptance:** маркетинг видит conversion funnel «лид → trial → paid» в своей CRM.

### 3.10. Compliance enforcement

#### 3.10.1. Hard-gate перед сменой
- **Goal:** в TF сотрудник не может открыть first-task смены, пока не отметил hygiene на сегодня.
- **Сложность:** S
- **Hints:** в TF API `/api/tasks` POST — проверка на наличие `hygiene` entry за сегодня. Server-side gate.
- **Acceptance:** воркер пытается открыть «уборка горячего цеха» — модалка «Сначала пройдите гигиенический контроль».

### 3.11. Mobile UX

#### 3.11.1. Offline mode в Mini App
- **Goal:** в Mini App при отсутствии интернета — формы сохраняют в IndexedDB и синкаются когда сеть появится. Нужно для морозильных складов.
- **Сложность:** L
- **Hints:** Service Worker + Background Sync API. Form submit — оборачивать в `idb-keyval` queue. Конфликт-resolution: server wins для journals.
- **Acceptance:** сотрудник в подвальном складе без сигнала заполняет 5 форм → выходит → данные доходят до сервера за 10 сек.

#### 3.11.2. Native iOS/Android app через Capacitor — `[deferred]`
- **Goal:** существующий Mini App обёрнут в Capacitor → publish в App Store / Google Play. Native push, биометрия, BT.
- **Сложность:** XL
- **Hints:** Mini App почти-native, но WebView упирается в Telegram-ограничения. Capacitor — 3-4 месяца на полировку. ROI неясный — Mini App покрывает 95% UX.
- **Acceptance:** ОТЛОЖИТЬ. Не делай это пока не будет 1000+ paid orgs.

#### 3.11.4. Wearable (Apple Watch / Mi Band) — `[deferred]`
- **Goal:** короткие задачи через смарт-часы. «t° холодильника норма? Yes/No».
- **Сложность:** XL
- **Hints:** требует native app (см. #3.11.2). ОТЛОЖИТЬ.
- **Acceptance:** ОТЛОЖИТЬ.

### 3.12. Customer success / self-serve

#### 3.12.1. Видео-туториалы внутри
- **Goal:** для каждого journal-template — 30-секундное видео «как заполнять». Записать через Loom + хостинг на Yandex.Cloud Object Storage.
- **Сложность:** M
- **Hints:** контент-задача больше чем код. Нужен сервис управления видео-tour'ами. UI — кнопка «?» в углу формы.
- **Acceptance:** для top-10 journals есть видео; новый сотрудник смотрит 30 сек и заполняет правильно.

### 3.13. Pricing / монетизация

#### 3.13.2. Add-on модули
- **Goal:** базовый тариф $20/mo + IoT-add-on $30/mo + AI-helper-add-on $20/mo + inspector-portal $10/mo.
- **Сложность:** M
- **Hints:** `Organization.activeAddons String[]`. Middleware-чеки в каждом feature.
- **Acceptance:** UI-страница «выбрать модули» с галочками, real-time price calculation.

#### 3.13.3. Партнёрская программа для технологов-консультантов
- **Goal:** технолог получает реферальную ссылку, % с приведённых клиентов на 12 мес.
- **Сложность:** M
- **Hints:** новая `Partner` модель + tracking. UTM в URL.
- **Acceptance:** консультант приводит 5 ресторанов = пассивный доход, рекомендует ваше ПО другим клиентам.

#### 3.13.4. Маркетплейс шаблонов с платными premium-конфигами — `[deferred]`
- **Goal:** см. #3.3.4 + Stripe-style monetization для авторов конфигов.
- **Сложность:** L
- **Hints:** ОТЛОЖИТЬ — это long-tail, не работает без community-объёма.

### 3.14. ROOT / платформа

#### 3.14.3. Auto-billing через ЮKassa
- **Goal:** `Organization.yookassaShopId` уже есть в schema. Прокачать: автосписание подписки 1 числа, retry 3 дня, suspend на 5-й.
- **Сложность:** M
- **Hints:** ЮKassa API + webhook. Cron `/api/cron/billing` каждое 1 число.
- **Acceptance:** платежи идут автоматически, ручных счетов нет.

#### 3.14.4. Compliance-export для регулятора — `[deferred]`
- **Goal:** машиночитаемый формат (XML по схеме Россельхознадзора, если такая существует) для проверок.
- **Сложность:** L
- **Hints:** ОТЛОЖИТЬ до конкретного запроса от клиента-регулятора. Сейчас Россельхознадзор такое не требует.

---

## 4. Дискавэри в процессе работы (placeholder)

Если по ходу работы найдёшь побочные баги, добавляй сюда новой задачей с пометкой `[discovered]`. Не чини в текущем коммите — только записывай.

_(пусто)_

---

## 5. Глоссарий

- **org** — Organization, тенант. Все business-данные scoped по `organizationId`.
- **ROOT** — `User.isRoot = true`, platform superadmin. Может impersonate любую org.
- **management** — `role in ["manager", "head_chef"]` или legacy `["owner", "technologist"]`. Видит всё в своей org.
- **staff** — `role in ["cook", "waiter"]`. Видит только разрешённые journals (через UserJournalAccess или JobPositionJournalAccess).
- **TF** — TasksFlow, отдельный repo c:\www\TasksFlow.
- **adapter** — `src/lib/tasksflow-adapters/<name>.ts`, мостит между TF-задачей и WeSetup-журналом.
- **document-based journal** — журнал хранится как `JournalDocument` + `JournalDocumentEntry` rows (hygiene, climate, cleaning).
- **field-based journal** — `JournalEntry` с JSON `data` (accident_journal, complaint_register).
- **CCP** — Critical Control Point, термин из ХАССП.
- **СанПиН** — Санитарные правила и нормы РФ. ХАССП = HACCP.
- **СЭС / Роспотребнадзор** — органы, проверяющие пищевые предприятия.
