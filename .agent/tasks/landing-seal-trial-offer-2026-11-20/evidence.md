# Evidence — landing-seal-trial-offer-2026-11-20

Verified on 2026-11-20 against the working tree of `claude/hopeful-euler-lb6cie` (base `origin/master`
`fdc7890b0`): `next dev` + Playwright Chromium, then a fresh rerun of typecheck, targeted tests and lint
after the last edit. Details: `raw/live-checks.txt`.

| AC | Verdict | Proof |
|----|---------|-------|
| AC1 open-document window | PASS | `raw/live-checks.txt` §2: «Не переходить» on top (390×56, brand colour, focus), «Всё равно перейти» below (390×56, grey; dark surface at night); «Не переходить» closes without a tab for both documents, «Всё равно перейти» opens `/oferta` in a new tab. Test `open-document window…` in `haccp-gold-seal.test.ts`. |
| AC2 trial line | PASS | §1: «14 дней всё бесплатно (до 04.12.2026). Подробнее» — one line at 360–440 px and on desktop, no horizontal scroll (two balanced lines only at 320 px). Date = today (Moscow) + `TRIAL_DAYS`; «Подробнее» is the same `#pricing` link. Test `hero: … «14 дней … (до даты)»` (ru/en/uz wording, plural «21 день»). |
| AC3 gold seal | PASS | `src/components/landing/haccp-gold-seal.tsx`; screenshots `hero-390/440/1440`, `seal-light-rest`, `trust-dark-390`, `trust-en-390`, `trust-uz-390` (gitignored). 84 px below 400 px width, 92 px from 400 px (was a 44 px icon); words clamped by `textLength` ≤ 66 inside the ring of r = 40.5. Tests: words per locale, no dangling `url(#…)`, unique ids for two seals, no theme-repainted colour classes. |
| AC4 motion | PASS | §4: stamp / shine / sparkle animations run; with `prefers-reduced-motion: reduce` and `html[data-view-still]` all three are `none`, the seal is static and visible, shine and sparkles hidden. Test `seal motion…`. |
| AC5 translations | PASS | `auth.legal.openYes/openNo`, `landing.hero.trialUntil`, `sealTitle`, `sealCaption` changed/added in `ru`, `en`, `uz`; `npm run i18n:types` regenerated `message-contract.d.ts`; en/uz seal has no Cyrillic (test + live `/en`, `/uz`). |
| AC6 checks | PASS | `raw/typecheck.txt` (exit 0); `raw/test-changed.txt` (64 files, pass 266, fail 0, includes the new `haccp-gold-seal.test.ts`); `raw/lint.txt` (0 errors; 1 warning `react-hooks/purity` on the old `Date.now()` line, untouched); `npm run palette:neutral` — no diff, `neutral-palette.test.ts` passes. |

Mutation check: with the master versions of `legal-consent-checkbox.tsx` and `ru.json` the new tests
fail (3 of 5), with the new versions all 5 pass.

Not exercised: a real iPhone (fonts measured in Inter, which is as wide as Helvetica Neue), the
production build (`npm run build` runs in CI/deploy).
