# Task Spec: GoGetLinks Tier-1 reCAPTCHA False-Positive Fix & Permanent `wesetup.ru` Campaign Binding

- **Task ID:** `gogetlinks-campaign-fix-2026-11-06`
- **Status:** `FROZEN`
- **Frozen At:** `2026-11-06T11:07:00+03:00`
- **Branch:** `fix/gogetlinks-campaign-and-recaptcha`

## Context & Problem Statement

1. **Tier-1 False-Positive `reCAPTCHA challenge page (HTTP 200)` during Cabinet Sync:**
   - Every authenticated HTML page on `https://gogetlinks.net` embeds `<script src="https://www.google.com/recaptcha/api.js?onload=recapthcaOnload&render=explicit">` and `captchaFormField: "<div class=\"g-recaptcha\" ...>"` in the global authorized layout.
   - When an authenticated GoGetLinks HTML response is `< 64,000` bytes (such as `/messages` at ~58 KB) and has no login form, `api-anything`'s `botWall()` classifier misidentifies it as `reCAPTCHA challenge page (HTTP 200)` and fails Tier-1 sync (`maxTier: 1`).
2. **Real GoGetLinks Campaign Creation & Permanent Cabinet Pinning (`wesetup.ru`):**
   - The GoGetLinks account holds 6 closed legacy campaigns (`mp3mail.ru`, `electrorent.ru`, `yesbeat.ru` ×2, `fonmusic.ru`, `foodgin.ru`).
   - Creating a campaign in GoGetLinks uses a multi-step modal flow (`GET /campaign` XHR token + defaults -> `POST /campaign/checkUrl` -> `POST /unchors/change/token/<token>/type/save` -> `POST /campaign/save`) and pins the active overall campaign in the GoGetLinks personal cabinet via `POST /campaigns/setOverallCampaignId` (`campaignId`).
   - Open campaign rows on `/campaigns` use `td[data-th='Потрачено (за месяц/всего)'] a`, and empty `/reviews/<tab>` endpoints 302-redirect to `/reviews/rejected` (`На замену`), which must not misclassify legacy rows under other statuses.
3. **Permanent `wesetup.ru` Selection in Wesetup `/root/seo/links` UI:**
   - `GglAccount.defaultCampaignId` must automatically and permanently bind to the active `wesetup.ru` campaign (`#884931` in production GoGetLinks) during sync, campaign ensure, and account save, and also pin `setOverallCampaignId` in GoGetLinks.
   - `PlannerTab` and `DemandAndAccountTab` must immediately reflect and keep the bound `wesetup.ru` campaign selected after sync or creation without requiring a manual reload, plus offer a 1-click ensure/create trigger in `PlannerTab` when none exists yet.

## Acceptance Criteria

- **AC1 (No Tier-1 reCAPTCHA False Positive + Byte-Safe `windows-1251`):**
  - `createGglFetch` is applied across `callGglRead`, `callGglWrite`, and `verifyAndLoginGgl`.
  - On HTTP `200` `text/html` responses that are not real CAPTCHA interstitials (`!/Prove your humanity/i`), inert `google.com/recaptcha` and `g-recaptcha` layout markers are neutralized in-place on the raw byte buffer without altering byte length or `windows-1251` Cyrillic characters, while real HTTP `403`/`429` or `Prove your humanity` challenge pages remain detected as blocked.
- **AC2 (Accurate Open-Campaign & Review-Tab Sync in `gogetlinks.json` + `gogetlinks-sync.server.ts`):**
  - `listActiveCampaigns` extracts open campaign rows (`td[data-th^='Потрачено'] a`, `td[data-th='Видимость'] a`).
  - `listReviewsByTab` uses real GoGetLinks review tab slugs and detects 302 tab redirects via active tab href (`activeTabHref`), preventing empty tabs from misclassifying `/reviews/rejected` or `/reviews/paid` rows.
  - Zero secrets or session cookies exist in `config/api-anything/sites/gogetlinks.json`.
- **AC3 (Real `wesetup.ru` Campaign Creation & Permanent GoGetLinks Cabinet Pinning):**
  - `createWesetupGglCampaign` implements GoGetLinks' verified `GET /campaign` -> `checkUrl` -> `unchors/change` -> `campaign/save` flow with strict `wesetup.ru` domain isolation (`GglIsolationError` on any non-`wesetup.ru` domain, `comp_name <= 50` chars, no `set_prices_to_all` side effects on closed campaigns).
  - `setOverallCampaign` (`POST /campaigns/setOverallCampaignId`) pins the active `wesetup.ru` campaign in GoGetLinks personal cabinet during `ensureWesetupCampaign`, `syncGglCabinet`, and `saveGglAccount` (when `defaultCampaignId` is set).
  - Live GoGetLinks cabinet has active open campaign `WeSetup электронные журналы ХАССП` (`#884931`, `wesetup.ru`) permanently selected via `setOverallCampaignId`, with all 6 closed campaigns untouched and `0 ₽` spent.
- **AC4 (Permanent `wesetup.ru` Auto-Selection in DB & `/root/seo/links` UI):**
  - `syncGglCabinet` auto-binds `GglAccount.defaultCampaignId` to the active `wesetup.ru` campaign whenever `defaultCampaignId` is null or does not point to an active `wesetup.ru` campaign.
  - `PlannerTab` and `DemandAndAccountTab` automatically select the campaign matching `account.defaultCampaignId` (updating reactively after sync/ensure without staying stuck on `Нет активной кампании wesetup.ru`), and `PlannerTab` provides a 1-click button for `superadmin` when no `wesetup.ru` campaign is synced yet.
- **AC5 (Quality Gates):**
  - Unit tests cover `< 64 KB` `windows-1251` HTML with `google.com/recaptcha` + `g-recaptcha`, review tab redirect guard, `createWesetupGglCampaign` + isolation guard, and `defaultCampaignId` auto-binding + `setOverallCampaign` pinning.
  - `npm run typecheck`, `npx eslint` on touched files, targeted SEO unit tests, and `npm run test:gate` all pass with zero regressions.
