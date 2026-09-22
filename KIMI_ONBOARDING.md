# Онбординг для Kimi 2.6 — проект WeSetup (HACCP-Online)

Скопируй весь этот файл в первое сообщение Kimi. Это полный брифинг — кто мы, что делаем, как работать, что уже готово и что открыто.

---

## 1. Кто ты и чем занимаешься

Ты — ассистент, который помогает мне (владельцу/инженеру) развивать два связанных SaaS-продукта. Работаешь ты **локально на моей машине** (Windows, `c:/www/`), а не в облаке. Код, который ты меняешь, я сам пушу в GitHub, когда скажу «пушни в прод» — автодеплой уже настроен, push в `master` / `main` запускает прод-сборку. **Никогда не пуши сам** без моего явного «пушни» или «деплой».

Говоришь со мной по-русски. Код и комментарии в коде — английские, но UI-строки всегда русские (ХАССП / СанПиН).

---

## 2. Проекты

### 2.1. WeSetup (HACCP-Online) — основной

- **Где**: `c:/www/Wesetup.ru`
- **GitHub**: `https://github.com/djdes/HACCP-Online`
- **Прод**: `https://wesetup.ru`
- **Стек**: Next.js 16 App Router (Turbopack), TypeScript, Prisma 7, PostgreSQL, NextAuth.js 4, shadcn/ui, Tailwind CSS 4, PM2 на Linux VPS.
- **Зачем**: электронные журналы СанПиН и ХАССП для общепита и пищевых производств. 35+ шаблонов журналов (гигиена, здоровье, температура холодильников, уборка, бракераж, дезинфекция, и т.д.). Менеджер ведёт их в браузере и в Telegram-боте, инспектор Роспотребнадзора получает PDF/ZIP одним кликом.

### 2.2. TasksFlow — отдельный продукт, связанный интеграцией

- **Где**: `c:/www/TasksFlow`
- **GitHub**: `https://github.com/djdes/TasksFlow`
- **Прод**: `https://tasksflow.ru`
- **Стек**: Express + TypeScript на Node, Drizzle ORM + MySQL (общая с продом MySQL-БД на `192.168.33.3`), Vite фронт.
- **Зачем**: система задач «уборщице убрать холодильник в 10:00». WeSetup создаёт задачи в TasksFlow через API-ключ, сотрудники в TasksFlow их выполняют, обратный webhook отмечает соответствующую ячейку WeSetup-журнала.

### 2.3. Как они связаны

- WeSetup имеет на каждой организации `TasksFlowIntegration(baseUrl, apiKeyEncrypted)`.
- Клиент `src/lib/tasksflow-client.ts` шлёт HTTP с `Authorization: Bearer tfk_...`.
- `TasksFlowUserLink(organizationId, wesetupUserId, tasksflowUserId)` хранит маппинг сотрудников по нормализованному телефону.
- TasksFlow → WeSetup: webhook на завершение задачи, WeSetup дёргает `markTaskDone` через HMAC-подписанный URL.

---

## 3. Рабочий процесс

1. **Всегда начинаем локально.** Dev-сервер у меня запущен на `http://localhost:3000` (Next) и `http://127.0.0.1:5001` (локальный TasksFlow). Когда меняешь prisma/schema.prisma — делай `npx prisma db push && npx prisma generate`, потом **перезапусти dev-сервер** (Turbopack держит старый Prisma Client в памяти).
2. **SSH-туннель** для БД: локальный WeSetup ходит в прод-Postgres через `127.0.0.1:5433` → `wesetup.ru:5432`. Туннель должен быть поднят; если нет — `npx tsx` скрипты упадут с `ECONNREFUSED`.
3. **Коммиты** — на каждую законченную мысль, по принципу Karpathy (surgical changes, YAGNI). Стиль: `type(scope): summary` на русском (`feat(reports): ...`, `fix(rbac): ...`). В теле — что было сломано, что починили, и почему.
4. **Не пушить самому.** Я скажу «пуш». Тогда:
   - WeSetup: `git push origin master` → GitHub Actions `.github/workflows/deploy.yml` → прод на `wesetup.ru` (PM2 процесс `haccp-online` на порту 3002).
   - TasksFlow: `git push origin main` → webhook → прод на `tasksflow.ru`.
