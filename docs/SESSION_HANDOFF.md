# Session Handoff — WeSetup + TasksFlow

> Дата создания: **2026-04-25**. Передача контекста между чатами Claude Code.
> Если ты — следующий Claude, прочитай этот файл целиком ДО любого действия.

## TL;DR

Это **два связанных проекта**, которые вместе образуют HACCP-Online стек:

- **WeSetup** (`c:/www/Wesetup.ru`) — Next.js 16, prod на https://wesetup.ru. Главное приложение: журналы СанПиН/ХАССП, dashboard, mini-app для Telegram, иерархия сотрудников, настройки. Источник истины для всех бизнес-данных.
- **TasksFlow** (`c:/www/TasksFlow`) — отдельное приложение (Express + React + MySQL/Drizzle), prod на https://tasksflow.ru. Линейные сотрудники получают ежедневные задачи (журналы и свободные таски), выполняют, получают премию.

**WeSetup пушит** иерархию + журнальные задачи в TasksFlow через TasksFlow API. **TasksFlow** хранит локальное зеркало для read-фильтрации и UX.

## Деплой / тестирование

### CRITICAL правила
- **Localhost не работает** (БД отключена 2026-04-17). Тестируй на проде: https://wesetup.ru, https://tasksflow.ru. Playwright: всегда `https://wesetup.ru/...`, не `localhost:3000`.
- **Все коммиты на русском языке** (см. CLAUDE.md).
- **Локальный flow**: после задачи коммит, ждать «пуш в прод» от пользователя ДО `git push` (стоящая инструкция). НО на практике пользователь часто сам говорит пушить — следуй инструкции под текущую задачу.
- **Force push в master** только когда пользователь явно попросил (например, squash диагностических коммитов).

### Деплой
- WeSetup: GitHub Actions → SSH-скрипт собирает и рестартит PM2 на проде. ~3-5 мин.
- TasksFlow: GitHub Actions → `appleboy/ssh-action` пуллит main, делает migrations + build + pm2 reload. ~2 мин.
- Если деплой упал на 30 сек (короче обычного) — обычно SSH race с PM2. Перезапусти Actions → Deploy to production → Run workflow с веткой master (не Re-run старого прогона). На прод — только код из master (AGENTS.md → «Production deploy rules»).
- Build SHA пишется в `.build-sha` на проде, можно проверить:
  ```bash
  plink -batch -hostkey "..." -P 22 -l wesetupru -pw '...' wesetup.ru "cd /var/www/wesetupru/data/www/wesetup.ru/app && cat .build-sha"
  ```

### SSH credentials
- WeSetup: `wesetup.ru:22`, user `wesetupru`, пароль см. `CLAUDE.md`. Путь: `/var/www/wesetupru/data/www/wesetup.ru/app`. PM2-процесс: `haccp-online`.
- TasksFlow: `tasksflow.ru:50222`, user `tasksflow`. Путь: `/var/www/tasksflow/data/www/tasksflow.ru`. PM2-процесс: `tasksflow`.

### GitHub status
Проверять успешность деплоев через API (без admin токена видны статусы):
```bash
curl -s -H "Accept: application/vnd.github+json" "https://api.github.com/repos/djdes/HACCP-Online/actions/runs?branch=master&per_page=5" | grep -E '"(run_number|conclusion|head_sha)"'
```
Аналогично TasksFlow на `djdes/TasksFlow`.

## Что сделано в недавних сессиях

### Иерархия сотрудников (3-tier model)
- **WeSetup**: `JobPosition.visibleUserIds` (Postgres `String[]`) — per-position scope. Редактируется в `/settings/position-staff-visibility` (chip-группы с expand-to-users). Также есть legacy `ManagerScope` per-user в `/settings/staff-hierarchy`.
- **TasksFlow**: `users.managed_worker_ids` (TEXT JSON) — зеркало для server-side фильтрации.
- **Sync**: `tasksflow-hierarchy-sync.ts` — кнопка «Применить в TasksFlow» в обеих settings-страницах + auto-sync после save.
- **Tier-3 в TasksFlow**:
  - admin (isAdmin=true) → видит всё, управляет всем
  - manager (managedWorkerIds задан, не-admin) → видит свои+подчинённых, может create/edit/delete только в scope
  - worker (managedWorkerIds пуст, не-admin) → видит только свои задачи
- Server-side enforcement в `/api/tasks` и `/api/users` (TasksFlow). Не клиентский фильтр.

