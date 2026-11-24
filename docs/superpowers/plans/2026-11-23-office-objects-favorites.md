# Office is not an object, object pins, office page, menu lists, favorites stars — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The header object control reads «Выберите объект» instead of «Организация · Офис», switches silently and
re-selects the remembered or single object; journals are always created on an object; objects can be pinned;
the office page shows management and links to all staff/equipment by object; top-row menus open lists; any menu
item can be starred into home favorites (up to 7).

**Architecture:** Decisions stay in pure modules (`lib/header-point.ts`, `lib/point-section-sync.ts`,
`lib/pinned-buildings.ts`, `lib/office-journals.ts`, `lib/home-page.ts`) covered by `node:test`; React
components only render them. Data: one new column `User.pinnedBuildingIds String[] @default([])`; office
documents move once via a guarded deploy seed.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7, radix-ui (DropdownMenu, ContextMenu), next-intl,
sonner, node:test via tsx.

**Spec:** `.agent/tasks/office-objects-favorites-2026-11-23/spec.md`

## Global Constraints

- UI text in `src/i18n/messages/{ru,en,uz}.json` in the same commit, then `npm run i18n:types`.
- One accent (`#5566f6`), no box borders on cards/buttons (`src/app/borderless.test.ts`), neutral palette regenerated when new indigo classes appear (`npm run palette:neutral`, `npm run borderless`).
- Every Prisma query scoped by `getActiveOrgId(session)`.
- Toasts only via `sonner`; object switches show none (spec AC2).
- `HOME_FAVORITES_MAX = 7`; pins and favorites are per person.

## Review Focus

- Header in the middle of an automatic switch: no stale object flash or toast; the skeleton covers the switch.
- A point manager (`canViewOrganization = false`) in a company-wide page keeps their object; never «Выберите объект» loops.
- Pinned id of a deleted object or another organization: ignored in sorting, never breaks the list.
- Favorites list full (7): adding an eighth shows a hint and changes nothing; removing from the home page and from a star stay in sync.
- `POST /api/journal-documents` with `buildingId` of the office or of another organization: 400/404, no document.

---

### Task 1: Header object control and silent switching (AC1–AC3)

**Files:** Modify `src/lib/header-point.ts`, `src/lib/point-section-sync.ts`, `src/components/layout/current-point-switcher.tsx`, `src/components/layout/location-switcher.tsx`, `src/components/layout/point-section-sync.tsx`, `src/app/(dashboard)/layout.tsx`. Tests: `src/lib/header-point.test.ts`, `src/lib/point-section-sync.test.ts`.

**Interfaces:**
- Produces: `HeaderPoint` switch kind `{ kind: "switch"; activeId: string | null; options; organizationLevel: boolean }` (office and the virtual organization never in `options`); `headerPointChoosing(pathname, point): boolean`; `autoPointTarget({ pathname, viewedPointId, returnPointId, pointIds }): string | null` (remembered → single → null; home, `/settings/buildings/new`, company-wide and point pages → null).

- [ ] Tests: office and «Вся организация» absent from options; org-level → `activeId: null`; `add` kept for zero objects; `headerPointChoosing` true for add, for switch with null, for single and organization-level switch on company-wide paths, false on object pages and home; `autoPointTarget` returns remembered id, falls back to the single object, null on home/new-object wizard/company pages/≥2 without memory.
- [ ] Implement; switcher renders «Выберите объект» (caption-less), empty list state «Объектов пока нет», footer «Создать объект» + «Настроить объекты»; `useSwitchBuilding.switchTo` and `PointSectionSync` call `refreshAfter(tag, go)` without toast callbacks.
- [ ] Run `node --import tsx --test src/lib/header-point.test.ts src/lib/point-section-sync.test.ts` — PASS.

### Task 2: Journals on objects (AC4–AC5)

**Files:** Create `src/lib/office-journals.ts` (+ test), `prisma/seed-office-journals-to-points-2026-11.ts`, `src/components/journals/journal-point-notice.tsx`. Modify `src/lib/building-targets.ts`, `src/app/api/journal-documents/route.ts`, consumers that create documents (`auto-create`, `bulk-create`, `cron/auto-create-journals`, `cron/journal-automation`, `journal-responsibles/recreate-documents`, `organizations/auto-journals/apply`), `src/components/journals/use-document-dialog-submit.tsx`, `src/components/journals/journal-create-defaults.tsx`, `src/components/journals/create-document-dialog.tsx`, `src/app/(dashboard)/journals/[code]/page.tsx`, `.github/workflows/deploy.yml`.