5. **Скилы-дисциплина**:
   - `karpathy-guidelines`: минимальные правки, не оптимизируй то, что не просили, не добавляй абстракции про запас.
   - `design-system` (WeSetup): дарк-hero с indigo-акцентом `#5566f6`, soft surfaces `#fafbff`, `rounded-2xl`/`3xl`, без `text-muted-foreground`.
   - Для UI-задач ВСЕГДА инвоукай `design-system` и `frontend-design` скилы до первой правки.

---

## 4. Локальные кредиши (только для тестов и диагностики)

```
# Прод-БД через туннель (WeSetup)
DATABASE_URL="postgresql://magday:r15*gRJPulurILWV@127.0.0.1:5433/haccp_magday?sslmode=disable"

# SSH в прод WeSetup
Host: wesetup.ru, User: wesetupru, Pass: <WESETUP_SSH_PASSWORD из .env>, Port: 22 (external 50222 закрыт)
Путь: /var/www/wesetupru/data/www/wesetup.ru/app
PM2: haccp-online на :3002

# Локальный TasksFlow
API: http://127.0.0.1:5001
MySQL: 192.168.33.3 (та же что и прод)
```

---

## 5. Архитектура WeSetup (ключевое)

### 5.1. Multi-tenancy

- Все бизнес-таблицы скоупятся по `organizationId` из сессии.
- `session.user.organizationId` — домашняя орг.
- `getActiveOrgId(session)` — текущая (разная при ROOT-impersonate). **Используй только `getActiveOrgId` в API и server-components.**

### 5.2. Three-tier access (старый механизм)

- **ROOT** (`User.isRoot=true`): платформенный суперадмин, живёт в синтетическом `Organization { id: "platform" }`. `/root/*`. Не-root на `/root/*` = 404 (`src/middleware.ts`), не redirect — чтобы не палить.
- **Company management**: `role in {manager, head_chef}` или legacy `{owner, technologist}`. Видит всё в своей орг. Bypass per-journal ACL.
- **Employee**: `cook`, `waiter`, или любой с `journalAccessMigrated=true` + без строк в `UserJournalAccess` — видит только разрешённые журналы.
- Helpers: `src/lib/role-access.ts` (`hasFullWorkspaceAccess`, `canAccessWebPath`), `src/lib/user-roles.ts` (`isManagementRole`, `isManagerRole`).
- **ВАЖНО**: все новые API endpoints и UI-гейты обязаны пускать `manager`/`head_chef`. Если видишь inline `["owner","technologist"].includes(role)` — это legacy-only и ломает менеджера. Заменяй на `isManagementRole(role)`.

### 5.3. Permission matrix (новый механизм, параллельно старому)

- Enum 41 permission (`PERMISSIONS` в `src/lib/permissions.ts`), сгруппированы по 7 смысловым блокам.
- Override тремя уровнями:
  1. **Группа** (management/staff) — дефолт.
  2. **Должность** — `JobPosition.permissionsJson` (JSON-массив).
  3. **Пользователь** — `User.permissionsJson`.
- Resolve: isRoot → всё; user > position > group default.
- UI: `/settings/permissions` — аккордеоны по должностям и людям.
- API: `GET/PUT /api/organizations/permissions`.
- **TODO**: существующие role-gates постепенно мигрировать на `hasPermission(actor, 'batches.manage')` и т.п. Пока сосуществуют.

### 5.4. Журнал-специфичный ACL (per-user per-journal)

- Таблица `UserJournalAccess(userId, templateCode, canRead, canWrite, canFinalize)`.
- Helper `src/lib/journal-acl.ts` с 60-сек LRU-кэшем и `invalidateJournalAcl(userId)`.
- UI матрица: `/settings/journal-access` — сотрудники × журналы, пресеты по должностям («Уборка → уборщикам», «Температура → поварам», «Здоровье → всем», «Приёмка → товароведам»).
- Per-user вариант: `/settings/users/[id]/access`.
- Backward-compat: до `journalAccessMigrated=true` + пустой ACL = видит всё.

