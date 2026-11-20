# Spec (frozen 2026-11-20): файловый JSON-кеш запросов и AI-ready HTML/Markdown для страниц продвижения

Запрос владельца: сделать кеш запросов к БД для страниц продвижения (лендингов, блога и базы знаний) — сначала реализовать его для WeSetup и настроить обновление, затем оформить подход как переиспользуемый скилл и последовательно применить к остальным проектам. Хранить результаты в простом и удобном в отладке формате без занятия оперативной памяти, сложных демонов, настроек от `root` и разных схем доступа; при выдаче кешированных страниц не должно быть ни одного `SELECT` к БД; нужен чистый современный семантический HTML с возможностями для ИИ.

## Исходное состояние (`master` `02d0bcc6`)

- Страницы продвижения (`/`, `/pricing`, `/partners`, `/uslugi`, `/journals-info/[code]`, `/blog`, `/blog/[slug]`, `/blog/feed.xml`, `/sitemap.xml`) объявлены `force-dynamic` и ходят в PostgreSQL:
  - `src/lib/tariffs.ts` (`PlatformTariff`, RAM-кеш 60 с),
  - `src/lib/promo/offer.ts` (`PricePromotion`, RAM-кеш 30 с),
  - `src/lib/balance/reviews.ts` + `src/lib/review-stats.server.ts` (`CustomerReview` + агрегаты `JournalEntry` / `JournalDocument`, RAM-кеш 60 с),
  - `src/lib/journal-usage-count.server.ts` (`JournalDocument.groupBy`, RAM-кеш 1 ч на каждый код журнала отдельно),
  - `src/lib/partners/schema-extras.ts` (`PartnerRewardRule`, без кеша + DDL-проверка),
  - `src/lib/services/catalog.ts` (`PlatformService`, без кеша),
  - `src/app/blog/**`, `src/app/sitemap.ts`, `src/lib/article-localization-server.ts` (`Article` + `ArticleTranslation`, без кеша — до 4 `SELECT` на просмотр статьи),
  - `src/lib/translations/overrides.server.ts` (`TranslationOverride`, опрос БД каждые 30 с через `loadMessages` на всех страницах),
  - `src/components/public/public-chrome.tsx` (`PublicHeader`), `src/app/page.tsx` и `src/app/partners/page.tsx` зовут `getServerSession(authOptions)`, который при наличии сессионной куки делает `SELECT` к `User` и `OrganizationMember` даже на статической базе знаний `/baza-znaniy` и отраслевых лендингах `/dlya-*`.
- Уроки Yesbeat (`api/Cache.php`): Redis требует памяти и отдельного демона; файловый кеш по `md5(sql)` с таблицей связей в БД сам плодит `SELECT`/`INSERT` при проверке и сбросе, оставляет файлы-сироты при правке текста запроса и заставляет поисковых/ИИ-ботов платить за холодную пересборку по истечении TTL.
- `/llms.txt` содержит устаревший захардкоженный текст (старые названия тарифов, нет базы знаний и живых статей блога), Markdown-версий промо-страниц для ИИ-агентов нет, в ряде публичных страниц отсутствуют семантические ориентиры `<header>` и `<main>`.

## Границы

- Транзакционные маршруты оплаты, заказов, кабинета, начислений партнёрки и API (`/order`, `/payment`, `/dashboard`, `/journals`, `/settings`, `/root`, `/api/*`) продолжают читать живые данные и полную сессию из БД без изменений.
- Схема БД (`prisma/schema.prisma`), `package-lock.json` и базовые файлы `src/lib/db.ts` / `src/lib/auth.ts` не меняются.
- Приватные маршруты остаются закрытыми в `robots.txt` и `Cache-Control: no-store`.

## Критерии приёмки

