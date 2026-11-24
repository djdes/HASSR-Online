# Problems: office-default-login-leak-2026-11-24

Fresh verifier, round 2, on HEAD `60ec0ef07` (code diff vs `origin/master` `4f93950aa`, with the «AC4 amendment»
and the «Fixes after the fresh verifier (round 1…)» section of the spec).

**No open problems: every acceptance criterion is PASS** (see `verdict.json`).

## Round 1 problems — status

- **P1 (AC2) — fixed.** `src/app/root/me/mail-sender-form.tsx` has `method="post"`; the guard
  (`src/app/password-forms-post.test.ts`) also matches `type: "password"` / `autoComplete: "…-password"` object props
  and lists the file. Re-check: `/root/me` with page bundles blocked → fill the SMTP password → «Сохранить» →
  `POST /root/me` (200), URL stays `/root/me`, the password is in no URL or request URL. No other `.tsx` file uses
  the object-prop form.
- **P2 (AC6) — fixed as specified in the spec's fix section.** The office page hides «Добавить в офис» when there are
  no objects (`readOnly || !office || points.length === 0`). Re-check: one-object company with an open office →
  `DELETE` the object (200) → office page: four blocks, no «Добавить в офис», no «не распределены»,
  «Создать объект» and «Объектов пока нет» shown. The office row stays by decision; see the non-blocking note in
  `verdict.json`.

## After the verdict — CI browser smoke (builder)

- **P3 (AC9, CI) — fixed in the smoke.** `04-acceptance: есть «ждут приёмки»` failed on `a071df0a2`, `bd26f8fcc` and
  `ab835c837`: at the check the page was hidden under `[data-content-pending]` and the header showed «Выберите объект».
  Quick setup now opens the office with the first object, so the journal page switches the header to the only object
  right after the load (`PointSectionSync`, designed in #317) and the smoke read the text after a fixed 1.5 s. Fix:
  `scripts/smoke/new-features.smoke.cjs` `settle()` — `screen()` waits until the switch skeleton is gone and the
  expected text is there (up to 60 s); the check itself is unchanged. Local smoke: the text check passes after
  `POST /api/me/active-building`; `raw/ci-smoke-autoswitch.txt`. The «нет ошибок страницы» hydration error (`useId`
  in the cabinet header) is older and comes from master (#321, #330).
- **P4 (AC9, CI; base) — hardened in the smoke.** On `afa8bd771` the text check passed, then step 3 crashed: the Next.js
  dev overlay pill («3 Issues», from console errors of the page load) lay over «Подписать УКЭП» and intercepted the
  click (`<nextjs-portal> … intercepts pointer events`). A PR from master without this task crashed the same way
  (`t3/mailings-channels`, run 45366085009). Fix: `tap()` removes the dev overlay node before clicking, as `screen()`
  and `shot()` already do; page errors are still collected by the console listener. Local check
  `raw/overlay-tap-check.cjs`: intercepted before, clicked after; `raw/ci-smoke-overlay.txt`.

Round-1 notes that were fixed and re-checked: management bound to every object (or to the only object) stays
company-wide; the deploy loop survives a failing company; the ROOT metrics no longer count the office; the
«не распределены» strip is readable in dark theme.
