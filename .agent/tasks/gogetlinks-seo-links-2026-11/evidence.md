# Evidence — gogetlinks-seo-links-2026-11

Task: `gogetlinks-seo-links-2026-11`  
Branch: `feat/gogetlinks-seo-links`  
Base: `7539f198be4d691c224fcc44acb150f5253db178`  
Date: 2026-11-05

## Обзор реализации

В рамках задачи реализована интеграция с биржей GoGetLinks (`api-anything`, Tier 1 HTTP-транспорт), двусторонние чаты с вебмастерами, аналитика Similarweb, планировщик закупок слотов с защитой от непреднамеренных расходов (строго ручное подтверждение человеком) и полноценный административный раздел `/root/seo/links`.

---

## Соответствие критериям приёмки (AC1–AC8)

### AC1: Схема данных PostgreSQL и шифрование секретов
- **Файлы:** `prisma/schema.prisma`, `src/lib/integration-crypto.ts`
- **Реализация:**
  - Добавлены 9 моделей: `GglAccount`, `GglCampaign`, `SeoCompetitorSnapshot`, `GglArticle`, `GglOrder`, `GglThread`, `GglMessage`, `GglSchedulePlan`, `GglPlannedSlot`.
  - Учётные данные (`passwordEnc`, `sessionEnc`) зашифрованы алгоритмом AES-256-GCM.
  - Поля сумм и балансов используют `Decimal(12,2)` / копейки `Int`.
  - Связи внешних ключей поддержаны индексами и уникальными ограничениями. Ссылки на пользователей (`updatedByUserId`, `initiatedByUserId`, `approvedByUserId` и др.) выполнены скалярно без модификации модели `User`.
- **Статус:** `PASS`

### AC2: Спецификация `api-anything` (Tier 1) и фоновая синхронизация
- **Файлы:** `config/api-anything/sites/gogetlinks.json`, `src/lib/seo/gogetlinks-client.server.ts`, `src/lib/seo/gogetlinks-codec.ts`, `src/lib/seo/gogetlinks-sync.ts`, `src/lib/seo/gogetlinks-codec.test.ts`
- **Реализация:**
  - Подготовлен декларативный конфиг `gogetlinks.json` с операциями чтения (`listActiveCampaigns`, `listCampaignPaidLinks`, `searchDonorSites`, `listArticles`, `listMessageThreads`, `getMessageThread`) и записи (`createOrUpdateCampaign`, `uploadArticle`, `submitLinkOrder`, `sendThreadMessage`, `reviewPlacementAction`).
  - Поддержка кодировки `windows-1251` с конвертацией в UTF-8.
  - Автоматическая поддержка сессии через `POST /user/signIn` и сохранение кук.
- **Тесты:** `src/lib/seo/gogetlinks-codec.test.ts` (14 тестов pass).
- **Статус:** `PASS`

### AC3: Изоляция проектов `wesetup.ru` и прозрачная атрибуция закупок
- **Файлы:** `src/lib/seo/gogetlinks-ui-format.ts`, `src/lib/seo/gogetlinks-ui-format.test.ts`, `src/app/api/root/gogetlinks/overview/route.ts`
- **Реализация:**
  - Кампании классифицируются по флагу `isWesetup = (domain === "wesetup.ru")`.
  - Архивные и сторонние проекты GoGetLinks по умолчанию скрыты и доступны только в режиме чтения при явном включении переключателя архива.
  - Поля атрибуции `origin` (`manual_wesetup`, `scheduled_wesetup`, `external_ggl`), `initiatedByName`, `approvedByName`, `sentByName` форматируются функцией `formatOrderAttribution`.
- **Тесты:** `src/lib/seo/gogetlinks-ui-format.test.ts` pass.
- **Статус:** `PASS`

### AC4: Двусторонние чаты с вебмастерами и приёмка размещений
- **Файлы:** `src/components/root/seo-links/ChatsTab.tsx`, `src/app/api/root/gogetlinks/threads/route.ts`, `src/app/api/root/gogetlinks/threads/[id]/route.ts`, `src/app/api/root/gogetlinks/orders/[id]/review/route.ts`, `src/components/root/seo-links/OrdersRegistryTab.tsx`
- **Реализация:**
  - Двухколоночный мессенджер с фильтрацией по непрочитанным и ожидающим ответа тредам.
  - Отправка ответов вебмастеру от лица аккаунта GoGetLinks с записью автора ответа.
  - Рецензирование размещений из статуса `on_check`: кнопки «Принять» и «На доработку» (с обязательным комментарием замечаний).
  - Уведомления платформенным администраторам в Telegram/Email при поступлении новых ревью и сообщений.
- **Статус:** `PASS`

### AC5: Планировщик от данных Similarweb + Topvisor и подготовка статей
- **Файлы:** `src/lib/seo/gogetlinks-planner.ts`, `src/lib/seo/gogetlinks-planner.test.ts`, `src/app/api/root/gogetlinks/similarweb/route.ts`
- **Реализация:**
  - Импорт и хранение конкурентных срезов Similarweb в `SeoCompetitorSnapshot`.
  - Алгоритм скоринга посадочных страниц: приоритет ключевых кластеров с позициями `4–30` в Topvisor и страниц без ссылок, балансировка безанкорных/брендовых анкоров (>= 50%).
  - Подбор качественных доноров (TF/CF, Trust, спамность, цена) с проверкой отсутствия дублирующих ссылок на wesetup.ru («1 донор = максимум 1 ссылка»).
  - Подготовка статей через ProjectsFlow очередь `ai-prompt-jobs` (`wesetup_ggl_article`).
