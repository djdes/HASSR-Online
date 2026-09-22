# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Архитектурные принципы Wesetup ↔ TasksFlow (П-1—П-19, обязательны для каждой правки)

Утверждены 2026-05-09 в brainstorming-сессии с владельцем проекта.
Полная спецификация: [`docs/superpowers/specs/2026-05-09-wesetup-tasksflow-integration-design.md`](./docs/superpowers/specs/2026-05-09-wesetup-tasksflow-integration-design.md).

**ВАЖНО:** перед любой правкой касающейся интеграции с TasksFlow (адаптеры
`src/lib/tasksflow-adapters/*`, эндпоинты `src/app/api/integrations/tasksflow/*`,
`TasksFlowTaskLink`, `TasksFlowUserLink`, `TasksFlowOutbox`, claim/verify-flow,
race-mode, siblings cleanup) **ОБЯЗАТЕЛЬНО** перечитать соответствующий
принцип ниже и spec — иначе риск поломать архитектуру.

### Границы систем (system boundary)

- **П-1.** TasksFlow — независимый standalone-сервис. Wesetup — клиент его API.
  Wesetup не владеет TasksFlow и не диктует ему логику. TF может обслуживать
  других клиентов.
- **П-3.** Wesetup существует в двух местах с **одинаковым** функционалом:
  сайт `wesetup.ru` (десктоп) и Mini App в Telegram через `@wesetupbot`
  (`/mini/*`). Mini App — мобильное зеркало сайта. Если фича есть на сайте —
  должна быть в Mini App. Никаких дубликатов worker-flow (заполнение журналов
  в Mini App запрещено — это делается в TF).
- **П-11.** Единая дизайн-система в обоих проектах. Источник —
  [`.claude/skills/design-system`](.claude/skills/design-system/) Wesetup'а.
  Палитра `#5566f6` индиго, `rounded-2xl`/`rounded-3xl`, hover transitions
  150-200ms. TF копирует токены при правке UI.
- **П-12.** Связь только через TF REST API. **Никаких** cross-imports между
  репозиториями. **Никаких** прямых SQL/ORM запросов в чужую БД. Wesetup
  имеет `src/lib/tasksflow-client.ts` и пользуется только им.
- **П-18.** Multi-org isolation: Wesetup `Organization` ↔ TF `company`
  связаны 1:1 через `TasksFlowIntegration.tasksflowCompanyId`. При любом
  запросе в TF Wesetup автоматически фильтрует `companyId=<current>`.

### Идентификация и доступ (identity & access)

- **П-4.** Права в Wesetup — централизованные (`permissionPreset` в
  `User`). Админ организации настраивает в `/settings/permissions`. Эти права
  применяются одинаково на сайте и в Mini App (П-3).
- **П-5.** TasksFlow имеет свои отдельные права. Wesetup в них не лезет —
  это разные домены.
- **П-6.** Один человек = два аккаунта (Wesetup + TF), связанных через
  `TasksFlowUserLink (wesetupUserId, tasksflowUserId)`.
- **П-7.** Вход в TasksFlow — только по номеру телефона (SMS-код или
  Telegram). Без пароля. Wesetup поддерживает аналогичный вход через
  Telegram (по номеру) + email/password как fallback.
- **П-8.** Связка аккаунтов — авто по номеру телефона. При создании
  сотрудника в Wesetup ОБЯЗАТЕЛЬНО номер. Wesetup делает `GET /api/users?phone=...`
  в TF, находит → `INSERT TasksFlowUserLink`. Не находит → предлагает
  «Отправить приглашение в TF». Старые аккаунты без номера могут быть
  «подружены» позже — управляющая добавляет номер, авто-lookup срабатывает.
  Ручная привязка (`/settings/integrations/tasksflow`) остаётся как fallback.

### Sync и ownership

- **П-9.** Sync TF → Wesetup — гибрид:
  - Webhook (быстрый, 1-2 сек): TF отправляет POST на
    `/api/integrations/tasksflow/event` при изменении статуса.
  - Polling (страховочный, раз в 10 мин): cron в Wesetup ходит в TF и
    догоняет потерянные события.
  - Дедупликация: `tasksflow_event_log` по `eventId`.
- **П-10.** Источник правды:
  - **TF** владеет статусами задач (open/in_progress/done/verified/claimed_by_other).
  - **Wesetup** владеет содержимым журналов (T/G/«/», коды С1/С2, фото).
  - При расхождении: TF wins для статуса задач, Wesetup wins для журналов.
