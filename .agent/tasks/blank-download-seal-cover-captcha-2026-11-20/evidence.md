# Evidence — blank-download-seal-cover-captcha-2026-11-20

Verified on 2026-11-20 against the working tree of `claude/hopeful-euler-lb6cie` (base `origin/master`
`330b983a1`): `next dev` + Playwright Chromium, then typecheck, the test gate (escalated to the full suite)
and ESLint on the final code. Details: `raw/live-checks.txt`, `raw/live-files.txt`.

| AC | Verdict | Proof |
|----|---------|-------|
| AC1 seal in the window | PASS | §1–§2: `blank-download-trust` under «Скачать» in the full and the short window; seal 56×62 next to a 3-line note (≈55 px) at 375/440/1440 px, no horizontal scroll. Same `HaccpGoldSeal` and `.gold-seal*` motion rules as the landing (reduced motion / «Без анимации» covered by the landing rules). Test: client harness finds the seal and the note in ru/en/uz. |
| AC2 title page checkbox | PASS | §1–§2: «Добавить титульный лист первой страницей» checked by default, sent as `cover`, remembered with the e-mail (restored unchecked after `cover: false`); not shown on en/uz (harness: 3 checkboxes on ru, 2 on en/uz) and not for the constructor layout. |
| AC3 title page in the file | PASS | `raw/live-files.txt`: hygiene PDF 2→3 pages (JOURNAL_COVERS lines, «Приложение N 1»), cleaning PDF 1→2 (journal title), paper `ot_intro` PDF 2→3, hygiene Word 1→2 sections; page 2 equals the plain page 1; company from the window, empty dates. Tests in `journal-cover-pdf.test.ts` (PDF, paper PDF, Word, en without cover) and `blank-download-token.test.ts` (claim `p` signed, forged → `bad-sig`, old links without it). |
| AC4 captcha only for suspicious | PASS | §1: normal browser passes with the invisible stamp, no widget or Google script; §3: suspicious request → 403 `captcha_required` → widget in Russian (`hl=ru`), «Скачать» waits for the token. Tests: `blank-challenge-gate.server.test.ts` (UA rules, stamp missing/fresh/forged/foreign, honeypot, per-IP 5/h and site-wide 40/10 min thresholds, Google path), route tests (no stamp → `captcha_required` before side effects, quoted UA, no keys → 503, valid stamp → DNS + consent write reached, Google not called), client harness (`captcha_required` → `requireCaptcha()`, no red error, form kept). |
| AC5 translations | PASS | `publicBlankDownload.cover.label`, `trust.{note,sealTitle,sealCaption}`, `challenge.required`, `error.captchaRequired` in ru/en/uz; `npm run i18n:types` regenerated `message-contract.d.ts`. |
| AC6 checks | PASS | `raw/typecheck.txt` (exit 0); `raw/test-changed.txt` — 101 related test files > 80, escalated to the full suite: pass 6853, fail 0; `raw/lint.txt` — 0 errors (7 old unused-variable warnings in `document-pdf.ts`, outside the changed lines). |

Notes: the full test run rewrites PDFs in `.agent/tasks/english-version-1375e736/raw/`; they were restored
with `git checkout` and are not part of this change. Not exercised: a person solving a real reCAPTCHA with
production keys (provider behaviour unchanged, covered by `blank-recaptcha.test.ts`), the production build
(runs in deploy).
