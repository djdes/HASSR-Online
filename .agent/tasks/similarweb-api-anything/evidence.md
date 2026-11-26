# Evidence: Similarweb Integration via `api-anything`, Tab Separation & Competitor Benchmarking

## Task ID
`similarweb-api-anything`

## Verification Summary
- **`npm run typecheck`**: `PASS` (0 errors)
- **`npm run test:changed`**: `PASS` (9 targeted test files, 107 tests passed, 0 failed in 7.6s)
- **`node --import tsx --test src/lib/seo/similarweb-client.test.ts src/lib/seo/gogetlinks-planner.test.ts src/lib/platform-access.test.ts`**: `PASS` (30 tests passed, 0 failed)

## Acceptance Criteria Results

| Criterion | Status | Evidence |
|-----------|--------|----------|
| **AC1**: Declarative `api-anything` Site Spec (`config/api-anything/sites/similarweb.json`) | `PASS` | Validated by `parseSite()` in `similarweb-client.test.ts`. |
| **AC2**: Pure Similarweb Parser, Canonical URL Mapper & Competitor Benchmark (`src/lib/seo/similarweb-client.ts`) | `PASS` | `mapSimilarwebPhraseToWesetupUrl` and `buildCompetitorBenchmarkReport` verified by unit tests. |
| **AC3**: Server-Side `api-anything` Similarweb Client (`src/lib/seo/similarweb-client.server.ts`) | `PASS` | Encrypted cookie/API-key persistence and `call("similarweb", ...)` verified by unit tests. |
| **AC4**: API Route Integration (`src/app/api/root/gogetlinks/similarweb/route.ts`) | `PASS` | Returns `benchmark` + `similarwebConnection` on `GET`; handles `sync_domain` and `save_connection` on `POST`. |
| **AC5**: Separate `/root/seo/competitors` Tab & Clean GoGetLinks Connection Tab | `PASS` | Added `/root/seo/competitors` (`src/app/root/seo/competitors/page.tsx`, `SimilarwebCompetitorsWorkspace.tsx`, `seo-subnav.tsx`) and cleaned up `DemandAndAccountTab.tsx` / `links-client.tsx`. Verified by `platform-access.test.ts`. |
| **AC6**: Canonical 301 Remapping in Planner Slots + Automated Tests & Typecheck | `PASS` | `resolvePublicSeoTargetPath` and `serializePlannedSlot` remap 301 slugs; 107 tests in `test:changed` and `typecheck` pass with 0 errors. |
