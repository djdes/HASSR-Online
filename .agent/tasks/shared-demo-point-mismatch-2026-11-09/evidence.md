# Evidence — shared demo organization + point mismatch notice

Verified against the working tree on 2026-11-09. Raw artifacts are in `raw/`.

| AC | Verdict | Proof |
|----|---------|-------|
| AC1 | PASS | `raw/shared-demo-db-run.txt` (`scripts/_verify-shared-demo.ts` on a local PostgreSQL): two account owners join the organization `demo`, organization count grows by exactly one. Browser: `POST /api/organizations/demo` → `{"organizationId":"demo"}` (`raw/demo-ui.js`). |
| AC2 | PASS | Same run: a visitor's edit is gone after `reinstallSharedDemoOrganization()`, the id stays `demo`; an overdue demo is reinstalled by `ensureSharedDemoOrganization()`. Cron route `src/app/api/cron/purge-demo-orgs/route.ts` calls the same function (code path, not called over HTTP). |
| AC3 | PASS | Same run: the legacy per-account demo is deleted by `purgeLegacyDemoOrganizations`, both real organizations remain; deletion keeps the `isDemo: true` guard. |
| AC4 | PASS | `raw/demo-banner.png` and the banner text printed by `raw/demo-ui.js`: shared, next refresh time, one button «Вернуться в мою организацию». The profile-menu dialog was checked by typecheck only, not clicked in a browser. |
| AC5 | PASS | Same run: «Соколова Ирина Владимировна» exists once after install and after reinstall. `/api/root/seed-demo-org` now reinstalls the shared demo and creates nothing else. The `/root` page itself was not opened in a browser. |
| AC6 | PASS | `raw/point-ui.js` + `raw/point-mismatch.png`: document of «Точка А» opens at A, shows the notice at B, opens again after «Перейти на точку», and opens in «Вся организация». Unit tests in `src/lib/document-point-access.test.ts`. |
| AC7 | PASS | Guarded: journal document (+ layout, verify), journal entry, paper journal document, batch, CAPA, EDO document. Left as is with reasons: see the audit table in the PR. Only the journal document was exercised in a browser; the rest share the helper and are covered by the source-scan test. |
| AC8 | PASS | `raw/typecheck.txt`, `raw/i18n-check.txt`, `raw/test-gate.txt`. |

Not verified: the daily cron over HTTP with the real secret and schedule; the
Mini App shell; en/uz wording by a native speaker.
