# Новое меню кабинета — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить разрозненную навигацию кабинета (hover-меню, шестерёнка `/settings`, вкладки точек, пилюли заведующей) левым сайдбаром из 9 разделов, вкладками внутри разделов и переключателем точки в центре шапки.

**Architecture:** Один чистый модуль `src/lib/app-nav.ts` описывает разделы, вкладки, правила доступа и принадлежность путей. Сервер собирает из него сериализуемую модель с подписями (`buildNavModel`), клиентские компоненты (сайдбар, вкладки, мобильный лист, ⌘K, Mini App «Разделы») читают её из контекста. Карточки бывшего хаба настроек переезжают в `src/lib/settings-cards.ts` и выводятся страницами «Настройка» разделов и `/more`.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind, next-intl (каталоги ru/en/uz), Prisma/PostgreSQL, тесты `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-16-cabinet-sidebar-nav-design.md`; критерии — `.agent/tasks/nav-shell-2026-10/spec.md`.

## Global Constraints

- Порядок разделов: company, staff, points, journals, checklists, productionControl, billing, more, inspection.
- Ширина сайдбара 256px, брейкпоинт 1024px (`lg`), CSS-переменная `--app-sidebar-w`.
- Высота шапки не меняется: 55px (<640px) / 72px.
- Сайдбар показывается только при ≥2 видимых разделах; вкладки — только на корне раздела и при ≥2 видимых вкладках.
- Существующие URL не переименовываются; новые маршруты: `/inspection`, `/production-control`, `/more`, `/settings/sections/{journals,staff,points}`, `/settings/staff-health`.
- `/more` и `/production-control` добавляются в `STAFF_RESTRICTED_WEB_PREFIXES`; `/inspection` и `/checklists` — нет.
- Все новые ключи — во всех трёх каталогах `src/i18n/messages/{ru,en,uz}.json`, затем `npm run i18n:types`.
- Дизайн-система: indigo `#5566f6`, активный пункт `bg-[#5566f6]/[0.09] text-[#5566f6]`, `rounded-2xl`, переходы 150–200ms, без `text-muted-foreground`/`bg-card`.
- Схема Prisma — только добавления; локальный `db push` только в `wesetup_e2e`.

## Review Focus

- Заведующая (head_chef, fullAccess без journals.view/admin.full) — должна видеть 8 разделов и стартовать с `/control-board`; тест в Task 1.
- Пользователь с `canManageSettings` получает в сессии роль `owner` — модель считает его руководством; тест в Task 1 (actor role "owner").
- Организация с 2 зданиями, но `perLocationJournals=false` — в шапке имя организации без шеврона; проверка в Task 4 (e2e).
- Печать страницы журнала с сайдбаром — нет отступа 256px; проверка в Task 4 (e2e emulateMedia print).
- Партнёр в кабинете клиента и ROOT-импёрсонация — сайдбар с логотипом клиента, без падений; проверка в Task 4 (e2e при наличии сида, иначе ручная).

---

### Task 1: Модель навигации и карточки настроек (без видимых изменений)

**Files:**
- Create: `src/lib/app-nav.ts`, `src/lib/app-nav.test.ts`, `src/lib/settings-cards.ts`, `src/lib/settings-cards.test.ts`
- Modify: `src/lib/role-access.ts` (перенос `STAFF_RESTRICTED_WEB_PREFIXES`, `isStaffRestrictedWebPath`), `src/proxy.ts` (импорт), `src/app/(dashboard)/settings/page.tsx` (карточки из модуля)

