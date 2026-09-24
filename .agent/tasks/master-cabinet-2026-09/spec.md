# Spec (frozen 2026-09-24): мастер-кабинет справочников

Источник: `docs/superpowers/plans/2026-09-24-master-cabinet-and-sphere-docs.md` (общие ограничения и Review Focus — там же, обязательны).

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
