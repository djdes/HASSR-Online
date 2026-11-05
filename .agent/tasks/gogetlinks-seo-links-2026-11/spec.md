# Ссылочное продвижение Wesetup через GoGetLinks (`api-anything`), чаты с вебмастерами и планировщик закупок

Task: `gogetlinks-seo-links-2026-11` · заморожено 2026-11-05 до реализации.

## Запрос и контекст

После перезагрузки внутренней оптимизации `wesetup.ru` (посадочные под коммерческие кластеры, статьи блога на RU/EN/UZ, микроразметка, связка позиций с Topvisor) следующий рычаг роста органики против `haccp-online.ru` и `checkoffice.ru` — системное наращивание качественного ссылочного веса.

В платформенной админке создаётся раздел **`/root/seo/links`** («Ссылки») — третья вкладка рядом со «Здоровьем» (`/root/seo`) и «Позициями» (`/root/seo/positions`), интегрирующий биржу GoGetLinks через транспорт `api-anything` (Tier 1 без браузера):
1. **Полная синхронизация закупок и финансов** — баланс, кампании, все заявки и размещения, расходы, прозрачная атрибуция (кто купил/подтвердил), доноры и ссылки.
2. **Двусторонние чаты с вебмастерами** прямо в админке с возможностью отвечать от лица аккаунта и кнопками приёмки/доработки размещений.
3. **Умный подбор доноров и статей от данных конкурентов** — срезы Similarweb (`SeoCompetitorSnapshot`) + позиции Topvisor (`src/lib/topvisor.ts`) + генерация статей через штатную очередь ProjectsFlow `ai-prompt-jobs` (`wesetup_ggl_article`).
4. **Прозрачный планировщик закупок с ручным подтверждением** — календарь слотов на 30 дней вперёд с лимитом цены за ссылку и месячным бюджетом. Никаких автосписаний: реальная закупка происходит **только после клика «Подтвердить»** человеком.

---

## Критерии приёмки (Acceptance Criteria)

- **AC1: Схема данных PostgreSQL и шифрование секретов (`prisma/schema.prisma`, `integration-crypto.ts`)**
  - В `prisma/schema.prisma` добавлены 9 моделей: `GglAccount`, `GglCampaign`, `SeoCompetitorSnapshot`, `GglArticle`, `GglOrder`, `GglThread`, `GglMessage`, `GglSchedulePlan`, `GglPlannedSlot`.
  - Учётные данные и сессионные куки в `GglAccount` шифруются AES-256-GCM (`passwordEnc`, `sessionEnc` через `src/lib/integration-crypto.ts` / `INTEGRATION_KEY_SECRET`).
  - Финансовые поля используют `Decimal(12,2)` / копейки `Int`.
  - Внешние ключи связывают `Ggl*` между собой (`GglCampaign` <-> `GglArticle`, `GglOrder`, `GglThread`, `GglSchedulePlan`; `GglThread` <-> `GglMessage`; `GglOrder` <-> `GglArticle`, `GglPlannedSlot`, `GglThread`; `GglSchedulePlan` <-> `GglPlannedSlot`; `GglPlannedSlot` <-> `SeoCompetitorSnapshot`, `GglArticle`), а поля пользователей `updatedByUserId`, `createdByUserId`, `initiatedByUserId`, `approvedByUserId`, `sentByUserId` остаются скалярными `String?` без мутации модели `User`.
  - Созданы индексы по `campaignId`, `status`, `scheduledDate`, `lastMessageAt`, а также уникальные ограничения на внешние ID и ключи идемпотентности.

- **AC2: Спецификация `api-anything` (Tier 1) и фоновая синхронизация (`config/api-anything/sites/gogetlinks.json`, `gogetlinks-client.server.ts`)**
  - Чистая спецификация `gogetlinks.json` в `config/api-anything/sites/` без кук и секретов (`loginCookies: ["hash", "PHPSESSID"]`, декодирование `windows-1251` в UTF-8).
  - Набор операций чтения (`readOnly: true`): `listActiveCampaigns`, `listClosedCampaigns`, `listCampaignPaidLinks`, `listReviewsByTab`, `searchDonorSites`, `listArticles`, `getArticle`, `listMessageThreads`, `getMessageThread`.
  - Набор операций записи (`--write`): `createOrUpdateCampaign`, `uploadArticle`, `submitLinkOrder`, `sendThreadMessage`, `reviewPlacementAction`.
  - Сессия кэшируется в `GglAccount.sessionEnc` и прозрачно обновляется через `POST /user/signIn` при протухании.

