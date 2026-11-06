# GoGetLinks webmaster applications and SEO dispatcher analysis

Status: frozen before implementation; amended after fresh-master discovery, 2026-11-06.

## User outcome

Extend the existing GoGetLinks API used for SEO so the owner and SEO dispatcher can read incoming webmaster applications, inspect every applicant's available details, and recommend suitable placements with evidence.

## Discovery

- Shared connector: `C:/www/api-anything/sites/gogetlinks.json` (junction to `D:/www/api-anything/sites/gogetlinks.json`).
- MCP tools expose 16 existing operations, including active/closed campaigns, paid reviews, donor search and message threads.
- No dedicated incoming-application or donor-detail operation is present.
- Fresh origin/master `1bc7eb85` includes `/root/seo/links` and the production GoGetLinks session. Extend that existing workspace with incoming applications and dispatcher recommendations.

## Acceptance criteria

- AC1: Retrieve incoming webmaster applications with stable identifiers and campaign context using observed authenticated GoGetLinks requests; handle all pages and verified empty states. Do not mislabel paid reviews as incoming applications.
- AC2: Retrieve all relevant available details per applicant/site, including offered prices, placement type and terms, metrics, topic and webmaster information where exposed. Preserve unknowns as unknowns. Link list items to detail operations using observed identifiers.
- AC3: Make these read operations available to the actual SEO dispatcher and document a repeatable comparison procedure: topic fit, traffic, quality/trust metrics, outbound-link risk, placement terms, price and previous cooperation. Recommendations must cite observed data and explicitly state missing data and sample coverage.
- AC4: Preserve existing operations, keep credentials out of schemas/evidence, do not publish private account data or place purchases/send messages as part of analysis.
- AC5: Fresh verification must compare operation results with current cabinet pages, cover pagination and empty/error states, and prove that the dispatcher can discover and execute the operations.

## Implementation constraints

Capture the real authenticated site contract before adding operations. Use the installed api-anything authoring tools and local-only schemas. Do not invent endpoints, CSS selectors, fields or successful checks. Schema and dispatcher changes require backups. Keep evidence here.

## Implementation plan

- Read the observed POST `/reviews/table` with `action=request`, campaign filter and `page_num`. The GET query parameter is ignored by GoGetLinks and must not be used for pagination.
- Read the observed POST `/viewSiteInfo` with `siteId` and `type=1`. Both POST endpoints only retrieve data; never call application acceptance, ordering or payment endpoints.
- Cache campaign-scoped list snapshots, individual site cards and analysis in existing `PlatformSetting` rows. No schema migration is needed. Reject changed/incomplete pagination for all-applicant analysis.
- Load site cards in resumable bounded batches; show progress and unavailable cards explicitly. Preserve all displayed card fields and example placement URLs as data, never raw HTML.
- Submit one self-contained `wesetup_ggl_webmasters` job through the existing dispatcher queue with metrics for every applicant, card coverage, topic, region, indexing, link density, prices and placement examples. Validate recommendations against submitted site IDs; never interpret them as purchasing actions.
- New API routes use existing root/delegated SEO authorization. Extend the worker allowlist and document the contract.
- The owner explicitly prohibits spending the GoGetLinks balance during this task.
- User steering: use the existing Ralph dispatcher, not Claude authentication. Ralph `C:/www/ralph/dispatch.ps1` already supervises the WeSetup product worker; `llm-client.psm1` exposes its authenticated Codex text engine with a read-only workspace and tool-denial guard. Route the dedicated SEO job through that engine, retain the invisible assistant queue, and remove the temporary period-report fallback. Do not modify Ralph's unrelated dirty working tree. Install/restart the supervised WeSetup worker from merged master and prove the live queue succeeds.
- The existing web deployment workflow only checks master. Add a secret-free, GoGetLinks-scoped pull-request check for typecheck, the existing test gate and worker routing, so the required green-PR merge can be verified before deployment.

## Resolved discovery dependencies

- Production already has a working GoGetLinks session; read-only requests were verified through the existing server connection. The unrelated shared MCP session is not needed.
- Existing WeSetup dispatcher and `/root/seo/links` establish the implementation target. Supplied root credentials were tried once and returned 401; do not change credentials to obtain access.

## Delivery

## Live queue constraint amendment (frozen before corrective implementation)

The complete live 473-site prompt contains 153,953 characters; the actual ProjectsFlow enqueue endpoint rejects text over 50,000 characters. All 473 cards (6,665 fields, 901 examples) are already cached, and the wallet stayed unchanged. Keep all data: encode large SEO jobs using a versioned gzip/base64 envelope below 50,000 characters, and expand it only in the dedicated SEO worker before Ralph. Do not change ProjectsFlow's validation or other job types.

- AC6: A real all-applicant payload crosses the existing queue within its 50,000-character limit and is restored byte-for-byte before Ralph; reject malformed, oversized or wrong-type compressed data with bounded decompression. Preserve plain short jobs. Test Node-to-PowerShell compatibility and the live complete report. Deliver the corrective change through a separate green master PR, then restart only the owned WeSetup worker through normal process permissions.

For changes to tracked WeSetup application files, use a clean worktree from current origin/master, required checks and a green squash PR to master. The current primary worktree has pre-existing untracked mobile files blocking an update; preserve them. Shared connector/configuration installation is local and must be verified separately from application deployment.