### 5.5. Shifts / график смен

- Таблица `WorkShift(organizationId, userId, date, status, jobPositionId?)`. status ∈ `scheduled/off/vacation/sick`.
- UI `/settings/schedule` — 14-дневная сетка. Клик по ячейке циклит статус; при «scheduled» появляется select «подмена должности».
- Helper `src/lib/work-shifts.ts`: `isUserOnDuty`, `listOnDutyToday`, `resolveOnDutyForPosition`, `resolveOnDutyByCategory`.
- **Уже интегрировано**: `detectTemperatureCapas` назначает CAPA на дежурного менеджера (fallback — первый manager).
- **Планируется**: bulk-assign-today / ensureTasksflowTasks — пропускать не-дежурных, CAPA по auto-flags — routed на дежурного по должности.

### 5.6. Регистрация и инвайты

- `/register` — 3 шага: details → 6-значный email-код (`/api/auth/register/request` + `/confirm`) → тариф.
- В dev, если SMTP не настроен, код показывается прямо на странице как зелёная плашка (fallback `f305676`).
- Employee invite: `POST /api/users/invite` создаёт placeholder `User(isActive=false)` + `InviteToken` (SHA-256 хеш в БД, plain в ссылке, TTL 7 дней). `/invite/[token]` принимает пароль и активирует.

### 5.7. Impersonation (ROOT)

- `POST /api/root/impersonate` пишет AuditLog, клиент делает `useSession().update({ actingAsOrganizationId })` → JWT получает клейм. Cookie НЕ подменяется. Красный sticky banner с «Выйти» (`src/components/dashboard/impersonation-banner.tsx`).

### 5.8. Общий API-паттерн

```ts
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return 401;
  if (!isManagementRole(session.user.role)) return 403;
  // или: if (!(await sessionHasPermission(session, "batches.manage"))) return 403;
  const orgId = getActiveOrgId(session);
  const body = schema.parse(await req.json());   // Zod
  const result = await db.xxx.create({ data: { ..., organizationId: orgId } });
  return NextResponse.json(result);
}
```

---

## 6. Ключевые модули (`src/lib/`)

| Файл | Что делает |
|------|------------|
| `db.ts` | Prisma singleton |
| `auth.ts` | NextAuth config (JWT c isRoot, actingAsOrganizationId) |
| `auth-helpers.ts` | `requireAuth`, `requireRole`, `requireRoot`, `getActiveOrgId`, `isImpersonating` |
| `role-access.ts` | `hasFullWorkspaceAccess`, path-based gates |
| `user-roles.ts` | `isManagementRole`, `isManagerRole`, normalize legacy → modern |
| `permissions.ts` | enum 41 permission, defaults, resolver (pure-data) |
| `permissions-server.ts` | `sessionHasPermission`, `userHasPermission` (server) |
| `journal-acl.ts` | per-user journal ACL с LRU кэшем |
| `work-shifts.ts` | resolve-дежурного |
| `journal-auto-create.ts` | `ensureActiveDocument`, `ensureDocumentsFor` для bulk/auto |
| `journal-period.ts` | per-template период документа (month vs year) |
| `today-compliance.ts` | ring «готовность сегодня», daily vs aperiodic логика |
| `capa-auto-detect.ts` | «3 дня подряд вне нормы → CAPA» |
| `tasksflow-client.ts` | HTTP-клиент к TF |
| `tasksflow-user-sync.ts` | sync сотрудников, копит failures с HTTP-status |
| `regulator-bundle.ts` | PDF cover + CAPA summary для ZIP-отчёта |
| `offline-queue.ts` | IndexedDB submit-queue |
| `use-offline-submit.ts` | хук + `submitWithOfflineFallback` |
| `russian-number-parser.ts` | «два и восемь» → 2.8 для Web Speech |

---

## 7. Crucial journal model

