# GoGetLinks SEO Links, Webmaster Chats & Purchase Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/root/seo/links` platform admin workspace synchronized with GoGetLinks via `api-anything` (`Tier 1`), delivering full backlink & spend attribution («кто купил»), two-way webmaster chats with placement review, Similarweb + Topvisor landing/donor/article selection, and a transparent future purchase scheduler with mandatory human approval.

**Architecture:** The Next.js 16 server runs `api-anything` (`Tier 1`, `Node fetch` + encrypted cookie jar in `GglAccount.sessionEnc` with auto-relogin via `POST /user/signIn`) under an isolated runtime directory and single-flight mutex, mirroring GoGetLinks campaigns, reviews/orders, and webmaster message threads into PostgreSQL every 10 minutes via `/api/cron/gogetlinks`. Similarweb competitor snapshots + live Topvisor rankings score `wesetup.ru` target pages, pick 1-link-per-domain donors from `/searchSites`, and generate expert articles/anchors asynchronously through the existing ProjectsFlow `ai-prompt-jobs` queue (`wesetup_ggl_article` / `wesetup_vision_extract`), holding every scheduled slot in `pending_approval` until a platform admin clicks «Подтвердить закупку».

**Tech Stack:** Next.js 16.1.6 (App Router), TypeScript 5, React 19, Prisma 7.4.2 (`@prisma/adapter-pg`), PostgreSQL, `api-anything` `^0.3.2` (`serverExternalPackages`), AES-256-GCM (`src/lib/integration-crypto.ts`), ProjectsFlow AI queue (`src/lib/ai-assistant/pf-client.ts`, `src/lib/ai-vision/run.ts`), Zod 4, Tailwind CSS 4, `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-05-gogetlinks-seo-links-design.md`

## Global Constraints

- **Isolated branch & proof-loop:** Work on a fresh feature branch from `origin/master` (pushing to `master` deploys to production). Freeze `.agent/tasks/gogetlinks-seo-links-2026-11/spec.md` (`AC1`–`AC8`) before code changes and produce `evidence.md`, `evidence.json`, and `raw/*` before claiming completion.
- **No spend without human click:** Cron and planner jobs NEVER call `submitLinkOrder` or freeze GoGetLinks funds automatically; scheduled slots stop at `status = "pending_approval"` until an authorized user approves in `/root/seo/links`.
- **Strict `wesetup.ru` write isolation:** All campaigns in GoGetLinks are synced for balance transparency, with `isWesetup = (domain === "wesetup.ru")`. Default UI views and ALL planner/order/placement write operations are strictly restricted to campaigns with `isWesetup = true` (`yesbeat.ru`, `foodgin.ru`, `fonmusic.ru`, `mp3mail.ru`, `electrorent.ru` are read-only archive).
- **Secrets outside Git:** GoGetLinks email/password (`passwordEnc`) and cookie jar (`sessionEnc`) live encrypted at rest via `encryptSecret` / `decryptSecret` (`AES-256-GCM`, `src/lib/integration-crypto.ts`). Repo spec `config/api-anything/sites/gogetlinks.json` contains zero cookies or credentials and pins `"loginCookies": ["hash", "PHPSESSID"]`.
- **Platform gates & spend guard:** `/root/seo/links` and operational `/api/root/gogetlinks/*` routes use gate `"seo"`; `PUT /api/root/gogetlinks/account` uses gate `"superadmin"`; financial mutations (`slot.approve`, `order.manual_create`, `plan.update`) require `isPlatformAdministrator(user)` unless `GglAccount.allowSeoApproveWithinPlan === true` (which permits `"seo"` to approve `pending_approval` slots within an already approved plan budget). Every new `/root` page and `/api/root` route must pass `src/lib/platform-access.test.ts`.
- **No direct LLM calls on server:** Article/anchor generation (`type: wesetup_ggl_article`) and Similarweb screenshot OCR (`type: wesetup_vision_extract`) go exclusively through `enqueueAndWait` (`src/lib/ai-assistant/pf-client.ts`); `dispatcher/wesetup-worker.ps1` must remain 100% ASCII-only.
- **Gentle GoGetLinks pacing & idempotency:** Max 1 sequential request stream (`minIntervalMs >= 1000`), cron every `10 minutes` with overlap lock, Node `>= 22.13.0`, Zod v4 syntax, `sonner` toasts, Russian UI copy, English code/comments.

## Review Focus

1. **Zero-active-campaigns redirect & checkbox-less rows in GoGetLinks:** When the account has `0` active campaigns, `GET /campaigns` redirects/renders `/campaigns/index/action/view_closed`, and admin-locked rows (such as `comp_row_146053`) omit `input.check-box-comp-id`; normalization must detect the closed view so closed campaigns are never marked `"active"` and must fall back to parsing `gglCampaignId` from `campaignUrl` (`/campaign/index/id/146053`). *(Pinned in Task 2)*
2. **`windows-1251` form encoding on Russian write payloads:** Non-AJAX HTML form POSTs to GoGetLinks (`PHP/7.4.33`, `charset=windows-1251`) turn UTF-8 percent-encoded Cyrillic into mojibake (`Р–СѓСЂ...`); the codec must encode Cyrillic + `№` into `windows-1251` percent-encoding and safely normalize `₽` → `руб.` before form submission. *(Pinned in Task 2)*
3. **Concurrent click or mid-flight network timeout on paid order / chat reply:** Two admins clicking «Подтвердить» at once or a socket timeout after the request left Node must never double-spend or double-send: atomic DB status capture (`pending_approval` → `approved_sending`, `idempotencyKey`) returns `409` to the second caller, and ambiguous network timeouts stay in `approved_sending` / `sending` until read-sync reconciles against `/reviews` or `/messages`. *(Pinned in Task 5 & Task 6)*
4. **Donor price hike, low wallet balance, or cross-project campaign ID at approval time:** If a donor raises its price above `slot.maxPriceRub`, `availableRub` drops below price, or a payload references a `yesbeat.ru` campaign (`isWesetup = false`) between slot preparation and approval, `approvePlannedSlot` must abort before `submitLinkOrder` with `0 ₽` spent. *(Pinned in Task 6)*
5. **Topvisor `"--"` out-of-range positions & anchor over-optimization:** Phrases with Topvisor position `"--"` or mismatched ranking URLs must score cleanly without `NaN`, previously purchased `donorDomain`s for `wesetup.ru` must be excluded (`1 donor = 1 link`), and targets that already have an `"exact"` anchor order must receive `"url_brand"` or `"diluted"` anchors to keep `anchorMix >= 50%`. *(Pinned in Task 4)*

---

## File Map

- **Proof-loop & Docs:**
  - `.agent/tasks/gogetlinks-seo-links-2026-11/spec.md` — frozen acceptance criteria `AC1`–`AC8`.
  - `docs/ai-dispatcher.md` & `dispatcher/wesetup-worker.ps1` — register `wesetup_ggl_article` (ASCII-only in `.ps1`).
- **Database & Access:**
  - `prisma/schema.prisma` — 9 models: `GglAccount`, `GglCampaign`, `SeoCompetitorSnapshot`, `GglArticle`, `GglOrder`, `GglThread`, `GglMessage`, `GglSchedulePlan`, `GglPlannedSlot`.
  - `src/lib/platform-access.ts` & `src/lib/platform-access.test.ts` — path rules for `/api/root/gogetlinks/*` and `PUT /api/root/gogetlinks/account`.
  - `src/lib/seo/gogetlinks-access.ts` & `src/lib/seo/gogetlinks-access.test.ts` — `canApproveGglSpend` financial guard.
- **Transport, Sync, Planner, Chats, Orders, Cron (`src/lib/seo/`):**
  - `config/api-anything/sites/gogetlinks.json` — clean `api-anything` site spec (`loginCookies: ["hash", "PHPSESSID"]`, read & `--write` ops).
  - `src/lib/seo/gogetlinks-codec.ts` & `src/lib/seo/gogetlinks-codec.test.ts` — `windows-1251` codec, ruble/metric parsers, row normalizers, `isWesetupDomain`.
  - `src/lib/seo/gogetlinks-client.server.ts` — `api-anything` `Tier 1` wrapper, encrypted cookie jar sync, `POST /user/signIn` relogin, `GGL_PROXY_URL`, single-flight mutex, `isWesetup` write assertion.
  - `src/lib/seo/similarweb-seed.ts` — `Jul–Sep 2026` Similarweb baseline snapshots (`wesetup.ru`, `haccp-online.ru`, `checkoffice.ru`) + idempotent seeder.
  - `src/lib/seo/gogetlinks-sync.server.ts` & `src/lib/seo/gogetlinks-sync.test.ts` — read sync of balance, campaigns, orders, threads/messages, attribution preservation, in-flight reconciliation.
  - `src/lib/seo/gogetlinks-planner.ts` & `src/lib/seo/gogetlinks-planner.test.ts` — pure Similarweb + Topvisor page scoring, anchor-mix picker, donor ranker (`1 donor = 1 link`), 30-day slot calendar generator.
  - `src/lib/seo/gogetlinks-article-ai.server.ts` — `wesetup_ggl_article` & Similarweb `wesetup_vision_extract` wrappers over `pf-client.ts` / `run.ts`.
  - `src/lib/seo/gogetlinks-chat.server.ts` & `src/lib/seo/gogetlinks-chat.test.ts` — idempotent webmaster replies & placement accept/revision.
  - `src/lib/seo/gogetlinks-orders.server.ts` & `src/lib/seo/gogetlinks-orders.test.ts` — plan CRUD, 7-day slot preparation, 1-click human approval, manual order, donor swap, rejected-order fallback.
  - `src/lib/seo/gogetlinks-cron.server.ts` & `src/lib/seo/gogetlinks-cron.test.ts` — 10-minute orchestrator + tiered admin/SEO notifications.
