# Производственный контроль (ЭППК) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development или
> superpowers:executing-plans. Шаги — чекбоксы.

**Goal:** раздел «Производственный контроль» с тремя уровнями меню и рабочими блоками ППК/ХАССП
по схеме владельца.

**Architecture:** реестр блоков `src/lib/ppk/registry.ts` (чистый TS) → модель меню
`src/lib/app-nav.ts` получает у вкладок `items` → общий layout кабинета рисует вкладки,
оглавление (`SectionFrame`) и мобильный переключатель. Данные блоков — общий реестр записей
`PpkRecord` + папки файлов `KnowledgeDocument.folder`. Статусы блоков считает чистая функция
по «фактам» из БД.

**Tech Stack:** Next.js 16 App Router (RSC), Prisma 7 (`db push`), next-intl (ru/en/uz),
Tailwind, lucide-react, vaul (`BottomSheet`), node:test (`node --import tsx --test`).

**Spec:** `docs/superpowers/specs/2026-10-16-production-control-ppk-design.md`

## Global Constraints

- Рабочая копия `D:\wt\nav-shell`, ветка `feat/ppk-section`. Основную папка `D:\www\Wesetup.ru`
  не трогать (там параллельная сессия).
- БД только e2e: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable`
  (и `DATABASE_URL_DIRECT` — то же). Порт 5433 — прод, не трогать.
- Тексты интерфейса — только через каталоги `src/i18n/messages/{ru,en,uz}.json`, во всех трёх.
  Каталоги правим ТОЛЬКО скриптом `python -I .superpowers/ppk/i18n_merge.py <patch.json>`
  (patch = `{"ru":{…},"en":{…},"uz":{…}}`), затем `npm run i18n:types`. Руками JSON не править.
- Дизайн-система: `.claude/skills/design-system/SKILL.md` (индиго `#5566f6`, `rounded-2xl/3xl`,
  токены `#0b1024/#3c4053/#6f7282/#9b9fb3`, рамки `#ececf4/#dcdfed`, hover 150–200 мс, фокус
  `ring-4 ring-[#5566f6]/15`). Без `text-muted-foreground`, `bg-card`, `rounded-md/lg`.
- Страницы кабинета: `params` — Promise. Guard страницы раздела пишется явно:
  `if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");` — тест меню ищет этот текст.
- Подтверждения — `ConfirmDialog` (`src/components/ui/confirm-dialog.tsx`), тосты — `sonner`.
- Комментарии в коде — по-русски, как в соседних файлах.
- Проверки: `npx tsc --noEmit --skipLibCheck -p tsconfig.typecheck.json`,
  `node --import tsx --test <файлы>`, `npm run i18n:check`, `npx eslint <файлы>`.
- Коммитит только оркестратор. Субагенты не коммитят и не пушат.

## Review Focus

1. Путь `/orders/x`, `/knowledge`, `/sanpin` — вкладка «Документы»/«Нормативы» активна, оглавление
   на месте, крошек нет.
2. Человек без `journals.view` (заведующая) — пункт «Рабочие инструкции» скрыт, остальное есть.
3. Повар: API раздела отвечает 403, страница уводит на `/journals`.
4. Файл чужой организации по id — 404.
5. Телефон 390px: оглавление складывается, горизонтальной прокрутки нет.

---

## Этап 1 — каркас

### Task 1: Схема данных (оркестратор)

**Files:** `prisma/schema.prisma`, `src/app/api/knowledge-documents/route.ts`

- [ ] Модель `PpkRecord` (поля из spec §7), связь `Organization.ppkRecords`.
- [ ] `KnowledgeDocument.folder String?` + `@@index([organizationId, folder])`.
- [ ] `/api/knowledge-documents` GET: `where` дополнить `folder: null`.
- [ ] `npx prisma generate`; `prisma db push` на e2e-БД.

### Task 2: Реестр, статусы, папки, API (субагент)

**Files:**
- Create: `src/lib/ppk/registry.ts`, `src/lib/ppk/registry.test.ts`
- Create: `src/lib/ppk/status.ts`, `src/lib/ppk/status.test.ts`
- Create: `src/lib/ppk/folders.ts`, `src/lib/ppk/access.server.ts`, `src/lib/ppk/facts.server.ts`
- Create: `src/app/api/production-control/progress/route.ts`
- Create: `src/app/api/production-control/files/route.ts`, `src/app/api/production-control/files/[id]/route.ts`

