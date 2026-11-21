# Evidence — landing-seal-safari-consent-header-2026-11-21

Verified 2026-11-21 on the working tree (base `origin/master` `dfd976cbf`): `next dev` + Playwright Chromium,
typecheck, targeted gate and ESLint on the final code. Details: `raw/live-checks.txt`.

| AC | Verdict | Proof |
|----|---------|-------|
| AC1 seal readable in Safari | PASS | §1: solid ink, no `textLength`/`<use>`, `scale(x 1)` from a 0.74 em/letter estimate; fits with Arial metrics (61/60) and wide DejaVu (66/67). Tests: `seal words fit the ring…`, no Safari-fragile features, solid fill. WebKit itself is not installed here — the fix removes the two features Safari mishandles instead of relying on them. |
| AC2 animation | PASS | §2: tap → 4 Web Animations; CSS 8 s cycle (wiggle, shine, sparkles); motion off under reduced motion / «Без анимации» (test `seal motion…`). |
| AC3 consent line | PASS | §3: one line, 14.7–16 px, 22 px checkbox at 360–430 px; `LEGAL_CONSENT_TEXT_SHORT` equals the visible ru text (test in `localized-components.test.ts`). |
| AC4 header | PASS | §4: 16 / 16 px at 360–430, no overflow; cabinet rule scoped to `:not(.public-theme)`; same spacing in `public-chrome.tsx`. |
| AC5 checks | PASS | `raw/typecheck.txt` exit 0; `raw/test-changed.txt` 65 files, pass 276, fail 0; `raw/lint.txt` 0 errors (1 old warning on `Date.now()` in page.tsx). |
