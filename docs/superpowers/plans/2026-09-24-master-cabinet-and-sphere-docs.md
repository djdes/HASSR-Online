# Мастер-кабинет справочников + сферы, журналы, приказы, чек-листы — план реализации

> **Для исполнителей:** работать по задачам сверху вниз, чекбоксы `- [ ]`. Процесс репозитория — repo-task-proof-loop (`.agent/tasks/<ID>/`: spec → evidence → verify). Перед любой правкой видимого UI — скилл `wesetup-design`.

**Дата:** 2026-09-24
**Цель:** (A) сотрудник бэк-офиса в отдельном «мастер-кабинете» загружает меню (для БЖГП) и сырьё (для скоропорта) один раз — и все пищеблоки, подключённые по коду справочника, получают эти списки в свои журналы; (B) сферы проработаны глубже (в т.ч. фитнес-центр), добавлены недостающие журналы, приказы и чек-листы стали частью обязательной начальной настройки, у каждой сферы — публичная страница из тех же данных.

**Архитектура:**
- A: мастер-кабинет = отдельная организация `kind="directory"`, которая вступает в существующий пул «служебного кода» (`serviceCode`/`linkedServiceCode`, `src/lib/dish-pool.ts`). Её списки лежат в новой таблице `SharedDirectoryItem`. Раздача: (1) слияние в `config` активных документов БЖГП/скоропорта у всех организаций пула (с учётом того, что прислал мастер в прошлый раз), (2) подсказки названий и «справочник организации» читают списки мастера на лету, (3) новые документы засеваются списками мастера. Пользователи такой организации видят только `/master` (proxy по JWT-признаку), в штатных списках пищеблоков их нет по построению (другая организация).
- B: единый источник правды — `SPHERE_RULES` (`src/lib/sphere-journal-rules.ts`), расширенный приказами и чек-листами; из него же строятся настройки журналов, онбординг и страницы `/dlya-*`. Новые журналы — на общем механизме табличного журнала-реестра (`src/lib/register-document.ts`).

**Стек:** Next.js 16 (App Router, `src/proxy.ts`), Prisma + PostgreSQL (`prisma db push`, изменения схемы только добавлением), NextAuth 4 (JWT), тесты `node --test` (`npm test`), `npm run typecheck`, `xlsx` для импорта.

**Spec (proof-loop):** `.agent/tasks/master-cabinet-2026-09/spec.md` (часть A), `.agent/tasks/sphere-docs-2026-09/spec.md` (часть B) — критерии приёмки ниже продублированы там.

## Global Constraints

- UI-тексты на русском, код и комментарии — на английском (как в репозитории). Коммиты — на русском.
- Изменения Prisma-схемы — только добавление полей/моделей (деплой делает `prisma db push --accept-data-loss`). Никаких `@unique` на существующие таблицы.
- Сиды идемпотентны: деплой гоняет их на проде при каждом выкате.
- Дизайн-система Wesetup: индиго `#5566f6`, `rounded-2xl/3xl`, переходы 150–200 мс; подтверждения — `ConfirmDialog`, не `window.confirm`; тосты — `sonner`.
- Никаких прямых SQL/ORM в TasksFlow (П-12); задачи в TF не трогаем.
- Аудит значимых действий — через существующий `AuditLog` (как `settings.dish_pool_link`).
- `src/lib/whats-new-notes.ts` и `CHANGES.md` исполнители НЕ правят — их обновляет оркестратор при сведении веток (иначе конфликты между параллельными ветками).
- Диск D: портит файлы — вся работа только в своём worktree на C: (`C:/wt/ws-a` или `C:/wt/ws-b`), в `D:/www/Wesetup.ru` ничего не писать. Параллельно в D: работает другая сессия.
- Не пушить: оркестратор сам сводит ветки в `master` и пушит (пуш = деплой на прод).

## Review Focus

1. **Существующий пул без мастера.** Пищеблоки, связанные служебным кодом до этой фичи, без мастер-кабинета должны работать ровно как раньше (подсказки блюд из пула, никаких изменений `config`).
2. **Локальные позиции пищеблока не теряются.** Мастер загрузил список, потом убрал из него блюдо: у пищеблока исчезает только то, что прислал мастер; своё, добавленное руками, остаётся (тест на слияние).
3. **Мастер не может выйти за `/master`.** Прямой заход на `/dashboard`, `/journals`, `/api/staff` и т.п. из сессии мастер-кабинета → редирект/403 (тест на proxy-решение).
4. **Кабинет-справочник не трогают фоновые задачи и тариф.** Автосоздание журналов, автопауза неактивных, дайджесты, compliance и т.п. не обрабатывают `kind="directory"`; истёкший триал не блокирует `/master`.
5. **Существующие организации не получают новые журналы включёнными.** После выката новые коды журналов у существующих организаций выключены (в `disabledJournalCodes`), у новых — включены только если обязательны по сфере.

