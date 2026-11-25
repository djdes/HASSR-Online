# Evidence

Root cause: proxy calls evaluateDirectoryRequest with req.nextUrl.pathname for authenticated sessions. Directory sessions redirected every non-allowlisted page to /master, including the public /akciya landing.

Fix: allow exactly /akciya for directory sessions. No URL rewrite or redirect is introduced, so erid stays on the original request.

- AC1 PASS: regression tests exercise the pathname of an advertising URL with erid against directory sessions.
- AC2 PASS: same test exercises regular, null and undefined org kinds.
- AC3 PASS: private pages, private APIs and similar campaign paths remain restricted. Existing access tests also pass.

Raw checks: regression.log (11 passed); targeted.log (55 passed across five related test files). Typecheck and fresh verification output are stored separately.

Final current-code validation: typecheck-final.log exit 0; gate-final.log exit 0, 55 passed. Environment dependencies regenerated locally; no manifest, lockfile or schema changes. One defensive username guard resolves the existing Telegram typing error; details in problems.md.
