# ИИ-ассистенты и API (MCP + REST v1): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** руководитель на странице «ИИ-ассистенты и API» создаёт персональный ключ и за минуту подключает ChatGPT, Claude, Cursor или свой код. После этого в чате можно узнать, какие журналы сегодня не заполнены, отметить ячейки журнала-сетки и добавить сотрудника.

**Architecture:** один реестр инструментов `src/lib/public-api/tools` (Zod-схема, права, обработчик) обслуживает два входа. Первый — MCP-сервер `POST /api/mcp`, Streamable HTTP, без состояния, поддерживает и новую спецификацию 2026-07-28, и клиентов с `initialize`. Второй — REST `/api/v1/*` с автоматическим `openapi.json`. Запись идёт через уже существующий защищённый путь ИИ-помощника (`src/lib/ai-assistant/actions.ts`: ACL журнала, закрытые дни, своя строка, лимит тарифа), поэтому ключ не даёт больше прав, чем у его владельца в интерфейсе.

**Tech Stack:** Next.js 16 App Router (route handlers, `runtime = "nodejs"`), Prisma/PostgreSQL, Zod 4 (`z.toJSONSchema`), next-intl (каталоги ru/en/uz), `node:test` + tsx. Новых npm-зависимостей нет.

**Spec:** отдельной спеки нет: владелец попросил сразу план. Решения собраны ниже в разделе «Решения»; в Task 0 из раздела «Критерии приёмки» замораживается `.agent/tasks/ai-mcp-api-2026-10/spec.md` (proof loop из CLAUDE.md).

---

## Решения

Что сказал владелец: блок «где-то снизу» в настройках; API сайта и MCP для заполнения журналов, создания сотрудников и т. д.; цель — показать технологичность и дать реальное удобство («через ИИ заполнять журналы и получать информацию»).

Остальное решено при составлении плана (помечено «наше решение»). Владелец может поменять любой пункт до начала работ.

1. **Где в интерфейсе.** Отдельную страницу не создаём: расширяем существующую `/settings/api` и называем её «ИИ-ассистенты и API». Её карточка в новом меню находится в «Остальное → Подключения» (`src/lib/settings-cards.ts`, `settings_api`); переносим карточку последней в группу. *(наше решение: тест `app-nav.test.ts` проверяет каждую `page.tsx`, а новая страница добавила бы лишнюю правку меню.)*
2. **Ключи персональные.** Модель `ApiAccessKey`: ключ принадлежит пользователю и действует с его ролью. Хранится только SHA-256, полный ключ показываем один раз. Ключ можно назвать, выбрать права «чтение и запись» или «только чтение», видно время последнего вызова, отозвать ключ может любой руководитель организации. Старый общий ключ организации (`Organization.externalApiToken`, `/api/external/*`) не трогаем и прячем на той же странице в свёрнутый блок «Ключ для датчиков и старых интеграций». *(наше решение)*
3. **Кто выпускает ключи.** В v1 только руководство (`hasFullWorkspaceAccess`), без имперсонации ROOT и без партнёрского доступа. При каждом вызове заново проверяем, что владелец активен, работает в этой организации и всё ещё руководитель; иначе 403. *(наше решение)*
4. **Как подключаются ИИ.** Два способа на одном сервере:
   - заголовок `Authorization: Bearer wsk_…` на `POST /api/mcp` — для Claude Code, Cursor и своего кода;
   - секретная ссылка `POST /api/mcp/wsk_…` — для claude.ai/Claude Desktop и ChatGPT: их коннекторы без OAuth не умеют передавать заголовок.

   OAuth в v1 не делаем. *(наше решение: OAuth 2.1 — отдельный проект на авторизационный сервер и экран согласия. Ссылка с ключом равна паролю, интерфейс так и говорит.)*
5. **MCP поддерживает обе эпохи протокола.** Новая спецификация 2026-07-28 убрала `initialize` и сессии, требует `server/discover`, `_meta` в каждом запросе, заголовки `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` и `resultType` в результатах. Старые клиенты 2025-03-26…2025-11-25 работают через `initialize`. Отвечаем всегда одним JSON, без SSE; на GET и DELETE отвечаем 405. *(наше решение: какую эпоху понимают ChatGPT и Claude на момент выкладки, заранее не известно.)*
6. **Шесть инструментов v1:** `get_context`, `list_journals`, `get_journal_document`, `fill_journal_cells`, `list_employees`, `add_employee`. Запись в журналы — только в журналы-сетки (сотрудник × день), теми же правилами, что у встроенного ИИ-помощника. Журналы, где строки живут в `config` документа (уборка, реестры, приёмка), v1 только читает, а при записи отказывает со ссылкой на документ. *(наше решение: для этих журналов нужны описанные форматы по каждому, это фаза 2 через нормализаторы `dispatchExternalEntries`.)*
7. **Подтверждение записи** делает сам ИИ-клиент: Claude и ChatGPT показывают аргументы вызова и спрашивают разрешение. Инструкции сервера требуют пересказать запись пользователю. Каждая запись попадает в `AuditLog` как `public_api.call` с именем ключа и каналом. *(наше решение: двухшаговое «превью → подтвердить» через MCP удвоило бы вызовы.)*
8. **Тексты.** Интерфейс локализован (каталоги ru/en/uz). Описания инструментов для модели и инструкции сервера пишем на русском — так же, как данные организации. *(наше решение)*
9. **Ограничение частоты.** 120 вызовов в минуту на ключ, ответ 429 с `Retry-After`. *(наше решение)*

**Не делаем в v1:** OAuth; ключи рядовых сотрудников; запись в журналы-конфиги; ресурсы и подсказки MCP (resources/prompts); SSE и `subscriptions/listen`; CORS у REST; вебхуки v1.

## Что нужно от владельца (по CLAUDE.md)

Работу эти пункты не блокируют: в скобках умолчание, по которому план выполняется, если владелец не ответит иначе.

1. **Тариф.** Доступна ли функция на всех тарифах, включая бесплатный? *(умолчание: да, на всех.)*
2. **Секретная ссылка.** Допустим ли ключ в адресе для claude.ai и ChatGPT? *(умолчание: да, с предупреждением в интерфейсе. Альтернатива — только заголовок, тогда claude.ai и ChatGPT без OAuth не подключатся.)*
3. **Проверка на живых клиентах.** После выкладки проверка в ChatGPT и claude.ai требует аккаунтов владельца: свои коннекторы там бывают только на части тарифов. Нужно либо проверить самому по инструкции на странице, либо дать доступ. Без этого Task 10 закрывается только проверкой через Claude Code и MCP Inspector.

## Предусловия и соседняя сессия

- Начинать после того, как соседние сессии закоммитят новое меню (ветка `feat/nav-shell` / `feat/ppk-section`: `src/lib/app-nav.ts`, `src/lib/settings-cards.ts`) и локализацию (next-intl, `src/i18n/messages/*.json`, `src/i18n/message-contract.d.ts`). На 2026-10-16 обе работы не закоммичены в master (632 изменённых файла в рабочей копии), а правят в том числе `prisma/schema.prisma` и `src/app/(dashboard)/settings/api/*`.
- Общие файлы, которые трогает этот план, правятся точечно: `prisma/schema.prisma` (модель в конец файла и по одной строке связи в `Organization` и `User`), `src/lib/ai-assistant/actions.ts`, `src/lib/external/dispatch.ts` (одно слово `export`), `src/lib/rate-limit.ts`, `src/lib/audit-labels.ts`, `src/lib/settings-cards.ts`, `src/lib/route-titles.ts`, `src/i18n/messages/{ru,en,uz}.json`, `src/app/developers/page.tsx`, `src/lib/whats-new-notes.ts`. Остальное — новые файлы.
- Git: индекс общий с другими сессиями (memory `parallel-sessions-shared-git-index`). Не делать `git add` заранее, коммитить `git commit -- <свои пути>`, перед `git push origin master` согласовать с соседом.

## Global Constraints

- Тексты интерфейса — только через каталоги `src/i18n/messages/{ru,en,uz}.json`, пространство `settingsManagement.aiConnect`; после правки — `npm run i18n:types`.
- Дизайн-система: перед `.tsx` вызвать скилл `design-system`. Основной цвет `#5566f6` (hover `#4a5bf0`), `rounded-2xl`/`rounded-3xl`, переходы 150–200 мс, фокус `ring-[#5566f6]/15`. Отзыв ключа — `ConfirmDialog` с `variant="danger"` и `typeToConfirm`; `window.confirm/prompt` запрещены; тосты — `sonner`.
- Новые API-маршруты: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`; `params` в Next.js 16 — Promise, всегда `await params`.
- Новых npm-зависимостей нет: `package.json` и `package-lock.json` правят соседи. JSON Schema строим через `z.toJSONSchema` (zod ^4.3.6).
- Организацию берём только из ключа; `organizationId` из входа не принимаем. Все выборки — с `organizationId` ключа.
- В БД — только `sha256(secret)`; полный ключ возвращает один ответ на создание.
- MCP и REST v1 не читают cookie-сессию: только ключ.
- Формат ключа `wsk_` + 43 символа base64url; в тестах ключи собирать на лету (`"wsk_" + "x".repeat(43)`), чтобы `scripts/check-secrets.sh` не принял фикстуру за секрет.
- Локальные проверки — только на e2e-базе: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable DATABASE_URL_DIRECT=<то же> NEXTAUTH_URL=http://localhost:3000 NEXT_DIST_DIR=.next-e2e`. `.env` рабочей папки смотрит в боевую базу.
- Интеграцию с TasksFlow план не трогает. `add_employee` идёт через `createStaffMember`, поэтому автосвязка по телефону (П-8) работает так же, как из интерфейса.
- Коммиты на русском, `git commit -- <пути>`, затем `git push origin master` после согласования с соседом.

## Review Focus