---

# Часть A — мастер-кабинет справочников (ветка `feat/master-cabinet`, worktree `C:/wt/ws-a`)

### Task A1: модель, пул, раздача в журналы, доступ, фоновые задачи, создание кабинета (бэкенд)

**Files:**
- Modify: `prisma/schema.prisma` — `Organization.kind` (сразу после строки `linkedServiceCode`), relation `sharedDirectoryItems`, новая модель `SharedDirectoryItem`
- Create: `src/lib/master-directory.ts` — чтение/замена списков, diff, разбор файла/текста
- Create: `src/lib/master-directory-push.ts` — слияние в `config` документов
- Create: `src/lib/master-directory.test.ts`, `src/lib/master-directory-push.test.ts`
- Modify: `src/lib/name-suggestions-db.ts`, `src/lib/org-directory-db.ts` — списки мастера в подсказках/справочнике
- Modify: `src/lib/finished-product-document.ts` (`buildFinishedProductConfigFromUsers`), `src/lib/perishable-rejection-document.ts` (`buildPerishableRejectionConfigFromOrgData`), `src/lib/journal-default-configs.ts` — засев новых документов
- Modify: `src/app/api/settings/dish-pool/route.ts` — после подключения к коду раздать списки мастера этой организации
- Modify: `src/lib/auth.ts` (+ `src/types/next-auth.d.ts`) — признак `orgKind` в JWT/сессии (вход, смена активной организации, refresh)
- Modify: `src/proxy.ts` — белый список путей для `orgKind === "directory"`; `/master*` только для такой сессии
- Modify: cron-маршруты из списка ниже + гейт тарифа — исключить `kind: "directory"`
- Create: `src/app/api/settings/master-cabinet/route.ts` — GET статус / POST создать кабинет + пригласить сотрудника
- Create: `src/app/api/master/directory/route.ts` (GET, PUT), `src/app/api/master/directory/preview/route.ts` (POST)

**Interfaces (Produces — ими пользуется A2):**

```prisma
// Organization, сразу после linkedServiceCode:
  /// "regular" — обычный объект; "directory" — мастер-кабинет справочников пула служебного кода
  kind                 String                @default("regular")
  sharedDirectoryItems SharedDirectoryItem[]

model SharedDirectoryItem {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  /// "dish" — меню для БЖГП; "product" — сырьё для скоропорта
  kind           String
  name           String
  supplier       String?
  manufacturer   String?
  sortOrder      Int          @default(0)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([organizationId, kind])
}
```

```ts
// src/lib/master-directory.ts
export type SharedKind = "dish" | "product";
export type SharedItem = { name: string; supplier: string | null; manufacturer: string | null };
export const MASTER_ORG_KIND = "directory";
export const NOT_DIRECTORY_ORG_WHERE = { kind: { not: "directory" } } as const; // для cron-запросов
export async function findPoolMasterOrgId(orgId: string): Promise<string | null>; // организация kind=directory в пуле orgId (через resolveDishPoolOrgIds), иначе null
export async function listSharedItems(masterOrgId: string, kind: SharedKind): Promise<SharedItem[]>; // по sortOrder
export async function replaceSharedItems(masterOrgId: string, kind: SharedKind, items: SharedItem[]): Promise<{ total: number }>; // транзакция deleteMany+createMany, sortOrder = индекс
export function diffSharedNames(current: string[], next: string[]): { added: string[]; removed: string[]; unchanged: number }; // без учёта регистра и крайних пробелов
export function normalizeSharedItems(raw: SharedItem[]): SharedItem[]; // trim, схлопнуть пробелы, убрать пустые, дедуп без регистра (первое вхождение), максимум 5000
export function parseSharedItemsFromText(text: string): SharedItem[]; // строка = позиция; разделители строк и «;»; «Название | Поставщик | Изготовитель» опционально
export function parseSharedItemsFromSheet(buf: Buffer, filename: string): SharedItem[]; // xlsx/xls/csv; колонка названия по синонимам заголовка: наименование|название|блюдо|продукт|товар|номенклатура|name; поставщик|supplier; изготовитель|производитель|manufacturer; без заголовка — первая колонка
```