**Interfaces:**
- Produces:
  - `type NavSectionKey = "company"|"staff"|"points"|"journals"|"checklists"|"productionControl"|"billing"|"more"|"inspection"`
  - `type NavActor = { role?, isRoot?, permissionPreset?, orgPresetOverrides? }`, `type NavFacts = { checklists: boolean }`
  - `type NavAccess = {kind:"staffPath"}|{kind:"fullAccess"}|{kind:"anyOf",capabilities}|{kind:"fullAccessOr",capabilities}|{kind:"all",rules}|{kind:"fact",fact}`
  - `NAV_SECTIONS: NavSection[]` (`key, icon, access?, tabs: NavTab[], hiddenMatch?, renameHref?`), `NavTab = { id, label, href, access, match?, hideIfVisible? }`
  - `navAllows(actor, href, access, facts): boolean`
  - `visibleNav(actor, facts): VisibleNavSection[]` — `{ key, icon, rootHref, tabs: {id,label,href}[], renameHref? }`
  - `sectionForPath(pathname): { section: NavSectionKey; ownerHref: string; isTabRoot: boolean } | null`
  - `SETTINGS_CARDS: SettingsCard[]` — `{ id, href, icon, iconClass, bgClass, section, group, access, hideWhen? }`; `settingsCardsFor(section, group?)`
  - `isStaffRestrictedWebPath(pathname)` из `role-access.ts`

- [ ] Тесты `app-nav.test.ts`: порядок 9 ключей; уникальность id вкладок; каждый `src/app/(dashboard)/**/page.tsx` (с `[x]` вместо параметров) даёт ровно один раздел, кроме `/settings` и `/staff`, которые тоже мапятся (company/staff); каждый href вкладки/карточки существует как page.tsx; `sectionForPath("/dashboard/compliance-audit").section === "inspection"`, `("/journals-progress") === "journals"` и `isTabRoot === false`, `("/settings/journals/x/scope") === "journals"`, `("/capa/1") === "more"`; видимые наборы: owner/manager/root → 9; head_chef → 8 без company; cook → ≤1; verify-only (`role:"cook", permissionPreset:"head_chef"`) → journals, staff, inspection; proxy: `/more`, `/production-control` restricted, `/inspection` нет.
- [ ] Тесты `settings-cards.test.ts`: все 51 href бывшего хаба присутствуют либо в `SETTINGS_CARDS`, либо как href вкладки; у каждой карточки есть `title` и `description` во всех трёх каталогах.
- [ ] Реализация модулей; `settings/page.tsx` рендерит те же группы из `SETTINGS_CARDS` (временный режим до Task 4).
- [ ] `node --import tsx --test src/lib/app-nav.test.ts src/lib/settings-cards.test.ts src/proxy.test.ts src/lib/role-access.test.ts` — PASS; `npm run typecheck` — PASS.
- [ ] Коммит «Модель навигации кабинета: 9 разделов и карточки настроек».

### Task 2: Бэкенд — схема, логотип, документы ППК, расширение guard'ов

**Files:**
- Modify: `prisma/schema.prisma` (`KnowledgeDocument.kind String?` + `@@unique([organizationId, kind])`; модель `OrganizationLogo`)
- Create: `src/lib/org-logo.ts`, `src/app/api/settings/organization/logo/route.ts`, `src/app/api/org-assets/[organizationId]/logo/route.ts`, `src/app/api/production-control/documents/route.ts`
- Modify: `src/app/api/knowledge-documents/route.ts` (список: `kind: null`), `src/app/api/knowledge-documents/[id]/file|preview` (доступ по `kind` + fullAccess), `src/app/inspector-sheet/[id]/page.tsx` и `src/app/api/reports/compliance-bundle/route.ts` (`fullAccess || tasks.verify`), `src/lib/organization-profile-patch.ts` (внутренний путь логотипа)

**Interfaces:**
- Produces: `POST/DELETE /api/settings/organization/logo` (multipart `file`) → `{ logoUrl }`; `GET /api/org-assets/<orgId>/logo`; `GET/POST/DELETE /api/production-control/documents?kind=ppk|haccp_plan` → `{ documents: {kind,id,fileName,size,createdAt}[] }`.

- [ ] Тесты на чистые функции `org-logo.ts` (проверка байтов/MIME через существующие `checkLogoBytes`/`sanitizeSvg`) и на правила доступа документов.
- [ ] `DATABASE_URL=…wesetup_e2e… npx prisma db push` на e2e-БД — PASS.
- [ ] typecheck + тесты — PASS. Коммит «Загрузка логотипа и документы ППК: API и схема».