- **AC3: Изоляция проектов `wesetup.ru` и прозрачная атрибуция закупок**
  - В общем кабинете GoGetLinks кампании классифицируются по домену: `isWesetup = (domain === "wesetup.ru")`.
  - По умолчанию в интерфейсе `/root/seo/links` отображаются только закупки, кампании и чаты `wesetup.ru`, сторонние архивные проекты (`yesbeat.ru` и др.) скрыты под переключателем архива (только чтение).
  - Любые операции планировщика и отправка заявок программно разрешены только для кампаний с `isWesetup = true`.
  - Каждая операция закупки и сообщения имеет явную атрибуцию (`origin`: `"manual_wesetup"` | `"scheduled_wesetup"` | `"external_ggl"`, `initiatedByUserId`/`initiatedByName`, `approvedByUserId`/`approvedByName`, `sentByUserId`/`sentByName`).

- **AC4: Двусторонние чаты с вебмастерами и приёмка размещений**
  - Двухколоночный интерфейс диалогов в `/root/seo/links` (вкладка «Чаты»): список тредов с фильтрацией по непрочитанным и требующим ответа, карточка заказа/донора, лента переписки, поле ответа с мгновенной отправкой в GoGetLinks.
  - Действия проверки размещений из статуса `on_check`: «Принять» или «На доработку» с обязательным комментарием.
  - Оперативные уведомления админам при поступлении новых сообщений или заявок на проверку.

- **AC5: Планировщик от данных Similarweb + Topvisor и подготовка статей (`wesetup_ggl_article`)**
  - Хранение срезов спроса Similarweb в `SeoCompetitorSnapshot` (импорт агентом, OCR скриншотов).
  - Прозрачный скоринг посадочных `wesetup.ru`: приоритет страниц с позициями `4–30` в Topvisor или с `0` ссылок по ключевым кластерам Similarweb, естественный микс анкоров (>= 50% безанкорных/брендовых).
  - Отбор доноров из `/searchSites`: правило «1 донор = максимум 1 ссылка на wesetup.ru», соответствие порогам качества (TF/CF, Траст, трафик) и лимиту цены.
  - Подготовка статей под выбранного донора и посадочную через очередь ProjectsFlow `ai-prompt-jobs` (`wesetup_ggl_article`).

- **AC6: Расписание с обязательным ручным подтверждением и финансовая защита**
  - Планы `GglSchedulePlan` (разовый пакет `10 000 ₽` или регулярный `5 000 ₽/мес`, потолок цены ссылки, дни недели).
  - Слоты `GglPlannedSlot` формируются заранее (`planned` -> `preparing` -> `pending_approval`), но никогда не отправляются автоматически.
  - Реальная закупка и списание средств (`approved_sending` -> `ordered`) происходят **строго после ручного клика «Подтвердить»** человеком.
  - Финансовый гейт (`canApproveGglSpend`): по умолчанию право подтверждения есть только у `isPlatformAdministrator` (владелец `isRoot` или полный пресет «Администратор»); специалист `seo` допускается только если в `GglAccount` включён флаг `allowSeoApproveWithinPlan` и слот находится в рамках утверждённого плана.
  - Финансовая защита: проверка достаточности `availableRub`, защита от двойных списаний через `idempotencyKey` и атомарную смену статуса.

- **AC7: Пользовательский интерфейс `/root/seo/links` и крон-задачи**
  - Третья вкладка в SEO-разделе (`/root/seo` Здоровье · `/root/seo/positions` Позиции · `/root/seo/links` Ссылки).
  - Четыре вкладки: «Планировщик и слоты», «Все закупки», «Чаты», «Спрос Similarweb и подключение».
  - Крон `/api/cron/gogetlinks` (раз в 10 минут, защищён `checkCronSecret`): синхронизация данных, достройка слотов на 30 дней вперёд, подготовка слотов на 7 дней, алерты по новым сообщениям, проверкам и нехватке баланса.
  - Журнал аудита `AuditLog` для всех ключевых действий.

- **AC8: Качество кода, проверка типов, локализация и тесты**
  - Проверка ключей локализации (`npm run i18n:check`) проходит без ошибок.
  - Проверка типов TypeScript (`npm run typecheck`) проходит чисто (0 ошибок).
  - Набор unit-тестов (`npm test` / `npm run test:gate`) выполняется успешно.
  - Линтер (`npm run lint`) выполняется без замечаний.

---

## Ограничения и правила (Constraints & Anti-Goals)

- **Никаких автоматических трат:** крон-планировщик никогда не отправляет платные заявки в GoGetLinks без ручного клика «Подтвердить».
- **Защита от повторных списаний:** любая операция записи блокируется в БД атомарным захватом статуса и `idempotencyKey` до отправки HTTP-запроса.
- **Изоляция проектов:** планировщик и закупки работают строго с кампаниями `isWesetup = true`.
- **Секреты вне Git:** логин, пароль и сессионные куки GoGetLinks хранятся в БД в зашифрованном виде (`AES-256-GCM`).
- **Соблюдение архитектуры ИИ:** генерация статей выполняется строго через очередь ProjectsFlow `ai-prompt-jobs` (`docs/ai-dispatcher.md`), сайт никогда не вызывает LLM напрямую.