```ts
// src/lib/master-directory-push.ts
export function mergeSharedIntoList(current: string[], previousShared: string[], nextShared: string[]): string[];
// = (current без тех, что были в previousShared и нет в nextShared) + (nextShared, которых ещё нет в current); сравнение без регистра; порядок: сначала текущие как были, затем новые из nextShared по порядку мастера
export async function pushSharedListsToOrg(orgId: string, masterOrgId: string): Promise<{ documents: number }>;
// активные документы finished_product: config.itemsCatalog ← merge, config.sharedCatalog ← имена меню мастера;
// активные документы perishable_rejection: productLists[0].items ← merge (config.sharedProducts), suppliers ← merge (config.sharedSuppliers), manufacturers ← merge (config.sharedManufacturers);
// правка config — под withDocumentConfigLock (как saveOrgCommission в src/lib/brakerage-commission-org.ts)
export async function pushSharedListsToPool(masterOrgId: string): Promise<{ organizations: number; documents: number }>;
// все организации пула, кроме самой directory
```

- «Активный документ» — тот же критерий, что использует `saveOrgCommission` (посмотреть там и повторить).
- Подсказки: `listNameSuggestions` для scope `dish` добавляет имена меню мастера после своих и пуловых; для scope `product` — имена сырья мастера (сейчас `product` не пулится — пул не включать, только мастера). `org-directory-db` для kind `dish`/`product`/`supplier`/`manufacturer` — то же. Нет мастера в пуле → поведение не меняется (Review Focus 1).
- Засев новых документов: после сборки config, если у организации есть мастер в пуле — применить `mergeSharedIntoList(config.list, [], sharedNames)` и записать поля `shared*`.

**Доступ:**
- JWT: `token.orgKind: "regular" | "directory"` — выставлять при входе, при смене активной организации (`/api/me/active-organization`) и при периодическом refresh там же, где сейчас подтягиваются поля организации. Сессия: `session.user.orgKind`.
- `src/proxy.ts`: если `orgKind === "directory"` — разрешены только `/master`, `/master/*`, `/api/master/*`, `/api/auth/*`, `/api/me/active-organization`, `/login`, `/invite/*`, служебные `/_next/*` и статика; страницы → редирект `/master`, API → 403 `{ error: "Доступно только в мастер-кабинете" }`. Если `orgKind !== "directory"` и путь `/master*` → редирект `/dashboard`. Решение вынести в чистую функцию `evaluateDirectoryRequest(pathname, orgKind)` в `src/lib/master-directory-access.ts` и покрыть тестом (Review Focus 3).
- Фоновые задачи: в `organization.findMany` маршрутов `src/app/api/cron/{auto-create-journals,auto-pause-inactive,compliance,weekly-digest,weekly-ai-digest,mini-digest,anomaly-detect,predict-alerts,health-qr-missing,journal-automation}/route.ts` добавить `...NOT_DIRECTORY_ORG_WHERE` (проверить остальные cron-маршруты с `organization.findMany` и добавить туда, где они шлют уведомления/создают документы/считают оплату). Гейт тарифа/триала (найти, где блокируется доступ при истёкшей подписке: `plan-limits.server.ts`, layout дашборда или proxy) — `kind="directory"` не блокируется (Review Focus 4).
- `/root/organizations`: у directory-организации бейдж «Мастер-кабинет».

**Создание кабинета — `/api/settings/master-cabinet`:**
- Доступ: `hasFullWorkspaceAccess` (как у dish-pool), rate limit как у dish-pool.
- GET → `{ code: string | null, poolOrganizations: {id,name}[], master: null | { organizationId, name, users: {id,name,email,invited: boolean}[] } }`.
- POST `{ name: string, email: string }`:
  1. Код пула: если у организации нет ни `linkedServiceCode`, ни `serviceCode` — `ensureServiceCode(org)`; корневой код = `linkedServiceCode ?? serviceCode`.
  2. Если в пуле уже есть `kind="directory"` — не создавать второй: только пригласить пользователя в существующий.
  3. Иначе создать организацию: `name = "Мастер-кабинет — <имя корневой организации>"`, `kind="directory"`, `linkedServiceCode = корневой код`, `accountId` = accountId текущей организации (владелец сможет переключаться), `disabledJournalCodes` = все коды каталога. Без `create-organization.ts` (там засев журналов/триал/письма) — прямой `db.organization.create`.
  4. Пользователь: `role: "manager"`, `organizationId` = кабинет, имя и email из запроса; приглашение — существующим механизмом `InviteToken` + письмом (как `/api/users/invite`), в ответе вернуть и ссылку приглашения (на случай, если письмо не дошло). Email уже занят другим пользователем → 409 с понятным текстом.
  5. `AuditLog`: `master_cabinet.created` / `master_cabinet.invited`.