- **API Routes (`src/app/api/`):**
  - `src/app/api/cron/gogetlinks/route.ts`
  - `src/app/api/root/gogetlinks/account/route.ts`
  - `src/app/api/root/gogetlinks/sync/route.ts`
  - `src/app/api/root/gogetlinks/overview/route.ts`
  - `src/app/api/root/gogetlinks/similarweb/route.ts`
  - `src/app/api/root/gogetlinks/threads/route.ts`
  - `src/app/api/root/gogetlinks/threads/[id]/route.ts`
  - `src/app/api/root/gogetlinks/orders/route.ts`
  - `src/app/api/root/gogetlinks/orders/[id]/review/route.ts`
  - `src/app/api/root/gogetlinks/plans/route.ts`
  - `src/app/api/root/gogetlinks/slots/[id]/route.ts`
  - `src/app/api/root/gogetlinks/slots/[id]/approve/route.ts`
- **Admin UI:**
  - `src/components/root/seo-subnav.tsx` — shared `Здоровье` · `Позиции` · `Ссылки` subnav with unread/pending badge.
  - `src/app/root/seo/page.tsx` & `src/app/root/seo/positions/page.tsx` — wire `SeoSubnav`.
  - `src/app/root/seo/links/page.tsx` & `src/app/root/seo/links/links-client.tsx` — `/root/seo/links` workspace.
  - `src/components/root/seo-links/{SeoLinksHeaderMetrics,PlannerTab,OrdersRegistryTab,ChatsTab,DemandAndAccountTab,ArticleDrawer}.tsx` — focused UI tabs.

---

### Task 1: Proof-Loop Spec Freeze, Prisma Schema, Platform Access Gates & Financial Guard

**Files:**
- Create: `.agent/tasks/gogetlinks-seo-links-2026-11/spec.md`
- Modify: `prisma/schema.prisma` (append GoGetLinks & `SeoCompetitorSnapshot` models at end of schema)
- Modify: `src/lib/platform-access.ts:50` and `src/lib/platform-access.ts:162-168`
- Modify: `src/lib/platform-access.test.ts:42-77`
- Create: `src/lib/seo/gogetlinks-access.ts`
- Test: `src/lib/seo/gogetlinks-access.test.ts`

**Interfaces:**
- Consumes: `isPlatformAdministrator`, `PLATFORM_RULES`, `platformGateFor`, `canAccessPlatformPath` from `src/lib/platform-access.ts`.
- Produces:
  - Prisma models (`prisma/schema.prisma`):
    - `GglAccount` (`id`, `email @unique`, `passwordEnc`, `sessionEnc?`, `balanceRub Decimal @db.Decimal(12,2) @default(0)`, `availableRub Decimal @db.Decimal(12,2) @default(0)`, `blockedRub Decimal @db.Decimal(12,2) @default(0)`, `defaultCampaignId Int?`, `allowSeoApproveWithinPlan Boolean @default(false)`, `status String @default("unchecked")`, `lastSyncedAt DateTime?`, `lastError String?`, `updatedByUserId String?`, `createdAt`, `updatedAt`)
    - `GglCampaign` (`id`, `gglCampaignId Int @unique`, `name`, `domain`, `siteUrl`, `isWesetup Boolean @default(false)`, `state String`, `spentRub Decimal @db.Decimal(12,2) @default(0)`, `linksCount Int @default(0)`, `requestsCount Int @default(0)`, `qualityControl String?`, `statusNote String?`, `targetAnchorsJson Json?`, `syncedAt DateTime`, relations `articles`, `orders`, `threads`, `plans`)
    - `SeoCompetitorSnapshot` (`id`, `domain`, `periodLabel`, `visitsMonthly Int`, `organicSharePct Float?`, `paidSharePct Float?`, `bouncePct Float?`, `pagesPerVisit Float?`, `clusters Json`, `sourceKind String`, `createdByUserId String?`, `createdAt DateTime @default(now())`, `@@unique([domain, periodLabel])`)
    - `GglArticle` (`id`, `gglArticleId Int? @unique`, `campaignId String`, `targetUrl String`, `targetKeyword String`, `anchor String`, `anchorKind String`, `title String`, `announcement String`, `bodyHtml String`, `metaTitle String?`, `metaDescription String?`, `metaKeywords String?`, `status String @default("draft")`, `createdByUserId String?`, `createdAt`, `updatedAt`)
    - `GglOrder` (`id`, `gglReviewId Int? @unique`, `campaignId String`, `donorSiteId Int?`, `donorDomain String`, `donorDailyTraffic Int?`, `donorTfCf String?`, `donorTrust Int?`, `placementFormat String`, `priceRub Decimal @db.Decimal(12,2)`, `targetUrl String`, `anchor String`, `publishedUrl String?`, `articleId String?`, `paidAt DateTime?`, `cancelledAt DateTime?`, `indexedStatus String?`, `status String`, `origin String`, `initiatedByUserId String?`, `initiatedByName String?`, `approvedByUserId String?`, `approvedByName String?`, `approvedAt DateTime?`, `plannedSlotId String? @unique`, `idempotencyKey String @unique`, `createdAt`, `updatedAt`)
    - `GglThread` (`id`, `gglThreadKey String @unique`, `orderId String?`, `campaignId String?`, `donorDomain String?`, `webmasterLogin String?`, `subject String?`, `unreadCount Int @default(0)`, `needsReply Boolean @default(false)`, `lastMessageAt DateTime?`, `lastMessagePreview String?`, `createdAt`, `updatedAt`, `messages GglMessage[]`)
    - `GglMessage` (`id`, `threadId String`, `gglMessageId String? @unique`, `direction String`, `authorLabel String`, `sentByUserId String?`, `sentByName String?`, `body String`, `deliveryStatus String @default("synced")`, `idempotencyKey String? @unique`, `sentAt DateTime`)
    - `GglSchedulePlan` (`id`, `name String`, `campaignId String`, `kind String`, `budgetRub Int`, `maxPricePerLinkRub Int`, `startsAt DateTime`, `scheduleDaysOfWeek Json`, `minTfCf Int @default(10)`, `minTrust Int @default(4)`, `minDailyTraffic Int @default(100)`, `allowedFormats Json`, `anchorMixBrandPct Int @default(50)`, `isActive Boolean @default(true)`, `createdByUserId String?`, `createdAt`, `updatedAt`, `slots GglPlannedSlot[]`)
    - `GglPlannedSlot` (`id`, `planId String`, `scheduledDate String`, `maxPriceRub Int`, `estimatedPriceRub Int?`, `targetUrl String?`, `targetKeyword String?`, `sourceSnapshotId String?`, `topvisorPosSnapshot Json?`, `selectionReason String?`, `donorSiteId Int?`, `donorDomain String?`, `donorMetricsJson Json?`, `placementFormat String?`, `anchor String?`, `anchorKind String?`, `articleId String?`, `briefText String?`, `alternativeDonorsJson Json?`, `status String @default("planned")`, `approvedByUserId String?`, `approvedByName String?`, `approvedAt DateTime?`, `idempotencyKey String @unique`, `createdAt`, `updatedAt`)
  - `canApproveGglSpend(user: { isRoot: boolean; platformSections: readonly string[] }, opts: { allowSeoApproveWithinPlan: boolean; withinApprovedPlan: boolean }): boolean` in `src/lib/seo/gogetlinks-access.ts`.

- [ ] **Step 1: Create feature branch from fresh `origin/master` and freeze `.agent/tasks/gogetlinks-seo-links-2026-11/spec.md`**

Create branch `feat/gogetlinks-seo-links` from `origin/master` (preserving any unrelated local edits outside commits) and write `.agent/tasks/gogetlinks-seo-links-2026-11/spec.md` pinning `AC1` (schema & encryption), `AC2` (`api-anything` `Tier 1` spec & sync), `AC3` (`wesetup.ru` isolation & attribution), `AC4` (two-way chats & placement review), `AC5` (Similarweb + Topvisor planner & `wesetup_ggl_article`), `AC6` (scheduler with mandatory human approval & financial guards), `AC7` (`/root/seo/links` UI & cron notifications), `AC8` (`i18n:check`, `typecheck`, `test:gate`, `eslint`).

- [ ] **Step 2: Write the failing access & financial guard tests**

Add assertions to `src/lib/platform-access.test.ts`:
```ts
assert.equal(platformGateFor("/root/seo/links"), "seo");
assert.equal(platformGateFor("/api/root/gogetlinks/overview", "GET"), "seo");
assert.equal(platformGateFor("/api/root/gogetlinks/account", "GET"), "seo");
assert.equal(platformGateFor("/api/root/gogetlinks/account", "POST"), "superadmin");
assert.equal(platformGateFor("/api/root/gogetlinks/account", "PUT"), "superadmin");
assert.equal(platformGateFor("/api/root/gogetlinks/account", "DELETE"), "superadmin");
```
Create `src/lib/seo/gogetlinks-access.test.ts`:
```ts
import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_SECTION_KEYS } from "@/lib/platform-access";
import { canApproveGglSpend } from "@/lib/seo/gogetlinks-access";

test("canApproveGglSpend enforces owner/admin by default and optional seo delegation only within plan", () => {
  const owner = { isRoot: true, platformSections: [] };
  const fullAdmin = { isRoot: false, platformSections: [...PLATFORM_SECTION_KEYS] };
  const seoOnly = { isRoot: false, platformSections: ["seo", "content"] };

  assert.equal(canApproveGglSpend(owner, { allowSeoApproveWithinPlan: false, withinApprovedPlan: false }), true);
  assert.equal(canApproveGglSpend(fullAdmin, { allowSeoApproveWithinPlan: false, withinApprovedPlan: false }), true);
  assert.equal(canApproveGglSpend(seoOnly, { allowSeoApproveWithinPlan: false, withinApprovedPlan: true }), false);
  assert.equal(canApproveGglSpend(seoOnly, { allowSeoApproveWithinPlan: true, withinApprovedPlan: true }), true);
  assert.equal(canApproveGglSpend(seoOnly, { allowSeoApproveWithinPlan: true, withinApprovedPlan: false }), false);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test src/lib/platform-access.test.ts src/lib/seo/gogetlinks-access.test.ts`
Expected: FAIL (`gogetlinks-access` missing and `/api/root/gogetlinks/overview` resolves to `"superadmin"` instead of `"seo"`).

- [ ] **Step 4: Update `prisma/schema.prisma`, `src/lib/platform-access.ts`, and implement `src/lib/seo/gogetlinks-access.ts`**