- **П-13.** Создание задач — гибрид:
  1. Cron в Wesetup в 00:01 каждой ночи создаёт задачи на сегодня.
  2. Управляющая может вручную нажать «Отправить задачи» в Wesetup
     (manual override).
  3. Уникальный ключ `(documentId, rowKey, dateKey)`. Повторная отправка
     возвращает существующий `tasksflowTaskId` (idempotent).
  4. ВСЁ создание идёт через TF API — никаких прямых записей в TF БД.
- **П-15.** Failure mode — graceful degradation:
  - **Outbox pattern**: каждая команда Wesetup→TF записывается в
    `TasksFlowOutbox` перед отправкой. Cron каждые 30 сек проигрывает
    pending записи. Если TF недоступен — копится в очереди.
  - **Idempotency-Key** на каждой команде. Повторный вызов = no-op.
  - **Polling fallback** (П-9) догоняет потерянные webhook'и при падении Wesetup.
  - Никаких блокировок UI — обе системы работают независимо.
- **П-19.** Idempotency-Key (UUID-v7) на каждой команде Wesetup→TF. Header
  `Idempotency-Key: <uuid>` обязателен. TF принимает повторные вызовы и
  возвращает результат прошлого. Привязка ключа — к `(documentId, rowKey, action)`.

### Domain logic

- **П-2.** Race-siblings cleanup — **auto-claim** (помечаем «сделано
  другим»), не delete. Когда worker-1 закрывает task в TF, Wesetup ловит
  webhook и через TF API маркирует sibling-задачи (тот же `documentId`+
  `rowKey`-prefix `room::<roomId>::cleaner::*`, другие `workerId`) как
  `claimed_by_other` с указанием кто. Если в TF нет статуса
  `claimed_by_other` — fallback на `DELETE /tasks/<id>` (auto-delete).
  Реализация в `src/lib/cleaning-siblings-cleanup.ts`.
- **П-14.** Verify-flow — гибрид:
  - Заведующая может подтвердить и в TF, и в Wesetup.
  - Дедуп через `verifiedAt`: первое подтверждение фиксируется, второе
    становится no-op (не error).
  - При подтверждении в Wesetup: пишем `verifiedAt` + outbox
    `PUT /tasks/<id> { status: "verified" }` в TF.
  - При подтверждении в TF: webhook → Wesetup пишет `verifiedAt`.
- **П-16.** Cleanup старых задач — Wesetup управляет: cron в 03:00
  ежедневно удаляет в TF задачи `remoteStatus IN ('done','verified',
  'claimed_by_other') AND completedAt < NOW() - INTERVAL '30 days'`.
  Compliance-данные (`JournalDocumentEntry`) остаются навсегда.
  Управляющая может вручную через кнопку «Очистить TF архив».

### Audit

- **П-17.** Audit log — раздельный. TF пишет свой (claim/complete/verify
  на задачах). Wesetup пишет свой (`AuditLog`: journal-fill, manager-actions).
  Объединённый отчёт: Wesetup при рендере подтягивает TF events через
  `GET /api/audit?taskIds=...&since=...` и объединяет хронологически.
  Никаких физически объединённых таблиц.

### Что делать при правке

1. **Прочитай spec целиком** перед любой нетривиальной правкой:
   [`docs/superpowers/specs/2026-05-09-wesetup-tasksflow-integration-design.md`](./docs/superpowers/specs/2026-05-09-wesetup-tasksflow-integration-design.md).
2. **Проверь что правка соответствует принципам.** Если правка нарушает
   принцип — STOP, обсуди с владельцем (может быть нужно обновить spec).
3. **Никогда не делай:**
   - Прямых SQL-запросов в TF БД из Wesetup (нарушает П-12).
   - Дублирования логики задач в Wesetup (нарушает П-10).
   - Дублирования worker-flow в Mini App (нарушает П-3).
   - Хардкода паролей или токенов TF (П-7 — phone-only).
   - Создания задач в TF минуя outbox (нарушает П-15, П-19).

## Принципы UX (важно — для каждой фичи)

1. **Максимально просто. Чем меньше действий — тем лучше.**
   Если задача требует > 3 кликов в типичном сценарии — упрощать.
   Default behavior должен быть «правильным» без настройки.

2. **Каждый раз должно быть абсолютно понятно.**
   Любой экран сотрудника должен явно показывать: что нужно сделать,
   как это сделать, и что произойдёт после. Без подразумеваемого
   контекста, без «надо догадаться». Подсказки, гайды, пошаговые
   pipeline'ы — да. Догадывание — нет.

