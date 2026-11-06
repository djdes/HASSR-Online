# Verification Evidence: `gogetlinks-campaign-fix-2026-11-06`

## Summary

All acceptance criteria (`AC1`–`AC5`) from [`spec.md`](./spec.md) are verified against the current codebase and live GoGetLinks cabinet (`gogetlinks.net`):

- **AC1 (`PASS`):** `createGglFetch` in `src/lib/seo/gogetlinks-client.server.ts` is wired into `verifyAndLoginGgl`, `callGglRead`, and `callGglWrite`. On HTTP `200` HTML responses that do not match real interstitial challenges (`Prove your humanity`, `Human Verification`, `Just a moment`, etc.), passive layout markers (`google.com/recaptcha`, `g-recaptcha`, `hcaptcha.com`) are neutralized case-insensitively in-place on `Uint8Array` without altering byte length or `windows-1251` Cyrillic bytes (`0x80`–`0xFF`). Also `sanitizeGglTierState()` strips any poisoned `tier > 1` entries in `<API_ANYTHING_HOME>/state.json`.
- **AC2 (`PASS`):** `config/api-anything/sites/gogetlinks.json` scopes table rows (`#table-content tr[id^='comp_row_']`, `#table_content tr[id^='col_row_']`, `.js-messages__content tr[id^='thread_']`), adds `empty` selectors for zero-item tables, updates open-campaign `spent` (`td[data-th^='Потрачено'] a`), and adds `setOverallCampaign`. `callGglRead` maps logical review tabs (`in_progress -> propocal`, `on_check -> index`, `needs_replacement -> rejected`), and `createGglFetch` converts empty-tab `/reviews/*` cross-redirects into an empty table HTML response instead of misclassifying `/reviews/request` or `/reviews/rejected` rows. Zero secrets or cookies exist in `gogetlinks.json`.
- **AC3 (`PASS`):** Open campaign **`#884931`** (`WeSetup электронные журналы ХАССП`, `wesetup.ru`) is created and active in GoGetLinks (`0 ₽` spent, 6 legacy closed campaigns untouched in `Закрытые`) and permanently selected via `POST https://gogetlinks.net/campaigns/setOverallCampaignId` (`200 {"success":true}`). `callGglWrite` implements GoGetLinks' 5-step modal creation workflow (`GET /campaign` -> `checkUrl` -> `unchors/change` -> `exist/type/find_exists` -> `campaign/save` without `set_prices_to_all`) and `pinGglOverallCampaign` enforces `GglIsolationError` before touching the network.
- **AC4 (`PASS`):** `syncGglCabinet` auto-binds `GglAccount.defaultCampaignId = 884931` when `defaultCampaignId` is null or stale, fetches `wesetup.ru` paid links last so `/reviews` keeps `#in_comp_id` on `wesetup.ru`, and calls `pinGglOverallCampaign(884931)` to keep `.js-table__campaigns` permanently selected. `PlannerTab` and `DemandAndAccountTab` reactively select `#884931` immediately after sync/ensure without requiring a manual page reload.
- **AC5 (`PASS`):**
  - Live cabinet sync smoke test (`raw/live-sync-smoke.txt`): `campaignsCount: 7`, `ordersCount: 58`, `defaultCampaignId: 884931`, `status: "ok"`, `lastError: null`, zero `reCAPTCHA` or `drift` errors.
  - All 58 GoGetLinks/SEO unit tests (`src/lib/seo/gogetlinks-*.test.ts`) pass (`pass 58, fail 0`).
  - `npx eslint` on all 7 touched `.ts`/`.tsx` files passes with `0` errors and `0` warnings.
  - `sh scripts/check-secrets.sh` passes with `0` secrets.
  - `npm run typecheck` passes with `0` errors.