Append the 9 Prisma models in `prisma/schema.prisma` (with indexes on `campaignId`, `status`, `scheduledDate`, `lastMessageAt`). In `src/lib/platform-access.ts`, add `{ pattern: "/api/root/gogetlinks", gate: "seo" }` and `{ pattern: "/api/root/gogetlinks/account", gate: "superadmin", methods: ["POST", "PUT", "DELETE"] }`, and update `"seo"` hint to `"Здоровье сайта, позиции, ссылки GoGetLinks, Яндекс Директ"`. Implement `canApproveGglSpend` in `src/lib/seo/gogetlinks-access.ts` using `isPlatformAdministrator(user)` + `(opts.withinApprovedPlan && opts.allowSeoApproveWithinPlan && user.platformSections.includes("seo"))`. Regenerate Prisma client with `npx prisma generate`.

- [ ] **Step 5: Run Prisma generate & tests to verify they pass**

Run: `npx prisma generate && npx tsx --test src/lib/platform-access.test.ts src/lib/seo/gogetlinks-access.test.ts`
Expected: PASS (`0` failures).

- [ ] **Step 6: Commit**

```bash
git add .agent/tasks/gogetlinks-seo-links-2026-11/spec.md docs/superpowers/specs/2026-11-05-gogetlinks-seo-links-design.md prisma/schema.prisma src/lib/platform-access.ts src/lib/platform-access.test.ts src/lib/seo/gogetlinks-access.ts src/lib/seo/gogetlinks-access.test.ts
git commit -m "feat(seo): add GoGetLinks schema, platform gates and spend guard"
```

---

### Task 2: `api-anything` Spec, `windows-1251` Codec, Normalizers & Tier-1 Client

**Files:**
- Modify: `package.json` and `package-lock.json` (install `api-anything@^0.3.2`)
- Modify: `next.config.ts:43` (`serverExternalPackages` += `"api-anything"`)
- Create: `config/api-anything/sites/gogetlinks.json`
- Create: `src/lib/seo/gogetlinks-codec.ts`
- Create: `src/lib/seo/gogetlinks-client.server.ts`
- Test: `src/lib/seo/gogetlinks-codec.test.ts`

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret` from `src/lib/integration-crypto.ts`; `call`, `parseSite`, `type StoredCookie` from `"api-anything"`; `db` from `src/lib/db.ts`.
- Produces:
  - `src/lib/seo/gogetlinks-codec.ts`:
    - `isWesetupDomain(domainOrUrl: string): boolean` — returns `true` iff host (stripped of `www.` and protocol/path, lowercased) equals `"wesetup.ru"`.
    - `encodeWin1251Form(fields: Record<string, string | number | undefined>): string` — encodes keys/values into `application/x-www-form-urlencoded` using single-byte `windows-1251` percent-encoding (`%C0`–`%FF`, `Ё`=`%A8`, `ё`=`%B8`, `№`=`%B9`, `—`=`%97`, `«`=`%AB`, `»`=`%BB`), normalizing `₽` → `"руб."` before encoding.
    - `decodeWin1251(bytes: Uint8Array): string` — `new TextDecoder("windows-1251").decode(bytes)`.
    - `parseRubAmount(raw: string | null | undefined): number` — parses `"8 936.06 р."`, `"15 415 р."`, `"0"` → `8936.06`, `15415`, `0`.
    - `parseTfCf(raw: string | null | undefined): { tf: number; cf: number; label: string } | null` — parses `"14 / 22"` or `"18"` cleanly.
    - `normalizeCampaignRow(raw: Record<string, unknown>, context: { requestedState: "active" | "closed"; finalUrl?: string }): NormalizedGglCampaign | null` — extracts `gglCampaignId` from `campaignId` OR `/campaign/index/id/(\d+)` in `campaignUrl`, overrides `state` to `"closed"` if `context.finalUrl?.includes("view_closed")` or `statusNote` matches `/закрыта|заблокирована/i`, sets `isWesetup = isWesetupDomain(domain)`.
    - `normalizeReviewRow(raw: Record<string, unknown>, defaultStatus: string): NormalizedGglReview | null` — parses `col_row_<id>`, donor domain, metrics, price, paid date (`DD.MM.YYYY`), target URL, anchor.
  - `src/lib/seo/gogetlinks-client.server.ts`:
    - `verifyAndLoginGgl(email: string, password: string): Promise<{ cookies: StoredCookie[]; balance: GglWalletBalance }>`
    - `callGglRead<T = unknown>(opName: string, args?: Record<string, unknown>): Promise<T>`
    - `callGglWrite<T = unknown>(input: { opName: string; args: Record<string, unknown>; idempotencyKey: string; campaignIdForGuard?: string }): Promise<{ status: "applied" | "accepted" | "may_have_applied"; data: T }>` — throws `GglIsolationError` before touching network if `campaignIdForGuard` resolves to a `GglCampaign` with `isWesetup !== true`.

- [ ] **Step 1: Write failing codec, parser & spec validation tests (covering Review Focus #1 & #2)**

Create `src/lib/seo/gogetlinks-codec.test.ts`:
```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decodeWin1251,
  encodeWin1251Form,
  isWesetupDomain,
  normalizeCampaignRow,
  parseRubAmount,
} from "@/lib/seo/gogetlinks-codec";

test("Review Focus #1: redirect to view_closed & admin-locked row without checkbox stay closed with parsed id", () => {
  const row = normalizeCampaignRow(
    {
      campaignUrl: "/campaign/index/id/146053",
      campaignId: undefined,
      name: "FonMusic",
      domain: "fonmusic.ru",
      siteUrl: "https://fonmusic.ru",
      statusNote: "Кампания закрыта администратором",
      spent: "15 415 р.",
      linksCount: "42",
      requestsCount: "0",
    },
    { requestedState: "active", finalUrl: "https://gogetlinks.net/campaigns/index/action/view_closed" },
  );
  assert.ok(row);
  assert.equal(row.gglCampaignId, 146053);
  assert.equal(row.state, "closed");
  assert.equal(row.isWesetup, false);
  assert.equal(row.spentRub, 15415);
});

test("Review Focus #2: encodeWin1251Form round-trips Russian Cyrillic, № and ₽ without UTF-8 mojibake", () => {
  const encoded = encodeWin1251Form({
    name: "Журнал №1 — СанПиН",
    price_note: "850 ₽",
  });
  assert.doesNotMatch(encoded, /%D0%|%D1%/i);
  // Decode percent-encoded bytes back through windows-1251 TextDecoder:
  const decodedPairs = Object.fromEntries(
    encoded.split("&").map((pair) => {
      const [k, v = ""] = pair.split("=");
      const bytes = Uint8Array.from(
        v.replace(/\+/g, "%20").split(/(%[0-9A-Fa-f]{2})/).filter(Boolean).flatMap((tok) =>
          tok.startsWith("%") ? [Number.parseInt(tok.slice(1), 16)] : [...Buffer.from(tok, "ascii")],
        ),
      );
      return [k, decodeWin1251(bytes)];
    }),
  );
  assert.equal(decodedPairs.name, "Журнал №1 — СанПиН");
  assert.equal(decodedPairs.price_note, "850 руб.");
});

test("isWesetupDomain isolates wesetup.ru from other owner domains and parseRubAmount handles decimals", () => {
  assert.equal(isWesetupDomain("https://www.wesetup.ru/journals-info"), true);
  assert.equal(isWesetupDomain("yesbeat.ru"), false);
  assert.equal(isWesetupDomain("wesetup.ru.evil.com"), false);
  assert.equal(parseRubAmount("8 936.06 р."), 8936.06);
});