3. **Новый сотрудник без обучения.**
   Когда новая уборщица / повар / продавец впервые открывает приложение,
   у неё должно быть абсолютно понятное ТЗ: какие средства взять, куда
   пойти, что именно помыть/проверить, и в какой последовательности.
   Pipeline-шаги вместо «свободного» заполнения, конкретика вместо
   общих слов («помой холодный цех» vs «1) возьми тряпку → 2) холодный
   цех → 3) протри столы и подоконники»).

4. **Используй superpowers.**
   Для сложных задач (нетривиальный refactor, multi-step feature, новые
   архитектурные элементы) — обязательно вызывать релевантные skills из
   superpowers (brainstorming, systematic-debugging, test-driven-development,
   verification-before-completion, frontend-design). Skills не optional —
   они часть процесса.

5. **«Просто» в коде = «просто» в UI.**
   Если UI выглядит сложным — код тоже сложный. Если код запутанный —
   UI получится непредсказуемый. Чистая модель данных → чистый UX.

6. **Любая новая кнопка — «конфетка», а не голый control.**
   Всё что добавляется в UI — должно быть в стиле сайта (design system
   из `.claude/skills/design-system`), удобным, гибким, интерактивным
   и с подсказкой «что произойдёт». Конкретные правила:

   - **Confirm-действия → `<ConfirmDialog>`, не `window.confirm/prompt`.**
     Компонент в `src/components/ui/confirm-dialog.tsx`. Поддерживает
     варианты (default/info/warn/danger), bullet-список последствий,
     `typeToConfirm` для самых опасных операций. Native browser
     prompt'ы запрещены — они выглядят чужеродно.

   - **Выпадающие выборы сотрудников/должностей → группированный
     popover, как `UserPicker` в `journal-responsibles-client.tsx`.**
     Группы «Рекомендуем / Можно / Не рекомендуем», поиск, аватар,
     контекстная подсказка справа (нагрузка, tier, причина), корона
     у админа. Native `<select>` для людей не используем.

   - **Destructive-кнопки** — кроме модалки с typeToConfirm иметь
     красно-розовую заливку с тенью; результат удаления — toast с
     счётчиком («Удалено: 33 документа, 1290 записей»).

   - **Live-prediction где возможно.** Если меняешь настройку, которая
     влияет на расчёт (например, ответственных за журналы) — show
     real-time прогноз «что улучшится / ухудшится» (см. sticky-панель
     workload-diff на `/settings/journal-responsibles`).

   - **Recommended action при выборе.** Где есть «правильный по
     умолчанию» вариант (admin как verifier, заведующая как контролёр,
     меньше всех нагруженный — как новый исполнитель) — подсвечивать
     иконкой/группой/sortation. Менеджер не должен гадать.

   - **Hover/focus visible**, transition'ы 150-200ms, focus ring
     `ring-[#5566f6]/15`, hover усиление цвета на 1 шаг (см.
     `bg-[#5566f6]` → `hover:bg-[#4a5bf0]`).

   - **Для чек-листа какие компоненты переиспользовать**: `ConfirmDialog`,
     `UserPicker` (см. references), `PageGuide` (объяснения и Q/A
     наверху страницы), `WhatsNewModal` (release notes).

7. **Новинки после деплоя — `WhatsNewModal` обязателен.**
   Источник: `src/lib/whats-new-notes.ts`. После значимого изменения
   для пользователя:

   - Обновить `LATEST_NOTES_BUILD_SHA` на короткий sha коммита, в
     который попадают изменения (`648a1e9`, `3b1b3d7` и т.п.).
   - Дописать или переписать `WHATS_NEW_NOTES` — короткие фразы
     «что появилось / что починили» с точки зрения пользователя.
   - Не дёргать SHA на каждый push — только когда юзер заметит
     изменение. Иначе модалка надоест.

   Modal привязан к сравнению `localStorage["wesetup.last-seen-build-sha"]`
   с переданным `buildSha`. То есть он сработает один раз после
   first reload каждого юзера после нового деплоя — это именно та
   «после перезагрузки страницы» точка, которую пользователь хочет.

   **Размер и UX модалки — обязательные требования:**

   - Карточка `max-w-[480px]`, `max-h-[90vh]`, `overflow-hidden`.
     Header и footer фиксированные (`shrink-0`), middle scrollable
     (`overflow-y-auto`). На любом устройстве должна помещаться без
     overflow страницы и быть полностью читаемой.
   - Если новостей больше 4-5 пунктов — **группировать в категории**
     (`Журналы`, `Распределение задач`, `Интерфейс`, `Интеграции`,
     `Раньше — тоже полезное`). `WhatsNewNote` поддерживает оба
     формата: `string` (плоский) и `{ category, icon, items[] }`
     (accordion).
   - **Accordion — одна категория открыта за раз.** По умолчанию —
     первая. Клик на заголовок переключает; клик на уже открытую —
     закрывает.
   - У каждой категории — иконка из lucide-react в pill (indigo
     при свернутом, белая на фиолетовом при раскрытом).
   - Категории сортируются от самой важной к менее важной — наверху
     должно быть то, ради чего вообще show'аем модалку.
   - **Иконки категорий держим в client component** (`CATEGORY_ICONS`
     map в `whats-new-modal.tsx`). НЕ передаём `LucideIcon` через
     props из server-component'а — RSC не сериализует функции и это
     даёт runtime error. Если появилась новая категория — добавить
     иконку в map, не в `whats-new-notes.ts`.

   После деплоя ВАЖНОГО для пользователя изменения — обязательно
   обновляй `whats-new-notes.ts`. Это часть «доделать таску до конца»,
   а не follow-up.