- **Dynamic forms**: `JournalTemplate.fields` (JSON-массив). Поддержка `text | number | date | boolean | select | equipment | employee`.
- **Document-based journals** (сетка «сотрудник × день»): `JournalDocument` + `JournalDocumentEntry(documentId, employeeId, date, data)`.
- **Daily codes** в `src/lib/daily-journal-codes.ts`: `DAILY_JOURNAL_CODES` (записи в `JournalDocumentEntry`), `CONFIG_DAILY_CODES` (записи в `JournalDocument.config.rows[]`), `COUNTS_UNBOUNDED_CODES` (finished_product, perishable_rejection — события без ростера).
- **Compliance ring** (dashboard / `/journals` hero) считает только daily mandatory с активным документом. Aperiodic (медкнижки, аудиты) не влияют. Это был баг «70% сразу после создания документов» — пофикшен `762e9d4`.
- **Per-template period** (`src/lib/journal-period.ts`): yearly-список (med_books, equipment_calibration, audit_plan, staff_training, и т.д.) получает 1 янв → 31 дек; остальные — месячный. Используется в `ensureActiveDocument`.

---

## 8. Что уже сделано (недавние коммиты)

```
8a81725 feat(settings): матрица «Журналы для сотрудников» + пресеты по должностям
87a4b40 fix(offline): hydration mismatch — navigator.onLine читается в useState
1e95be9 feat(error): локализованная error boundary + кнопка «Повторить»
01ecf8e feat(404): локализованная страница «не найдено» вместо дефолтной Next
c821f24 fix(header): overlap on tablet 768 — «Сотрудники» pill и «В сети» badge
141ea29 fix(features): hero heading clips at 320px — fluid clamp + safer padding
b59fc88 fix(auto-journals): mobile overflow — section вылезала за 390px
661ed84 feat(shifts): график смен + назначение на должность вместо имени
d795b16 feat(reports): регуляторный ZIP — cover + CAPA.pdf + preset «По звонку инспектора»
e33731f feat(tasksflow): manual workaround when TF blocks Bearer user creation
8d8d065 feat(offline): IndexedDB-очередь для заполнения журнала при потере сети
ee27628 feat(voice): голосовой ввод температуры холодильников
52eef92 feat(capa): auto-trigger temp-anomaly detection on cold-equipment saves
7aa2537 fix(tasksflow): surface sync failures with real error details
1bd542b feat(rbac): permission matrix — group / position / individual overrides
84f2c68 fix(rbac): modern manager/head_chef must pass every role gate
762e9d4 fix(journals): per-template document period + exclude aperiodic from compliance ring
084943d feat(journals): bulk-create selected journals + auto-create settings
ccd0cce fix(dashboard): wrap long journal names on mobile instead of truncating
```

### 8.1. Ключевые свежие фичи детально

- **Bulk-create журналов** — на `/journals` липкая панель «К созданию доступно N · Выбрать все · Создать выбранные (N)». Чекбоксы на карточках без активного документа. API `POST /api/journal-documents/bulk-create`.
- **Автосоздание журналов** — `/settings/auto-journals`. Чекбоксы журналов → сохраняется в `Organization.autoJournalCodes` → (TODO) ежедневный cron на `/api/journal-documents/auto-create`. Пока вручную через кнопку.
- **Regulator ZIP** — `/reports` → «По звонку инспектора (7 дней)». `/api/reports/compliance-bundle` отдаёт ZIP: `00_СВОДКА.pdf` (cover для инспектора), `CAPA.pdf` (таблица корректирующих), `<шаблон>/<документ>.pdf` по папкам, `ОТЧЁТ.txt` manifest.
- **Smart CAPA** — `detectTemperatureCapas` смотрит за 3 днями: если одна и та же холодилка 3 дня подряд вне нормы — открывает CAPA с черновиком «Проверить компрессор» + pre-filled корректирующие. Триггерится из Tuya webhook и после ручной записи температуры в `cold_equipment_control`.
- **Голосовой ввод** — `VoiceNumberInput` компонент рядом с инпутом температуры (пока только в cold-equipment mobile layout). Web Speech API ru-RU, парсер «два и восемь» → 2.8, «минус три» → -3.
- **Офлайн-очередь** — `submitWithOfflineFallback()` + IndexedDB `submit-queue`. При сетевом faluse кладёт payload, `useOfflineQueue` авто-flush по `window.online`. `<OfflineIndicator>` в шапке: зелёный «В сети» на lg+, жёлтый «ждёт N» с сетью но очередь не пуста, красный «Офлайн N» без сети. Пилот на температуру холодильника.
- **Permissions matrix** — `/settings/permissions`. Не мигрированы существующие gates, но инфраструктура готова.
- **Shifts** — `/settings/schedule`. Подключено в CAPA auto-detect (дежурный менеджер).
- **Journal-access matrix** — `/settings/journal-access`.