test("config/api-anything/sites/gogetlinks.json pins loginCookies and carries zero secrets", () => {
  const raw = readFileSync("config/api-anything/sites/gogetlinks.json", "utf8");
  const spec = JSON.parse(raw);
  assert.deepEqual(spec.loginCookies, ["hash", "PHPSESSID"]);
  assert.doesNotMatch(raw, /PHPSESSID=|rem_acc=|password=/i);
  assert.ok(spec.operations.some((op: { name: string }) => op.name === "listClosedCampaigns"));
  assert.ok(spec.operations.some((op: { name: string; readOnly: boolean }) => op.name === "sendThreadMessage" && op.readOnly === false));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/seo/gogetlinks-codec.test.ts`
Expected: FAIL (`Cannot find module '@/lib/seo/gogetlinks-codec'`).

- [ ] **Step 3: Install `api-anything`, update `next.config.ts`, write `gogetlinks.json`, codec & client**

1. Run `npm install api-anything@^0.3.2` and add `"api-anything"` to `serverExternalPackages` in `next.config.ts`.
2. Create `config/api-anything/sites/gogetlinks.json` seeded from the field-tested spec (`listClosedCampaigns`, `listCampaignPaidLinks`) plus `getAccountBalance`, `listActiveCampaigns`, `listReviewsByTab`, `searchDonorSites`, `listArticles`, `getArticle`, `listMessageThreads`, `getMessageThread` (`readOnly: true`, `minTier: 1`), and `createOrUpdateCampaign`, `upsertCampaignAnchors`, `uploadArticle`, `submitLinkOrder`, `sendThreadMessage`, `reviewPlacementAction` (`readOnly: false`, `minTier: 1`), validated via `parseSite`.
3. Implement `src/lib/seo/gogetlinks-codec.ts` using a complete 256-entry `windows-1251` Unicode-to-byte lookup built from `new TextDecoder("windows-1251")` over bytes `0x00..0xFF` (guaranteed exact inverse of `TextDecoder("windows-1251")` with zero external iconv dependency!).
4. Implement `src/lib/seo/gogetlinks-client.server.ts`:
   - Sets `process.env.API_ANYTHING_HOME` to `join(os.tmpdir(), "wesetup-api-anything")`, writes `config.json` (`{"share":false,"sharePrompted":true}`) and syncs `config/api-anything/sites/gogetlinks.json` → `<home>/sites/gogetlinks.json`.
   - Serializes all GoGetLinks calls through an in-process promise queue (`minIntervalMs: 1200`), optional `undici` `ProxyAgent(process.env.GGL_PROXY_URL)` passed via `fetchImpl`, decrypts `GglAccount.sessionEnc` into `<home>/sessions/gogetlinks.json` (`0600`), auto-relogins via `POST https://gogetlinks.net/user/signIn` (`e_mail`, `password`, `remember=on`, `is_ajax=true`, `X-Requested-With: XMLHttpRequest`) on `auth` failure once, persists refreshed cookies back to `GglAccount.sessionEnc`, and enforces `isWesetup === true` before any `callGglWrite`.

- [ ] **Step 4: Run tests and `parseSite` validation to verify they pass**

Run: `npx tsx --test src/lib/seo/gogetlinks-codec.test.ts`
Expected: PASS (`4` passing tests).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json next.config.ts config/api-anything/sites/gogetlinks.json src/lib/seo/gogetlinks-codec.ts src/lib/seo/gogetlinks-codec.test.ts src/lib/seo/gogetlinks-client.server.ts
git commit -m "feat(seo): add GoGetLinks api-anything spec, win1251 codec and Tier-1 client"
```

---

### Task 3: GoGetLinks Read Sync, Similarweb Baseline Seed & Account/Overview API

**Files:**
- Create: `src/lib/seo/similarweb-seed.ts`
- Create: `src/lib/seo/gogetlinks-sync.server.ts`
- Create: `src/app/api/root/gogetlinks/account/route.ts`
- Create: `src/app/api/root/gogetlinks/sync/route.ts`
- Create: `src/app/api/root/gogetlinks/overview/route.ts`
- Test: `src/lib/seo/gogetlinks-sync.test.ts`

**Interfaces:**
- Consumes: `callGglRead`, `verifyAndLoginGgl` from `src/lib/seo/gogetlinks-client.server.ts`; `normalizeCampaignRow`, `normalizeReviewRow`, `isWesetupDomain` from `src/lib/seo/gogetlinks-codec.ts`; `requireRoot`, `requireSuperRoot` from `src/lib/auth-helpers.ts`; `maskEmail` from `src/lib/platform-admin.ts`.
- Produces:
  - `ensureDefaultSimilarwebSnapshots(prismaClient?: typeof db): Promise<number>` in `src/lib/seo/similarweb-seed.ts` — idempotently upserts `Jul–Sep 2026` snapshots for `wesetup.ru` (`736/мес`, `bouncePct: 40.42`, `pagesPerVisit: 1.02`), `haccp-online.ru` (`14240/мес`, paid clusters `хассп журналы и их заполнение` `40.14%` → `/journals-info`, `бракеражный журнал готовой продукции` `17.61%` → `/zhurnal-brakerazha-gotovoy-produkcii`, `журнал проведения генеральных уборок` `16.90%` → `/zhurnal-generalnyh-uborok`, `санпин` `16.90%` → `/sanpin-2-3-2-4-4282-26`, `журналы по хассп для пищевого производства` `5.63%` → `/calc/journals`), and `checkoffice.ru` (`36287/мес`, `organicSharePct: 65.14`, `чек-лист приемки сырья в ресторане` `11.26%` → `/blog/chek-list-priemki-syrya-v-restorane`, `условия хранения продукции` `8.19%` → `/blog/usloviya-i-sroki-hraneniya-produktov-obshchepit`).
  - `reconcileSyncedOrder(existing: ExistingOrderSnapshot | null, incoming: NormalizedGglReview): OrderUpsertPlan` (pure helper exported from `gogetlinks-sync.server.ts` for unit testing) + `syncGglCabinet(opts?: { includeThreads?: boolean }): Promise<GglSyncSummary>` returning `{ syncedAt: string; balanceRub: number; availableRub: number; blockedRub: number; campaignsCount: number; ordersCount: number; newUnreadThreadIds: string[]; newOnCheckOrderIds: string[]; newReplacementOrderIds: string[] }`.
  - `ensureWesetupCampaign(input: { name?: string; maxPriceContextRub?: number; maxPriceNoteRub?: number; maxPriceArticleRub?: number; idempotencyKey: string }): Promise<GglCampaign>` — creates the initial `wesetup.ru` campaign in GoGetLinks via `createOrUpdateCampaign` if none exists yet, syncs campaigns, and sets `GglAccount.defaultCampaignId`.

- [ ] **Step 1: Write failing sync reconciliation & Similarweb seed tests**

Create `src/lib/seo/gogetlinks-sync.test.ts`:
```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SIMILARWEB_SNAPSHOTS } from "@/lib/seo/similarweb-seed";
import { reconcileSyncedOrder } from "@/lib/seo/gogetlinks-sync.server";

test("reconcileSyncedOrder preserves Wesetup human attribution on existing order and marks unknown GGL orders external_ggl", () => {
  const brandNew = reconcileSyncedOrder(null, {
    gglReviewId: 99101,
    donorDomain: "restoranoff.ru",
    priceRub: 790,
    targetUrl: "https://wesetup.ru/zhurnal-generalnyh-uborok",
    anchor: "журнал генеральных уборок",
    status: "paid",
    placementFormat: "article",
  });
  assert.equal(brandNew.origin, "external_ggl");
  assert.equal(brandNew.approvedByName, null);

  const existingScheduled = reconcileSyncedOrder(
    {
      id: "ord_1",
      gglReviewId: null,
      origin: "scheduled_wesetup",
      status: "sending",
      donorDomain: "restoranoff.ru",
      targetUrl: "https://wesetup.ru/zhurnal-generalnyh-uborok",
      initiatedByUserId: "u_seo",
      initiatedByName: "Анна SEO",
      approvedByUserId: "u_root",
      approvedByName: "Олег",
    },
    {
      gglReviewId: 99102,
      donorDomain: "restoranoff.ru",
      priceRub: 790,
      targetUrl: "https://wesetup.ru/zhurnal-generalnyh-uborok",
      anchor: "журнал генеральных уборок",
      status: "pending_webmaster",
      placementFormat: "article",
    },
  );
  assert.equal(existingScheduled.origin, "scheduled_wesetup");
  assert.equal(existingScheduled.approvedByName, "Олег");
  assert.equal(existingScheduled.gglReviewId, 99102);
  assert.equal(existingScheduled.status, "pending_webmaster");
});

test("DEFAULT_SIMILARWEB_SNAPSHOTS covers Jul–Sep 2026 audit domains and maps clusters to real wesetup.ru URLs", () => {
  assert.deepEqual(
    DEFAULT_SIMILARWEB_SNAPSHOTS.map((s) => s.domain),
    ["wesetup.ru", "haccp-online.ru", "checkoffice.ru"],
  );
  const haccp = DEFAULT_SIMILARWEB_SNAPSHOTS.find((s) => s.domain === "haccp-online.ru")!;
  assert.ok(haccp.clusters.every((c) => c.mappedTargetUrl.startsWith("/")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/seo/gogetlinks-sync.test.ts`
Expected: FAIL (`Cannot find module '@/lib/seo/similarweb-seed'`).

- [ ] **Step 3: Implement `similarweb-seed.ts`, `gogetlinks-sync.server.ts`, and `/api/root/gogetlinks/{account,sync,overview}`**

1. Implement `src/lib/seo/similarweb-seed.ts` with `DEFAULT_SIMILARWEB_SNAPSHOTS` and `ensureDefaultSimilarwebSnapshots`.
2. Implement `src/lib/seo/gogetlinks-sync.server.ts`:
   - Syncs `getAccountBalance`, `listActiveCampaigns`, `listClosedCampaigns` into `GglAccount` and `GglCampaign`.
   - Syncs `listCampaignPaidLinks` and `listReviewsByTab` (`in_progress`, `on_check`, `needs_replacement`) into `GglOrder`; matches in-flight `status: "sending"` orders by `(campaignId, donorDomain, targetUrl)` when `gglReviewId` was not yet recorded due to a prior timeout, preserving `origin`, `initiatedBy*`, and `approvedBy*`.
   - Syncs `listMessageThreads` and changed threads via `getMessageThread` into `GglThread` + `GglMessage` (matching outbound messages with `deliveryStatus: "sending"` by normalized body within 30 min so `sentByName` is preserved).
   - Emits delta IDs (`newUnreadThreadIds`, `newOnCheckOrderIds`, `newReplacementOrderIds`) strictly for `campaign.isWesetup === true`.
3. Implement routes:
   - `src/app/api/root/gogetlinks/account/route.ts`: `GET` (`requireRoot`, returns masked `email`, `status`, `balanceRub`, `availableRub`, `blockedRub`, `defaultCampaignId`, `allowSeoApproveWithinPlan`, `lastSyncedAt`, `lastError` — never `passwordEnc` or `sessionEnc`); `PUT` (`requireSuperRoot`, Zod-validated `{ email?, password?, defaultCampaignId?, allowSeoApproveWithinPlan? }`, verifies login if credentials changed, writes `AuditLog` `ggl.account.save`); `POST` (`requireSuperRoot`, calls `ensureWesetupCampaign` to create/bind the `wesetup.ru` campaign in GoGetLinks when none exists yet).
   - `src/app/api/root/gogetlinks/sync/route.ts`: `POST` (`requireRoot`, runs `syncGglCabinet()`).
   - `src/app/api/root/gogetlinks/overview/route.ts`: `GET` (`requireRoot`, seeds Similarweb baseline if empty, filters campaigns/orders/threads by `isWesetup: true` unless `?includeOtherProjects=true`).

- [ ] **Step 4: Run tests (including `platform-access.test.ts`) to verify they pass**

Run: `npx tsx --test src/lib/seo/gogetlinks-sync.test.ts src/lib/platform-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seo/similarweb-seed.ts src/lib/seo/gogetlinks-sync.server.ts src/lib/seo/gogetlinks-sync.test.ts src/app/api/root/gogetlinks/account/route.ts src/app/api/root/gogetlinks/sync/route.ts src/app/api/root/gogetlinks/overview/route.ts
git commit -m "feat(seo): add GoGetLinks read sync, Similarweb baseline seed and overview API"
```

---

### Task 4: Similarweb OCR/Import, Landing Scoring & AI Article Generator (`wesetup_ggl_article`)

**Files:**
- Modify: `dispatcher/wesetup-worker.ps1:267-276` (add `'wesetup_ggl_article'` to `$KNOWN_TYPES` — keep file 100% ASCII!)
- Modify: `docs/ai-dispatcher.md:50-60` (document `wesetup_ggl_article`)
- Create: `src/lib/seo/gogetlinks-planner.ts`
- Create: `src/lib/seo/gogetlinks-article-ai.server.ts`
- Create: `src/app/api/root/gogetlinks/similarweb/route.ts`
- Test: `src/lib/seo/gogetlinks-planner.test.ts`

**Interfaces:**
- Consumes: `enqueueAndWait` from `src/lib/ai-assistant/pf-client.ts`; `runVisionJob` from `src/lib/ai-vision/run.ts`; `isTopvisorConfigured` & positions loader from `src/lib/topvisor.ts`; `SEO_LANDINGS` from `src/content/seo-landings.ts`.
- Produces:
  - `src/lib/seo/gogetlinks-planner.ts`:
    - `scoreTargetPages(input: { clusters: CompetitorClusterInput[]; topvisorRows: TopvisorPositionInput[]; existingOrders: ExistingBacklinkInput[]; candidatePages: CandidateSitePage[] }): ScoredTargetPage[]` — prioritizes pages in Topvisor positions `4..30` («зона дожима в ТОП-3») and pages with `0` backlinks, handles `"--"` / `null` positions without `NaN`, produces Russian `selectionReason`.
    - `selectAnchorForTarget(input: { targetUrl: string; keyword: string; existingAnchors: Array<{ anchorKind: "exact" | "diluted" | "url_brand" }>; minBrandPct: number }): { anchor: string; anchorKind: "exact" | "diluted" | "url_brand" }`.
    - `selectBestDonorAndAlternatives(candidates: DonorCandidate[], usedDonorDomains: ReadonlySet<string>, filter: DonorFilter): { primary: DonorCandidate | null; alternatives: DonorCandidate[] }` — excludes any domain already in `usedDonorDomains` (`1 donor = max 1 link`), filters `priceRub <= filter.maxPricePerLinkRub`, `tf >= filter.minTfCf || cf >= filter.minTfCf`, `trust >= filter.minTrust`, `dailyTraffic >= filter.minDailyTraffic`, prefers `"article"` over `"note"` when both fit budget, ranks by `(dailyTraffic / 100 + tf + cf + trust * 3) / priceRub`, returns top 1 + up to 3 alternatives.
    - `computeScheduleDates(plan: SchedulePlanWindow, existingDates: ReadonlySet<string>, now: Date, horizonDays?: number): Array<{ scheduledDate: string; maxPriceRub: number }>` — respects `startsAt`, `budgetRub`, `maxPricePerLinkRub`, `kind` (`"one_time"` vs `"monthly"`), and `scheduleDaysOfWeek`.
  - `src/lib/seo/gogetlinks-article-ai.server.ts`:
    - `generateGglArticleDraft(input: { donorDomain: string; targetUrl: string; targetPageTitle: string; targetPageFacts: string[]; targetKeyword: string; anchor: string; placementFormat: "article" | "note" }): Promise<GeneratedGglContent>`
    - `extractSimilarwebSnapshotFromImages(input: { images: Uint8Array[]; user: { id: string; name?: string | null } }): Promise<ParsedSimilarwebSnapshot>`

- [ ] **Step 1: Write failing planner, anchor-mix, donor dedupe & worker ASCII tests (covering Review Focus #5)**

Create `src/lib/seo/gogetlinks-planner.test.ts`:
```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeScheduleDates,
  scoreTargetPages,
  selectAnchorForTarget,
  selectBestDonorAndAlternatives,
} from "@/lib/seo/gogetlinks-planner";

test("Review Focus #5: scoreTargetPages handles Topvisor '--' without NaN and boosts positions 4-30 with 0 links", () => {
  const ranked = scoreTargetPages({
    clusters: [
      { domain: "haccp-online.ru", phrase: "бракеражный журнал готовой продукции", trafficSharePct: 17.61, channel: "paid", mappedTargetUrl: "/zhurnal-brakerazha-gotovoy-produkcii" },
      { domain: "checkoffice.ru", phrase: "чек-лист приемки сырья", trafficSharePct: 11.26, channel: "organic", mappedTargetUrl: "/blog/chek-list-priemki-syrya-v-restorane" },
    ],
    topvisorRows: [
      { phrase: "бракеражный журнал готовой продукции", yandexPos: "11", googlePos: "--", relevantUrl: "/zhurnal-brakerazha-gotovoy-produkcii" },
      { phrase: "чек-лист приемки сырья", yandexPos: "--", googlePos: "--", relevantUrl: "/blog/old-slug" },
    ],
    existingOrders: [],
    candidatePages: [
      { url: "/zhurnal-brakerazha-gotovoy-produkcii", title: "Бракеражный журнал готовой продукции" },
      { url: "/blog/chek-list-priemki-syrya-v-restorane", title: "Чек-лист приёмки сырья в ресторане" },
    ],
  });
  assert.equal(ranked.length, 2);
  assert.ok(ranked.every((r) => Number.isFinite(r.score)));
  assert.equal(ranked[0].targetUrl, "/zhurnal-brakerazha-gotovoy-produkcii");
  assert.match(ranked[0].selectionReason, /17\.61%.*11/);
});

test("Review Focus #5: selectAnchorForTarget prevents exact-anchor over-optimization and enforces >= 50% brand/URL mix", () => {
  const first = selectAnchorForTarget({
    targetUrl: "https://wesetup.ru/zhurnal-brakerazha-gotovoy-produkcii",
    keyword: "бракеражный журнал готовой продукции",
    existingAnchors: [{ anchorKind: "exact" }],
    minBrandPct: 50,
  });
  assert.equal(first.anchorKind, "url_brand");
});

test("selectBestDonorAndAlternatives excludes used domains (1 donor = 1 link) and caps at maxPricePerLinkRub", () => {
  const res = selectBestDonorAndAlternatives(
    [
      { siteId: 1, domain: "used-horeca.ru", priceArticleRub: 700, priceNoteRub: 600, tf: 20, cf: 25, trust: 7, dailyTraffic: 1500, indexedYandex: true, indexedGoogle: true },
      { siteId: 2, domain: "expensive.ru", priceArticleRub: 1500, priceNoteRub: 1400, tf: 30, cf: 30, trust: 9, dailyTraffic: 5000, indexedYandex: true, indexedGoogle: true },
      { siteId: 3, domain: "food-safety.ru", priceArticleRub: 850, priceNoteRub: 750, tf: 16, cf: 22, trust: 6, dailyTraffic: 900, indexedYandex: true, indexedGoogle: true },
      { siteId: 4, domain: "obshchepit-news.ru", priceArticleRub: null, priceNoteRub: 800, tf: 14, cf: 19, trust: 5, dailyTraffic: 700, indexedYandex: true, indexedGoogle: true },
    ],
    new Set(["used-horeca.ru"]),
    { maxPricePerLinkRub: 1000, minTfCf: 10, minTrust: 4, minDailyTraffic: 100, allowedFormats: ["article", "note"] },
  );
  assert.equal(res.primary?.domain, "food-safety.ru");
  assert.equal(res.alternatives.length, 1);
  assert.equal(res.alternatives[0].domain, "obshchepit-news.ru");
});

test("computeScheduleDates respects 10 000 ₽ one_time cap and startsAt", () => {
  const slots = computeScheduleDates(
    { kind: "one_time", budgetRub: 10000, maxPricePerLinkRub: 1000, startsAt: new Date("2026-11-06T00:00:00Z"), scheduleDaysOfWeek: [2, 5], alreadyCommittedRub: 8000 },
    new Set(["2026-11-06"]),
    new Date("2026-11-05T12:00:00Z"),
    30,
  );
  // Remaining budget 2 000 ₽ at max 1 000 ₽/link => at most 2 new slots, skipping already scheduled 2026-11-06:
  assert.equal(slots.length, 2);
  assert.ok(!slots.some((s) => s.scheduledDate === "2026-11-06"));
});

test("dispatcher/wesetup-worker.ps1 registers wesetup_ggl_article and remains strictly ASCII-only", () => {
  const ps1 = readFileSync("dispatcher/wesetup-worker.ps1", "utf8");
  assert.match(ps1, /'wesetup_ggl_article'/);
  assert.equal(/[^\x00-\x7F]/.test(ps1), false, "wesetup-worker.ps1 must stay ASCII-only for PowerShell 5.1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/seo/gogetlinks-planner.test.ts`
Expected: FAIL (`Cannot find module '@/lib/seo/gogetlinks-planner'`).

- [ ] **Step 3: Implement `gogetlinks-planner.ts`, `gogetlinks-article-ai.server.ts`, worker registration & `/api/root/gogetlinks/similarweb`**

1. Add `'wesetup_ggl_article'` to `$KNOWN_TYPES` in `dispatcher/wesetup-worker.ps1` (ASCII-only!) and add a row to the job table in `docs/ai-dispatcher.md`.
2. Implement pure scoring, anchor-mix, donor selection, and date scheduling in `src/lib/seo/gogetlinks-planner.ts`.
3. Implement `src/lib/seo/gogetlinks-article-ai.server.ts`:
   - `generateGglArticleDraft`: builds a `type: wesetup_ggl_article` self-contained instruction embedding `<page_context>` with real `wesetup.ru` page headings/facts and current SanPiN `2.3/2.4.3590-20` / `4282-26` guardrails ("do not invent regulation numbers or features outside `<page_context>`"), calls `enqueueAndWait`, strips optional markdown code fences, validates `{ title, announcement, bodyHtml, metaTitle, metaDescription, metaKeywords, briefText }` with Zod, and verifies the exact `anchor` + `https://wesetup.ru${targetUrl}` link appears inside `bodyHtml` when `placementFormat === "article"`.
   - `extractSimilarwebSnapshotFromImages`: uses existing `VISION_JOB_TYPE` (`wesetup_vision_extract`) signed image pipeline (`saveVisionImage` → `signedVisionImageUrl` → `buildVisionJobText` → `enqueueAndWait` → `deleteVisionImages` in `finally`) to parse Similarweb screenshot metrics & keyword clusters into `SeoCompetitorSnapshot` shape.
4. Implement `src/app/api/root/gogetlinks/similarweb/route.ts` (`GET`: snapshots + `scoreTargetPages` priority matrix; `POST`: accepts JSON snapshot from agent/manual form OR `multipart/form-data` screenshot upload, saves `SeoCompetitorSnapshot`, logs `AuditLog` `ggl.similarweb.import`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/seo/gogetlinks-planner.test.ts src/lib/platform-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dispatcher/wesetup-worker.ps1 docs/ai-dispatcher.md src/lib/seo/gogetlinks-planner.ts src/lib/seo/gogetlinks-planner.test.ts src/lib/seo/gogetlinks-article-ai.server.ts src/app/api/root/gogetlinks/similarweb/route.ts
git commit -m "feat(seo): add Similarweb/Topvisor link planner, OCR import and wesetup_ggl_article job"
```

---

### Task 5: Webmaster Two-Way Chats & Placement Review Actions

**Files:**
- Create: `src/lib/seo/gogetlinks-chat.server.ts`
- Create: `src/app/api/root/gogetlinks/threads/route.ts`
- Create: `src/app/api/root/gogetlinks/threads/[id]/route.ts`
- Create: `src/app/api/root/gogetlinks/orders/[id]/review/route.ts`
- Test: `src/lib/seo/gogetlinks-chat.test.ts`

**Interfaces:**
- Consumes: `callGglRead`, `callGglWrite` from `src/lib/seo/gogetlinks-client.server.ts`; `db` from `src/lib/db.ts`; `requireRoot` from `src/lib/auth-helpers.ts`.
- Produces:
  - `replyToGglThread(input: { threadId: string; body: string; idempotencyKey: string; user: { id: string; name: string } }, deps?: ChatServiceDeps): Promise<GglMessageDto>`
  - `reviewGglPlacement(input: { orderId: string; action: "accept" | "request_revision"; comment?: string; idempotencyKey: string; user: { id: string; name: string } }, deps?: ChatServiceDeps): Promise<GglOrderDto>`

- [ ] **Step 1: Write failing chat idempotency, mid-flight timeout & `isWesetup` guard tests (covering Review Focus #3)**

Create `src/lib/seo/gogetlinks-chat.test.ts`:
```ts
import assert from "node:assert/strict";
import test from "node:test";
import { replyToGglThread, reviewGglPlacement } from "@/lib/seo/gogetlinks-chat.server";

test("Review Focus #3: replyToGglThread deduplicates same idempotencyKey and keeps 'sending' on uncertain network outcome", async () => {
  let networkCalls = 0;
  const store = new Map<string, { id: string; deliveryStatus: string; sentByName: string }>();
  const deps = {
    findThread: async () => ({ id: "th_1", gglThreadKey: "rev_77", campaignId: "c_ws", campaignIsWesetup: true }),
    claimOutboundMessage: async (key: string, user: { name: string }) => {
      const existing = store.get(key);
      if (existing) return { claimed: false as const, message: existing };
      const msg = { id: "m_1", deliveryStatus: "sending", sentByName: user.name };
      store.set(key, msg);
      return { claimed: true as const, message: msg };
    },
    markMessageStatus: async (key: string, status: string) => {
      store.get(key)!.deliveryStatus = status;
    },
    sendRemote: async () => {
      networkCalls += 1;
      return { status: "may_have_applied" as const, data: null };
    },
    writeAudit: async () => {},
  };

  const first = await replyToGglThread(
    { threadId: "th_1", body: "Добрый день, поправьте анкор, пожалуйста.", idempotencyKey: "k-1", user: { id: "u1", name: "Анна" } },
    deps,
  );
  const duplicate = await replyToGglThread(
    { threadId: "th_1", body: "Добрый день, поправьте анкор, пожалуйста.", idempotencyKey: "k-1", user: { id: "u1", name: "Анна" } },
    deps,
  );

  assert.equal(networkCalls, 1, "second call with same idempotencyKey must not re-send");
  assert.equal(first.deliveryStatus, "sending", "ambiguous network result stays 'sending' until sync confirms");
  assert.equal(duplicate.sentByName, "Анна");
});

test("reviewGglPlacement rejects non-wesetup.ru orders before calling GoGetLinks", async () => {
  await assert.rejects(
    () =>
      reviewGglPlacement(
        { orderId: "ord_yesbeat", action: "accept", idempotencyKey: "rev-1", user: { id: "u1", name: "Олег" } },
        {
          findOrder: async () => ({ id: "ord_yesbeat", gglReviewId: 501, status: "on_check", campaignId: "c_yb", campaignIsWesetup: false }),
          reviewRemote: async () => {
            throw new Error("must not be called");
          },
          updateOrderStatus: async () => {},
          writeAudit: async () => {},
        },
      ),
    /wesetup\.ru/i,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/seo/gogetlinks-chat.test.ts`
Expected: FAIL (`Cannot find module '@/lib/seo/gogetlinks-chat.server'`).

- [ ] **Step 3: Implement `gogetlinks-chat.server.ts` and chat/review API routes**

1. Implement `src/lib/seo/gogetlinks-chat.server.ts` with default Prisma + `callGglWrite` dependencies:
   - Rejects writes on threads/orders whose campaign has `isWesetup === false`.
   - Claims `GglMessage` via `idempotencyKey` (`deliveryStatus: "sending"`, `sentByUserId`, `sentByName`) before calling `sendThreadMessage`; marks `"synced"` on `applied`/`accepted`, keeps `"sending"` on `may_have_applied`, marks `"failed"` only when GoGetLinks explicitly answered `not_sent`/`not_applied`; writes `AuditLog` (`ggl.message.reply`).
   - `reviewGglPlacement` requires `comment` (`>= 5` chars) when `action === "request_revision"`, calls `reviewPlacementAction`, updates `GglOrder.status` (`"paid"` on accept, `"in_progress"` on revision), and logs `ggl.order.accept` / `ggl.order.request_revision`.
2. Implement routes (`requireRoot`, Zod validation):
   - `src/app/api/root/gogetlinks/threads/route.ts` (`GET`: filters `onlyUnread`, `needsReply`, `includeOtherProjects`).
   - `src/app/api/root/gogetlinks/threads/[id]/route.ts` (`GET`: refreshes thread from GoGetLinks + returns DB messages with `sentByName` & linked `GglOrder`; `POST`: calls `replyToGglThread`).
   - `src/app/api/root/gogetlinks/orders/[id]/review/route.ts` (`POST`: calls `reviewGglPlacement`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/seo/gogetlinks-chat.test.ts src/lib/platform-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seo/gogetlinks-chat.server.ts src/lib/seo/gogetlinks-chat.test.ts src/app/api/root/gogetlinks/threads/route.ts src/app/api/root/gogetlinks/threads/[id]/route.ts src/app/api/root/gogetlinks/orders/[id]/review/route.ts
git commit -m "feat(seo): add two-way GoGetLinks webmaster chats and placement review API"
```

---

### Task 6: Purchase Scheduler Engine, Human Slot Approval, Donor Swap & Rollback

**Files:**
- Create: `src/lib/seo/gogetlinks-orders.server.ts`
- Create: `src/app/api/root/gogetlinks/plans/route.ts`
- Create: `src/app/api/root/gogetlinks/slots/[id]/route.ts`
- Create: `src/app/api/root/gogetlinks/slots/[id]/approve/route.ts`
- Create: `src/app/api/root/gogetlinks/orders/route.ts`
- Test: `src/lib/seo/gogetlinks-orders.test.ts`

**Interfaces:**
- Consumes: `canApproveGglSpend` from `src/lib/seo/gogetlinks-access.ts`; `scoreTargetPages`, `selectAnchorForTarget`, `selectBestDonorAndAlternatives`, `computeScheduleDates` from `src/lib/seo/gogetlinks-planner.ts`; `generateGglArticleDraft` from `src/lib/seo/gogetlinks-article-ai.server.ts`; `callGglRead`, `callGglWrite` from `src/lib/seo/gogetlinks-client.server.ts`.
- Produces (`src/lib/seo/gogetlinks-orders.server.ts`):
  - `upsertSchedulePlan(input: UpsertPlanInput, actor: PlatformActor): Promise<GglSchedulePlan>`
  - `materializePlanSlots(now?: Date): Promise<{ created: number }>`
  - `prepareUpcomingPlannedSlots(now?: Date, horizonDays?: number): Promise<{ prepared: number; skipped: number }>` — stops strictly at `status = "pending_approval"`.
  - `recycleRejectedSlotOrders(deps?: RecycleDeps): Promise<{ recycledSlotIds: string[] }>` — promotes next donor from `alternativeDonorsJson` and resets slot to `"pending_approval"` when linked `GglOrder.status === "rejected"`.
  - `approvePlannedSlot(input: { slotId: string; idempotencyKey: string; actor: PlatformActor }, deps?: ApproveSlotDeps): Promise<{ slotStatus: string; orderId?: string }>`
  - `createManualGglOrder(input: ManualOrderInput, actor: PlatformActor): Promise<{ orderId: string }>`
  - `mutatePlannedSlot(input: { slotId: string; action: "skip" | "swap_donor" | "update_article"; donorSiteId?: number; articlePatch?: ArticlePatch; actor: PlatformActor }): Promise<GglPlannedSlot>`

- [ ] **Step 1: Write failing approval concurrency, live price/balance/domain guard & rejected-order fallback tests (covering Review Focus #3 & #4)**

Create `src/lib/seo/gogetlinks-orders.test.ts`:
```ts
import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_SECTION_KEYS } from "@/lib/platform-access";
import { approvePlannedSlot, recycleRejectedSlotOrders } from "@/lib/seo/gogetlinks-orders.server";

const adminActor = { id: "u_root", name: "Олег", isRoot: true, platformSections: [...PLATFORM_SECTION_KEYS] };

test("Review Focus #3: concurrent approvePlannedSlot rejects second click with 409 and timeout stays approved_sending", async () => {
  let slotStatus = "pending_approval";
  let submitCalls = 0;
  const deps = {
    getAccountConfig: async () => ({ allowSeoApproveWithinPlan: false, availableRub: 8936.06 }),
    claimSlotForSend: async () => {
      if (slotStatus !== "pending_approval") return null;
      slotStatus = "approved_sending";
      return {
        id: "slot_1",
        maxPriceRub: 900,
        donorSiteId: 404,
        donorDomain: "food-safety.ru",
        placementFormat: "note" as const,
        targetUrl: "/zhurnal-generalnyh-uborok",
        anchor: "wesetup.ru",
        briefText: "Заметка про СанПиН",
        campaign: { id: "c_ws", gglCampaignId: 200001, isWesetup: true },
        article: null,
      };
    },
    fetchLiveDonorPrice: async () => 850,
    ensureTargetAnchorInGgl: async () => {},
    uploadArticleIfNeeded: async () => null,
    submitRemoteOrder: async () => {
      submitCalls += 1;
      return { status: "may_have_applied" as const, gglReviewId: null };
    },
    finalizeSlotOrder: async (_slotId: string, nextSlotStatus: string) => {
      slotStatus = nextSlotStatus;
      return "ord_new";
    },
    revertSlotToPending: async () => {
      slotStatus = "pending_approval";
    },
    writeAudit: async () => {},
  };

  const [first, second] = await Promise.allSettled([
    approvePlannedSlot({ slotId: "slot_1", idempotencyKey: "ap-1", actor: adminActor }, deps),
    approvePlannedSlot({ slotId: "slot_1", idempotencyKey: "ap-2", actor: adminActor }, deps),
  ]);

  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  assert.match(String((second as PromiseRejectedResult).reason), /409|уже отправляется/i);
  assert.equal(submitCalls, 1);
  assert.equal(slotStatus, "approved_sending", "uncertain network write must stay approved_sending until sync");
});

test("Review Focus #4: approvePlannedSlot aborts with 0 spend on donor price hike, low balance, or non-wesetup campaign", async () => {
  let submitCalled = false;
  let reverted = false;
  await assert.rejects(
    () =>
      approvePlannedSlot(
        { slotId: "slot_hike", idempotencyKey: "ap-hike", actor: adminActor },
        {
          getAccountConfig: async () => ({ allowSeoApproveWithinPlan: false, availableRub: 8936.06 }),
          claimSlotForSend: async () => ({
            id: "slot_hike",
            maxPriceRub: 900,
            donorSiteId: 404,
            donorDomain: "food-safety.ru",
            placementFormat: "article" as const,
            targetUrl: "/zhurnal-generalnyh-uborok",
            anchor: "журнал генеральных уборок",
            briefText: null,
            campaign: { id: "c_ws", gglCampaignId: 200001, isWesetup: true },
            article: { id: "art_1", gglArticleId: null, title: "T", announcement: "A", bodyHtml: "<p>B</p>" },
          }),
          fetchLiveDonorPrice: async () => 1200, // hiked above 900 ₽!
          ensureTargetAnchorInGgl: async () => {},
          uploadArticleIfNeeded: async () => null,
          submitRemoteOrder: async () => {
            submitCalled = true;
            return { status: "applied" as const, gglReviewId: 1 };
          },
          finalizeSlotOrder: async () => "ord_x",
          revertSlotToPending: async () => {
            reverted = true;
          },
          writeAudit: async () => {},
        },
      ),
    /цена донора выросла.*1200.*900/i,
  );
  assert.equal(submitCalled, false);
  assert.equal(reverted, true, "pre-send guard failure safely returns slot to pending_approval");
});

test("recycleRejectedSlotOrders swaps next alternative donor and returns slot to pending_approval", async () => {
  const updated: Array<{ slotId: string; donorDomain: string; status: string }> = [];
  const res = await recycleRejectedSlotOrders({
    findRejectedLinkedSlots: async () => [
      {
        slotId: "slot_r1",
        alternativeDonors: [
          { siteId: 77, domain: "backup-horeca.ru", priceRub: 820, format: "article", metrics: { tf: 15, cf: 20, trust: 6, dailyTraffic: 800 } },
        ],
      },
    ],
    applyFallbackDonor: async (slotId, nextDonor) => {
      updated.push({ slotId, donorDomain: nextDonor.domain, status: "pending_approval" });
    },
  });
  assert.deepEqual(res.recycledSlotIds, ["slot_r1"]);
  assert.equal(updated[0].donorDomain, "backup-horeca.ru");
  assert.equal(updated[0].status, "pending_approval");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/seo/gogetlinks-orders.test.ts`
Expected: FAIL (`Cannot find module '@/lib/seo/gogetlinks-orders.server'`).

- [ ] **Step 3: Implement `gogetlinks-orders.server.ts` and plans/slots/orders API routes**

1. Implement `src/lib/seo/gogetlinks-orders.server.ts` enforcing:
   - `canApproveGglSpend` on `upsertSchedulePlan` (`withinApprovedPlan: false`), `approvePlannedSlot` (`withinApprovedPlan: true`), and `createManualGglOrder` (`withinApprovedPlan: false`).
   - Atomic `db.gglPlannedSlot.updateMany({ where: { id: slotId, status: "pending_approval" }, data: { status: "approved_sending", approvedByUserId: actor.id, approvedByName: actor.name, approvedAt: new Date() } })` — if `count === 0`, throws HTTP `409` error.
   - Pre-send verification (`campaign.isWesetup === true`, live donor price `<= slot.maxPriceRub`, `account.availableRub >= livePrice`); if pre-send verification fails before any write left Node, reverts slot to `pending_approval` with explanation and throws `422`.
   - Uploads `GglArticle` (`uploadArticle`) or registers `{ targetUrl, anchor }` (`upsertCampaignAnchors`), submits `submitLinkOrder`, creates `GglOrder` (`origin: "scheduled_wesetup"`, `status: "pending_webmaster"` or `"sending"` if `may_have_applied`), transitions slot to `"ordered"` (or keeps `"approved_sending"` if `may_have_applied`), writes `AuditLog` (`ggl.plan.update`, `ggl.slot.approve`, `ggl.slot.skip`, `ggl.order.manual_create`).
2. Implement API routes (`requireRoot` + `platformViewerForSession` actor resolution, Zod v4 schemas):
   - `src/app/api/root/gogetlinks/plans/route.ts` (`GET`, `POST`)
   - `src/app/api/root/gogetlinks/slots/[id]/route.ts` (`PATCH`)
   - `src/app/api/root/gogetlinks/slots/[id]/approve/route.ts` (`POST`)
   - `src/app/api/root/gogetlinks/orders/route.ts` (`GET`, `POST`)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/seo/gogetlinks-orders.test.ts src/lib/platform-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seo/gogetlinks-orders.server.ts src/lib/seo/gogetlinks-orders.test.ts src/app/api/root/gogetlinks/plans/route.ts src/app/api/root/gogetlinks/slots/[id]/route.ts src/app/api/root/gogetlinks/slots/[id]/approve/route.ts src/app/api/root/gogetlinks/orders/route.ts
git commit -m "feat(seo): add GoGetLinks scheduler, human slot approval and donor fallback"
```

---

### Task 7: Cron `/api/cron/gogetlinks` & Tiered Admin/SEO Notifications

**Files:**
- Create: `src/lib/seo/gogetlinks-cron.server.ts`
- Create: `src/app/api/cron/gogetlinks/route.ts`
- Test: `src/lib/seo/gogetlinks-cron.test.ts`

**Interfaces:**
- Consumes: `checkCronSecret` from `src/lib/cron-auth.ts`; `notifyPlatformAdmin` from `src/lib/platform-admin.ts`; `sendTelegramMessage` from `src/lib/telegram.ts`; `syncGglCabinet` from `src/lib/seo/gogetlinks-sync.server.ts`; `materializePlanSlots`, `prepareUpcomingPlannedSlots`, `recycleRejectedSlotOrders` from `src/lib/seo/gogetlinks-orders.server.ts`.
- Produces:
  - `runGglCronPass(deps?: GglCronDeps): Promise<GglCronResult>` in `src/lib/seo/gogetlinks-cron.server.ts` (`{ skipped: boolean; reason?: string; synced?: boolean; operationalAlertsSent: number; lowBalanceAlertSent: boolean }`).

- [ ] **Step 1: Write failing cron lock & notification routing tests**

Create `src/lib/seo/gogetlinks-cron.test.ts`:
```ts
import assert from "node:assert/strict";
import test from "node:test";
import { runGglCronPass } from "@/lib/seo/gogetlinks-cron.server";

test("runGglCronPass routes operational alerts to admins + seo specialists, and low-balance alerts ONLY to platform admins", async () => {
  const adminAlerts: string[] = [];
  const seoSpecialistAlerts: string[] = [];

  const result = await runGglCronPass({
    hasConfiguredAccount: async () => true,
    syncCabinet: async () => ({
      syncedAt: "2026-11-05T10:00:00Z",
      balanceRub: 1200,
      availableRub: 1200,
      blockedRub: 0,
      campaignsCount: 1,
      ordersCount: 3,
      newUnreadThreadIds: ["th_1"],
      newOnCheckOrderIds: ["ord_2"],
      newReplacementOrderIds: [],
    }),
    recycleRejected: async () => ({ recycledSlotIds: [] }),
    materializeSlots: async () => ({ created: 2 }),
    prepareSlots: async () => ({ prepared: 1, skipped: 0 }),
    getPendingSlotsSummary: async () => ({ dueTodayCount: 1, next7DaysSumRub: 2700, dateKey: "2026-11-05" }),
    wasAlertSentRecently: async () => false,
    notifyAdmins: async (text) => {
      adminAlerts.push(text);
      return true;
    },
    notifyDelegatedSeoUsers: async (text) => {
      seoSpecialistAlerts.push(text);
      return true;
    },
  });

  assert.equal(result.skipped, false);
  assert.equal(result.lowBalanceAlertSent, true);
  assert.equal(seoSpecialistAlerts.length, 1, "seo specialist gets operational alert only");
  assert.doesNotMatch(seoSpecialistAlerts[0], /пополнить баланс/i);
  assert.equal(adminAlerts.length, 2, "platform admins get both operational alert and financial low-balance warning");
  assert.match(adminAlerts[1], /1\s?200.*2\s?700/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/seo/gogetlinks-cron.test.ts`
Expected: FAIL (`Cannot find module '@/lib/seo/gogetlinks-cron.server'`).

- [ ] **Step 3: Implement `gogetlinks-cron.server.ts` and `/api/cron/gogetlinks/route.ts`**

1. Implement `src/lib/seo/gogetlinks-cron.server.ts`:
   - Guards against overlapping runs via module-level active-run flag (returns `{ skipped: true, reason: "already_running", ... }`), and exits cleanly if no `GglAccount` is configured yet.
   - Executes `syncGglCabinet()` → `recycleRejectedSlotOrders()` → `materializePlanSlots()` → `prepareUpcomingPlannedSlots()` sequentially.
   - Deduplicates alerts via `TelegramLog` (`kind` + `dedupeKey`, 24h window for low-balance and due-today slot alerts).
   - Operational alerts (unread webmaster replies, `on_check` placements, `needs_replacement` on `wesetup.ru`, due `pending_approval` slots) go to `notifyPlatformAdmin` + active non-archived users who have `"seo"` in `platformSections` (without being full platform admins, so no duplicate sends).
   - Financial low-balance alert (`next7DaysSumRub > availableRub`) goes **only** to `notifyPlatformAdmin`.
2. Implement `src/app/api/cron/gogetlinks/route.ts` matching `src/app/api/cron/max-channel/route.ts` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, `checkCronSecret(request)`, `GET` & `POST`, crontab comment `*/10 * * * *`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/seo/gogetlinks-cron.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seo/gogetlinks-cron.server.ts src/lib/seo/gogetlinks-cron.test.ts src/app/api/cron/gogetlinks/route.ts
git commit -m "feat(seo): add 10-minute GoGetLinks cron and tiered admin/SEO notifications"
```

---

### Task 8: Admin UI `/root/seo/links`, SEO Sub-Navigation & Proof-Loop Verification

**Files:**
- Create: `src/components/root/seo-subnav.tsx`
- Modify: `src/app/root/seo/page.tsx:21-33`
- Modify: `src/app/root/seo/positions/page.tsx:48-60`
- Create: `src/app/root/seo/links/page.tsx`
- Create: `src/app/root/seo/links/links-client.tsx`
- Create: `src/components/root/seo-links/SeoLinksHeaderMetrics.tsx`
- Create: `src/components/root/seo-links/PlannerTab.tsx`
- Create: `src/components/root/seo-links/OrdersRegistryTab.tsx`
- Create: `src/components/root/seo-links/ChatsTab.tsx`
- Create: `src/components/root/seo-links/DemandAndAccountTab.tsx`
- Create: `src/components/root/seo-links/ArticleDrawer.tsx`
- Create: `src/lib/seo/gogetlinks-ui-format.ts`
- Test: `src/lib/seo/gogetlinks-ui-format.test.ts`
- Create: `.agent/tasks/gogetlinks-seo-links-2026-11/evidence.md` and `.agent/tasks/gogetlinks-seo-links-2026-11/evidence.json`

**Interfaces:**
- Consumes: `/api/root/gogetlinks/{overview,account,sync,plans,slots/[id],slots/[id]/approve,orders,orders/[id]/review,threads,threads/[id],similarweb}` from Tasks 3–6; `requireRoot` from `src/lib/auth-helpers.ts`; `platformViewerForSession` from `src/lib/platform-access.server.ts`; `canApproveGglSpend` from `src/lib/seo/gogetlinks-access.ts`.
- Produces:
  - `SeoSubnav` (`active: "health" | "positions" | "links"`, `linksBadgeCount?: number`) in `src/components/root/seo-subnav.tsx`.
  - `formatOrderAttribution(order: { origin: string; initiatedByName?: string | null; approvedByName?: string | null }): { primary: string; secondary?: string; badgeTone: "indigo" | "emerald" | "slate" }` in `src/lib/seo/gogetlinks-ui-format.ts` (`"manual_wesetup"` → `initiatedByName`, `"scheduled_wesetup"` → `"По плану · подтв. <approvedByName>"`, `"external_ggl"` → `"Из кабинета GoGetLinks"`).
  - `/root/seo/links` server page & 4-tab client workspace matching `/root/seo` visual tokens (`border-[#dcdfed]`, `#5566f6`, `#eef1ff`, `#0b1024`, `#6f7282`).

- [ ] **Step 1: Write failing attribution & badge formatting test**

Create `src/lib/seo/gogetlinks-ui-format.test.ts`:
```ts
import assert from "node:assert/strict";
import test from "node:test";
import { formatOrderAttribution } from "@/lib/seo/gogetlinks-ui-format";

test("formatOrderAttribution renders transparent Russian labels for manual, scheduled and external GGL orders", () => {
  assert.equal(
    formatOrderAttribution({ origin: "scheduled_wesetup", initiatedByName: "Анна", approvedByName: "Олег" }).primary,
    "По плану · подтв. Олег",
  );
  assert.equal(
    formatOrderAttribution({ origin: "manual_wesetup", initiatedByName: "Олег", approvedByName: "Олег" }).primary,
    "Олег (вручную)",
  );
  assert.equal(
    formatOrderAttribution({ origin: "external_ggl", initiatedByName: null, approvedByName: null }).primary,
    "Из кабинета GoGetLinks",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/seo/gogetlinks-ui-format.test.ts`
Expected: FAIL (`Cannot find module '@/lib/seo/gogetlinks-ui-format'`).

- [ ] **Step 3: Implement `gogetlinks-ui-format.ts`, `SeoSubnav`, `/root/seo/links` and all 4 tab components**

1. Implement `src/lib/seo/gogetlinks-ui-format.ts` (`formatOrderAttribution`, `formatSlotStatusBadge`, `formatOrderStatusBadge`, `formatRub`).
2. Create `src/components/root/seo-subnav.tsx` (`Здоровье` `/root/seo`, `Позиции` `/root/seo/positions`, `Ссылки` `/root/seo/links` with `Link2` icon and pill badge when `unreadThreads + pendingApprovalSlots > 0`) and wire it into `src/app/root/seo/page.tsx`, `src/app/root/seo/positions/page.tsx`, and `src/app/root/seo/links/page.tsx`.
3. Build `src/app/root/seo/links/page.tsx` (`await requireRoot()`, resolves viewer capabilities `{ isSuperadmin, canApproveWithinPlan, canManagePlans }`) + `links-client.tsx` and the 6 focused components under `src/components/root/seo-links/`:
   - `SeoLinksHeaderMetrics.tsx`: Available balance `₽` + 7-day coverage indicator, Month spend vs Plan (`X ₽ из Y ₽`), Active / In work / On check counters, Unread webmaster messages, «Синхронизировать сейчас» button (`sonner` toast), read-only toggle «Показать архив других проектов аккаунта (только чтение)».
   - `PlannerTab.tsx`: Default tab when `pending_approval` slots exist; schedule plan settings card (`one_time` e.g. `10 000 ₽` & `monthly` e.g. `5 000 ₽/мес`, `maxPricePerLinkRub`, `startsAt`, days of week, donor thresholds, pause/resume — editable when `canManagePlans`), 30-day calendar table with `selectionReason` tooltip/subtext, donor metrics + «Сменить донора», `ArticleDrawer.tsx` slide-over for inspecting/editing `title`/`announcement`/`bodyHtml`/`anchor`, and 1-click «Подтвердить закупку» (enabled when `canApproveWithinPlan`) / «Пропустить».
   - `OrdersRegistryTab.tsx`: Filterable table (`На проверке`, `В работе`, `Оплачено`, `На замену`, initiator filter) + «Разовая закупка» modal (`POST /api/root/gogetlinks/orders`, enabled when `canManagePlans`), columns for donor & published URL, target URL & anchor, `TF/CF` & traffic, spend `₽`, **«Кто купил»** (`formatOrderAttribution`), status & date, «Чат» jump button, inline `Принять` / `На доработку` actions.
   - `ChatsTab.tsx`: 2-column messenger — left thread list sorted by `needsReply` / `unreadCount` / `lastMessageAt`, right message feed with `sentByName` attribution on outbound replies, order context header bar, and reply composer.
   - `DemandAndAccountTab.tsx`: Similarweb snapshots list + «Распознать скриншот Similarweb» file button + `Кластер Similarweb × Позиция Topvisor × Куплено ссылок → Приоритет` matrix + GoGetLinks connection card (read-only status for `"seo"`, credential & `allowSeoApproveWithinPlan` form + 1-click «Создать кампанию wesetup.ru в GoGetLinks» button for `isSuperadmin`).

- [ ] **Step 4: Run full verification suite and generate proof-loop evidence (`AC1`–`AC8`)**

Run all checks sequentially and save raw command outputs under `.agent/tasks/gogetlinks-seo-links-2026-11/raw/`:
1. `npx tsx --test src/lib/seo/*.test.ts src/lib/platform-access.test.ts`
2. `npm run i18n:check`
3. `npm run typecheck`
4. `npm run test:gate`
5. `npx eslint src/lib/seo src/lib/platform-access.ts src/app/root/seo src/app/api/root/gogetlinks src/app/api/cron/gogetlinks src/components/root/seo-subnav.tsx src/components/root/seo-links`

Expected: EXIT `0` on every command (`0` errors, `0` new test failures). Write `.agent/tasks/gogetlinks-seo-links-2026-11/evidence.md` and `.agent/tasks/gogetlinks-seo-links-2026-11/evidence.json` mapping every `AC1`–`AC8` to its concrete test/command result.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seo/gogetlinks-ui-format.ts src/lib/seo/gogetlinks-ui-format.test.ts src/components/root/seo-subnav.tsx src/app/root/seo/page.tsx src/app/root/seo/positions/page.tsx src/app/root/seo/links/page.tsx src/app/root/seo/links/links-client.tsx src/components/root/seo-links .agent/tasks/gogetlinks-seo-links-2026-11
git commit -m "feat(seo): build /root/seo/links workspace, subnav badges and proof-loop evidence"
```