## Git Workflow

**ВАЖНО:**
- Все сообщения коммитов писать на **русском языке**
- После каждого коммита автоматически делать `git push origin master`
- Формат коммита: краткое описание изменений на русском

Пример:
```bash
git commit -m "Исправлен скролл на мобильных устройствах"
git push origin master
```

Common git flow:
```bash
git checkout master
git pull origin master

# make changes
git add path/to/file1 path/to/file2
git commit -m "feat: short description"
git push origin master
```

Important git notes:
- Stage specific files whenever possible.
- Do not sweep local scratch files into commits unless explicitly requested.
- Local scratch files seen before: `test.txt`, `_seed_remote.py`, `docs/plans/*`.
- If git reports dubious ownership in this workspace, fix it with:
```bash
git config --global --add safe.directory C:/www/Wesetup.ru
```
- Git Credential Manager is available on this machine.

## Build & Development Commands

```bash
npm run dev              # Start dev server (Next.js 16, port 3000)
npm run build            # Build for production
npm run lint             # ESLint check
npm start                # Run production build (PM2 on server)
npx prisma generate      # Generate Prisma Client
npx prisma db push       # Push schema changes to DB
npx tsx prisma/seed.ts   # Seed database with demo data
```

Useful commands:
```bash
npx tsc --noEmit --skipLibCheck   # TypeScript type check
npx prisma migrate dev             # Create migration (requires working DB)
npx prisma studio                  # Open Prisma Studio
```

## Local Setup

```bash
git clone https://github.com/djdes/HACCP-Online.git
cd HACCP-Online
cp .env.shared .env
npm install
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts
npm run dev
```

Local database options:
- **PGlite** (default dev): `npx @electric-sql/pglite-socket` runs socket server on port 5433
- **PostgreSQL**: set `DATABASE_URL` to real Postgres instance

## Architecture Overview

**WeSetup (HACCP-Online)** is a Next.js 16 monolith for electronic HACCP / SanPiN journals at food production facilities. It includes a full dashboard, Telegram Mini App, and TasksFlow integration.

### Project Structure