### TasksFlow UI / премии
- StatHero — 4 плитки сверху Dashboard (Сегодня / Сделано / Опередили / Премия), framer-motion.
- Group-by-worker для admin/manager — секции по сотрудникам, default collapsed (кроме «Без исполнителя»).
- Бейдж «+50 ₽» на bonus-задачах (читает `journalLink.bonusAmountKopecks` из payload, fallback на 50).
- Claim-siblings: если задача с бонусом fan-out на N сотрудников, кто первый сделал — у остальных карточка уезжает в секцию «Сделано другими» (claimed by colleague).
- Click-unification: клик по карточке/кружку — одна и та же логика. Журнальная → редирект на WeSetup task-fill, свободная → диалог.

### Тёмная тема (TasksFlow)
- `ThemeContext.tsx` — preference: light/dark/system. Anti-flash скрипт в `index.html`.
- Светлая тема не тронута. Dark — отдельный `.dark`-блок overrides в конце `index.css`.
- Переключатель «Авто/Свет/Тьма» в Dashboard menu (для всех сотрудников) и в CompanySettings.
- Палитра: `#0b1024` фон, `#161c33` карточки, midnight-aurora header (gradient + radial glow), accent `#6f7eff`.

### Премии за журналы
- WeSetup: `JournalTemplate.bonusAmountKopecks` → редактируется в `/settings/journal-bonuses`. Сумма пушится в `bulk-assign-today` через `task.price` (TasksFlow начисляет на bonusBalance) и через `journalLink.bonusAmountKopecks` (для UI-бейджа).
- Единичные журналы (single fillMode) с бонусом фанаются на ВСЕХ eligible — через `shouldFanOutToAll(template)` в `tasksflow-bulk-assign.ts`. Раньше fan-out был только для hygiene/health_check.

### Journal periods (только что закончил)
- `src/lib/journal-period.ts` — единый источник правды для периодов журнальных документов.
- 5 kind'ов: `monthly` (default), `yearly`, `half-monthly` (1-15 / 16-end), `single-day`, `perpetual`.
- Все точки автосоздания (auto-create cron, dashboard «Создать всё», external API dispatch) идут через `resolveJournalPeriod`.
- 35 журналов классифицированы по скриншотам в `c:/www/Wesetup.ru/journals/` (это скрины официального haccp-online.ru).
- HALF-MONTHLY (3): `hygiene`, `health_check`, `cold_equipment_control`.
- YEARLY (18): all audit/training/equipment/etc + `general_cleaning` (только что добавил).
- PERPETUAL (4): `disinfectant_usage`, `intensive_cooling`, `glass_control`, `sanitary_day_control` (последний — пользователь подтвердил что должен быть один-навсегда).
- MONTHLY default (10): остальные.

### Что было сделано раньше (хронология коммитов)
Смотри `git log --oneline -50` в обеих репах. Ключевые ветки тем:
- Distribution journal phases 1-3 (smart routing → sensors → bonuses)
- TasksFlow hierarchy filtering
- Manager-tier write permissions
- Test org «Кафе Тестовое 1» (создан, очищен от документов один раз для тест-кейса)
- Mobile responsive sweep
- Premium UI redesign + dark theme

## Архитектура / куда смотреть

### WeSetup ключевые файлы
- `src/lib/journal-period.ts` — period resolver
- `src/lib/journal-routing.ts` — eligibility + fillMode
- `src/lib/tasksflow-bulk-assign.ts` — кто получит задачу
- `src/lib/tasksflow-hierarchy-sync.ts` — push в TasksFlow
- `src/lib/tasksflow-client.ts` — API-клиент
- `src/app/(dashboard)/settings/*` — все settings-страницы
- `prisma/schema.prisma` — БД (875+ строк, основные модели: User, Organization, JournalTemplate, JournalDocument, JobPosition, ManagerScope, TasksFlowIntegration)

### TasksFlow ключевые файлы
- `server/routes.ts` — все Express endpoints
- `server/storage.ts` — Drizzle DAL
- `shared/schema.ts` — БД-схема (Drizzle)
- `shared/journal-link.ts` — JournalLink Zod-schema
- `client/src/pages/Dashboard.tsx` — главная
- `client/src/components/GroupedTaskList.tsx` — список задач (3 секции)
- `client/src/components/StatHero.tsx` — плитки сверху
- `client/src/contexts/ThemeContext.tsx` — light/dark
- `client/src/index.css` — все стили (1900+ строк, dark в конце)

