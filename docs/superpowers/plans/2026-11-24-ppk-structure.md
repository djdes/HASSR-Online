# Структура ППК на `/production-control` — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** обзор «Производственного контроля» показывает структуру документа владельца (1.1–3.7, приложения №1–6); каждый пункт — ссылка, открывающая окно с данными пункта.

**Architecture:** чистый реестр пунктов `src/lib/ppk/structure.ts` (номера, вид панели, связь с блоками) + статусы пунктов из фактов. Пункт — маршрут `/production-control/item/[id]`; с обзора он перехватывается слотом `@modal` и рисуется в стандартном `Dialog` (на телефоне — шторка). Панель пункта — серверный компонент, читающий данные теми же загрузчиками, что страницы блоков, и отдающий их существующим клиентским редакторам; новые данные — новые блоки `PpkRecord`.

**Tech Stack:** Next.js 16 App Router (parallel + intercepting routes), Prisma `PpkRecord`, zod 4, next-intl, node:test.

**Spec:** `.agent/tasks/ppk-structure-2026-11-24/spec.md`

## Global Constraints

- Адрес пункта — `/production-control/item/<id>`, id без точек: `1-1`…`3-7`, `app-1`…`app-6`.
- Окно — `Dialog`/`DialogContent` из `@/components/ui/dialog` (на телефоне шторка снизу), без своей шторки.
- Все тексты интерфейса — в `src/i18n/messages/{ru,en,uz}.json` (`productionControl.structure`), затем `npm run i18n:types`.
- Шаблоны документов — русские константы в `src/lib/ppk/structure-templates.ts`.
- Права: `hasFullWorkspaceAccess` + `ppkPageScope` на страницах, `requirePpkAccess` в API; реквизиты — `admin.full`.
- Ни одна существующая запись/файл не удаляется; страницы блоков не меняют адресов.
- Новые цвета рамок не заводить (иначе `npm run borderless`); основной цвет `#5566f6`, без цветных свечений.

## Review Focus

- Прямой заход на `/production-control/item/<id>` (новая вкладка) — страница пункта, не пустое окно.
- Переход из окна по ссылке на страницу блока/редактор схемы закрывает окно (catch-all слота `@modal`).
- ППК точки: новые одиночные блоки пишут `singleton = <block>@<точка>`; копия ППК на точку переносит их.
- Неизвестный id пункта → 404; повар → forbidden; чужая точка → forbidden.
- Пустые источники (нет оборудования, журналов, сотрудников) — понятное пустое состояние со ссылкой на источник.

---

### Task 1: Данные — реестр пунктов, блоки, папки, шаблоны, статусы

**Files:** create `src/lib/ppk/structure.ts`, `src/lib/ppk/structure-templates.ts`, `src/lib/ppk/structure-status.ts` (+ `.test.ts` каждому); modify `src/lib/ppk/records.ts` (блоки `org-chart`, `contracts`, `production-info`, `text-*`, `prp-*`; `PPK_SINGLETON_BLOCKS`), `src/lib/ppk/folders.ts` (папки), `src/lib/ppk/facts.server.ts` (`groupValidRecords` для новых блоков).

**Interfaces (produces):**
- `PPK_STRUCTURE: readonly PpkStructureSection[]`, `ppkStructureItem(id: string): PpkStructureItem | null`, `PPK_STRUCTURE_ITEMS`, `ppkItemHref(id)`.
- `PpkStructureItem = { id; number; section; panel: PpkPanelKind; block?: PpkBlockKey; folder?: PpkFolderKey; textBlock?: PpkTextBlock }`.
- `ppkItemStatuses(facts: PpkItemFacts): Record<string, PpkStatus>`, `ppkItemProgress(statuses)`, `ppkNextItem(statuses)`.
- Шаблоны: `haccpPrinciplesTemplate()`, `teamLeaderRegulationTemplate(orgName)`, `teamRegulationTemplate(orgName)`, `ccpMethodTemplate()`, `PRP_TEMPLATES` (3.1, 3.2, 3.3, 3.4).
- Обязательные поля: `ORG_INFO_REQUIRED`, `PRODUCTION_INFO_FIELDS`, `missingOrgInfo(block)`, `missingProductionInfo(data, pulled)`.

- [ ] Тесты: 32 пункта, уникальные id без точек, номера как в документе; схемы новых блоков принимают валидное и режут битое; статусы пунктов по фактам; `missingOrgInfo` у ИП не требует КПП.
- [ ] Реализация, `node --import tsx --test` по новым тестам — зелёные.

### Task 2: Маршруты — слот `@modal`, перехват, страница пункта

**Files:** create `src/app/(dashboard)/production-control/@modal/default.tsx`, `@modal/[...catchAll]/page.tsx`, `@modal/(.)item/[id]/page.tsx`, `@modal/(.)item/[id]/loading.tsx`, `item/[id]/page.tsx`; modify `production-control/layout.tsx` (проп `modal`); create `src/components/production-control/structure/item-dialog.tsx` (клиент: `Dialog`, закрытие `router.back()`), `item-panel.tsx` (сервер: выбор панели по виду).

- [ ] `PpkItemPanel({ item, scope, session, mode })` — общий для окна и страницы.
- [ ] Неизвестный id → `notFound()`.

### Task 3: Обзор

**Files:** modify `src/app/(dashboard)/production-control/page.tsx`; create `src/components/production-control/structure/ppk-structure-outline.tsx`, `ppk-structure-refresh.tsx` (по `ppk:changed` → `router.refresh()`); `src/lib/ppk/structure-facts.server.ts` (`loadPpkItemFacts(scope)`).

### Task 4: Панели пунктов и API

**Files:** `src/components/production-control/structure/panels/*.tsx` (по видам), API `src/app/api/production-control/products/import/route.ts`, `acknowledgements/pin/route.ts`; `src/lib/ppk/acknowledge*.ts` (ключ `ppk`); `src/lib/inspection-norms*.ts` + `portal-sections.tsx` (договоры); `diagram-list.tsx`/`diagram-page.tsx`/`diagram.server.ts` (вид `org-chart`), страницы `production-control/org-chart/[id]` и `/print`; `program/page.tsx` и `pdf.ts` (аварийные ситуации из записей).

### Task 5: Тексты, проверки, стенд, выкладка

- [ ] ru/en/uz, `npm run i18n:types`, `npm run i18n:check`.
- [ ] `npm run typecheck`, `npm run test:changed`, `npx eslint <изменённые>`, `npm run build`.
- [ ] Локальный стенд: Postgres, `prisma db push`, сид, `next start`; Playwright: обзор, окно (1280px), шторка (390px), сохранение.
- [ ] evidence, verdict, PR, merge в master, выкладка.