```
Wesetup.ru/
├── src/
│   ├── app/
│   │   ├── (auth)/           # Public pages: login, register, invite
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── invite/[token]/page.tsx
│   │   ├── (dashboard)/       # Protected pages
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── journals/page.tsx
│   │   │   ├── journals/[code]/page.tsx
│   │   │   ├── journals/[code]/new/page.tsx
│   │   │   ├── journals/[code]/documents/[docId]/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   ├── settings/users/page.tsx
│   │   │   ├── settings/schedule/page.tsx
│   │   │   ├── batches/page.tsx
│   │   │   ├── capa/page.tsx
│   │   │   ├── changes/page.tsx
│   │   │   ├── competencies/page.tsx
│   │   │   ├── losses/page.tsx
│   │   │   ├── plans/page.tsx
│   │   │   ├── reports/page.tsx
│   │   │   └── settings/integrations/tasksflow/page.tsx
│   │   ├── (root)/            # ROOT-only platform pages
│   │   │   ├── root/page.tsx
│   │   │   ├── root/organizations/page.tsx
│   │   │   ├── root/telegram-logs/page.tsx
│   │   │   └── root/blog/page.tsx
│   │   ├── mini/              # Telegram Mini App
│   │   │   ├── page.tsx                    # Mini App home
│   │   │   ├── layout.tsx                  # Mini App shell
│   │   │   ├── journals/[code]/page.tsx    # Journal entries (cards)
│   │   │   ├── journals/[code]/new/page.tsx # New entry form
│   │   │   ├── documents/[id]/page.tsx      # Document journal grid
│   │   │   └── reports/page.tsx             # Reports list
│   │   ├── api/               # API routes (App Router)
│   │   │   ├── auth/[...nextauth]/route.ts   # NextAuth.js
│   │   │   ├── mini/home/route.ts            # Mini App home data
│   │   │   ├── mini/journals/[code]/entries/route.ts
│   │   │   ├── mini/journals/[code]/bulk-copy-yesterday/route.ts
│   │   │   ├── mini/documents/[id]/entries/route.ts
│   │   │   ├── journals/route.ts
│   │   │   ├── journal-documents/route.ts
│   │   │   ├── integrations/tasksflow/route.ts
│   │   │   ├── settings/external-token/route.ts
│   │   │   └── settings/journals/route.ts
│   │   ├── blog/              # Public blog
│   │   ├── features/          # Public features pages
│   │   ├── journals-info/     # Public journal catalog
│   │   ├── task-fill/         # Task fill page
│   │   └── equipment-fill/    # Equipment fill page
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   ├── dashboard/         # Dashboard-specific components
│   │   ├── journals/          # Journal components
│   │   │   ├── dynamic-form.tsx        # Universal journal form
│   │   │   ├── hygiene-document-client.tsx
│   │   │   └── journal-table.tsx
│   │   └── landing/           # Landing page sections
│   ├── lib/
│   │   ├── db.ts              # Prisma singleton
│   │   ├── auth.ts            # NextAuth config (JWT strategy)
│   │   ├── auth-helpers.ts    # requireAuth, requireRole, getActiveOrgId
│   │   ├── journal-acl.ts     # hasJournalAccess, canWriteJournal (LRU cache)
│   │   ├── telegram.ts        # sendTelegramMessage, notifyOrganization
│   │   ├── tasksflow-adapters/ # TasksFlow integration adapters
│   │   ├── validators.ts      # Zod schemas
│   │   ├── email.ts           # Email sending (Resend)
│   │   ├── invite-tokens.ts   # SHA-256 token generation
│   │   ├── registration.ts    # 6-digit code + bcrypt
│   │   ├── pdf.ts             # PDF generation
│   │   └── tuya.ts            # Tuya IoT integration
│   ├── types/
│   │   └── next-auth.d.ts     # Extended JWT/session types
│   ├── content/               # Blog articles (MDX)
│   └── middleware.ts          # Route protection + org impersonation
├── prisma/
│   ├── schema.prisma          # Full Prisma schema (870+ lines)
│   └── seed.ts                # Demo data seed
├── public/                    # Static assets, icons
└── scripts/                   # Utility scripts
```

## Detailed File Descriptions

### Frontend (src/app/)

#### (dashboard)/journals/[code]/page.tsx
- Journal detail page (desktop)
- Shows entries list or document-based table
- Links to new entry form

#### (dashboard)/journals/[code]/documents/[docId]/page.tsx
- Document journal grid (employee × day table)
- Inline cell editing
- Used for hygiene logs, temperature checks, etc.

#### mini/page.tsx
- Mini App home (SPA entry point)
- Telegram WebApp auth via `signIn("telegram", ...)`
- Shows: staff journals / manager summary / all journals list
- Geo reminders, QR scanner button

#### mini/journals/[code]/page.tsx
- Mini App journal entries
- Field-based: card list with "Fill like yesterday" + photo attachments
- Document-based: list of documents → `/mini/documents/[id]`
- Fixed bottom "New entry" button

#### mini/journals/[code]/new/page.tsx
- New entry form inside Mini App
- Reuses `DynamicForm` with `journalsBasePath="/mini/journals"`

#### mini/documents/[id]/page.tsx
- Document journal grid inside Mini App
- `EntryCard` with tap-to-edit inline mode
- No tables — all cards for mobile UX

### Backend (src/app/api/)

#### auth/[...nextauth]/route.ts
- NextAuth.js with JWT strategy
- Credentials provider (email/password)
- Telegram provider (Mini App auth)

#### mini/home/route.ts
- Returns user data, journal templates, obligations
- Filters by `assignableCodes` vs `allowedCodes` depending on scope
- Returns mode: "manager" | "staff" | "readonly"

#### mini/journals/[code]/entries/route.ts
- GET: entries for a journal (last 7 days)
- POST: create new entry

#### integrations/tasksflow/route.ts
- TasksFlow integration settings
- Sync users, sync tasks

#### settings/external-token/route.ts
- External API token management