---

## 9. Открытые задачи / pending

1. **TasksFlow: 15 локальных коммитов в `c:/www/TasksFlow` не запушены**, в т.ч. `0dd1c41 feat(api): allow api-key user provisioning` — коммит разблокирует `POST /api/users` по Bearer-ключу. Прод TasksFlow сейчас без него, поэтому автосоздание сотрудников с прода в TF даёт 401. **Решение: я (пользователь) должен сам запушить `cd c:/www/TasksFlow && git push origin main`**, автодеплой задеплоит. Локально на 127.0.0.1:5001 эта версия уже работает — успешно протестировали end-to-end создание.
2. **SW precache для офлайн-режима** — сейчас только IndexedDB-очередь. Чтобы форма работала без сети после закрытия вкладки, нужен Service Worker с precache формы + Background Sync API. Отложено.
3. **Перевод существующих role-gates на `hasPermission`** — сейчас `isManagementRole` inline во многих endpoints. Постепенно заменить на permission-based.
4. **Daily cron для auto-create журналов** — endpoint `/api/journal-documents/auto-create` готов, но расписания нет. Добавить external cron или in-process scheduler.
5. **Схема лицензирования / тарифы** — пока `Organization.subscriptionPlan="trial"` и `subscriptionEnd` не enforce'ятся.
6. **Расширить офлайн-очередь** на другие журналы — сейчас только `cold_equipment_control` PUT температуры.

---

## 10. Конвенции, которые нельзя нарушать

1. **UI текст — русский**. Код и комменты — английский, если не нужно по-русски объяснить тонкий момент.
2. **Next 16 params — Promises**: `{ params }: { params: Promise<{ id: string }> }`, всегда `await params`.
3. **`sonner` для toasts**, не нативный alert.
4. **Path alias `@/*` → `./src/*`**.
5. **Prisma changes**: `npx prisma db push` (prod), `npx prisma generate`, **перезапуск dev-сервера**.
6. **Никаких `any`** там, где можно типизировать. Если уж очень надо — `unknown` + narrowing.
7. **Никаких auto-refactors по пути**. Если тебе не просили — не трогай.
8. **Role-gates всегда через `isManagementRole` / `hasFullWorkspaceAccess` / `sessionHasPermission`**, не inline enum.
9. **Error responses — `NextResponse.json({ error: "русский текст" }, { status: …})`**, не просто текст.
10. **После каждой UI-правки** — зайди на страницу, проверь глазами (Playwright MCP), сделай скриншот. Не коммить «закрытыми глазами».

---

## 11. Когда я пишу «пушни»

WeSetup:
```bash
cd c:/www/Wesetup.ru
git status
git log --oneline origin/master..HEAD
git push origin master
```

TasksFlow:
```bash
cd c:/www/TasksFlow
git status
git log --oneline origin/main..HEAD
git push origin main
```

Оба пуша триггерят автодеплой → через 2-3 минуты живые.

---

## 12. Первая задача

Когда я дам следующее задание — первым делом:

1. Прочитай `CLAUDE.md` в `c:/www/Wesetup.ru/CLAUDE.md` (и в `c:/www/TasksFlow/CLAUDE.md`, если связано с TF).
2. Инвоукни релевантные скилы (`karpathy-guidelines` до любого кода, `design-system`/`frontend-design` до любого UI).
3. Исследуй (Read/Grep/Glob) точечно, не лопать весь репо.
4. Сделай минимальную правку, протестируй, закоммить с внятным сообщением.
5. **Никакого push**, пока я не скажу.

Поехали.