**Interfaces:**
- Produces: `officeJournalTarget(buildings: {id; kind?; sortOrder; name}[]): string | null`; `documentBuildingTargets(orgId): Promise<Array<string | null>>` (= `buildingTargets` without the office); `PointRequiredError` thrown by `readCreatedDocument` on `{ code: "point_required" }`; `JournalCreateDefaults.point?: { options: {id; name}[]; createHref: string | null } | null`.

- [ ] Tests: `officeJournalTarget` — single point, first by `sortOrder` then name, office skipped, none → null; `documentTargets` filter drops the office and keeps `[null]` semantics.
- [ ] API guard: enabled context + organization view + no point → 400 `point_required`; office `buildingId` → 400.
- [ ] Dialog field «Объект» (required) + «Создать объект»; page notice with object buttons; seed with `--dry-run`, once-key, audit log; deploy line.

### Task 3: Object pins (AC6)

**Files:** Modify `prisma/schema.prisma` (User.pinnedBuildingIds), create `src/lib/pinned-buildings.ts` (+ test), `src/app/api/me/pinned-buildings/route.ts`; modify layout, switcher, `location-switcher.tsx`, `settings/buildings/page.tsx` + `buildings-client.tsx`.

**Interfaces:** `sortPinnedFirst<T extends { id: string }>(items: T[], pinned: readonly string[]): T[]`; `nextPinned(current: readonly string[], id: string, pinned: boolean): string[]`; `POST /api/me/pinned-buildings { buildingId, pinned } → { pinnedBuildingIds }`.

- [ ] Tests: pinned first in pin order, unknown ids ignored, stable order otherwise; toggle idempotent, cap 50.
- [ ] API rejects office (400) and foreign/unknown building (404).

### Task 4: Office page and staff place pill (AC7–AC8)

**Files:** Modify `src/app/(dashboard)/settings/organization/office/page.tsx`, `src/components/staff/staff-page-client.tsx`. Create `src/lib/office-roster.ts` (+ test).

**Interfaces:** `isOfficeLeader(person: { role; buildingIds; jobPosition?: { categoryKey } | null }, officeId: string): boolean`.

- [ ] Tests: office-placed → true; management role/position without places → true; management placed at points → false; cook without places → false.

### Task 5: Top row lists (AC9)

**Files:** Modify `src/components/layout/section-top-menu.tsx`.

- [ ] Whole panel tab is the dropdown trigger; own row keeps the section link.

### Task 6: Favorites (AC10)

**Files:** Modify `src/lib/home-page.ts` (+ test), `src/components/home/home-favorites.tsx`, `src/app/(dashboard)/home/page.tsx`, `src/app/(dashboard)/layout.tsx`, `src/components/layout/app-sidebar-accordion-classic.tsx`, `src/components/layout/app-sidebar-accordion.tsx`, `src/components/layout/section-top-menu.tsx`. Create `src/components/favorites/favorites-context.tsx`, `src/components/favorites/favorite-star.tsx`, `src/components/favorites/nav-context-menu.tsx`, `src/components/ui/context-menu.tsx`.

**Interfaces:** `favoriteCandidates(sections)` adds section entries and item tabs; `useFavorites(): { enabled; hrefs; isFavorite(href); canStar(href); toggle(href): Promise<void> }`; `homeFavoriteSlots(filled: number): number` (= `max(3, min(7, filled + 1))`).

- [ ] Tests: candidates include section roots, nested sections and tabs once each; `normalizeFavorites` keeps 7; `homeFavoriteSlots(0)=3`, `(3)=4`, `(7)=7`.

### Task 7: QR and areas guide (AC11–AC12)

**Files:** Modify `src/app/api/qr-fill/[kind]/[id]/route.ts`, `src/components/qr/qr-fill-preview.tsx`, `src/components/journals/cold-equipment-document-client.tsx`, `src/app/(dashboard)/settings/areas/page.tsx`, dictionaries.

- [ ] 404 carries `code: "missing"` and a kind-specific message; preview shows `missingHint` without «Повторить»; save that relinks keeps the dialog open with the new QR.

### Task 8: Verification (AC13)

- [ ] `npm run i18n:types`, `npm run typecheck`, `npm run test:gate`, `npm run i18n:check`, eslint on changed files, design guards; local stand screenshots; evidence; fresh verifier.