**API кабинета — `/api/master/*`** (доступ: активная организация сессии `kind="directory"`):
- `GET /api/master/directory?kind=dish|product` → `{ items: SharedItem[], total, code, organizations: {id,name}[] }`
- `POST /api/master/directory/preview` — `multipart/form-data` с `file` (xlsx/xls/csv, до 5 МБ) или JSON `{ text }` + `kind` → `{ items: SharedItem[] (нормализованные), diff: {added: string[], removed: string[], unchanged: number} }`
- `PUT /api/master/directory` `{ kind, items }` → `normalizeSharedItems` → `replaceSharedItems` → `pushSharedListsToPool` → `{ total, added, removed, organizations, documents }`; `AuditLog` `master_directory.updated` с числами.

- [ ] Step 1: схема + `npx prisma generate` + `npx prisma db push` в свою базу (`.env` worktree уже смотрит в `wesetup_wt_a`), `npx tsx prisma/seed.ts`.
- [ ] Step 2: тесты `master-directory.test.ts` (normalize: дубли без регистра, пустые, лимит; parse text с «;» и «|»; parse sheet: заголовок «Наименование», без заголовка; diff) и `master-directory-push.test.ts` (`mergeSharedIntoList`: добавление, удаление только прежних мастерских, локальные сохраняются, регистр, порядок) — сначала падают.
- [ ] Step 3: реализация `master-directory.ts`, `master-directory-push.ts` — тесты зелёные.
- [ ] Step 4: подсказки/справочник, засев новых документов, хук подключения к коду.
- [ ] Step 5: `orgKind` в JWT/сессии, `evaluateDirectoryRequest` + тест, proxy.
- [ ] Step 6: cron-исключения, гейт тарифа, бейдж в root.
- [ ] Step 7: `/api/settings/master-cabinet`, `/api/master/*`.
- [ ] Step 8: `npm run typecheck`, `npm test` — зелёные; коммит «Мастер-кабинет справочников: модель, раздача меню и сырья по коду, доступ» (без push).

### Task A2: интерфейсы — настройка кабинета у пищеблока и сам мастер-кабинет

**Files:**
- Create: `src/app/(dashboard)/settings/master-cabinet/page.tsx` + клиентский компонент в `src/components/settings/master-cabinet-client.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx` — карточка «Мастер-кабинет справочников» (только full access)
- Create: `src/app/master/layout.tsx`, `src/app/master/page.tsx`, `src/components/master/master-shell.tsx`, `src/components/master/master-directory-client.tsx`
- Create: `.agent/tasks/master-cabinet-2026-09/evidence.md`, `evidence.json`, скриншоты `shots/`

**Consumes:** API и типы из A1.

**`/settings/master-cabinet` (у пищеблока, full access):**
- `PageGuide` сверху: что это и как работает в 3 шага (создать кабинет → сотрудник бэк-офиса загружает меню и сырьё → все пищеблоки с этим кодом получают списки в БЖГП и скоропорт).
- Блок «Код справочника»: код крупно + «Скопировать», список подключённых объектов; подключение к чужому коду — переиспользовать `DishPoolSection` (`src/components/journals/dish-pool-section.tsx`).
- Блок «Мастер-кабинет»: нет кабинета — форма «ФИО сотрудника бэк-офиса», «Email» + кнопка «Создать мастер-кабинет» → `ConfirmDialog` со списком последствий → результат: «Приглашение отправлено на …» + ссылка приглашения с «Скопировать». Кабинет есть — его сотрудники (приглашён/вошёл), «Пригласить ещё», «Открыть мастер-кабинет» (для владельца аккаунта — переключение активной организации и переход на `/master`).

**`/master` (мастер-кабинет):**
- Свой layout (как `src/app/partner/layout.tsx`): логотип, «Мастер-кабинет справочников», название, бейдж кода «Код справочника ABCDE-FGH23» с копированием, «Подключено объектов: N», меню пользователя (выход; для владельца с несколькими организациями — «Вернуться в …»). Серверная проверка: активная организация не `directory` → `redirect("/dashboard")`.
- Вкладки: «Меню → БЖГП», «Сырьё → Скоропорт», «Объекты».
  - Вкладка списка: подсказка одной строкой («Этот список получат журналы бракеража готовой продукции во всех N объектах»), счётчик, поиск, таблица (для сырья — колонки «Поставщик», «Изготовитель»), кнопки «Загрузить Excel/CSV» и «Вставить списком».
  - Предпросмотр (диалог): «Добавится N · Уберётся M · Без изменений K», первые 20 новых и удаляемых, кнопка «Сохранить и разослать» → тост «Готово: список обновлён в N объектах (M журналов)».
  - Пустое состояние: объяснение + две кнопки загрузки + пример формата («одна позиция в строке» / «колонка Наименование»).
  - «Объекты»: названия подключённых пищеблоков и как подключить новый («в настройках БЖГП → Общий справочник блюд → ввести код»).
