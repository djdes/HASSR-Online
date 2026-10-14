# Evidence — verified partial delivery

**Overall task: INCOMPLETE.** AC3 does not pass: only the main landing, login and registration have English routes. Scope clarification is outstanding; other public pages and the authenticated application are not translated. See `coverage.md`. The ProjectsFlow task remains in progress. No publication or production deployment.

The implemented slice passes current verification: 40 focused tests, all 3375 tests in the full gate, TypeScript, ESLint (no errors; 3 existing warnings), production build, and all browser scenarios in `raw/browser-report.json`. Source hashes are recorded in `raw/source-manifest.json` and checked by `package-evidence.py`. `review.md` records current-source findings and limitations; `problems.md` records failed checks and minimal fixes.

AC1, AC2, AC4, AC5 and the auth addendum AC6 pass for the explicit implemented slice. AC3 remains INCOMPLETE. These results must not be presented as a PASS for the entire English-site task.

Browser coverage: actual English SSR and SEO without JavaScript; RU/EN switching with query/hash and cookie; visible header controls at 320/400/640/768/1024px and two scroll positions; transition into a Russian page; all six QR chapters; equipment controls; registration CAPTCHA/consent/429 and unchanged payload; login, second factor, email-link/reset feedback; support validation; signed-in landing with original-language customer name; auth-layout redirects; sitemap, English PNG preview and 404 for unknown English private/API aliases.

Reproduction: install the repository dependencies, use an isolated database/configuration, run `checks.sh` (adjust its checkout path), run `next build --webpack` and `next start` with a dedicated `NEXT_DIST_DIR`, set `ENGLISH_FIXTURE_URL` to the loopback server, and run `node browser-check.mjs` with Playwright/Chrome installed. Browser auth fixture secret must match the isolated server test secret. Never use this fixture against production. Checks do not create real accounts, send email or complete a real CAPTCHA. Live database values and physical passkey hardware are not exercised.

Raw logs: `raw/verify-*`, `raw/build.log`, `raw/build.exit`; browser report and local screenshots `raw/english-mobile.png`, `raw/english-og.png`. Failed development-server reports are diagnostic history, superseded by the production-build browser run. No new dependency or schema change. Unrelated working-tree changes remain outside the task manifest.
