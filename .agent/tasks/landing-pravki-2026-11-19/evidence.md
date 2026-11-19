# Evidence — landing-pravki-2026-11-19

Verified on 2026-11-19 against the working tree of `claude/brave-cannon-5aodxd`
(base `origin/master` `08072abb4`): local Postgres + `next dev`, Playwright Chromium.

| AC | Verdict | Proof |
|----|---------|-------|
| AC1 price line removed | PASS | `src/app/page.tsx`: both `AnchorScrollLink` with `heroPhrase` are gone; screenshots of the hero (phone, 1440 px). |
| AC2 e-mail hints inside the field | PASS | `raw/live-checks.txt` §1: the button stays at 489.16 px in all four states; test in `localized-components.test.ts` (no `<EmailHint` in the start form). |
| AC3 consent stays, links ask first | PASS | `raw/live-checks.txt` §2; `legal-consent-checkbox.tsx` (`confirmLinks`). «Да» was not clicked live. |
| AC4 «До … всё бесплатно» | PASS | Hero screenshot shows «До 03.12.2026 всё бесплатно, далее только 1 журнал. Подробнее» on 19.11.2026 (+14 days); `trialUntil` in `page.tsx` uses `TRIAL_DAYS` and Moscow time. |
| AC5 QR block texts | PASS | Test `хром 19.11.2026…` in `qr-player.test.ts`; screenshots. |
| AC6 PDF beside the video button | PASS | `data-qr-presentation` in `qr-player.tsx`; screenshot (phone: «Видео со звуком» + «PDF»). |
| AC7 chapter arrows | PASS | `data-qr-prev` / `data-qr-next`; clicked «next» in the live run. |
| AC8 try-it controls | PASS | CSS `.qrp-range-try` (44 / 8 / 28 px); test `«Попробуйте сами»: оценка масла…`; live: score 2 → journal row «Неудовлетворительное». |
| AC9 organisation name | PASS | `qrScene.demo.org` = «ООО «БФС»» (ru), three `tr("demo.org")` in `scene.tsx`; stamp in the screenshot. |
| AC10 texts and checks | PASS | `raw/typecheck.txt` (exit 0), `raw/test-gate.txt` (65 files, pass 273, fail 0). |