- Мобильная ширина 390 px — без горизонтального скролла страницы.

- [ ] Step 1: скилл `wesetup-design`; вёрстка `/settings/master-cabinet` + карточка в настройках.
- [ ] Step 2: layout и страница `/master`, загрузка/предпросмотр/сохранение.
- [ ] Step 3: e2e на своей базе (`wesetup_wt_a`): `next dev` из `c:/wt/ws-a` (строчная буква диска, свой порт, напр. 3031, `NEXT_DIST_DIR=.next-wt-a`): создать пищеблок X, ещё один Y подключить к коду X, в X создать мастер-кабинет, войти по приглашению, загрузить xlsx меню (3 блюда) и текст сырья (3 позиции) → у X и Y в активных БЖГП/скоропорте списки появились; убрать 1 блюдо у мастера → у Y ушло только оно, локальное блюдо Y осталось; из сессии мастера `/dashboard` → редирект на `/master`, `GET /api/staff` → 403. Скриншоты desktop 1440 и mobile 390 в `shots/`.
- [ ] Step 4: `npm run typecheck`, `npm test`, `npm run build` — зелёные; evidence.md/json (AC ниже); коммит «Мастер-кабинет справочников: настройка у пищеблока и кабинет бэк-офиса» (без push).

**Критерии приёмки A (AC):**
- AC-A1: пищеблок с полным доступом создаёт мастер-кабинет в настройках и получает рабочую ссылку приглашения.
- AC-A2: сотрудник бэк-офиса после входа видит только `/master`; любые другие страницы → `/master`, прочие API → 403.
- AC-A3: загрузка меню (Excel/CSV/текст) с предпросмотром различий; после сохранения меню есть в БЖГП всех объектов пула (список изделий активных документов + подсказки на сайте и в QR-форме).
- AC-A4: то же для сырья в скоропорте (изделия + поставщики/изготовители).
- AC-A5: удаление позиции у мастера убирает у объектов только её; свои позиции объектов сохраняются.
- AC-A6: новый документ БЖГП/скоропорта у объекта пула сразу содержит списки мастера; объект, подключившийся к коду позже, получает их при подключении.
- AC-A7: без мастер-кабинета пул работает как раньше; кабинет не обрабатывается фоновыми задачами и не блокируется тарифом.
- AC-A8: typecheck, тесты, build — зелёные.

---

# Часть B — сферы, журналы, приказы, чек-листы, страницы сфер (ветка `feat/sphere-docs`, worktree `C:/wt/ws-b`)

### Task B1: данные — новые журналы, сфера «Фитнес», правила сфер с приказами и чек-листами, типовые чек-листы

**Files:**
- Modify: `src/lib/journal-catalog.ts` (новые коды в `EXTENDED_ONLY_JOURNALS`), `prisma/seed.ts` (шаблоны), `src/lib/register-document.ts` (`REGISTER_DOCUMENT_TEMPLATE_CODES` + поля), `src/lib/onboarding-presets.ts` (`ALL_JOURNAL_CODES`), `src/content/journal-info.ts`, `src/content/journal-seo.ts`, `src/lib/journal-sample-fixtures.ts` и прочие поштучные таблицы, которых требует рецепт `docs/superpowers/specs/journal-migration-recipe.md` (для реестрового журнала — по образцу `complaint_register`)
- Create: `prisma/seed-disable-new-journals-2026-09.ts` (+ подключить так же, как подключён `prisma/seed-disable-health-check.ts` в деплое) — у существующих организаций новые коды добавить в `disabledJournalCodes`, идемпотентно
- Modify: `src/lib/org-profile.ts` (`ORG_SPHERES` + `fitness`), `src/lib/org-lookup-map.ts` (ОКВЭД 93.11/93.12/93.13/93.19/96.04 → `fitness`), `src/lib/sphere-positions.ts` (должности фитнеса: администратор, тренер, уборщица, техник бассейна)
- Modify: `src/lib/sphere-journal-rules.ts` — `SphereRules` + `ordersRequired`, `ordersRecommended`, `checklistJournals`; правила для `fitness`; новые журналы и 9 «ничейных» журналов разнести по сферам
- Create: `src/lib/checklist-defaults.ts` (+ тест) — типовые пункты чек-листов по журналам
- Modify: тест `src/lib/sphere-journal-rules.test.ts` — новые проверки
- Modify: 43 места с «35 журналов» → общая константа из каталога (напр. `JOURNALS_TOTAL` в `journal-catalog.ts`, в текстах — склонение через существующий помощник плюрализации или «N журналов»)