### Core Library (src/lib/)

#### db.ts
- Prisma singleton with `$extends` for logging

#### auth.ts / auth-helpers.ts
- `getActiveOrgId(session)` — returns currently-viewed org
- `requireAuth()` / `requireRole()` / `requireRoot()`
- `isImpersonating()` — check if ROOT is acting as another org

#### journal-acl.ts
- `hasJournalAccess(userId, journalCode)` — LRU-cached (60s)
- `canWriteJournal()` / `canFinalizeJournal()`
- `invalidateJournalAcl(userId)` — call after ACL changes

#### telegram.ts
- `sendTelegramMessage()` with TelegramLog + 429 retry
- `notifyOrganization()` — bulk send to org subscribers
- Link-token HMAC verification

#### tasksflow-adapters/index.ts
- TasksFlow integration data adapters

## Data Flow

### 1. Registration
```
/register (3-step wizard)
  → POST /api/auth/register/request (6-digit email code)
  → POST /api/auth/register/confirm
  → Create Organization + manager User + auto-sign-in
```

### 2. Journal Entry (Dashboard)
```
/journals/[code]/new
  → DynamicForm
  → POST /api/journals
  → Prisma: JournalEntry.create({ organizationId, data })
  → redirect /journals/[code]
```

### 3. Journal Entry (Mini App)
```
/mini/journals/[code]/new
  → DynamicForm (journalsBasePath="/mini/journals")
  → POST /api/mini/journals/[code]/entries
  → router.push(`/mini/journals/${code}`)
```

### 4. Telegram Notification
```
Journal action
  → notifyOrganization()
  → sendTelegramMessage()
  → Telegram Bot API
  → TelegramLog.create()
```

### 5. TasksFlow Sync
```
Settings → TasksFlow integration
  → POST /api/integrations/tasksflow/sync-users
  → POST /api/integrations/tasksflow/sync-tasks
  → TasksFlow API (API key auth)
```

## Key Behaviors

### Three-tier Access Model
- **ROOT** (`User.isRoot = true`): platform superadmin, sees `/root/*`. Synthetic `platform` org.
- **Company owner / manager** (`role in {manager, head_chef}` or legacy `owner`/`technologist`): sees all journals in org. Bypasses per-journal ACL.
- **Employee** (`cook`, `waiter`, or any role when `journalAccessMigrated=true` + no row): only sees explicitly granted journals via `UserJournalAccess`.

### Multi-tenancy
- All business data scoped by `organizationId` from session
- `getActiveOrgId(session)` returns currently-viewed org (differs when ROOT impersonates)
- Always use `getActiveOrgId` in server components and API handlers

### Journal Types
- **Field-based**: `JournalEntry` with JSON `data` field. Flexible form fields.
- **Document-based**: `JournalDocument` + `JournalDocumentEntry`. Grid (employee × day).

### Mini App Navigation
- All links use Next.js `Link` with `/mini/*` paths
- `DynamicForm` receives `journalsBasePath="/mini/journals"` to stay inside Mini App
- Photos open via inline `PhotoLightbox`, NOT `target="_blank"`

## Path Aliases

```typescript
@/*          → ./src/*
```

## Database

PostgreSQL with Prisma ORM. Schema in `prisma/schema.prisma` (870+ lines).

**Key models:**
- `User` — employees, managers, ROOT
- `Organization` — multi-tenant scope
- `JournalTemplate` — journal definitions with JSON `fields`
- `JournalEntry` — field-based entries
- `JournalDocument` / `JournalDocumentEntry` — document-based grids
- `UserJournalAccess` — per-journal ACL
- `ManagerScope` — manager visibility rules
- `JournalEntryAttachment` — photo attachments
- `WorkShift` — shift handover notes
- `TasksFlowIntegration` / `TasksFlowUserLink` / `TasksFlowTaskLink` — TasksFlow sync
- `Area` — production areas with lat/lng

**Local dev:**
- PGlite socket server: `npx @electric-sql/pglite-socket` (port 5433)
- Prisma may need `?sslmode=disable` for PGlite connection

## Auth

NextAuth.js 4 with JWT strategy.
- Credentials provider: email + password
- Telegram provider: Mini App auth via `initData`
- Session carries: `isRoot`, `actingAsOrganizationId`, `organizationId`
- Impersonation: ROOT clicks "Войти как X" → `actingAsOrganizationId` in JWT

Roles (legacy-compatible):
- `owner` / `manager`
- `technologist` / `head_chef`
- `operator` / `cook` / `waiter`

## Telegram & Mini App