1. **Владелец ключа уволен, архивирован, понижен или ушёл из организации.** Ключ должен перестать работать (403), а не сохранить права руководителя. Тесты — Task 2.
2. **Владелец работает в нескольких организациях** (`OrganizationMember`). Ключ привязан к организации, где выпущен, и не видит домашнюю или соседние. Тест — Task 2.
3. **Часовой пояс организации у полуночи** (Asia/Kamchatka, UTC+12). «Сегодня» — день организации, а не UTC. Тест — Task 4 (`dates.test.ts`).
4. **Клиенты разных эпох MCP**: `initialize` без заголовков, современный `_meta` с несовпадающими заголовками, пакеты, одни уведомления, неизвестная версия. Правильные статусы и коды, никогда не 500. Тесты — Task 5.
5. **Большая организация**: больше 300 сотрудников, документ с тысячами ячеек, огромный `config`. Отдаём флаг `truncated`, а не мегабайты. Тесты — Task 4 (`capList`, обрезка `config`).

---

## Карта файлов

```
prisma/schema.prisma                                  + model ApiAccessKey, связи в Organization/User
src/lib/public-api/
  keys.ts (+ .test.ts)                                генерация, хеш, формат ключа
  context.ts                                          тип ApiCallContext
  auth.ts (+ .test.ts, .db.test.ts)                   authenticateApiKey, extractApiKey, publicBaseUrl
  dates.ts (+ .test.ts)                               resolveDateKey, instantForDateKey, clampRange, capList
  run-tool.ts (+ .test.ts)                            права ключа, валидация, аудит записи
  key-admin.ts (+ .db.test.ts)                        выпуск, список, отзыв ключей
  tools/types.ts                                      ApiTool, ToolResult, toolInputJsonSchema
  tools/context-tools.ts                              get_context
  tools/journal-tools.ts                              list_journals, get_journal_document, fill_journal_cells
  tools/staff-tools.ts                                list_employees, add_employee
  tools/index.ts (+ registry.test.ts, tools.db.test.ts)  PUBLIC_API_TOOLS, findTool, toolsForAccess
  mcp/protocol.ts                                     версии, коды ошибок, serverInfo
  mcp/instructions.ts                                 MCP_SERVER_INSTRUCTIONS
  mcp/handle-message.ts (+ .test.ts)                  чистая обработка JSON-RPC обеих эпох
  mcp/http.ts (+ http.test.ts)                        Origin, CORS, ключ, разбор тела → Response
  rest/router.ts (+ .test.ts)                         сопоставление метод+путь → инструмент
  rest/openapi.ts (+ .test.ts)                        OpenAPI 3.1 из реестра
  rest/http.ts                                        /api/v1: индекс, openapi.json, вызовы, Idempotency-Key
src/app/api/mcp/route.ts                              POST/OPTIONS → MCP; GET/DELETE → 405
src/app/api/mcp/[key]/route.ts                        то же, ключ из пути
src/app/api/v1/[[...path]]/route.ts                   GET/POST → rest/http
src/app/api/settings/api-keys/route.ts                GET список, POST выпуск (сессия)
src/app/api/settings/api-keys/[id]/route.ts           DELETE отзыв (сессия)
src/app/(dashboard)/settings/api/page.tsx             переписать: ИИ-ассистенты и API
src/app/(dashboard)/settings/api/ai-connect-client.tsx    состояние страницы: ключи, новый ключ
src/app/(dashboard)/settings/api/ai-client-guides.tsx     вкладки Claude / ChatGPT / Cursor и Claude Code / REST
src/app/(dashboard)/settings/api/api-keys-list.tsx        список ключей и отзыв
src/app/(dashboard)/settings/api/connection-snippets.ts (+ .test.ts)  тексты для копирования
src/lib/ai-assistant/actions.ts                       экспорт схем с описаниями, executeProposedAction, entityId
src/lib/external/dispatch.ts                          export isConfigWriterJournal
src/lib/rate-limit.ts                                 publicApiRateLimiter
src/lib/audit-labels.ts                               подписи public_api.call, api_key.*
src/lib/settings-cards.ts, src/lib/route-titles.ts, src/i18n/messages/*.json   карточка и тексты
src/app/developers/page.tsx                           разделы MCP и REST v1
src/lib/whats-new-notes.ts                            новинка
```

## Критерии приёмки (для `.agent/tasks/ai-mcp-api-2026-10/spec.md`)

- **AC1.** Руководитель на `/settings/api` создаёт именной ключ (права «чтение и запись» по умолчанию или «только чтение») и один раз видит его целиком с кнопками копирования ключа и секретной ссылки. В списке ключей: имя, владелец, права, создан, последний вызов (или «ещё не использовался»). Отзыв через `ConfirmDialog` (danger, ввод «ОТОЗВАТЬ») отключает ключ со следующего запроса.
- **AC2.** В БД только `tokenHash`; ни один эндпоинт кроме ответа на создание не возвращает ключ или хеш.
- **AC3.** `POST /api/mcp` (Bearer) и `POST /api/mcp/{key}` работают по Streamable HTTP. Легаси: `initialize` с согласованием версии, `ping`, `tools/list`, `tools/call`, уведомления → 202. 2026-07-28: `server/discover`, `tools/list`, `tools/call` с проверкой заголовков, `resultType`, `UnsupportedProtocolVersion` (−32022), `HeaderMismatch` (−32020). GET и DELETE → 405, без ключа → 401, чужой `Origin` → 403.
- **AC4.** Шесть инструментов работают в рамках прав владельца: только организация ключа, выключенные журналы скрыты, закрытые документы и запертые дни не пишутся, `add_employee` — только руководитель, ключ «только чтение» не видит инструменты записи в `tools/list` и получает отказ при вызове.
- **AC5.** `/api/v1/*` повторяет инструменты; `GET /api/v1/openapi.json` — OpenAPI 3.1.0 со всеми путями; повтор `POST` с тем же `Idempotency-Key` возвращает прежний ответ с заголовком `idempotent-replayed: true`.
- **AC6.** Каждая успешная запись через ключ пишет одну строку `AuditLog` `public_api.call` (`details`: `tool`, `via`, `keyId`, `keyName`, `input`); выпуск и отзыв ключа — `api_key.created` / `api_key.revoked`. Все три видны на `/settings/audit` с русскими подписями.
- **AC7.** 121-й вызов за минуту по одному ключу → 429 с `Retry-After`.
- **AC8.** Старый ключ организации и `/api/external/*` работают без изменений.
- **AC9.** Карточка «ИИ-ассистенты и API» — последняя в «Остальное → Подключения». Страница читается на 360 px без горизонтальной прокрутки и в оболочке Mini App. Все тексты интерфейса есть в ru/en/uz.
- **AC10.** Настоящий MCP-клиент (MCP Inspector и Claude Code) подключается к локальному серверу, видит шесть инструментов и выполняет `list_journals` и `fill_journal_cells`.
- **AC11.** Обновлены `WHATS_NEW_NOTES` и `/developers` (MCP и REST v1).
- **AC12.** Зелёные `npm run typecheck`, `npm run lint`, `npm test`, `npm run i18n:check` и DB-тесты (`WESETUP_DB_TESTS=1`) на e2e-базе.

---

### Task 0: Подготовка

**Files:**
- Create: `.agent/tasks/ai-mcp-api-2026-10/spec.md`

- [ ] **Step 1: Синхронизироваться и проверить предусловия**

Run: `git pull origin master && git ls-files src/lib/settings-cards.ts src/i18n/messages/ru.json src/i18n/translator.ts`
Expected: все три пути выведены. Если какого-то нет, соседняя работа ещё не в master: остановиться и спросить владельца. Ветка без нового меню — в Task 8, шаг 6.

- [ ] **Step 2: Убедиться, что никто не правит те же места**

Run: `git log --oneline -5 -- src/lib/ai-assistant/actions.ts "src/app/(dashboard)/settings/api" src/lib/external/dispatch.ts && git status --short -- src/lib/ai-assistant "src/app/(dashboard)/settings/api" prisma/schema.prisma`
Expected: в `git status` нет чужих незакоммиченных правок этих путей. Если есть — согласовать с соседом через `ListAgents`/`SendMessage`.

- [ ] **Step 3: Сверить версию MCP**

Открыть `https://modelcontextprotocol.io/specification/` и `.../changelog`. Если вышла ревизия новее 2026-07-28, записать это в `spec.md` как риск. Реализацию не менять без решения владельца.

- [ ] **Step 4: Заморозить spec**

Через агента `task-spec-freezer` создать `.agent/tasks/ai-mcp-api-2026-10/spec.md`: разделы «Решения», «Не делаем в v1» и «Критерии приёмки» этого плана дословно, ссылка на план.

---

### Task 1: Модель ключа и формат

**Files:**
- Modify: `prisma/schema.prisma` (модель в конец файла; строка `apiAccessKeys ApiAccessKey[]` в `model Organization` и `model User`)
- Create: `src/lib/public-api/keys.ts`
- Test: `src/lib/public-api/keys.test.ts`

**Interfaces:**
- Produces:
  - `API_KEY_PREFIX = "wsk_"`
  - `type ApiKeyAccess = "read" | "write"`, `API_KEY_ACCESS_VALUES: readonly ["write", "read"]`
  - `MAX_ACTIVE_KEYS_PER_ORG = 20`
  - `generateApiKey(): { secret: string; tokenHash: string; displayPrefix: string }`
  - `hashApiKey(secret: string): string` — sha256 hex
  - `looksLikeApiKey(value: string): boolean` — `/^wsk_[A-Za-z0-9_-]{43}$/`
  - `looksLikeLegacyOrgToken(value: string): boolean` — `/^[0-9a-f]{64}$/`
  - Prisma `ApiAccessKey`