**Новые журналы** (все — реестровые документы, как `complaint_register`; тариф — расширенный):

| code | Название | Поля (key: label, type) | Сферы |
|---|---|---|---|
| `daily_samples` | Журнал отбора и хранения суточных проб | date: Дата, date · meal: Приём пищи, select(Завтрак/Второй завтрак/Обед/Полдник/Ужин) · dish: Блюдо, text · mass: Масса пробы, г, number · takenAt: Время отбора, time · storageTemp: Температура хранения, °C, number · disposedAt: Дата и время утилизации, text · responsible: Ответственный, text | обяз.: education, medical; реком.: canteen, catering, hotel |
| `vitaminization` | Журнал проведения витаминизации третьих и сладких блюд | date · dish: Блюдо · preparation: Препарат · portions: Кол-во порций, number · amount: Внесено витамина, г, number · addedAt: Время внесения, time · servedAt: Время приёма блюда, time · responsible | обяз.: education, medical |
| `ration_control` | Ведомость контроля за рационом питания | period: Период (10 дней/месяц), text · productGroup: Группа продуктов, text · normPerPerson: Норма на 1 человека, г, number · factPerPerson: Фактически на 1 человека, г, number · deviation: Отклонение, %, number · note: Примечание, text | реком.: education, medical |
| `transport_temperature` | Журнал контроля температуры при транспортировке | date · vehicle: Транспорт / госномер · route: Маршрут / получатель · product: Продукция · loadTemp: Температура при загрузке, °C, number · unloadTemp: Температура при выгрузке, °C, number · time: Время, time · responsible | реком.: catering, production, retail |
| `tableware_breakage` | Журнал учёта боя посуды | date · item: Посуда / инвентарь · quantity: Кол-во, number · zone: Где (зал/кухня/бар), text · cause: Причина, text · fragments: Осколки собраны и утилизированы, select(Да/Нет) · responsible | реком.: restaurant, cafe, bar, canteen, fastfood |
| `pool_water_control` | Журнал контроля качества воды в бассейне | date · time: Время, time · pool: Бассейн / ванна, text · waterTemp: Температура воды, °C, number · freeChlorine: Свободный хлор, мг/л, number · boundChlorine: Связанный хлор, мг/л, number · ph: pH, number · transparency: Прозрачность, text · visitors: Посетителей за сеанс, number · responsible | обяз. при наличии бассейна: fitness; реком.: hotel |

Правовые основания в `law`/`basis`: для `daily_samples`, `vitaminization`, `ration_control` — СанПиН 2.3/2.4.3590-20 (номер приложения указывать только если он уже есть в коде или подтверждён официальным текстом; не выдумывать); `transport_temperature` — ТР ТС 021/2011, basis `haccp`; `tableware_breakage` — `practice`; `pool_water_control` — СП 2.1.3678-20, basis `sanpin`, `note: "проверить формулировку у юриста"` (как у retail).

**Сфера `fitness`** — «Фитнес-центр / Спортклуб / Бассейн», preset `other`, бумажные — `PAPER_FULL`:
- electronicRequired: `pest_control` (СанПиН 3.3686-21, sanpin); `pool_water_control` (condition «если есть бассейн»); `hygiene`, `cold_equipment_control` (condition «если есть фитнес-бар с продуктами»)
- electronicRecommended: `cleaning`, `general_cleaning`, `disinfectant_usage`, `uv_lamp_runtime`, `staff_training`, `accident_journal`, `complaint_register`, `climate_control`, `equipment_maintenance`, `breakdown_history`, `med_books`
- intro: для фитнеса пищевые журналы нужны только при баре; основа — бассейн, дезинфекция, уборки, охрана труда.

**Приказы по сферам** (коды из `src/lib/orders/catalog.ts`; проверить наличие каждого кода):
- пищевые сферы (restaurant, cafe, bar, canteen, fastfood, bakery, catering, hotel, gas_station, retail, production, other): required `haccp-responsible`, `sanitary-responsible`, `journals-intro`, `ppk-approval`; recommended `haccp-team`, `incoming-control`, `cleaning-schedule`, `disinfection`, `medical-examinations`, `workwear` (+ `metrology` для production, bakery)
- education, medical: как пищевые + `daily-samples` в required
- fitness: required `sanitary-responsible`, `journals-intro`, `ppk-approval`, `disinfection`; recommended `cleaning-schedule`, `medical-examinations`, `workwear`

