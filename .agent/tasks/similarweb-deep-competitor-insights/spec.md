# Task Spec: Deep Similarweb Competitor Insights, Auto-Check on Filter & AI Agent Step-by-Step Progress Loader

## Task ID
`similarweb-deep-competitor-insights`

## Objective
1. **Expand Similarweb Competitor Intelligence on `/root/seo/competitors`** (`SimilarwebCompetitorsWorkspace.tsx`, `src/lib/seo/similarweb-client.ts`, `src/lib/seo/similarweb-client.server.ts`, `src/lib/seo/similarweb-seed.ts`, `config/api-anything/sites/similarweb.json`):
   - Full Similarweb telemetry (`avgVisitDurationSec`, `visitsTrendPct`, `brandedSharePct`/`nonBrandedSharePct`, `globalRank`, `countryRank`, `categoryRank`, `category`, 6 traffic channels, `topReferrals`, `similarSites`, `topPages`, `topSubfolders`, `topCountries`, and per-keyword `volume`, `cpcUsd`, `changePct`, `competitorUrl`, `competitorPos`, `isExclusiveToCompetitors`).
   - Complete canonical `200 OK` keyword clusters across `wesetup.ru`, `haccp-online.ru`, `checkoffice.ru`, and `rushaccp.ru`.
   - 10 read-only Tier-1 operations in `config/api-anything/sites/similarweb.json`.
   - Concise, scannable, non-overloaded UI without bloated prose.
2. **Auto-Run AI Agent Check on Filter Entry & Step-by-Step Progress Loader** (`PlannerTab.tsx`, `SimilarwebCompetitorsWorkspace.tsx`, `src/lib/seo/gogetlinks-orders.server.ts`, `src/app/api/root/gogetlinks/slots/[id]/route.ts`):
   - When the user enters `/root/seo/links?targetUrl=...&keyword=...` or selects a landing page filter (`targetUrlFilter !== "all"`), automatically assign/prepare the filtered landing page and run the AI agent check (`prepare_now` / `assign_target` with `prepareNow: true`).
   - Display a live **Step-by-Step AI Agent Progress Loader** showing the 4 stages (`1. Посадочная ссылка wesetup.ru`, `2. Сайт конкурента и Topvisor`, `3. Площадки-доноры GoGetLinks`, `4. Анкор и черновик статьи / ТЗ`).
   - Only show the inline `Назначить <url>` button on slot rows when `targetUrlFilter !== "all"` (never when viewing `"Все посадочные"`).

## Acceptance Criteria
- **AC1**: `config/api-anything/sites/similarweb.json` passes `parseSite()` validation with 10 read-only Tier-1 operations.
- **AC2**: `src/lib/seo/similarweb-client.ts` extracts and normalizes full Similarweb payload fields and preserves backwards-compatible JSON storage via `encodeSimilarwebClustersPayload` / `decodeSimilarwebClustersPayload`.
- **AC3**: `src/lib/seo/similarweb-seed.ts` provides comprehensive, canonical `200 OK` keyword clusters and Similarweb telemetry across `wesetup.ru`, `haccp-online.ru`, `checkoffice.ru`, and `rushaccp.ru`.
- **AC4**: `buildCompetitorBenchmarkReport` exposes full domain telemetry, discovered referrals/similar sites, enriched keyword gap rows, and concise action cards.
- **AC5**: `SimilarwebCompetitorsWorkspace.tsx` and `PlannerTab.tsx` render compact scannable analytics, auto-run AI agent verification when entering by filter, display step-by-step AI agent progress loaders, and hide the `Назначить <url>` button when `targetUrlFilter === "all"`.
- **AC6**: `npm run typecheck` and targeted unit tests (`similarweb-client.test.ts`, `gogetlinks-sync.test.ts`, `gogetlinks-planner.test.ts`, `gogetlinks-orders.test.ts`) pass with 0 errors.