- **Bot**: `@wesetupbot`
- **Webhook**: receives updates from Telegram
- **Mini App**: opens inside Telegram, auth via `signIn("telegram", ...)`
- **Link tokens**: HMAC-signed tokens for user-device linking

## Deployment

Deployment is handled by GitHub Actions (`.github/workflows/deploy.yml`).

Trigger: push to `master`

Workflow steps:
1. Checks out repo
2. Writes `.build-sha` and `.build-time`
3. Creates `deploy.tar`
4. Uploads over SSH/SCP
5. Restores `.env`
6. Runs `npm install`, `npx prisma generate`, `npx prisma db push`, `npm run build`
7. Restarts PM2 process `haccp-online`

**Production Server:**
- **URL**: https://wesetup.ru
- **Path**: `/var/www/wesetupru/data/www/wesetup.ru/app`
- **PM2 process**: `haccp-online`
- **Internal port**: `3002`

**Production SSH:**
- Host: `wesetup.ru`
- User: `wesetupru`
- Password: в локальном `.env` → `WESETUP_SSH_PASSWORD` (в репозиторий не класть)
- External port: `50222`
- Internal port: `22`

Useful production checks:
```bash
# PM2 status
plink -batch -hostkey "ssh-ed25519 255 SHA256:NwU1dGS29JAjs2K5LfEtu3DLFgg04yo7ZEA4iOGkM6E" -P 22 -l wesetupru -pw "$(grep -E '^WESETUP_SSH_PASSWORD=' .env | cut -d= -f2- | tr -d '"')" wesetup.ru "pm2 status haccp-online --no-color"

# Build markers
plink -batch -hostkey "ssh-ed25519 255 SHA256:NwU1dGS29JAjs2K5LfEtu3DLFgg04yo7ZEA4iOGkM6E" -P 22 -l wesetupru -pw "$(grep -E '^WESETUP_SSH_PASSWORD=' .env | cut -d= -f2- | tr -d '"')" wesetup.ru "cd /var/www/wesetupru/data/www/wesetup.ru/app && cat .build-sha && cat .build-time"

# Local HTTP probe
plink -batch -hostkey "ssh-ed25519 255 SHA256:NwU1dGS29JAjs2K5LfEtu3DLFgg04yo7ZEA4iOGkM6E" -P 22 -l wesetupru -pw "$(grep -E '^WESETUP_SSH_PASSWORD=' .env | cut -d= -f2- | tr -d '"')" wesetup.ru "curl -I -s http://127.0.0.1:3002 | sed -n '1,10p'"
```

## Known Issues & Workarounds

### Prisma + PGlite connection (local dev)
- PGlite runs on port 5433 but Prisma may fail with `P1001 Can't reach database server`
- Try adding `?sslmode=disable` to `DATABASE_URL`
- Or use `npx prisma db push` instead of `migrate dev` (PGlite has migration limitations)
- Alternative: run real PostgreSQL via Docker

### Next.js dev server stability
- Background tasks may timeout after 900s
- If port 3000 is occupied, kill the old process and restart `npm run dev`

### Multiple package-lock.json warning
- Next.js build warns about multiple `package-lock.json`
- Non-fatal, but worth cleaning later

## Security Features

- **NextAuth.js**: JWT with httpOnly cookies, secure in production
- **ACL**: per-journal access control with 60-second LRU cache
- **Invite tokens**: 32-byte base64url, SHA-256 hash stored, 7-day TTL
- **Registration codes**: 6-digit, bcrypt hashed, 10-min TTL
- **Telegram link tokens**: HMAC-signed
- **Rate limiting**: built into Next.js API routes

## Production Features

- **PM2**: process manager with auto-restart
- **GitHub Actions**: auto-deploy on push to master
- **Health check**: app answers HTTP 200 on `127.0.0.1:3002`
- **Build markers**: `.build-sha` and `.build-time` for verification
- **Telegram logs**: auto-cleanup after 30 days

## Skills and Agents Discovery

At the start of every session, check what's available before acting:

- **Skills** — all `.claude/skills/*` are auto-discovered by the Skill tool. Relevant namespaces:
  - `wesetup-design` — our design system (invoke before any UI edit)
  - `karpathy-guidelines` — coding discipline
  - `anthropic-*` — claude-api, mcp-builder, skill-creator, webapp-testing, frontend-design
  - `everything-*` — backend/frontend-patterns, tdd-workflow, security-review, coding-standards
- **Agents** — all `.claude/agents/*.md` are available via the Agent tool. 140 VoltAgent specialists plus task-proof-loop agents.
- **References** — `.claude/references/prompt-guide/`, `.claude/references/awesome-claude-code/`