**Чек-листы по сферам** (`checklistJournals` — журналы, для которых сфере показываем настройку чек-листа): пищевые — `cleaning`, `general_cleaning`, `disinfectant_usage`, `cold_equipment_control`; + `uv_lamp_runtime` для education/medical; fitness — `cleaning`, `general_cleaning`, `disinfectant_usage`, `uv_lamp_runtime`, `pool_water_control`.

**Типовые чек-листы** — `src/lib/checklist-defaults.ts`:
```ts
export type DefaultChecklistItem = { title: string; frequency: "daily" | "weekly" | "monthly"; required: boolean; category?: string };
export const CHECKLIST_DEFAULTS: Record<string, DefaultChecklistItem[]>; // 5–8 конкретных пунктов для каждого кода из checklistJournals всех сфер
export function defaultChecklistFor(code: string): DefaultChecklistItem[]; // [] если нет
```
Пункты — конкретные действия в стиле UX-принципа 3 CLAUDE.md («1) возьми… → 2) …»), не общие слова. Поля `JournalChecklistItem` сверить со схемой (`schema.prisma` ~L2389).

**Тесты** (`sphere-journal-rules.test.ts` и новый `checklist-defaults.test.ts`): у каждой сферы (включая fitness) все коды журналов есть в каталоге; required ∩ recommended = ∅; все `ordersRequired/ordersRecommended` есть в `ORDER_TEMPLATES`; каждый код в `checklistJournals` имеет непустой `defaultChecklistFor`; новые коды есть в `REGISTER_DOCUMENT_TEMPLATE_CODES`, `ALL_JOURNAL_CODES`, `JOURNAL_INFO`.

- [ ] Step 1: тесты (падают) → каталог, сид, реестр, инфо-страницы, фикстуры → зелёные.
- [ ] Step 2: сид отключения новых журналов у существующих организаций + подключение к деплою по образцу health-check; прогнать дважды на своей базе — второй раз без изменений.
- [ ] Step 3: сфера fitness, ОКВЭД, должности; правила сфер с приказами/чек-листами; типовые чек-листы.
- [ ] Step 4: «35 журналов» → константа (проверить `grep -rn "35 журнал" src` — пусто).
- [ ] Step 5: `npm run typecheck`, `npm test`; коммит «Новые журналы (суточные пробы, витаминизация, рацион, перевозка, бой посуды, вода в бассейне), сфера фитнес, приказы и чек-листы по сферам» (без push).

### Task B2: онбординг «Документы», настройки журналов, страницы сфер

**Files:**
- Modify: `prisma/schema.prisma` — `Organization.checklistsReviewedAt DateTime?` сразу после `disabledJournalCodes` (только если нет подходящего существующего поля для отметки «чек-листы проверены»)
- Modify: `src/lib/onboarding-core-status.ts` — `ordersDone` (все `ordersRequired` сферы имеют `CompanyOrder`), `checklistsDone` (`checklistsReviewedAt` задан); `setupFinished` требует оба
- Modify: `src/app/(dashboard)/settings/onboarding/page.tsx` — 4-я фаза «Документы» (Приказы + Чек-листы)
- Modify: `src/components/dashboard/quick-start-card.tsx` — шаг «Приказы и чек-листы»
- Create: `src/app/api/settings/onboarding/checklists/route.ts` — POST `{ action: "fill-defaults", code }` (вставить типовые пункты, если у журнала пунктов нет) / POST `{ action: "mark-reviewed" }`
- Modify: `src/app/(dashboard)/orders/[code]/…` — поддержать `?from=onboarding` → после сохранения вернуть в онбординг
- Modify: `src/components/settings/journals-settings-client.tsx` (или где группы required/recommended) — показать основание/условие и у выключенных обязательных — «Обязателен для вашей сферы — включите»
- Modify: `src/content/niches.ts` (поле `sphere` у ниши; ручные списки журналов больше не источник), `src/components/landing/niche-landing.tsx` (секции из `SPHERE_RULES`), `src/components/landing/industries-grid.tsx`
- Create: `src/app/dlya-fitnes-centra/page.tsx` (+ запись в `niches.ts`)