- **AC1. Атомарное файловое JSON-хранилище без RAM-кеша, демонов и `root`.** Модуль `src/lib/promo-cache/store.ts` хранит человекочитаемые JSON-снапшоты с конвертом `{ version: 1, dataset, generatedAt, data }`. Путь хранения: `PROMO_CACHE_DIR` → `/var/www/wesetupru/data/promo-cache` на проде (переживает `rsync --delete` при деплое без прав `root`, аналогично `/var/www/wesetupru/data/uploads`) → `.cache/promo-cache` локально (`/.cache/` в `.gitignore`). Запись строго атомарная (`tmp`-файл рядом + `rename`), без хранения данных в памяти процесса между запросами и без протухания по TTL на запросах посетителей.
- **AC2. Полный охват промо-данных и 0 `SELECT` при выдаче.** Все чтения данных на промо-страницах (`/`, `/en`, `/uz`, `/dlya-*`, `/zhurnal-haccp` и SEO-лендинги, `/features/*`, `/pricing`, `/partners`, `/uslugi`, `/avtozapolnenie`, `/sanpin-2-3-2-4-4282-26`, `/blog`, `/blog/[slug]`, `/blog/feed.xml`, `/baza-znaniy`, `/baza-znaniy/[slug]`, `/journals-info`, `/journals-info/[code]`, `/sitemap.xml`, `/llms.txt`, `/llms-full.txt`, `*.md`) идут через JSON-снапшоты (`tariffs`, `promotions`, `public-reviews`, `journal-usage`, `partner-reward-rule`, `services`, `blog-articles`, `translation-overrides`). Окна акций (`startsAt`/`endsAt`) и отложенные статьи блога (`publishedAt`) вычисляются по текущему времени в JS без обращения к БД. Бейдж авторизации в `PublicHeader`, на главной и на `/partners` читает только криптографически проверенный JWT из куки (`src/lib/public-session-badge.ts`) без `SELECT` к `User`. При наличии снапшотов отдача любой промо-страницы выполняет **ровно 0 запросов к БД**.
- **AC3. Мгновенное обновление при правках + деплой + фоновая актуализация.** Мутации тарифов, акций, отзывов, правил партнёрки, услуг, статей и переводов блога, `prisma/seed-articles.ts` и редактора переводов сразу пересобирают затронутый JSON-файл. Скрипт `scripts/refresh-promo-cache.ts` (`npm run promo-cache:refresh` и `npm run promo-cache:status`) пересобирает все снапшоты или выводит их состояние на диске без БД; `scripts/prewarm-routes.sh` вызывает обновление на каждом деплое, а существующий воркер `scripts/telegram-poller.ts` раз в час фоново обновляет статистические снапшоты (`journal-usage`, `public-reviews`).
- **AC4. Чистый семантический HTML5.** Публичная шапка (`PublicHeader` и шапка главной) использует `<header>`, контент промо-страниц обёрнут в `<main id="main-content">`, даты публикаций в блоге размечены `<time dateTime="...">`, микроразметка Schema.org JSON-LD консистентна со снапшотами.
- **AC5. Возможности для ИИ (Markdown-выдача, `llms.txt`, `robots.txt`).**
  - Промо-страницы доступны в виде чистого структурированного Markdown как по суффиксу `.md` (`/index.md`, `/pricing.md`, `/partners.md`, `/uslugi.md`, `/blog.md`, `/blog/<slug>.md`, `/baza-znaniy.md`, `/baza-znaniy/<slug>.md`, `/journals-info.md`, `/journals-info/<code>.md`, `/<dlya-niche>.md`, `/features/<slug>.md`), так и при заголовке `Accept: text/markdown` через `src/proxy.ts` с корректным `Vary: Accept` и `<link rel="alternate" type="text/markdown">` в метаданных — полностью из JSON-кеша и статических справочников (0 `SELECT`).
  - `/llms.txt` и `/llms-full.txt` формируются динамически из актуальных тарифов, каталога журналов, базы знаний и кеша статей блога (0 `SELECT`).
  - `robots.txt` содержит `Content-Signal: search=yes, ai-input=yes, ai-train=no`, сохраняя `Clean-param`, `Host` и блокировку приватных разделов.
- **AC6. Тесты и верификация.** Написаны автотесты на атомарность записи/чтения, гарантию **0 вызовов `db`** на прогретом кеше, временные окна акций и отложенных статей, JWT-бейдж без БД, генерацию Markdown / `llms.txt` и контент-негоциацию `Accept: text/markdown` + `Vary: Accept`. `npm run typecheck` и `npm run test:gate` зелёные.

## Что меняет деплой

Новые модули файлового JSON-кеша и Markdown-представлений промо-страниц, шаг прогрева JSON-снапшотов в `scripts/prewarm-routes.sh` (каталог `/var/www/wesetupru/data/promo-cache` создаётся автоматически самим процессом без `root`). Схема БД и переменные окружения не меняются.