```prisma
/// Персональный ключ ИИ-ассистентов и API (/settings/api). Действует с
/// правами владельца в организации, где выпущен. Хранится только хеш.
model ApiAccessKey {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  name           String
  /// "write" | "read"; запись включает чтение.
  access         String       @default("write")
  tokenHash      String       @unique
  /// "wsk_" + первые 8 символов — чтобы узнать ключ в списке.
  displayPrefix  String
  lastUsedAt     DateTime?
  /// "mcp" | "rest"
  lastUsedVia    String?
  revokedAt      DateTime?
  createdAt      DateTime     @default(now())

  @@index([organizationId, revokedAt])
  @@index([userId])
}
```

- [ ] **Step 1: Написать падающие тесты**

```ts
test("generateApiKey: wsk_ + 43 символа base64url, хеш = sha256(secret), префикс = 12 первых символов", () => {
  const k = generateApiKey();
  assert.match(k.secret, /^wsk_[A-Za-z0-9_-]{43}$/);
  assert.equal(k.tokenHash, crypto.createHash("sha256").update(k.secret).digest("hex"));
  assert.equal(k.displayPrefix, k.secret.slice(0, 12));
  assert.equal(hashApiKey(k.secret), k.tokenHash);
});
test("generateApiKey: два вызова дают разные ключи", () => {
  assert.notEqual(generateApiKey().secret, generateApiKey().secret);
});
test("looksLikeApiKey отвергает старый ключ организации и мусор; looksLikeLegacyOrgToken его узнаёт", () => {
  const legacy = "a".repeat(64);
  assert.equal(looksLikeApiKey(legacy), false);
  assert.equal(looksLikeLegacyOrgToken(legacy), true);
  assert.equal(looksLikeApiKey(""), false);
  assert.equal(looksLikeApiKey("wsk_" + "x".repeat(42)), false);
});
```

- [ ] **Step 2: Запустить — падает**

Run: `node --import tsx --test src/lib/public-api/keys.test.ts`
Expected: FAIL, модуль `./keys` не найден.

- [ ] **Step 3: Реализовать `keys.ts`**

`crypto.randomBytes(32).toString("base64url")` даёт ровно 43 символа.

- [ ] **Step 4: Тесты проходят**

Run: `node --import tsx --test src/lib/public-api/keys.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Применить схему к e2e-базе**

Run: `DATABASE_URL=… DATABASE_URL_DIRECT=… npx prisma db push && npx prisma generate` (переменные — из Global Constraints)
Expected: `Your database is now in sync`, без предупреждений о потере данных. На проде `db push` выполнит деплой.

- [ ] **Step 6: Коммит**

```bash
git commit -m "ИИ и API: модель персонального ключа и формат wsk_" -- prisma/schema.prisma src/lib/public-api/keys.ts src/lib/public-api/keys.test.ts
```

---

### Task 2: Проверка ключа и ограничение частоты

**Files:**
- Create: `src/lib/public-api/context.ts`, `src/lib/public-api/auth.ts`
- Modify: `src/lib/rate-limit.ts` (добавить `publicApiRateLimiter`)
- Test: `src/lib/public-api/auth.test.ts`, `src/lib/public-api/auth.db.test.ts`

**Interfaces:**
- Consumes: `hashApiKey`, `looksLikeApiKey`, `looksLikeLegacyOrgToken`, `ApiKeyAccess` (Task 1); `hasFullWorkspaceAccess` (`@/lib/role-access`); `isLocale` (`@/i18n/locales`); `EntryWriteActor` (`@/lib/journal-entry-write`).
- Produces:

```ts
// context.ts
export type ApiVia = "mcp" | "rest";
export type ApiCallContext = {
  keyId: string; keyName: string; access: ApiKeyAccess; via: ApiVia;
  orgId: string; orgName: string; timezone: string | null;
  actor: EntryWriteActor;          // { id, role, isRoot: false, name }
  locale: Locale;                  // user.locale, иначе "ru"
  baseUrl: string;                 // publicBaseUrl()
};
// auth.ts
export function publicBaseUrl(): string   // (NEXTAUTH_URL || "https://wesetup.ru") без хвостовых "/"
export function extractApiKey(request: Request, pathKey?: string): string | null
export type ApiAuthResult =
  | { ok: true; ctx: ApiCallContext }
  | { ok: false; status: 401 | 403 | 429; error: string; retryAfterSec?: number };