**Фаза «Документы» в `/settings/onboarding`:**
- «Приказы»: обязательные приказы сферы — строки «Название · Создан № … от … / Не оформлен · [Оформить]» (→ `/orders/<code>?from=onboarding`); рекомендуемые — свёрнутым списком. Прогресс «Оформлено 2 из 4».
- «Чек-листы»: журналы из `checklistJournals` сферы, которые включены у организации: «N пунктов» / «Пусто · [Заполнить типовыми]» / «[Открыть редактор]» (→ `/settings/journal-checklists/<code>`); внизу кнопка «Чек-листы проверены» (`mark-reviewed`).
- Фаза считается пройденной при `ordersDone && checklistsDone`; `QuickStartCard` показывает шаг до выполнения. Карточка появится у существующих организаций с неоформленными приказами — это намеренно (требование «чтобы всё было заполнено»).

**Страницы сфер `/dlya-*`:** секции в порядке: hero → «Что проверяет инспектор» (из `intro`/`introLaw`) → «Обязательные журналы» (название, основание, условие; ссылка на `/journals-info/<code>`) → «Рекомендуемые» → «Бумажные журналы (охрана труда и пожарная безопасность)» → «Приказы» (обязательные/рекомендуемые, ссылка на `/prikazy`) → «Чек-листы ежедневного контроля» (из `checklistJournals` + 2–3 пункта `CHECKLIST_DEFAULTS` для примера) → существующие боли/кейсы/FAQ/CTA. Новая `/dlya-fitnes-centra` — тексты своими словами (не копировать serviceinspector). Карточка в `industries-grid.tsx`. Sitemap подхватывает `NICHES` сам — проверить.

- [ ] Step 1: скилл `wesetup-design`; статус онбординга + тесты на `ordersDone/checklistsDone` (без сферы, с пустыми/полными приказами).
- [ ] Step 2: фаза «Документы», API чек-листов, возврат из редактора приказа.
- [ ] Step 3: настройки журналов (основание, «обязателен — включите»).
- [ ] Step 4: страницы сфер из правил + `/dlya-fitnes-centra` + сетка отраслей; тест коллизий маршрутов зелёный.
- [ ] Step 5: e2e на `wesetup_wt_b` (`next dev` из `c:/wt/ws-b`, порт 3032, `NEXT_DIST_DIR=.next-wt-b`): новая организация сферы fitness → в настройках журналов обязательные/рекомендуемые верные; фаза «Документы»: оформить 1 приказ → прогресс растёт; «Заполнить типовыми» → пункты появились; «Чек-листы проверены» → шаг закрыт; `/dlya-fitnes-centra` и `/dlya-shkoly…`/`/dlya-detskogo-sada` показывают журналы/приказы/чек-листы из правил. Скриншоты 1440 и 390 в `shots/`.
- [ ] Step 6: `npm run typecheck`, `npm test`, `npm run build`; evidence; коммит «Приказы и чек-листы в начальной настройке, страницы сфер из правил, страница для фитнес-центров» (без push).

**Критерии приёмки B (AC):**
- AC-B1: 6 новых журналов в каталоге, создаются и заполняются как табличные реестры, есть на `/journals-info`; у существующих организаций выключены.
- AC-B2: сфера «Фитнес-центр / Спортклуб / Бассейн» выбирается в анкете и настройках, ОКВЭД 93.1x/96.04 подсказывает её; обязательные включены, рекомендуемые показаны выключенными.
- AC-B3: у каждой сферы есть обязательные и рекомендуемые приказы и журналы для чек-листов; тесты согласованности правил зелёные.
- AC-B4: в начальной настройке есть фаза «Документы»: приказы (оформление с возвратом) и чек-листы (типовые одним нажатием, отметка «проверены»); `QuickStartCard` и статус учитывают её.
- AC-B5: страницы `/dlya-*` строятся из тех же правил (журналы с основаниями, приказы, чек-листы); есть `/dlya-fitnes-centra`, она в сетке отраслей и в sitemap.
- AC-B6: «35 журналов» нигде не зашито; typecheck, тесты, build — зелёные.

---

# Сведение и выкат (оркестратор)

- [ ] Проверка каждой ветки: свежий typecheck/test/build в её worktree, просмотр диффа, скриншоты.
- [ ] `git fetch`; ветку A → rebase на `origin/master`; ветку B → rebase на результат; конфликты (`schema.prisma`, настройки) — вручную.
- [ ] `src/lib/whats-new-notes.ts` (категории «Мастер-кабинет», «Журналы и сферы», «Начальная настройка») и запись в `CHANGES.md` (формат «Было. Теперь…», чистый текст).
- [ ] `git push origin HEAD:master` → деплой GitHub Actions; проверка `.build-sha`, `pm2 status haccp-online`, HTTP 200; на проде: `/dlya-fitnes-centra` отдаётся, `/master` без сессии → вход.
- [ ] Удалить worktree `C:/wt/*` и базы `wesetup_wt_*`.