Rule: **invoke relevant skills before acting, not after.** `wesetup-design` before any `.tsx` change on a visible surface. `karpathy-guidelines` before a non-trivial refactor. For new features touching existing code, invoke `superpowers:brainstorming` first to lock scope.

## Conventions

- UI text is Russian.
- Code and comments are usually English.
- Next.js 16 page `params` are Promises, so always `await params`.
- Use `sonner` for toasts.
- Path alias: `@/*` -> `./src/*`
- Prisma changes should be deployed with `npx prisma db push`
- The deploy workflow already runs `prisma db push` on the server

## Testing

```bash
npx tsc --noEmit --skipLibCheck   # TypeScript type check
npm run lint                       # ESLint
```

## Required Env Vars

```bash
# Database
DATABASE_URL="postgresql://..."

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="..."

# ROOT
PLATFORM_ORG_ID="platform"
ROOT_EMAIL="..."
ROOT_PASSWORD_HASH="..."
ROOT_PASSWORD="..."  # dev fallback

# Telegram
TELEGRAM_BOT_USERNAME="..."
TELEGRAM_BOT_TOKEN="..."
TELEGRAM_LINK_TOKEN_SECRET="..."
TELEGRAM_WEBHOOK_SECRET="..."

# Email (nodemailer → локальный SMTP-relay; см. src/lib/email.ts)
SMTP_HOST="127.0.0.1"
SMTP_PORT="25"
SMTP_FROM="WeSetup <noreply@wesetup.ru>"
SMTP_HELO_NAME="wesetup.ru"   # имя в EHLO, по умолчанию домен из SMTP_FROM
EMAIL_TRANSPORT="smtp"        # задел под внешнего провайдера
EMAIL_VERIFICATION_TTL_MIN="10"

# Уведомления админа платформы (обращения, регистрации, оплаты)
PLATFORM_ADMIN_TELEGRAM_CHAT_ID="..."   # можно несколько через запятую
PLATFORM_ADMIN_EMAIL="..."
# legacy-fallback, читаются если новые не заданы:
# FEEDBACK_ADMIN_TG_CHAT_ID, FEEDBACK_ADMIN_EMAIL

# TasksFlow
TASKSFLOW_API_URL="..."
TASKSFLOW_API_KEY="..."

# DaData — подсказки по ИНН (название, адрес, ОКВЭД → сфера, ОПФ → тип).
# Без ключа /api/public/inn-lookup отвечает 503 и анкета заполняется вручную.
DADATA_API_KEY="..."

# Other
TELEGRAM_LOG_RETENTION_DAYS="30"
```

<!-- repo-task-proof-loop:start -->
## Repo task proof loop

For substantial features, refactors, and bug fixes, use the repo-task-proof-loop workflow.

Required artifact path:
- Keep all task artifacts in `.agent/tasks/<TASK_ID>/` inside this repository.

Required sequence:
1. Freeze `.agent/tasks/<TASK_ID>/spec.md` before implementation.
2. Implement against explicit acceptance criteria (`AC1`, `AC2`, ...).
3. Create `evidence.md`, `evidence.json`, and raw artifacts.
4. Run a fresh verification pass against the current codebase and rerun checks.
5. If verification is not `PASS`, write `problems.md`, apply the smallest safe fix, and reverify.

Hard rules:
- Do not claim completion unless every acceptance criterion is `PASS`.
- Verifiers judge current code and current command results, not prior chat claims.
- Fixers should make the smallest defensible diff.

Installed workflow agents:
- `.claude/agents/task-spec-freezer.md`
- `.claude/agents/task-builder.md`
- `.claude/agents/task-verifier.md`
- `.claude/agents/task-fixer.md`

Claude Code note:
- If `init` just created or refreshed these files during the current Claude Code session, do not assume the refreshed workflow agents are already available.
- The main Claude session may auto-delegate to these workflow agents when the current proof-loop phase matches their descriptions. If automatic delegation is not precise enough, make the current proof-loop phase more explicit in natural language.
- TodoWrite or the visible task/todo UI is optional session-scoped progress display only. The canonical durable proof-loop state is the repo-local artifact set under `.agent/tasks/<TASK_ID>/`.
- Keep this workflow flat. These generated workflow agents are role endpoints, not recursive orchestrators.
- Keep this block in the root `CLAUDE.md`. If the workflow needs longer repo guidance, prefer `@path` imports or `.claude/rules/*.md` instead of expanding this block.
<!-- repo-task-proof-loop:end -->