**Interfaces (Produces):**
```ts
// registry.ts
export type PpkGroupKey = "haccp" | "documents" | "sanitation" | "norms";
export type PpkBlockKey = "team" | "policy" | "products" | "flowcharts" | "hazards" | "control-points" | "audit"
  | "instructions" | "procedures" | "orders" | "posters" | "storage"
  | "floor-plans" | "pest-control" | "lab" | "norm-documents" | "guidelines" | "sanpin";
export type PpkBlockAccess = "fullAccess" | "journalsView" | "staffPath";
export type PpkBlock = { key: PpkBlockKey; group: PpkGroupKey; href: string; icon: string;
  counted: boolean; access: PpkBlockAccess; serviceKey?: string; ready: boolean };
export type PpkGroup = { key: PpkGroupKey; href: string; sequence: boolean };
export const PPK_OVERVIEW_HREF: "/production-control";
export const PPK_GROUPS: readonly PpkGroup[];
export const PPK_BLOCKS: readonly PpkBlock[];
export function ppkGroupBlocks(group: PpkGroupKey): PpkBlock[];        // только ready, в порядке реестра
export function ppkBlock(key: PpkBlockKey): PpkBlock;
export function ppkStep(key: PpkBlockKey): number | null;              // 1..n в группе с sequence, иначе null
// status.ts
export type PpkStatus = "done" | "started" | "empty" | "info";
export type PpkFacts = { … см. бриф … };
export function emptyPpkFacts(): PpkFacts;
export function computePpkStatuses(facts: PpkFacts): Record<PpkBlockKey, PpkStatus>;
export function ppkProgress(statuses: Record<PpkBlockKey, PpkStatus>): { done: number; total: number };
export function ppkNextStep(statuses: Record<PpkBlockKey, PpkStatus>): PpkBlock | null;
// folders.ts
export const PPK_FOLDERS: readonly [...]; export type PpkFolderKey; export function isPpkFolder(v: unknown): v is PpkFolderKey;
// access.server.ts
export async function requirePpkAccess(): Promise<{ ok: true; session; organizationId: string } | { ok: false; response: Response }>;
// facts.server.ts
export async function loadPpkFacts(organizationId: string): Promise<PpkFacts>;
export async function loadPpkStatuses(organizationId: string): Promise<Record<PpkBlockKey, PpkStatus>>;
```
API: `GET /api/production-control/progress` → `{ statuses }`; `GET/POST/DELETE
/api/production-control/files` (folder-список, загрузка одного файла, удаление `?id=`);
`GET /api/production-control/files/[id]` — отдать файл.

### Task 3: Меню и оболочка (субагент)

**Files:** `src/lib/app-nav.ts`, `src/lib/app-nav.server.ts`, `src/lib/app-nav.test.ts`,
`src/components/layout/section-tabs.tsx`, `src/components/layout/page-nav.tsx`,
`src/components/layout/section-frame.tsx` (new), `src/app/(dashboard)/layout.tsx`,
`src/components/layout/command-palette.tsx`, `src/lib/route-titles.ts`, каталоги i18n.

**Consumes:** Task 2 `registry.ts`, `/api/production-control/progress`.

**Produces:** `NavTab.items`, `VisibleNavTab.items`, `NavModelTab.items` (`{ id, href, label, step? }`),
`sectionForPath(...)` → `{ section, ownerHref, isTabRoot, tabHref, itemHref }`,
`useSectionPlace()` → `{ section, atRoot, nested, tab, item, depth, activeHref }`,
`<SectionFrame>`; событие окна `"ppk:changed"` перечитывает статусы.

### Task 4: Страницы этапа 1 (субагент)

**Files:** `src/app/(dashboard)/production-control/page.tsx` (rewrite),
`production-control/{haccp,documents,sanitation,norms}/page.tsx`,
`production-control/documents/{procedures,storage}/page.tsx`, `production-control/norms/guidelines/page.tsx`,
`src/components/production-control/*` (обзор, карточки группы, точка статуса, папка файлов), i18n.

**Consumes:** Task 2, Task 3.

### Task 5: Проверка, e2e, деплой (оркестратор)

---

## Этапы 2–4 (детализируются перед стартом этапа)

- **Этап 2 — ХАССП:** записи `PpkRecord` (API + zod-схемы блоков), общий выбор сотрудника,
  блоки team / policy (+печать с QR, публичная `/policy/[token]`) / products (ТР ТС) / hazards /
  control-points (дерево решений, рабочие листы, журналы, CAPA) / audit; предзаполнение
  приказа `haccp-team`.
- **Этап 3 — Санитария и схемы:** SVG-редактор (план помещений, блок-схемы), floor-plans,
  flowcharts, pest-control, lab.
- **Этап 4 — Документы, нормативы, сборка:** posters, norm-documents, сборка ППК и ХАССП-плана,
  ZIP «Пришла проверка», проверки готовности, WhatsNew, e2e всего раздела.
