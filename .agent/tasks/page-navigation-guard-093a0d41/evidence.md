# Verification evidence — PASS

Task 093a0d41: deter fast automated collection with server-side frequency limits and a Russian timed wait screen. Specification includes the documented Next 16.1.6 findings in revisions 1 and 2. Every AC is PASS against the source hashes in `raw/source-manifest.json`.

| Criterion | Current evidence | Result |
|---|---|---|
| AC1 | Rolling windows, UA signal, fixed cooldown, independent subjects, memory cap/expiry: `raw/verify-focused.log` | PASS |
| AC2 | Actual proxy document/RSC denial; root/directory/partner/staff precedence; API/assets/payment/operational exemptions; real Next browser fixture | PASS |
| AC3 | Verified JWT identity, trusted/canonical IP, forged session/header cases, bounded fetch budget; real server rejects request 241 | PASS |
| AC4 | Six browser scenarios: normal full Link prefetch/navigation, RSC-to-document fallback, 320px/desktop countdown, early retry denial, real cooldown recovery at same URL/query, no-JS explanation and headers, background overflow | PASS |
| AC5 | Fresh focused 19/19; full gate 3362/3362; lint/typecheck/diff checks; current-source review and source hashes | PASS |

Commands: `node --import tsx --test src/lib/page-navigation-limit.test.ts src/page-navigation-proxy.test.ts src/proxy.test.ts`; ESLint over the five changed TS files; `npm run typecheck`; `npm run test:gate`; `git diff --check`. Their final logs are `raw/verify-*`, exit marker `raw/verify.exit`. Verification ran in the isolated Linux checkout at commit 46c0f82 plus this task, without unrelated local mobile changes or production database access.

Browser: actual repository proxy imported by a minimal Next 16.1.6 production app, reached only through loopback SSH forwarding; Chrome/Playwright. `raw/browser-report.json` contains current successful scenarios, `raw/browser-build.log` the successful fixture build. Screenshots `raw/wait-320.png`, `raw/wait-desktop.png`, `raw/wait-nojs.png` remain local artifacts per repository image-ignore policy. To reproduce without SSH: run `npm run build` and `npm run start` in `browser-fixture`, set `NAVIGATION_FIXTURE_URL` to its loopback URL, and run `node browser-check.mjs` with Chrome installed.

`review.md` records the fresh current-source review. `problems.md` and failed browser reports retain findings and their fixes; current results supersede them. No new dependency, database schema change or external provider. Existing registration reCAPTCHA and unrelated working-tree files remain untouched.

Publication is separate from implementation verification: **not pushed and not deployed**. GitHub account write access was already confirmed blocked in the preceding task. The task remains in progress in ProjectsFlow pending publication. Limits are a deterrent, not prevention of copying; trusted-ingress, NAT, restart/scaling and background-budget limitations are documented in `docs/page-navigation-guard.md`.