### Не трогать
- `prisma/seed.ts` (production seed templates — мутирует ORG-уровень)
- WeSetup `src/app/(auth)/login/*` — кастомная NextAuth интеграция, легко сломать
- TasksFlow `server/api-keys.ts` — auth middleware

## Skills которые надо использовать

**Critical (всегда)**:
- `superpowers:using-superpowers` — общий протокол, инвокать перед action'ами
- `karpathy-guidelines` — surgical edits, no overengineering, push back на сложность
- `design-system` (project skill) — WeSetup design tokens (indigo `#5566f6`, dark hero, soft cards)

**По ситуации**:
- `superpowers:brainstorming` — перед любым feature work, чтобы зафиксить scope
- `superpowers:writing-plans` — для multi-step task'ов
- `superpowers:test-driven-development` — для нового бизнес-логики
- `superpowers:systematic-debugging` — bug-hunting flow
- `superpowers:verification-before-completion` — перед claim'ом «работает»
- `animate` (project skill) — анимации framer-motion
- `everything-frontend-patterns`, `everything-backend-patterns` — паттерны
- `everything-security-review` — для auth/API endpoints

**Анти-паттерны**:
- НЕ запускать /loop или ScheduleWakeup автоматически (стоящая инструкция).
- НЕ запускать localhost dev-server — БД нет, всё на проде.
- НЕ стейджить файлы которые не относятся к задаче (memory: surgical commits).
- НЕ помечать done пока не проверил on prod (стоящая инструкция «evidence before assertions»).

## Текущее состояние / последние ~5 коммитов WeSetup

```
69d827b fix(journal-period): sanitary_day_control тоже perpetual
ee30a54 feat(journal-period): single-day и perpetual kinds
ab161ee feat(journal-period): general_cleaning тоже годовой
45f1102 feat(journal-period): half-monthly bounds + унификация
d5faa2d feat(visibility): chip-группы по должностям с expand-to-users
```

TasksFlow последние:
```
5d8684c fix(ui): полное ФИО на карточке + worker-sections collapsed default
890a6e6 feat(hierarchy): manager-tier — может создавать/править задачи
745fd90 feat(ui): группировка по сотруднику + только фамилия для admin
b660803 feat(theme): midnight-aurora header в dark + Login mobile
0a320fb feat(theme): полноценная тёмная тема + переключатель
```

## Что ещё можно улучшить (на следующего)

Не критично, но если будет время:
- **TasksFlow PUT `/api/tasks/:id/complete`** для журнальных задач — вызывается через WeSetup task-fill webhook? Проверить flow.
- **Bot scope resolver** на стороне WeSetup всё ещё читает `ManagerScope.assignableJournalCodes`. Хотел бы перевести его на `JobPosition.visibleUserIds` для единого источника, но пока не реализовано.
- **Journal periods для оставшихся 10 monthly-default журналов** — пользователь не уточнил, действительно ли они должны быть monthly. Возможно climate_control, intensive_cooling также half-monthly как cold_equipment.
- **TasksFlow auth migration** — `users.role` существует, но в TF user-create логика смотрит на `input.role === "manager"` → автопромоутит в admin. Сейчас это даёт TF-admin шеф-поварам и обходит hierarchy filter. Нужно либо менять auto-promote, либо WeSetup должен слать `role: "head_chef"` вместо `"manager"` для не-сисадминов.
- **Mobile responsive** для Settings-страниц TasksFlow — Dashboard mobile хорош, settings ещё не аудитил.

## Где документация на проектах
- WeSetup: `CLAUDE.md` (root) — инструкции, env, deploy. `prisma/schema.prisma` — модели с inline comments.
- TasksFlow: `CLAUDE.md` (root). `API.md`, `DEPLOY.md`, `ENV.md`.
- Memory file Claude: `C:\Users\Yaroslav\.claude\projects\c--www-Wesetup-ru\memory\` — стоящие инструкции пользователя.

## Test data
Организация **Кафе «Тестовое 1»** в WeSetup — единственная активная test-org. Содержит 6 пользователей. Используется для проверки flows (создание журналов, premium tasks, hierarchy push).

После последнего фикса journal-periods (ee30a54) пользователь нажал «Создать всё» на дашборде, документы создались. После 69d827b (sanitary_day_control в perpetual) повторное «Создать всё» уже не создаст дубликат санитарного дня.