- **Тесты:** `src/lib/seo/gogetlinks-planner.test.ts` (14 тестов pass).
- **Статус:** `PASS`

### AC6: Расписание с обязательным ручным подтверждением и финансовая защита
- **Файлы:** `src/lib/seo/gogetlinks-access.ts`, `src/lib/seo/gogetlinks-access.test.ts`, `src/lib/seo/gogetlinks-spend.test.ts`, `src/app/api/root/gogetlinks/slots/[id]/approve/route.ts`
- **Реализация:**
  - Слоты формируются в статусах `planned` -> `preparing` -> `pending_approval`.
  - **Никаких автосписаний в фоне:** закупка и списание средств инициируются исключительно по нажатию кнопки «Подтвердить закупку» человеком.
  - Финансовый контроль `canApproveGglSpend`: по умолчанию подтверждать могут только администраторы платформы (`isPlatformAdministrator`); специалист `seo` допускается только при включённом `allowSeoApproveWithinPlan` и соблюдении лимитов плана.
  - Атомарная блокировка слота (`approved_sending`), защита от двойных списаний по `idempotencyKey` и проверка баланса `availableRub`.
- **Тесты:** `src/lib/seo/gogetlinks-access.test.ts` (10 тестов pass), `src/lib/seo/gogetlinks-spend.test.ts` (10 тестов pass).
- **Статус:** `PASS`

### AC7: Пользовательский интерфейс `/root/seo/links` и крон-задачи
- **Файлы:**
  - `src/components/root/seo-subnav.tsx` (поднавигация с бейджем входящих для Здоровье / Позиции / Ссылки)
  - `src/app/root/seo/page.tsx`, `src/app/root/seo/positions/page.tsx`, `src/app/root/seo/links/page.tsx`
  - `src/app/root/seo/links/links-client.tsx`
  - `src/components/root/seo-links/SeoLinksHeaderMetrics.tsx`
  - `src/components/root/seo-links/PlannerTab.tsx`
  - `src/components/root/seo-links/OrdersRegistryTab.tsx`
  - `src/components/root/seo-links/ChatsTab.tsx`
  - `src/components/root/seo-links/DemandAndAccountTab.tsx`
  - `src/components/root/seo-links/ArticleDrawer.tsx`
  - `src/app/api/cron/gogetlinks/route.ts`
- **Реализация:**
  - Интегрирована общая поднавигация SEO-раздела.
  - Рабочее пространство `/root/seo/links` содержит 4 вкладки: «Планировщик и слоты», «Все закупки», «Чаты», «Спрос Similarweb и подключение».
  - Поддержка слайдовера редактирования и предварительного просмотра статьи `ArticleDrawer` с безопасным рендерингом HTML.
  - Фоновый крон `/api/cron/gogetlinks` (раз в 10 минут, авторизация через `CRON_SECRET`) синхронизирует баланс, заказы, сообщения, генерирует будущие слоты и отправляет уведомления без выполнения автосписаний.
  - Тест тем оформления `src/components/public/public-dark-theme.test.ts` пройден.
- **Статус:** `PASS`

### AC8: Качество кода, проверка типов, локализация и тесты
- **Сводка проверок:**
  1. `npm run i18n:check` — 97 словарей проверено, 0 отсутствующих ключей (`raw/i18n-check.txt`, EXIT_CODE=0).
  2. `npm run typecheck` — 0 ошибок компиляции TypeScript (`raw/typecheck.txt`, EXIT_CODE=0).
  3. `npx eslint src/lib/seo ... src/components/root/seo-links` — 0 ошибок, 0 предупреждений (`raw/eslint-seo.txt`, EXIT_CODE=0).
  4. Unit-тесты `npx tsx --test src/lib/seo/*.test.ts src/lib/platform-access.test.ts src/components/public/public-dark-theme.test.ts` — 72 теста, 72 pass, 0 fail (`raw/seo-and-access-tests.txt`, EXIT_CODE=0).
  5. `npm run test:gate` — 5700 тестов pass, отсутствие регрессий относительно базовой линии Windows CRLF master (`raw/test-gate.txt`).
- **Статус:** `PASS`

---

## Артефакты верификации

- `raw/seo-and-access-tests.txt` — 72 unit-теста (GGL кодеки, планировщик, доступ, форматирование, права администратора, темная тема).
- `raw/typecheck.txt` — результат `tsc --noEmit`.
- `raw/eslint-seo.txt` — чистый проход линтера по всем изменённым файлам SEO.
- `raw/i18n-check.txt` — проверка словарей локализации.
- `raw/repo-lint.txt` — полный аудит стилей и синтаксиса репозитория.
- `raw/test-gate.txt` — шлюз регрессионного тестирования репозитория.
- `problems.md` — журнал выявленных на промежуточных этапах замечаний (Pass 1: ESLint undici/any, Pass 2: dark-theme hex token) и их устранения.
