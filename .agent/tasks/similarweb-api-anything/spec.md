# Task Spec: Similarweb Integration via `api-anything`, Tab Separation & Competitor Benchmarking

## Task ID
`similarweb-api-anything`

## Objective
1. Build a Similarweb integration via `api-anything` (`config/api-anything/sites/similarweb.json`, `src/lib/seo/similarweb-client.ts`, `src/lib/seo/similarweb-client.server.ts`).
2. Separate Similarweb competitor analysis from GoGetLinks account settings:
   - Create a dedicated top-level SEO tab **`/root/seo/competitors` («Конкуренты (Similarweb)»)** in `src/components/root/seo-subnav.tsx`.
   - Rename the GoGetLinks tab in `/root/seo/links` to **«Подключение GoGetLinks»** so it contains only GoGetLinks cabinet credentials/settings and a clean link to `/root/seo/competitors`.
3. Add a full **Competitor Benchmark & Cluster Gap Analysis** (`buildCompetitorBenchmarkReport` + UI in `SimilarwebCompetitorsWorkspace.tsx`) comparing `wesetup.ru` against competitors (`haccp-online.ru`, `checkoffice.ru`, etc.) across traffic, organic/paid share, bounce rate, pages/visit, Topvisor positions, and purchased backlinks.
4. Automatically remap legacy 301-merged slugs in planned slots (`/zhurnal-frityurnyh-zhirov` -> `/journals-info/fryer_oil`, `/elektronnyy-zhurnal-sanpin` -> `/`, etc.) via `resolvePublicSeoTargetPath()`.

## Acceptance Criteria
- **AC1**: `config/api-anything/sites/similarweb.json` passes `parseSite()` validation and defines `getDomainOverview`, `getWebsiteAnalysis`, and `getProSearchKeywords`.
- **AC2**: `src/lib/seo/similarweb-client.ts` normalizes Similarweb metrics, maps search phrases to canonical `200 OK` public `wesetup.ru` URLs, and computes `buildCompetitorBenchmarkReport` (`domains` side-by-side summary + `clusterGaps` with verdicts `push_top3`, `gap_no_rank`, `need_links`, `leader`, `parity`).
- **AC3**: `src/lib/seo/similarweb-client.server.ts` executes `call("similarweb", ...)` via `api-anything` with AES-256-GCM encrypted session storage and classifies CloudFront 403 / AWS WAF 202 (`blocked`) and 401 (`auth`).
- **AC4**: `src/app/api/root/gogetlinks/similarweb/route.ts` returns `benchmark` and `similarwebConnection` on `GET` and supports `action: "sync_domain"` and `action: "save_connection"` on `POST`.
- **AC5**: Top-level SEO navigation (`src/components/root/seo-subnav.tsx`) includes `/root/seo/competitors` («Конкуренты (Similarweb)») rendered by `src/app/root/seo/competitors/page.tsx` and `src/components/root/seo-links/SimilarwebCompetitorsWorkspace.tsx`, while `/root/seo/links` tab `"demand"` is cleanly dedicated to «Подключение GoGetLinks».
- **AC6**: `resolvePublicSeoTargetPath` and slot serialization remap 301-merged slugs to canonical `200 OK` paths; `npm run typecheck` and `npm run test:changed` pass with 0 errors.