### Task 3: Новые страницы (доступны по URL, ещё без меню)

**Files:**
- Create: `src/app/(dashboard)/inspection/page.tsx` (+ клиентские острова в `src/components/inspection/`), `src/app/(dashboard)/production-control/page.tsx`, `src/components/production-control/document-slot.tsx`, `src/app/(dashboard)/more/page.tsx`, `src/app/(dashboard)/settings/sections/{journals,staff,points}/page.tsx`, `src/app/(dashboard)/settings/staff-health/page.tsx`, `src/components/settings/settings-card-grid.tsx`, `src/lib/compliance-audit-presentation.ts`
- Modify: `src/lib/route-titles.ts`, каталоги ru/en/uz, `src/components/settings/organization-info-form.tsx` (загрузка логотипа файлом), `src/app/(dashboard)/settings/services/*` (`?order=`)

- [ ] Каждая страница проверяет доступ тем же правилом, что вкладка в `app-nav.ts` (тест-сверка из Task 1 подхватит их).
- [ ] typecheck, i18n:check — PASS. Коммит «Страницы разделов: Пришла проверка, Производственный контроль, Остальное».

### Task 4: Новый каркас (видимое изменение)

**Files:**
- Create: `src/lib/app-nav.server.ts`, `src/components/layout/app-nav-context.tsx`, `src/components/layout/app-sidebar.tsx`, `src/components/layout/section-tabs.tsx`, `src/components/layout/current-point-switcher.tsx`, `src/components/layout/mobile-nav-sheet.tsx`, `src/components/layout/nav-icons.ts`
- Modify: `src/app/(dashboard)/layout.tsx`, `src/components/layout/header.tsx`, `src/components/layout/page-nav.tsx`, `src/components/layout/profile-sheet.tsx`, `src/components/layout/command-palette.tsx`, `src/app/app-theme.css`, `src/app/(dashboard)/journals/[code]/layout.tsx`, `src/components/journals/journal-responsive.ts`, `src/components/journals/journal-selection-bar.tsx`, `src/app/(dashboard)/settings/page.tsx` (редирект), `src/app/(dashboard)/settings/loading.tsx`, `src/app/mini/sections/page.tsx`, `src/app/mini/sections/sections-client.tsx`, `src/lib/whats-new-notes.ts`, `src/components/dashboard/whats-new-modal.tsx`, затронутые тесты.

- [ ] Обновить существующие тесты (app-sections, custom-names, navigation-localization ×2, settings-hub-localization, skeleton-routes, journal-responsive) под новый каркас.
- [ ] E2E на `wesetup_e2e` (порт 3025): сценарии 1–6 из дизайна, скриншоты в `.agent/tasks/nav-shell-2026-10/raw/`.
- [ ] typecheck, lint, test:gate, build — PASS. Коммит «Новое меню кабинета: сайдбар, точка в шапке, вкладки разделов».

### Task 5: «Сегодня» — разгрузка дашборда

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx`, `src/app/(dashboard)/journals/page.tsx`, `src/app/(dashboard)/settings/organization/page.tsx`, `src/app/(dashboard)/settings/equipment/page.tsx`, `src/app/(dashboard)/team/page.tsx`
- Create: `src/components/dashboard/alert-pill.tsx`, `src/components/dashboard/worker-leaderboard-card.tsx` (вынос из дашборда)

- [ ] Виджеты по таблице дизайна; неиспользуемые запросы удалены.
- [ ] E2E: «Сегодня» без вкладок точек/карточек-ссылок; виджеты видны на новых местах. Коммит «Сегодня: виджеты переехали в свои разделы».

### Task 6: Уборка и закрытие

- [ ] Удалить `APP_SECTIONS`/`headerNavSections`/`visibleAppSectionGroups` (если не осталось потребителей), `location-tabs.tsx` (`LayoutLocationTabs`), неиспользуемые ключи `navigation.header.*`.
- [ ] CLAUDE.md «Mini App Navigation»; evidence.md/evidence.json; верификация proof-loop; комментарий в задаче ProjectsFlow.