export async function authenticateApiKey(
  request: Request, opts: { via: ApiVia; pathKey?: string; now?: Date }
): Promise<ApiAuthResult>
// rate-limit.ts
export const publicApiRateLimiter = createRateLimiter({ tokensPerInterval: 120, intervalMs: 60_000 });
```

Порядок проверок в `authenticateApiKey` и тексты ошибок (дословно):

1. Ключа нет → 401 `Нужен ключ WeSetup: заголовок Authorization: Bearer wsk_… или ссылка с ключом со страницы «ИИ-ассистенты и API».`
2. `looksLikeLegacyOrgToken` → 401 `Это ключ интеграций для /api/external. Для ИИ-ассистента создайте персональный ключ на странице «ИИ-ассистенты и API».` Иначе, если `!looksLikeApiKey` → 401 `Ключ не найден или отозван.`
3. `findUnique({ where: { tokenHash } })` с `user` (`id, name, role, isActive, archivedAt, organizationId, locale`) и `organization` (`id, name, timezone`). Нет или `revokedAt` → 401 `Ключ не найден или отозван.`
4. `!user.isActive || user.archivedAt` → 403 `Владелец ключа отключён — ключ больше не действует.`
5. Роль: если `user.organizationId === key.organizationId` → `user.role`; иначе `OrganizationMember(userId, organizationId).role`; связи нет → 403 `Владелец ключа больше не работает в этой организации.`
6. `!hasFullWorkspaceAccess({ role, isRoot: false })` → 403 `У владельца ключа больше нет прав руководителя — создайте новый ключ.`
7. `publicApiRateLimiter.consume(key.id)` вернул false → 429 `Слишком много запросов — подождите минуту.`, `retryAfterSec = ceil(remainingMs / 1000)`.
8. Отметка использования без ожидания (ошибку — в `console.error`): `updateMany({ where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: now − 60 с } }] }, data: { lastUsedAt: now, lastUsedVia: via } })`.

- [ ] **Step 1: Написать падающие тесты (чистые)**

```ts
test("extractApiKey: ключ из пути важнее заголовка", () => {
  const req = new Request("http://x", { headers: { authorization: "Bearer HEADER" } });
  assert.equal(extractApiKey(req, "PATH"), "PATH");
});
test("extractApiKey: Bearer без учёта регистра, пробелы обрезаются; иначе null", () => {
  assert.equal(extractApiKey(new Request("http://x", { headers: { authorization: "bearer  abc " } })), "abc");
  assert.equal(extractApiKey(new Request("http://x", { headers: { authorization: "Basic abc" } })), null);
  assert.equal(extractApiKey(new Request("http://x")), null);
});
```

- [ ] **Step 2: Написать падающие DB-тесты** (шапка и пропуск — как в `src/lib/partners/org-conversion.db.test.ts`)

Каждый тест создаёт свою организацию, пользователя и ключ (`generateApiKey`) и удаляет их в `finally`.
- `действующий ключ руководителя → ok; ctx.orgId = организация ключа; actor.isRoot = false; access из ключа`
- `отозванный ключ → 401 «Ключ не найден или отозван.»`
- `владелец архивирован (archivedAt) → 403`
- `владелец понижен до cook → 403 «…больше нет прав руководителя…»`
- `ключ выпущен в организации, где владелец — OrganizationMember (manager) → ok, ctx.orgId — эта организация, а не домашняя`
- `участие в OrganizationMember удалено → 403 «…больше не работает в этой организации.»`
- `lastUsedAt: два вызова подряд → обновился один раз; вызов с now + 61 с → обновился снова`

- [ ] **Step 3: Запустить — падают**

Run: `node --import tsx --test src/lib/public-api/auth.test.ts` и `WESETUP_DB_TESTS=1 DATABASE_URL=… node --import tsx --test src/lib/public-api/auth.db.test.ts`
Expected: FAIL, модуль `./auth` не найден.

- [ ] **Step 4: Реализовать `context.ts`, `auth.ts` и лимитер**

- [ ] **Step 5: Тесты проходят**

Run: те же две команды.
Expected: PASS (2 + 7).

- [ ] **Step 6: Коммит**

```bash
git commit -m "ИИ и API: проверка персонального ключа и лимит 120 вызовов в минуту" -- src/lib/public-api/context.ts src/lib/public-api/auth.ts src/lib/public-api/auth.test.ts src/lib/public-api/auth.db.test.ts src/lib/rate-limit.ts
```

---

### Task 3: Общий путь записи с ИИ-помощником

**Files:**
- Modify: `src/lib/ai-assistant/actions.ts`
- Modify: `src/lib/external/dispatch.ts:725` (переименовать `usesConfigWriter` в экспортируемую `isConfigWriterJournal`, вызовы внутри файла обновить)
- Test: существующие `src/lib/ai-assistant/localization.test.ts`, `src/components/ai/assistant-localization.test.ts`

**Interfaces:**
- Produces:
  - `export const assistantAddStaffSchema` — бывшая `addStaffSchema` с `.describe()` у полей
  - `export const assistantFillCellsSchema` — бывшая `fillCellsSchema` с `.describe()`
  - `export type ExecuteResult = { ok: true; summary: string; entityId?: string } | { ok: false; error: string }` — `executeAddStaff` кладёт в `entityId` id созданного сотрудника
  - `export async function executeProposedAction(action: ProposedAction, ctx: { orgId: string; actor: ActionActor; locale?: Locale }, opts?: { audit?: { action: string; details?: Record<string, unknown> } | false }): Promise<ExecuteResult>` — исполнение и, если `audit !== false`, строка `AuditLog`. По умолчанию `{ action: "ai_assistant.action" }`, формат `details` прежний.
  - `verifyAndExecuteAction` = `verifyActionToken` + `executeProposedAction(action, ctx)`; поведение для встроенного помощника не меняется.
  - `export function isConfigWriterJournal(templateCode: string): boolean` (dispatch.ts)

Описания полей (дословно):
- `fullName`: «ФИО сотрудника полностью, как в документах»
- `jobPositionId`: «id должности из list_employees → positions»
- `phone`: «Телефон в любом формате; можно не указывать»
- `documentId`: «id документа журнала из list_journals → documents»
- `employeeIds`: «id сотрудников из list_employees — строки документа»
- `dates`: «Даты в формате YYYY-MM-DD внутри периода документа»
- `values`: «Что записать: status — статус гигиенического журнала; auto — типовое заполнение по графику (hygiene, health_check); data — только значения, которые пользователь назвал сам»

- [ ] **Step 1: Убедиться, что тесты помощника зелёные до правки**

Run: `node --import tsx --test src/lib/ai-assistant/*.test.ts src/components/ai/*.test.ts`
Expected: PASS. Запомнить число тестов.

- [ ] **Step 2: Сделать правки**

Рефакторинг без изменения поведения: вынести тело исполнения и аудит из `verifyAndExecuteAction` в `executeProposedAction`, добавить `entityId`, экспорт схем и функции в dispatch.

- [ ] **Step 3: Проверить**

Run: `node --import tsx --test src/lib/ai-assistant/*.test.ts src/components/ai/*.test.ts && npm run typecheck`
Expected: PASS с тем же числом тестов; typecheck без ошибок.

- [ ] **Step 4: Коммит**

```bash
git commit -m "ИИ-помощник: исполнение действия отдельно от подписи — для MCP и API" -- src/lib/ai-assistant/actions.ts src/lib/external/dispatch.ts
```

---

### Task 4: Реестр инструментов и шесть инструментов

**Files:**
- Create: `src/lib/public-api/tools/types.ts`, `tools/context-tools.ts`, `tools/journal-tools.ts`, `tools/staff-tools.ts`, `tools/index.ts`, `src/lib/public-api/run-tool.ts`, `src/lib/public-api/dates.ts`
- Test: `src/lib/public-api/dates.test.ts`, `src/lib/public-api/run-tool.test.ts`, `src/lib/public-api/tools/registry.test.ts`, `src/lib/public-api/tools/tools.db.test.ts`

**Interfaces:**
- Consumes: `ApiCallContext` (Task 2); `assistantAddStaffSchema`, `assistantFillCellsSchema`, `prepareAction`, `executeProposedAction` (Task 3); `isConfigWriterJournal` (Task 3); `getDisabledJournalCodes` (`@/lib/disabled-journals`); `getAllowedJournalCodes`, `hasJournalAccess` (`@/lib/journal-acl`); `getTemplatesFilledToday`, `DAILY_JOURNAL_CODES`, `CONFIG_DAILY_CODES` (`@/lib/today-compliance`); `orgTodayKey` (`@/lib/timezone`); `journalTitle` (`@/i18n/journal-presentation`); `loadMessages` (`@/i18n/messages`).
- Produces:

```ts
// tools/types.ts
export type ToolResult =
  | { ok: true; data: Record<string, unknown>; text?: string }
  | { ok: false; status: 400 | 402 | 403 | 404 | 409 | 422 | 500; error: string };
export type ApiTool = {
  name: string; title: string; description: string;
  access: ApiKeyAccess;
  input: z.ZodObject;
  rest: { method: "GET" | "POST"; path: `/${string}` };   // параметры пути — "{documentId}"
  handler(input: any, ctx: ApiCallContext): Promise<ToolResult>;
};
export function toolInputJsonSchema(tool: ApiTool): Record<string, unknown>; // z.toJSONSchema(tool.input, { io: "input" }) без "$schema"
// tools/index.ts
export const PUBLIC_API_TOOLS: readonly ApiTool[];   // порядок: get_context, list_journals, get_journal_document, fill_journal_cells, list_employees, add_employee
export function findTool(name: string): ApiTool | undefined;
export function toolsForAccess(access: ApiKeyAccess): ApiTool[];   // "read" → только access === "read"
// tools/journal-tools.ts (не в index.ts — иначе цикл импорта index ↔ journal-tools)
export function isCellJournal(code: string): boolean;               // !CONFIG_DAILY_CODES.has(code) && !isConfigWriterJournal(code)
// run-tool.ts
export type AuditWriter = (entry: { orgId: string; actor: EntryWriteActor; tool: string; via: ApiVia; keyId: string; keyName: string; input: unknown }) => Promise<void>;
export async function runTool(tool: ApiTool, rawInput: unknown, ctx: ApiCallContext, writeAudit?: AuditWriter): Promise<ToolResult>;
// dates.ts
export function resolveDateKey(input: string | undefined, timezone: string | null, now?: Date): { ok: true; dateKey: string } | { ok: false; error: string };
export function instantForDateKey(dateKey: string): Date;   // new Date(`${dateKey}T06:00:00.000Z`): тот же день для UTC+2…UTC+12
export function clampRange(args: { from?: string; to?: string; todayKey: string; docFrom: string; docTo: string; defaultDays: number; maxDays: number }): { ok: true; from: string; to: string } | { ok: false; error: string };   // вызываем с 7 и 31
export function capList<T>(items: T[], max: number): { items: T[]; truncated: boolean };
```

`runTool`:
1. `tool.access === "write" && ctx.access !== "write"` → 403 `Ключ только для чтения: создайте ключ «Чтение и запись», чтобы ИИ мог записывать.`
2. `rawInput ?? {}`; не объект → 422 `Аргументы должны быть объектом.`; `safeParse` упал → 422 `Неверные аргументы: <path>: <message>` (первая ошибка).
3. Исключение обработчика → 500 `Внутренняя ошибка WeSetup — попробуйте ещё раз.`, стек — в `console.error`.
4. Успешный инструмент записи → один вызов `writeAudit` (по умолчанию — `db.auditLog.create`, `action: "public_api.call"`, `entity: tool.name`, `details: { tool, via, keyId, keyName, input }`). Чтение аудит не пишет.

Инструменты (имя → REST; вход; выход; правила):

| Имя | REST | Права | Вход | Выход и правила |
|---|---|---|---|---|
| `get_context` | `GET /me` | read | `{}` | `{ organization: { id, name, timezone }, today, user: { id, name, role }, key: { name, access }, appUrl: baseUrl + "/dashboard" }`; `today` = `orgTodayKey(timezone)` |
| `list_journals` | `GET /journals` | read | `{ date?: "YYYY-MM-DD" }` | `{ date, journals: [{ code, name, daily, filled, storage: "cells" \| "document", documents: [{ id, title, periodFrom, periodTo, status, point, url }] }], summary: { dailyTotal, dailyFilled, notFilled: string[] } }`. Шаблоны: активные, без выключенных организацией, с учётом `getAllowedJournalCodes` (null — все), по `sortOrder`. `filled` — `getTemplatesFilledToday(orgId, instantForDateKey(date), templates, disabled, { treatAperiodicAsFilled: false })`. `daily` = код в `DAILY_JOURNAL_CODES` или `CONFIG_DAILY_CODES`. Документы: `status: "active"`, `dateFrom ≤ день ≤ dateTo`, день = `${date}T00:00:00.000Z` (как в `/api/external/summary`); `point` = `building?.name ?? null`; `url` = `${baseUrl}/journals/${code}/documents/${id}`; `name` = `journalTitle(locale, messages.journals.names, code, template.name)` |
| `get_journal_document` | `GET /documents/{documentId}` | read | `{ documentId, from?, to? }` | `{ document: { id, title, journalCode, journalName, periodFrom, periodTo, status, point, url }, range: { from, to }, entries: [{ date, employeeId, employeeName, data }], truncated, config?, configTruncated? }`. Документ ищем с `organizationId` ключа, иначе 404 `Документ не найден.`; без `hasJournalAccess` — 403. Диапазон — `clampRange` (по умолчанию 7 дней до `min(сегодня, docTo)`, максимум 31). Ячейки — `capList(…, 2000)`. Если `!isCellJournal(code)`, отдаём `config`, когда `JSON.stringify(config).length ≤ 30 000`, иначе `configTruncated: true` |
| `fill_journal_cells` | `POST /documents/{documentId}/cells` | write | `assistantFillCellsSchema` | Документа нет в организации → 404. `!isCellJournal(code)` → 422 `Журнал «<name>» хранит записи внутри документа — через ИИ его пока не заполнить. Откройте: <url>`. Затем `prepareAction({ kind: "fill_journal_cells", input }, ctx)` (не ok → 422 с текстом ошибки) и `executeProposedAction(…, { audit: false })` (не ok → 422). Успех: `data: { summary, details: preview.details, url }`, `text: summary` |
| `list_employees` | `GET /employees` | read | `{ query?: string ≤ 100 }` | `{ employees: [{ id, name, position, role, phone }], positions: [{ id, name, category }], truncated }`. Сотрудники: `organizationId`, `isActive`, `archivedAt: null`, `name contains query` (без регистра), по имени, `capList(…, 300)`. `position` = `jobPosition?.name ?? positionTitle` |
| `add_employee` | `POST /employees` | write | `assistantAddStaffSchema.extend({ allowDuplicate: z.boolean().optional().describe("true — создать, даже если такой сотрудник уже есть") })` | Если активный сотрудник с той же должностью и тем же ФИО есть (сравнение: trim, схлопнуть пробелы, без регистра) и нет `allowDuplicate` → 409 `Сотрудник «<ФИО>» на должности «<должность>» уже есть (id <id>). Если это другой человек — повторите с allowDuplicate: true.` Затем `prepareAction({ kind: "add_staff" })` и `executeProposedAction(…, { audit: false })`. Успех: `data: { employee: { id: entityId, name }, summary }`, `text: summary` |

Описания инструментов для модели (поле `description`, дословно):
- `get_context`: «Кто я и где: организация, сегодняшняя дата в её часовом поясе, права ключа. Вызови в начале разговора.»
- `list_journals`: «Журналы организации на дату: заполнен ли каждый ежедневный журнал, активные документы с id и ссылками. Ответ на вопрос «что сегодня не заполнено».»
- `get_journal_document`: «Записи документа журнала за период (до 31 дня): ячейки сотрудник × день с данными. Для журналов-конфигов (storage = document) — содержимое документа.»
- `fill_journal_cells`: «Заполнить ячейки журнала-сетки (storage = cells): сотрудники × даты. Значения замеров — только названные пользователем. Права, закрытые дни и документы проверяются как в интерфейсе.»
- `list_employees`: «Активные сотрудники с должностями и телефонами, а также список должностей с id — для add_employee.»
- `add_employee`: «Добавить сотрудника: ФИО, id должности, телефон по желанию. Только для руководителя; учитывает лимит тарифа.»

- [ ] **Step 1: Падающие тесты `dates.test.ts`**

```ts
test("resolveDateKey без даты — сегодня по часовому поясу организации", () => {
  const r = resolveDateKey(undefined, "Asia/Kamchatka", new Date("2026-10-16T12:45:00Z"));
  assert.deepEqual(r, { ok: true, dateKey: "2026-10-17" });
});
test("resolveDateKey отвергает несуществующую дату и чужой формат", () => {
  assert.equal(resolveDateKey("2026-02-30", null).ok, false);
  assert.equal(resolveDateKey("16.10.2026", null).ok, false);
});
test("instantForDateKey попадает в тот же календарный день для UTC+2 и UTC+12", () => {
  const i = instantForDateKey("2026-10-16");
  for (const tz of ["Europe/Kaliningrad", "Asia/Kamchatka"]) {
    assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(i), "2026-10-16");
  }
});
test("clampRange: по умолчанию 7 дней до сегодня; больше 31 дня — ошибка; обрезка периодом документа", () => {
  assert.deepEqual(clampRange({ todayKey: "2026-10-16", docFrom: "2026-10-01", docTo: "2026-10-31", defaultDays: 7, maxDays: 31 }), { ok: true, from: "2026-10-10", to: "2026-10-16" });
  assert.equal(clampRange({ from: "2026-08-01", to: "2026-10-16", todayKey: "2026-10-16", docFrom: "2026-01-01", docTo: "2026-12-31", defaultDays: 7, maxDays: 31 }).ok, false);
  assert.deepEqual(clampRange({ from: "2026-09-25", to: "2026-10-05", todayKey: "2026-10-16", docFrom: "2026-10-01", docTo: "2026-10-31", defaultDays: 7, maxDays: 31 }), { ok: true, from: "2026-10-01", to: "2026-10-05" });
});
test("capList: обрезает и ставит truncated", () => {
  assert.deepEqual(capList([1, 2, 3], 2), { items: [1, 2], truncated: true });
  assert.deepEqual(capList([1], 2), { items: [1], truncated: false });
});
```

- [ ] **Step 2: Падающие тесты `registry.test.ts`**

- `имена уникальны, в snake_case, порядок — get_context, list_journals, get_journal_document, fill_journal_cells, list_employees, add_employee`
- `у каждого инструмента toolInputJsonSchema(tool).type === "object" и нет ключа "$schema"`
- `пары rest.method + rest.path уникальны`
- `access === "write" только у fill_journal_cells и add_employee`
- `toolsForAccess("read") не содержит инструментов записи; toolsForAccess("write") — все шесть`
- `схема fill_journal_cells содержит описание поля documentId` (`properties.documentId.description` непустое)

- [ ] **Step 3: Падающие тесты `run-tool.test.ts`** (фиктивные инструменты и контекст, без БД)

- `ключ «только чтение» → 403 на инструмент записи, обработчик не вызван`
- `неверный вход → 422, в тексте путь поля`
- `аргументы null → как {} (инструмент без обязательных полей вызывается); строка → 422 «Аргументы должны быть объектом.»`
- `успешная запись → writeAudit вызван один раз с { tool, via, keyId, keyName, input }`
- `успешное чтение → writeAudit не вызван`
- `исключение в обработчике → 500 «Внутренняя ошибка WeSetup — попробуйте ещё раз.», текст без стека`

- [ ] **Step 4: Падающие DB-тесты `tools.db.test.ts`** (гейт `WESETUP_DB_TESTS`)

- `list_journals не показывает журнал, выключенный в disabledJournalCodes`
- `list_journals не показывает документ другой организации`
- `get_journal_document с documentId другой организации → 404`
- `get_journal_document журнала-конфига с config длиннее 30 000 символов → configTruncated: true, поля config нет`
- `fill_journal_cells: закрытый документ → 422 с текстом assistantActions.documentClosed`
- `fill_journal_cells: журнал-конфиг (код из CONFIG_DAILY_CODES) → 422 со ссылкой на документ`
- `fill_journal_cells через runTool: hygiene, status sick_leave на 2 сотрудника × 1 день → 2 ячейки и одна строка AuditLog public_api.call`
- `add_employee: дубль ФИО и должности → 409; с allowDuplicate: true → создан, data.employee.id есть в БД`
- `list_employees: query «иван» находит «Иванова Анна»`

- [ ] **Step 5: Запустить — падают**

Run: `node --import tsx --test src/lib/public-api/dates.test.ts src/lib/public-api/run-tool.test.ts src/lib/public-api/tools/registry.test.ts`
Expected: FAIL, модули не найдены.

- [ ] **Step 6: Реализовать `dates.ts`, `tools/*`, `run-tool.ts`**

- [ ] **Step 7: Тесты проходят**

Run: команда шага 5, затем `WESETUP_DB_TESTS=1 DATABASE_URL=… node --import tsx --test src/lib/public-api/tools/tools.db.test.ts`
Expected: PASS (5 + 6 + 6 + 9).

- [ ] **Step 8: Коммит**

```bash
git commit -m "ИИ и API: реестр из шести инструментов с правами владельца ключа" -- src/lib/public-api/dates.ts src/lib/public-api/dates.test.ts src/lib/public-api/run-tool.ts src/lib/public-api/run-tool.test.ts src/lib/public-api/tools
```

---

### Task 5: MCP-сервер

**Files:**
- Create: `src/lib/public-api/mcp/protocol.ts`, `mcp/instructions.ts`, `mcp/handle-message.ts`, `mcp/http.ts`, `src/app/api/mcp/route.ts`, `src/app/api/mcp/[key]/route.ts`
- Test: `src/lib/public-api/mcp/handle-message.test.ts`, `src/lib/public-api/mcp/http.test.ts`

**Interfaces:**
- Consumes: `PUBLIC_API_TOOLS`, `toolInputJsonSchema`, `runTool`, `ToolResult` (Task 4); `authenticateApiKey`, `ApiCallContext` (Task 2).
- Produces:

```ts
// protocol.ts
export const MODERN_VERSIONS = ["2026-07-28"] as const;
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const ALL_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
export const META_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
export const SERVER_INFO = { name: "wesetup", title: "WeSetup", version: "1.0.0" };
export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603, unauthorized: -32000, headerMismatch: -32020, unsupportedVersion: -32022 } as const;
// handle-message.ts
export type McpEnv = {
  headers: Headers;
  ctx: ApiCallContext;
  tools: readonly ApiTool[];                                  // весь реестр; tools/list фильтрует по ctx.access
  run: (tool: ApiTool, args: unknown, ctx: ApiCallContext) => Promise<ToolResult>;
};
export type McpHttpReply = { status: number; body?: unknown };   // body undefined → пустой ответ
export async function handleMcpBody(body: unknown, env: McpEnv): Promise<McpHttpReply>;
export function decodeHeaderValue(value: string): string;      // снимает обёртку "=?base64?…?="
// http.ts
export function isAllowedOrigin(origin: string | null, extra?: string[]): boolean;
export async function handleMcpHttp(request: Request, opts?: { pathKey?: string }): Promise<Response>;
export function mcpPreflight(request: Request): Response;
export function mcpMethodNotAllowed(): Response;               // 405, Allow: POST, OPTIONS
```

Правила `handleMcpBody` (это и есть спецификация для тестов):
- Тело не объект и не массив → 400, `{ jsonrpc: "2.0", id: null, error: { code: -32600 } }`.
- Массив (пакет из 2025-03-26): если в каком-то элементе есть `params._meta[META_VERSION_KEY]` → 400, −32600. Иначе каждый элемент обрабатывается по-легаси, ответы только на запросы; ответов нет → 202.
- Нет `id` (уведомление) → 202 без тела.
- **Современный запрос** = в `params._meta[META_VERSION_KEY]` строка:
  - нет заголовка `MCP-Protocol-Version` или он не равен `_meta` → 400, −32020 `Header mismatch: MCP-Protocol-Version`;
  - версия не из `MODERN_VERSIONS` → 400, −32022, `data: { supported: ALL_VERSIONS, requested }`;
  - `Mcp-Method` ≠ `method` → 400, −32020; для `tools/call` `decodeHeaderValue(Mcp-Name)` ≠ `params.name` → 400, −32020;
  - `server/discover` → `{ resultType: "complete", supportedVersions: ALL_VERSIONS, capabilities: { tools: { listChanged: false } }, instructions, ttlMs: 3_600_000, cacheScope: "private", _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO } }`;
  - `tools/list` → `{ resultType: "complete", tools, ttlMs: 300_000, cacheScope: "private", _meta: {…serverInfo} }`;
  - `tools/call` → результат вызова с `resultType: "complete"` и `_meta`;
  - другой метод → **404**, −32601.
- **Легаси-запрос** (нет `_meta`-версии):
  - заголовок `MCP-Protocol-Version` из `MODERN_VERSIONS` → 400, −32020 (новый клиент забыл `_meta`); заголовок есть, но не из `ALL_VERSIONS` → 400, −32600 `Unsupported MCP-Protocol-Version`; заголовка нет → считаем 2025-03-26;
  - `initialize` → `{ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions }`. `protocolVersion` = запрошенная, если она из `LEGACY_VERSIONS`, иначе `"2025-11-25"`. Заголовок `Mcp-Session-Id` не выдаём;
  - `ping` → `{}`; `tools/list` → `{ tools }`; `tools/call` → результат без `resultType`; `server/discover` → как в современном;
  - другой метод → 200, −32601.
- `tools/call` (обе эпохи): `params.name` не строка → −32602; инструмента нет в реестре → −32602 `Unknown tool: <name>`. Иначе `env.run(tool, params.arguments ?? {}, ctx)`:
  - ok → `content: [{ type: "text", text: (text ? text + "\n\n" : "") + JSON.stringify(data, null, 2) }]`, `structuredContent: data`, `isError: false`;
  - не ok → `content: [{ type: "text", text: error }]`, `isError: true`.
- Описание инструмента в `tools/list`: `{ name, title, description, inputSchema: toolInputJsonSchema(tool), annotations: { title, readOnlyHint: access === "read", destructiveHint: false, idempotentHint: access === "read" || name === "fill_journal_cells", openWorldHint: false } }`. Только `toolsForAccess(ctx.access)`, порядок реестра.

`handleMcpHttp`:
1. `isAllowedOrigin(request.headers.get("origin"), MCP_ALLOWED_ORIGINS из env через запятую)`, иначе 403 с JSON-RPC-ошибкой без `id`. Разрешены: `null`, `https://wesetup.ru`, `https://www.wesetup.ru`, `https://claude.ai`, `https://chatgpt.com`, `https://chat.openai.com`, `^http://(localhost|127\.0\.0\.1)(:\d+)?$`.
2. Для разрешённого непустого Origin — CORS: `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`, `Access-Control-Allow-Headers: Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID`, `Access-Control-Expose-Headers: WWW-Authenticate`.
3. `authenticateApiKey(request, { via: "mcp", pathKey })`. Отказ → его статус, тело `{ jsonrpc: "2.0", id: null, error: { code: -32000, message } }`; при 401 — `WWW-Authenticate: Bearer realm="WeSetup"`, при 429 — `Retry-After`.
4. `Content-Length` больше 1 МБ → 413. JSON не разобрался → 400, −32700.
5. `handleMcpBody(body, { headers, ctx, tools: PUBLIC_API_TOOLS, run: (t, a, c) => runTool(t, a, c) })` → ответ: `Content-Type: application/json`, `Cache-Control: no-store`; при 202 — без тела.

Маршруты: `src/app/api/mcp/route.ts` — `POST → handleMcpHttp(req)`, `OPTIONS → mcpPreflight`, `GET`/`DELETE → mcpMethodNotAllowed()`. `src/app/api/mcp/[key]/route.ts` — то же, но `const { key } = await params; handleMcpHttp(req, { pathKey: key })`. Обычный `NextResponse`/`Response`, без SSE.

`MCP_SERVER_INSTRUCTIONS` (дословно):

```
WeSetup — электронные журналы СанПиН и ХАССП пищевого производства. Ты работаешь от имени сотрудника, чей ключ подключён, и видишь только его организацию.
1. В начале разговора вызови get_context: организация, сегодняшняя дата в её часовом поясе, права ключа.
2. Никогда не придумывай значения замеров (температура, влажность, показания приборов, время). Записывай только то, что пользователь назвал сам; если значений нет — спроси.
3. id сотрудников, должностей и документов бери только из ответов list_employees и list_journals.
4. Перед fill_journal_cells и add_employee коротко перескажи, что запишешь, и дождись согласия, если пользователь не дал прямой команды.
5. Гигиенический журнал по новой форме: «Здоров» и «Отстранён» сотрудник подписывает сам по QR — эти статусы не ставь.
6. Журналы со storage = document через ИИ пока только читаются — дай пользователю ссылку на документ.
7. Отвечай на языке пользователя; говоря о журнале, давай ссылку из поля url.
```

- [ ] **Step 1: Падающие тесты `handle-message.test.ts`** (фиктивные `ctx` и `run`, без БД)

1. `легаси initialize 2025-06-18 → та же версия, capabilities.tools, serverInfo.name = "wesetup", instructions непусты`
2. `легаси initialize 2024-11-05 → protocolVersion 2025-11-25`
3. `notifications/initialized → 202 без тела`
4. `легаси ping → result {}`
5. `легаси tools/list ключом read → три инструмента чтения, у каждого inputSchema.type = "object"`
6. `tools/call неизвестного инструмента → error.code -32602`
7. `tools/call add_employee ключом read → result.isError = true, текст про «только для чтения»` (`run` фиктивно повторяет правило 1 `runTool`)
8. `tools/call ok → content[0].text содержит JSON data, structuredContent = data, isError = false`
9. `современный tools/list → resultType "complete", ttlMs 300000, cacheScope "private", _meta serverInfo`
10. `современный server/discover → supportedVersions = ["2026-07-28","2025-11-25","2025-06-18","2025-03-26"]`
11. `современный без заголовка MCP-Protocol-Version → 400, -32020`
12. `современный: Mcp-Method не совпадает → 400, -32020`
13. `современный tools/call: Mcp-Name "=?base64?Z2V0X2NvbnRleHQ=?=" при name get_context → ok; Mcp-Name "other" → 400, -32020`
14. `современный с версией 1900-01-01 → 400, -32022, data.supported и data.requested`
15. `современный неизвестный метод → 404, -32601`
16. `легаси с заголовком MCP-Protocol-Version: 1999-01-01 → 400`
17. `пакет: два легаси-запроса и уведомление → массив из двух ответов с теми же id`
18. `тело 42 → 400, -32600`

- [ ] **Step 2: Падающие тесты `http.test.ts`**

- `isAllowedOrigin: null, https://claude.ai, http://localhost:6274 — да; https://evil.example — нет; extra ["https://my.app"] разрешает https://my.app`
- `decodeHeaderValue: обычная строка без изменений; "=?base64?0J/RgNC40LLQtdGC?=" → "Привет"`

- [ ] **Step 3: Запустить — падают**

Run: `node --import tsx --test src/lib/public-api/mcp/*.test.ts`
Expected: FAIL, модули не найдены.

- [ ] **Step 4: Реализовать `protocol.ts`, `instructions.ts`, `handle-message.ts`, `http.ts` и маршруты**

- [ ] **Step 5: Тесты проходят**

Run: `node --import tsx --test src/lib/public-api/mcp/*.test.ts`
Expected: PASS (18 + 2).

- [ ] **Step 6: Коммит**

```bash
git commit -m "MCP-сервер WeSetup: Streamable HTTP без состояния, спецификации 2026-07-28 и 2025" -- src/lib/public-api/mcp "src/app/api/mcp"
```

---

### Task 6: REST v1 и OpenAPI

**Files:**
- Create: `src/lib/public-api/rest/router.ts`, `rest/openapi.ts`, `rest/http.ts`, `src/app/api/v1/[[...path]]/route.ts`
- Test: `src/lib/public-api/rest/router.test.ts`, `src/lib/public-api/rest/openapi.test.ts`

**Interfaces:**
- Consumes: `PUBLIC_API_TOOLS`, `toolInputJsonSchema`, `runTool` (Task 4); `authenticateApiKey`, `publicBaseUrl` (Task 2); Prisma `journalExternalIdempotency`.
- Produces:

```ts
export type RestMatch =
  | { kind: "tool"; tool: ApiTool; params: Record<string, string> }
  | { kind: "method_not_allowed"; allow: string[] }
  | { kind: "not_found" };
export function matchRestRoute(method: string, segments: string[], tools: readonly ApiTool[]): RestMatch;
export function buildOpenApiDocument(tools: readonly ApiTool[], baseUrl: string): Record<string, unknown>;
export async function handleRestRequest(request: Request, segments: string[]): Promise<Response>;
```

`handleRestRequest`:
- `[]` → `{ name: "WeSetup API", version: "1.0.0", openapi: baseUrl + "/api/v1/openapi.json", docs: baseUrl + "/developers", mcp: baseUrl + "/api/mcp" }`, без ключа.
- `["openapi.json"]` (GET) → `buildOpenApiDocument`, без ключа, `Cache-Control: public, max-age=3600`.
- Иначе `matchRestRoute`: `not_found` → 404 `{ ok: false, error: "Нет такого метода API" }`; `method_not_allowed` → 405 с `Allow`.
- `authenticateApiKey(request, { via: "rest" })`, отказ → его статус, `{ ok: false, error }` и заголовки как в MCP.
- Вход: GET — `Object.fromEntries(searchParams)` + параметры пути; POST — JSON-объект тела (иначе 400 `Тело запроса должно быть JSON-объектом`) + параметры пути (путь важнее).
- POST с `Idempotency-Key`: ключ записи `v1:${ctx.keyId}:${value.slice(0, 120)}`. Если запись есть — отдать сохранённый ответ с `idempotent-replayed: true`. Сохранять только успешные ответы (`organizationId`, `journalCode: tool.name`, `httpStatus: 200`); ошибку дубликата при сохранении игнорировать, как в `src/app/api/external/entries/route.ts`.
- `runTool` → ok: 200 `{ ok: true, data }`; ошибка: `status` из результата, `{ ok: false, error }`. Везде `Cache-Control: no-store`, кроме openapi.

OpenAPI: `openapi: "3.1.0"`, `info: { title: "WeSetup API", version: "1.0.0", description }`, `servers: [{ url: baseUrl + "/api/v1" }]`, `components.securitySchemes.bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "wsk_…" }`, `security: [{ bearerAuth: [] }]`. Для каждого инструмента: `operationId = name`, `summary = title`, `description`. Параметры пути — `in: "path"`, `required: true`, в тело и query не дублируются. Для GET остальные свойства схемы — `in: "query"`; для POST — `requestBody.content["application/json"].schema` без параметров пути. Ответы: `200 { ok: true, data }`, `4XX { ok: false, error }`. Маршрут `[[...path]]` экспортирует `GET` и `POST` → `handleRestRequest(req, (await params).path ?? [])`.

- [ ] **Step 1: Падающие тесты `router.test.ts`**

- `GET documents/abc → get_journal_document, params { documentId: "abc" }`
- `POST documents/abc/cells → fill_journal_cells`
- `GET employees → list_employees; POST employees → add_employee`
- `DELETE employees → method_not_allowed, allow ["GET","POST"]`
- `GET nope → not_found; GET documents (без id) → not_found`

- [ ] **Step 2: Падающие тесты `openapi.test.ts`**

- `openapi "3.1.0"; путь есть у каждого инструмента; operationId совпадает с именем`
- `/documents/{documentId}/cells: documentId — path, required, нет в requestBody.properties`
- `GET /journals: date — параметр query`
- `в документе нигде нет ключа "$schema"` (обход объекта)

- [ ] **Step 3: Запустить — падают**

Run: `node --import tsx --test src/lib/public-api/rest/*.test.ts`
Expected: FAIL.

- [ ] **Step 4: Реализовать `router.ts`, `openapi.ts`, `http.ts` и маршрут**

- [ ] **Step 5: Тесты проходят**

Run: `node --import tsx --test src/lib/public-api/rest/*.test.ts`
Expected: PASS (5 + 4).

- [ ] **Step 6: Коммит**

```bash
git commit -m "REST API v1 и openapi.json из того же реестра инструментов" -- src/lib/public-api/rest "src/app/api/v1"
```

---

### Task 7: Выпуск и отзыв ключей

**Files:**
- Create: `src/lib/public-api/key-admin.ts`, `src/app/api/settings/api-keys/route.ts`, `src/app/api/settings/api-keys/[id]/route.ts`
- Modify: `src/lib/audit-labels.ts`
- Test: `src/lib/public-api/key-admin.db.test.ts`

**Interfaces:**
- Consumes: `generateApiKey`, `MAX_ACTIVE_KEYS_PER_ORG`, `ApiKeyAccess` (Task 1); `publicBaseUrl` (Task 2); `requireApiAuth`, `getActiveOrgId`, `isImpersonating` (`@/lib/auth-helpers`); `hasFullWorkspaceAccess`.
- Produces:

```ts
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
  access: z.enum(["write", "read"]).default("write"),
});
export type ApiKeyView = {
  id: string; name: string; access: ApiKeyAccess; displayPrefix: string;
  createdAt: string; lastUsedAt: string | null; lastUsedVia: "mcp" | "rest" | null;
  owner: { id: string; name: string }; isMine: boolean;
};
export async function listOrgApiKeys(orgId: string, viewerId: string): Promise<ApiKeyView[]>;   // без отозванных, новые сверху
export async function createApiKey(args: { orgId: string; user: { id: string; name: string }; name: string; access: ApiKeyAccess }):
  Promise<{ ok: true; key: ApiKeyView; secret: string; mcpUrl: string } | { ok: false; status: 409; error: string }>;
export async function revokeApiKey(args: { orgId: string; keyId: string; actor: { id: string; name: string } }):
  Promise<{ ok: true } | { ok: false; status: 404; error: string }>;
```

Правила маршрутов (сессия): `requireApiAuth()`. Затем:
- `!hasFullWorkspaceAccess(session.user)` → 403 `Ключи выпускает руководитель`;
- `isImpersonating(session)` → 403 `Ключ выпускает сам руководитель организации`;
- `session.user.partnerAccess` → 403 `Партнёр не выпускает ключи клиента`.

Организация — `getActiveOrgId(session)`.
- `POST` → 201 `{ key, secret, mcpUrl }`; при 20 активных ключах → 409 `В организации уже 20 ключей — отзовите ненужный`.
- `GET` → `{ keys }`.
- `DELETE /[id]` → `revokedAt = now`; ключ чужой организации или уже отозванный → 404.

Аудит: `api_key.created` / `api_key.revoked`, `entity: "api_key"`, `entityId`, `details: { name, access }`. Подписи в `AUDIT_ACTION_LABELS`: `"public_api.call": { label: "Действие через ИИ или API", variant: "outline" }`, `"api_key.created": { label: "Создан ключ ИИ и API", variant: "secondary" }`, `"api_key.revoked": { label: "Отозван ключ ИИ и API", variant: "destructive" }`.

- [ ] **Step 1: Падающие DB-тесты**

- `createApiKey: secret совпадает с looksLikeApiKey; в БД tokenHash = hashApiKey(secret); строка api_key.created`
- `listOrgApiKeys: в объектах нет secret и tokenHash (Object.keys); isMine верен; отозванные скрыты`
- `21-й активный ключ → 409`
- `revokeApiKey ключа другой организации → 404; своего → revokedAt выставлен, строка api_key.revoked; повторно → 404`

- [ ] **Step 2: Запустить — падают**

Run: `WESETUP_DB_TESTS=1 DATABASE_URL=… node --import tsx --test src/lib/public-api/key-admin.db.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать `key-admin.ts`, маршруты и подписи**

- [ ] **Step 4: Тесты проходят**

Run: команда шага 2 и `npm run typecheck`.
Expected: PASS (4), typecheck чистый.

- [ ] **Step 5: Коммит**

```bash
git commit -m "ИИ и API: выпуск, список и отзыв ключей, подписи в журнале действий" -- src/lib/public-api/key-admin.ts src/lib/public-api/key-admin.db.test.ts "src/app/api/settings/api-keys" src/lib/audit-labels.ts
```

---

### Task 8: Страница «ИИ-ассистенты и API»

Перед правкой вызвать скиллы `design-system` и `frontend-design:frontend-design`.

**Files:**
- Modify: `src/app/(dashboard)/settings/api/page.tsx` (переписать)
- Create: `ai-connect-client.tsx`, `ai-client-guides.tsx`, `api-keys-list.tsx`, `connection-snippets.ts` в той же папке
- Keep: `api-token-manager.tsx` без изменений
- Modify: `src/i18n/messages/{ru,en,uz}.json`, `src/i18n/message-contract.d.ts` (генерируется), `src/lib/settings-cards.ts`, `src/lib/route-titles.ts`
- Test: `src/app/(dashboard)/settings/api/connection-snippets.test.ts`

**Interfaces:**
- Consumes: `listOrgApiKeys`, `ApiKeyView` (Task 7); `PUBLIC_API_TOOLS` — на сервере только `name` и `access`; `publicBaseUrl`; `PageGuide`, `ConfirmDialog`, `Tabs`.
- Produces:

```ts
export type ConnectionSnippets = { claudeUrl: string; chatgptUrl: string; claudeCode: string; cursorJson: string; curl: string };
export function buildConnectionSnippets(args: { baseUrl: string; secret: string | null; placeholder: string }): ConnectionSnippets;
```

Сниппеты (дословно, `K` = `secret ?? placeholder`):
- `claudeUrl` и `chatgptUrl` = `${baseUrl}/api/mcp/${K}`
- `claudeCode` = `claude mcp add --transport http wesetup ${baseUrl}/api/mcp --header "Authorization: Bearer ${K}"`
- `cursorJson` = `JSON.stringify({ mcpServers: { wesetup: { url: \`${baseUrl}/api/mcp\`, headers: { Authorization: \`Bearer ${K}\` } } } }, null, 2)`
- `curl` = `curl ${baseUrl}/api/v1/journals -H "Authorization: Bearer ${K}"`

Страница сверху вниз (гейт — как сейчас: `hasFullWorkspaceAccess`, иначе `redirect("/journals")`):
1. Заголовок «ИИ-ассистенты и API» и подзаголовок «Подключите ChatGPT, Claude или своего разработчика — узнавайте статус журналов, отмечайте ячейки и добавляйте сотрудников прямо в чате.». Под ним `PageGuide` (`storageKey: "settings-api-ai"`), 3 пункта и Q/A: «Это безопасно?», «Что ИИ может записать?», «Чем MCP отличается от API?».
2. Тёмный hero по дизайн-системе (индиго, светящиеся пятна): «Журналы, которые заполняются в чате»; три подсказки-примера «Какие журналы сегодня не заполнены?», «Отметь Смирнову на больничном с 12 по 16 октября», «Добавь повара Анну Иванову, +7 900 000-00-00»; бейджи «MCP», «REST API», «OpenAPI».
3. «Шаг 1. Создайте ключ»: поле названия (по умолчанию «Мой ИИ-ассистент»), сегментный выбор «Чтение и запись» (по умолчанию, пометка «рекомендуем») / «Только чтение», кнопка «Создать ключ». После создания — панель «Ключ показан один раз»: ключ, «Копировать ключ», «Копировать ссылку для Claude и ChatGPT», янтарное предупреждение «Ссылка с ключом — это пароль: не публикуйте её».
4. «Шаг 2. Подключите ассистента»: вкладки Claude / ChatGPT / Cursor и Claude Code / Свой код (REST), горизонтальная прокрутка на 360 px. В каждой вкладке нумерованные шаги и блок с кнопкой копирования. Пока ключа нет — плейсхолдер `<ваш ключ>`, сразу после создания — настоящий ключ.
   - Claude: «Настройки → Коннекторы → Добавить свой коннектор → вставьте ссылку».
   - ChatGPT: «Настройки → Приложения и коннекторы → Расширенные → Режим разработчика → Создать → ссылка, аутентификация «Без аутентификации»».
   - Названия пунктов меню перед выкладкой **сверить с актуальными справками Anthropic и OpenAI**. Под шагами — примечание «Свои коннекторы доступны не на всех тарифах ChatGPT и Claude».
5. «Что умеет ассистент» — шесть карточек (иконка lucide, заголовок, одна строка, бейдж «Чтение» или «Запись») из `settingsManagement.aiConnect.tools.<name>`.
6. «Ключи организации» — список `ApiKeyView`: название, `displayPrefix…`, владелец (у своего — «вы»), права, создан, последний вызов (относительное время или «ещё не использовался») и канал. Кнопка «Отозвать» — `ConfirmDialog` `variant="danger"`, `typeToConfirm: "ОТОЗВАТЬ"`, пункты «ИИ-ассистенты с этим ключом сразу потеряют доступ», «Вернуть ключ нельзя — только выпустить новый». После отзыва — тост «Ключ «<название>» отозван». Пустое состояние: «Ключей пока нет — создайте первый выше».
7. «Безопасность» — три строки: «Ключ действует с правами владельца и только в этой организации», «Каждая запись видна в журнале действий» со ссылкой на `/settings/audit`, «Ключ хранится в виде отпечатка — восстановить его нельзя».
8. Свёрнутый `<details>` «Ключ для датчиков и старых интеграций» — прежние две карточки (`ApiTokenManager` и «Как использовать») без изменений.

Тексты (ru — дословно по пунктам выше; en и uz — перевод): `settingsManagement.aiConnect.*`. Переименование:
- `settingsManagement.home.cards.settings_api` → `{ "title": "ИИ-ассистенты и API", "description": "ChatGPT, Claude и REST API: журналы и сотрудники через чат" }`;
- `navigation.routes.settings_api` → «ИИ-ассистенты и API»;
- `src/lib/route-titles.ts` (`"/settings/api"`) → «ИИ-ассистенты и API».

- [ ] **Step 1: Падающие тесты `connection-snippets.test.ts`**

- `без ключа во всех сниппетах плейсхолдер; с ключом — ключ, плейсхолдера нет`
- `cursorJson разбирается JSON.parse, mcpServers.wesetup.url = base/api/mcp`
- `baseUrl "https://wesetup.ru/" не даёт двойного слэша`

- [ ] **Step 2: Запустить — падают; реализовать `connection-snippets.ts`; запустить — проходят**

Run: `node --import tsx --test "src/app/(dashboard)/settings/api/connection-snippets.test.ts"`
Expected: сначала FAIL, после реализации PASS (3).

- [ ] **Step 3: Тексты в каталогах и типы**

Run: `npm run i18n:types && npm run i18n:check`
Expected: PASS; в `message-contract.d.ts` появился `aiConnect`.

- [ ] **Step 4: Сверстать страницу и клиентские компоненты**

Клиент: `useTranslations("settingsManagement.aiConnect")`. Сеть — `fetch` на `/api/settings/api-keys`. Ошибки — `toast.error(body.error)`. Копирование — как в `api-token-manager.tsx` (с тостом при отказе буфера: в Telegram он бывает недоступен).

- [ ] **Step 5: Карточку — вниз группы**

В `src/lib/settings-cards.ts` перенести строку `settings_api` последней в блок «Остальное: подключения» (после `settings_accounting`).
Run: `node --import tsx --test src/lib/app-nav.test.ts src/lib/no-settings-hub-links.test.ts`
Expected: PASS.

- [ ] **Step 6: Если нового меню ещё нет**

`settings-cards.ts` отсутствует → обновить описание карточки в хабе `src/app/(dashboard)/settings/page.tsx` (элемент с `href: "/settings/api"`) и `messageId`-текст; позицию не менять. Шаг 5 пропустить.

- [ ] **Step 7: Посмотреть глазами**

Dev-сервер на e2e-базе: `DATABASE_URL=… NEXTAUTH_URL=http://localhost:3000 NEXT_DIST_DIR=.next-e2e npm run dev`. Через Playwright открыть `/settings/api` под руководителем при ширине 1280 и 360, создать ключ, переключить все вкладки, отозвать ключ. Скриншоты — в `.agent/tasks/ai-mcp-api-2026-10/raw/`.
Expected: при 360 нет горизонтальной прокрутки страницы; ключ показан один раз и после перезагрузки маскируется; тост после отзыва.

- [ ] **Step 8: Коммит**

```bash
git commit -m "Страница «ИИ-ассистенты и API»: ключи, инструкции для Claude, ChatGPT и Cursor" -- "src/app/(dashboard)/settings/api" src/i18n/messages src/i18n/message-contract.d.ts src/lib/settings-cards.ts src/lib/route-titles.ts
```

(Если `git status` показывает в `src/i18n/messages/*.json` чужие незакоммиченные хунки — собрать свои через временный индекс, как в memory `parallel-sessions-shared-git-index`.)

---

### Task 9: /developers и «Что нового»

**Files:**
- Modify: `src/app/developers/page.tsx`, `src/lib/whats-new-notes.ts`, при новой категории — `CATEGORY_ICONS` в `src/components/dashboard/whats-new-modal.tsx`

- [ ] **Step 1: /developers**

В начало страницы — раздел «ИИ-ассистенты (MCP)»:
- что это одной фразой;
- две формы адреса: `https://wesetup.ru/api/mcp` с заголовком и `/api/mcp/<ключ>`;
- шесть инструментов списком;
- кнопка «Получить ключ» → `/settings/api`.

Следом раздел «REST API v1»: таблица шести путей и ссылка на `/api/v1/openapi.json`. Текущий список `/api/external/*` остаётся ниже под заголовком «Интеграции и датчики». В `DESCRIPTION` добавить «MCP для ChatGPT и Claude». Стиль — как у существующих блоков (`CODE`, карточки `ENDPOINTS`).

- [ ] **Step 2: Новинка**

Первым элементом `WHATS_NEW_NOTES` — категория «Интеграции» (иконка `Plug` уже в карте; если категория уже есть — добавить пункт в её начало):
- «ИИ-ассистенты: подключите ChatGPT или Claude в «Остальное → ИИ-ассистенты и API» — спрашивайте, какие журналы не заполнены, отмечайте больничные и добавляйте сотрудников прямо в чате.»
- «REST API v1 с описанием OpenAPI — для своих интеграций.»

- [ ] **Step 3: Проверить и закоммитить**

Run: `npm run typecheck && node --import tsx --test src/i18n/feature-pages-localization.test.ts`
Expected: PASS.

```bash
git commit -m "Что нового и /developers: ИИ-ассистенты через MCP и REST API v1" -- src/app/developers/page.tsx src/lib/whats-new-notes.ts
```

---

### Task 10: Сквозная проверка, доказательства, выкладка

**Files:**
- Create: `.agent/tasks/ai-mcp-api-2026-10/evidence.md`, `evidence.json`, `raw/*`

- [ ] **Step 1: Полный набор проверок**

Run: `npm run typecheck && npm run lint && npm test && npm run i18n:check`
Expected: всё зелёное, новых падений против `tests/.legacy-failures.txt` нет.
Run: `WESETUP_DB_TESTS=1 DATABASE_URL=… node --import tsx --test src/lib/public-api/*.db.test.ts src/lib/public-api/tools/*.db.test.ts`
Expected: PASS.

- [ ] **Step 2: Протокол вручную (dev-сервер на e2e-базе, ключ из UI в `$K`)**

```bash
# легаси
curl -s -X POST localhost:3000/api/mcp -H "Authorization: Bearer $K" -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
# современный
curl -s -X POST localhost:3000/api/mcp/$K -H "content-type: application/json" -H "MCP-Protocol-Version: 2026-07-28" -H "Mcp-Method: tools/call" -H "Mcp-Name: list_journals" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_journals","arguments":{},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
# без ключа, GET, лимит
curl -si -X POST localhost:3000/api/mcp -d '{}' | head -1        # 401
curl -si localhost:3000/api/mcp | head -1                       # 405
curl -s localhost:3000/api/v1/openapi.json | head -c 200        # "openapi":"3.1.0"
# AC8: старый ключ организации по-прежнему работает на /api/external, но не на MCP
curl -s "localhost:3000/api/external/summary" -H "Authorization: Bearer $ORG_TOKEN" | head -c 120   # "ok":true
curl -s -X POST localhost:3000/api/mcp -H "Authorization: Bearer $ORG_TOKEN" -d '{}'                # 401 «Это ключ интеграций…»
```

Expected: `protocolVersion: "2025-06-18"` в первом ответе; `resultType: "complete"` и `summary` во втором; статусы как в комментариях. 121 вызов за минуту — последний 429 (цикл на bash). Ответы сохранить в `raw/`.

- [ ] **Step 3: Настоящие клиенты**

- MCP Inspector: `npx @modelcontextprotocol/inspector`, транспорт Streamable HTTP, URL `http://localhost:3000/api/mcp/<ключ>` → виден список из шести инструментов → вызвать `list_journals` и `fill_journal_cells` (hygiene, `day_off`, один сотрудник, сегодня). Ячейку проверить в интерфейсе.
- Claude Code: `claude mcp add --transport http wesetup-local http://localhost:3000/api/mcp --header "Authorization: Bearer <ключ>"` → в `/mcp` сервер подключён → попросить «Какие журналы сегодня не заполнены?» → ответ основан на `list_journals`.
- Скриншоты и логи — в `raw/`. Строки `public_api.call` видны на `/settings/audit`.

- [ ] **Step 4: Доказательства и независимая проверка**

Записать `evidence.md` и `evidence.json`: AC1–AC12, по каждому команда или скриншот и результат. Запустить агента `task-verifier` по текущему коду. Если не PASS — `problems.md`, минимальная правка через `task-fixer`, повторная проверка.

- [ ] **Step 5: Выкладка**

Через `ListAgents`/`SendMessage` убедиться, что у соседей нет незакоммиченных зависимостей, ломающих деплой. Затем `git push origin master`. После деплоя (`.build-sha` на сервере совпадает с HEAD) проверить:

```bash
curl -si -X POST https://wesetup.ru/api/mcp -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' | head -1   # 401
curl -s https://wesetup.ru/api/v1/openapi.json | head -c 120
```

- [ ] **Step 6: Отчёт владельцу**

Что сделано и чем проверено, по пунктам AC. Отдельно — открытые зависимости от владельца: проверка в ChatGPT и claude.ai на его аккаунтах и решения из раздела «Что нужно от владельца», если ответов ещё нет. Не объявлять работу полностью завершённой, пока живые клиенты не проверены.
